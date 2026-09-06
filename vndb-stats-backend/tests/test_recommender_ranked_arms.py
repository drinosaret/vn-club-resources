"""A retrieval arm returns an order, not a bag.

Every arm already computes an ordering to decide which rows survive its own limit, and
until now returned a set, so the ordering existed only inside the query and was thrown
away the moment the rows arrived. A stage that measures agreement between the arms has
nothing to measure without it.

What is asserted here is that each arm's answer is a genuine ordering of the quantity it
ranked on rather than the order rows happened to arrive in, that a title reached through
several of the reader's own keeps the best position it earned, and that the union the
blended path is built from is unchanged.
"""

import asyncio

import pytest

pytest.importorskip("sqlalchemy")

from app.services import hybrid_recommender as engine
from app.services.hybrid_recommender import (
    HybridRecommender,
    dedupe_ranked,
    ranked_ids,
)


class _Row:
    def __init__(self, **columns):
        self.__dict__.update(columns)


class _Result:
    def __init__(self, rows):
        self._rows = list(rows)

    def all(self):
        return list(self._rows)

    def scalar_one_or_none(self):
        return self._rows[0] if self._rows else None


class _Session:
    def __init__(self, rows_by_table=None):
        self.rows_by_table = dict(rows_by_table or {})

    async def execute(self, statement):
        text = str(statement)
        for table, rows in self.rows_by_table.items():
            if f"FROM {table}" in text:
                return _Result(rows)
        return _Result([])


def run(coroutine):
    return asyncio.run(coroutine)


# ---------------------------------------------------------------------------
# The shape itself
# ---------------------------------------------------------------------------


def test_ids_keep_the_order_they_were_ranked_in():
    assert ranked_ids([("v3", 0.9), ("v1", 0.4)]) == ["v3", "v1"]


def test_a_title_reached_twice_keeps_its_best_position():
    """The rows arrive strongest first, so the first occurrence is the strongest."""
    ranked = dedupe_ranked([("v1", 0.9), ("v2", 0.7), ("v1", 0.2)])

    assert ranked == [("v1", 0.9), ("v2", 0.7)]


def test_the_strength_is_carried_as_a_number():
    assert dedupe_ranked([("v1", 3)]) == [("v1", 3.0)]


# ---------------------------------------------------------------------------
# The arms
# ---------------------------------------------------------------------------


def test_the_similarity_arm_answers_strongest_first():
    session = _Session(
        {
            "vn_similarities": [
                _Row(similar_vn_id="v1", similarity_score=0.4),
                _Row(similar_vn_id="v2", similarity_score=0.9),
            ]
        }
    )

    ranked = run(
        HybridRecommender(session)._get_similar_vn_candidates(
            high_rated_vns=["s1"], exclude_vn_ids=set(), limit=2
        )
    )

    assert ranked_ids(ranked) == ["v2", "v1"]


def test_the_elite_tag_arm_carries_the_tag_strength_it_ranked_on():
    session = _Session(
        {
            "vn_tags": [
                _Row(vn_id="v1", best_score=3.0),
                _Row(vn_id="v2", best_score=2.0),
            ]
        }
    )

    ranked = run(
        HybridRecommender(session)._get_elite_tag_candidates(
            elite_tag_ids={1}, exclude_vn_ids=set(), limit=10
        )
    )

    assert ranked == [("v1", 3.0), ("v2", 2.0)]


def test_the_cooccurrence_arm_carries_the_co_rating():
    session = _Session(
        {
            "vn_cooccurrence": [
                _Row(similar_vn_id="v1", co_rating_score=8.0),
                _Row(similar_vn_id="v1", co_rating_score=2.0),
                _Row(similar_vn_id="v2", co_rating_score=5.0),
            ]
        }
    )

    ranked = run(
        HybridRecommender(session)._get_cooccurrence_candidates(
            high_rated_vns=["s1", "s2"], exclude_vn_ids=set(), limit=10
        )
    )

    assert ranked == [("v1", 8.0), ("v2", 5.0)]


def test_an_entity_arm_carries_the_affinity_the_query_labelled():
    session = _Session(
        {
            "vn_staff": [
                _Row(vn_id="v1", affinity=1.5),
                _Row(vn_id="v2", affinity=0.5),
            ]
        }
    )

    ranked = run(
        HybridRecommender(session)._get_staff_candidates(
            weights={"s1": 1.5}, exclude_vn_ids=set(), limit=10, seed="seed"
        )
    )

    assert ranked == [("v1", 1.5), ("v2", 0.5)]


def test_an_arm_with_nothing_to_say_answers_with_an_empty_order():
    session = _Session()

    assert (
        run(
            HybridRecommender(session)._get_cooccurrence_candidates(
                high_rated_vns=[], exclude_vn_ids=set(), limit=10
            )
        )
        == []
    )


# ---------------------------------------------------------------------------
# What collection does with them
# ---------------------------------------------------------------------------


def _collect(session, **overrides):
    recommender = HybridRecommender(session)
    arguments = dict(
        exclude_vn_ids=set(),
        limit=10,
        high_rated_vns=["s1"],
        elite_tag_ids=None,
        japanese_only=False,
        spoiler_level=0,
        predicates=[],
        seed="seed",
    )
    arguments.update(overrides)
    return recommender, run(recommender._collect_candidate_ids(**arguments))


def test_the_union_the_pool_is_built_from_is_still_a_set_of_ids():
    session = _Session(
        {
            "vn_similarities": [
                _Row(similar_vn_id="v1", similarity_score=0.9),
                _Row(similar_vn_id="v2", similarity_score=0.4),
            ]
        }
    )

    _, (all_ids, priority_ids, _) = _collect(session)

    assert all_ids == {"v1", "v2"}
    assert priority_ids == {"v1", "v2"}


def test_each_arms_own_order_survives_collection():
    """The union discards it, so it is published beside the union rather than inside it."""
    session = _Session(
        {
            "vn_similarities": [
                _Row(similar_vn_id="v1", similarity_score=0.4),
                _Row(similar_vn_id="v2", similarity_score=0.9),
            ]
        }
    )

    recommender, _ = _collect(session)

    assert recommender.last_ranked_arms["similar"] == [("v2", 0.9), ("v1", 0.4)]


def test_the_broad_draw_publishes_no_order_it_did_not_compute():
    """It is a shuffle over titles unconnected to the reader, and a shuffle is not a rank."""
    session = _Session({"visual_novels": [_Row(id="v9")]})

    recommender, _ = _collect(session)

    assert "exploration" not in recommender.last_ranked_arms
