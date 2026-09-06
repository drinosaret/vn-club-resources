"""Combining the signals' predicted marks by how well each of them predicts.

The signals are not equally accurate. Measured against marks readers went on to give, the
crowd's own average lands closer than tag affinity does, and counting the two equally
spends as much of the result on the weaker one. A mean of members that differ that much is
worse than its best member alone, so each signal carries the improvement it was measured
to make on knowing nothing but the reader's own average.

Pinned here: that level weights reproduce the plain mean exactly, so the switch off and
the switch on with a flat table are the same arithmetic; that the combined mark moves
toward the better-measured signal; that the interval is scaled by how many equally
weighted signals the weighted ones amount to, so a mark decided mostly by one of them
widens rather than borrowing the confidence of a panel; and that no table an environment
can supply drops a signal that spoke or leaves nothing to divide by.
"""

import pytest

from app.services import hybrid_recommender as engine
from app.services.hybrid_recommender import prediction_interval, prediction_weight


@pytest.fixture(autouse=True)
def weighting_on(monkeypatch):
    monkeypatch.setattr(engine, "PREDICTION_WEIGHTED", True)


def _table(monkeypatch, weights):
    monkeypatch.setattr(engine, "PREDICTION_SIGNAL_WEIGHT", weights)


# ---------------------------------------------------------------------------
# Level weights are the plain mean
# ---------------------------------------------------------------------------


def test_level_weights_reproduce_the_unweighted_interval(monkeypatch):
    """A flat table has to be the arithmetic the switch replaces, to the last digit.

    Anything else would mean the weighted path carries a second definition of the spread
    and the two could report different intervals for signals that agree exactly as much.
    """
    marks = {"tag": 7.0, "quality": 7.2, "staff": 6.8, "developer": 7.4}
    _table(monkeypatch, {name: 1.0 for name in marks})

    assert prediction_interval(marks) == prediction_interval(list(marks.values()))


def test_a_sequence_is_averaged_whatever_the_switch_says(monkeypatch):
    """Values arriving without names are a caller with nothing to weight by."""
    _table(monkeypatch, {"quality": 1.0, "tag": 0.01})

    mean, _, _ = prediction_interval([9.0, 5.0])
    assert mean == pytest.approx(7.0)


def test_the_switch_off_averages_a_mapping(monkeypatch):
    monkeypatch.setattr(engine, "PREDICTION_WEIGHTED", False)
    _table(monkeypatch, {"quality": 1.0, "tag": 0.01})

    mean, _, _ = prediction_interval({"quality": 9.0, "tag": 5.0})
    assert mean == pytest.approx(7.0)


# ---------------------------------------------------------------------------
# What the weights do to the mark
# ---------------------------------------------------------------------------


def test_the_mark_moves_toward_the_better_measured_signal(monkeypatch):
    _table(monkeypatch, {"quality": 0.2, "tag": 0.05})

    mean, _, _ = prediction_interval({"quality": 9.0, "tag": 5.0})
    assert mean == pytest.approx((0.2 * 9.0 + 0.05 * 5.0) / 0.25)
    assert 5.0 < mean < 9.0


def test_scaling_the_whole_table_changes_nothing(monkeypatch):
    """Only the ratios are read, so a table stated in other units is the same table."""
    marks = {"quality": 9.0, "tag": 5.0, "trait": 6.0}

    _table(monkeypatch, {"quality": 0.2, "tag": 0.05, "trait": 0.01})
    small = prediction_interval(marks)
    _table(monkeypatch, {"quality": 20.0, "tag": 5.0, "trait": 1.0})
    large = prediction_interval(marks)

    assert large == pytest.approx(small)


# ---------------------------------------------------------------------------
# What the weights do to the interval
# ---------------------------------------------------------------------------


def test_one_signal_carrying_the_mark_widens_the_range(monkeypatch):
    """The spread is scaled by the count the weights amount to, not the count that spoke.

    Four signals weighted level say four signals' worth about their own scatter. The same
    four with one of them carrying most of the mark say barely more than one signal's
    worth, and an interval that ignored the difference would quote the agreement of a
    panel for a number decided by one of its members.
    """
    marks = {"quality": 7.0, "tag": 7.2, "staff": 6.8, "developer": 7.4}

    _table(monkeypatch, {name: 0.1 for name in marks})
    _, level_low, level_high = prediction_interval(marks)
    _table(monkeypatch, {"quality": 0.4, "tag": 0.02, "staff": 0.02, "developer": 0.02})
    _, skewed_low, skewed_high = prediction_interval(marks)

    assert skewed_high - skewed_low > level_high - level_low


def test_a_lone_signal_is_still_a_point(monkeypatch):
    _table(monkeypatch, {"quality": 0.2})

    assert prediction_interval({"quality": 6.5}) == (6.5, None, None)


def test_nothing_spoke_reports_nothing(monkeypatch):
    _table(monkeypatch, {"quality": 0.2})

    assert prediction_interval({}) == (None, None, None)


def test_the_range_stays_inside_the_scale_marks_are_given_on(monkeypatch):
    _table(monkeypatch, {"quality": 0.2, "tag": 0.19, "staff": 0.18})

    _, low, high = prediction_interval({"quality": 9.9, "tag": 2.0, "staff": 9.5})
    assert low == 1.0
    assert high == 10.0


# ---------------------------------------------------------------------------
# Tables an environment can supply
# ---------------------------------------------------------------------------


def test_an_unnamed_signal_is_treated_as_typical(monkeypatch):
    """An unmeasured signal is not the same as one measured and found to say nothing."""
    _table(monkeypatch, {"quality": 0.2})

    mean, _, _ = prediction_interval({"quality": 9.0, "newcomer": 5.0})
    assert mean == pytest.approx(7.0)


def test_a_signal_measured_at_nothing_still_counts_for_something(monkeypatch):
    _table(monkeypatch, {"quality": 0.2, "trait": 0.0})

    assert prediction_weight("trait") == engine.MIN_PREDICTION_WEIGHT
    mean, _, _ = prediction_interval({"quality": 9.0, "trait": 5.0})
    assert 8.5 < mean < 9.0


def test_a_table_of_zeroes_leaves_something_to_divide_by(monkeypatch):
    _table(monkeypatch, {"quality": 0.0, "tag": 0.0})

    mean, _, _ = prediction_interval({"quality": 9.0, "tag": 5.0})
    assert mean == pytest.approx(7.0)


def test_a_negative_weight_cannot_pull_a_mark_off_the_scale(monkeypatch):
    _table(monkeypatch, {"quality": 0.2, "tag": -5.0})

    mean, _, _ = prediction_interval({"quality": 9.0, "tag": 5.0})
    assert 5.0 <= mean <= 9.0


# ---------------------------------------------------------------------------
# The shipped table
# ---------------------------------------------------------------------------


def test_every_signal_that_can_speak_is_measured():
    """A signal missing from the table falls back to typical, which hides the omission.

    The eight names here are the ones _predicted_ratings can produce; co-occurrence
    abstains and so is deliberately absent.
    """
    assert set(engine.PREDICTION_SIGNAL_WEIGHT) == {
        "tag",
        "developer",
        "staff",
        "seiyuu",
        "trait",
        "description",
        "similar_games",
        "quality",
    }
    assert all(weight > 0 for weight in engine.PREDICTION_SIGNAL_WEIGHT.values())
