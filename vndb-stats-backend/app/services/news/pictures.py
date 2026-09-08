"""A picture for a row whose feed carried none.

Feeds that publish only words leave the row without an image, while the page behind the
row's address usually names a social preview picture. That page is read once and what it
names is stored. The outcome is recorded on the row either way, so a page that names
nothing is never read a second time.

Two kinds of address are passed by without a fetch: a search relay, which has no page of
its own, and a post on a service whose page is assembled by scripts. A post that links out
is read at the address it links to instead.
"""

from __future__ import annotations

import asyncio
import html
import json
import logging
import re
from datetime import datetime, timedelta, timezone
from urllib.parse import urljoin, urlparse

import aiohttp
from sqlalchemy import cast, func, literal, or_, select, update
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import NewsItem, VisualNovel
from app.services.news.text import decode_page, public_web_url, read_public_page
from app.services.news.adapters.fxtwitter import USER_AGENT as X_USER_AGENT
from app.services.news.matching import developer_names
from app.services.news.sources import CREATOR_ACCOUNTS, X_ACCOUNTS

logger = logging.getLogger(__name__)

# Sources whose rows carry an outside address worth reading. Catalogue and storefront rows
# already arrive with a cover.
PICTURE_SOURCES = ("rss", "note", "hatena", "review", "creator", "twitter", "bluesky", "forum")
# Sources whose rows are posts rather than pages of their own.
POST_SOURCES = ("creator", "twitter", "bluesky")
# Only the recent end of the feed is worth a page read.
WINDOW = timedelta(days=3)
# One page at a time, spaced, so a run is not a burst at any one host.
FETCH_PAUSE = 0.5
PAGE_TIMEOUT = aiohttp.ClientTimeout(total=10)
# How far back rows are checked for a developer name missing in either script.
DEVELOPER_WINDOW = timedelta(days=30)
# A catalogue rating at or above this is shown behind the site's blur.
NSFW_SEXUAL_THRESHOLD = 1

# Hosts that relay an article under their own address without publishing a page for it.
_RELAY_HOSTS = {"news.google.com"}
# Hosts whose post pages are assembled by scripts, so the served markup names no picture.
_SCRIPTED_HOSTS = {"x.com", "twitter.com", "bsky.app"}

# A relayed post points at the post it relays. That one is read through the same public
# API the timelines come from, which answers where the page itself would not.
_STATUS_URL = re.compile(r"^https?://(?:www\.)?(?:x|twitter)\.com/[^/]+/status/(\d+)")
STATUS_API = "https://api.fxtwitter.com/status/{id}"
# Accounts the registry marks as posting adult art; a picture taken from one is blurred.
_ADULT_HANDLES = frozenset(
    a.handle.lower() for a in X_ACCOUNTS + CREATOR_ACCOUNTS if a.nsfw_images
)

_IMAGE_KEYS = ("og:image", "og:image:secure_url", "twitter:image")
# The naming attribute and the value sit in either order, either may be quoted with single
# or double quotes, and a page may carry framework attributes on the same tag, so anything
# but the tag's own end is allowed between them.
_QUOTED_KEY = r'(?:property|name)=(?P<{q}>["\'])%s(?P={q})'
_QUOTED_VALUE = r'content=(?P<{q}>["\'])(?P<content>[^>]*?)(?P={q})'
_META = {
    key: re.compile(
        r"<meta[^>]*?"
        + _QUOTED_KEY.format(q="kq") % re.escape(key)
        + r"[^>]*?"
        + _QUOTED_VALUE.format(q="vq"),
        re.I,
    )
    for key in _IMAGE_KEYS
}
_META_REV = {
    key: re.compile(
        r"<meta[^>]*?"
        + _QUOTED_VALUE.format(q="vq")
        + r"[^>]*?"
        + _QUOTED_KEY.format(q="kq") % re.escape(key),
        re.I,
    )
    for key in _IMAGE_KEYS
}

_EMPTY_JSON = cast(literal("{}"), JSONB)
_EMPTY_ARRAY = cast(literal("[]"), JSONB)
_CHECKED = cast(literal('{"picture_checked": true}'), JSONB)


def _host(url: str) -> str:
    host = (urlparse(url).hostname or "").lower()
    return host[4:] if host.startswith("www.") else host


def _readable_page(url: object) -> bool:
    """Whether an address is worth opening for a preview picture."""
    if not isinstance(url, str) or not url.strip():
        return False
    parsed = urlparse(url.strip())
    if not public_web_url(url):
        return False
    host = _host(url.strip())
    return host not in _RELAY_HOSTS and host not in _SCRIPTED_HOSTS


