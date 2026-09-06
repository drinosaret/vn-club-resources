"""An entity signal has to say whether the reader liked a studio, not how often they met it.

At the default the stored delta and the added-back mean cancel, so the term is the
count-confidence factor alone; that arithmetic is pinned in test_recommender_switches.
These tests pin the switched shape: a centred preference on the reader's own scale, times
the same confidence factor, applied once.
"""

import asyncio
import math

import pytest

from app.services import hybrid_recommender as engine
from app.services.hybrid_recommender import (
    HybridRecommender,
    entity_confidence,
    entity_preference,
)


class _Result:
    def all(self):
        return []


class _Session:
    """A session that answers every query with no rows."""

    async def execute(self, statement):
        return _Result()


def _stub_loaders(recommender, monkeypatch, developers):
    async def tags(vn_ids, spoiler_level=0):
        return {}

    async def devs(vn_ids):
        return developers

    async def none(vn_ids):
        return {}

    async def traits(vn_ids, spoiler_level=0):
        return {}

    async def idf():
        return {}

    async def technical():
        return set()

    monkeypatch.setattr(recommender, "_batch_get_vn_tags", tags)
    monkeypatch.setattr(recommender, "_batch_get_vn_developers", devs)
    monkeypatch.setattr(recommender, "_batch_get_vn_staff", none)
    monkeypatch.setattr(recommender, "_batch_get_vn_seiyuu", none)
    monkeypatch.setattr(recommender, "_batch_get_vn_traits", traits)
    monkeypatch.setattr(recommender, "_load_tag_idf_weights", idf)
    monkeypatch.setattr(recommender, "_load_technical_tag_ids", technical)


def test_preference_maps_the_readers_scale_onto_the_unit_interval():
    # At the reader's mean the preference is even; one spread above it is certain.
    assert entity_preference(7.0, 7.0, 1.0) == pytest.approx(0.5)
    assert entity_preference(8.0, 7.0, 1.0) == pytest.approx(1.0)
    assert entity_preference(6.0, 7.0, 1.0) == pytest.approx(0.0)
    assert entity_preference(9.5, 7.0, 1.0) == 1.0
    # A wider spread needs a wider gap to say the same thing.
    assert entity_preference(8.0, 7.0, 2.0) == pytest.approx(0.75)


def test_confidence_is_the_existing_count_factor():
    assert entity_confidence(1) == pytest.approx(0.2)
    assert entity_confidence(5) == 1.0
    assert entity_confidence(9) == 1.0


def _profile():
    return {
        "user_overall_avg": 7.0,
        "user_rating_spread": 1.0,
        # The stored values the default path scores from. Under the switch they still
        # decide which entities are scored at all; only the mark comes from elsewhere.
        "preferred_developers": {"once": 0.0, "often": 0.0, "disliked": 0.0},
        "max_dev_weighted": 10.0,
        # Damped means and counts, which the switched path reads.
        "dev_means": {"once": 7.75, "often": 8.25, "disliked": 5.75},
        "dev_counts": {"once": 1, "often": 5, "disliked": 5},
    }


def test_switched_entity_score_ranks_by_rating_not_volume(monkeypatch):
    monkeypatch.setattr(engine, "ENTITY_PREFERENCE", True)
    recommender = HybridRecommender(db=None)
    profile = _profile()
    often = recommender._compute_developer_score_fast(profile, ["often"])
    once = recommender._compute_developer_score_fast(profile, ["once"])
    disliked = recommender._compute_developer_score_fast(profile, ["disliked"])
    # Five readings above the mean is the strongest statement the profile can make.
    assert often == pytest.approx(1.0)
    # One reading is weak evidence however good the mark was.
    assert once == pytest.approx(0.2 * 0.875)
    # A studio the reader kept rating below their mean contributes nothing.
    assert disliked == 0.0
    # Nothing to match on is still zero.
    assert recommender._compute_developer_score_fast(profile, ["unknown"]) == 0.0


def test_default_entity_score_is_untouched(monkeypatch):
    monkeypatch.setattr(engine, "ENTITY_PREFERENCE", False)
    recommender = HybridRecommender(db=None)
    profile = _profile()
    assert recommender._compute_developer_score_fast(profile, ["once"]) == pytest.approx(0.7)


