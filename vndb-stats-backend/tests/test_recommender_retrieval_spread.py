"""Retrieval switches that decide where on the popularity range the pool is drawn from.

Each one has to be inert at its default and to do a single, nameable thing when it is not,
so a run that sets one measures that one. The default shapes are asserted against the
statements the sources emit rather than against the switch reading its own default back,
since a switch whose default path differs even slightly makes every comparison a
comparison of two unknown configurations.
"""

import asyncio

import pytest

pytest.importorskip("sqlalchemy")

from sqlalchemy.dialects import postgresql

from app.services import hybrid_recommender as engine
from app.services.hybrid_recommender import (
    HybridRecommender,
    POPULARITY_BAND_COUNT,
    _env_shares,
    allocate_shares,
    spread_seeds,
    switch_settings,
)


class _Row:
    def __init__(self, **columns):
        self.__dict__.update(columns)


class _Result:
    def __init__(self, rows):
        self._rows = list(rows)

    def all(self):
        return list(self._rows)


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


EXCLUDED = {"v9"}
HIGH_RATED = ["v1", "v2", "v3"]
ELITE_TAGS = {1, 2, 3}
LIMIT = 10

SIMILARITY_IDS = [f"v{100 + i}" for i in range(6)]
EXPLORATION_IDS = [f"v{200 + i}" for i in range(3)]
ELITE_IDS = [f"v{300 + i}" for i in range(3)]
COOCCURRENCE_IDS = [f"v{400 + i}" for i in range(3)]


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


def _run_candidates(*, seed_vns=None):
    """One unfiltered collection pass, returning the statements it emitted."""
    session = _QueueSession(
        [
            [
                _Row(similar_vn_id=vn_id, similarity_score=0.9)
                for vn_id in SIMILARITY_IDS
            ],
            [_Row(id=vn_id) for vn_id in EXPLORATION_IDS],
            [_Row(vn_id=vn_id) for vn_id in ELITE_IDS],
            [_Row(similar_vn_id=vn_id) for vn_id in COOCCURRENCE_IDS],
            [_vn_detail_row(vn_id) for vn_id in SIMILARITY_IDS[:4]],
        ]
    )
    recommender = HybridRecommender(session)
    asyncio.run(
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
            seed_vns=seed_vns,
        )
    )
    return session.statements


def sql(statement) -> str:
    return str(statement.compile(dialect=postgresql.dialect()))


def params(statement):
    return statement.compile(dialect=postgresql.dialect()).params


def scalar_params(statement):
    """Bound values a quota can be looked for in; id collections arrive as lists."""
    return {
        value
        for value in params(statement).values()
        if isinstance(value, (int, float)) and not isinstance(value, bool)
    }


# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------


def test_retrieval_switches_default_to_the_behaviour_they_replace():
    """The switches that were measured as neutral or harmful ship off.

    Two exceptions, both deliberate and both measured. An equal quota per band is not a
    neutral stratification of a catalogue whose least-read band holds most of it, so the
    broad draw ships proportional to what there is to draw from. And every reader's
    best-known titles come from the same few hundred, so seeding the related sources on
    rank asks nearly the same question for everybody; spreading the seeds over each
    reader's own range is what makes their neighbourhood theirs.
    """
    settings = switch_settings()
    assert settings["REC_CANDIDATE_CUT_BAND_SHARES"] == ()
    assert settings["REC_SOURCE_OLANG_PUSHDOWN"] is False
    assert settings["REC_RETRIEVAL_SEED_SPREAD"] is True
    assert settings["REC_DESC_RETRIEVAL_BAND_SHARES"] == ()

    shares = settings["REC_EXPLORATION_BAND_SHARES"]
    assert len(shares) == engine.POPULARITY_BAND_COUNT
    assert sum(shares) == pytest.approx(1.0)
    # Least read first, and every band still reachable.
    assert list(shares) == sorted(shares, reverse=True)
    assert all(share > 0 for share in shares)
    assert shares[0] > 10 * shares[-1], "the draw follows the catalogue's own shape"


