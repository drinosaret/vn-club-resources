"""Cover the leaderboard arithmetic.

Everything here runs without a database. The shapes being tested are the ones that produce
a plausible-looking but wrong board: purity exclusion, sole-voter collapsing, Bayesian
damping, ratio floors, and tie ordering.
"""

import math
from dataclasses import replace
from datetime import date, timedelta

from app.leaderboards.aggregate import (
    BAYESIAN_PRIOR_VOTES,
    SKETCH_SIZE,
    Bucket,
    LabelCounts,
    VoteActivity,
    accumulate_votes,
    bayesian_average,
    build_buckets,
    facet_membership,
    percentile_of,
    percentile_sketch,
    share_below,
    ReaderScan,
    damped_rate,
    global_mean_vote,
    rank_catalogue_floor,
    rank_label_board,
    rank_discovery_lag,
    rank_reader_scan,
    rank_series_span,
    rank_terminal,
    rank_title_aggregate,
    rank_title_average,
    roll_up_by_entity,
    rank_rating_as_of,
    rank_reputation_board,
    rank_velocity_board,
    rank_vote_board,
    reputation_shift,
    sole_voter_counts,
    window_start,
)
from app.leaderboards.compute import rank_active_span, rank_difficulty, series_spans
from app.leaderboards.facets import VNFacts
from app.leaderboards.registry import BOARDS
from app.leaderboards.spec import BoardSpec, Disclosure, Facet, Metric, Subject, Window


#: Throwaway boards for the arithmetic tests. The registry requires every real board to say
#: how it is counted; these exist only to exercise a ranker, so they carry a placeholder
#: rather than weakening that requirement for the boards people actually read.
_TEST_DISCLOSURE = Disclosure(
    population="test fixture",
    floor="test fixture",
    score="test fixture",
    excluded="test fixture",
)


def make_spec(**kwargs) -> BoardSpec:
    """A BoardSpec with the disclosure filled in."""
    kwargs.setdefault("disclosure", _TEST_DISCLOSURE)
    return BoardSpec(**kwargs)



REFERENCE = date(2026, 8, 16)


def _facts(vn_id, olang="ja", languages=("ja",), platforms=(), year=2010,
           length=2, minage=18, votecount=100, free=False, jp_free=False):
    return VNFacts(
        vn_id=vn_id,
        olang=olang,
        languages=frozenset(languages),
        platforms=frozenset(platforms),
        year=year,
        length=length,
        minage=minage,
        votecount=votecount,
        has_free_release=free,
        jp_freeware=jp_free,
    )


def _vn_world():
    return {
        "v1": _facts("v1", olang="ja", languages=("ja",)),
        "v2": _facts("v2", olang="ja", languages=("ja", "en")),
        "v3": _facts("v3", olang="en", languages=("en",)),
        "v4": _facts("v4", olang="ja", languages=("ja",), platforms=("p98",), year=1996),
    }


# --- facet membership -------------------------------------------------------------

def test_membership_resolves_each_facet_to_a_vn_set():
    members = facet_membership(_vn_world(), [Facet(olang="ja")])
    assert members[Facet(olang="ja").canonical()] == {"v1", "v2", "v4"}


def test_language_only_facet_excludes_translated_titles():
    members = facet_membership(_vn_world(), [Facet(lang_only="ja")])
    # v2 also has an English release, so it is not Japanese-only.
    assert members[Facet(lang_only="ja").canonical()] == {"v1", "v4"}


def test_platform_and_year_facets():
    facet = Facet(platform="p98")
    members = facet_membership(_vn_world(), [facet])
    assert members[facet.canonical()] == {"v4"}

    pre2000 = Facet(year_max=1999)
    members = facet_membership(_vn_world(), [pre2000])
    assert members[pre2000.canonical()] == {"v4"}


def test_empty_facet_matches_everything():
    members = facet_membership(_vn_world(), [Facet()])
    assert members[Facet().canonical()] == {"v1", "v2", "v3", "v4"}


def test_tag_facet_without_a_membership_set_matches_nothing():
    # Failing closed: a tag facet whose set was not loaded must not silently widen to
    # every VN, which would publish a board claiming to be filtered when it is not.
    facet = Facet(tag=42)
    members = facet_membership(_vn_world(), [facet])
    assert members[facet.canonical()] == set()


# --- windows ----------------------------------------------------------------------

def test_all_window_has_no_lower_bound():
    assert window_start(Window.ALL, REFERENCE) is None


def test_rolling_windows_measure_back_from_the_reference_date():
    assert window_start(Window.WEEK, REFERENCE) == date(2026, 8, 9)
    assert window_start(Window.MONTH, REFERENCE) == date(2026, 7, 17)


def test_votes_outside_the_window_are_ignored():
    spec = make_spec(
        slug="t", title="t", subject=Subject.USER, metric=Metric.VOTES, window=Window.WEEK
    )
    buckets = build_buckets([spec])
    rows = [
        ("1", "v1", 80, date(2026, 8, 15)),  # inside
        ("1", "v2", 80, date(2026, 1, 1)),   # outside
    ]
    accumulate_votes(rows, _vn_world(), buckets, REFERENCE)
    ranked = rank_vote_board(spec, buckets[spec.bucket_key])
    assert [(e.key, e.value) for e in ranked] == [("1", 1.0)]


# --- purity -----------------------------------------------------------------------

def test_purity_board_excludes_a_user_with_any_non_matching_vote():
    spec = make_spec(
        slug="t", title="t", subject=Subject.USER, metric=Metric.VOTES,
        facet=Facet(olang="ja"), require_pure=True,
    )
    buckets = build_buckets([spec])
    rows = [
        ("pure", "v1", 80, REFERENCE),
        ("pure", "v2", 70, REFERENCE),
        ("mixed", "v1", 80, REFERENCE),
        ("mixed", "v3", 90, REFERENCE),  # English original, disqualifying
    ]
    accumulate_votes(rows, _vn_world(), buckets, REFERENCE)
    ranked = rank_vote_board(spec, buckets[spec.bucket_key])
    assert [e.key for e in ranked] == ["pure"]


