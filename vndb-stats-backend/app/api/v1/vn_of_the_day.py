"""VN of the Day endpoint — daily spotlight feature."""

import logging
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.core.auth import require_admin
from app.core.cache import get_cache
from app.services import vn_of_the_day_service as votd

logger = logging.getLogger(__name__)

router = APIRouter()

CACHE_KEY = "vn_of_the_day:current"
CACHE_TTL = 3600  # 1 hour


class OverrideRequest(BaseModel):
    vn_id: str
    date: str | None = None  # YYYY-MM-DD, defaults to tomorrow


@router.get("")
async def get_vn_of_the_day(
    target_date: str | None = Query(None, alias="date", pattern=r"^\d{4}-\d{2}-\d{2}$"),
    db: AsyncSession = Depends(get_db),
):
    """Get VN of the Day. Defaults to today; pass ?date=YYYY-MM-DD for a specific date."""
    cache = get_cache()

    if target_date:
        try:
            parsed = date.fromisoformat(target_date)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format")
        cache_key = f"vn_of_the_day:{target_date}"
        cached = await cache.get(cache_key)
        if cached:
            return cached
        pick = await votd.get_by_date(db, parsed)
    else:
        cache_key = CACHE_KEY
        cached = await cache.get(cache_key)
        if cached:
            return cached
        pick = await votd.get_or_select(db)

    if not pick or not pick.visual_novel:
        raise HTTPException(status_code=404, detail="No VN of the Day available")

    tags = await votd.get_vn_tags(db, pick.vn_id)
    devs = await votd.get_vn_developers(db, pick.vn_id)
    response = votd.build_votd_response(pick, tags, developers=devs)

    await cache.set(cache_key, response, ttl=CACHE_TTL)
    return response


@router.get("/history")
async def get_history(
    limit: int = Query(default=30, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    """Get past VN of the Day picks."""
    picks = await votd.get_history(db, limit=limit)
    return [
        {
            "vn_id": p.visual_novel.id,
            "date": p.date.isoformat(),
            "title": p.visual_novel.title,
            "title_jp": p.visual_novel.title_jp,
            "rating": p.visual_novel.rating,
            "is_override": p.is_override or False,
        }
        for p in picks
        if p.visual_novel
    ]


@router.post("/override")
async def override_vn_of_the_day(
    body: OverrideRequest,
    admin: str = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Admin: override VN of the Day for a specific date."""
    if body.date:
        try:
            target_date = date.fromisoformat(body.date)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format (use YYYY-MM-DD)")
    else:
        target_date = date.today() + timedelta(days=1)

    pick = await votd.set_override(db, body.vn_id, target_date, admin_name="admin")
    if not pick:
        raise HTTPException(status_code=404, detail=f"VN {body.vn_id} not found")

    # Invalidate cache if overriding today
    if target_date == date.today():
        cache = get_cache()
        await cache.delete(CACHE_KEY)

    tags = await votd.get_vn_tags(db, pick.vn_id)
    devs = await votd.get_vn_developers(db, pick.vn_id)
    return votd.build_votd_response(pick, tags, developers=devs)


@router.post("/reroll")
async def reroll_vn_of_the_day(
    admin: str = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Admin: reroll today's VN of the Day."""
    pick = await votd.reroll_today(db)
    if not pick or not pick.visual_novel:
        raise HTTPException(status_code=404, detail="No eligible VN found")

    cache = get_cache()
    await cache.delete(CACHE_KEY)

    tags = await votd.get_vn_tags(db, pick.vn_id)
    devs = await votd.get_vn_developers(db, pick.vn_id)
    return votd.build_votd_response(pick, tags, developers=devs)
