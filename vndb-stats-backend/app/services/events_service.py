"""Service for the unified club calendar (events table).

Read paths feed the public calendar; write paths are used by the admin API and
the Discord bot. Bot-pushed rows carry a stable external_key so re-pushes upsert
in place; reconcile_external() lets a source prune rows it no longer owns.
"""

import logging
import re
from datetime import datetime, timezone

from sqlalchemy import select, func, and_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.cache import get_cache
from app.db.models import Event, VisualNovel
from app.services import recurring_events

logger = logging.getLogger(__name__)

EVENTS_UPCOMING_KEY = "events:upcoming"


def events_month_key(year: int, month: int) -> str:
    return f"events:month:{year}:{month:02d}"


def _month_window(year: int, month: int) -> tuple[datetime, datetime]:
    """UTC [start, end) bounds for a calendar month."""
    start = datetime(year, month, 1, tzinfo=timezone.utc)
    if month == 12:
        end = datetime(year + 1, 1, 1, tzinfo=timezone.utc)
    else:
        end = datetime(year, month + 1, 1, tzinfo=timezone.utc)
    return start, end


def _vn_url_from_extra(extra: dict | None) -> str | None:
    """Compose the internal /vn/<numeric>/ link from a stored vndb_id."""
    if not extra:
        return None
    vndb_id = extra.get("vndb_id") or extra.get("vndbId")
    if not vndb_id:
        return None
    numeric = str(vndb_id).lstrip("v")
    return f"/vn/{numeric}/" if numeric else None


def event_to_dict(ev: Event) -> dict:
    """Serialize an Event for the API (snake_case, matching the VOTD response)."""
    extra = ev.extra_data or {}
    return {
        "id": ev.id,
        "event_type": ev.event_type,
        "title": ev.title,
        "title_jp": extra.get("title_jp"),
        "title_romaji": extra.get("title_romaji"),
        "description": ev.description,
        "start_at": ev.start_at.isoformat() if ev.start_at else None,
        "end_at": ev.end_at.isoformat() if ev.end_at else None,
        "all_day": ev.all_day,
        "image_url": ev.image_url,
        "url": ev.url or _vn_url_from_extra(ev.extra_data),
        "location": ev.location,
        "is_active": ev.is_active,
        "external_key": ev.external_key,
        "created_by": ev.created_by,
    }


_VN_URL_RE = re.compile(r"^/vn/(\d+)/?$")


async def enrich_with_covers(db: AsyncSession, items: list[dict]) -> list[dict]:
    """Attach a blur-capable cover (`cover_url`) + NSFW score (`image_sexual`) to
    VN-linked events from the local VN data, so the website can show NSFW covers
    blurred (click-to-reveal) like the rest of the site.

    The stored row's `image_url` is intentionally left untouched (null for NSFW),
    so JSON-LD metadata and Discord embeds, which read `image_url`, stay safe. Only
    the website's calendar reads `cover_url`. Mutates and returns `items`.
    """
    wanted: dict[str, list[dict]] = {}
    for it in items:
        if it.get("event_type") in ("vn_of_month", "vn_of_season"):
            m = _VN_URL_RE.match(it.get("url") or "")
            if m:
                wanted.setdefault(f"v{m.group(1)}", []).append(it)
    if not wanted:
        return items
    rows = await db.execute(
        select(VisualNovel.id, VisualNovel.image_url, VisualNovel.image_sexual).where(
            VisualNovel.id.in_(list(wanted))
        )
    )
    for vid, image_url, image_sexual in rows.all():
        for it in wanted.get(vid, []):
            if image_url:
                it["cover_url"] = image_url
            it["image_sexual"] = image_sexual
    return items


async def get_month(db: AsyncSession, year: int, month: int) -> list[Event]:
    """Active events overlapping the given month."""
    start, end = _month_window(year, month)
    result = await db.execute(
        select(Event)
        .where(
            and_(
                Event.is_active.is_(True),
                Event.start_at < end,
                func.coalesce(Event.end_at, Event.start_at) >= start,
            )
        )
        .order_by(Event.start_at)
    )
    return list(result.scalars().all())


async def get_upcoming(db: AsyncSession, now: datetime, limit: int = 20) -> list[Event]:
    """Active events that have not yet ended, soonest first."""
    result = await db.execute(
        select(Event)
        .where(
            and_(
                Event.is_active.is_(True),
                func.coalesce(Event.end_at, Event.start_at) >= now,
            )
        )
        .order_by(Event.start_at)
        .limit(limit)
    )
    return list(result.scalars().all())