def test_without_purity_the_same_user_is_ranked_on_the_matching_subset():
    spec = make_spec(
        slug="t", title="t", subject=Subject.USER, metric=Metric.VOTES,
        facet=Facet(olang="ja"),
    )
    buckets = build_buckets([spec])
    rows = [
        ("mixed", "v1", 80, REFERENCE),
        ("mixed", "v3", 90, REFERENCE),
    ]
    accumulate_votes(rows, _vn_world(), buckets, REFERENCE)
    ranked = rank_vote_board(spec, buckets[spec.bucket_key])
    assert [(e.key, e.value) for e in ranked] == [("mixed", 1.0)]


# --- sole voter -------------------------------------------------------------------

def test_sole_voter_counts_only_titles_with_exactly_one_voter():
    spec = make_spec(
        slug="t", title="t", subject=Subject.USER, metric=Metric.SOLE_VOTER
    )
    buckets = build_buckets([spec])
    rows = [
        ("alone", "v1", 80, REFERENCE),   # only voter
        ("alone", "v4", 80, REFERENCE),   # only voter
        ("alone", "v2", 80, REFERENCE),   # shared
        ("other", "v2", 60, REFERENCE),   # shared
    ]
    accumulate_votes(rows, _vn_world(), buckets, REFERENCE)
    bucket = buckets[spec.bucket_key]
    assert sole_voter_counts(bucket) == {"alone": 2}


def test_a_third_voter_does_not_resurrect_a_sole_voter_entry():
    spec = make_spec(slug="t", title="t", subject=Subject.USER, metric=Metric.SOLE_VOTER)
    buckets = build_buckets([spec])
    rows = [
        ("a", "v1", 80, REFERENCE),
        ("b", "v1", 80, REFERENCE),
        ("c", "v1", 80, REFERENCE),
    ]
    accumulate_votes(rows, _vn_world(), buckets, REFERENCE)
    assert sole_voter_counts(buckets[spec.bucket_key]) == {}


# --- averages and spread ----------------------------------------------------------

def test_average_is_reported_on_the_ten_point_scale():
    spec = make_spec(
        slug="t", title="t", subject=Subject.USER, metric=Metric.AVG_SCORE, min_count=1
    )
    buckets = build_buckets([spec])
    rows = [("u", "v1", 80, REFERENCE), ("u", "v2", 60, REFERENCE)]
    accumulate_votes(rows, _vn_world(), buckets, REFERENCE)
    ranked = rank_vote_board(spec, buckets[spec.bucket_key])
    assert ranked[0].value == 7.0


def test_divisiveness_is_the_spread_not_the_average():
    spec = make_spec(
        slug="t", title="t", subject=Subject.VN, metric=Metric.DIVISIVENESS, min_count=2
    )
    buckets = build_buckets([spec])
    # v1 polarised (2 and 10), v2 unanimous (6 and 6). Same mean, opposite spread.
    rows = [
        ("a", "v1", 20, REFERENCE), ("b", "v1", 100, REFERENCE),
        ("a", "v2", 60, REFERENCE), ("b", "v2", 60, REFERENCE),
    ]
    accumulate_votes(rows, _vn_world(), buckets, REFERENCE)
    ranked = rank_vote_board(spec, buckets[spec.bucket_key])
    assert ranked[0].key == "v1"
    assert math.isclose(ranked[0].value, 4.0)
    assert ranked[1].value == 0.0


def test_single_vote_has_no_spread():
    bucket = Bucket(facet=Facet(), window=Window.ALL, require_pure=False)
    counters = bucket.vn("v1")
    counters.matched, counters.matched_total, counters.matched_sq = 1, 80, 6400
    assert counters.stddev == 0.0


# --- bayesian ---------------------------------------------------------------------

def test_bayesian_pulls_a_thin_sample_toward_the_global_mean():
    # One perfect vote should not outrank a well-supported good score.
    thin = bayesian_average(total=100, count=1, global_mean=7.0)
    thick = bayesian_average(total=90 * 200, count=200, global_mean=7.0)
    assert thin < thick


def test_bayesian_of_an_empty_sample_is_zero():
    assert bayesian_average(total=0, count=0, global_mean=7.0) == 0.0


def test_bayesian_converges_on_the_own_mean_as_the_sample_grows():
    huge = BAYESIAN_PRIOR_VOTES * 10_000
    value = bayesian_average(total=85 * huge, count=huge, global_mean=5.0)
    assert math.isclose(value, 8.5, rel_tol=1e-3)


# --- label boards -----------------------------------------------------------------

def test_drop_rate_divides_by_readers_who_started_not_by_wishlisters():
    spec = make_spec(
        slug="t", title="t", subject=Subject.VN, metric=Metric.DROP_RATE, min_count=1
    )
    counts = {
        # 10 started, 5 dropped. The 90 wishlisters must not dilute the rate.
        "v1": LabelCounts(playing=2, finished=3, stalled=0, dropped=5, wishlist=90),
    }
    ranked = rank_label_board(spec, counts)
    assert ranked[0].value == 0.5


def test_ratio_boards_respect_the_sample_floor():
    spec = make_spec(
        slug="t", title="t", subject=Subject.VN, metric=Metric.DROP_RATE, min_count=50
    )
    counts = {
        "thin": LabelCounts(dropped=1, finished=0, playing=0),        # 1 started
        "thick": LabelCounts(dropped=25, finished=25, playing=0),     # 50 started
    }
    ranked = rank_label_board(spec, counts)
    assert [e.key for e in ranked] == ["thick"]


