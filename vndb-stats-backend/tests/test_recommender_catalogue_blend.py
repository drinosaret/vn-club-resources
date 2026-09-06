"""The catalogue-first blend: what a title can earn without an audience.

The engine used to divide every candidate's score by one fixed total covering signals that
only exist once a title has been widely read, so a title nobody has voted on was scored
against evidence it had no way to hold. These pin the shape that replaces it: a title is
measured on the share of its own catalogue evidence that matches the reader, the consensus
signals are added on top rather than divided by, and the previous shape stays reachable so
the two can be measured against each other.
"""

import inspect
import math

import pytest

from app.services import hybrid_recommender as hr
from app.services.hybrid_recommender import (
    CATALOGUE_SIGNALS,
    CONSENSUS_SIGNALS,
    LEGACY_SIGNAL_WEIGHTS,
    MAX_WEIGHTED_SCORE,
    SIGNAL_ORDER,
    SIGNAL_SUM_ORDER,
    SIGNAL_WEIGHTS,
    blend_total,
    catalogue_blend_total,
    catalogue_scale,
    catalogue_weight_total,
    description_affinity,
    normalize_score,
    present_signals,
    weighted_total,
)


def _scores(value: float = 0.0, **overrides) -> dict[str, float]:
    scores = {name: value for name in SIGNAL_WEIGHTS}
    scores.update(overrides)
    return scores


def _present(*names: str) -> set[str]:
    return set(names)


# ---------------------------------------------------------------------------
# The two kinds of signal partition the set
# ---------------------------------------------------------------------------


def test_every_signal_belongs_to_exactly_one_kind():
    # A signal in neither is silently dropped from the catalogue block and from the
    # consensus one; a signal in both is counted twice.
    assert set(CATALOGUE_SIGNALS) | set(CONSENSUS_SIGNALS) == set(SIGNAL_WEIGHTS)
    assert not set(CATALOGUE_SIGNALS) & set(CONSENSUS_SIGNALS)


def test_the_sum_order_covers_the_weights_exactly_once():
    assert sorted(SIGNAL_SUM_ORDER) == sorted(SIGNAL_WEIGHTS)
    assert len(SIGNAL_SUM_ORDER) == len(set(SIGNAL_SUM_ORDER))
    assert sorted(SIGNAL_ORDER) == sorted(SIGNAL_WEIGHTS)


def test_presence_covers_every_signal():
    arity = len(inspect.signature(present_signals).parameters)
    assert present_signals(*([True] * arity)) == set(SIGNAL_WEIGHTS)


# ---------------------------------------------------------------------------
# What a title with no audience can reach
# ---------------------------------------------------------------------------


def test_full_catalogue_evidence_and_no_consensus_reaches_the_catalogue_share():
    """The headline property. A title nobody has read, matching everything known about
    it, earns the whole catalogue block and none of the consensus one."""
    scores = _scores(0.0, **{name: 1.0 for name in CATALOGUE_SIGNALS})
    total = catalogue_blend_total(scores, SIGNAL_WEIGHTS, _present(*CATALOGUE_SIGNALS))
    assert total == pytest.approx(catalogue_weight_total(SIGNAL_WEIGHTS))


def test_the_catalogue_share_is_the_majority_of_the_total():
    # The redesign is a statement about where the weight sits, not only about the shape
    # of the sum. Judged against the whole vector so it cannot drift on a re-weighting.
    assert catalogue_weight_total(SIGNAL_WEIGHTS) > MAX_WEIGHTED_SCORE / 2


def test_a_perfect_score_is_still_a_hundred_percent():
    scores = _scores(1.0)
    total = catalogue_blend_total(scores, SIGNAL_WEIGHTS, set(SIGNAL_WEIGHTS))
    assert total == pytest.approx(MAX_WEIGHTED_SCORE)
    assert normalize_score(total) == 100


