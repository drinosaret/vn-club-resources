"""Newly catalogued entries and the day's releases, from the VNDB API.

The rest of the backend reads the daily dump; this is the one place the live API is right,
because both questions are about the last day or two and the dump is that far behind.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

import aiohttp
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.cache import get_cache
from app.db.models import NewsItem
from app.services.news import store
from app.services.news.drafts import NewsDraft
from app.services.news.sections import OUT_NOW_WINDOW
from app.services.news.text import clean_html

logger = logging.getLogger(__name__)

VN_API = "https://api.vndb.org/kana/vn"
RELEASE_API = "https://api.vndb.org/kana/release"
FETCH_LIMIT = 50
MAX_NEW_PER_DAY = 5
# A cover the catalogue itself rates this high is not shown without a click.
NSFW_SEXUAL_THRESHOLD = 0.99
NEW_VNS_HOUR = 10
RELEASES_HOUR = 16
CATALOGUE_LABEL = "Recently Added to VNDB"
RELEASE_LABEL = "VN Releases"
# Pages of releases read per run; the window never needs this many.
RELEASE_PAGES = 10
RELEASE_RUN_KEY = "news:vndb_release:ran"
RELEASE_RUN_TTL = 2 * 24 * 3600


def _developer_names(developers: list[dict] | None, *, original: bool = False) -> list[str]:
    """Developer names in one script, romanised or as written, in the order given.

    An entry without an original name keeps its romanised one, so the two lists line up.
    """
    entries = [d for d in developers or [] if d.get("name")]
    if original:
        return [d.get("original") or d["name"] for d in entries]
    return [d["name"] for d in entries]


def _content_tags(tags: list[dict], limit: int = 5) -> list[str]:
    """Top content tags, leaving out the sexual category."""
    content = [t for t in tags if t.get("category") != "ero"]
    ranked = sorted(content, key=lambda t: t.get("rating", 0), reverse=True)
    return [t["name"] for t in ranked[:limit] if t.get("name")]


def _cover(image: dict | None) -> tuple[str | None, bool]:
    if not image:
        return None, False
    sexual = image.get("sexual")
    return image.get("url"), bool(sexual is not None and sexual >= NSFW_SEXUAL_THRESHOLD)


async def _count_today(db: AsyncSession, source: str, now: datetime) -> int:
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    return (
        await db.scalar(
            select(func.count())
            .select_from(NewsItem)
            .where(NewsItem.source == source, NewsItem.published_at >= start)
        )
        or 0
    )


def draft_new_vn(vn: dict[str, Any], now: datetime) -> NewsDraft:
    vn_id = vn["id"]
    cover_url, cover_nsfw = _cover(vn.get("image"))
    return NewsDraft(
        source="vndb",
        source_label=CATALOGUE_LABEL,
        key=vn_id,
        title=vn.get("title") or vn.get("alttitle") or "Unknown",
        summary=clean_html(vn.get("description") or "")[:500] or None,
        url=f"https://vndb.org/{vn_id}",
        image_url=cover_url,
        image_is_nsfw=cover_nsfw,
        published_at=now,
        tags=_content_tags(vn.get("tags") or []) or None,
        vn_id=vn_id,
        extra={
            "vn_id": vn_id,
            "alttitle": vn.get("alttitle"),
            "developers": _developer_names(vn.get("developers")),
            "developers_original": _developer_names(vn.get("developers"), original=True),
            "platforms": vn.get("platforms") or [],
            "languages": vn.get("languages") or [],
            "released": vn.get("released"),
        },
    )


async def fetch_and_save_new_vns(session: aiohttp.ClientSession, db: AsyncSession) -> int:
    """Newest Japanese-original entries, up to the day's cap."""
    now = datetime.now(timezone.utc)
    remaining = MAX_NEW_PER_DAY - await _count_today(db, "vndb", now)
    if remaining <= 0:
        return 0
    query = {
        "filters": ["olang", "=", "ja"],
        "fields": (
            "id,title,alttitle,description,released,languages,platforms,image.url,"
            "image.sexual,image.violence,developers.name,developers.original,tags.name,tags.rating,tags.category"
        ),
        "sort": "id",
        "reverse": True,
        "results": FETCH_LIMIT,
        "page": 1,
    }
    async with session.post(VN_API, json=query) as resp:
        if resp.status != 200:
            logger.error("VNDB API error: %s", resp.status)
            return 0
        data = await resp.json()
    drafts = [draft_new_vn(vn, now) for vn in data.get("results") or [] if vn.get("id")]
    return await store.save_drafts(db, drafts, cap=remaining)