async def get_upcoming_merged(db: AsyncSession, now: datetime) -> list[dict]:
    """Stored upcoming events + computed recurring ones, deduped and sorted.

    Shared by the /events/upcoming API and the ichijou /events command so both
    show the same list. Returns serialized dicts (not sliced; callers slice).
    """
    rows = await get_upcoming(db, now, limit=100)
    db_items = [event_to_dict(e) for e in rows]
    movie_dates = {it["start_at"][:10] for it in db_items if it["event_type"] == "movie_night"}
    items = db_items + recurring_events.upcoming(now, skip_movie_dates=movie_dates)
    items.sort(key=lambda e: e["start_at"])
    return items


async def create_event(
    db: AsyncSession,
    *,
    event_type: str,
    title: str,
    start_at: datetime,
    description: str | None = None,
    end_at: datetime | None = None,
    all_day: bool = False,
    image_url: str | None = None,
    url: str | None = None,
    location: str | None = None,
    external_key: str | None = None,
    created_by: str | None = None,
    extra_data: dict | None = None,
) -> Event:
    ev = Event(
        event_type=event_type,
        title=title,
        start_at=start_at,
        description=description,
        end_at=end_at,
        all_day=all_day,
        image_url=image_url,
        url=url,
        location=location,
        external_key=external_key,
        created_by=created_by,
        extra_data=extra_data,
        is_active=True,
    )
    db.add(ev)
    await db.commit()
    await db.refresh(ev)
    return ev


async def update_event(db: AsyncSession, event_id: int, fields: dict) -> Event | None:
    """Apply only the provided fields (None-valued keys should be omitted by the caller)."""
    ev = await db.get(Event, event_id)
    if not ev:
        return None
    for key, value in fields.items():
        setattr(ev, key, value)
    await db.commit()
    await db.refresh(ev)
    return ev


async def delete_event(db: AsyncSession, event_id: int) -> bool:
    ev = await db.get(Event, event_id)
    if not ev:
        return False
    await db.delete(ev)
    await db.commit()
    return True


async def upsert_by_external_key(
    db: AsyncSession,
    *,
    external_key: str,
    event_type: str,
    title: str,
    start_at: datetime,
    description: str | None = None,
    end_at: datetime | None = None,
    all_day: bool = True,
    image_url: str | None = None,
    url: str | None = None,
    location: str | None = None,
    created_by: str | None = None,
    extra_data: dict | None = None,
) -> Event:
    """Insert or update the row identified by external_key."""
    result = await db.execute(select(Event).where(Event.external_key == external_key))
    ev = result.scalar_one_or_none()

    if ev is None:
        ev = Event(external_key=external_key)
        db.add(ev)

    ev.event_type = event_type
    ev.title = title
    ev.start_at = start_at
    ev.description = description
    ev.end_at = end_at
    ev.all_day = all_day
    ev.image_url = image_url
    ev.url = url
    ev.location = location
    if created_by:
        ev.created_by = created_by
    ev.extra_data = extra_data
    ev.is_active = True

    try:
        await db.commit()
    except IntegrityError:
        # Race: another writer inserted the same external_key first. The row is
        # guaranteed to exist now, so scalar_one() honors the Event return type.
        await db.rollback()
        result = await db.execute(select(Event).where(Event.external_key == external_key))
        return result.scalar_one()

    await db.refresh(ev)
    return ev


async def reconcile_external(db: AsyncSession, source_prefix: str, keep_keys: set[str]) -> int:
    """Delete events whose external_key starts with source_prefix and is not in keep_keys.

    Lets a publisher (e.g. hikaru) prune winners it no longer owns. source_prefix
    must be lane-scoped (e.g. "hikaru:monthly:<guild>:") so it never crosses lanes.
    """
    result = await db.execute(
        select(Event).where(Event.external_key.like(f"{source_prefix}%"))
    )
    removed = 0
    for ev in result.scalars().all():
        if ev.external_key not in keep_keys:
            await db.delete(ev)
            removed += 1
    if removed:
        await db.commit()
    return removed


async def invalidate_events_cache() -> None:
    """Flush cached month and upcoming reads after any write."""
    cache = get_cache()
    await cache.flush_pattern("events:month:*")
    await cache.delete(EVENTS_UPCOMING_KEY)
