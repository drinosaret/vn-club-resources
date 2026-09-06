"""Shared write path for `user_recommendation_cache`.

Recommendations are persisted by the request-time background writer, the batch precompute
job, and the cache service behind the combined method. Each must emit every score column
with the same meaning, because the read path maps columns back onto signal names
positionally and cannot detect a writer that filled them differently. Each must also hand
its results over in the order the engine returned them, since that order is recorded
rather than derived.

A write is one reader's page as a whole, not an addition to the page they already had, so
it replaces those rows rather than merging into them. Positions are numbered from zero per
run and a run at one page size does not select a superset of a run at a smaller one, so
rows kept from an earlier run would sit at positions the new run also uses and the read
would serve the two interleaved.

Retention lives here as well. The read path treats a row past its TTL as absent but never
removes it, so nothing bounds the table unless something deletes on a schedule. This module
holds no recommender imports, which keeps a scheduler able to call the sweep without
loading the scoring stack.

Two column names predate the current signal set and no longer describe their contents:

    cf_score    holds similar_games_score  (VNSimilarity)
    hgat_score  holds staff_score          (VNStaff affinity)

They are kept because renaming them buys nothing a comment does not, and a migration on a
table this size is not free. The mapping is applied in exactly one place, below.
"""

import logging
from datetime import datetime, timedelta
from typing import Iterable, Optional

from sqlalchemy import delete, select, tuple_
from sqlalchemy.dialects.postgresql import insert

from app.db.database import async_session
from app.db.models import UserRecommendationCache

logger = logging.getLogger(__name__)

# Retention for cached rows, deliberately far longer than the read-time TTL. A reader's
# rows are replaced the next time they are scored, so the sweep only needs to reach rows
# belonging to readers who have stopped visiting.
STALE_CACHE_DAYS = 30

# Rows removed per transaction by the retention sweep. Bounds how long any single
# delete holds locks, since the sweep runs alongside live reads and writes on the table.
STALE_CACHE_BATCH = 10_000

# Rows per INSERT. Bounds the bind parameters one statement carries, which the driver caps
# independently of how many rows a page holds.
INSERT_BATCH = 500

# Every column the writers own. The primary key is excluded: it identifies the row rather
# than being updated on conflict.
SCORE_COLUMNS = (
    "rank",
    "combined_score",
    "tag_score",
    "cf_score",
    "hgat_score",
    "users_also_read_score",
    "developer_score",
    "seiyuu_score",
    "trait_score",
    "quality_score",
    "description_score",
    "reason",
    "confidence",
    "predicted_rating",
    "predicted_low",
    "predicted_high",
    "updated_at",
)

# Every column a write sets. A row is written whole: a writer that computes fewer signals
# than another leaves the rest unset rather than letting them keep values from a run that
# is no longer represented.
WRITABLE_COLUMNS = ("user_id", "vn_id") + SCORE_COLUMNS


def build_cache_records(
    user_id: str,
    results: Iterable,
    now: datetime,
    reasons: Optional[dict[str, dict]] = None,
) -> list[dict]:
    """Turn recommendation results into rows for `user_recommendation_cache`.

    `user_id` must be the VNDB uid in its prefixed form (`u12345`), matching what the read
    path looks up. Callers working from `global_votes.user_hash` hold the bare numeric id
    and have to add the prefix.

    `results` must be in the order the engine returned them. That order is a selection
    over the scored set rather than a sort of it, so it is stored as a position and read
    back, not rebuilt from `combined_score`.

    `reasons` maps a vn id to what the card says about it. A caller that scored without
    computing details has none to give and leaves the column null, which the read path
    renders as a card with no reason rather than as a reason of nothing.
    """
    reasons = reasons or {}
    return [
        {
            "user_id": user_id,
            "vn_id": r.vn_id,
            "rank": position,
            "combined_score": r.score,
            "tag_score": r.tag_score,
            "cf_score": r.similar_games_score,
            "hgat_score": r.staff_score,
            "users_also_read_score": r.users_also_read_score,
            "developer_score": r.developer_score,
            "seiyuu_score": r.seiyuu_score,
            "trait_score": r.trait_score,
            "quality_score": r.quality_score,
            "description_score": r.description_score,
            "reason": reasons.get(r.vn_id),
            "confidence": getattr(r, "confidence", None),
            "predicted_rating": getattr(r, "predicted_rating", None),
            "predicted_low": getattr(r, "predicted_rating_low", None),
            "predicted_high": getattr(r, "predicted_rating_high", None),
            "updated_at": now,
        }
        for position, r in enumerate(results)
    ]


