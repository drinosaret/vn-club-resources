"""Service for selecting and managing the daily VN of the Day spotlight."""

import logging
import re
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select, func, and_, text, delete
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.db.models import (
    VisualNovel, VNOfTheDay, CoverBlacklist, Tag, VNTag,
    Producer, ReleaseProducer, ReleaseVN,
)

logger = logging.getLogger(__name__)

# Selection criteria for smart random
MIN_RATING = 6.0
MIN_VOTES = 20
MAX_IMAGE_SEXUAL = 1.0  # Stricter than general threshold — VOTD shows on front page
NO_REPEAT_DAYS = 365
# Fallback windows tried in order when no VN found
FALLBACK_WINDOWS = [180, 90, 0]


async def get_current(db: AsyncSession) -> VNOfTheDay | None:
    """Get today's VN of the Day (UTC date)."""
    return await get_by_date(db, date.today())


async def get_by_date(db: AsyncSession, target_date: date) -> VNOfTheDay | None:
    """Get VN of the Day for a specific date."""
    result = await db.execute(
        select(VNOfTheDay)
        .options(joinedload(VNOfTheDay.visual_novel))
        .where(VNOfTheDay.date == target_date)
    )
    return result.unique().scalar_one_or_none()


async def get_or_select(db: AsyncSession) -> VNOfTheDay | None:
    """Get today's pick, selecting a new one if none exists."""
    pick = await get_current(db)
    if pick:
        return pick
    return await _select_and_save(db)


async def _select_and_save(db: AsyncSession) -> VNOfTheDay | None:
    """Run selection algorithm, persist result."""
    today = date.today()

    # Try with full no-repeat window, then progressively relax
    windows = [NO_REPEAT_DAYS] + FALLBACK_WINDOWS
    vn_id = None

    for window in windows:
        vn_id = await _pick_random_vn(db, no_repeat_days=window)
        if vn_id:
            break

    if not vn_id:
        logger.warning("No eligible VN found for VN of the Day")
        return None

    pick = VNOfTheDay(vn_id=vn_id, date=today)
    db.add(pick)
    try:
        await db.commit()
    except IntegrityError:
        # Race condition: another process already inserted for today
        await db.rollback()
        return await get_current(db)

    # Reload with relationship
    await db.refresh(pick)
    result = await db.execute(
        select(VNOfTheDay)
        .options(joinedload(VNOfTheDay.visual_novel))
        .where(VNOfTheDay.id == pick.id)
    )
    return result.unique().scalar_one_or_none()


async def _pick_random_vn(db: AsyncSession, no_repeat_days: int) -> str | None:
    """Execute the selection query with the given no-repeat window."""
    today = date.today()

    # Subquery: VN IDs picked in the last N days
    recent_picks = select(VNOfTheDay.vn_id)
    if no_repeat_days > 0:
        cutoff = today - timedelta(days=no_repeat_days)
        recent_picks = recent_picks.where(VNOfTheDay.date > cutoff)

    # Subquery: blacklisted VN IDs
    blacklisted = select(CoverBlacklist.vn_id)

    query = (
        select(VisualNovel.id)
        .where(
            and_(
                VisualNovel.olang == "ja",
                VisualNovel.rating >= MIN_RATING,
                VisualNovel.votecount >= MIN_VOTES,
                VisualNovel.devstatus == 0,
                VisualNovel.image_url.isnot(None),
                (VisualNovel.image_sexual < MAX_IMAGE_SEXUAL) | (VisualNovel.image_sexual.is_(None)),
                VisualNovel.id.notin_(recent_picks),
                VisualNovel.id.notin_(blacklisted),
            )
        )
        .order_by(func.random())
        .limit(1)
    )

    result = await db.execute(query)
    row = result.scalar_one_or_none()
    return row


