"""What a cached page is made of, and what a write to it does to the page before it."""

import asyncio
import inspect
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional

from sqlalchemy.dialects import postgresql

from app.db.models import UserRecommendationCache
from app.services.hybrid_recommender import (
    MAX_WEIGHTED_SCORE,
    SIGNAL_WEIGHTS,
    normalize_score,
)
from app.services.recommendation_cache import (
    SCORE_COLUMNS,
    WRITABLE_COLUMNS,
    build_cache_records,
    replace_user_rows,
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
    description_score: float = 0.99
    # Read only where a whole response is assembled, not by the write path.
    title: str = "title"
    title_jp: Optional[str] = None
    title_romaji: Optional[str] = None
    normalized_score: int = 50
    match_reasons: list = field(default_factory=list)
    image_url: Optional[str] = None
    image_sexual: float = 0.0
    rating: float = 7.0
    # Agreement between the signals and the mark they predict. Both are stored with the
    # row; the per-signal marks behind the prediction are not.
    confidence: int = 42
    signals_ranked: int = 4
    predicted_rating: Optional[float] = 7.5
    predicted_rating_low: Optional[float] = 7.0
    predicted_rating_high: Optional[float] = 8.0
    predicted_ratings: dict = field(default_factory=dict)


class _RecordingSession:
    """Keeps every statement it is handed, and whether a commit came between them."""

    def __init__(self):
        self.statements = []
        self.commits = []

    async def execute(self, statement):
        self.statements.append(statement)
        return None

    async def commit(self):
        self.commits.append(len(self.statements))


def _sql(statement) -> str:
    return str(statement.compile(dialect=postgresql.dialect()))


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
    # `reason` is exempt: a writer that scores without computing details has none to give,
    # and the read path renders its absence as a card with no reason rather than as an
    # empty one. Every other column stands for a signal that was scored.
    record = build_cache_records("u1", [_Result()], datetime(2026, 1, 1))[0]
    unset = [c for c in SCORE_COLUMNS if c != "reason" and record.get(c) is None]
    assert not unset, f"columns written as NULL: {unset}"


def test_a_reason_is_stored_with_the_scores():
    # It cannot be rebuilt from a stored row, so a page written without it is served with
    # every score and no explanation.
    reason = {"list": "tags", "signal": "tag", "count": 3, "top": [{"name": "Nakige"}]}
    record = build_cache_records(
        "u1", [_Result()], datetime(2026, 1, 1), {"v100": reason}
    )[0]
    assert record["reason"] == reason
    assert "reason" in SCORE_COLUMNS, "an upsert must refresh it with the scores"


def test_a_result_with_no_reason_stores_null():
    record = build_cache_records("u1", [_Result()], datetime(2026, 1, 1), {})[0]
    assert record["reason"] is None


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
        "description",
    }
    assert set(SIGNAL_WEIGHTS) == api_score_keys


def test_max_weighted_score_is_the_sum_of_the_weights():
    # Asserted against the table rather than a literal: the previous definition restated
    # the total in a comment, and the two had drifted apart.
    assert MAX_WEIGHTED_SCORE == sum(SIGNAL_WEIGHTS.values())
    assert MAX_WEIGHTED_SCORE > 0


# ---------------------------------------------------------------------------
# The order served is the order the engine produced.
# ---------------------------------------------------------------------------


def _page(*scores) -> list[_Result]:
    return [_Result(vn_id=f"v{index}", score=score) for index, score in enumerate(scores)]


def test_positions_are_dense_and_start_at_zero():
    records = build_cache_records("u1", _page(9.0, 8.0, 7.0), datetime(2026, 1, 1))
    assert [record["rank"] for record in records] == [0, 1, 2]