# ---------------------------------------------------------------------------
# Share vectors
# ---------------------------------------------------------------------------


def test_env_shares_rejects_anything_that_is_not_an_allocation(monkeypatch):
    monkeypatch.setenv("REC_TEST_SHARES", "")
    assert _env_shares("REC_TEST_SHARES", 3) == ()
    monkeypatch.setenv("REC_TEST_SHARES", "1,2")
    assert _env_shares("REC_TEST_SHARES", 3) == (), "wrong length partitions nothing"
    monkeypatch.setenv("REC_TEST_SHARES", "1,-2,3")
    assert _env_shares("REC_TEST_SHARES", 3) == ()
    monkeypatch.setenv("REC_TEST_SHARES", "0,0,0")
    assert _env_shares("REC_TEST_SHARES", 3) == ()
    monkeypatch.setenv("REC_TEST_SHARES", "1,x,3")
    assert _env_shares("REC_TEST_SHARES", 3) == ()
    # Order carries meaning here, so a descending list is admitted where the ascending
    # reader used for band edges would reject it.
    monkeypatch.setenv("REC_TEST_SHARES", "0.8,0.15,0.05")
    assert _env_shares("REC_TEST_SHARES", 3) == (0.8, 0.15, 0.05)


def test_allocate_shares_splits_the_whole_budget():
    quotas = allocate_shares(100, (0.838, 0.122, 0.028, 0.009, 0.003))
    assert sum(quotas) == 100
    assert quotas[0] > quotas[1] > quotas[2]
    # A share too small to floor to a place still keeps one: naming a band asks for it.
    assert quotas[-1] >= 1
    # Equal shares reproduce the equal quota they replace.
    assert allocate_shares(100, (1, 1, 1, 1, 1)) == (20, 20, 20, 20, 20)
    # A zero share excludes its band outright.
    assert allocate_shares(10, (1, 0)) == (10, 0)
    assert allocate_shares(0, (1, 1)) == (0, 0)


def test_allocate_shares_is_a_function_of_its_inputs():
    shares = (0.4, 0.31, 0.29)
    assert allocate_shares(37, shares) == allocate_shares(37, shares)


# ---------------------------------------------------------------------------
# The broad draw's quota per band
# ---------------------------------------------------------------------------


def test_exploration_draw_takes_a_quota_per_band_at_its_default():
    """The shipped draw chooses its quota per band rather than binding one for all of them."""
    exploration = sql(_run_candidates()[1])
    assert "WHEN (anon_1.band =" in exploration, exploration


def test_an_equal_share_vector_restores_the_one_quota_draw(monkeypatch):
    """The behaviour the shares replace stays reachable, so the change stays measurable."""
    monkeypatch.setattr(engine, "EXPLORATION_BAND_SHARES", ())
    exploration = sql(_run_candidates()[1])
    assert "in_band <=" in exploration
    # A single bound quota, not one chosen per band.
    assert "CASE WHEN" not in exploration.upper().split("IN_BAND <=")[-1]


def test_exploration_draw_takes_a_share_per_band_when_one_is_set(monkeypatch):
    monkeypatch.setattr(
        engine, "EXPLORATION_BAND_SHARES", (0.838, 0.122, 0.028, 0.009, 0.003)
    )
    exploration = sql(_run_candidates()[1])
    assert "WHEN (anon_1.band =" in exploration, exploration
    bound = scalar_params(_run_candidates()[1])
    # The draw is 450 wide at this page size, so the least-read band's quota dwarfs the
    # best-known one's rather than matching it.
    quotas = allocate_shares(max(50, int(LIMIT * 0.2)) * 3, (0.838, 0.122, 0.028, 0.009, 0.003))
    assert quotas[0] in bound and quotas[-1] in bound
    assert quotas[0] > 10 * quotas[-1]


def test_exploration_band_shares_do_not_change_the_draw_size(monkeypatch):
    # The shares redistribute the draw between bands; they must not enlarge it, or a
    # measured comparison is against a wider pool rather than a differently placed one.
    total = max(50, int(LIMIT * 0.2)) * 3
    quotas = allocate_shares(total, (0.838, 0.122, 0.028, 0.009, 0.003))
    assert sum(quotas) == total


