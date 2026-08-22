from dataclasses import dataclass
from datetime import datetime

from app.db.models import UserRecommendationCache
from app.services.hybrid_recommender import (
    MAX_WEIGHTED_SCORE,
    SIGNAL_WEIGHTS,
    normalize_score,
)
from app.services.recommendation_cache import (
    SCORE_COLUMNS,
    build_cache_records,
    upsert_statement,
)


@dataclass
class _Result:
    """Stands in for RecommendationResult with distinct values per signal.

    Distinct values matter: identical ones would let a column mix-up pass unnoticed.
    """

    vn_id: str = "v100"
    score: float = 5.2
    tag_score: float = 0.11
    similar_games_score: float = 0.22
    users_also_read_score: float = 0.33
    developer_score: float = 0.44
    staff_score: float = 0.55
    seiyuu_score: float = 0.66
    trait_score: float = 0.77
    quality_score: float = 0.88


def test_records_cover_every_writable_column():
    record = build_cache_records("u1", [_Result()], datetime(2026, 1, 1))[0]
    table_columns = {c.name for c in UserRecommendationCache.__table__.columns}
    assert table_columns - set(record) == set(), "a column the writers own is unset"
    assert set(record) <= table_columns, "record carries a key the table has no column for"


def test_legacy_column_names_carry_their_documented_signal():
    # cf_score holds similar_games, hgat_score holds staff. The read path maps them back
    # positionally, so a writer that swaps them corrupts the display silently.
    record = build_cache_records("u1", [_Result()], datetime(2026, 1, 1))[0]
    assert record["cf_score"] == 0.22
    assert record["hgat_score"] == 0.55
    assert record["users_also_read_score"] == 0.33


def test_no_signal_column_is_left_null():
    record = build_cache_records("u1", [_Result()], datetime(2026, 1, 1))[0]
    unset = [c for c in SCORE_COLUMNS if record.get(c) is None]
    assert not unset, f"columns written as NULL: {unset}"


def test_upsert_updates_every_score_column():
    records = build_cache_records("u1", [_Result()], datetime(2026, 1, 1))
    compiled = str(upsert_statement(records))
    for column in SCORE_COLUMNS:
        assert f"{column} = excluded.{column}" in compiled


def test_cached_and_fresh_scores_normalize_identically():
    # A cached row stores the raw combined score; the fresh path stores the same number.
    # Both must render the same percentage, so one formula serves both paths.
    for raw in (0.0, 1.0, 5.2, 10.4, 12.0):
        assert normalize_score(raw) == min(100, round((raw / MAX_WEIGHTED_SCORE) * 100))


def test_normalized_score_is_bounded():
    assert normalize_score(0) == 0
    assert normalize_score(MAX_WEIGHTED_SCORE) == 100
    assert normalize_score(MAX_WEIGHTED_SCORE * 10) == 100


def test_signal_weights_match_the_api_score_keys():
    # The per-signal `scores` object in the API response uses these exact keys. A signal
    # present in one and not the other means a weight is applied to nothing, or a score is
    # returned with no weight behind it.
    api_score_keys = {
        "tag",
        "similar_games",
        "users_also_read",
        "developer",
        "staff",
        "seiyuu",
        "trait",
        "quality",
    }
    assert set(SIGNAL_WEIGHTS) == api_score_keys


def test_max_weighted_score_is_the_sum_of_the_weights():
    # Asserted against the table rather than a literal: the previous definition restated
    # the total in a comment, and the two had drifted apart.
    assert MAX_WEIGHTED_SCORE == sum(SIGNAL_WEIGHTS.values())
    assert MAX_WEIGHTED_SCORE > 0