def upsert_statement(records: list[dict]):
    """Build the conflict-tolerant insert for a batch of cache records."""
    stmt = insert(UserRecommendationCache).values(records)
    return stmt.on_conflict_do_update(
        index_elements=["user_id", "vn_id"],
        set_={column: getattr(stmt.excluded, column) for column in SCORE_COLUMNS},
    )


async def replace_user_rows(db, user_id: str, records: list[dict]) -> int:
    """Make `records` the whole of one reader's cached rows, inside `db`'s transaction.

    The removal and the writes have to reach the database together, so the caller commits
    once and must not commit between them: a reader whose page is being rewritten is
    otherwise served the gap. The write still tolerates a conflict, so two runs racing on
    one reader complete rather than raising. Their result is not guaranteed to be either
    page whole: at the isolation level the connection runs under, a removal that took its
    snapshot before the other run committed does not reach that run's rows, and what
    survives is the union. Both pages describe the same reader against the same catalogue,
    so the cost of that is an ordering drawn from two runs, and it lasts until the next
    write. A page that has to be exactly one run's work needs the two writers serialised
    on the reader, which nothing here does.

    An empty batch is not a page and leaves the reader's rows alone; a run that produced
    nothing has nothing to say about what they should hold.

    Returns the number of rows written.
    """
    if not records:
        return 0

    # Uniform keys across the batch, since a row stands for the whole of what its run
    # found and a multi-row insert takes one column list for all of them.
    rows = [
        {column: record.get(column) for column in WRITABLE_COLUMNS}
        for record in records
    ]

    await db.execute(
        delete(UserRecommendationCache).where(UserRecommendationCache.user_id == user_id)
    )
    for start in range(0, len(rows), INSERT_BATCH):
        await db.execute(upsert_statement(rows[start : start + INSERT_BATCH]))
    return len(rows)


async def write_user_page(user_id: str, records: list[dict]) -> int:
    """`replace_user_rows` in a session of its own, committed once.

    For writers with no session to join, or whose session belongs to a request that must
    not be held open for a background write.
    """
    if not records:
        return 0

    async with async_session() as db:
        written = await replace_user_rows(db, user_id, records)
        await db.commit()
        return written


async def cleanup_stale_cache(
    days: int = STALE_CACHE_DAYS,
    batch_size: int = STALE_CACHE_BATCH,
) -> int:
    """Delete cache rows that have not been rewritten within `days`.

    Removal runs in bounded batches, each its own transaction. On a table that has grown
    unbounded the qualifying share can be most of it, and a single statement that size
    holds locks and accumulates WAL for as long as it runs. Batching also lets a sweep
    that is interrupted keep the rows it already removed.

    Returns the number of rows removed.
    """
    cutoff = datetime.utcnow() - timedelta(days=days)
    key = tuple_(UserRecommendationCache.user_id, UserRecommendationCache.vn_id)
    deleted = 0

    try:
        while True:
            doomed = (
                select(UserRecommendationCache.user_id, UserRecommendationCache.vn_id)
                .where(UserRecommendationCache.updated_at < cutoff)
                .limit(batch_size)
            )
            async with async_session() as db:
                result = await db.execute(
                    delete(UserRecommendationCache).where(key.in_(doomed))
                )
                await db.commit()
            removed = result.rowcount or 0
            deleted += removed
            if removed < batch_size:
                break

        if deleted > 0:
            logger.info(f"Recommendation cache cleanup: deleted {deleted} rows older than {days} days")
        else:
            logger.debug(f"Recommendation cache cleanup: no rows older than {days} days")

        return deleted

    except Exception as e:
        logger.error(f"Recommendation cache cleanup failed: {e}")
        raise
