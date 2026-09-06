"""Filters have to reach candidate selection, and only filtered requests may change.

Two things are asserted here, and they pull against each other:

A filtered request must be narrowed inside every candidate query. Each source truncates
with a LIMIT, so a filter applied to the rows a source returns can only subtract from an
already-chosen slice, and a filter matching a small corner of the catalogue ends up with a
handful of results even though thousands of titles qualify. The tests below read the SQL
each source emits and fail if the filter is missing from it.

An unfiltered request must emit the queries it always did, apart from the finished-only
clause the cut and the fallback carry. That clause is applied there rather than in the
sources so the sources stay join-free. The reference builders in this module are a
verbatim copy of the candidate queries as they stood before filters existed, kept here so
the comparison is against a fixed baseline rather than against the code under test. They
are a snapshot, not a second implementation: when the candidate queries genuinely change,
the snapshot changes with them and keeps proving that a request carrying no filter is
unaffected by whatever the filters added.
"""

import asyncio
from datetime import datetime

import pytest

# These tests need SQLAlchemy to compile clauses; the minimal unit venv omits
# it, so skip there. The full suite (Docker/CI) runs them.
pytest.importorskip("sqlalchemy")

from sqlalchemy import func, select
from sqlalchemy.dialects import postgresql

from app.db.models import (
    UserRecommendationCache,
    VisualNovel,
    VNCoOccurrence,
    VNSimilarity,
    VNTag,
)
from app.db.query_utils import not_in_ids
from app.db.vn_filters import parse_vn_filters
from app.services import hybrid_recommender as _hr
from app.services.hybrid_recommender import (
    HybridRecommender,
    exploration_seed,
    stable_shuffle_order,
)


@pytest.fixture(autouse=True)
def description_arm_off(monkeypatch):
    """The description arm reads a matrix rather than the database.

    It emits no statement, so nothing here can assert a filter against it, and the ids it
    nominates come from a built artefact rather than from this module's fixtures: with it
    on, what the later sources are told to exclude depends on a file. It has tests of its
    own, and the queries under test are the same either way.
    """
    monkeypatch.setattr(_hr, "DESC_RETRIEVAL", False)


class _Row:
    """Attribute-access stand-in for a SQLAlchemy result row."""

    def __init__(self, **columns):
        self.__dict__.update(columns)


class _Result:
    def __init__(self, rows):
        self._rows = list(rows)

    def all(self):
        return list(self._rows)

    def first(self):
        return self._rows[0] if self._rows else None

    def scalar_one_or_none(self):
        return self._rows[0] if self._rows else None


class _QueueSession:
    """Hands back canned results in call order and keeps every statement it saw."""

    def __init__(self, results):
        self._results = list(results)
        self.statements = []

    async def execute(self, statement):
        self.statements.append(statement)
        if not self._results:
            raise AssertionError("more queries executed than the test queued results for")
        return _Result(self._results.pop(0))


def shape(statement):
    """The compiled SQL and its bound values, in a form two builders can be compared on.

    Bound values arrive keyed by position, and an id collection reaches the compiler in set
    order, so the values are compared as a sorted mapping rather than in the order the
    compiler happened to number them.
    """
    compiled = statement.compile(dialect=postgresql.dialect())
    params = {
        key: sorted(value) if isinstance(value, list) else value
        for key, value in compiled.params.items()
    }
    return str(compiled), sorted((k, repr(v)) for k, v in params.items())


def sql(statement) -> str:
    return str(statement.compile(dialect=postgresql.dialect()))


# ---------------------------------------------------------------------------
# Fixtures shared by every run below.
# ---------------------------------------------------------------------------

EXCLUDED = {"v9"}
HIGH_RATED = ["v1", "v2", "v3"]
ELITE_TAGS = {1, 2, 3}
LIMIT = 10