def test_completion_and_drop_rates_are_complementary_when_nothing_stalls():
    counts = {"v1": LabelCounts(finished=7, dropped=3)}
    drop = rank_label_board(
        make_spec(slug="d", title="d", subject=Subject.VN, metric=Metric.DROP_RATE, min_count=1),
        counts,
    )
    done = rank_label_board(
        make_spec(slug="c", title="c", subject=Subject.VN, metric=Metric.COMPLETION_RATE, min_count=1),
        counts,
    )
    assert math.isclose(drop[0].value + done[0].value, 1.0)


# --- ordering ---------------------------------------------------------------------

def test_ascending_boards_rank_the_lowest_first():
    spec = make_spec(
        slug="t", title="t", subject=Subject.USER, metric=Metric.AVG_SCORE,
        min_count=1, ascending=True,
    )
    buckets = build_buckets([spec])
    rows = [("harsh", "v1", 30, REFERENCE), ("kind", "v1", 90, REFERENCE)]
    accumulate_votes(rows, _vn_world(), buckets, REFERENCE)
    ranked = rank_vote_board(spec, buckets[spec.bucket_key])
    assert [e.key for e in ranked] == ["harsh", "kind"]


def test_ties_break_deterministically():
    # An unstable order would make a board look like it churns nightly on unchanged data.
    spec = make_spec(slug="t", title="t", subject=Subject.USER, metric=Metric.VOTES)
    buckets = build_buckets([spec])
    rows = [("zed", "v1", 80, REFERENCE), ("amy", "v1", 80, REFERENCE)]
    accumulate_votes(rows, _vn_world(), buckets, REFERENCE)
    first = [e.key for e in rank_vote_board(spec, buckets[spec.bucket_key])]
    assert first == ["amy", "zed"]


# --- bucket sharing ---------------------------------------------------------------

def test_catalogue_collapses_into_far_fewer_buckets_than_boards():
    buckets = build_buckets(BOARDS)
    assert len(buckets) < len(BOARDS)


def test_boards_sharing_a_facet_and_window_share_a_bucket():
    a = make_spec(slug="a", title="a", subject=Subject.VN, metric=Metric.VOTERS)
    b = make_spec(slug="b", title="b", subject=Subject.VN, metric=Metric.BAYESIAN)
    assert a.bucket_key == b.bucket_key

    # Two boards contribute one bucket between them. Counted against a one-board catalogue
    # rather than against a literal, so the buckets built for the persisted columns do not
    # make this look like a sharing failure.
    alone = build_buckets([a])
    assert len(build_buckets([a, b])) == len(alone)


# --- vote activity ----------------------------------------------------------------

def test_activity_counts_by_year_month_and_weekday():
    activity = VoteActivity()
    activity.record(date(2026, 8, 17))  # a Monday
    activity.record(date(2026, 8, 16))  # a Sunday
    activity.record(date(2025, 1, 5))
    payload = activity.as_payload()

    assert payload["total"] == 3
    assert payload["by_year"] == [
        {"year": 2025, "count": 1},
        {"year": 2026, "count": 2},
    ]
    assert payload["by_month"][7]["count"] == 2  # August
    assert payload["by_weekday"][0]["count"] == 1  # Monday
    assert payload["by_weekday"][6]["count"] == 2  # Sunday, plus the 2025-01-05 Sunday


def test_activity_emits_every_month_and_weekday_even_when_empty():
    # A chart with gaps in its axis is harder to read than one with zeroes, and the shares
    # have to be comparable across a fixed set of slots.
    payload = VoteActivity().as_payload()
    assert [row["month"] for row in payload["by_month"]] == list(range(1, 13))
    assert [row["weekday"] for row in payload["by_weekday"]] == list(range(7))


def test_activity_shares_sum_to_one():
    activity = VoteActivity()
    for day in range(1, 40):
        activity.record(date(2026, 1, 1) + timedelta(days=day))
    payload = activity.as_payload()

    # Shares are rounded to keep the payload small, so they sum to one only within that
    # rounding: twelve months at five decimal places can drift by up to 6e-5.
    tolerance = 1e-4
    assert abs(sum(row["share"] for row in payload["by_month"]) - 1.0) < tolerance
    assert abs(sum(row["share"] for row in payload["by_weekday"]) - 1.0) < tolerance


def test_empty_activity_does_not_divide_by_zero():
    payload = VoteActivity().as_payload()
    assert all(row["share"] == 0 for row in payload["by_month"])


# --- velocity ---------------------------------------------------------------------

def _velocity_pair():
    """A perennial favourite and a fresh release with identical recent counts."""
    lifetime = Bucket(facet=Facet(), window=Window.ALL, require_pure=False)
    recent = Bucket(facet=Facet(), window=Window.MONTH, require_pure=False)

    lifetime.vn("classic").matched = 10_000
    lifetime.vn("newcomer").matched = 200
    recent.vn("classic").matched = 100
    recent.vn("newcomer").matched = 100
    return recent, lifetime


def test_velocity_measures_share_not_raw_recent_count():
    # Both gained 100 votes this month. Ranking on the raw count would just reproduce the
    # all-time chart; the share is what identifies something as moving.
    spec = make_spec(
        slug="v", title="v", subject=Subject.VN, metric=Metric.VELOCITY,
        window=Window.MONTH, min_count=50,
    )
    recent, lifetime = _velocity_pair()
    ranked = rank_velocity_board(spec, recent, lifetime)
    assert [e.key for e in ranked] == ["newcomer", "classic"]
    assert ranked[0].value == 0.5