def test_positions_follow_engine_order_not_score_order():
    # The engine hands back a selection made after scoring, so the best-scoring title need
    # not lead the page. Numbering by score would put it there anyway and serve an order
    # nothing produced.
    results = _page(1.0, 9.0, 5.0)
    records = build_cache_records("u1", results, datetime(2026, 1, 1))

    assert [record["vn_id"] for record in records] == ["v0", "v1", "v2"]
    by_score = sorted(records, key=lambda record: record["combined_score"], reverse=True)
    assert [record["vn_id"] for record in by_score] != [r.vn_id for r in results]


# ---------------------------------------------------------------------------
# A write is one run's page, not an addition to the last one.
# ---------------------------------------------------------------------------


def test_a_write_removes_the_readers_rows_before_writing_its_own():
    # Positions are numbered per run and a longer run does not select a superset of a
    # shorter one, so rows left behind would sit at positions the new run also uses.
    session = _RecordingSession()
    records = build_cache_records("u1", _page(9.0, 8.0), datetime(2026, 1, 1))
    written = asyncio.run(replace_user_rows(session, "u1", records))

    assert written == 2
    rendered = [_sql(statement) for statement in session.statements]
    assert rendered[0].startswith("DELETE FROM user_recommendation_cache")
    assert "user_recommendation_cache.user_id =" in rendered[0]
    assert all(statement.startswith("INSERT INTO") for statement in rendered[1:])


def test_the_removal_and_the_writes_share_one_transaction():
    # A commit between them leaves a window in which the reader has no page at all.
    session = _RecordingSession()
    records = build_cache_records("u1", _page(9.0, 8.0), datetime(2026, 1, 1))
    asyncio.run(replace_user_rows(session, "u1", records))
    assert session.commits == []


def test_an_empty_batch_leaves_the_readers_rows_alone():
    # A run that produced nothing says nothing about what the reader should be served.
    session = _RecordingSession()
    assert asyncio.run(replace_user_rows(session, "u1", [])) == 0
    assert session.statements == []


def test_a_partial_writer_sets_every_column_it_owns():
    # A row stands for the whole of what its run found, so a signal this run did not
    # measure is written as unset rather than keeping the value an earlier run gave it.
    # Rows also reach the database as one batch under a single column list, which a
    # writer supplying different keys per row would break.
    session = _RecordingSession()
    partial = {
        "user_id": "u1",
        "vn_id": "v1",
        "rank": 0,
        "combined_score": 1.0,
        "updated_at": datetime(2026, 1, 1),
    }
    asyncio.run(replace_user_rows(session, "u1", [partial]))

    rendered = _sql(session.statements[1])
    columns = rendered[rendered.index("(") + 1 : rendered.index(")")]
    named = {name.strip() for name in columns.split(",")}
    assert named == set(WRITABLE_COLUMNS)


# ---------------------------------------------------------------------------
# Both readers of the table read the recorded order.
# ---------------------------------------------------------------------------


class _EmptySession(_RecordingSession):
    """A session whose first query comes back empty, which every reader stops on."""

    class _Empty:
        @staticmethod
        def all():
            return []

    async def execute(self, statement):
        self.statements.append(statement)
        return self._Empty()


POSITION_FIRST = (
    "ORDER BY user_recommendation_cache.rank ASC NULLS LAST, "
    "user_recommendation_cache.combined_score DESC"
)


def test_the_endpoint_read_is_ordered_by_position():
    from app.api.v1.recommendations import get_cached_recommendations

    session = _EmptySession()
    asyncio.run(
        get_cached_recommendations(
            db=session, user_id="u1", exclude_vn_ids=set(), limit=10,
            cutoff=datetime(2026, 1, 1),
        )
    )
    assert POSITION_FIRST in _sql(session.statements[0])


class _RowSession(_RecordingSession):
    """A session whose first query comes back with the rows it was built with."""

    def __init__(self, rows):
        super().__init__()
        self._rows = rows

    async def execute(self, statement):
        self.statements.append(statement)
        rows = self._rows
        return type("_Rows", (), {"all": staticmethod(lambda: rows)})()