def _group_releases(releases: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    groups: dict[str, dict[str, Any]] = {}
    for release in releases:
        vns = release.get("vns") or []
        if not vns or not vns[0].get("id"):
            continue
        vn = vns[0]
        vn_id = vn["id"]
        if vn_id not in groups:
            cover_url, cover_nsfw = _cover(vn.get("image"))
            groups[vn_id] = {
                "vn_id": vn_id,
                "title": vn.get("title") or vn.get("alttitle") or release.get("title"),
                "alttitle": vn.get("alttitle"),
                "cover_url": cover_url,
                "cover_is_nsfw": cover_nsfw,
                "vn_released": vn.get("released"),
                "developers": _developer_names(vn.get("developers")),
                "developers_original": _developer_names(vn.get("developers"), original=True),
                "vn_tags": _content_tags(vn.get("tags") or []),
                "releases": [],
                "platforms": [],
            }
        group = groups[vn_id]
        group["releases"].append(
            {
                "id": release.get("id"),
                "title": release.get("title"),
                "alttitle": release.get("alttitle"),
                "platforms": release.get("platforms") or [],
            }
        )
        for platform in release.get("platforms") or []:
            if platform not in group["platforms"]:
                group["platforms"].append(platform)
    return groups


def draft_release(group: dict[str, Any], day: datetime) -> NewsDraft:
    vn_id = group["vn_id"]
    date_str = day.strftime("%Y-%m-%d")
    platforms = group["platforms"]
    titles = [r.get("title") or "" for r in group["releases"][:3]]
    summary = " | ".join(t for t in titles if t) or f"Released on {', '.join(platforms[:3])}"
    return NewsDraft(
        source="vndb_release",
        source_label=RELEASE_LABEL,
        key=f"{vn_id}-{date_str}",
        title=group["title"] or "Unknown",
        summary=summary[:500],
        url=f"https://vndb.org/{vn_id}",
        image_url=group["cover_url"],
        image_is_nsfw=group["cover_is_nsfw"],
        published_at=day,
        tags=platforms[:5] or None,
        vn_id=vn_id,
        extra={
            "vn_id": vn_id,
            "alttitle": group["alttitle"],
            "developers": group["developers"],
            "developers_original": group.get("developers_original") or group["developers"],
            "platforms": platforms,
            "releases": group["releases"],
            "released": date_str,
            "vn_released": group.get("vn_released"),
            "vn_tags": group["vn_tags"],
        },
    )


def _by_day(releases: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    """Releases bucketed by the day they carry. A partial date names no day and is left out."""
    days: dict[str, list[dict[str, Any]]] = {}
    for release in releases:
        day = release.get("released")
        if isinstance(day, str) and len(day) == 10:
            days.setdefault(day, []).append(release)
    return days


async def fetch_and_save_releases(session: aiohttp.ClientSession, db: AsyncSession) -> int:
    """Japanese releases over the out-now window through tomorrow, one row per VN per day.

    The whole window is read on every run and rows already filed are skipped by the store,
    so a run that was missed leaves no gap.
    """
    now = datetime.now(timezone.utc)
    first = (now - OUT_NOW_WINDOW).strftime("%Y-%m-%d")
    last = (now + timedelta(days=1)).strftime("%Y-%m-%d")
    releases: list[dict[str, Any]] = []
    for page in range(1, RELEASE_PAGES + 1):
        query = {
            "filters": [
                "and",
                ["released", ">=", first],
                ["released", "<=", last],
                ["vn", "=", ["olang", "=", "ja"]],
                ["lang", "=", "ja"],
            ],
            "fields": (
                "id,title,alttitle,released,minage,platforms,vns.id,vns.title,vns.alttitle,"
                "vns.released,vns.developers.name,vns.developers.original,vns.image.url,vns.image.sexual,vns.tags.name,"
                "vns.tags.rating,vns.tags.category"
            ),
            "sort": "released",
            "reverse": False,
            "results": 100,
            "page": page,
        }
        async with session.post(RELEASE_API, json=query) as resp:
            if resp.status != 200:
                logger.error("VNDB release API error: %s", resp.status)
                return 0
            data = await resp.json()
        releases.extend(data.get("results") or [])
        if not data.get("more"):
            break
    saved = 0
    for day_str, batch in _by_day(releases).items():
        day = datetime.strptime(day_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        drafts = [draft_release(g, day) for g in _group_releases(batch).values()]
        saved += await store.save_drafts(db, drafts)
    await get_cache().set(RELEASE_RUN_KEY, now.strftime("%Y-%m-%d"), ttl=RELEASE_RUN_TTL)
    return saved

async def catch_up_today(
    session: aiohttp.ClientSession, db: AsyncSession, now: datetime
) -> dict[str, int]:
    """Fetch whichever of today's two VNDB jobs has come due and left nothing behind.

    Runs on a schedule and at startup. New entries are filled in for today only, so an
    outage never replays a week of catalogue additions at once; releases read their whole
    window, and the day's run is marked in the cache since a day with no release leaves
    no row to count.
    """
    results = {"vndb": 0, "vndb_release": 0}
    if now.hour >= NEW_VNS_HOUR and not await _count_today(db, "vndb", now):
        results["vndb"] = await fetch_and_save_new_vns(session, db)
    if now.hour >= RELEASES_HOUR and await get_cache().get(RELEASE_RUN_KEY) != now.strftime("%Y-%m-%d"):
        results["vndb_release"] = await fetch_and_save_releases(session, db)
    return results