def test_no_presence_combination_can_exceed_the_published_total():
    """The divisor the match percentage uses is unchanged, so nothing may clear it."""
    names = list(SIGNAL_WEIGHTS)
    scores = _scores(1.0)
    for mask in range(1 << len(names)):
        present = {name for index, name in enumerate(names) if mask & (1 << index)}
        total = catalogue_blend_total(scores, SIGNAL_WEIGHTS, present)
        assert total <= MAX_WEIGHTED_SCORE + 1e-9


# ---------------------------------------------------------------------------
# Missing consensus data withholds a bonus; it does not divide
# ---------------------------------------------------------------------------


def test_absent_consensus_data_costs_only_its_own_weight():
    strong = _scores(0.0, **{name: 1.0 for name in CATALOGUE_SIGNALS})
    with_crowd = catalogue_blend_total(
        {**strong, **{name: 1.0 for name in CONSENSUS_SIGNALS}},
        SIGNAL_WEIGHTS,
        set(SIGNAL_WEIGHTS),
    )
    without_crowd = catalogue_blend_total(
        strong, SIGNAL_WEIGHTS, _present(*CATALOGUE_SIGNALS)
    )
    lost = with_crowd - without_crowd
    assert lost == pytest.approx(sum(SIGNAL_WEIGHTS[n] for n in CONSENSUS_SIGNALS))


def test_a_thin_catalogue_title_beats_a_dense_title_that_matches_nothing():
    """The ordering the redesign exists to produce.

    An unread title whose description and developer both match the reader outranks a
    well-covered title that scores poorly on every one of its many signals.
    """
    unread = catalogue_blend_total(
        _scores(0.0, description=0.9, developer=0.9),
        SIGNAL_WEIGHTS,
        _present("description", "developer"),
    )
    well_covered = catalogue_blend_total(
        _scores(0.12), SIGNAL_WEIGHTS, set(SIGNAL_WEIGHTS)
    )
    assert unread > well_covered


def test_a_missing_description_is_not_scored_as_a_bad_one():
    """Silence and a poor match must not land in the same place."""
    silent = catalogue_blend_total(
        _scores(0.0, developer=0.8),
        SIGNAL_WEIGHTS,
        _present("developer"),
    )
    bad_match = catalogue_blend_total(
        _scores(0.0, developer=0.8, description=0.0),
        SIGNAL_WEIGHTS,
        _present("developer", "description"),
    )
    assert silent > bad_match


# ---------------------------------------------------------------------------
# The floor under the catalogue divisor
# ---------------------------------------------------------------------------


def test_one_thin_fact_cannot_earn_the_whole_catalogue_block(monkeypatch):
    thinnest = min(SIGNAL_WEIGHTS[name] for name in CATALOGUE_SIGNALS)
    monkeypatch.setattr(
        hr,
        "CATALOGUE_EVIDENCE_FLOOR_SHARE",
        (thinnest * 2) / hr.catalogue_weight_total(SIGNAL_WEIGHTS),
    )
    name = min(CATALOGUE_SIGNALS, key=lambda signal: SIGNAL_WEIGHTS[signal])
    total = catalogue_blend_total(
        _scores(0.0, **{name: 1.0}), SIGNAL_WEIGHTS, _present(name)
    )
    assert total < catalogue_weight_total(SIGNAL_WEIGHTS)


def test_evidence_at_or_above_the_floor_divides_by_the_evidence(monkeypatch):
    present = _present("description")
    weight = SIGNAL_WEIGHTS["description"]
    monkeypatch.setattr(
        hr,
        "CATALOGUE_EVIDENCE_FLOOR_SHARE",
        (weight / 2) / hr.catalogue_weight_total(SIGNAL_WEIGHTS),
    )
    assert catalogue_scale(present, SIGNAL_WEIGHTS) == pytest.approx(
        catalogue_weight_total(SIGNAL_WEIGHTS) / weight
    )


def test_a_candidate_with_no_catalogue_evidence_does_not_divide_by_zero():
    assert catalogue_scale(_present(*CONSENSUS_SIGNALS), SIGNAL_WEIGHTS) == 0.0
    total = catalogue_blend_total(
        _scores(1.0), SIGNAL_WEIGHTS, _present(*CONSENSUS_SIGNALS)
    )
    # It keeps the whole consensus block: absent catalogue facts scale nothing away from
    # what the crowd had to say.
    assert total == pytest.approx(sum(SIGNAL_WEIGHTS[n] for n in CONSENSUS_SIGNALS))


