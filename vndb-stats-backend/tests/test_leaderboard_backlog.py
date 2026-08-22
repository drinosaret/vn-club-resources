"""Guards on the backlog gap board.

The direction and the choice of sample are the two things a reader would notice if they broke:
a sign flip would silently retitle the board, and taking the larger side as the sample would
let a thousand-item wishlist qualify against four finished titles.
"""

from __future__ import annotations

from app.leaderboards.aggregate import BacklogGap, rank_backlog_gap
from app.leaderboards.registry import board_for_slug
from app.leaderboards.serialize import format_value
from app.leaderboards.spec import LIST_METRICS, Metric
from app.leaderboards.thresholds import MIN_PER_SIDE_FOR_BACKLOG

SLUG = "users-backlog-longer"


def _spec():
    spec = board_for_slug(SLUG)
    assert spec is not None, f"{SLUG} is missing from the registry"
    return spec


def test_gap_is_wishlist_minus_finished():
    """Positive means the backlog is the longer side, which is what the title claims."""
    backlog = BacklogGap(finished=30, wishlist=30, finished_length=1.5, wishlist_length=3.8)
    assert backlog.gap > 0
    assert backlog.gap == backlog.wishlist_length - backlog.finished_length


def test_sample_is_the_smaller_side():
    """A long wishlist cannot carry a reader over the floor on its own."""
    spec = _spec()
    entries = rank_backlog_gap(
        spec,
        {
            "plenty": BacklogGap(
                finished=MIN_PER_SIDE_FOR_BACKLOG,
                wishlist=MIN_PER_SIDE_FOR_BACKLOG,
                finished_length=1.0,
                wishlist_length=4.0,
            ),
            "lopsided": BacklogGap(
                finished=MIN_PER_SIDE_FOR_BACKLOG - 1,
                wishlist=10_000,
                finished_length=1.0,
                wishlist_length=5.0,
            ),
        },
    )
    keys = [entry.key for entry in entries]
    assert "plenty" in keys
    assert "lopsided" not in keys


def test_sample_reported_is_the_smaller_side():
    spec = _spec()
    entries = rank_backlog_gap(
        spec,
        {
            "reader": BacklogGap(
                finished=40, wishlist=900, finished_length=1.0, wishlist_length=3.0
            )
        },
    )
    assert entries[0].count == 40


def test_board_is_ranked_by_the_larger_gap_first():
    spec = _spec()
    entries = rank_backlog_gap(
        spec,
        {
            "small": BacklogGap(finished=30, wishlist=30, finished_length=2.0,
                                wishlist_length=2.5),
            "large": BacklogGap(finished=30, wishlist=30, finished_length=1.2,
                                wishlist_length=3.9),
        },
    )
    assert [entry.key for entry in entries] == ["large", "small"]


def test_disclosure_quotes_the_floor_it_applies():
    spec = _spec()
    assert spec.min_count == MIN_PER_SIDE_FOR_BACKLOG
    assert str(MIN_PER_SIDE_FOR_BACKLOG) in spec.disclosure.floor


def test_disclosure_states_that_untimed_titles_are_dropped():
    """Both sides skip titles with no length, and the board says so rather than implying a mean."""
    spec = _spec()
    assert "length category" in spec.disclosure.excluded


def test_label_shows_both_means_and_the_sign():
    label = format_value(
        Metric.BACKLOG_GAP,
        2.35,
        30,
        {"wishlist_length": 3.83, "finished_length": 1.47},
    )
    assert label.startswith("+2.35")
    assert "3.8" in label and "1.5" in label


def test_label_survives_a_missing_breakdown():
    """A row without the secondary figures still renders a number rather than raising."""
    label = format_value(Metric.BACKLOG_GAP, -1.46, 44, {})
    assert "-1.46" in label


def test_metric_is_classified_as_list_derived():
    """Both sides are list states, so it must not be treated as a vote metric."""
    assert Metric.BACKLOG_GAP in LIST_METRICS
