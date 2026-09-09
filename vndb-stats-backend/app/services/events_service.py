"""Service for the unified club calendar (events table).

Read paths feed the public calendar; write paths are used by the admin API and
the Discord bot. Bot-pushed rows carry a stable external_key so re-pushes upsert
in place; reconcile_external() lets a source prune rows it no longer owns.
"""

import logging
import re
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, func, and_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.cache import get_cache
from app.db.models import Event, VisualNovel
from app.services import recurring_events

logger = logging.getLogger(__name__)

EVENTS_UPCOMING_KEY = "events:upcoming"

# Event types the public history listing covers: every stored row that names a pick
# the club actually made. Recurring placeholders are computed rather than stored and
# name no title, so they have no place in a history.
HISTORY_TYPES = ("vn_of_month", "vn_of_season", "roudoku", "movie_night")

# Event types that have a weekly placeholder to suppress in recurring_events.
_SESSION_TYPES = ("movie_night", "roudoku")
# A session can sit this far from its usual weekday and still own the slot, so the
# rendered window has to be searched this much wider to find one that moved past
# its edge (across a month boundary, or into yesterday on the upcoming feed).
_SLOT_PAD = timedelta(days=recurring_events.SLOT_MATCH_DAYS)
# Covers every weekly placeholder upcoming() can emit, so none of them is judged
# against a window that stops short of the session filling it.
_UPCOMING_SESSION_WINDOW = timedelta(
    days=7 * max(recurring_events.MOVIE_NIGHT_UPCOMING_COUNT, recurring_events.ROUDOKU_UPCOMING_COUNT)
) + _SLOT_PAD


def events_month_key(year: int, month: int) -> str:
    return f"events:month:{year}:{month:02d}"


def events_history_key(types: list[str], limit: int, offset: int) -> str:
    return f"events:history:{'+'.join(types)}:{limit}:{offset}"


def parse_history_types(raw: str | None) -> list[str]:
    """Comma-separated type filter for the history listing, in HISTORY_TYPES order.

    Anything outside the allowlist is dropped, and a filter that names nothing
    recognised falls back to every pick type: a listing narrowed to nothing by a
    misspelled name reads as "the club has no history", which is never true.
    """
    if not raw:
        return list(HISTORY_TYPES)
    wanted = {t.strip() for t in raw.split(",") if t.strip()}
    picked = [t for t in HISTORY_TYPES if t in wanted]
    return picked or list(HISTORY_TYPES)


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
    """Attach a blur-capable cover (`cover_url`), NSFW score (`image_sexual`) and the
    catalogue title scripts (`title_jp`, `title_romaji`, where the event has none) to
    VN-linked events from the local VN data, so the website can show NSFW covers
    blurred (click-to-reveal) like the rest of the site.

    The stored row's `image_url` is intentionally left untouched (null for NSFW),
    so JSON-LD metadata and Discord embeds, which read `image_url`, stay safe. Only
    the website's calendar reads `cover_url`. Mutates and returns `items`.
    """
    wanted: dict[str, list[dict]] = {}
    for it in items:
        if it.get("event_type") in ("vn_of_month", "vn_of_season", "roudoku"):
            m = _VN_URL_RE.match(it.get("url") or "")
            if m:
                wanted.setdefault(f"v{m.group(1)}", []).append(it)
    if not wanted:
        return items
    rows = await db.execute(
        select(
            VisualNovel.id,
            VisualNovel.image_url,
            VisualNovel.image_sexual,
            VisualNovel.title_jp,
            VisualNovel.title_romaji,
        ).where(VisualNovel.id.in_(list(wanted)))
    )
    for vid, image_url, image_sexual, title_jp, title_romaji in rows.all():
        for it in wanted.get(vid, []):
            if image_url:
                it["cover_url"] = image_url
            it["image_sexual"] = image_sexual
            # An event names its pick in one script; the catalogue supplies the other so
            # the site can show the title in the reader's preferred script.
            if not it.get("title_jp"):
                it["title_jp"] = title_jp
            if not it.get("title_romaji"):
                it["title_romaji"] = title_romaji
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


async def get_session_dates(
    db: AsyncSession, start: datetime, end: datetime
) -> tuple[set[str], set[str]]:
    """(movie_night dates, roudoku dates) as UTC ISO days in [start, end).

    Feeds recurring_events' per-type placeholder suppression. Kept separate from
    the rendered event list because the search window is deliberately wider: a
    session that moved off its weekday can sit outside the month or the feed it
    belongs to, and it still has to hide its own placeholder.
    """
    result = await db.execute(
        select(Event.event_type, Event.start_at).where(
            and_(
                Event.is_active.is_(True),
                Event.event_type.in_(_SESSION_TYPES),
                Event.start_at >= start,
                Event.start_at < end,
            )
        )
    )
    movie: set[str] = set()
    roudoku: set[str] = set()
    for event_type, start_at in result.all():
        if start_at is None:
            continue
        iso = start_at.astimezone(timezone.utc).date().isoformat()
        (movie if event_type == "movie_night" else roudoku).add(iso)
    return movie, roudoku


