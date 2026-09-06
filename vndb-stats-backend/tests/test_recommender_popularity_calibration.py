"""Popularity calibration has to be inert at its default and to serve a reader at their
own level when it is not.

The defect it addresses is not visible in any one list: an engine can rank every reader's
list well and still draw all of them from the same stretch of the popularity range. The
checks below therefore compare what two readers who read at different levels receive, and
pin the default against the arithmetic it leaves alone.
"""

import asyncio
import math

import pytest

from app.services import hybrid_recommender as engine
from app.services.hybrid_recommender import (
    HybridRecommender,
    PopularityCalibration,
    RecommendationResult,
    popularity_band,
    popularity_target,
    reader_rating_weights,
    switch_settings,
)


def test_calibration_ships_off_so_the_score_decides_the_order():
    """Fit decides the page by default; matching the reader's range is opt-in.

    Enabling this by default reordered a quarter of the first page away from match order and
    pushed the single strongest match off the page for a third of readers sampled, because a
    distribution target can seat a weak match above a strong one. Coverage of the less charted
    part of the catalogue is candidate generation's job, where exploration earns it on merit.
    """
    assert switch_settings()["REC_POPULARITY_CALIBRATION"] == 0.0
    assert engine.POPULARITY_CALIBRATION == 0


def test_default_page_keeps_the_pool_in_score_order():
    """The shipped default must not seat a lower-scored title above a higher-scored one."""
    recommender = HybridRecommender(db=None)
    selected = asyncio.run(
        recommender._apply_diversity_reranking(
            recommendations=list(POOL),
            all_tags=TAGS,
            limit=5,
            diversity_weight=0.3,
            # What the serving path passes when the switch sits at its default.
            calibration=None,
        )
    )
    scores = [result.score for result in selected]
    assert scores == sorted(scores, reverse=True), (
        f"default page is out of match order: {[(r.vn_id, r.score) for r in selected]}"
    )


def test_bands_cut_the_range_where_reading_happens():
    """A title's band follows its vote count, low to high, on the log scale."""
    bands = [popularity_band(count) for count in (0, 5, 40, 300, 1200, 9000)]
    assert bands == sorted(bands)
    assert bands[0] == 0
    assert bands[-1] == len(engine.POPULARITY_BAND_EDGES)
    # An unvoted title is unread rather than unplaceable.
    assert popularity_band(None) == popularity_band(0)
    # The edges are where the band changes, on log10(votecount + 1).
    for edge in engine.POPULARITY_BAND_EDGES:
        just_below = int(10 ** edge) - 2
        just_above = int(10 ** edge) + 1
        assert popularity_band(just_below) < popularity_band(just_above)


def test_reader_weights_follow_rank_not_the_rating_scale():
    """Two readers who order their titles alike weight them alike, however they rate."""
    generous = reader_rating_weights({"a": 9.0, "b": 8.0, "c": 7.0})
    coarse = reader_rating_weights({"a": 5.0, "b": 3.0, "c": 1.0})
    assert generous == coarse
    assert generous["a"] > generous["b"] > generous["c"]
    # The lowest-ranked title still counts: the reader chose to read it.
    assert generous["c"] >= engine.POPULARITY_PROFILE_FLOOR
    assert generous["a"] == pytest.approx(1.0)
    # Tied ratings share the ranks they span rather than splitting on list order.
    tied = reader_rating_weights({"a": 7.0, "b": 7.0})
    assert tied["a"] == tied["b"]


def test_target_is_the_readers_own_spread_over_the_bands():
    target = popularity_target(
        {"a": 9.0, "b": 9.0, "c": 9.0, "d": 9.0},
        {"a": 3, "b": 5, "c": 4, "d": 20000},
    )
    assert sum(target.values()) == pytest.approx(1.0)
    obscure_band = popularity_band(4)
    # Three obscure titles against one famous one, equally rated.
    assert target[obscure_band] == pytest.approx(0.75)
    # A title the catalogue cannot place is left out rather than counted as unread.
    assert popularity_target({"a": 9.0}, {}) == {}
    assert popularity_target({}, {"a": 10}) == {}


def _calibration(target: dict[int, float], strength: float = 1.0) -> PopularityCalibration:
    return PopularityCalibration(target=target, bands={}, strength=strength)


def test_divergence_stays_finite_when_a_band_is_empty():
    """An unreached band costs a bounded amount rather than ruling every list out.

    At the first pick every band but one is empty, so an infinity here would make the
    whole selection undefined instead of merely expensive.
    """
    calibration = _calibration({0: 0.5, 4: 0.5})
    divergences = calibration.divergence_by_band({}, 0.0, 1.0, {0, 4})
    assert all(math.isfinite(value) for value in divergences.values())
    # A band the reader never reads is finite too, and worse than one they do.
    unread = calibration.divergence_by_band({}, 0.0, 1.0, {0, 2})
    assert math.isfinite(unread[2])
    assert unread[2] > unread[0]


def test_divergence_prefers_the_band_the_target_is_missing():
    """Filling the emptier side of the target beats piling onto the fuller one."""
    calibration = _calibration({0: 0.5, 3: 0.5})
    # Half a list already in band 0.
    divergences = calibration.divergence_by_band({0: 1.0}, 1.0, 1.0, {0, 3})
    assert divergences[3] < divergences[0]


def _result(vn_id: str, score: float) -> RecommendationResult:
    return RecommendationResult(vn_id=vn_id, title=vn_id, score=score, match_reasons=[])


