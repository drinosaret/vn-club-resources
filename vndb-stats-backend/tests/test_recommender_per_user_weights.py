"""Per-reader signal weights: the switch, the shrinkage, and the invariants.

The vector is allowed to differ between readers, but not to change what a score means.
Every reader's weights must add up to the same total, an unsupported profile must land
back on the published vector rather than near it, and the switch at its default must
leave the engine scoring exactly as it did without it.
"""

import asyncio
import importlib
import math

import pytest

from app.services import hybrid_recommender as engine
from app.services.hybrid_recommender import (
    MAX_WEIGHTED_SCORE,
    SIGNAL_SUM_ORDER,
    SIGNAL_WEIGHTS,
    HybridRecommender,
    auc_variance,
    fit_split,
    personal_signal_weights,
    signal_weights_for,
    tie_aware_auc,
    weighted_total,
)


class _FailingSession:
    """Any query at all is a failure: the default path must not gain one."""

    async def execute(self, statement):
        raise AssertionError("the switched-off path issued a query")


def _flat_scores(value: float = 0.5) -> dict[str, float]:
    return {name: value for name in SIGNAL_WEIGHTS}


# --- the switch ------------------------------------------------------------


def test_switch_is_off_by_default(monkeypatch):
    monkeypatch.delenv("REC_PER_USER_WEIGHTS", raising=False)
    reloaded = importlib.reload(engine)
    try:
        assert reloaded.PER_USER_WEIGHTS is False
    finally:
        monkeypatch.undo()
        importlib.reload(engine)


def test_switched_off_path_returns_the_global_vector_without_querying():
    recommender = HybridRecommender(_FailingSession())
    votes = [{"vn_id": f"v{i}", "score": 50 + i} for i in range(200)]
    weights = asyncio.run(recommender._signal_weights(votes))
    assert weights == SIGNAL_WEIGHTS
    assert weights is not SIGNAL_WEIGHTS, "callers must not be handed the module's own dict"


def test_signal_weights_for_ignores_a_fit_while_the_switch_is_off():
    tilted = {name: 1.0 for name in SIGNAL_WEIGHTS}
    assert engine.PER_USER_WEIGHTS is False
    assert signal_weights_for(tilted) == SIGNAL_WEIGHTS
    assert signal_weights_for(None) == SIGNAL_WEIGHTS


# --- the sum ---------------------------------------------------------------


def test_weighted_total_covers_every_signal_once():
    assert sorted(SIGNAL_SUM_ORDER) == sorted(SIGNAL_WEIGHTS)
    assert len(SIGNAL_SUM_ORDER) == len(set(SIGNAL_SUM_ORDER))


def test_a_maxed_out_candidate_reaches_the_full_scale():
    # Not exact equality: the terms are added in the order the scoring paths add them,
    # which is not the order the divisor was summed in, and floating-point addition does
    # not commute across that. The two differ in the last bit and agree on the scale.
    assert weighted_total(_flat_scores(1.0), SIGNAL_WEIGHTS) == pytest.approx(
        MAX_WEIGHTED_SCORE, abs=1e-9
    )
    assert engine.normalize_score(MAX_WEIGHTED_SCORE) == 100


def test_the_scale_survives_a_tilted_vector():
    # The 0-100 display divides by the global total, so a reader whose weights summed to
    # anything else would be reading a different scale from everyone else.
    fits = {"quality": (0.95, 0.002), "tag": (0.30, 0.002)}
    tilted = personal_signal_weights(fits)
    assert sum(tilted.values()) == pytest.approx(MAX_WEIGHTED_SCORE, abs=1e-9)
    assert weighted_total(_flat_scores(1.0), tilted) == pytest.approx(
        MAX_WEIGHTED_SCORE, abs=1e-9
    )


# --- shrinkage -------------------------------------------------------------


def test_no_evidence_lands_exactly_on_the_global_vector():
    # Not approximately: a reader the fit says nothing about must be scored on the same
    # numbers as a reader with no profile at all.
    assert personal_signal_weights({}) == SIGNAL_WEIGHTS


