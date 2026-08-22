"""Pre-compute user recommendations for active users.

Computes top-N recommendations for active users and stores them in
user_recommendation_cache for fast retrieval via the API.

NOT WIRED INTO THE LIVE PIPELINE. The only caller is app.ingestion.scheduler, which
nothing starts; the daily job that actually runs is scripts/worker.py. Enabling this
writes on the order of RECOMMENDATIONS_PER_USER rows per active user, so the storage
budget has to be checked against the host before it is switched on. The request-time
writer in the recommendations endpoint keeps the same table warm for users who visit.

Two things must hold for a row written here to ever be read back, and neither is enforced
by the schema:

- user_id has to carry the `u` prefix. global_votes.user_hash is the VNDB numeric id with
  that prefix stripped, so it cannot be used as a cache key unmodified.
- every score column has to be populated with the meaning the read path expects, which is
  why the record shape lives in app.services.recommendation_cache rather than here.
"""

import asyncio
import logging
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import select, func, delete

from app.db.database import async_session
from app.db.models import (
    GlobalVote,
    UserRecommendationCache,
)
from app.services.hybrid_recommender import HybridRecommender
from app.services.recommendation_cache import build_cache_records, upsert_statement

logger = logging.getLogger(__name__)

# Configuration
ACTIVE_USER_MIN_VOTES = 20  # Minimum votes to be considered active
ACTIVE_USER_MONTHS = 6  # Consider votes from last N months
RECOMMENDATIONS_PER_USER = 200  # Number of recs to cache per user
BATCH_SIZE = 100  # Process users in batches
STALE_CACHE_DAYS = 30  # Remove cache for users inactive this long
# Database pool protection: limit concurrent DB operations
# Pool has pool_size + max_overflow connections (typically 10+20=30)
# Leave headroom for other operations (API requests, imports, etc.)
MAX_CONCURRENT_DB_OPS = 20

# Module-level semaphore for controlling DB concurrency
_db_semaphore: asyncio.Semaphore | None = None


def _get_db_semaphore() -> asyncio.Semaphore:
    """Get or create the database semaphore (must be called from async context)."""
    global _db_semaphore
    if _db_semaphore is None:
        _db_semaphore = asyncio.Semaphore(MAX_CONCURRENT_DB_OPS)
    return _db_semaphore


async def get_active_users(
    min_votes: int = ACTIVE_USER_MIN_VOTES,
    months: int = ACTIVE_USER_MONTHS,
) -> list[str]:
    """
    Get list of active VNDB user IDs.

    Active users are those with at least min_votes votes in the last N months.
    Returns prefixed user IDs (`u12345`) sorted by vote count, most active first.
    """
    cutoff_date = datetime.utcnow() - timedelta(days=months * 30)

    async with async_session() as db:
        result = await db.execute(
            select(GlobalVote.user_hash, func.count(GlobalVote.vn_id).label("vote_count"))
            .where(GlobalVote.vote.isnot(None))
            .group_by(GlobalVote.user_hash)
            .having(func.count(GlobalVote.vn_id) >= min_votes)
            .order_by(func.count(GlobalVote.vn_id).desc())
        )
        # global_votes stores the bare numeric id; the cache is keyed by the prefixed form.
        active_users = [f"u{row.user_hash}" for row in result.fetchall()]

    logger.info(f"Found {len(active_users)} active users with >={min_votes} votes")
    return active_users


async def get_user_votes(user_id: str) -> list[dict]:
    """Get all votes for a user, given the prefixed uid used as the cache key."""
    user_hash = user_id[1:] if user_id.startswith("u") else user_id

    async with async_session() as db:
        result = await db.execute(
            select(GlobalVote.vn_id, GlobalVote.vote)
            .where(GlobalVote.user_hash == user_hash)
            .where(GlobalVote.vote.isnot(None))
        )
        return [{"vn_id": row.vn_id, "score": row.vote} for row in result.fetchall()]


async def cache_user_recommendations(
    user_id: str,
    recommendations: list,
) -> int:
    """
    Cache recommendations for a user.

    Uses upsert to update existing entries or insert new ones.
    Returns number of recommendations cached.
    """
    if not recommendations:
        return 0

    records = build_cache_records(user_id, recommendations, datetime.utcnow())

    async with async_session() as db:
        for i in range(0, len(records), 500):
            await db.execute(upsert_statement(records[i : i + 500]))
        await db.commit()

    return len(records)