def test_velocity_applies_the_floor_to_lifetime_votes():
    # A title with three votes, all this week, would otherwise sit at a perfect 1.0.
    spec = make_spec(
        slug="v", title="v", subject=Subject.VN, metric=Metric.VELOCITY,
        window=Window.MONTH, min_count=50,
    )
    lifetime = Bucket(facet=Facet(), window=Window.ALL, require_pure=False)
    recent = Bucket(facet=Facet(), window=Window.MONTH, require_pure=False)
    lifetime.vn("tiny").matched = 3
    recent.vn("tiny").matched = 3
    assert rank_velocity_board(spec, recent, lifetime) == []


def test_velocity_ignores_titles_absent_from_the_lifetime_bucket():
    spec = make_spec(
        slug="v", title="v", subject=Subject.VN, metric=Metric.VELOCITY,
        window=Window.MONTH, min_count=1,
    )
    lifetime = Bucket(facet=Facet(), window=Window.ALL, require_pure=False)
    recent = Bucket(facet=Facet(), window=Window.MONTH, require_pure=False)
    recent.vn("ghost").matched = 5
    assert rank_velocity_board(spec, recent, lifetime) == []


def test_velocity_boards_get_their_lifetime_bucket_built():
    # The window bucket alone is not enough, and the registry may contain no other board
    # asking for that facet over all time.
    spec = make_spec(
        slug="v", title="v", subject=Subject.VN, metric=Metric.VELOCITY,
        window=Window.MONTH, facet=Facet(olang="ja"),
    )
    buckets = build_buckets([spec])
    assert (Facet(olang="ja").canonical(), Window.ALL.value, False) in buckets


# --- reputation shift -------------------------------------------------------------

def _history(early_votes, late_votes):
    """A vote history where the early half was cast first, chronologically."""
    return [(i, v) for i, v in enumerate(early_votes)] + [
        (1000 + i, v) for i, v in enumerate(late_votes)
    ]


def test_reputation_shift_is_the_later_half_minus_the_earlier():
    history = _history([50] * 10, [80] * 10)
    shift, considered, early, late = reputation_shift(history)
    assert early == 5.0
    assert late == 8.0
    assert math.isclose(shift, 3.0)
    assert considered == 20


def test_a_cooling_title_shifts_negative():
    shift, _, _, _ = reputation_shift(_history([90] * 10, [60] * 10))
    assert shift < 0


def test_reputation_shift_needs_enough_votes_in_both_halves():
    # One late arrival cannot be evidence that opinion moved.
    assert reputation_shift(_history([50] * 10, [90])) is None
    assert reputation_shift([(1, 80)]) is None
    assert reputation_shift([]) is None


def test_reputation_shift_orders_by_date_not_arrival():
    # The walk visits rows in table order, not chronological order, so the split has to
    # sort first or the two halves are arbitrary.
    scrambled = [(500, 90), (1, 50), (400, 90), (2, 50)] * 5
    shift, _, early, late = reputation_shift(scrambled)
    assert early == 5.0
    assert late == 9.0
    assert shift > 0


def test_reputation_board_respects_its_floor():
    spec = make_spec(
        slug="r", title="r", subject=Subject.VN,
        metric=Metric.REPUTATION_SHIFT, min_count=50,
    )
    bucket = Bucket(facet=Facet(), window=Window.ALL, require_pure=False)
    bucket.history["thin"] = _history([50] * 10, [90] * 10)  # 20 votes, under the floor
    assert rank_reputation_board(spec, bucket) == []


def test_reputation_board_ranks_both_directions():
    rising = make_spec(
        slug="up", title="up", subject=Subject.VN,
        metric=Metric.REPUTATION_SHIFT, min_count=20,
    )
    falling = make_spec(
        slug="down", title="down", subject=Subject.VN,
        metric=Metric.REPUTATION_SHIFT, min_count=20, ascending=True,
    )
    bucket = Bucket(facet=Facet(), window=Window.ALL, require_pure=False)
    bucket.history["rose"] = _history([50] * 10, [90] * 10)
    bucket.history["fell"] = _history([90] * 10, [50] * 10)

    assert [e.key for e in rank_reputation_board(rising, bucket)] == ["rose", "fell"]
    assert [e.key for e in rank_reputation_board(falling, bucket)] == ["fell", "rose"]


def test_history_is_tracked_even_with_no_board_reading_it():
    # The reputation shift written to visual_novels is derived from the histories, so they
    # cannot be conditional on the catalogue containing a board that happens to want them.
    plain = make_spec(slug="p", title="p", subject=Subject.VN, metric=Metric.VOTERS)
    buckets = build_buckets([plain])
    base = buckets[(Facet().canonical(), Window.ALL.value, False)]
    assert base.track_history is True


def test_persisted_windows_get_their_unfiltered_buckets():
    # votes_30d and votes_365d are read from these. A catalogue with no rolling-window board
    # must still produce them, or the columns silently go to zero.
    plain = make_spec(slug="p", title="p", subject=Subject.VN, metric=Metric.VOTERS)
    buckets = build_buckets([plain])
    for window in (Window.MONTH, Window.YEAR):
        assert (Facet().canonical(), window.value, False) in buckets


def test_the_base_bucket_exists_even_when_no_board_asks_for_it():
    # History boards read the base bucket whatever facet they carry. Relying on some other
    # board happening to want that facet and window would make them fail the moment the
    # registry changed.
    faceted = make_spec(
        slug="h", title="h", subject=Subject.VN,
        metric=Metric.REPUTATION_SHIFT, facet=Facet(olang="ja"),
    )
    buckets = build_buckets([faceted])
    base_key = (Facet().canonical(), Window.ALL.value, False)
    assert base_key in buckets
    assert buckets[base_key].track_history is True


# --- rating as of a year ----------------------------------------------------------

def _as_of_spec(year, min_count=1, **kwargs):
    return make_spec(
        slug=f"as-of-{year}", title="t", subject=Subject.VN,
        metric=Metric.RATING_AS_OF, as_of_year=year, min_count=min_count, **kwargs,
    )