# ---------------------------------------------------------------------------
# The cut's spread over the bands
# ---------------------------------------------------------------------------


def test_candidate_cut_keeps_each_source_its_share_by_default():
    """The union is wider than the pool, so an even slice would undo the split above it."""
    detail = sql(_run_candidates()[4])
    assert "ROW_NUMBER" in detail.upper()
    assert "in_bucket <=" in detail


def test_candidate_cut_falls_back_to_an_even_slice(monkeypatch):
    monkeypatch.setattr(engine, "CANDIDATE_CUT_BY_SOURCE", False)
    detail = sql(_run_candidates()[4])
    assert "ROW_NUMBER" not in detail.upper()
    assert "md5" in detail


def test_candidate_cut_serves_each_band_its_share_when_one_is_set(monkeypatch):
    monkeypatch.setattr(engine, "CANDIDATE_CUT_BY_SOURCE", False)
    monkeypatch.setattr(
        engine, "CANDIDATE_CUT_BAND_SHARES", (0.5, 0.2, 0.15, 0.1, 0.05)
    )
    detail = sql(_run_candidates()[4])
    assert "ROW_NUMBER" in detail.upper()
    assert "PARTITION BY" in detail.upper()
    # Rows past a band's quota keep their place behind the served ones, so a band the
    # union could not fill hands its slots back instead of shortening the pool.
    assert "in_band <=" in detail
    quotas = allocate_shares(LIMIT, (0.5, 0.2, 0.15, 0.1, 0.05))
    assert sum(quotas) == LIMIT
    bound = scalar_params(_run_candidates()[4])
    assert quotas[0] in bound


def test_priority_share_takes_precedence_over_the_band_cut(monkeypatch):
    # All three partition the same slots, so a request takes one of them. They are tried
    # source share, priority share, band share.
    monkeypatch.setattr(engine, "CANDIDATE_CUT_BY_SOURCE", False)
    monkeypatch.setattr(engine, "CANDIDATE_CUT_BAND_SHARES", (1, 1, 1, 1, 1))
    monkeypatch.setattr(engine, "CANDIDATE_CUT_PRIORITY_SHARE", 0.5)
    detail = sql(_run_candidates()[4])
    assert "bucket" in detail
    assert "in_band" not in detail


def test_the_source_share_takes_precedence_over_both(monkeypatch):
    monkeypatch.setattr(engine, "CANDIDATE_CUT_BAND_SHARES", (1, 1, 1, 1, 1))
    monkeypatch.setattr(engine, "CANDIDATE_CUT_PRIORITY_SHARE", 0.5)
    detail = sql(_run_candidates()[4])
    assert "in_bucket <=" in detail
    assert "in_band" not in detail


# ---------------------------------------------------------------------------
# The language restriction inside the sources
# ---------------------------------------------------------------------------


SOURCE_INDEXES = {"similarity": 0, "elite": 2, "cooccurrence": 3}


def test_sources_are_language_blind_by_default():
    statements = _run_candidates()
    for index in SOURCE_INDEXES.values():
        rendered = sql(statements[index])
        assert "olang" not in rendered
        assert "JOIN visual_novels" not in rendered


def test_pushdown_restricts_every_source_that_reaches_visual_novels(monkeypatch):
    monkeypatch.setattr(engine, "SOURCE_OLANG_PUSHDOWN", True)
    statements = _run_candidates()
    for name, index in SOURCE_INDEXES.items():
        rendered = sql(statements[index])
        assert "visual_novels.olang" in rendered, f"{name}: {rendered}"
        assert "JOIN visual_novels" in rendered, f"{name}: {rendered}"
    # The broad draw already carries the restriction and must not gain a second copy.
    exploration = sql(statements[1])
    assert exploration.count("visual_novels.olang") == 1