def test_evidence_at_the_population_mean_lands_on_the_global_vector():
    fits = {
        name: (engine.SIGNAL_AUC_MEAN[name], 0.001)
        for name in SIGNAL_WEIGHTS
    }
    assert personal_signal_weights(fits) == SIGNAL_WEIGHTS


def test_a_thin_profile_barely_moves_and_a_thick_one_moves():
    """Same taste, different amounts of evidence behind it."""
    signal = "quality"
    area = engine.SIGNAL_AUC_MEAN[signal] - 0.25

    thin = personal_signal_weights({signal: (area, auc_variance(area, 5, 5))})
    thick = personal_signal_weights({signal: (area, auc_variance(area, 120, 120))})

    thin_shift = abs(thin[signal] - SIGNAL_WEIGHTS[signal])
    thick_shift = abs(thick[signal] - SIGNAL_WEIGHTS[signal])
    # The smallest fit the gates admit is believed at a fraction of the strength of one
    # backed by a hundred titles a side, which is what keeps a short profile near the
    # published weights instead of rewriting them on a handful of comparisons.
    assert thin_shift < 0.5 * thick_shift


def test_a_reader_who_favours_one_signal_has_it_weighted_up():
    signal = "tag"
    strong = engine.SIGNAL_AUC_MEAN[signal] + 0.25
    weights = personal_signal_weights({signal: (strong, auc_variance(strong, 60, 60))})

    assert weights[signal] > SIGNAL_WEIGHTS[signal]
    # The total is fixed, so one signal rising means the rest fall.
    for other in SIGNAL_WEIGHTS:
        if other != signal:
            assert weights[other] < SIGNAL_WEIGHTS[other]
    assert sum(weights.values()) == pytest.approx(MAX_WEIGHTED_SCORE, abs=1e-9)


def test_a_reader_the_signal_fails_has_it_weighted_down():
    signal = "quality"
    weak = engine.SIGNAL_AUC_MEAN[signal] - 0.25
    weights = personal_signal_weights({signal: (weak, auc_variance(weak, 60, 60))})
    assert weights[signal] < SIGNAL_WEIGHTS[signal]


def test_no_signal_can_take_the_whole_engine():
    ceiling = engine.PER_USER_WEIGHTS_MAX_RATIO
    absurd = {name: (0.999, 1e-9) for name in SIGNAL_WEIGHTS}
    absurd["tag"] = (0.001, 1e-9)
    weights = personal_signal_weights(absurd)
    for name in SIGNAL_WEIGHTS:
        ratio = weights[name] / SIGNAL_WEIGHTS[name]
        assert 1.0 / (ceiling * ceiling) <= ratio <= ceiling * ceiling


def test_a_signal_readers_do_not_differ_on_keeps_its_weight():
    # A term clamped at its ceiling for every candidate has no spread between readers,
    # and its measured variance is zero. Nothing about one reader can move it.
    flat = [name for name, variance in engine.SIGNAL_AUC_VARIANCE.items() if variance == 0.0]
    assert flat, "the priors record no signal without between-reader spread"
    fits = {name: (0.99, 0.0001) for name in flat}
    weights = personal_signal_weights(fits)
    for name in flat:
        assert weights[name] == pytest.approx(SIGNAL_WEIGHTS[name], abs=1e-12)


# --- the statistic ---------------------------------------------------------


def test_a_perfect_ranking_scores_one_and_a_reversed_one_zero():
    assert tie_aware_auc([3.0, 4.0], [1.0, 2.0]) == 1.0
    assert tie_aware_auc([1.0, 2.0], [3.0, 4.0]) == 0.0


def test_a_silent_signal_is_no_information_rather_than_a_bad_verdict():
    # Both item-item tables are empty for most of the catalogue. A reader whose fit
    # titles happen to be missing from one has learned nothing about it.
    assert tie_aware_auc([0.0] * 8, [0.0] * 8) == 0.5
    assert tie_aware_auc([1.0] * 8, [1.0] * 8) == 0.5


def test_partial_ties_count_as_half():
    assert tie_aware_auc([1.0], [1.0, 0.0]) == 0.75


def test_an_undefined_statistic_is_reported_as_such():
    assert tie_aware_auc([], [1.0]) is None
    assert tie_aware_auc([1.0], []) is None