# A pool whose ranking runs against popularity: the best-scored titles are the best
# known, and the obscure ones are further down.
POOL = [
    _result("famous1", 9.0),
    _result("famous2", 8.5),
    _result("famous3", 8.0),
    _result("middling1", 7.5),
    _result("middling2", 7.0),
    _result("obscure1", 6.5),
    _result("obscure2", 6.0),
    _result("obscure3", 5.5),
]
VOTECOUNTS = {
    "famous1": 9000,
    "famous2": 8000,
    "famous3": 7000,
    "middling1": 400,
    "middling2": 350,
    "obscure1": 6,
    "obscure2": 5,
    "obscure3": 4,
}
# Tags that separate nothing, so the diversity term cannot decide these selections.
TAGS = {vn_id: {1: 3.0} for vn_id in VOTECOUNTS}


def _served(
    target_votecounts: list[int],
    strength: float,
    limit: int = 3,
    pool: list[RecommendationResult] | None = None,
) -> list[str]:
    """The page a reader whose own reading sits at those vote counts receives.

    ``pool`` presents the same candidates in another order. The pass has to answer the
    same way whichever order they arrive in, or what looks like a decision is the order
    the pool happened to be built in.
    """
    scores = {f"read{index}": 8.0 for index in range(len(target_votecounts))}
    votecounts = {
        f"read{index}": count for index, count in enumerate(target_votecounts)
    }
    calibration = PopularityCalibration(
        target=popularity_target(scores, votecounts),
        bands={vn_id: popularity_band(count) for vn_id, count in VOTECOUNTS.items()},
        strength=strength,
    )
    recommender = HybridRecommender(db=None)
    selected = asyncio.run(
        recommender._apply_diversity_reranking(
            recommendations=list(POOL) if pool is None else list(pool),
            all_tags=TAGS,
            limit=limit,
            diversity_weight=0.3,
            calibration=calibration if strength > 0 else None,
        )
    )
    return [result.vn_id for result in selected]


# The pool as a caller that did not sort it descending would present it. Every check that
# claims the pass decided something runs against this as well as against POOL.
SHUFFLED_POOL = [
    POOL[5], POOL[0], POOL[7], POOL[3], POOL[1], POOL[6], POOL[2], POOL[4],
]


def _median_log(vn_ids: list[str]) -> float:
    values = sorted(math.log10(VOTECOUNTS[vn_id] + 1) for vn_id in vn_ids)
    middle = len(values) // 2
    if len(values) % 2:
        return values[middle]
    return (values[middle - 1] + values[middle]) / 2


def test_reader_of_obscure_titles_is_served_more_obscurely_when_calibrated():
    """The headline behaviour: the same pool, pitched at the reader who asked for it."""
    obscure_reader = [3, 4, 5, 6]
    uncalibrated = _served(obscure_reader, strength=0.0)
    calibrated = _served(obscure_reader, strength=1.0)
    assert _median_log(calibrated) < _median_log(uncalibrated)
    # Uncalibrated, the reader of obscure titles gets the best known ones on offer.
    assert uncalibrated == ["famous1", "famous2", "famous3"]


def test_two_readers_of_different_levels_get_different_pages():
    """Calibration is per reader: the same pool serves each of them where they read."""
    obscure = _served([3, 4, 5, 6], strength=1.0)
    popular = _served([7000, 8000, 9000, 9500], strength=1.0)
    assert _median_log(obscure) < _median_log(popular)
    # Uncalibrated the two readers receive the same page, which is the complaint.
    assert _served([3, 4, 5, 6], strength=0.0) == _served([7000, 8000, 9000], strength=0.0)


def test_calibration_settles_ties_inside_a_band_on_relevance():
    """Where the target is indifferent, the better-scored candidate still wins.

    At full strength the divergence is the whole objective, so every candidate sharing the
    chosen band scores alike and only the tie-break separates them. Asserted against a
    pool that does not arrive in score order, since a pool that does would produce this
    answer whether the tie-break exists or not.
    """
    assert _served([5, 5, 5], strength=1.0, limit=2) == ["obscure1", "obscure2"]
    assert _served(
        [5, 5, 5], strength=1.0, limit=2, pool=SHUFFLED_POOL
    ) == ["obscure1", "obscure2"]


def test_a_calibrated_page_does_not_depend_on_the_order_the_pool_arrived_in():
    """Two orderings of one pool give one page, at every strength."""
    for strength in (0.0, 0.25, 0.5, 1.0):
        assert _served([3, 4, 5, 6], strength=strength) == _served(
            [3, 4, 5, 6], strength=strength, pool=SHUFFLED_POOL
        ), f"page moved with the pool order at strength {strength}"


def test_the_default_leaves_the_pass_exactly_as_it_was(monkeypatch):
    """No calibration means the selection the diversity pass has always made."""
    recommender = HybridRecommender(db=None)
    with_none = asyncio.run(
        recommender._apply_diversity_reranking(
            recommendations=list(POOL), all_tags=TAGS, limit=3, diversity_weight=0.3
        )
    )
    monkeypatch.setattr(engine, "POPULARITY_CALIBRATION", 0.0)
    built = asyncio.run(recommender._popularity_calibration({"read1": 8.0}, [{"id": "famous1"}]))
    assert built is None
    assert [result.vn_id for result in with_none] == ["famous1", "famous2", "famous3"]


def test_a_reader_the_catalogue_cannot_place_keeps_the_scored_page():
    """An empty target leaves the page alone rather than matching it to nothing."""

    class _EmptySession:
        async def execute(self, *args, **kwargs):
            raise AssertionError("no query is issued while the switch is off")

    recommender = HybridRecommender(db=_EmptySession())
    assert asyncio.run(recommender._popularity_calibration({}, [{"id": "v1"}])) is None
    assert asyncio.run(recommender._popularity_calibration({"v2": 8.0}, [])) is None
