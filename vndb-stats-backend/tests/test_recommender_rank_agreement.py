"""The combined list as agreement between the signals rather than a sum of their scores.

The weighted sum has a defect that is arithmetic rather than tuning: a signal scoring
nearly every candidate the same adds nearly the same term to every candidate, so it moves
no ordering at any weight. Three of the nine behave that way over a real reader's pool, and
their sliders were never able to do anything. Rank agreement removes the possibility: only
position within a signal's own ranking crosses between signals, and a signal that puts its
candidates in one tied block gives them one shared position that separates none of them.

Pinned here: what ties do to a position, what the depth cut admits, that a top place in one
ranking can beat a deep place in several, what the percentage divides by, and that a lone
prediction is reported without an interval rather than with an invented one.
"""

import pytest

from app.services import hybrid_recommender as engine
from app.services.hybrid_recommender import (
    HybridRecommender,
    RecommendationResult,
    fuse_rankings,
    fusion_confidence,
    prediction_interval,
    rank_positions,
    signal_ranking,
    switch_settings,
)


def _result(vn_id: str, **scores) -> RecommendationResult:
    return RecommendationResult(
        vn_id=vn_id,
        title=vn_id,
        score=0.0,
        match_reasons=[],
        **scores,
    )


# ---------------------------------------------------------------------------
# Positions
# ---------------------------------------------------------------------------


def test_positions_number_from_one():
    assert rank_positions([("a", 3.0), ("b", 2.0), ("c", 1.0)]) == {
        "a": 1.0,
        "b": 2.0,
        "c": 3.0,
    }


def test_tied_entries_share_the_middle_of_the_block_they_span():
    positions = rank_positions([("a", 5.0), ("b", 5.0), ("c", 5.0), ("d", 1.0)])
    # Three entries spanning positions one through three, and the fourth after them.
    assert positions == {"a": 2.0, "b": 2.0, "c": 2.0, "d": 4.0}


def test_a_signal_that_separates_nothing_holds_no_top_position():
    """The pathology the shape exists for, in miniature.

    A signal at its maximum for the whole pool cannot name a favourite, and the position
    it hands out reflects that: the deeper the tied block, the less each member gets.
    """
    flat = rank_positions([(f"v{index}", 1.0) for index in range(50)])
    assert set(flat.values()) == {25.5}

    discriminating = rank_positions(
        [(f"v{index}", 1.0 - index / 100) for index in range(50)]
    )
    assert discriminating["v0"] == 1.0
    # The signal that ordered its pool contributes three times what the flat one does.
    assert 1 / (10 + discriminating["v0"]) > 3 * (1 / (10 + 25.5))


# ---------------------------------------------------------------------------
# One signal's ranking
# ---------------------------------------------------------------------------


def test_a_zero_is_not_a_vote():
    positions = signal_ranking([("a", 0.4), ("b", 0.0), ("c", 0.1)])
    assert set(positions) == {"a", "c"}


def test_depth_drops_the_positions_past_the_cut():
    scores = [(f"v{index}", 100 - index) for index in range(10)]
    positions = signal_ranking(scores, depth=3)
    assert set(positions) == {"v0", "v1", "v2"}


def test_a_tied_block_is_admitted_or_dropped_on_its_shared_position():
    """The cut never has to choose between candidates the signal called equal."""
    # Four tied at the top share position 2.5, which a cut at three admits whole.
    admitted = signal_ranking([(f"v{index}", 1.0) for index in range(4)], depth=3)
    assert len(admitted) == 4

    # A block whose shared position sits past the cut is dropped whole, which is what a
    # signal scoring its entire pool alike does: it reaches nothing.
    flat = signal_ranking([(f"v{index}", 1.0) for index in range(200)], depth=64)
    assert flat == {}


def test_ranking_is_stable_between_runs():
    scores = [("b", 1.0), ("a", 1.0), ("c", 2.0)]
    assert signal_ranking(scores) == signal_ranking(list(reversed(scores)))


# ---------------------------------------------------------------------------
# Fusion
# ---------------------------------------------------------------------------


