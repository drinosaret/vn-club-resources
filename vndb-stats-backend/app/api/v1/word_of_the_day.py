"""Word of the Day endpoint: daily vocabulary spotlight feature."""

import logging
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.core.auth import require_admin
from app.core.cache import get_cache
from app.services import word_of_the_day_service as wotd

logger = logging.getLogger(__name__)

router = APIRouter()

CACHE_KEY = "word_of_the_day:current"
CACHE_TTL = 3600  # 1 hour


class OverrideRequest(BaseModel):
    word_id: int
    reading_index: int = 0
    date: str | None = None  # YYYY-MM-DD, defaults to tomorrow


@router.get("")
async def get_word_of_the_day(
    target_date: str | None = Query(None, alias="date", pattern=r"^\d{4}-\d{2}-\d{2}$"),
    db: AsyncSession = Depends(get_db),
):
    """Get Word of the Day. Defaults to today; pass ?date=YYYY-MM-DD for a specific date."""
    cache = get_cache()

    if target_date:
        try:
            parsed = date.fromisoformat(target_date)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format")
        cache_key = f"word_of_the_day:{target_date}"
        cached = await cache.get(cache_key)
        if cached:
            return cached
        pick = await wotd.get_by_date(db, parsed)
    else:
        cache_key = CACHE_KEY
        cached = await cache.get(cache_key)
        if cached:
            return cached
        pick = await wotd.get_or_select(db)

    if not pick:
        raise HTTPException(status_code=404, detail="No Word of the Day available")

    response = await wotd.build_wotd_response(pick, db)
    await cache.set(cache_key, response, ttl=CACHE_TTL)
    return response


@router.get("/history")
async def get_history(
    limit: int = Query(default=30, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    """Get past Word of the Day picks."""
    picks = await wotd.get_history(db, limit=limit)
    results = []
    for p in picks:
        word_info = (p.cached_data or {}).get("word_info", {})
        main_reading = word_info.get("mainReading", {})
        text = main_reading.get("text", "") if isinstance(main_reading, dict) else ""
        meanings = []
        for defn in word_info.get("definitions", [])[:1]:
            meanings = defn.get("meanings", [])[:3]
        results.append({
            "word_id": p.word_id,
            "date": p.date.isoformat(),
            "text": text,
            "meanings": meanings,
            "parts_of_speech": word_info.get("partsOfSpeech", [])[:2],
            "is_override": p.is_override or False,
        })
    return results


@router.post("/override", include_in_schema=False)
async def override_word_of_the_day(
    body: OverrideRequest,
    admin: str = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Admin: override Word of the Day for a specific date."""
    if body.date:
        try:
            target_date = date.fromisoformat(body.date)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format (use YYYY-MM-DD)")
    else:
        target_date = date.today() + timedelta(days=1)

    pick = await wotd.set_override(db, body.word_id, target_date, admin_name=admin, reading_index=body.reading_index)
    if not pick:
        raise HTTPException(status_code=404, detail=f"Failed to fetch word {body.word_id} from jiten.moe")

    cache = get_cache()
    await cache.delete(CACHE_KEY)
    await cache.delete(f"word_of_the_day:{target_date.isoformat()}")

    return await wotd.build_wotd_response(pick, db)


@router.post("/reroll", include_in_schema=False)
async def reroll_word_of_the_day(
    admin: str = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Admin: reroll today's Word of the Day."""
    pick = await wotd.reroll_today(db)
    if not pick:
        raise HTTPException(status_code=404, detail="No eligible word found")

    cache = get_cache()
    await cache.delete(CACHE_KEY)
    await cache.delete(f"word_of_the_day:{date.today().isoformat()}")

    return await wotd.build_wotd_response(pick, db)
