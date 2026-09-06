"""Corrections to the scoring path that each carry a claim worth pinning.

Three of the checks below assert that a change made for speed did not move an answer, which
is the only interesting property such a change has. The rest pin behaviour that a reader can
see: which candidates reach the scorer, and what the diversity term does with a title the
catalogue has not described.
"""

import asyncio
import math

import pytest
from sqlalchemy.dialects import postgresql

from app.services import hybrid_recommender as engine
from app.services.hybrid_recommender import (
    HybridRecommender,
    RecommendationResult,
    _TagSimilarityCache,
    popularity_band,
    popularity_band_expression,
    tag_cosine,
    tag_vector_magnitude,
    weight_total,
)


def sql(statement) -> str:
    return str(statement.compile(dialect=postgresql.dialect()))


def bound(statement) -> list:
    """The literal values a statement carries, which arrive as bind parameters."""
    return list(statement.compile(dialect=postgresql.dialect()).params.values())


def _result(vn_id: str, score: float) -> RecommendationResult:
    return RecommendationResult(vn_id=vn_id, title=vn_id, score=score, match_reasons=[])


# ---------------------------------------------------------------------------
# Popularity bands
# ---------------------------------------------------------------------------


def _band_by_logarithm(votecount, edges):
    """The band read off the logarithm, which is what the thresholds stand in for."""
    value = math.log10(max(0, votecount or 0) + 1)
    band = 0
    for edge in edges:
        if value < edge:
            break
        band += 1
    return band


def test_integer_thresholds_place_every_reachable_vote_count_where_the_logarithm_does():
    """The band is read from the count itself, and has to agree with the edge it encodes.

    Swept over the whole range vote counts occupy rather than sampled, because a threshold
    that is wrong is wrong for exactly one count.
    """
    edges = engine.POPULARITY_BAND_EDGES
    mismatched = [
        count
        for count in range(0, 100_000)
        if _band_by_logarithm(count, edges) != popularity_band(count)
    ]
    assert mismatched == []
    assert popularity_band(None) == popularity_band(0) == 0


def test_the_band_query_carries_no_logarithm():
    """The comparison is against the count, which is indexed, not against its logarithm."""
    labelled = popularity_band_expression().label("band")
    assert "log" not in sql(labelled).lower()
    values = bound(labelled)
    for threshold in engine.POPULARITY_BAND_THRESHOLDS:
        assert threshold in values


def test_the_two_band_readings_share_one_set_of_thresholds():
    """A boundary that differed between selection and scoring would aim the page wrong."""
    assert len(engine.POPULARITY_BAND_THRESHOLDS) == len(engine.POPULARITY_BAND_EDGES)
    assert list(engine.POPULARITY_BAND_THRESHOLDS) == sorted(
        engine.POPULARITY_BAND_THRESHOLDS
    )


# ---------------------------------------------------------------------------
# Tag similarity: memoised, and still the same number
# ---------------------------------------------------------------------------


VECTORS = {
    "a": {1: 3.0, 2: 1.5, 5: 0.5},
    "b": {2: 2.0, 5: 2.5, 9: 1.0},
    "c": {1: 1.0, 9: 3.0},
    "d": {7: 2.0},
    "empty": {},
}


def test_the_cache_returns_what_the_uncached_computation_returns():
    """Bit for bit, since the value feeds a comparison that decides a selection."""
    cache = _TagSimilarityCache(VECTORS)
    for left in VECTORS:
        for right in VECTORS:
            direct = tag_cosine(VECTORS[left], VECTORS[right])
            assert cache.between(left, right) == direct
            # A repeat answer comes from the cache and has to be the first answer.
            assert cache.between(left, right) == direct


def test_a_magnitude_is_the_length_of_the_vector():
    assert tag_vector_magnitude({}) == 0.0
    assert tag_vector_magnitude({1: 3.0, 2: 4.0}) == pytest.approx(5.0)
    cache = _TagSimilarityCache(VECTORS)
    assert cache.magnitude("a") == tag_vector_magnitude(VECTORS["a"])
    assert cache.magnitude("missing") == 0.0


def test_an_absent_vector_measures_no_distance():
    """Zero here is an absence of evidence, which the re-rank has to tell from a measurement."""
    assert tag_cosine({}, {1: 1.0}) == 0.0
    assert tag_cosine({1: 1.0}, {}) == 0.0
    # Disjoint vectors are a measurement, and also zero.
    assert tag_cosine({1: 1.0}, {2: 1.0}) == 0.0


def _rerank(pool, tags, limit, diversity_weight=0.3):
    recommender = HybridRecommender(db=None)
    selected = asyncio.run(
        recommender._apply_diversity_reranking(
            recommendations=list(pool),
            all_tags=tags,
            limit=limit,
            diversity_weight=diversity_weight,
        )
    )
    return [result.vn_id for result in selected]


def _rerank_reference(pool, tags, limit, diversity_weight=0.3):
    """The selection written out plainly, with nothing reused between comparisons."""
    remaining = list(pool)
    opening = max(range(len(remaining)), key=lambda i: remaining[i].score)
    selected = [remaining.pop(opening)]
    while len(selected) < limit and remaining:
        best_idx, best_key = 0, (-math.inf, -math.inf)
        for idx, candidate in enumerate(remaining):
            candidate_tags = tags.get(candidate.vn_id, {})
            if not candidate_tags:
                diversity = engine.DIVERSITY_UNTAGGED
            else:
                frontier = selected[-10:]
                diversity = 1.0 - max(
                    tag_cosine(candidate_tags, tags.get(item.vn_id, {}))
                    for item in frontier
                )
            blend = (1 - diversity_weight) * candidate.score + diversity_weight * diversity
            if (blend, blend) > best_key:
                best_key, best_idx = (blend, blend), idx
        selected.append(remaining.pop(best_idx))
    return [result.vn_id for result in selected]


