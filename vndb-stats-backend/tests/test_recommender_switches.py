"""A scoring switch has to be inert at its default and to do one thing when it is not.

A default that is only nearly inert makes every measured comparison a comparison of two
unknown configurations, so the default path is pinned here against the arithmetic it
replaced rather than against the current implementation of itself.
"""

import asyncio

import pytest

from app.services import hybrid_recommender as engine
from app.services.hybrid_recommender import (
    HybridRecommender,
    RecommendationResult,
    combine_entity_matches,
    switch_settings,
)


def test_switches_default_off():
    """The declared switches ship off, so an unswitched run is the control."""
    settings = switch_settings()
    assert settings["REC_ENTITY_DESATURATION"] is False
    assert settings["REC_MMR_NORMALIZE_RELEVANCE"] is False


def test_entity_matches_default_is_the_clamped_sum():
    assert combine_entity_matches([]) == 0.0
    assert combine_entity_matches([0.25, 0.5]) == pytest.approx(0.75)
    # Several ordinary matches reach the ceiling on their own, which is the saturation
    # the switch exists to address; the default keeps it.
    assert combine_entity_matches([0.4, 0.4, 0.4]) == 1.0


def test_entity_matches_desaturated_blends_depth_and_breadth(monkeypatch):
    monkeypatch.setattr(engine, "ENTITY_DESATURATION", True)
    monkeypatch.setattr(engine, "ENTITY_DESATURATION_TOP_N", 3)

    # Same input that saturates by default now separates.
    assert combine_entity_matches([0.4, 0.4, 0.4]) == pytest.approx(0.4)
    # Only the top few count, so a long tail of weak matches cannot lift the term.
    assert combine_entity_matches([0.9, 0.6, 0.3, 0.1, 0.1]) == pytest.approx(
        0.5 * (1.8 / 3) + 0.5 * 0.9
    )
    # A single strong match still reads below the ceiling.
    assert combine_entity_matches([0.8]) == pytest.approx(0.8)
    # The term stays inside the range the weighted total assumes.
    assert combine_entity_matches([3.0, 2.0]) == 1.0


def _profile():
    """Profile shaped the way _build_user_profile leaves it, with one match per kind."""
    return {
        "user_overall_avg": 7.0,
        "preferred_developers": {"p1": 1.0, "p2": 0.0},
        "max_dev_weighted": 10.0,
        "preferred_staff": {"s1": 2.0},
        "max_staff_weighted": 10.0,
        "preferred_seiyuu": {"v1": -1.0},
        "max_seiyuu_weighted": 10.0,
        "preferred_traits": {7: -2.0},
        "max_trait_weighted": 10.0,
    }


def test_entity_signals_reproduce_the_arithmetic_they_replaced():
    """Each entity signal at its default matches the per-kind formula, spelled out."""
    recommender = HybridRecommender(db=None)
    profile = _profile()

    # One matching developer: preferences are deltas from the reader's average.
    assert recommender._compute_developer_score_fast(profile, ["p2", "p3"]) == pytest.approx(
        (0.0 + 7.0) / 10.0
    )
    # Two of them sum past the ceiling, which is the saturation the default carries.
    assert recommender._compute_developer_score_fast(profile, ["p1", "p2", "p3"]) == 1.0
    assert recommender._compute_staff_score_fast(profile, ["s1", "s9"]) == pytest.approx(
        (2.0 + 7.0) / 10.0
    )
    assert recommender._compute_seiyuu_score_fast(profile, ["v1"]) == pytest.approx(
        (-1.0 + 7.0) / 10.0
    )
    assert recommender._compute_trait_score_fast(profile, {7: 1, 8: 5}) == pytest.approx(
        (-2.0 + 7.0) / 10.0
    )
    # Three characters carrying the trait, so the repeat multiplier applies.
    assert recommender._compute_trait_score_fast(profile, {7: 3, 8: 5}) == pytest.approx(
        ((-2.0 + 7.0) / 10.0) * 1.6
    )
    # Nothing to match on is zero rather than a floor.
    assert recommender._compute_staff_score_fast(profile, []) == 0.0
    assert recommender._compute_trait_score_fast({}, {7: 1}) == 0.0


def _result(vn_id: str, score: float) -> RecommendationResult:
    return RecommendationResult(vn_id=vn_id, title=vn_id, score=score, match_reasons=[])


def _rerank(monkeypatch, normalize: bool) -> list[str]:
    """Second pick from a pool whose leader is far ahead of two near-tied followers."""
    monkeypatch.setattr(engine, "MMR_NORMALIZE_RELEVANCE", normalize)
    recommender = HybridRecommender(db=None)
    pool = [_result("v1", 100.0), _result("v2", 5.0), _result("v3", 4.0)]
    tags = {
        "v1": {1: 3.0},
        "v2": {1: 3.0},   # indistinguishable from the leader
        "v3": {2: 3.0},   # shares nothing with it
    }
    selected = asyncio.run(
        recommender._apply_diversity_reranking(
            recommendations=pool, all_tags=tags, limit=2, diversity_weight=0.3
        )
    )
    return [r.vn_id for r in selected]


def test_mmr_default_lets_the_raw_scale_outweigh_diversity(monkeypatch):
    # A one-point relevance gap on the raw weighted scale outruns the whole diversity
    # range, so the near-duplicate is taken over the dissimilar title.
    assert _rerank(monkeypatch, normalize=False) == ["v1", "v2"]


def test_mmr_normalized_lets_the_blend_weight_decide(monkeypatch):
    # The same gap is small once relevance spans the pool's own range, so diversity
    # decides, which is what the blend weight says it should do.
    assert _rerank(monkeypatch, normalize=True) == ["v1", "v3"]
