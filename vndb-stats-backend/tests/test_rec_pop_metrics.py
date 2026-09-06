"""The popularity metrics have to separate an obscure list from a popular one.

Each check builds the smallest catalogue that makes one formula's answer predictable by
hand, so a change to a formula shows up as a number that moves rather than as a run that
still produces plausible-looking output.
"""

import math
import os
import sys

import pytest

SCRIPTS = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "scripts"))
if SCRIPTS not in sys.path:
    sys.path.insert(0, SCRIPTS)

from rec_pop_metrics import (  # noqa: E402
    PopularityIndex,
    calibration_kl,
    catalogue_coverage,
    gini,
    median_log_popularity,
    novelty_at_k,
    pop_metric_names,
    popularity_gap_at_k,
    popularity_slope,
    run_pop_stats,
    tail_ndcg_at_k,
    tail_share_at_k,
)


def build_index(votecounts: dict[str, int]) -> PopularityIndex:
    """Stand-in for load_popularity_index, ranking a handful of titles by votecount."""
    ordered = sorted(votecounts.items(), key=lambda item: (-item[1], item[0]))
    total = len(ordered)
    rank_fraction = {vn_id: i / total for i, (vn_id, _) in enumerate(ordered)}
    votes = {vn_id: max(count, 1) for vn_id, count in ordered}
    vote_total = sum(votes.values())
    bits = {vn_id: -math.log2(count / vote_total) for vn_id, count in votes.items()}
    reference = sum((votes[v] / vote_total) * b for v, b in bits.items())
    log_popularity = {vn_id: math.log10(count + 1) for vn_id, count in votecounts.items()}
    return PopularityIndex(rank_fraction, bits, reference, log_popularity)


@pytest.fixture
def index() -> PopularityIndex:
    # Ten titles, so the top 10% is exactly the single most voted one.
    return build_index({f"v{i}": (10 - i) * 100 for i in range(10)})


def test_head_boundary_is_the_top_theta_of_the_catalogue(index):
    assert index.is_head("v0", 0.1)
    assert not index.is_head("v1", 0.1)
    assert index.is_head("v1", 0.5)


def test_absent_title_counts_as_tail(index):
    assert not index.is_head("v999", 0.5)


def test_tail_share_counts_positions_outside_the_head(index):
    assert tail_share_at_k(["v0", "v1", "v2", "v3"], 4, index, 0.2) == 0.5
    assert tail_share_at_k(["v5", "v6"], 4, index, 0.5) == 1.0


def test_tail_share_is_undefined_for_an_empty_list(index):
    assert tail_share_at_k([], 10, index, 0.05) is None


def test_tail_ndcg_ignores_head_ground_truth(index):
    # The only relevant title outside the head sits second, so the score is the
    # discount at position 2 over an ideal of one hit at position 1.
    value = tail_ndcg_at_k(["v0", "v7"], {"v0", "v7"}, 10, index, 0.5)
    assert value == pytest.approx(1.0 / math.log2(3))


def test_tail_ndcg_is_undefined_without_tail_ground_truth(index):
    assert tail_ndcg_at_k(["v0", "v1"], {"v0", "v1"}, 10, index, 0.5) is None


def test_novelty_rises_as_the_list_gets_more_obscure(index):
    popular = novelty_at_k(["v0", "v1"], 2, index)
    obscure = novelty_at_k(["v8", "v9"], 2, index)
    assert obscure > popular
    assert popular == pytest.approx(
        (index.novelty_bits["v0"] + index.novelty_bits["v1"]) / 2
    )


def test_reference_novelty_sits_between_the_extremes(index):
    assert novelty_at_k(["v0"], 1, index) < index.reference_novelty_bits
    assert novelty_at_k(["v9"], 1, index) > index.reference_novelty_bits


def test_coverage_and_gini_describe_the_spread_across_readers(index):
    stats = run_pop_stats([["v0", "v1"], ["v0", "v2"]], index)
    assert stats["distinct_items"] == 3
    assert stats["coverage"] == pytest.approx(0.3)
    # v0 twice against one apiece: unequal, but far from one title carrying the run.
    assert 0.0 < stats["gini_recommended"] < 0.5


def test_gini_is_zero_when_every_title_is_served_alike():
    assert gini([3, 3, 3]) == pytest.approx(0.0)


def test_gini_and_coverage_are_undefined_on_nothing():
    assert gini([]) is None
    assert catalogue_coverage(0, 0) is None


def test_calibration_is_zero_when_the_list_matches_the_profile():
    # A profile split evenly between two groups, and a recommended title split the same
    # way, so the rank discount has nothing to shift between them.
    dists = {"a": {1: 1.0}, "b": {2: 1.0}, "m": {1: 0.5, 2: 0.5}}
    value = calibration_kl(["a", "b"], ["m", "m"], 4, dists)
    assert value == pytest.approx(0.0, abs=1e-9)