def test_a_vector_with_no_catalogue_weight_scales_to_zero_rather_than_dividing():
    weights = {**SIGNAL_WEIGHTS, **{name: 0.0 for name in CATALOGUE_SIGNALS}}
    assert catalogue_scale(set(SIGNAL_WEIGHTS), weights) == 0.0


# ---------------------------------------------------------------------------
# What counts as evidence about this reader
# ---------------------------------------------------------------------------


def test_an_entity_the_reader_has_no_history_with_is_not_evidence(monkeypatch):
    """A studio the reader has never read scores zero because the two lists do not meet,
    not because the studio was weighed. Counted as evidence it would sit in the divisor of
    nearly every candidate in the catalogue while separating none of them."""
    monkeypatch.setattr(hr, "CATALOGUE_MATCH_PRESENCE", True)
    assert hr.entity_evidence({"p1": 1.0}, ["p2"]) is False
    assert hr.entity_evidence({"p1": 1.0}, ["p1", "p2"]) is True
    assert hr.entity_evidence({}, ["p1"]) is False
    assert hr.entity_evidence({"p1": 1.0}, []) is False


def test_without_the_rule_presence_is_the_candidate_carrying_any(monkeypatch):
    monkeypatch.setattr(hr, "CATALOGUE_MATCH_PRESENCE", False)
    assert hr.entity_evidence({"p1": 1.0}, ["p2"]) is True
    assert hr.entity_evidence({}, ["p1"]) is True
    assert hr.entity_evidence({}, []) is False


def test_an_unmatched_entity_no_longer_dilutes_what_did_match(monkeypatch):
    monkeypatch.setattr(hr, "CATALOGUE_MATCH_PRESENCE", True)
    scores = _scores(0.0, description=0.6)
    matched_only = catalogue_blend_total(
        scores,
        SIGNAL_WEIGHTS,
        present_signals(
            False, False, False, False,
            has_developers=hr.entity_evidence({"p1": 1.0}, ["p2"]),
            has_staff=False, has_traits=False, has_seiyuu=False,
            has_description=True,
        ),
    )
    counted = catalogue_blend_total(
        scores, SIGNAL_WEIGHTS, _present("description", "developer")
    )
    assert matched_only > counted


# ---------------------------------------------------------------------------
# The previous shape stays reachable
# ---------------------------------------------------------------------------


def test_every_part_of_the_redesign_is_recorded_in_the_run_configuration():
    """A stored result has to name the configuration it was produced under, or two runs
    cannot be compared. Each of these decides part of what the engine does."""
    recorded = set(hr.switch_settings())
    for name in (
        "REC_SCORING_MODEL",
        "REC_SIGNAL_WEIGHTS",
        "REC_CATALOGUE_BLEND",
        "REC_CATALOGUE_EVIDENCE_FLOOR_SHARE",
        "REC_DESC_SIGNAL",
        "REC_DESC_BEST_MATCH",
        "REC_DESC_COSINE_FLOOR",
        "REC_DESC_COSINE_CEILING",
        "REC_DESC_SEEDS",
        "REC_DESC_RETRIEVAL",
        "REC_DESC_RETRIEVAL_SEEDS",
        "REC_DESC_RETRIEVAL_PER_SEED",
        "REC_DESC_RETRIEVAL_SHARE",
        "REC_DESC_RETRIEVAL_BAND_SHARES",
        "REC_CATALOGUE_MATCH_PRESENCE",
        "REC_RETRIEVAL_SEED_SPREAD",
    ):
        assert name in recorded, name


