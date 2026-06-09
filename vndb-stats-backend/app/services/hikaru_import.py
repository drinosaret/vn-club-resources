"""Import VNCR's VN-of-the-month/season winners from hikaru's SQLite into events.

Same-server, read-only: the worker mounts hikaru's data dir and this reads the
winners directly (no HTTP, no API key), upserts them into the events table, and
prunes winners hikaru no longer has. Enabled by mounting hikaru's data (the DB
path must exist); the source guild defaults to DISCORD_GUILD_ID, with
VNCR_GUILD_ID as an optional override.
"""

import asyncio
import logging
import os
import sqlite3
from datetime import datetime, timedelta, timezone

from app.config import get_settings
from app.db.database import async_session_maker
from app.services import events_service

logger = logging.getLogger(__name__)

_STATUS_TO_TYPE = {"monthly": "vn_of_month", "seasonal": "vn_of_season"}
_STATUS_LABEL = {"monthly": "VN of the Month", "seasonal": "VN of the Season"}

# Reads hikaru's pool; vndb_cache supplies title + cover (joined on vndb_id).
_QUERY = """
    SELECT t.vndb_id, t.start_month, t.end_month, t.status, t.title_cache,
           c.title_ja, c.title_en, c.thumbnail_url, c.thumbnail_is_nsfw
    FROM vn_titles t
    LEFT JOIN vndb_cache c ON c.vndb_id = t.vndb_id
    WHERE t.guild_id = ? AND t.status IN ('monthly', 'seasonal')
"""


def is_enabled() -> bool:
    s = get_settings()
    # The mount is the opt-in: a real hikaru DB at the path enables it. The source
    # guild defaults to DISCORD_GUILD_ID, so no separate guild var is needed.
    return bool(s.hikaru_db_path) and os.path.exists(s.hikaru_db_path) and bool(s.hikaru_source_guild_id)


def _month_bounds(start_ym: str, end_ym: str) -> tuple[datetime, datetime]:
    """All-day UTC range from 'YYYY-MM' start/end (end is the last minute)."""
    sy, sm = (int(x) for x in start_ym.split("-"))
    ey, em = (int(x) for x in end_ym.split("-"))
    start_at = datetime(sy, sm, 1, tzinfo=timezone.utc)
    nxt = (
        datetime(ey + 1, 1, 1, tzinfo=timezone.utc)
        if em == 12
        else datetime(ey, em + 1, 1, tzinfo=timezone.utc)
    )
    return start_at, nxt - timedelta(minutes=1)


def _read_winners(path: str, guild_id: int) -> list[tuple]:
    # Read-only: never modifies hikaru's database.
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        return con.execute(_QUERY, (guild_id,)).fetchall()
    finally:
        con.close()


async def run_import() -> dict:
    """Mirror the configured guild's month/season winners into the calendar.

    Best-effort and idempotent: upsert by a stable external_key, then prune any
    hikaru-sourced events whose winner row is gone. VN-linked rows store vndb_id
    so the API composes the internal /vn/<id> link itself.
    """
    s = get_settings()
    if not is_enabled():
        logger.info("Hikaru import disabled (mount hikaru data via HIKARU_DATA_DIR; needs DISCORD_GUILD_ID or VNCR_GUILD_ID)")
        return {"enabled": False}

    guild_id = int(s.hikaru_source_guild_id)
    try:
        rows = await asyncio.to_thread(_read_winners, s.hikaru_db_path, guild_id)
    except Exception:
        logger.exception("Hikaru import: failed reading %s", s.hikaru_db_path)
        return {"enabled": True, "error": "read_failed"}

    lanes: dict[str, set[str]] = {"monthly": set(), "seasonal": set()}
    upserted = 0
    async with async_session_maker() as db:
        for vndb_id, start_m, end_m, status, title_cache, title_ja, title_en, thumb, is_nsfw in rows:
            if not start_m or not end_m or status not in _STATUS_TO_TYPE:
                continue
            start_at, end_at = _month_bounds(start_m, end_m)
            label = _STATUS_LABEL[status]
            # Default title is romaji/latin (matches the site's default title pref);
            # the JP variant rides in extra_data so the page can switch on the toggle.
            romaji = title_en or title_cache or title_ja or vndb_id
            full = f"{label}: {romaji}"
            extra = {"vndb_id": vndb_id, "title_romaji": full}
            if title_ja:
                extra["title_jp"] = f"{label}: {title_ja}"
            # vndb_id in the key keeps multi-winner months from colliding.
            ext = f"hikaru:{status}:{guild_id}:{start_m}_{end_m}:{vndb_id}"
            await events_service.upsert_by_external_key(
                db,
                external_key=ext,
                event_type=_STATUS_TO_TYPE[status],
                title=full,
                start_at=start_at,
                end_at=end_at,
                all_day=True,
                image_url=(thumb or None) if not is_nsfw else None,  # skip NSFW covers
                created_by="hikaru",
                extra_data=extra,
            )
            lanes[status].add(ext)
            upserted += 1

        removed = 0
        for status, keys in lanes.items():
            removed += await events_service.reconcile_external(db, f"hikaru:{status}:{guild_id}:", keys)

    await events_service.invalidate_events_cache()
    logger.info("Hikaru import: upserted %d, removed %d stale", upserted, removed)
    return {"enabled": True, "upserted": upserted, "removed": removed}
