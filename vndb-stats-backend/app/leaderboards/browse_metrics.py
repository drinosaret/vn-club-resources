"""Ranking metrics offered as sort orders on browse.

The curated boards answer a fixed set of questions well. These make the same questions
answerable against any filter a reader can express: most divisive fantasy, which mysteries
aged worst, the highest drop rate among titles by one developer.

Every entry mirrors one other surface asking the same question, and carries that surface's
sample floor. Which surface depends on the question: the two window metrics mirror a standing
board, and the rest mirror a question on the slice route, which is where those questions are
asked of the whole database as well as of any slice. The
pairing is asserted in the tests, which is what keeps it true as either side changes.

The two rate sorts, drop rate and completion rate, damp the ratio toward the population rate
so a thin sample cannot outrank a large one. That population rate is not recomputed here: the
nightly job records the rate it used, and these expressions read it back, so both surfaces
damp toward the same number rather than toward two independently derived ones. Before that
job has ever run there is nothing to read, and the ratio is then taken undamped.

Reading difficulty is the exception, and has no board: it comes from a third party rather
than from the vote dump, and covers only a small fraction of titles.

The floors are not optional. A ratio over three votes is noise that would otherwise occupy
the whole first page of every one of these sorts, so the floor is part of the sort rather
than a filter the reader is trusted to remember.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from sqlalchemy import Float, and_, cast, func, select
from sqlalchemy.dialects.postgresql import JSONB

from app.db.models import SystemMetadata, VisualNovel, VNDifficulty
from app.leaderboards.aggregate import RATE_PRIOR_KEY, RATE_PRIOR_READERS

#: Reading attempts, which is what a completion or drop rate is a proportion of. Wishlist
#: entries are excluded: wanting to read something says nothing about finishing it.
_STARTED = (
    func.coalesce(VisualNovel.list_playing, 0)
    + func.coalesce(VisualNovel.list_finished, 0)
    + func.coalesce(VisualNovel.list_stalled, 0)
    + func.coalesce(VisualNovel.list_dropped, 0)
)


def _share(numerator, denominator):
    """A ratio that yields NULL rather than an error when the denominator is zero."""
    return cast(numerator, Float) / func.nullif(denominator, 0)


def _prior_rate(field: str):
    """The population rate the nightly job damped toward, read back from what it wrote.

    An uncorrelated subquery, so the planner evaluates it once per statement rather than per
    row. Yields NULL when the job has not run, which is what makes the undamped fallback
    reachable.
    """
    return (
        select(cast(cast(SystemMetadata.value, JSONB)[field].astext, Float))
        .where(SystemMetadata.key == RATE_PRIOR_KEY)
        .scalar_subquery()
    )


def _damped_share(numerator, denominator, field: str):
    """A share pulled toward the population rate in proportion to how thin the sample is.

    The arithmetic of `aggregate.damped_rate`, expressed in SQL so that ordering a filtered
    query reproduces the order of the board covering the same titles.
    """
    prior = _prior_rate(field)
    damped = (cast(numerator, Float) + RATE_PRIOR_READERS * prior) / (
        denominator + RATE_PRIOR_READERS
    )
    return func.coalesce(damped, _share(numerator, denominator))


@dataclass(frozen=True)
class MetricSort:
    """One ranking metric, as offered to browse."""

    key: str
    label: str
    #: The standing board this mirrors, or None where the same question is answered by the
    #: slice route instead. Where it is set, the floor and definition here are that board's.
    board_slug: str | None
    #: Minimum sample before the metric is reported at all.
    min_sample: int
    #: What that sample counts, for the sentence shown beside the result count.
    sample_noun: str
    #: Which way round the metric reads, so the interface can say so.
    high_means: str
    low_means: str
    _expression: Callable
    _sample: Callable
    #: The slice-route question this mirrors, for the metrics whose board was retired once
    #: the same question became askable of any slice. Exactly one of the two is set, except
    #: for reading difficulty, which has neither.
    question_key: str | None = None
    #: Extra condition beyond the sample floor, where the metric can be undefined above it.
    _defined: Callable | None = None
    #: A table the query must join to reach this metric. Restricts the results to rows that
    #: have a value, which for a partially covered source is the only honest ordering.
    join_model: object | None = None
    _join_condition: Callable | None = None

    @property
    def join_condition(self):
        return self._join_condition() if self._join_condition else None

    @property
    def expression(self):
        return self._expression()

    @property
    def sample(self):
        """What the floor counts, and how ties are broken."""
        return self._sample()

    @property
    def floor(self):
        """Everything a row must satisfy to be ranked on this metric at all."""
        condition = self.sample >= self.min_sample
        if self._defined is not None:
            condition = and_(condition, self._defined())
        return condition

    def order_by(self, descending: bool):
        """Clauses reproducing the board's order, ties included.

        The boards break a tie toward the better-evidenced title before falling back to the
        id. Ranking metrics tie often, so leaving that out would put the two surfaces in a
        different order for the same query without either being wrong about the value.
        """
        primary = self.expression
        return [
            primary.desc().nullslast() if descending else primary.asc().nullslast(),
            self.sample.desc().nullslast(),
            VisualNovel.id.asc(),
        ]


METRIC_SORTS: dict[str, MetricSort] = {
    metric.key: metric
    for metric in (
        MetricSort(
            key="divisiveness",
            label="Divisiveness",
            board_slug=None,
            question_key="divisive",
            min_sample=20,
            sample_noun="votes",
            high_means="split opinion",
            low_means="broad agreement",
            _expression=lambda: VisualNovel.vote_stddev,
            _sample=lambda: VisualNovel.public_votes,
        ),
        MetricSort(
            key="reputation",
            label="Reputation shift",
            board_slug=None,
            question_key="aged-up",
            min_sample=50,
            sample_noun="votes",
            high_means="rated higher over time",
            low_means="rated lower over time",
            _expression=lambda: VisualNovel.reputation_shift,
            _sample=lambda: VisualNovel.public_votes,
            _defined=lambda: VisualNovel.reputation_shift.isnot(None),
        ),
        MetricSort(
            key="rising_month",
            label="Rising this month",
            board_slug="vns-rising-month",
            min_sample=50,
            sample_noun="votes",
            high_means="most of its attention is recent",
            low_means="little recent attention",
            _expression=lambda: _share(VisualNovel.votes_30d, VisualNovel.public_votes),
            _sample=lambda: VisualNovel.public_votes,
        ),
        MetricSort(
            key="rising_year",
            label="Rising this year",
            board_slug="vns-rising-year",
            min_sample=50,
            sample_noun="votes",
            high_means="most of its attention is recent",
            low_means="little recent attention",
            _expression=lambda: _share(VisualNovel.votes_365d, VisualNovel.public_votes),
            _sample=lambda: VisualNovel.public_votes,
        ),
        MetricSort(
            key="drop_rate",
            label="Drop rate",
            board_slug=None,
            question_key="dropped",
            min_sample=50,
            sample_noun="readers who started it",
            high_means="often abandoned",
            low_means="rarely abandoned",
            _expression=lambda: _damped_share(VisualNovel.list_dropped, _STARTED, "dropped"),
            _sample=lambda: _STARTED,
        ),
        MetricSort(
            key="completion_rate",
            label="Completion rate",
            board_slug=None,
            question_key="finished",
            min_sample=50,
            sample_noun="readers who started it",
            high_means="usually finished",
            low_means="rarely finished",
            _expression=lambda: _damped_share(VisualNovel.list_finished, _STARTED, "finished"),
            _sample=lambda: _STARTED,
        ),
        MetricSort(
            key="wishlist",
            label="Wishlisted",
            board_slug=None,
            question_key="wishlisted",
            min_sample=1,
            sample_noun="wishlist entries",
            high_means="most wanted",
            low_means="least wanted",
            _expression=lambda: cast(VisualNovel.list_wishlist, Float),
            _sample=lambda: VisualNovel.list_wishlist,
        ),
        # The one axis with no board behind it, because it comes from a different source
        # covering only the titles that source has analysed. The join is what keeps unmeasured
        # titles out: there is no defensible position for them in a difficulty order.
        MetricSort(
            key="difficulty",
            label="Reading difficulty",
            board_slug=None,
            min_sample=0,
            sample_noun="analysed text",
            high_means="harder Japanese",
            low_means="easier Japanese",
            _expression=lambda: VNDifficulty.difficulty_raw,
            _sample=lambda: VNDifficulty.character_count,
            _defined=lambda: VNDifficulty.difficulty_raw.isnot(None),
            join_model=VNDifficulty,
            _join_condition=lambda: VNDifficulty.vn_id == VisualNovel.id,
        ),
    )
}


def describe_floor(metric: MetricSort) -> str:
    """The sentence shown beside the result count, explaining what was left out.

    A metric with no sample threshold still excludes rows, just on presence rather than on
    size, so it says so in its own terms instead of claiming a floor of zero.
    """
    if not metric.min_sample:
        return "Ranked among titles that have been analysed."
    return f"Ranked among titles with at least {metric.min_sample:,} {metric.sample_noun}."