def _bucket_with_history(histories):
    bucket = Bucket(facet=Facet(), window=Window.ALL, require_pure=False)
    bucket.history.update(histories)
    return bucket


def test_votes_after_the_cutoff_are_discarded():
    early = date(2010, 6, 1).toordinal()
    late = date(2020, 6, 1).toordinal()
    bucket = _bucket_with_history({
        # Adored at the time, panned later.
        "faded": [(early, 100)] * 10 + [(late, 20)] * 10,
    })
    ranked = rank_rating_as_of(_as_of_spec(2010, min_count=5), bucket)
    assert ranked[0].secondary["votes_then"] == 10
    assert ranked[0].secondary["mean_then"] == 10.0


def test_the_same_title_scores_differently_at_two_cutoffs():
    early = date(2010, 6, 1).toordinal()
    late = date(2020, 6, 1).toordinal()
    bucket = _bucket_with_history({"shifted": [(early, 100)] * 10 + [(late, 20)] * 10})

    then = rank_rating_as_of(_as_of_spec(2010, min_count=5), bucket)[0]
    now = rank_rating_as_of(_as_of_spec(2020, min_count=5), bucket)[0]
    assert then.value > now.value


def test_titles_with_no_votes_before_the_cutoff_are_absent():
    # A title released later should not appear ranked low; it should not appear at all.
    bucket = _bucket_with_history({
        "old": [(date(2005, 1, 1).toordinal(), 80)] * 10,
        "future": [(date(2024, 1, 1).toordinal(), 90)] * 10,
    })
    ranked = rank_rating_as_of(_as_of_spec(2010, min_count=5), bucket)
    assert [e.key for e in ranked] == ["old"]


def test_the_prior_uses_only_votes_before_the_cutoff():
    # A prior computed from today's votes would leak hindsight into a historical board.
    early = date(2009, 1, 1).toordinal()
    late = date(2024, 1, 1).toordinal()
    bucket = _bucket_with_history({
        "subject": [(early, 80)] * 30,
        # A large, much later, very low-rated body of votes. If it reached the prior it
        # would drag the subject's historical score down.
        "noise": [(late, 10)] * 5000,
    })
    value = rank_rating_as_of(_as_of_spec(2009, min_count=10), bucket)[0].value
    assert value > 7.5, value


def test_as_of_board_respects_its_floor():
    bucket = _bucket_with_history({"thin": [(date(2009, 1, 1).toordinal(), 90)] * 3})
    assert rank_rating_as_of(_as_of_spec(2010, min_count=25), bucket) == []


def test_as_of_with_no_qualifying_votes_returns_nothing():
    bucket = _bucket_with_history({"x": [(date(2024, 1, 1).toordinal(), 90)] * 50})
    assert rank_rating_as_of(_as_of_spec(2010), bucket) == []


def test_an_as_of_board_must_declare_its_year():
    try:
        make_spec(
            slug="x", title="x", subject=Subject.VN, metric=Metric.RATING_AS_OF
        )
    except ValueError:
        return
    raise AssertionError("a rating-as-of board was allowed with no cutoff year")


# --- percentile sketches ----------------------------------------------------------

def test_sketch_has_one_boundary_per_percentile():
    assert len(percentile_sketch([float(i) for i in range(1000)])) == SKETCH_SIZE


def test_sketch_of_an_empty_population_is_empty():
    assert percentile_sketch([]) == []
    assert percentile_of([], 5) is None


def test_percentile_places_a_value_in_the_population():
    sketch = percentile_sketch([float(i) for i in range(1, 101)])
    assert percentile_of(sketch, 1) < 5
    assert percentile_of(sketch, 50) > 45
    assert percentile_of(sketch, 50) < 55
    assert percentile_of(sketch, 100) == 100


def test_percentile_is_monotonic():
    # A reader with more titles can never rank below one with fewer.
    sketch = percentile_sketch([float(i % 500) for i in range(5000)])
    previous = -1.0
    for value in range(0, 500, 25):
        current = percentile_of(sketch, float(value))
        assert current >= previous, f"percentile fell at {value}"
        previous = current


def test_percentile_of_a_value_below_the_population_is_zero():
    sketch = percentile_sketch([10.0, 20.0, 30.0])
    assert percentile_of(sketch, 1) == 0


def test_share_below_excludes_the_readers_holding_the_value():
    # Three quarters of this population sits on the floor. Someone standing there is level
    # with them rather than ahead of them, and the two figures are what separates the cases.
    population = [0.0] * 75 + [float(i) for i in range(1, 26)]
    sketch = percentile_sketch(population)
    assert percentile_of(sketch, 0) >= 70
    assert share_below(sketch, 0) == 0


def test_share_below_matches_the_percentile_where_nothing_ties():
    sketch = percentile_sketch([float(i) for i in range(1, 101)])
    for value in (10, 25, 50, 75):
        gap = percentile_of(sketch, float(value)) - share_below(sketch, float(value))
        # One boundary of a hundred-and-one is the most a distinct value can occupy.
        assert 0 <= gap <= 2, f"unexpected tie width at {value}: {gap}"


def test_share_below_never_exceeds_the_percentile():
    sketch = percentile_sketch([float(i % 7) for i in range(700)])
    for value in range(0, 8):
        assert share_below(sketch, float(value)) <= percentile_of(sketch, float(value))


def test_share_below_of_an_empty_sketch_is_none():
    assert share_below([], 5) is None


def test_sketch_survives_a_single_member_population():
    sketch = percentile_sketch([42.0])
    assert len(sketch) == SKETCH_SIZE
    assert percentile_of(sketch, 42) == 100


def test_votes_for_unknown_visual_novels_are_dropped():
    spec = make_spec(slug="t", title="t", subject=Subject.USER, metric=Metric.VOTES)
    buckets = build_buckets([spec])
    processed = accumulate_votes(
        [("u", "v999", 80, REFERENCE)], _vn_world(), buckets, REFERENCE
    )


    assert processed == 0
    assert rank_vote_board(spec, buckets[spec.bucket_key]) == []