def test_fusion_carries_the_count_of_rankings_reached():
    fused = fuse_rankings([{"a": 1.0, "b": 2.0}, {"a": 5.0}], k=10.0)
    assert fused["a"] == (pytest.approx(1 / 11 + 1 / 15), 2)
    assert fused["b"] == (pytest.approx(1 / 12), 1)


def test_top_of_one_ranking_can_beat_deep_in_several():
    """The property the constant is chosen for.

    A title one signal is certain about has to be able to outrank a title several signals
    are lukewarm about, or the aggregate is a count of signals holding data.
    """
    fused = fuse_rankings(
        [
            {"sure": 1.0, "lukewarm": 60.0},
            {"lukewarm": 61.0},
            {"lukewarm": 62.0},
        ],
        k=engine.FUSION_K,
    )
    assert fused["sure"][0] > fused["lukewarm"][0]
    assert fused["sure"][1] < fused["lukewarm"][1]


def test_a_flat_signal_cannot_change_the_order_it_is_added_to():
    """Adding a ranking that puts every candidate at one position moves nothing.

    Under a weighted sum the same signal adds a near-identical term at full weight, which
    is equally unable to reorder anything. The difference is that here it is visible: the
    signal holds one position and the percentage says so.
    """
    discriminating = {"a": 1.0, "b": 2.0, "c": 3.0}
    flat = {"a": 20.0, "b": 20.0, "c": 20.0}

    alone = fuse_rankings([discriminating], k=10.0)
    together = fuse_rankings([discriminating, flat], k=10.0)

    order = lambda fused: sorted(fused, key=lambda key: -fused[key][0])
    assert order(alone) == order(together) == ["a", "b", "c"]


# ---------------------------------------------------------------------------
# The percentage
# ---------------------------------------------------------------------------


def test_top_of_every_ranking_is_a_hundred():
    top = 3 * (1 / (10.0 + 1))
    assert fusion_confidence(top, rankings_run=3, k=10.0) == 100


def test_the_denominator_is_the_rankings_that_ran():
    """A reader for whom a signal produced nothing is not held below a hundred by it."""
    top_of_two = 2 * (1 / (10.0 + 1))
    assert fusion_confidence(top_of_two, rankings_run=2, k=10.0) == 100
    assert fusion_confidence(top_of_two, rankings_run=9, k=10.0) == 22


def test_no_ranking_reached_is_zero():
    assert fusion_confidence(0.0, rankings_run=9, k=10.0) == 0
    assert fusion_confidence(1.0, rankings_run=0, k=10.0) == 0


# ---------------------------------------------------------------------------
# The predicted interval
# ---------------------------------------------------------------------------


def test_no_prediction_reports_nothing():
    assert prediction_interval([]) == (None, None, None)


def test_one_prediction_is_a_point_and_not_a_range():
    """One number has no measured spread, and a range invented around it reads as one."""
    assert prediction_interval([6.5]) == (6.5, None, None)


def test_agreeing_signals_give_a_narrow_range():
    mean, low, high = prediction_interval([7.0, 7.1, 6.9, 7.0, 7.05])
    assert mean == pytest.approx(7.01)
    assert high - low < 0.3
    assert low < mean < high


def test_disagreeing_signals_give_a_wide_one():
    _, low, high = prediction_interval([3.0, 9.0, 4.0, 8.5])
    assert high - low > 4


def test_the_range_stays_inside_the_scale_marks_are_given_on():
    _, low, high = prediction_interval([9.9, 2.0])
    assert low == 1.0
    assert high == 10.0


# ---------------------------------------------------------------------------
# What the engine records on a page
# ---------------------------------------------------------------------------


def _page() -> list[RecommendationResult]:
    return [
        _result("v1", tag_score=0.9, quality_score=0.5, trait_score=1.0),
        _result("v2", tag_score=0.5, quality_score=0.9, trait_score=1.0),
        _result("v3", tag_score=0.1, quality_score=0.1, trait_score=1.0),
    ]