def test_switched_gate_admits_a_liked_entity_met_twice(monkeypatch):
    monkeypatch.setattr(engine, "ENTITY_PREFERENCE", True)
    # Under the switch the profile stores the centred preference, so a studio met twice
    # and rated well sits above zero and clears the floor.
    weights = {"twice": 0.3, "cold": -0.4}
    picked = HybridRecommender._top_entities(weights, 5, counts={"twice": 2, "cold": 5})
    assert list(picked) == ["twice"]


def test_switched_profile_stores_the_centred_preference_on_the_readers_scale(monkeypatch):
    monkeypatch.setattr(engine, "ENTITY_PREFERENCE", True)
    recommender = HybridRecommender(_Session())
    _stub_loaders(
        recommender,
        monkeypatch,
        {"v1": ["studio"], "v2": ["studio"], "v3": ["studio", "newcomer"]},
    )
    recommender._producer_ids_by_name = {"studio": {"p1"}}
    votes = [
        {"vn_id": "v1", "score": 60},
        {"vn_id": "v2", "score": 80},
        {"vn_id": "v3", "score": 100},
    ]

    profile = asyncio.run(recommender._build_user_profile(votes))

    spread = max(1.0, math.sqrt(((6 - 8) ** 2 + 0 + (10 - 8) ** 2) / 3))
    assert profile["user_overall_avg"] == pytest.approx(8.0)
    assert profile["user_rating_spread"] == pytest.approx(spread)
    for studio in ("studio", "newcomer"):
        assert profile["preferred_developers"][studio] == pytest.approx(
            entity_preference(profile["dev_means"][studio], 8.0, spread) - 0.5
        )
    # A studio met only on the reader's best title sits above the even point.
    assert profile["preferred_developers"]["newcomer"] > 0.0
    # The id-keyed counts follow the name-keyed ones through the producer map.
    assert profile["dev_id_counts"] == {"p1": 3}


def test_empty_profile_carries_a_unit_spread():
    profile = asyncio.run(HybridRecommender(_Session())._build_user_profile([]))
    assert profile["user_rating_spread"] == 1.0


def test_switched_trait_score_keeps_the_cast_repeat_bonus(monkeypatch):
    monkeypatch.setattr(engine, "ENTITY_PREFERENCE", True)
    recommender = HybridRecommender(db=None)
    profile = {
        "user_overall_avg": 7.0,
        "user_rating_spread": 1.0,
        "preferred_traits": {11: 0.0},
        "max_trait_weighted": 10.0,
        "trait_means": {11: 8.5},
        "trait_counts": {11: 2},
    }
    # Three characters carrying the trait: the repeat bonus still multiplies the term.
    score = recommender._compute_trait_score_fast(profile, {11: 3})
    assert score == pytest.approx(entity_confidence(2) * entity_preference(8.5, 7.0, 1.0) * 1.6)


def test_profile_counts_and_means_follow_the_vote_half_life(monkeypatch):
    # Under a half-life the newest vote carries the most weight, so with the marks rising
    # over time the studio's mean climbs and its support drops below the vote total.
    developers = {"v1": ["studio"], "v2": ["studio"], "v3": ["studio"]}
    day = 86400
    votes = [
        {"vn_id": "v1", "score": 60, "vote_date": 0},
        {"vn_id": "v2", "score": 80, "vote_date": 365 * day},
        {"vn_id": "v3", "score": 100, "vote_date": 730 * day},
    ]

    def build():
        recommender = HybridRecommender(_Session())
        _stub_loaders(recommender, monkeypatch, developers)
        return asyncio.run(recommender._build_user_profile(votes))

    monkeypatch.setattr(engine, "VOTE_HALF_LIFE_DAYS", 0.0)
    flat = build()
    monkeypatch.setattr(engine, "VOTE_HALF_LIFE_DAYS", 365.0)
    decayed = build()

    assert flat["dev_counts"]["studio"] == 3
    assert decayed["dev_counts"]["studio"] < 3
    assert decayed["dev_means"]["studio"] > flat["dev_means"]["studio"]