SIMILARITY_IDS = [f"v{100 + i}" for i in range(6)]
EXPLORATION_IDS = [f"v{200 + i}" for i in range(3)]
ELITE_IDS = [f"v{300 + i}" for i in range(3)]
COOCCURRENCE_IDS = [f"v{400 + i}" for i in range(3)]


def _similarity_rows():
    # Deliberately tied scores: ties are where an unordered limit shows itself.
    return [
        _Row(similar_vn_id=vn_id, similarity_score=0.9 if index < 4 else 0.5)
        for index, vn_id in enumerate(SIMILARITY_IDS)
    ]


def _vn_detail_row(vn_id):
    return _Row(
        id=vn_id,
        title=f"Title {vn_id}",
        title_jp=None,
        title_romaji=None,
        image_url=None,
        image_sexual=0.0,
        rating=7.5,
        average_rating=7.4,
        votecount=120,
        length=2,
    )


def _source_results():
    return [
        _similarity_rows(),
        [_Row(id=vn_id) for vn_id in EXPLORATION_IDS],
        [_Row(vn_id=vn_id, best_score=3.0) for vn_id in ELITE_IDS],
        [
            _Row(similar_vn_id=vn_id, co_rating_score=5.0)
            for vn_id in COOCCURRENCE_IDS
        ],
    ]


def _collected_ids():
    """The candidate set the sources above produce, accumulated in the same order.

    The union is rebuilt rather than sorted because the ids reach the compiler in set
    order, and a set built by a different sequence of updates can iterate differently.
    """
    collected = set()
    collected.update(SIMILARITY_IDS)
    collected.update(EXPLORATION_IDS)
    collected.update(ELITE_IDS)
    collected.update(COOCCURRENCE_IDS)
    return collected


def _run_candidates(
    *,
    detail_rows=4,
    filters=None,
    min_rating=None,
    min_length=None,
    max_length=None,
    target_pool=None,
    extra_results=(),
):
    session = _QueueSession(
        _source_results()
        + [[_vn_detail_row(vn_id) for vn_id in SIMILARITY_IDS[:detail_rows]]]
        + list(extra_results)
    )
    recommender = HybridRecommender(session)
    candidates = asyncio.run(
        recommender._get_candidates(
            exclude_vn_ids=set(EXCLUDED),
            min_rating=min_rating,
            min_length=min_length,
            max_length=max_length,
            include_tags=None,
            exclude_tags=None,
            include_traits=None,
            exclude_traits=None,
            limit=LIMIT,
            high_rated_vns=list(HIGH_RATED),
            elite_tag_ids=set(ELITE_TAGS),
            japanese_only=True,
            spoiler_level=0,
            filters=filters,
            target_pool=target_pool,
        )
    )
    return candidates, session.statements, recommender.last_pool


# ---------------------------------------------------------------------------
# Verbatim copy of the candidate queries as they stood before filters reached them.
# ---------------------------------------------------------------------------


def _legacy_seed():
    return exploration_seed(HIGH_RATED, ELITE_TAGS)


def _legacy_similarity_query():
    return (
        select(VNSimilarity.similar_vn_id, VNSimilarity.similarity_score)
        .where(VNSimilarity.vn_id.in_(HIGH_RATED))
        .where(not_in_ids(VNSimilarity.similar_vn_id, EXCLUDED))
        .order_by(
            VNSimilarity.similarity_score.desc(),
            VNSimilarity.similar_vn_id,
            VNSimilarity.vn_id,
        )
        .limit(int(LIMIT * 0.8))
    )


def _legacy_exploration_query():
    query = select(VisualNovel.id).where(VisualNovel.rating >= 6.0)
    query = query.where(not_in_ids(VisualNovel.id, EXCLUDED))
    query = query.where(VisualNovel.olang == "ja")
    return query.order_by(
        *stable_shuffle_order(VisualNovel.id, _legacy_seed(), "exploration")
    ).limit(max(50, int(LIMIT * 0.2)) * 3)