async def set_override(
    db: AsyncSession, vn_id: str, target_date: date, admin_name: str
) -> VNOfTheDay | None:
    """Admin override: delete existing + insert for a specific date."""
    # Verify VN exists
    vn = await db.execute(select(VisualNovel.id).where(VisualNovel.id == vn_id))
    if not vn.scalar_one_or_none():
        return None

    # Delete existing pick for that date
    await db.execute(delete(VNOfTheDay).where(VNOfTheDay.date == target_date))

    pick = VNOfTheDay(
        vn_id=vn_id,
        date=target_date,
        is_override=True,
        override_by=admin_name,
    )
    db.add(pick)
    await db.commit()

    # Reload with relationship
    result = await db.execute(
        select(VNOfTheDay)
        .options(joinedload(VNOfTheDay.visual_novel))
        .where(VNOfTheDay.id == pick.id)
    )
    return result.unique().scalar_one_or_none()


async def reroll_today(db: AsyncSession) -> VNOfTheDay | None:
    """Delete today's pick and select a new one."""
    today = date.today()
    await db.execute(delete(VNOfTheDay).where(VNOfTheDay.date == today))
    await db.commit()
    return await _select_and_save(db)


async def get_history(db: AsyncSession, limit: int = 30) -> list[VNOfTheDay]:
    """Get past picks ordered by date descending."""
    result = await db.execute(
        select(VNOfTheDay)
        .options(joinedload(VNOfTheDay.visual_novel))
        .order_by(VNOfTheDay.date.desc())
        .limit(limit)
    )
    return list(result.unique().scalars().all())


def build_votd_response(pick: VNOfTheDay, tags: list[dict] | None = None, developers: list[str] | None = None) -> dict:
    """Build the API response dict from a VNOfTheDay record."""
    vn = pick.visual_novel
    if not vn:
        return None

    description = vn.description
    if description and len(description) > 500:
        # Truncate at word boundary
        description = description[:500].rsplit(" ", 1)[0] + "..."

    return {
        "vn_id": vn.id,
        "date": pick.date.isoformat(),
        "is_override": pick.is_override or False,
        "title": vn.title,
        "title_jp": vn.title_jp,
        "title_romaji": vn.title_romaji,
        "description": description,
        "image_url": vn.image_url,
        "image_sexual": vn.image_sexual,
        "rating": vn.rating,
        "votecount": vn.votecount,
        "released": vn.released.isoformat() if vn.released else None,
        "developers": developers if developers is not None else (vn.developers or []),
        "tags": tags or [],
        "length_minutes": vn.length_minutes,
    }


async def get_vn_tags(db: AsyncSession, vn_id: str, limit: int = 5) -> list[dict]:
    """Get top non-spoiler, non-sexual tags for a VN."""
    result = await db.execute(
        select(Tag.name, Tag.category)
        .join(VNTag, VNTag.tag_id == Tag.id)
        .where(
            and_(
                VNTag.vn_id == vn_id,
                VNTag.spoiler_level == 0,
                Tag.category != "ero",
            )
        )
        .order_by(VNTag.score.desc())
        .limit(limit)
    )
    return [{"name": row.name, "category": row.category} for row in result.all()]


async def get_vn_developers(db: AsyncSession, vn_id: str) -> list[str]:
    """Get developer names for a VN via release-producer join."""
    result = await db.execute(
        select(Producer.name)
        .distinct()
        .join(ReleaseProducer, Producer.id == ReleaseProducer.producer_id)
        .join(ReleaseVN, ReleaseProducer.release_id == ReleaseVN.release_id)
        .where(ReleaseVN.vn_id == vn_id)
        .where(ReleaseProducer.developer == True)  # noqa: E712
    )
    return [row[0] for row in result.all()]


# ============ Scheduled Task ============


async def run_vn_of_the_day_selection():
    """Scheduled task: select today's VN and invalidate cache."""
    from app.db.database import async_session_maker
    from app.core.cache import get_cache

    logger.info("Running VN of the Day selection...")

    try:
        async with async_session_maker() as db:
            pick = await get_or_select(db)
            if not pick or not pick.visual_novel:
                logger.warning("No eligible VN found for VN of the Day")
                return

            vn = pick.visual_novel
            logger.info(f"VN of the Day selected: {vn.id} - {vn.title} for {pick.date}")

            # Invalidate cache
            cache = get_cache()
            await cache.delete("vn_of_the_day:current")

    except Exception as e:
        logger.error(f"VN of the Day selection failed: {e}", exc_info=True)