def test_pushdown_leaves_the_source_limits_alone(monkeypatch):
    monkeypatch.setattr(engine, "SOURCE_OLANG_PUSHDOWN", True)
    statements = _run_candidates()
    assert int(LIMIT * 0.8) in params(statements[0]).values()
    assert 50 in params(statements[2]).values()
    assert 100 in params(statements[3]).values()


def test_pushdown_is_not_applied_to_a_request_that_wants_every_language(monkeypatch):
    monkeypatch.setattr(engine, "SOURCE_OLANG_PUSHDOWN", True)
    session = _QueueSession(
        [
            [_Row(similar_vn_id=vn_id, similarity_score=0.9) for vn_id in SIMILARITY_IDS],
            [_Row(id=vn_id) for vn_id in EXPLORATION_IDS],
            [_Row(vn_id=vn_id) for vn_id in ELITE_IDS],
            [_Row(similar_vn_id=vn_id) for vn_id in COOCCURRENCE_IDS],
            [_vn_detail_row(vn_id) for vn_id in SIMILARITY_IDS[:4]],
        ]
    )
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
            high_rated_vns=list(HIGH_RATED),
            elite_tag_ids=set(ELITE_TAGS),
            japanese_only=False,
            spoiler_level=0,
        )
    )
    assert "olang" not in sql(session.statements[0])


# ---------------------------------------------------------------------------
# Seeds drawn across the reader's own range
# ---------------------------------------------------------------------------


def _votecount_for_band(band: int) -> int:
    """A vote count landing squarely inside the named band."""
    thresholds = engine.POPULARITY_BAND_THRESHOLDS
    if band == 0:
        return 0
    return thresholds[band - 1]


def test_spread_seeds_reaches_every_band_the_reader_occupies():
    scores = {}
    votecounts = {}
    for band in range(POPULARITY_BAND_COUNT):
        for rank in range(10):
            vn_id = f"v{band}{rank}"
            # Best-known band rated highest, so rank order alone would return it alone.
            scores[vn_id] = band + rank / 100.0
            votecounts[vn_id] = _votecount_for_band(band)
    picked = spread_seeds(scores, votecounts, POPULARITY_BAND_COUNT)
    assert len(picked) == POPULARITY_BAND_COUNT
    assert {engine.popularity_band(votecounts[vn_id]) for vn_id in picked} == set(
        range(POPULARITY_BAND_COUNT)
    )
    # Rank inside a band still decides which of its titles is taken.
    assert all(vn_id.endswith("9") for vn_id in picked)


def test_spread_seeds_keeps_the_reader_who_reads_in_one_band():
    scores = {f"v{rank}": rank for rank in range(10)}
    votecounts = {vn_id: 5 for vn_id in scores}
    assert spread_seeds(scores, votecounts, 3) == ["v9", "v8", "v7"]


def test_spread_seeds_tops_up_from_rank_when_the_bands_run_out():
    scores = {f"v{rank}": rank for rank in range(4)}
    votecounts = {"v3": 0, "v2": 0}
    picked = spread_seeds(scores, votecounts, 4)
    assert sorted(picked) == ["v0", "v1", "v2", "v3"]
    # A title the catalogue cannot place is held back for the top-up rather than counted
    # into a band it is not known to belong to.
    assert picked == ["v3", "v2", "v1", "v0"]


def test_spread_seeds_hands_back_the_readers_own_order():
    scores = {"a": 9.0, "b": 5.0, "c": 7.0}
    votecounts = {"a": 0, "b": 0, "c": 0}
    assert spread_seeds(scores, votecounts, 3) == ["a", "c", "b"]


def test_spread_seeds_reach_the_related_sources_only():
    # The salt is taken from the reader's favourites either way, so a request that
    # changes the seeds changes what the related sources return without redrawing the
    # broad slice.
    plain = _run_candidates()
    spread = _run_candidates(seed_vns=["v7", "v8"])
    assert sorted(params(spread[0])["vn_id_1"]) == ["v7", "v8"]
    assert sql(plain[1]) == sql(spread[1])
    assert params(plain[1]) == params(spread[1])