async def get_month_session_dates(db: AsyncSession, year: int, month: int) -> tuple[set[str], set[str]]:
    """Session dates for a month, padded so a move across either edge still counts."""
    start, end = _month_window(year, month)
    return await get_session_dates(db, start - _SLOT_PAD, end + _SLOT_PAD)


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
    movie_dates, roudoku_dates = await get_session_dates(
        db, now - _SLOT_PAD, now + _UPCOMING_SESSION_WINDOW
    )
    items = db_items + recurring_events.upcoming(
        now, skip_movie_dates=movie_dates, skip_roudoku_dates=roudoku_dates
    )
    items.sort(key=lambda e: e["start_at"])
    return items


def _months_spanned(start: datetime, end: datetime) -> list[tuple[int, int]]:
    """(year, month) pairs a window touches, in order."""
    out: list[tuple[int, int]] = []
    year, month = start.year, start.month
    while (year, month) <= (end.year, end.month):
        out.append((year, month))
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)
    return out


def _as_utc(value: str | None) -> datetime | None:
    """Read a serialized calendar timestamp back, tolerating a missing offset."""
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed


# An item that names no end (a weekly slot, a published session) is read for this
# long past its start, so a caller that assigns it a length still sees it.
OPEN_ENDED_GRACE = timedelta(days=1)


def _overlaps(item: dict, start: datetime, end: datetime) -> bool:
    item_start = _as_utc(item.get("start_at"))
    if item_start is None:
        return False
    item_end = _as_utc(item.get("end_at")) or item_start + OPEN_ENDED_GRACE
    return item_start < end and item_end >= start


async def get_window(db: AsyncSession, start: datetime, end: datetime) -> list[Event]:
    """Active events overlapping [start, end), soonest first. A row with no end
    counts as running for OPEN_ENDED_GRACE past its start."""
    result = await db.execute(
        select(Event)
        .where(
            and_(
                Event.is_active.is_(True),
                Event.start_at < end,
                func.coalesce(Event.end_at, Event.start_at + OPEN_ENDED_GRACE) >= start,
            )
        )
        .order_by(Event.start_at)
    )
    return list(result.scalars().all())


async def get_window_merged(db: AsyncSession, start: datetime, end: datetime) -> list[dict]:
    """Stored events + computed recurring ones overlapping [start, end), sorted.

    get_upcoming_merged cannot serve a window this wide: the recurring feed
    caps its weekly placeholders (MOVIE_NIGHT_UPCOMING_COUNT and
    ROUDOKU_UPCOMING_COUNT) so the site's sidebar is not filled with repeats. This walks the calendar months the window touches
    instead, so every weekly slot inside the range is present. Suppression stays
    where it already lives, in recurring_events, fed by the same padded session
    dates the month view uses.
    """
    db_items = [event_to_dict(ev) for ev in await get_window(db, start, end)]
    movie_dates, roudoku_dates = await get_session_dates(db, start - _SLOT_PAD, end + _SLOT_PAD)
    computed: list[dict] = []
    for year, month in _months_spanned(start, end):
        computed.extend(
            recurring_events.for_month(
                year,
                month,
                skip_movie_dates=movie_dates,
                skip_roudoku_dates=roudoku_dates,
            )
        )
    items = db_items + [item for item in computed if _overlaps(item, start, end)]
    items.sort(key=lambda e: e["start_at"])
    return await enrich_with_covers(db, items)


async def get_past(
    db: AsyncSession,
    now: datetime,
    types: list[str],
    limit: int = 60,
    offset: int = 0,
) -> tuple[list[Event], int]:
    """Picks whose session has already been and gone, newest first, plus the total.

    A row is past once it has started: a monthly pick is dated to the month it
    covers, so waiting for end_at would hold the current month's winner out of a
    listing that is meant to include it the moment the next one lands.
    """
    where = and_(
        Event.is_active.is_(True),
        Event.event_type.in_(types),
        Event.start_at < now,
    )
    total = await db.scalar(select(func.count()).select_from(Event).where(where))
    result = await db.execute(
        select(Event)
        .where(where)
        .order_by(Event.start_at.desc(), Event.id.desc())
        .limit(limit)
        .offset(offset)
    )
    return list(result.scalars().all()), int(total or 0)


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
    """Flush cached month, upcoming and history reads after any write."""
    cache = get_cache()
    await cache.flush_pattern("events:month:*")
    await cache.flush_pattern("events:history:*")
    await cache.delete(EVENTS_UPCOMING_KEY)