def _legacy_elite_query(exclude):
    query = (
        select(VNTag.vn_id, func.max(VNTag.score).label("best_score"))
        .where(VNTag.tag_id.in_(ELITE_TAGS))
        .where(VNTag.spoiler_level <= 0)
        .where(VNTag.score >= 2.0)
        .where(VNTag.lie == False)  # noqa: E712
    )
    query = query.where(not_in_ids(VNTag.vn_id, exclude))
    return (
        query.group_by(VNTag.vn_id)
        .order_by(
            func.max(VNTag.score).desc(),
            *stable_shuffle_order(VNTag.vn_id, _legacy_seed(), "elite_tag"),
        )
        .limit(50)
    )


def _legacy_cooccurrence_query(exclude):
    query = (
        # The co-rating is selected as well as ordered on: it is the strength the arm
        # returns alongside each id, read off a row the query was already fetching.
        select(VNCoOccurrence.similar_vn_id, VNCoOccurrence.co_rating_score)
        .where(VNCoOccurrence.vn_id.in_(HIGH_RATED[:20]))
        .where(VNCoOccurrence.user_count >= _hr.COOCCURRENCE_MIN_USERS)
    )
    query = query.where(not_in_ids(VNCoOccurrence.similar_vn_id, exclude))
    return query.order_by(
        VNCoOccurrence.co_rating_score.desc(), VNCoOccurrence.similar_vn_id
    ).limit(100)


def _legacy_detail_columns():
    return (
        VisualNovel.id,
        VisualNovel.title,
        VisualNovel.title_jp,
        VisualNovel.title_romaji,
        VisualNovel.image_url,
        VisualNovel.image_sexual,
        VisualNovel.rating,
        VisualNovel.average_rating,
        VisualNovel.length,
        # Projected for the popularity re-ranking, which reads it after scoring. It adds
        # a column to a row the request already fetches rather than a query, which is
        # what these checks are pinning.
        VisualNovel.votecount,
    )


def _legacy_detail_query(candidate_ids):
    query = select(*_legacy_detail_columns()).where(
        VisualNovel.id.in_(candidate_ids)
    )
    query = query.where(VisualNovel.olang == "ja")
    query = query.where(VisualNovel.devstatus == 0)
    query = query.order_by(
        *stable_shuffle_order(VisualNovel.id, _legacy_seed(), "candidate_cut")
    )
    return query.limit(LIMIT)


def _legacy_fallback_query():
    query = select(*_legacy_detail_columns()).where(VisualNovel.rating.isnot(None))
    query = query.where(VisualNovel.olang == "ja")
    query = query.where(VisualNovel.devstatus == 0)
    query = query.order_by(VisualNovel.rating.desc(), VisualNovel.id)
    return query.limit(LIMIT)


# ---------------------------------------------------------------------------
# An unfiltered request is unchanged.
# ---------------------------------------------------------------------------


def test_unfiltered_run_emits_the_queries_it_always_did(monkeypatch):
    # The published draw is stratified and the published cut keeps each source's share,
    # and both are different statements by design. What this guards is the older shape,
    # still reachable, so a filter can be shown to change nothing about which rows a plain
    # request collects.
    monkeypatch.setattr(_hr, "EXPLORATION_STRATIFIED", False)
    monkeypatch.setattr(_hr, "EXPLORATION_OPEN", False)
    monkeypatch.setattr(_hr, "CANDIDATE_CUT_BY_SOURCE", False)
    _, statements, _ = _run_candidates()
    assert len(statements) == 5, "an unfiltered request must take one collection pass"

    similarity_ids = set(SIMILARITY_IDS)
    after_exploration = set(similarity_ids)
    after_exploration.update(EXPLORATION_IDS)
    after_elite = set(after_exploration)
    after_elite.update(ELITE_IDS)

    expected = [
        _legacy_similarity_query(),
        _legacy_exploration_query(),
        _legacy_elite_query(EXCLUDED.union(after_exploration)),
        _legacy_cooccurrence_query(EXCLUDED.union(after_elite)),
        _legacy_detail_query(_collected_ids()),
    ]
    for actual, reference in zip(statements, expected):
        assert shape(actual) == shape(reference)