# --- work floors, damping and the new rankers --------------------------------------

def _rolled(entity_vns, votes):
    """Accumulate votes, then pool them by entity the way a credit board does."""
    world = _vn_world()
    board = make_spec(slug="t", title="t", subject=Subject.STAFF, metric=Metric.BAYESIAN)
    buckets = build_buckets([board])
    accumulate_votes(votes, world, buckets, REFERENCE)
    return roll_up_by_entity(buckets[board.bucket_key], entity_vns)


def test_the_roll_up_counts_the_titles_behind_an_entity():
    rolled = _rolled(
        {"prolific": ["v1", "v2"], "one_hit": ["v1"]},
        [("a", "v1", 90, REFERENCE), ("b", "v2", 70, REFERENCE)],
    )
    assert rolled.users["prolific"].works == 2
    assert rolled.users["one_hit"].works == 1


def test_a_single_credit_cannot_clear_a_work_floor_on_votes_alone():
    # One credit on a title with a thousand votes satisfies any vote floor while saying
    # nothing about the person. This is the defect the work floor exists to close.
    votes = [(f"u{i}", "v1", 90, REFERENCE) for i in range(1000)]
    votes.append(("z", "v2", 60, REFERENCE))
    rolled = _rolled({"one_hit": ["v1"], "two_titles": ["v1", "v2"]}, votes)

    unfloored = make_spec(
        slug="t", title="t", subject=Subject.STAFF, metric=Metric.BAYESIAN, min_count=50
    )
    assert "one_hit" in {e.key for e in rank_vote_board(unfloored, rolled)}

    floored = make_spec(
        slug="t", title="t", subject=Subject.STAFF, metric=Metric.BAYESIAN,
        min_count=50, min_works=2,
    )
    keys = {e.key for e in rank_vote_board(floored, rolled)}
    assert "one_hit" not in keys
    assert "two_titles" in keys


def test_the_work_count_is_shown_on_the_row():
    rolled = _rolled({"e": ["v1", "v2"]}, [("a", "v1", 90, REFERENCE), ("b", "v2", 70, REFERENCE)])
    board = make_spec(
        slug="t", title="t", subject=Subject.STAFF, metric=Metric.BAYESIAN, min_works=2
    )
    [entry] = rank_vote_board(board, rolled)
    assert entry.secondary["works"] == 2


def test_a_thin_rate_is_pulled_toward_the_population():
    # 97% of 89 readers must not tie 97% of 4,000. Damping is what separates them.
    counts = {
        "thin": LabelCounts(finished=58, dropped=2),
        "thick": LabelCounts(finished=5800, dropped=200),
    }
    board = make_spec(
        slug="t", title="t", subject=Subject.VN, metric=Metric.COMPLETION_RATE, min_count=50
    )
    ranked = rank_label_board(board, counts)
    assert [e.key for e in ranked] == ["thick", "thin"]


def test_damping_leaves_a_large_sample_where_it_was():
    rate = damped_rate(9000, 10000, 0.5)
    assert abs(rate - 0.9) < 0.005


def test_a_reader_who_finished_nothing_is_left_off_the_drop_board():
    counts = {
        "bulk": LabelCounts(dropped=5000, finished=0),
        "reader": LabelCounts(dropped=60, finished=40),
    }
    board = make_spec(
        slug="t", title="t", subject=Subject.USER, metric=Metric.DROP_RATE,
        min_count=50, min_finished=20,
    )
    assert [e.key for e in rank_label_board(board, counts)] == ["reader"]


def test_vote_bias_ranks_by_distance_from_the_community():
    scans = {
        "harsh": ReaderScan(votes=200, bias=-2.5, divergence=2.5),
        "typical": ReaderScan(votes=200, bias=0.1, divergence=1.2),
        "thin": ReaderScan(votes=5, bias=-9.0, divergence=9.0),
    }
    board = make_spec(
        slug="t", title="t", subject=Subject.USER, metric=Metric.VOTE_BIAS,
        min_count=100, ascending=True,
    )
    ranked = rank_reader_scan(board, scans)
    # The thin reader has the largest gap and is excluded by the floor, not ranked first.
    assert [e.key for e in ranked] == ["harsh", "typical"]


def test_catalogue_floor_ranks_on_the_weakest_entry_not_the_average():
    world = _vn_world()
    board = make_spec(slug="t", title="t", subject=Subject.VN, metric=Metric.VOTERS)
    buckets = build_buckets([board])
    rows = []
    # Chosen so the two orderings genuinely disagree: "uneven" has the better average
    # (a standout plus a weak entry) while "steady" has the better worst title.
    for i in range(60):
        rows.append((f"a{i}", "v1", 100, REFERENCE))
        rows.append((f"b{i}", "v2", 62, REFERENCE))
        rows.append((f"c{i}", "v3", 74, REFERENCE))
        rows.append((f"d{i}", "v4", 74, REFERENCE))
    accumulate_votes(rows, world, buckets, REFERENCE)
    bucket = buckets[board.bucket_key]

    floor_board = make_spec(
        slug="f", title="f", subject=Subject.DEVELOPER, metric=Metric.CATALOGUE_FLOOR,
        min_works=2,
    )
    ranked = rank_catalogue_floor(
        floor_board,
        bucket,
        {"uneven": ["v1", "v2"], "steady": ["v3", "v4"]},
        prior=global_mean_vote(bucket),
        min_votes_per_title=50,
    )
    assert [e.key for e in ranked] == ["steady", "uneven"]
    # The average would have ranked them the other way round, which is the whole point.
    by_key = {e.key: e for e in ranked}
    assert by_key["uneven"].secondary["average"] > by_key["steady"].secondary["average"]