def test_variance_falls_as_evidence_grows():
    assert auc_variance(0.7, 5, 5) > auc_variance(0.7, 50, 50) > auc_variance(0.7, 500, 500)
    assert auc_variance(0.5, 10, 10) == pytest.approx(1.0 / (6 * 10), abs=0.01)


# --- the split -------------------------------------------------------------


def test_the_two_halves_of_a_profile_never_overlap():
    scores = {f"v{i}": 5.0 + (i % 5) for i in range(60)}
    seed, target = fit_split(scores)
    assert not set(seed) & set(target)
    assert set(seed) | set(target) == set(scores)
    assert len(seed) == int(60 * engine.PER_USER_WEIGHTS_SEED_SHARE)


def test_the_split_repeats_for_one_profile_and_differs_between_two():
    scores = {f"v{i}": 7.0 for i in range(40)}
    assert fit_split(scores) == fit_split(dict(reversed(list(scores.items()))))
    other = {f"w{i}": 7.0 for i in range(40)}
    assert [vn_id[1:] for vn_id in fit_split(scores)[0]] != [
        vn_id[1:] for vn_id in fit_split(other)[0]
    ]


def test_a_profile_too_thin_to_fit_keeps_the_global_vector():
    recommender = HybridRecommender(_FailingSession())
    votes = [{"vn_id": f"v{i}", "score": 70} for i in range(4)]
    assert asyncio.run(recommender._fit_signal_weights(votes)) is None


def test_a_profile_with_no_disliked_titles_keeps_the_global_vector():
    # Everything at one value leaves nothing below the reader's own mean, so there is
    # no pair to compare and no fit to make.
    recommender = HybridRecommender(_FailingSession())
    votes = [{"vn_id": f"v{i}", "score": 80} for i in range(80)]
    assert asyncio.run(recommender._fit_signal_weights(votes)) is None


# --- the priors ------------------------------------------------------------


def test_every_signal_carries_a_prior():
    assert set(engine.SIGNAL_AUC_MEAN) == set(SIGNAL_WEIGHTS)
    assert set(engine.SIGNAL_AUC_VARIANCE) == set(SIGNAL_WEIGHTS)
    for name in SIGNAL_WEIGHTS:
        assert 0.0 <= engine.SIGNAL_AUC_MEAN[name] <= 1.0
        assert engine.SIGNAL_AUC_VARIANCE[name] >= 0.0


def test_a_prior_variance_implies_a_believable_balance_point():
    # Shrinkage is the n/(n+k) form used elsewhere for thin evidence. Near the middle of
    # the scale the sampling variance runs about 1/(6m) at m titles a side, so k lands in
    # the tens of titles. A k in the low single figures would mean a handful of titles
    # were enough to rewrite the vector.
    for name, variance in engine.SIGNAL_AUC_VARIANCE.items():
        if variance <= 0.0:
            continue
        balance_point = 1.0 / (6.0 * variance)
        assert 10 <= balance_point <= 500, f"{name} balances at {balance_point:.0f}"


def test_a_zero_gamma_is_an_independent_way_to_turn_the_tilt_off(monkeypatch):
    monkeypatch.setattr(engine, "PER_USER_WEIGHTS_GAMMA", 0.0)
    fits = {name: (0.99, 1e-6) for name in SIGNAL_WEIGHTS}
    assert personal_signal_weights(fits) == SIGNAL_WEIGHTS


def test_the_spread_control_scales_how_far_a_reader_moves(monkeypatch):
    signal = "tag"
    mean = engine.SIGNAL_AUC_MEAN[signal]
    spread = math.sqrt(engine.SIGNAL_AUC_VARIANCE[signal])
    fit = {signal: (mean + spread, 0.0)}

    shifts = []
    for gamma in (0.0, 0.25, 0.5, 1.0):
        monkeypatch.setattr(engine, "PER_USER_WEIGHTS_GAMMA", gamma)
        shifts.append(personal_signal_weights(fit)[signal] - SIGNAL_WEIGHTS[signal])

    assert shifts[0] == 0.0
    assert shifts[1] < shifts[2] < shifts[3]
