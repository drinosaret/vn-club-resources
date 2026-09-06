"""The evidence denominator, and its control.

Signal coverage tracks how widely a title has been read: the co-readership table cannot
hold a title below the readership floor it was built from, and staff, seiyuu and tag rows
thin out the same way. Dividing every candidate by the full weight total therefore marks
a thinly covered title against a total its missing tables can never reach, which is a
popularity effect wearing the clothes of a quality judgement.

The switch that changes this has to be provable as a no-op at its default, because a
variant measured against a control that does not actually reproduce the old behaviour
reports the difference between two changes rather than the effect of one. The proof here
is exhaustive rather than illustrative: every one of the 256 presence combinations is
checked, since the control only holds while no combination of present weights can exceed
the floor.
"""

import asyncio
import inspect
import itertools

from sqlalchemy.dialects import postgresql

from app.services import hybrid_recommender as hr
from app.services.hybrid_recommender import (
    HybridRecommender,
    MAX_WEIGHTED_SCORE,
    SIGNAL_WEIGHTS,
    evidence_gating_active,
    evidence_scale,
    normalize_score,
    present_signals,
    quality_score_for,
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


def _sql(statement):
    compiled = statement.compile(dialect=postgresql.dialect())
    return str(compiled), dict(compiled.params)


def _all_presence_sets():
    names = list(SIGNAL_WEIGHTS)
    for size in range(len(names) + 1):
        for combination in itertools.combinations(names, size):
            yield set(combination)


def _present_weight(signals):
    total = 0.0
    for signal, weight in SIGNAL_WEIGHTS.items():
        if signal in signals:
            total += weight
    return total


# --- the control ------------------------------------------------------------------


def test_the_full_weight_total_turns_gating_off(monkeypatch):
    # The published default gates; setting the denominator back to the full total is how the
    # ungated behaviour is recovered, so that equivalence is what needs guarding.
    monkeypatch.setattr(hr, "EVIDENCE_DENOMINATOR", MAX_WEIGHTED_SCORE)
    monkeypatch.setattr(hr, "QUALITY_STRICT", False)
    assert evidence_gating_active() is False


def test_no_combination_of_present_weights_exceeds_the_full_total():
    """The control rests on this: if a candidate could present more weight than the
    floor, the floor would stop being the divisor and the default would not reproduce
    the old score."""
    for signals in _all_presence_sets():
        assert _present_weight(signals) <= MAX_WEIGHTED_SCORE


def test_default_scale_is_exactly_one_for_every_presence_combination(monkeypatch):
    monkeypatch.setattr(hr, "EVIDENCE_DENOMINATOR", MAX_WEIGHTED_SCORE)
    for signals in _all_presence_sets():
        assert evidence_scale(signals) == 1.0


def test_denominator_written_out_as_a_decimal_is_also_a_no_op(monkeypatch):
    """The floor can be configured as the literal 9.9 rather than left at the computed
    total, and the two spellings need not be the same float."""
    monkeypatch.setattr(hr, "EVIDENCE_DENOMINATOR", 9.9)
    for signals in _all_presence_sets():
        assert evidence_scale(signals) == 1.0


def test_scaling_by_the_default_leaves_a_score_bit_identical(monkeypatch):
    monkeypatch.setattr(hr, "EVIDENCE_DENOMINATOR", MAX_WEIGHTED_SCORE)
    monkeypatch_free_totals = [0.0, 1e-9, 0.1 + 0.2, 3.3333333333333335, 9.9]
    for total in monkeypatch_free_totals:
        for signals in _all_presence_sets():
            assert total * evidence_scale(signals) == total


# --- the gated behaviour ----------------------------------------------------------


def test_a_fully_present_candidate_is_unchanged_by_gating(monkeypatch):
    monkeypatch.setattr(hr, "EVIDENCE_DENOMINATOR", 5.0)
    assert evidence_gating_active() is True
    assert evidence_scale(set(SIGNAL_WEIGHTS)) == 1.0


def test_a_sparse_candidate_is_judged_on_what_spoke_for_it(monkeypatch):
    """Below the floor the floor divides, whatever the candidate presented."""
    signals = present_signals(
        has_tags=True,
        has_similar_games=False,
        has_users_also_read=False,
        has_quality=True,
        has_developers=False,
        has_staff=False,
        has_traits=False,
        has_seiyuu=False,
    )
    floor = _present_weight(signals) + 1.0
    monkeypatch.setattr(hr, "EVIDENCE_DENOMINATOR", floor)
    assert evidence_scale(signals) == MAX_WEIGHTED_SCORE / floor


def test_present_weight_above_the_floor_divides_by_the_evidence(monkeypatch):
    signals = {"tag", "similar_games", "users_also_read"}
    present = _present_weight(signals)
    monkeypatch.setattr(hr, "EVIDENCE_DENOMINATOR", present / 2.0)
    assert evidence_scale(signals) == MAX_WEIGHTED_SCORE / present


def test_a_candidate_with_no_signal_present_does_not_divide_by_zero(monkeypatch):
    monkeypatch.setattr(hr, "EVIDENCE_DENOMINATOR", 5.0)
    assert evidence_scale(set()) == MAX_WEIGHTED_SCORE / 5.0
    # A candidate with nothing present also has nothing to scale: the total is zero.
    assert 0.0 * evidence_scale(set()) == 0.0


def test_a_floor_of_zero_is_treated_as_no_scaling(monkeypatch):
    """A floor at zero would otherwise divide a candidate with no evidence by nothing."""
    monkeypatch.setattr(hr, "EVIDENCE_DENOMINATOR", 0.0)
    assert evidence_scale(set()) == 1.0


def test_gating_lifts_a_sparse_candidate_over_an_equally_scored_dense_one(monkeypatch):
    """The point of the change, stated as an ordering rather than an arithmetic identity.

    Read in two halves: at the full total the two candidates are indistinguishable, and once
    the denominator follows the evidence the sparse one rises above the dense one.
    """
    monkeypatch.setattr(hr, "EVIDENCE_DENOMINATOR", MAX_WEIGHTED_SCORE)
    dense = present_signals(True, True, True, True, True, True, True, True)
    sparse = present_signals(
        has_tags=True,
        has_similar_games=False,
        has_users_also_read=False,
        has_quality=True,
        has_developers=False,
        has_staff=False,
        has_traits=False,
        has_seiyuu=False,
    )
    raw_total = 3.0

    assert raw_total * evidence_scale(dense) == raw_total * evidence_scale(sparse)

    monkeypatch.setattr(hr, "EVIDENCE_DENOMINATOR", 5.0)
    assert raw_total * evidence_scale(sparse) > raw_total * evidence_scale(dense)


def test_the_display_scale_still_caps_at_one_hundred(monkeypatch):
    monkeypatch.setattr(hr, "EVIDENCE_DENOMINATOR", 5.0)
    scaled = 8.0 * evidence_scale({"tag", "quality"})
    assert scaled > MAX_WEIGHTED_SCORE
    assert normalize_score(scaled) == 100


# --- presence -----------------------------------------------------------------------


def test_presence_names_line_up_with_the_weight_keys():
    arity = len(inspect.signature(present_signals).parameters)
    assert present_signals(*([True] * arity)) == set(SIGNAL_WEIGHTS)
    assert present_signals(*([False] * arity)) == set()


def test_presence_is_about_the_data_not_the_score(monkeypatch):
    """A zero scored over tags the candidate actually carries is a verdict and keeps its
    weight in the denominator; a zero standing in for an absent table row does not."""
    monkeypatch.setattr(hr, "EVIDENCE_DENOMINATOR", 5.0)
    scored_zero_on_tags = present_signals(
        has_tags=True,
        has_similar_games=False,
        has_users_also_read=False,
        has_quality=True,
        has_developers=False,
        has_staff=False,
        has_traits=False,
        has_seiyuu=False,
    )
    no_tag_rows_at_all = present_signals(
        has_tags=False,
        has_similar_games=False,
        has_users_also_read=False,
        has_quality=True,
        has_developers=False,
        has_staff=False,
        has_traits=False,
        has_seiyuu=False,
    )
    assert _present_weight(scored_zero_on_tags) > _present_weight(no_tag_rows_at_all)


def test_similarity_presence_probe_is_one_batched_statement():
    session = _QueueSession([[_Row(vn_id="v10"), _Row(vn_id="v11")]])
    recommender = HybridRecommender(session)

    available = asyncio.run(
        recommender._batch_get_similarity_presence(["v10", "v11", "v12"])
    )

    assert available == {"v10", "v11"}
    assert len(session.statements) == 1
    sql, params = _sql(session.statements[0])
    assert "DISTINCT" in sql
    assert "= ANY" in sql  # one array parameter, not one bind per candidate
    assert list(params.values()) == [["v10", "v11", "v12"]]


def test_cooccurrence_presence_probe_is_one_batched_statement():
    session = _QueueSession([[_Row(vn_id="v10")]])
    recommender = HybridRecommender(session)

    available = asyncio.run(recommender._batch_get_cooccurrence_presence(["v10", "v11"]))

    assert available == {"v10"}
    assert len(session.statements) == 1
    sql, _ = _sql(session.statements[0])
    assert "vn_cooccurrence" in sql
    assert "= ANY" in sql


def test_presence_probes_ask_nothing_for_an_empty_candidate_set():
    session = _QueueSession([])
    recommender = HybridRecommender(session)

    assert asyncio.run(recommender._batch_get_similarity_presence([])) == set()
    assert asyncio.run(recommender._batch_get_cooccurrence_presence([])) == set()
    assert session.statements == []


# --- quality ------------------------------------------------------------------------


def test_an_unrated_title_carries_no_quality_evidence_by_default():
    """Absence of a rating is absence, not a middling score.

    A stand-in awards a title nobody has rated more than a title rated at the catalogue
    mean earns, so being unread pays better than being read and thought ordinary. The term
    is silent instead, and the evidence gate is what decides what silence costs.
    """
    assert hr.QUALITY_STRICT is True
    assert quality_score_for(8.0, 7.2) == (0.6, True)
    assert quality_score_for(None, 7.5) == (0.0, False)
    assert quality_score_for(None, None) == (0.0, False)
    assert quality_score_for(4.0, None) == (0, True)


def test_the_stand_in_rating_stays_reachable(monkeypatch):
    """The shape the strict term replaces, kept measurable against it."""
    monkeypatch.setattr(hr, "QUALITY_STRICT", False)
    assert quality_score_for(None, 7.5) == (0.5, True)
    assert quality_score_for(None, None) == (0.4, True)


def test_strict_quality_treats_an_unrated_title_as_silent(monkeypatch):
    monkeypatch.setattr(hr, "QUALITY_STRICT", True)
    assert quality_score_for(None, 7.5) == (0.0, False)
    assert quality_score_for(None, None) == (0.0, False)
    assert quality_score_for(8.0, None) == (0.6, True)
    # A genuine zero average is evidence, not absence.
    assert quality_score_for(0.0, 7.5) == (0, True)


def test_strict_quality_removes_the_free_weight_from_the_denominator(monkeypatch):
    monkeypatch.setattr(hr, "QUALITY_STRICT", True)
    monkeypatch.setattr(hr, "EVIDENCE_DENOMINATOR", 5.0)
    _, present = quality_score_for(None, 7.5)
    signals = present_signals(
        has_tags=True,
        has_similar_games=False,
        has_users_also_read=False,
        has_quality=present,
        has_developers=False,
        has_staff=False,
        has_traits=False,
        has_seiyuu=False,
    )
    assert "quality" not in signals
    assert _present_weight(signals) == SIGNAL_WEIGHTS["tag"]
