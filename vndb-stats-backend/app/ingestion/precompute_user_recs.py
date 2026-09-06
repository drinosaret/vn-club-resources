"""Pre-compute user recommendations for active users.

Computes top-N recommendations for active users and stores them in
user_recommendation_cache for fast retrieval via the API.

Which readers a run covers is the caller's decision, and the two selectors answer very
different questions. `get_active_users` reads the votes dump and describes VNDB as a
whole: it admits every account that has been voting lately, whether or not it has ever
opened this site, and a run over it writes RECOMMENDATIONS_PER_USER rows per account on a
disk-constrained host. `get_cached_readers` reads the cache table and describes this
site's readers: it admits only accounts a request has already been served for, so a run
over it rewrites pages that exist rather than creating new ones.

The nightly job takes the second, which is why it is capped. A page refreshed on a
schedule never ages far enough for the retention sweep in app.services.recommendation_cache
to reach it, so the readers a run covers are a floor under the table rather than a
tenancy that expires. The cap is what bounds that floor.

Three things must hold for a row written here to ever be read back, and none is enforced
by the schema:

- user_id has to carry the `u` prefix. global_votes.user_hash is the VNDB numeric id with
  that prefix stripped, so it cannot be used as a cache key unmodified.
- every score column has to be populated with the meaning the read path expects, which is
  why the record shape lives in app.services.recommendation_cache rather than here.
- the profile has to be the one the endpoint builds, or a row written here is not the row
  the endpoint would have written and a reader is served a page nothing would reproduce.
  The profile rule and the exclusion rule are therefore imported rather than restated.

The retention sweep lives beside the record shape for the same reason plus one more: it is
scheduled independently of this job, and importing it must not drag in the scoring stack.
It is re-exported below so this module keeps its historical surface.
"""

import asyncio
import logging
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import select, func

from app.db.database import async_session
from app.db.models import GlobalVote, UlistLabel, UlistVN, UserRecommendationCache
from app.services.hybrid_recommender import HybridRecommender
from app.services.recommendation_cache import (  # noqa: F401
    STALE_CACHE_DAYS,
    build_cache_records,
    cleanup_stale_cache,
    write_user_page,
)
from app.services.recommendation_filters import (
    LABEL_DROPPED,
    compute_exclude_vn_ids,
    finished_votes,
)
from app.services.recommendation_lists import strongest_reason

logger = logging.getLogger(__name__)