def _cached_row(**overrides):
    """One joined row of the cached read, with every column the reader touches."""
    from types import SimpleNamespace

    row = dict(
        vn_id="v1",
        title="t",
        title_jp=None,
        title_romaji=None,
        combined_score=5.2,
        confidence=None,
        predicted_rating=7.5,
        predicted_low=7.0,
        predicted_high=8.0,
        tag_score=0.1,
        cf_score=0.1,
        hgat_score=0.1,
        users_also_read_score=0.1,
        developer_score=0.1,
        seiyuu_score=0.1,
        trait_score=0.1,
        quality_score=0.1,
        description_score=0.1,
        reason=None,
        updated_at=datetime(2026, 1, 1),
        image_url=None,
        image_sexual=0.0,
        rating=7.0,
        average_rating=7.4,
        length=3,
    )
    row.update(overrides)
    return SimpleNamespace(**row)


def _read_cached_figure(monkeypatch, aggregation: str, **overrides) -> int:
    import app.api.v1.recommendations as api

    monkeypatch.setattr(api, "AGGREGATION", aggregation)
    page, from_cache = asyncio.run(
        api.get_cached_recommendations(
            db=_RowSession([_cached_row(**overrides)]),
            user_id="u1",
            exclude_vn_ids=set(),
            limit=10,
            cutoff=datetime(2026, 1, 1),
        )
    )
    assert from_cache
    return page[0]["normalized_score"]


def test_a_cached_row_reports_the_stored_agreement_under_fusion(monkeypatch):
    # The fresh page's figure under this aggregation is the agreement, which is a
    # property of the pool the run scored, so a cached page must report the stored one.
    assert _read_cached_figure(monkeypatch, "fusion", confidence=57) == 57


def test_a_cached_row_without_an_agreement_falls_back_to_the_score(monkeypatch):
    # Rows written before the agreement was stored carry none.
    assert _read_cached_figure(monkeypatch, "fusion", confidence=None) == normalize_score(
        5.2
    )


def test_the_stored_agreement_is_ignored_under_the_weighted_aggregation(monkeypatch):
    # Under this aggregation the fresh page reports the score-derived figure and carries
    # the agreement only on the side; a cached page preferring the agreement would show a
    # different number for the same title.
    assert _read_cached_figure(monkeypatch, "weighted", confidence=57) == normalize_score(
        5.2
    )


def _read_cached_page(monkeypatch, **overrides) -> dict:
    import app.api.v1.recommendations as api

    monkeypatch.setattr(api, "AGGREGATION", "fusion")
    page, _ = asyncio.run(
        api.get_cached_recommendations(
            db=_RowSession([_cached_row(**overrides)]),
            user_id="u1",
            exclude_vn_ids=set(),
            limit=10,
            cutoff=datetime(2026, 1, 1),
        )
    )
    return page[0]


def test_a_cached_row_reports_its_stored_prediction_in_the_fresh_shape(monkeypatch):
    # The card reads one block whichever path served it, so the stored mean and range
    # come back under the same keys the fresh page uses, rounded the same way.
    rec = _read_cached_page(
        monkeypatch, predicted_rating=7.8449, predicted_low=7.1, predicted_high=None
    )
    assert rec["predicted_rating"] == {"mean": 7.84, "low": 7.1, "high": None}


def test_a_cached_row_without_a_prediction_omits_the_block(monkeypatch):
    # With the prediction off, rows carry no mean and the block is left out rather
    # than sent as a mean of nothing.
    import app.api.v1.recommendations as api

    monkeypatch.setattr(api.engine_switches, "PREDICTED_RATING", False)
    assert "predicted_rating" not in _read_cached_page(monkeypatch, predicted_rating=None)


