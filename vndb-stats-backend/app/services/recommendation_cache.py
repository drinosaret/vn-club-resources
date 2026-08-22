"""Shared write path for `user_recommendation_cache`.

Two callers persist recommendations: the request-time background writer and the batch
precompute job. Both must emit every score column with the same meaning, because the read
path maps columns back onto signal names positionally and cannot detect a writer that
filled them differently.

Two column names predate the current signal set and no longer describe their contents:

    cf_score    holds similar_games_score  (VNSimilarity)
    hgat_score  holds staff_score          (VNStaff affinity)

They are kept because renaming them buys nothing a comment does not, and a migration on a
table this size is not free. The mapping is applied in exactly one place, below.
"""

from datetime import datetime
from typing import Iterable

from sqlalchemy.dialects.postgresql import insert

from app.db.models import UserRecommendationCache

# Every column the writers own. The primary key is excluded: it identifies the row rather
# than being updated on conflict.
SCORE_COLUMNS = (
    "combined_score",
    "tag_score",
    "cf_score",
    "hgat_score",
    "users_also_read_score",
    "developer_score",
    "seiyuu_score",
    "trait_score",
    "quality_score",
    "updated_at",
)


def build_cache_records(
    user_id: str,
    results: Iterable,
    now: datetime,
) -> list[dict]:
    """Turn recommendation results into rows for `user_recommendation_cache`.

    `user_id` must be the VNDB uid in its prefixed form (`u12345`), matching what the read
    path looks up. Callers working from `global_votes.user_hash` hold the bare numeric id
    and have to add the prefix.
    """
    return [
        {
            "user_id": user_id,
            "vn_id": r.vn_id,
            "combined_score": r.score,
            "tag_score": r.tag_score,
            "cf_score": r.similar_games_score,
            "hgat_score": r.staff_score,
            "users_also_read_score": r.users_also_read_score,
            "developer_score": r.developer_score,
            "seiyuu_score": r.seiyuu_score,
            "trait_score": r.trait_score,
            "quality_score": r.quality_score,
            "updated_at": now,
        }
        for r in results
    ]


def upsert_statement(records: list[dict]):
    """Build the conflict-tolerant insert for a batch of cache records."""
    stmt = insert(UserRecommendationCache).values(records)
    return stmt.on_conflict_do_update(
        index_elements=["user_id", "vn_id"],
        set_={column: getattr(stmt.excluded, column) for column in SCORE_COLUMNS},
    )