def test_unfiltered_run_joins_nothing_to_visual_novels():
    # The join only earns its place when there is a predicate to hang on it.
    _, statements, _ = _run_candidates()
    for statement in statements[:4]:
        assert "JOIN visual_novels" not in sql(statement)


def test_unfiltered_fallback_query_is_unchanged():
    session = _QueueSession([[], [_vn_detail_row("v600")]])
    recommender = HybridRecommender(session)
    asyncio.run(
        recommender._get_candidates(
            exclude_vn_ids=set(),
            min_rating=None,
            min_length=None,
            max_length=None,
            include_tags=None,
            exclude_tags=None,
            include_traits=None,
            exclude_traits=None,
            limit=LIMIT,
            high_rated_vns=None,
            elite_tag_ids=None,
            japanese_only=True,
            spoiler_level=0,
        )
    )
    assert shape(session.statements[-1]) == shape(_legacy_fallback_query())


def test_unfiltered_run_reports_an_unfiltered_pool():
    _, _, pool = _run_candidates()
    assert pool["filtered"] is False
    assert pool["widened"] is False
    assert pool["topped_up"] is False


# ---------------------------------------------------------------------------
# A filter reaches candidate selection.
# ---------------------------------------------------------------------------


def _platform_filters():
    return parse_vn_filters(platform="ps2")


def test_platform_filter_reaches_every_candidate_source():
    _, statements, _ = _run_candidates(filters=_platform_filters(), detail_rows=6)
    # The four sources plus the detail query: the filter has to be inside each of them,
    # or that source spends its limit on rows the filter will discard afterwards.
    for statement in statements[:5]:
        rendered = sql(statement)
        assert "release_platforms" in rendered, f"filter missing from source: {rendered}"


def test_similarity_and_cooccurrence_sources_join_for_the_filter():
    # Both read a similarity table rather than visual_novels, so the predicate needs the
    # join to have a column to sit on. Filtering them at the detail query instead would
    # leave them selecting rows the filter then throws away.
    _, statements, _ = _run_candidates(filters=_platform_filters(), detail_rows=6)
    similarity_sql = sql(statements[0])
    cooccurrence_sql = sql(statements[3])
    assert "JOIN visual_novels" in similarity_sql
    assert "vn_similarities.similar_vn_id = visual_novels.id" in similarity_sql
    assert "JOIN visual_novels" in cooccurrence_sql
    assert "vn_cooccurrence.similar_vn_id = visual_novels.id" in cooccurrence_sql


def test_source_limits_are_unchanged_by_a_filter_on_the_first_pass():
    # Widening is what answers a thin pool; the first pass must not quietly enlarge the
    # sources, or every filtered request pays for a pool it did not need.
    _, statements, _ = _run_candidates(filters=_platform_filters(), detail_rows=6)
    filtered = statements[0].compile(dialect=postgresql.dialect()).params
    assert int(LIMIT * 0.8) in filtered.values()


def test_min_rating_is_pushed_into_the_sources_too():
    # It predates the shared vocabulary and arrives as its own argument, so it is the one
    # filter that could be left applying only at the end.
    _, statements, _ = _run_candidates(min_rating=8.0, detail_rows=6)
    assert "coalesce(visual_novels.average_rating, visual_novels.rating) >=" in sql(statements[0])


def test_entity_filters_reach_the_sources():
    filters = parse_vn_filters(developer="p1")
    _, statements, _ = _run_candidates(filters=filters, detail_rows=6)
    assert "release_producers" in sql(statements[0])