def test_the_reach_first_vector_is_a_harder_tilt_of_the_same_shape():
    """It is an alternative balance, not a different model: same signals, same kinds."""
    assert set(hr.REACH_SIGNAL_WEIGHTS) == set(SIGNAL_WEIGHTS)
    assert (
        catalogue_weight_total(hr.REACH_SIGNAL_WEIGHTS)
        > catalogue_weight_total(SIGNAL_WEIGHTS)
    )
    assert hr.REACH_SIGNAL_WEIGHTS["description"] > SIGNAL_WEIGHTS["description"]


def test_the_legacy_vector_gives_description_no_weight():
    # Which is what makes a legacy run comparable to a run taken before the signal
    # existed rather than merely similar to one.
    assert LEGACY_SIGNAL_WEIGHTS["description"] == 0.0


def test_a_legacy_sum_is_unchanged_by_the_signal_it_does_not_weight():
    scores = _scores(0.37, description=0.99)
    without = sum(
        scores[name] * LEGACY_SIGNAL_WEIGHTS[name]
        for name in SIGNAL_SUM_ORDER
        if name != "description"
    )
    assert weighted_total(scores, LEGACY_SIGNAL_WEIGHTS) == without


def test_the_blend_switch_selects_between_the_two_shapes(monkeypatch):
    scores = _scores(0.4)
    present = set(SIGNAL_WEIGHTS)

    monkeypatch.setattr(hr, "CATALOGUE_BLEND", True)
    blended = blend_total(scores, SIGNAL_WEIGHTS, present)
    assert blended == catalogue_blend_total(scores, SIGNAL_WEIGHTS, present)

    monkeypatch.setattr(hr, "CATALOGUE_BLEND", False)
    monkeypatch.setattr(hr, "EVIDENCE_DENOMINATOR", MAX_WEIGHTED_SCORE)
    assert blend_total(scores, SIGNAL_WEIGHTS, present) == weighted_total(
        scores, SIGNAL_WEIGHTS
    )


def test_the_blend_ignores_the_evidence_denominator(monkeypatch):
    """The two divisors are alternatives, not a stack. Applying both would divide a
    thin title's catalogue block twice and reintroduce what the blend removes."""
    scores = _scores(0.4)
    present = _present("description", "tag")
    monkeypatch.setattr(hr, "CATALOGUE_BLEND", True)
    monkeypatch.setattr(hr, "EVIDENCE_DENOMINATOR", 1.0)
    assert blend_total(scores, SIGNAL_WEIGHTS, present) == catalogue_blend_total(
        scores, SIGNAL_WEIGHTS, present
    )


# ---------------------------------------------------------------------------
# Description affinity
# ---------------------------------------------------------------------------


def test_affinity_is_bounded_to_the_range_the_weighted_sum_assumes():
    for cosine in (-1.0, -0.3, 0.0, 0.25, 0.5, 0.9, 1.0):
        assert 0.0 <= description_affinity(cosine) <= 1.0


def test_an_unrelated_pair_scores_nothing_rather_than_something_negative():
    assert description_affinity(-0.4) == 0.0


def test_affinity_rises_with_closeness():
    values = [description_affinity(c) for c in (0.0, 0.15, 0.3, 0.45, 0.6)]
    assert values == sorted(values)
    assert values[0] < values[-1]


def test_a_thematic_neighbour_lands_in_the_middle_of_the_range(monkeypatch):
    """The corpus cosines run roughly -0.3 to 1.0, not 0 to 1. A raw cosine handed to the
    weighted sum would give the signal a fraction of the weight it is assigned."""
    monkeypatch.setattr(hr, "DESC_COSINE_FLOOR", 0.0)
    monkeypatch.setattr(hr, "DESC_COSINE_CEILING", 0.6)
    assert description_affinity(0.3) == pytest.approx(0.5)
    assert description_affinity(0.6) == pytest.approx(1.0)


def test_a_degenerate_range_does_not_divide_by_zero(monkeypatch):
    monkeypatch.setattr(hr, "DESC_COSINE_FLOOR", 0.5)
    monkeypatch.setattr(hr, "DESC_COSINE_CEILING", 0.5)
    assert description_affinity(0.9) == 1.0
    assert description_affinity(0.1) == 0.0
    assert not math.isnan(description_affinity(0.5))
