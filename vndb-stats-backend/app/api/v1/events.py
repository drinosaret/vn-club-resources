"""Events / calendar endpoints (public reads).

The calendar merges stored events (custom events written by the ichijou /events
cog, and VN month/season winners imported from hikaru) with computed recurring
events (voting windows, weekly movie night). All writes happen against the DB
directly (the ichijou cog and the hikaru import job), so there are no public
write endpoints here.
"""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.cache import get_cache
from app.db.database import get_db
from app.services import events_service as events
from app.services import recurring_events

logger = logging.getLogger(__name__)

router = APIRouter()

CACHE_TTL = 300  # 5 minutes


@router.get("")
async def list_month(
    year: int | None = Query(None, ge=1970, le=3000),
    month: int | None = Query(None, ge=1, le=12),
    db: AsyncSession = Depends(get_db),
):
    """Active events overlapping a month. Defaults to the current UTC month."""
    now = datetime.now(timezone.utc)
    year = year or now.year
    month = month or now.month

    cache = get_cache()
    cache_key = events.events_month_key(year, month)
    cached = await cache.get(cache_key)
    if cached is not None:
        return cached

    rows = await events.get_month(db, year, month)
    db_items = [events.event_to_dict(e) for e in rows]
    await events.enrich_with_covers(db, db_items)  # blur-capable covers for the site
    movie_dates = {it["start_at"][:10] for it in db_items if it["event_type"] == "movie_night"}
    items = db_items + recurring_events.for_month(year, month, skip_movie_dates=movie_dates)
    items.sort(key=lambda e: e["start_at"])
    response = {"events": items}
    await cache.set(cache_key, response, ttl=CACHE_TTL)
    return response


@router.get("/upcoming")
async def list_upcoming(
    limit: int = Query(default=20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    """Soonest upcoming active events."""
    cache = get_cache()
    cached = await cache.get(events.EVENTS_UPCOMING_KEY)
    if cached is not None:
        return cached[:limit]

    now = datetime.now(timezone.utc)
    items = await events.get_upcoming_merged(db, now)
    await events.enrich_with_covers(db, items)  # blur-capable covers for the site
    await cache.set(events.EVENTS_UPCOMING_KEY, items, ttl=CACHE_TTL)
    return items[:limit]