def test_calibration_grows_when_the_list_drifts_off_the_profile():
    dists = {"a": {1: 1.0}, "x": {1: 1.0}, "z": {2: 1.0}}
    aligned = calibration_kl(["a"], ["x"], 10, dists)
    drifted = calibration_kl(["a"], ["z"], 10, dists)
    assert aligned == pytest.approx(0.0, abs=1e-9)
    assert drifted > aligned


def test_calibration_stays_finite_when_a_profile_group_is_absent():
    dists = {"a": {1: 1.0}, "z": {2: 1.0}}
    value = calibration_kl(["a"], ["z"], 10, dists)
    # The mixture leaves the reader's whole taste weighted at the smoothing floor.
    assert value == pytest.approx(math.log2(1 / 0.01))


def test_calibration_is_undefined_without_tags_on_either_side():
    assert calibration_kl(["a"], ["x"], 10, {"a": {}, "x": {1: 1.0}}) is None
    assert calibration_kl(["a"], ["x"], 10, {"a": {1: 1.0}, "x": {}}) is None


def test_median_log_popularity_ignores_titles_the_index_cannot_place(index):
    # v0 at 1000 votes and v9 at 100: the median of the two, in logs.
    assert median_log_popularity(["v0", "v9"], index) == pytest.approx(
        (math.log10(1001) + math.log10(101)) / 2
    )
    assert median_log_popularity(["v0", "unknown"], index) == pytest.approx(
        math.log10(1001)
    )
    assert median_log_popularity(["unknown"], index) is None
    assert median_log_popularity([], index) is None


def test_popularity_gap_is_signed_around_the_readers_own_level(index):
    # Read the best known title, served the least known one: the list is more obscure.
    assert popularity_gap_at_k(["v0"], ["v9"], 1, index) < 0
    assert popularity_gap_at_k(["v9"], ["v0"], 1, index) > 0
    # Served where they read, whichever level that is.
    assert popularity_gap_at_k(["v4"], ["v4"], 1, index) == pytest.approx(0.0)
    # Only the top-k counts, so a tail the reader does not see cannot close the gap.
    assert popularity_gap_at_k(["v0"], ["v9", "v0"], 1, index) == popularity_gap_at_k(
        ["v0"], ["v9"], 1, index
    )
    assert popularity_gap_at_k([], ["v0"], 1, index) is None


def test_popularity_slope_recovers_the_line_the_readers_lie_on():
    # Every reader served exactly where they read.
    fit = popularity_slope([(1.0, 1.0), (2.0, 2.0), (3.0, 3.0)])
    assert fit["popularity_slope"] == pytest.approx(1.0)
    assert fit["popularity_r"] == pytest.approx(1.0)
    assert fit["popularity_slope_users"] == 3

    # Every reader served from the same place, whatever they read: the defect the metric
    # exists to name.
    flat = popularity_slope([(1.0, 2.5), (2.0, 2.5), (3.0, 2.5)])
    assert flat["popularity_slope"] == pytest.approx(0.0)
    assert flat["popularity_r"] is None

    # Two thirds of the signal discarded, which is what a compressed engine looks like.
    partial = popularity_slope([(1.0, 2.0), (2.0, 2.5), (3.0, 3.0)])
    assert partial["popularity_slope"] == pytest.approx(0.5)


def test_popularity_slope_is_undefined_without_spread_between_readers():
    assert popularity_slope([])["popularity_slope"] is None
    assert popularity_slope([(2.0, 3.0)])["popularity_slope"] is None
    # Readers who all read at one level cannot say how the engine treats readers who
    # differ, however their lists came out.
    assert popularity_slope([(2.0, 1.0), (2.0, 3.0)])["popularity_slope"] is None


def test_run_stats_carry_the_slope_beside_coverage(index):
    stats = run_pop_stats(
        [["v0", "v1"], ["v0", "v2"]],
        index,
        popularity_pairs=[(1.0, 1.0), (2.0, 2.0)],
    )
    assert stats["popularity_slope"] == pytest.approx(1.0)
    assert stats["popularity_slope_users"] == 2
    # A run that passes no pairs still reports the rest rather than failing.
    assert run_pop_stats([["v0"]], index)["popularity_slope"] is None


def test_metric_names_carry_the_cutoff():
    names = pop_metric_names(10)
    assert names == (
        "tail_share@10_1pct",
        "tail_share@10_5pct",
        "tail_ndcg@10_1pct",
        "tail_ndcg@10_5pct",
        "novelty@10",
        "calibration_kl@10",
        "read_pop_median",
        "rec_pop_median@10",
        "popularity_gap@10",
    )