def test_difficulty_filter_restricts_to_analysed_titles_in_the_sources():
    filters = parse_vn_filters(min_difficulty=3.0)
    _, statements, _ = _run_candidates(filters=filters, detail_rows=6)
    assert "vn_difficulty" in sql(statements[0])


# ---------------------------------------------------------------------------
# Starvation: a narrow filter still returns a usefully sized list.
# ---------------------------------------------------------------------------


def _deep_source_results():
    """Source results wide enough that a widened pass still queries the same five sources.

    The precomputed similarity table hands over to live tag matching once it returns less
    than half of what was asked for, and a widened pass asks for several times more. That
    hand-off is wanted in production and adds queries of its own; here it would only blur
    which statement belongs to which pass.
    """
    deep = [
        _Row(similar_vn_id=f"v{1000 + i}", similarity_score=0.9)
        for i in range(200)
    ]
    return [deep] + _source_results()[1:]


def _run_with_pass_sizes(sizes, target_pool, top_up_rows=None):
    """Drive one collection pass per entry in `sizes`, each yielding that many rows."""
    results = []
    for size in sizes:
        results.extend(_deep_source_results())
        results.append([_vn_detail_row(f"v{700 + i}") for i in range(size)])
    if top_up_rows is not None:
        results.append([_vn_detail_row(f"v{800 + i}") for i in range(top_up_rows)])

    session = _QueueSession(results)
    recommender = HybridRecommender(session)
    candidates = asyncio.run(
        recommender._get_candidates(
            exclude_vn_ids=set(EXCLUDED),
            min_rating=None,
            min_length=None,
            max_length=None,
            include_tags=None,
            exclude_tags=None,
            include_traits=None,
            exclude_traits=None,
            limit=LIMIT,
            high_rated_vns=list(HIGH_RATED),
            elite_tag_ids=set(ELITE_TAGS),
            japanese_only=True,
            spoiler_level=0,
            filters=_platform_filters(),
            target_pool=target_pool,
        )
    )
    return candidates, session.statements, recommender.last_pool


def test_a_thin_filtered_pool_is_collected_again_with_wider_limits():
    candidates, statements, pool = _run_with_pass_sizes([2, 6], target_pool=5)
    assert len(statements) == 10, "the second pass must re-run every source"
    assert len(candidates) == 6
    assert pool["widened"] is True
    assert pool["thin"] is False


def test_widening_stops_as_soon_as_the_page_is_filled():
    candidates, statements, pool = _run_with_pass_sizes([6], target_pool=5)
    assert len(statements) == 5
    assert pool["widened"] is False
    assert len(candidates) == 6


def test_each_widened_pass_asks_its_sources_for_more():
    _, statements, _ = _run_with_pass_sizes([2, 6], target_pool=5)
    first = statements[0].compile(dialect=postgresql.dialect()).params
    second = statements[5].compile(dialect=postgresql.dialect()).params
    assert max(v for v in second.values() if isinstance(v, int)) > max(
        v for v in first.values() if isinstance(v, int)
    )


def test_a_filter_the_sources_cannot_satisfy_is_topped_up_on_quality():
    # Three passes of two rows each: the reader's own similarity graph simply holds too
    # few matching titles, so the page is completed from matching titles ranked on rating.
    candidates, statements, pool = _run_with_pass_sizes(
        [2, 2, 2], target_pool=5, top_up_rows=4
    )
    assert len(statements) == 16, "three collection passes plus one top-up query"
    assert pool["topped_up"] is True
    assert len(candidates) == 6
    top_up_sql = sql(statements[-1])
    assert "release_platforms" in top_up_sql, "the top-up must honour the filter"
    assert "ORDER BY visual_novels.rating DESC" in top_up_sql


def test_an_unfilled_filtered_pool_is_reported_as_thin():
    _, _, pool = _run_with_pass_sizes([1, 1, 1], target_pool=5, top_up_rows=0)
    assert pool["filtered"] is True
    assert pool["thin"] is True
    assert pool["candidates"] == 1


