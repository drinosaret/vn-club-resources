"""Rows in and rows out: saving drafts, retention, and pruning entries VNDB no longer has."""

from __future__ import annotations

import logging
import re
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import delete, exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import NewsItem, PostedItemsTracker, VisualNovel
from app.services.news.drafts import NewsDraft, tracker_key
from app.services.news.sections import STORE_SOURCES

logger = logging.getLogger(__name__)

RETENTION_DAYS = 90

# Sources whose rows describe one VN and carry its cover.
VN_BOUND_SOURCES = ("vndb", "vndb_release", "vndb_review") + STORE_SOURCES

# Sources that relay other outlets' articles, where the same piece arrives under two
# addresses (a search feed's redirect link and the outlet's own).
_RELAY_SOURCES = ("rss", "hatena")
# Sources whose entries can arrive through more than one feed (a post carrying two
# hashtags, a bookmark of a filed article); the address is the identity.
_URL_UNIQUE_SOURCES = ("note", "review", "hatena")
_RELAY_WINDOW = timedelta(days=3)
_RELAY_TITLE_MIN = 12
# A relay prints the outlet it took an article from after the headline, and a listing
# counts the pictures it carries, so the same piece arrives under several spellings.
_OUTLET_SUFFIX = re.compile(r"\s*[(（][^()（）]{1,40}[)）]\s*$")
_PHOTO_SUFFIX = re.compile(r"\s*(?:\d+枚目)?の?写真・画像\s*$")
_DROPPED_CHARS = re.compile(r"[^\w]+", re.UNICODE)


def normalise_title(title: str) -> str:
    """A headline reduced to what two relays of the same article have in common."""
    text = unicodedata.normalize("NFKC", title or "").lower()
    for _ in range(3):
        trimmed = _PHOTO_SUFFIX.sub("", text)
        trimmed = _OUTLET_SUFFIX.sub("", trimmed)
        if trimmed == text or not trimmed:
            break
        text = trimmed
    return _DROPPED_CHARS.sub(" ", text).strip()

# A catalogue addition can predate the next dump by a day; two days keeps a fresh entry
# from being judged missing before the dump has had a chance to include it.
RECONCILE_GRACE = timedelta(days=2)

# The only cache path shape the reconcile will touch. Anything else is left alone.
_COVER_PATH = re.compile(r"^https://t\.vndb\.org/(cv/\d{2}/\d+)\.jpg$")
_VARIANT_SUFFIXES = (".jpg", ".webp", "-w20.webp", "-w128.webp", "-w256.webp", "-w512.webp")

# A dump import that produced far fewer titles than the catalogue holds has not finished;
# reconciling against it would delete everything.
_MIN_CATALOGUE_ROWS = 10_000


async def _is_known(db: AsyncSession, draft: NewsDraft) -> bool:
    key = tracker_key(draft)
    seen = await db.scalar(
        select(
            exists().where(
                PostedItemsTracker.source == draft.source,
                PostedItemsTracker.item_id == key,
            )
        )
    )
    if seen:
        return True
    return bool(await db.scalar(select(exists().where(NewsItem.id == draft.item_id))))


async def _repeats_known_link(db: AsyncSession, draft: NewsDraft) -> bool:
    """Whether a post's links point at an item already in the feed under its own address."""
    links = [u for u in (draft.extra.get("expanded_urls") or []) if isinstance(u, str)]
    if not links:
        return False
    return bool(await db.scalar(select(exists().where(NewsItem.url.in_(links[:5])))))


async def _repeats_known_url(db: AsyncSession, draft: NewsDraft) -> bool:
    """Whether the same address is already filed, under any source."""
    if draft.source not in _URL_UNIQUE_SOURCES or not draft.url:
        return False
    return bool(await db.scalar(select(exists().where(NewsItem.url == draft.url[:500]))))


async def unknown_keys(db: AsyncSession, source: str, keys: list[str]) -> list[str]:
    """The keys of `source` not yet filed, in the order given."""
    if not keys:
        return []
    seen = set(
        (
            await db.execute(
                select(PostedItemsTracker.item_id).where(
                    PostedItemsTracker.source == source,
                    PostedItemsTracker.item_id.in_(keys),
                )
            )
        ).scalars()
    )
    return [k for k in keys if k not in seen]


async def _repeats_known_title(db: AsyncSession, draft: NewsDraft) -> bool:
    """Whether the same article was filed in the last few days under another spelling."""
    if draft.source not in _RELAY_SOURCES or len(draft.title) < _RELAY_TITLE_MIN:
        return False
    key = normalise_title(draft.title)
    if not key:
        return False
    since = draft.published_at - _RELAY_WINDOW
    filed = await db.execute(
        select(NewsItem.title).where(
            NewsItem.published_at >= since, NewsItem.id != draft.item_id
        )
    )
    return any(normalise_title(t) == key for t in filed.scalars() if t)