def test_a_page_written_before_the_prediction_is_a_miss_while_it_is_on(monkeypatch):
    # Every computed page shows the prediction, so a saved page without it would be
    # the one page on the site missing the figure; it is recomputed once instead.
    import app.api.v1.recommendations as api

    monkeypatch.setattr(api.engine_switches, "PREDICTED_RATING", True)
    monkeypatch.setattr(api, "AGGREGATION", "fusion")
    page, from_cache = asyncio.run(
        api.get_cached_recommendations(
            db=_RowSession([_cached_row(predicted_rating=None)]),
            user_id="u1",
            exclude_vn_ids=set(),
            limit=10,
            cutoff=datetime(2026, 1, 1),
        )
    )
    assert (page, from_cache) == ([], False)


def test_the_cache_service_read_is_ordered_by_position():
    # A second reader of one table sorting it differently serves two answers to one
    # question, and only one of them is the order the engine produced.
    from app.services.user_cache_service import UserCacheService

    session = _EmptySession()
    asyncio.run(
        UserCacheService(session).get_cached_recommendations("u1", set(), limit=10)
    )
    assert POSITION_FIRST in _sql(session.statements[0])


def test_the_cache_service_write_records_positions_and_replaces_the_page():
    from app.services.user_cache_service import UserCacheService

    session = _RecordingSession()
    asyncio.run(
        UserCacheService(session).store_recommendations(
            "u1",
            [{"vn_id": "v1", "score": 1.0}, {"vn_id": "v2", "score": 9.0}],
        )
    )

    rendered = [_sql(statement) for statement in session.statements]
    assert rendered[0].startswith("DELETE FROM user_recommendation_cache")
    positions = [
        value
        for key, value in session.statements[1]
        .compile(dialect=postgresql.dialect())
        .params.items()
        if key.startswith("rank")
    ]
    assert positions == [0, 1]
    # One commit, after everything, so no read lands between the removal and the writes.
    assert session.commits == [len(session.statements)]


# ---------------------------------------------------------------------------
# The cached page is drawn under one original-language scope.
# ---------------------------------------------------------------------------


def _endpoint_defaults(raw) -> dict:
    """The values FastAPI would supply, since the function is called without it here."""
    from fastapi import params

    return {
        name: parameter.default.default
        for name, parameter in inspect.signature(raw).parameters.items()
        if isinstance(parameter.default, params.Query)
    }


class _Traffic:
    def __init__(self):
        self.reads = []
        self.writes = []


def _run_v2(monkeypatch, **overrides) -> _Traffic:
    """Drive the v2 endpoint with the cache and the engine standing in, and report which
    of the two the request touched."""
    import app.api.v1.recommendations as api

    traffic = _Traffic()

    async def _read(**kwargs):
        traffic.reads.append(kwargs)
        return [], False

    async def _settled():
        return None

    def _write(user_id, results, reasons=None):
        traffic.writes.append((user_id, list(results), reasons))
        return _settled()

    class _UserService:
        def __init__(self, db):
            pass

        async def get_user_list(self, vndb_uid):
            return {"labels": {"2": ["v1"]}, "votes": [{"vn_id": "v1", "score": 80}]}

    class _Recommender:
        last_pool = {}
        last_signal_weights = {}
        # Read whenever a page is assembled: the positions each signal put a title at, and
        # the order the list's own retrieval source returned.
        last_signal_rankings: dict = {}
        last_ranked_arms: dict = {}

        def __init__(self, db):
            pass

        async def recommend(self, **kwargs):
            return [_Result(vn_id="v50")]

    # The handler queries title facts for real on both paths; these tests hold no
    # session, so the lookup is stood in for like the rest of the collaborators here.
    async def _no_facts(db, vn_ids):
        return {}

    # Same reasoning as the facts lookup: the real query needs a session this test
    # does not hold.
    async def _no_last_import(db):
        return None

    monkeypatch.setattr(api, "get_cached_recommendations", _read)
    monkeypatch.setattr(api, "cache_recommendations_async", _write)
    monkeypatch.setattr(api, "UserService", _UserService)
    monkeypatch.setattr(api, "HybridRecommender", _Recommender)
    monkeypatch.setattr(api, "title_facts", _no_facts)
    monkeypatch.setattr(api, "last_import_time", _no_last_import)
    # Relation exclusion and the continuations shelf are on by default and both read
    # the relation table; a test that has not stood them in for itself gets empty ones.
    async def _no_related(db, vn_ids):
        return set()

    async def _no_continuations(db, **kwargs):
        return []

    if api.related_to.__module__ == "app.services.recommendation_relations":
        monkeypatch.setattr(api, "related_to", _no_related)
    if api.continuations.__module__ == "app.services.recommendation_relations":
        monkeypatch.setattr(api, "continuations", _no_continuations)

    raw = inspect.unwrap(api.get_recommendations_v2)
    arguments = _endpoint_defaults(raw)
    arguments["limit"] = api.CACHED_PAGE_LIMIT
    arguments.update(overrides)
    asyncio.run(raw(request=None, vndb_uid="u1", db=None, **arguments))
    return traffic