def candidate_url(url: str | None, expanded_urls: object) -> str | None:
    """The address to read for a row, or None when the row has none worth reading.

    A post that carries a link is read at the linked article rather than at the post. A
    relayed row is passed over entirely: what it carries alongside its address is the
    outlet's own site, whose picture describes the outlet rather than the article.
    """
    if isinstance(url, str) and _host(url.strip()) in _RELAY_HOSTS:
        return None
    links = expanded_urls if isinstance(expanded_urls, list) else []
    first = next((u for u in links if isinstance(u, str) and u.strip()), None)
    for value in (first, url):
        if _readable_page(value):
            return value.strip()
    return None


def _clean_image_url(raw: str, base_url: str) -> str | None:
    value = html.unescape(raw).strip()
    if not value or value.lower().startswith("data:"):
        return None
    resolved = urljoin(base_url, value)
    parsed = urlparse(resolved)
    if not public_web_url(resolved):
        return None
    if parsed.path.lower().endswith(".svg"):
        return None
    return resolved[:500]


def parse_page_image(page: str, base_url: str) -> str | None:
    """The preview picture a page names, as an absolute address."""
    for key in _IMAGE_KEYS:
        for pattern in (_META[key], _META_REV[key]):
            for m in pattern.finditer(page):
                cleaned = _clean_image_url(m.group("content"), base_url)
                if cleaned:
                    return cleaned
    return None


def status_id(url: object) -> str | None:
    """The post id an address names, when it names one."""
    if not isinstance(url, str):
        return None
    m = _STATUS_URL.match(url.strip())
    return m.group(1) if m else None


def first_status_id(links) -> str | None:
    for link in links or []:
        found = status_id(link)
        if found:
            return found
    return None


def tweet_image(payload: dict) -> tuple[str | None, str | None]:
    """The picture a post carries and the account that posted it.

    A photo comes first, then a video's still. A card names only its kind in the public
    shape, so a picture is taken from one only where the shape carries one.
    """
    tweet = (payload or {}).get("tweet") or {}
    media = tweet.get("media") or {}
    author = ((tweet.get("author") or {}).get("screen_name") or "").lower() or None
    for photo in media.get("photos") or media.get("all") or []:
        if photo.get("type", "photo") == "photo" and photo.get("url"):
            return _clean_image_url(photo["url"], ""), author
    for video in media.get("videos") or []:
        if video.get("thumbnail_url"):
            return _clean_image_url(video["thumbnail_url"], ""), author
    card = tweet.get("twitter_card")
    if isinstance(card, dict):
        for key in ("image", "image_url", "thumbnail_url"):
            if card.get(key):
                return _clean_image_url(card[key], ""), author
    return None, author


async def fetch_tweet_image(
    session: aiohttp.ClientSession, tweet_id: str
) -> tuple[str | None, str | None]:
    try:
        async with session.get(
            STATUS_API.format(id=tweet_id),
            headers={"User-Agent": X_USER_AGENT},
            timeout=PAGE_TIMEOUT,
        ) as resp:
            if resp.status != 200:
                return None, None
            payload = await resp.json(content_type=None)
    except Exception as e:  # noqa: BLE001
        logger.debug("post lookup failed for %s: %s", tweet_id, e)
        return None, None
    return tweet_image(payload)


async def fetch_page_image(session: aiohttp.ClientSession, url: str) -> str | None:
    try:
        got = await read_public_page(session, url, timeout=PAGE_TIMEOUT)
    except Exception as e:  # noqa: BLE001
        logger.debug("picture lookup failed for %s: %s", url, e)
        return None
    if got is None:
        return None
    raw, final_url = got
    return parse_page_image(decode_page(raw), final_url)


async def _fill_from_catalogue(db: AsyncSession, since: datetime) -> int:
    """Rows tied to a catalogue entry take that entry's cover."""
    stmt = (
        update(NewsItem)
        .where(
            NewsItem.vn_id.isnot(None),
            NewsItem.image_url.is_(None),
            NewsItem.published_at >= since,
            VisualNovel.id == NewsItem.vn_id,
            VisualNovel.image_url.isnot(None),
        )
        .values(
            image_url=VisualNovel.image_url,
            image_is_nsfw=func.coalesce(VisualNovel.image_sexual, 0) >= NSFW_SEXUAL_THRESHOLD,
        )
        .execution_options(synchronize_session=False)
    )
    result = await db.execute(stmt)
    await db.commit()
    return result.rowcount or 0