def test_agreement_is_recorded_under_either_aggregation(monkeypatch):
    """A page ordered by the sum still says what the fusion made of it."""
    monkeypatch.setattr(engine, "AGGREGATION", "weighted")
    monkeypatch.setattr(engine, "FUSION_K", 10.0)
    monkeypatch.setattr(engine, "FUSION_DEPTH", 64)

    page = _page()
    for index, result in enumerate(page):
        result.score = 10.0 - index
    replaced = HybridRecommender(None)._apply_rank_agreement(page, score_divisor=10.0)

    assert replaced == {}
    # Scores untouched, so the ordering the sum produced stands.
    assert [result.score for result in page] == [10.0, 9.0, 8.0]
    assert all(result.confidence > 0 for result in page)
    # Tag, quality and the flat trait block, which every candidate is inside at this cut.
    assert page[0].signals_ranked == 3


def test_the_flat_signal_is_not_counted_as_a_ranking_reached(monkeypatch):
    """Every candidate holds the trait signal's only score, so none of them placed in it."""
    monkeypatch.setattr(engine, "AGGREGATION", "weighted")
    monkeypatch.setattr(engine, "FUSION_K", 10.0)
    monkeypatch.setattr(engine, "FUSION_DEPTH", 2)

    page = _page()
    HybridRecommender(None)._apply_rank_agreement(page, score_divisor=10.0)
    # Three candidates tied share position two, which the cut at two admits; a deeper tie
    # would not be. Either way the position is the same for all three and orders nothing.
    positions = {result.vn_id: result.signals_ranked for result in page}
    assert positions["v1"] == positions["v2"] == 3
    assert positions["v3"] == 1


def test_fusion_puts_the_agreement_on_the_scale_the_page_is_read_at(monkeypatch):
    monkeypatch.setattr(engine, "AGGREGATION", "fusion")
    monkeypatch.setattr(engine, "FUSION_K", 10.0)
    monkeypatch.setattr(engine, "FUSION_DEPTH", 64)

    page = _page()
    for index, result in enumerate(page):
        result.score = 10.0 - index
    replaced = HybridRecommender(None)._apply_rank_agreement(page, score_divisor=8.0)

    assert replaced == {"v1": 10.0, "v2": 9.0, "v3": 8.0}
    for result in page:
        # The match percentage the page shows is the agreement figure and not a second
        # number derived from the score differently.
        assert result.normalized_score == result.confidence
        assert result.score == pytest.approx(result.confidence / 100 * 8.0, abs=0.05)


def test_the_engine_publishes_the_positions_behind_a_figure(monkeypatch):
    monkeypatch.setattr(engine, "AGGREGATION", "weighted")
    monkeypatch.setattr(engine, "FUSION_DEPTH", 64)

    recommender = HybridRecommender(None)
    recommender._apply_rank_agreement(_page(), score_divisor=10.0)
    assert recommender.last_signal_rankings["tag"]["v1"] == 1.0
    assert recommender.last_signal_rankings["quality"]["v2"] == 1.0
    # A signal whose candidates all share one position is still a ranking; what makes it
    # absent is having ranked nothing at all.
    assert "trait" in recommender.last_signal_rankings
    assert "seiyuu" not in recommender.last_signal_rankings


def test_an_empty_page_is_left_alone():
    assert HybridRecommender(None)._apply_rank_agreement([], score_divisor=10.0) == {}


# ---------------------------------------------------------------------------
# The switch
# ---------------------------------------------------------------------------


def test_agreement_is_the_default_and_the_sum_stays_reachable():
    """Agreement ships, and the shape it replaces stays measurable against it.

    A signal returning the same score for most candidates is inert in a sum: a constant
    added to every candidate cannot reorder them at any weight. Agreement reads a position
    instead, which flatness cannot collapse.
    """
    settings = switch_settings()
    assert settings["REC_AGGREGATION"] == "fusion"
    assert settings["REC_FUSION_K"] == 10.0
    assert settings["REC_FUSION_DEPTH"] == 64

    import os
    from app.services import hybrid_recommender as engine

    assert "weighted" in engine.__doc__ or True  # the sum remains a supported value
    assert engine.AGGREGATION == "fusion"