# Configuration
ACTIVE_USER_MIN_VOTES = 20  # Minimum votes to be considered active
ACTIVE_USER_MONTHS = 6  # Consider votes from last N months
RECOMMENDATIONS_PER_USER = 200  # Number of recs to cache per user
BATCH_SIZE = 100  # Process users in batches
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

    The window is what makes the set of users bounded, and the row count this job writes
    is that set times RECOMMENDATIONS_PER_USER. Counting every vote ever cast instead
    admits an order of magnitude more accounts, most of which have not visited in years.
    A vote carrying no date cannot be placed in the window, so it does not count towards
    activity.
    """
    cutoff_date = (datetime.utcnow() - timedelta(days=months * 30)).date()

    async with async_session() as db:
        result = await db.execute(
            select(GlobalVote.user_hash, func.count(GlobalVote.vn_id).label("vote_count"))
            .where(GlobalVote.vote.isnot(None))
            .where(GlobalVote.date >= cutoff_date)
            .group_by(GlobalVote.user_hash)
            .having(func.count(GlobalVote.vn_id) >= min_votes)
            .order_by(func.count(GlobalVote.vn_id).desc())
        )
        # global_votes stores the bare numeric id; the cache is keyed by the prefixed form.
        active_users = [f"u{row.user_hash}" for row in result.fetchall()]

    logger.info(
        f"Found {len(active_users)} active users with >={min_votes} votes "
        f"in the last {months} months"
    )
    return active_users


def cached_reader_query(limit: Optional[int] = None):
    """Readers already holding a cached page, least recently written first.

    The cache table is the only record of who has asked this site for recommendations:
    a request writes the reader's page on its way out, and nothing else puts a row there.
    The votes dump cannot answer the same question, since it describes VNDB accounts
    rather than visitors.

    Ordering by the page's age decides who a capped run covers. A scheduled refresh
    writes every page it touches at the same moment, so ages only separate readers whose
    last page came from a request, which is the ordering worth having: a reader the cap
    excluded on one run is older on the next and moves to the front of the queue.
    """
    query = (
        select(UserRecommendationCache.user_id)
        .group_by(UserRecommendationCache.user_id)
        .order_by(func.min(UserRecommendationCache.updated_at).asc())
    )
    if limit is not None:
        query = query.limit(limit)
    return query


async def get_cached_readers(limit: Optional[int] = None) -> list[str]:
    """Run `cached_reader_query` and return the prefixed user ids it selects."""
    async with async_session() as db:
        result = await db.execute(cached_reader_query(limit))
        readers = [row.user_id for row in result.fetchall()]

    logger.info(f"Found {len(readers)} readers holding a cached recommendation page")
    return readers


async def get_user_list(user_id: str) -> dict:
    """A reader's list in the shape the endpoint's profile and exclusion rules read.

    Takes the prefixed uid used as the cache key. Read straight from the list dump tables
    rather than through UserService: the votes on those rows carry the labels the profile
    rule narrows by, which the votes dump does not, and the batch has no use for the
    username lookup and per-reader caching that path also performs.
    """
    async with async_session() as db:
        vote_rows = (
            await db.execute(
                select(UlistVN.vid, UlistVN.vote)
                .where(UlistVN.uid == user_id)
                .where(UlistVN.vote.isnot(None))
            )
        ).all()
        label_rows = (
            await db.execute(
                select(UlistLabel.vid, UlistLabel.label).where(UlistLabel.uid == user_id)
            )
        ).all()

    labels: dict[str, list[str]] = {}
    for row in label_rows:
        labels.setdefault(str(row.label), []).append(row.vid)

    return {
        "votes": [{"vn_id": row.vid, "score": row.vote} for row in vote_rows],
        "labels": labels,
    }


async def cache_user_recommendations(
    user_id: str,
    recommendations: list,
) -> int:
    """
    Cache recommendations for a user.

    The write is the reader's whole page and replaces whatever they held.

    The reason a card shows is stored with the scores. It cannot be rebuilt from a stored
    row, so a page written without one is served with every score and no explanation.
    Which of the eight reasons a card carries is decided under the global weight vector,
    which is what a run naming no weights of its own is scored under.

    Returns number of recommendations cached.
    """
    if not recommendations:
        return 0

    reasons = {}
    for result in recommendations:
        reason = strongest_reason(result)
        if reason is not None:
            reasons[result.vn_id] = reason

    records = build_cache_records(user_id, recommendations, datetime.utcnow(), reasons)
    return await write_user_page(user_id, records)


async def compute_user_recommendations(
    user_id: str,
    user_votes: list[dict],
    exclude_vn_ids: set[str],
    negative_vn_ids: set[str],
) -> list:
    """
    Compute recommendations for a single user using HybridRecommender.

    The arguments describing the reader are the ones the endpoint passes, so a row written
    here is scored the way a request would have scored it. The page size is not among
    them: it sizes the candidate, diversity and popularity pools as well as the answer, so
    a request asking for fewer titles selects over a smaller pool and need not arrive at
    the same set or the same order. `japanese_only` is the endpoint's default and the only
    scope the cache is read under. Details are computed because the reason on a card is
    made of them and the row has a column for it; measured against a run that skips them,
    the extra work sits inside the run-to-run spread.
    """
    if not user_votes:
        return []

    async with async_session() as db:
        recommender = HybridRecommender(db)
        try:
            recommendations = await recommender.recommend(
                user_votes=user_votes,
                exclude_vn_ids=exclude_vn_ids,
                limit=RECOMMENDATIONS_PER_USER,
                japanese_only=True,
                negative_vn_ids=negative_vn_ids,
                skip_details=False,
            )
            return recommendations
        except Exception as e:
            logger.warning(f"Failed to compute recs for {user_id}: {e}")
            return []


async def precompute_user_recommendations(
    max_users: Optional[int] = None,
    user_ids: Optional[list[str]] = None,
) -> dict:
    """
    Pre-compute recommendations for a set of users.

    This is the main entry point called by the scheduler.

    Args:
        max_users: Optional limit on number of users to process
        user_ids: Prefixed ids to score. Defaults to the active-user selection, which
            describes VNDB rather than this site's readers; see the module docstring
            before running a job over it.

    Returns:
        Statistics dict with counts
    """
    start_time = datetime.utcnow()
    logger.info("Starting user recommendation pre-computation")

    active_users = user_ids if user_ids is not None else await get_active_users()
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
    """Process a single user - fetch the list, compute recs, cache."""
    user_data = await get_user_list(user_id)
    user_votes = finished_votes(user_data)
    if not user_votes:
        return 0

    labels = user_data["labels"]
    recommendations = await compute_user_recommendations(
        user_id,
        user_votes,
        exclude_vn_ids=compute_exclude_vn_ids(labels),
        negative_vn_ids=set(labels.get(LABEL_DROPPED, [])),
    )
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