async def _mark_checked(
    db: AsyncSession, item_id: str, image_url: str | None, *, nsfw: bool | None = None
) -> None:
    """Record the outcome on the row, keeping the rest of its bag."""
    values: dict = {
        "extra_data": func.coalesce(NewsItem.extra_data, _EMPTY_JSON).op("||")(_CHECKED)
    }
    if image_url:
        values["image_url"] = image_url
    if nsfw is not None:
        values["image_is_nsfw"] = nsfw
    await db.execute(
        update(NewsItem)
        .where(NewsItem.id == item_id)
        .values(**values)
        .execution_options(synchronize_session=False)
    )
    await db.commit()


async def fill_missing_pictures(
    session: aiohttp.ClientSession, db: AsyncSession, *, limit: int = 40
) -> int:
    """Give recent imageless rows a picture. Returns how many rows gained one."""
    since = datetime.now(timezone.utc) - WINDOW
    filled = await _fill_from_catalogue(db, since)

    candidates = (
        await db.execute(
            select(NewsItem.id, NewsItem.url, NewsItem.extra_data)
            .where(
                NewsItem.image_url.is_(None),
                NewsItem.url.isnot(None),
                NewsItem.is_hidden == False,  # noqa: E712
                NewsItem.published_at >= since,
                NewsItem.source.in_(PICTURE_SOURCES),
                NewsItem.extra_data["picture_checked"].astext.is_(None),
                # A post that links to nothing has no page of its own to read.
                or_(
                    NewsItem.source.notin_(POST_SOURCES),
                    func.jsonb_array_length(
                        func.coalesce(NewsItem.extra_data["expanded_urls"], _EMPTY_ARRAY)
                    )
                    > 0,
                ),
            )
            .order_by(NewsItem.published_at.desc())
            .limit(limit)
        )
    ).all()

    fetched = 0
    for item_id, url, extra in candidates:
        links = (extra or {}).get("expanded_urls")
        image_url = None
        nsfw = None
        # A relayed post carries the picture of the post it points at.
        tweet_id = first_status_id(links if isinstance(links, list) else [])
        if tweet_id:
            if fetched:
                await asyncio.sleep(FETCH_PAUSE)
            fetched += 1
            image_url, author = await fetch_tweet_image(session, tweet_id)
            if image_url and author in _ADULT_HANDLES:
                nsfw = True
        target = candidate_url(url, links)
        if not image_url and target:
            if fetched:
                await asyncio.sleep(FETCH_PAUSE)
            fetched += 1
            image_url = await fetch_page_image(session, target)
        try:
            await _mark_checked(db, item_id, image_url, nsfw=nsfw)
        except Exception as e:  # noqa: BLE001
            logger.warning("Could not record picture check for %s: %s", item_id, e)
            await db.rollback()
            continue
        if image_url:
            filled += 1
    return filled


async def fill_developer_scripts(db: AsyncSession, *, limit: int = 200) -> int:
    """Give VN-bound rows their developers in both scripts. Returns how many gained them.

    A title the catalogue credits to nobody is still marked, with an empty list, so the
    row is not looked at again.
    """
    since = datetime.now(timezone.utc) - DEVELOPER_WINDOW
    rows = (
        await db.execute(
            select(NewsItem.id, NewsItem.vn_id)
            .where(
                NewsItem.vn_id.isnot(None),
                NewsItem.published_at >= since,
                NewsItem.extra_data["developers_original"].is_(None),
            )
            .order_by(NewsItem.published_at.desc())
            .limit(limit)
        )
    ).all()

    rewritten = 0
    known: dict[str, tuple[list[str], list[str]]] = {}
    for item_id, vn_id in rows:
        if vn_id not in known:
            known[vn_id] = await developer_names(db, vn_id)
        developers, original = known[vn_id]
        payload = (
            {"developers": developers, "developers_original": original}
            if original
            else {"developers_original": []}
        )
        merged = func.coalesce(NewsItem.extra_data, _EMPTY_JSON).op("||")(
            cast(literal(json.dumps(payload, ensure_ascii=False)), JSONB)
        )
        await db.execute(
            update(NewsItem)
            .where(NewsItem.id == item_id)
            .values(extra_data=merged)
            .execution_options(synchronize_session=False)
        )
        if original:
            rewritten += 1
    await db.commit()
    return rewritten