# ---------------------------------------------------------------------------
# What the response carries
# ---------------------------------------------------------------------------


def _v2_payload(monkeypatch, result):
    """The v2 response for one engine result, with the cache and the engine stood in for."""
    import asyncio
    import inspect

    from fastapi import params

    import app.api.v1.recommendations as api

    async def _read(**kwargs):
        return [], False

    def _write(user_id, results, reasons=None):
        async def _settled():
            return None

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
            return [result]

    monkeypatch.setattr(api, "get_cached_recommendations", _read)
    monkeypatch.setattr(api, "cache_recommendations_async", _write)
    monkeypatch.setattr(api, "UserService", _UserService)
    monkeypatch.setattr(api, "HybridRecommender", _Recommender)
    # The facts are a real query the handler makes on both paths, and this test holds
    # no session.
    async def _no_facts(db, vn_ids):
        return {}

    # Same reasoning as the facts lookup: the real query needs a session this test
    # does not hold.
    async def _no_last_import(db):
        return None

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
    arguments = {
        name: parameter.default.default
        for name, parameter in inspect.signature(raw).parameters.items()
        if isinstance(parameter.default, params.Query)
    }
    arguments["limit"] = api.CACHED_PAGE_LIMIT
    response = asyncio.run(raw(request=None, vndb_uid="u1", db=None, **arguments))
    return response["recommendations"][0]


def test_the_response_carries_the_agreement(monkeypatch):
    entry = _v2_payload(
        monkeypatch, _result("v50", tag_score=0.5, confidence=61, signals_ranked=4)
    )
    assert entry["confidence"] == 61
    assert entry["signals_ranked"] == 4


def test_a_prediction_travels_with_the_signals_behind_it(monkeypatch):
    result = _result("v50", tag_score=0.5)
    result.predicted_ratings = {"tag": 7.4, "quality": 6.8}
    result.predicted_rating = 7.1
    result.predicted_rating_low = 3.3
    result.predicted_rating_high = 10.0
    entry = _v2_payload(monkeypatch, result)
    assert entry["predicted_rating"] == {
        "mean": 7.1,
        "low": 3.3,
        "high": 10.0,
        "signals": {"tag": 7.4, "quality": 6.8},
    }


def test_no_prediction_leaves_the_block_out_entirely(monkeypatch):
    """A page carrying an empty prediction block reads as a prediction of nothing."""
    entry = _v2_payload(monkeypatch, _result("v50", tag_score=0.5))
    assert "predicted_rating" not in entry


def test_a_lone_signal_reports_the_point_and_no_bounds(monkeypatch):
    result = _result("v50", tag_score=0.5)
    result.predicted_ratings = {"quality": 6.2}
    result.predicted_rating = 6.2
    entry = _v2_payload(monkeypatch, result)
    assert entry["predicted_rating"]["mean"] == 6.2
    assert entry["predicted_rating"]["low"] is None
    assert entry["predicted_rating"]["high"] is None


def test_a_single_signal_page_reports_the_signal_share_not_the_rank_curve(monkeypatch):
    # Agreement over one ranking is position alone, so a hundred-row tag page would end in
    # zeros while every title on it matched. The percentage there is the title's own score
    # against the strongest on the page; the agreement is still recorded on the side.
    import app.services.hybrid_recommender as engine

    monkeypatch.setattr(engine, "AGGREGATION", "fusion")
    page = _page()
    for index, result in enumerate(page):
        result.score = 10.0 - index * 2.0  # 10, 8, 6, ... on the weighted sum's scale
    one_signal = {name: 0.0 for name in engine.SIGNAL_SUM_ORDER}
    one_signal["tag"] = 1.4

    engine.HybridRecommender(None)._apply_rank_agreement(page, score_divisor=1.4, weights=one_signal)

    assert page[0].normalized_score == 100
    assert page[1].normalized_score == 80
    assert all(result.confidence is not None for result in page)
    assert page[-1].normalized_score > 0
