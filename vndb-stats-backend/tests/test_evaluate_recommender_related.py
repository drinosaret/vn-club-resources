"""Ground-truth handling under --exclude-related has one hop it must not double.

drop_related_truth removes related titles from the holdout only, and leaves
exclude_vn_ids untouched: the engine widens its own exclusion set from votes plus
exclusions when the relation switch is on, so folding the same relations into
exclude_vn_ids ahead of that would exclude a second hop the served engine never
reaches. exclusions_for_engine is what decides, from the switch alone, whether the
harness or the engine is responsible for the widening on a given run.
"""

import asyncio
import os
import sys

SCRIPTS = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "scripts"))
if SCRIPTS not in sys.path:
    sys.path.insert(0, SCRIPTS)

import evaluate_recommender  # noqa: E402


def _split(**overrides) -> evaluate_recommender.UserSplit:
    fields = {
        "uid": "u1",
        "rated_total": 3,
        "time_field": "vote_date",
        "train_votes": [{"vn_id": "v1", "score": 90}],
        "holdout": {"v5", "v9"},
        "exclude_vn_ids": {"v2"},
    }
    fields.update(overrides)
    return evaluate_recommender.UserSplit(**fields)


def test_drop_related_truth_only_moves_the_holdout(monkeypatch):
    calls: list[set[str]] = []

    async def stub_related_to(session, vn_ids):
        calls.append(set(vn_ids))
        return {"v9", "v3"}

    monkeypatch.setattr(evaluate_recommender, "related_to", stub_related_to)

    split = _split()
    truth_stats: dict[str, int] = {}
    asyncio.run(evaluate_recommender.drop_related_truth(None, [split], truth_stats))

    assert calls[0] == {"v1", "v2"}
    assert split.holdout == {"v5"}
    assert split.exclude_vn_ids == {"v2"}
    assert split.related_ids == {"v9", "v3"}
    assert truth_stats["dropped_related"] == 1

    # A second reader's split shares the same truth_stats dict, the way one batch's
    # splits do, so the count accumulates rather than resetting per split.
    other_split = _split(uid="u2")
    asyncio.run(evaluate_recommender.drop_related_truth(None, [other_split], truth_stats))
    assert truth_stats["dropped_related"] == 2


def test_exclusions_for_engine_follows_the_switch(monkeypatch):
    split = _split(holdout={"v5"}, related_ids={"v9", "v3"})

    # Off: the harness is the only thing that will ever widen the exclusion set for
    # this run, so it hands the engine the union up front.
    monkeypatch.setattr(evaluate_recommender.engine, "RELATION_EXCLUSION", False)
    assert evaluate_recommender.exclusions_for_engine(split) == {"v2", "v9", "v3"}

    # On: the engine widens the raw set itself from the same read set, so handing it
    # the already-widened set here would reach a second hop.
    monkeypatch.setattr(evaluate_recommender.engine, "RELATION_EXCLUSION", True)
    assert evaluate_recommender.exclusions_for_engine(split) == {"v2"}