async def compute_user_recommendations(
    user_id: str,
    user_votes: list[dict],
) -> list:
    """
    Compute recommendations for a single user using HybridRecommender.
    """
    if not user_votes:
        return []

    # Get VN IDs the user has already played
    exclude_vns = {v["vn_id"] for v in user_votes}

    async with async_session() as db:
        recommender = HybridRecommender(db)
        try:
            recommendations = await recommender.recommend(
                user_votes=user_votes,
                exclude_vn_ids=exclude_vns,
                limit=RECOMMENDATIONS_PER_USER,
                japanese_only=True,  # Target audience is Japanese VN readers
            )
            return recommendations
        except Exception as e:
            logger.warning(f"Failed to compute recs for {user_id}: {e}")
            return []


async def cleanup_stale_cache(days: int = STALE_CACHE_DAYS) -> int:
    """
    Remove cache entries for users who haven't had any activity.

    Returns number of entries removed.
    """
    cutoff_date = datetime.utcnow() - timedelta(days=days)

    async with async_session() as db:
        result = await db.execute(
            delete(UserRecommendationCache).where(
                UserRecommendationCache.updated_at < cutoff_date
            )
        )
        await db.commit()
        deleted = result.rowcount or 0

    if deleted > 0:
        logger.info(f"Cleaned up {deleted} stale cache entries (>{days} days old)")
    return deleted


async def precompute_user_recommendations(
    max_users: Optional[int] = None,
) -> dict:
    """
    Pre-compute recommendations for all active users.

    This is the main entry point called by the scheduler.

    Args:
        max_users: Optional limit on number of users to process (for testing)

    Returns:
        Statistics dict with counts
    """
    start_time = datetime.utcnow()
    logger.info("Starting user recommendation pre-computation")

    # Get active users
    active_users = await get_active_users()
    if max_users:
        active_users = active_users[:max_users]

    stats = {
        "users_processed": 0,
        "users_failed": 0,
        "total_recommendations": 0,
        "stale_cleaned": 0,
    }

    # Get semaphore for limiting concurrent DB operations
    semaphore = _get_db_semaphore()

    async def process_with_limit(user_id: str) -> int:
        """Process a single user with semaphore protection."""
        async with semaphore:
            return await process_single_user(user_id)

    # Process users in batches
    for batch_start in range(0, len(active_users), BATCH_SIZE):
        batch = active_users[batch_start : batch_start + BATCH_SIZE]
        logger.info(
            f"Processing users {batch_start + 1}-{batch_start + len(batch)} "
            f"of {len(active_users)} (max concurrent: {MAX_CONCURRENT_DB_OPS})"
        )

        # Process batch concurrently with semaphore limiting actual DB operations
        tasks = [process_with_limit(user_id) for user_id in batch]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        for result in results:
            if isinstance(result, Exception):
                stats["users_failed"] += 1
                logger.debug(f"User processing failed: {result}")
            elif isinstance(result, int):
                stats["users_processed"] += 1
                stats["total_recommendations"] += result

    # Cleanup stale cache entries
    stats["stale_cleaned"] = await cleanup_stale_cache()

    elapsed = (datetime.utcnow() - start_time).total_seconds()
    logger.info(
        f"User recommendation pre-computation complete in {elapsed:.1f}s: "
        f"{stats['users_processed']} users, "
        f"{stats['total_recommendations']} recs cached, "
        f"{stats['users_failed']} failed"
    )

    return stats


async def process_single_user(user_id: str) -> int:
    """Process a single user - fetch votes, compute recs, cache."""
    user_votes = await get_user_votes(user_id)
    if not user_votes:
        return 0

    recommendations = await compute_user_recommendations(user_id, user_votes)
    if not recommendations:
        return 0

    cached_count = await cache_user_recommendations(user_id, recommendations)
    return cached_count


if __name__ == "__main__":
    # Run as standalone script for testing
    logging.basicConfig(level=logging.INFO)

    async def main():
        # Test with limited users
        stats = await precompute_user_recommendations(max_users=10)
        print(f"Stats: {stats}")

    asyncio.run(main())