async def save_drafts(
    db: AsyncSession,
    drafts: list[NewsDraft],
    *,
    cap: int | None = None,
    refresh_existing: bool = False,
) -> int:
    """Insert what is new, in the order given, up to `cap`.

    With `refresh_existing`, a draft that already has a row updates that row's extra data
    and stamps `last_seen`, which is how a listing that repeats while it is current (a sale)
    stays distinguishable from one that has ended.
    """
    saved = 0
    now = datetime.now(timezone.utc)
    # Two feeds from one outlet can carry the same entry, and two relays the same article
    # under different addresses; the first copy wins.
    seen_ids: set[str] = set()
    seen_titles: set[str] = set()
    for draft in drafts:
        if cap is not None and saved >= cap:
            break
        if draft.item_id in seen_ids:
            continue
        seen_ids.add(draft.item_id)
        if draft.source in _RELAY_SOURCES and len(draft.title) >= _RELAY_TITLE_MIN:
            if draft.title in seen_titles:
                continue
            seen_titles.add(draft.title)
        if (
            await _is_known(db, draft)
            or await _repeats_known_link(db, draft)
            or await _repeats_known_url(db, draft)
            or await _repeats_known_title(db, draft)
        ):
            if refresh_existing:
                row = await db.get(NewsItem, draft.item_id)
                if row is not None:
                    merged = dict(row.extra_data or {})
                    merged.update(draft.extra)
                    merged["last_seen"] = now.isoformat()
                    row.extra_data = merged
            continue
        extra = dict(draft.extra)
        if draft.vn_id:
            extra.setdefault("vn_id", draft.vn_id)
        if refresh_existing:
            extra["last_seen"] = now.isoformat()
        db.add(
            NewsItem(
                id=draft.item_id,
                source=draft.source,
                source_label=draft.source_label[:100],
                title=draft.title[:500],
                summary=draft.summary[:2000] if draft.summary else None,
                url=draft.url[:500] if draft.url else None,
                image_url=draft.image_url[:500] if draft.image_url else None,
                image_is_nsfw=draft.image_is_nsfw,
                published_at=draft.published_at,
                fetched_at=now,
                tags=draft.tags,
                extra_data=extra,
                vn_id=draft.vn_id,
            )
        )
        db.add(PostedItemsTracker(source=draft.source, item_id=tracker_key(draft), posted_at=now))
        saved += 1
    await db.commit()
    return saved


async def cleanup_old_items(db: AsyncSession) -> None:
    cutoff = datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS)
    await db.execute(delete(PostedItemsTracker).where(PostedItemsTracker.posted_at < cutoff))
    await db.execute(delete(NewsItem).where(NewsItem.published_at < cutoff))
    await db.commit()


@dataclass
class ReconcileResult:
    rows_deleted: int = 0
    files_deleted: int = 0
    skipped: bool = False


def _cover_stem(image_url: str | None) -> str | None:
    if not image_url:
        return None
    m = _COVER_PATH.match(image_url)
    return m.group(1) if m else None


async def reconcile_deleted_vns(db: AsyncSession, cache_dir: Path | None) -> ReconcileResult:
    """Drop VN-bound rows whose VN is gone from the dump, and their cached cover files.

    A cover is removed only when no remaining row still points at it, and only from the
    `cv/` tree of the cache, by the validated path the URL maps to.
    """
    result = ReconcileResult()
    catalogue_rows = await db.scalar(select(func.count()).select_from(VisualNovel)) or 0
    if catalogue_rows < _MIN_CATALOGUE_ROWS:
        logger.warning("Reconcile skipped: catalogue has %d rows", catalogue_rows)
        result.skipped = True
        return result

    cutoff = datetime.now(timezone.utc) - RECONCILE_GRACE
    gone = (
        select(NewsItem)
        .outerjoin(VisualNovel, VisualNovel.id == NewsItem.vn_id)
        .where(
            NewsItem.source.in_(VN_BOUND_SOURCES),
            NewsItem.vn_id.isnot(None),
            NewsItem.published_at < cutoff,
            VisualNovel.id.is_(None),
        )
    )
    rows = list((await db.execute(gone)).scalars().all())
    if not rows:
        return result

    stems = {s for s in (_cover_stem(r.image_url) for r in rows) if s}
    ids = [r.id for r in rows]
    for r in rows:
        # A tracker row holds either the full item id or the bare key; both shapes are cleared.
        await db.execute(
            delete(PostedItemsTracker).where(
                PostedItemsTracker.source == r.source,
                PostedItemsTracker.item_id.in_([r.id, r.id[len(r.source) + 1 :]]),
            )
        )
    await db.execute(delete(NewsItem).where(NewsItem.id.in_(ids)))
    await db.commit()
    result.rows_deleted = len(ids)

    if stems:
        still_used = await db.execute(
            select(NewsItem.image_url).where(
                NewsItem.image_url.in_([f"https://t.vndb.org/{s}.jpg" for s in stems])
            )
        )
        for url in still_used.scalars().all():
            stems.discard(_cover_stem(url))

    if cache_dir is None:
        logger.info("Reconcile: %d rows removed, cover cache not mounted", len(ids))
        return result
    root = Path(cache_dir).resolve()
    for stem in stems:
        for suffix in _VARIANT_SUFFIXES:
            path = (root / (stem + suffix)).resolve()
            if root not in path.parents:
                continue
            try:
                path.unlink()
                result.files_deleted += 1
            except FileNotFoundError:
                continue
            except OSError as e:
                logger.warning("Reconcile: could not remove %s: %s", path, e)
    logger.info(
        "Reconcile: %d rows and %d files removed", result.rows_deleted, result.files_deleted
    )
    return result