def test_a_request_in_the_default_scope_uses_the_cache(monkeypatch):
    traffic = _run_v2(monkeypatch)
    assert len(traffic.reads) == 1
    assert len(traffic.writes) == 1


def test_a_widened_language_scope_is_neither_read_nor_written(monkeypatch):
    # The cached page was drawn under the default scope and carries no record of it, so a
    # request wanting titles outside that scope cannot be answered from it, and its own
    # results describe a set the next default request did not ask for.
    traffic = _run_v2(monkeypatch, japanese_only=False)
    assert traffic.reads == []
    assert traffic.writes == []


def test_naming_the_default_language_outright_is_held_out_too(monkeypatch):
    # An explicit language list clears the shorthand and travels in the filter spec, so
    # the same scope spelled that way is computed fresh rather than served from cache.
    traffic = _run_v2(monkeypatch, olang="ja")
    assert traffic.reads == []
    assert traffic.writes == []


def test_an_explicit_language_list_clears_the_shorthand():
    from app.api.v1.recommendations import resolve_filter_overlaps
    from app.db.vn_filters import parse_vn_filters

    spec = parse_vn_filters(olang="ja")
    assert resolve_filter_overlaps(spec, None, None, True) == (None, None, False)


def test_cache_row_carries_the_agreement_figure():
    from datetime import datetime
    from app.services.hybrid_recommender import RecommendationResult
    from app.services.recommendation_cache import SCORE_COLUMNS, build_cache_records

    assert "confidence" in SCORE_COLUMNS
    result = RecommendationResult(vn_id="v1", title="t", score=1.0, match_reasons=[])
    result.confidence = 42
    row = build_cache_records("u1", [result], datetime(2000, 1, 1))[0]
    assert row["confidence"] == 42


def test_cache_row_carries_the_predicted_rating_and_its_range():
    from datetime import datetime
    from app.services.hybrid_recommender import RecommendationResult
    from app.services.recommendation_cache import SCORE_COLUMNS, build_cache_records

    for column in ("predicted_rating", "predicted_low", "predicted_high"):
        assert column in SCORE_COLUMNS, "an upsert must refresh it with the scores"
    result = RecommendationResult(vn_id="v1", title="t", score=1.0, match_reasons=[])
    result.predicted_rating = 7.84
    result.predicted_rating_low = 7.1
    result.predicted_rating_high = 8.5
    row = build_cache_records("u1", [result], datetime(2000, 1, 1))[0]
    assert (row["predicted_rating"], row["predicted_low"], row["predicted_high"]) == (7.84, 7.1, 8.5)

    unset = build_cache_records("u1", [RecommendationResult(vn_id="v2", title="t", score=1.0, match_reasons=[])], datetime(2000, 1, 1))[0]
    assert unset["predicted_rating"] is None