def test_the_memoised_pass_selects_what_the_plain_one_selects():
    """Reusing a magnitude across comparisons must not move the page."""
    pool = [_result(vn_id, 9.0 - index) for index, vn_id in enumerate("abcd")]
    pool.append(_result("empty", 5.0))
    assert _rerank(pool, VECTORS, limit=5) == _rerank_reference(pool, VECTORS, limit=5)


# ---------------------------------------------------------------------------
# Diversity of a title the catalogue has not described
# ---------------------------------------------------------------------------


def test_an_untagged_title_takes_the_full_diversity_bonus_by_default():
    """The default is the arithmetic it replaces, so an unswitched run is unchanged."""
    assert engine.DIVERSITY_UNTAGGED == 1.0


def test_lowering_the_untagged_bonus_moves_the_untagged_title_down(monkeypatch):
    """A title with no vector is credited with whatever the switch says, not the maximum."""
    tags = {"tagged1": {1: 3.0}, "tagged2": {1: 3.0}, "bare": {}}
    # The bare title is scored below both others, so only the diversity term can lift it.
    # The gap between the two lower scores is small on purpose: relevance reaches the blend
    # unscaled on this path, so the bounded diversity term decides only a near-tie.
    pool = [_result("tagged1", 9.0), _result("tagged2", 8.05), _result("bare", 8.0)]

    assert _rerank(pool, tags, limit=2)[1] == "bare"
    monkeypatch.setattr(engine, "DIVERSITY_UNTAGGED", 0.0)
    assert _rerank(pool, tags, limit=2)[1] == "tagged2"


# ---------------------------------------------------------------------------
# What reaches the scorer
# ---------------------------------------------------------------------------


def test_a_repeated_credit_is_one_person(monkeypatch):
    """One person can hold several credits on a title; counted twice they are two people."""
    recommender = HybridRecommender(db=None)
    captured = {}

    class _Session:
        async def execute(self, statement):
            captured["sql"] = sql(statement)
            raise RuntimeError("stop after the statement is built")

    recommender.db = _Session()
    assert asyncio.run(recommender._batch_get_vn_staff(["v1"])) == {}
    assert "DISTINCT" in captured["sql"]


def test_the_elite_tag_draw_does_not_open_on_a_catalogue_order_prefix():
    """Most qualifying rows share the top tag score, so the tie-break is most of the draw.

    Ordering on the id alone would hand every reader sharing one common tag the same
    opening stretch of the table.
    """
    recommender = HybridRecommender(db=None)
    captured = {}

    class _Session:
        async def execute(self, statement):
            captured["sql"] = sql(statement)
            raise RuntimeError("stop after the statement is built")

    recommender.db = _Session()
    with pytest.raises(RuntimeError):
        asyncio.run(
            recommender._get_elite_tag_candidates(
                elite_tag_ids={1, 2},
                exclude_vn_ids=set(),
                limit=50,
                seed="a-reader",
            )
        )
    ordering = captured["sql"].split("ORDER BY")[1]
    assert "md5" in ordering


def test_the_candidate_cut_is_source_blind_at_its_default():
    """The default is one ordering over the whole union, as it is without the switch."""
    assert engine.CANDIDATE_CUT_PRIORITY_SHARE == 0.0


def test_a_priority_share_reserves_slots_for_the_reader_derived_sources(monkeypatch):
    """The union is mostly broad-draw ids, so an even slice is mostly broad-draw ids."""
    monkeypatch.setattr(engine, "CANDIDATE_CUT_PRIORITY_SHARE", 0.6)
    recommender = HybridRecommender(db=None)
    captured = {}

    class _Session:
        async def execute(self, statement):
            captured["sql"] = sql(statement)
            raise RuntimeError("stop after the statement is built")

    recommender.db = _Session()
    with pytest.raises(RuntimeError):
        asyncio.run(
            recommender._fetch_candidate_details(
                candidate_ids={"v1", "v2", "v3"},
                limit=10,
                predicates=[],
                min_length=None,
                max_length=None,
                japanese_only=True,
                seed="a-reader",
                priority_ids={"v1"},
            )
        )
    rendered = captured["sql"]
    assert "row_number() OVER" in rendered
    assert "PARTITION BY" in rendered


# ---------------------------------------------------------------------------
# The trait term
# ---------------------------------------------------------------------------


def test_the_trait_signal_ships_on():
    """Its weight is part of the total every stored result was measured against."""
    assert engine.TRAIT_SIGNAL is True
    assert engine.SIGNAL_WEIGHTS["trait"] > 0
    assert weight_total(engine.SIGNAL_WEIGHTS) == engine.MAX_WEIGHTED_SCORE


def test_standing_the_trait_signal_down_stands_its_query_down_too(monkeypatch):
    """Off, a title has no trait evidence, so nothing is loaded to score it from."""
    monkeypatch.setattr(engine, "TRAIT_SIGNAL", False)

    class _Session:
        async def execute(self, *args, **kwargs):
            raise AssertionError("no query is issued while the signal is off")

    recommender = HybridRecommender(db=_Session())
    assert asyncio.run(recommender._batch_get_vn_traits(["v1", "v2"])) == {}