def test_catalogue_floor_skips_titles_nobody_voted_on():
    world = _vn_world()
    board = make_spec(slug="t", title="t", subject=Subject.VN, metric=Metric.VOTERS)
    buckets = build_buckets([board])
    rows = [(f"a{i}", "v1", 80, REFERENCE) for i in range(60)]
    rows += [(f"b{i}", "v2", 80, REFERENCE) for i in range(60)]
    accumulate_votes(rows, world, buckets, REFERENCE)

    floor_board = make_spec(
        slug="f", title="f", subject=Subject.DEVELOPER, metric=Metric.CATALOGUE_FLOOR,
        min_works=2,
    )
    ranked = rank_catalogue_floor(
        floor_board,
        buckets[board.bucket_key],
        # v3 has no votes: it is unproven, not proof of a weak entry.
        {"studio": ["v1", "v2", "v3"]},
        prior=0.0,
        min_votes_per_title=50,
    )
    assert ranked[0].secondary["works"] == 2


# --- the twelve added boards --------------------------------------------------------

def test_contrarian_is_a_spread_not_a_distance():
    # The distinction the two reader boards rest on: a uniformly harsh reader is
    # predictable and must not top the contrarian board.
    scans = {
        "harsh": ReaderScan(votes=200, bias=-4.0, divergence=0.5),
        "swings": ReaderScan(votes=200, bias=0.0, divergence=3.5),
    }
    contrarian = make_spec(
        slug="c", title="c", subject=Subject.USER, metric=Metric.VOTE_DIVERGENCE,
        min_count=100,
    )
    harshest = make_spec(
        slug="h", title="h", subject=Subject.USER, metric=Metric.VOTE_BIAS,
        min_count=100, ascending=True,
    )
    assert [e.key for e in rank_reader_scan(contrarian, scans)] == ["swings", "harsh"]
    assert [e.key for e in rank_reader_scan(harshest, scans)] == ["harsh", "swings"]


def test_a_tag_is_scored_unweighted_by_how_much_each_title_was_voted_on():
    # Pooling votes would let one hugely-voted title speak for a tag applied to many.
    world = _vn_world()
    board = make_spec(slug="t", title="t", subject=Subject.VN, metric=Metric.VOTERS)
    buckets = build_buckets([board])
    rows = []
    # v1 is adored and enormous; v2 and v3 are mediocre and small.
    rows += [(f"a{i}", "v1", 100, REFERENCE) for i in range(2000)]
    rows += [(f"b{i}", "v2", 40, REFERENCE) for i in range(60)]
    rows += [(f"c{i}", "v3", 40, REFERENCE) for i in range(60)]
    accumulate_votes(rows, world, buckets, REFERENCE)
    bucket = buckets[board.bucket_key]

    tag_board = make_spec(
        slug="tag", title="tag", subject=Subject.TAG, metric=Metric.TITLE_MEAN, min_works=3
    )
    [entry] = rank_title_aggregate(
        tag_board, bucket, {"g1": ["v1", "v2", "v3"]},
        prior=global_mean_vote(bucket), min_votes_per_title=50,
    )
    # The unweighted mean sits between the two groups; a vote-weighted one would be near 10.
    assert 5.0 < entry.value < 8.0
    assert entry.secondary["works"] == 3


def test_discovery_lag_compares_a_title_with_its_own_release_year():
    # Without the cohort comparison this board would only ever rank the oldest titles.
    facts = {
        "old_typical": _facts("old_typical", year=1990),
        "old_late": _facts("old_late", year=1990),
        "new_typical": _facts("new_typical", year=2015),
    }
    for key, released in (
        ("old_typical", date(1990, 1, 1)),
        ("old_late", date(1990, 1, 1)),
        ("new_typical", date(2015, 1, 1)),
    ):
        facts[key] = facts[key].__class__(**{**facts[key].__dict__,
                                             "released_ordinal": released.toordinal()})

    bucket = Bucket(facet=Facet(), window=Window.ALL, require_pure=False)
    # Both 1990 titles are voted on decades later; one is later still than its peers.
    bucket.history["old_typical"] = [(date(2020, 1, 1).toordinal(), 70)] * 12
    bucket.history["old_late"] = [(date(2024, 1, 1).toordinal(), 70)] * 12
    bucket.history["new_typical"] = [(date(2016, 1, 1).toordinal(), 70)] * 12

    board = make_spec(
        slug="d", title="d", subject=Subject.VN, metric=Metric.DISCOVERY_LAG, min_count=10
    )
    ranked = rank_discovery_lag(board, bucket, facts, min_cohort=2)
    keys = [e.key for e in ranked]
    # The lone 2015 title has no cohort to compare against and is left out entirely.
    assert keys == ["old_late", "old_typical"]
    assert ranked[0].value > 0 > ranked[1].value


def test_difficulty_ranks_only_measured_titles():
    world = {
        "v1": _facts("v1"),
        "v2": _facts("v2"),
    }
    world["v1"] = world["v1"].__class__(**{**world["v1"].__dict__, "difficulty": 4.5})
    board = make_spec(slug="t", title="t", subject=Subject.VN, metric=Metric.VOTERS)
    buckets = build_buckets([board])
    accumulate_votes(
        [(f"u{i}", vn, 70, REFERENCE) for vn in ("v1", "v2") for i in range(40)],
        world, buckets, REFERENCE,
    )
    diff = make_spec(
        slug="d", title="d", subject=Subject.VN, metric=Metric.DIFFICULTY, min_count=10
    )
    ranked = rank_difficulty(diff, buckets[board.bucket_key], world)
    # An unmeasured title is absent, not scored as easy.
    assert [e.key for e in ranked] == ["v1"]