def test_an_unfiltered_request_is_never_widened_or_topped_up():
    # Widening is the answer to a filter, not to a reader whose profile is simply small.
    candidates, statements, pool = _run_candidates(detail_rows=1, target_pool=5)
    assert len(statements) == 5
    assert pool["widened"] is False
    assert pool["topped_up"] is False
    assert len(candidates) == 1


# ---------------------------------------------------------------------------
# The cache serves filtered requests.
# ---------------------------------------------------------------------------


def _cache_statement(**kwargs):
    from app.api.v1.recommendations import get_cached_recommendations

    session = _QueueSession([[]])
    asyncio.run(
        get_cached_recommendations(
            db=session,
            user_id="u1",
            exclude_vn_ids=set(),
            limit=10,
            cutoff=datetime(2000, 1, 1),
            **kwargs,
        )
    )
    return sql(session.statements[0])


def test_cached_rows_are_filtered_by_the_shared_vocabulary():
    # Every filter is a predicate over a visual novel, and the cache query already joins
    # them, so a filtered request stays servable from cache instead of forcing a recompute.
    rendered = _cache_statement(filters=parse_vn_filters(platform="ps2"))
    assert "release_platforms" in rendered


def test_cached_rows_are_filtered_by_rating_and_year():
    rendered = _cache_statement(
        filters=parse_vn_filters(min_rating=7.0, year_min=2005)
    )
    assert "coalesce(visual_novels.average_rating, visual_novels.rating) >=" in rendered
    assert "EXTRACT" in rendered.upper()


def test_cache_query_without_filters_is_unchanged():
    with_none = _cache_statement(filters=None)
    with_empty = _cache_statement(filters=parse_vn_filters(devstatus=None, nsfw=True))
    assert with_none == with_empty
    assert "release_platforms" not in with_none
    assert UserRecommendationCache.__tablename__ in with_none


# ---------------------------------------------------------------------------
# Overlapping filters resolve one way only.
# ---------------------------------------------------------------------------


def test_named_length_buckets_supersede_the_numeric_range():
    from app.api.v1.recommendations import resolve_filter_overlaps

    spec = parse_vn_filters(length="short")
    assert resolve_filter_overlaps(spec, 4, 5, True) == (None, None, True)


def test_excluded_length_buckets_supersede_the_numeric_range_too():
    from app.api.v1.recommendations import resolve_filter_overlaps

    spec = parse_vn_filters(exclude_length="very_long")
    assert resolve_filter_overlaps(spec, 1, 3, True) == (None, None, True)


def test_the_numeric_range_survives_without_a_named_bucket():
    from app.api.v1.recommendations import resolve_filter_overlaps

    spec = parse_vn_filters(platform="ps2")
    assert resolve_filter_overlaps(spec, 1, 3, True) == (1, 3, True)


def test_naming_a_language_supersedes_the_japanese_shorthand():
    from app.api.v1.recommendations import resolve_filter_overlaps

    spec = parse_vn_filters(olang="en")
    assert resolve_filter_overlaps(spec, None, None, True) == (None, None, False)


def test_the_japanese_shorthand_survives_without_a_named_language():
    from app.api.v1.recommendations import resolve_filter_overlaps

    spec = parse_vn_filters(platform="ps2")
    assert resolve_filter_overlaps(spec, None, None, True) == (None, None, True)


# ---------------------------------------------------------------------------
# Defaults that would silently narrow an existing reader's list.
# ---------------------------------------------------------------------------


def test_the_recommendation_defaults_add_no_predicate():
    # The search page hides adult titles and assumes finished ones. Taking either default
    # here would drop titles from every existing reader's list without them asking.
    spec = parse_vn_filters(devstatus=None, nsfw=True)
    from app.db.vn_filters import vn_filter_predicates

    assert vn_filter_predicates(spec) == []