def test_a_studio_that_stopped_is_not_still_shipping():
    from datetime import date as _date
    board = make_spec(
        slug="s", title="s", subject=Subject.DEVELOPER, metric=Metric.ACTIVE_SPAN, min_works=2
    )
    activity = {
        "running": (_date(1995, 1, 1), _date(2026, 1, 1), 20),
        "defunct": (_date(1985, 1, 1), _date(2001, 1, 1), 30),
    }
    ranked = rank_active_span(board, activity, dump_year=2026)
    assert [e.key for e in ranked] == ["running"]


# ---------------------------------------------------------------- title averages


def test_title_average_skips_unmeasured_titles_rather_than_scoring_them_zero():
    # The failure this guards is silent: counting an unmeasured title as zero would drag
    # every broad tag toward the bottom and leave the narrow ones looking hardest.
    spec = make_spec(
        slug="t", title="T", subject=Subject.TAG, metric=Metric.TITLE_DIFFICULTY,
        min_works=2,
    )
    measured = {"v1": 3.0, "v2": 4.0}
    entries = rank_title_average(
        spec, {"tag": ["v1", "v2", "v3"]}, lambda vn_id: measured.get(vn_id)
    )
    assert entries[0].value == 3.5
    # The count reports what was actually averaged, not how many titles carry the tag.
    assert entries[0].count == 2


def test_title_average_requires_the_work_floor_after_dropping_unmeasured():
    spec = make_spec(
        slug="t", title="T", subject=Subject.TAG, metric=Metric.TITLE_DIFFICULTY,
        min_works=3,
    )
    measured = {"v1": 3.0, "v2": 4.0}
    entries = rank_title_average(
        spec, {"tag": ["v1", "v2", "v3"]}, lambda vn_id: measured.get(vn_id)
    )
    assert entries == []


def test_title_average_reports_the_gap_from_the_baseline():
    spec = make_spec(
        slug="t", title="T", subject=Subject.TAG, metric=Metric.TITLE_DIFFICULTY,
        min_works=2,
    )
    entries = rank_title_average(
        spec, {"tag": ["v1", "v2"]}, lambda vn_id: 3.0, baseline=2.4
    )
    assert entries[0].secondary["gap"] == 0.6


# ---------------------------------------------------------------- stopping points


def test_terminal_damping_favours_the_better_sampled_title():
    # Both titles sit at three times expected. The one resting on four readers must not
    # outrank the one resting on eighty.
    spec = make_spec(
        slug="t", title="T", subject=Subject.VN, metric=Metric.TERMINAL_RATE,
    )
    entries = rank_terminal(spec, {
        "thin": (300, 12, 4.0),
        "solid": (3000, 240, 80.0),
    })
    assert [entry.key for entry in entries] == ["solid", "thin"]
    assert entries[0].value > entries[1].value


def test_terminal_skips_titles_with_no_expectation():
    spec = make_spec(
        slug="t", title="T", subject=Subject.VN, metric=Metric.TERMINAL_RATE,
    )
    assert rank_terminal(spec, {"v1": (300, 5, 0.0)}) == []


# ---------------------------------------------------------------- franchise spans


def test_series_span_ignores_unvoted_entries_at_the_ends():
    # An unvoted catalogue fragment released decades early would otherwise set the first
    # date and hand the franchise a span nobody read.
    facts = {
        "v1": _facts("v1", year=1995, votecount=2),
        "v2": _facts("v2", year=2005, votecount=500),
        "v3": _facts("v3", year=2015, votecount=400),
    }
    for vn_id, year in (("v1", 1995), ("v2", 2005), ("v3", 2015)):
        facts[vn_id] = replace(facts[vn_id], released_ordinal=date(year, 1, 1).toordinal())

    spans = series_spans({"s": ["v1", "v2", "v3"]}, facts)
    counted, first, latest, span, _votes = spans["s"]
    assert counted == 2
    assert (first, latest) == (2005, 2015)
    assert round(span) == 10


def test_series_span_needs_two_counted_entries():
    facts = {
        "v1": replace(_facts("v1", votecount=500), released_ordinal=730000),
        "v2": _facts("v2", votecount=1),
    }
    assert series_spans({"s": ["v1", "v2"]}, facts) == {}


def test_series_span_ranks_the_longer_run_first():
    spec = make_spec(
        slug="t", title="T", subject=Subject.SERIES, metric=Metric.SERIES_SPAN,
        strict_series=True, min_works=2,
    )
    entries = rank_series_span(spec, {
        "short": (6, 2010, 2015, 5.0, 900),
        "long": (3, 1990, 2018, 28.0, 400),
    })
    assert [entry.key for entry in entries] == ["long", "short"]


# ---------------------------------------------------------------- reader character


def test_response_and_steadiness_read_their_own_fields():
    scans = {
        "u1": ReaderScan(votes=200, response=2.4, response_fit=0.5),
        "u2": ReaderScan(votes=200, response=1.1, response_fit=0.9),
    }
    spec = make_spec(
        slug="t", title="T", subject=Subject.USER, metric=Metric.VOTE_RESPONSE,
        min_count=100,
    )
    entries = rank_reader_scan(spec, scans)
    assert [entry.key for entry in entries] == ["u1", "u2"]
    assert entries[0].secondary["fit"] == 0.5


def test_era_window_ranks_the_narrowest_first_and_carries_its_band():
    scans = {
        "wide": ReaderScan(votes=300, era_window=12.0, era_from=2000, era_to=2012),
        "narrow": ReaderScan(votes=300, era_window=4.0, era_from=2008, era_to=2012),
    }
    spec = make_spec(
        slug="t", title="T", subject=Subject.USER, metric=Metric.ERA_WINDOW,
        min_count=150, ascending=True,
    )
    entries = rank_reader_scan(spec, scans)
    assert [entry.key for entry in entries] == ["narrow", "wide"]
    assert entries[0].secondary["from"] == 2008
