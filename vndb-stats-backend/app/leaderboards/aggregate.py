"""Pure aggregation for the leaderboards.

No database access lives here, so the arithmetic can be tested directly. `compute` supplies
the rows and writes the results; this module decides what the numbers mean.

The design point worth knowing: the catalogue's boards collapse into a small number of
accumulation buckets, keyed by (facet, window, purity). Many boards share one bucket, so
the vote stream is walked once and every board is derived from the counters that walk
produces. Adding a board with an existing facet and window is free.
buckets, so the vote stream is walked once and every board is derived from the counters
that walk produces. Adding a board with an existing facet and window is free.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date, timedelta

from .facets import VNFacts, matches
from .spec import (
    RATE_METRICS,
    WINDOW_DAYS,
    BoardSpec,
    Facet,
    Metric,
    Subject,
    Window,
)

#: Damping for Bayesian averages: how many votes of the global mean to blend in. Low
#: enough that a well-voted title keeps its own score, high enough that five votes cannot
#: reach the top of a chart.
BAYESIAN_PRIOR_VOTES = 25

#: Windows whose unfiltered per-title counts are written to visual_novels, and which
#: therefore have to be accumulated regardless of which boards the registry contains.
PERSISTED_WINDOWS = (Window.MONTH, Window.YEAR)

#: Sentinels for the sole-voter tally, which collapses to one slot per VN instead of
#: retaining every voter of every VN.
_UNSEEN = object()
_MANY_VOTERS = object()


@dataclass(slots=True)
class SubjectCounters:
    """Running totals for one user, VN or producer within one bucket."""

    matched: int = 0
    matched_total: int = 0  # sum of votes, on VNDB's 10-100 scale
    matched_sq: int = 0  # sum of squared votes, for the spread
    unmatched: int = 0  # votes falling outside the facet; only purity boards read this
    #: Titles behind these counters. Only the entity roll-up sets it, and it is the sample
    #: size that matters there: a lone credit on a famous work carries tens of thousands of
    #: votes, which says nothing about the person.
    works: int = 0

    @property
    def average(self) -> float:
        """Mean vote on the 1-10 scale the site displays."""
        if not self.matched:
            return 0.0
        return self.matched_total / self.matched / 10

    @property
    def stddev(self) -> float:
        """Population standard deviation on the 1-10 scale."""
        if self.matched < 2:
            return 0.0
        mean = self.matched_total / self.matched
        variance = (self.matched_sq / self.matched) - (mean * mean)
        # Floating point can push a near-zero variance just below zero.
        return math.sqrt(max(0.0, variance)) / 10


@dataclass(slots=True)
class Bucket:
    """Counters for one (facet, window, purity) combination."""

    facet: Facet
    window: Window
    require_pure: bool
    users: dict = field(default_factory=dict)
    vns: dict = field(default_factory=dict)
    #: Only maintained on the base bucket, which is the one every VN passes through.
    single_voter: dict = field(default_factory=dict)
    track_single_voter: bool = False
    #: Per-VN vote history as (day ordinal, vote), needed to split a title's votes into an
    #: earlier and a later half. Also base-bucket only: this is one entry per vote in the
    #: database, so keeping it on every bucket would multiply it by the bucket count.
    history: dict = field(default_factory=dict)
    track_history: bool = False

    def user(self, uid: str) -> SubjectCounters:
        counters = self.users.get(uid)
        if counters is None:
            counters = self.users[uid] = SubjectCounters()
        return counters

    def vn(self, vn_id: str) -> SubjectCounters:
        counters = self.vns.get(vn_id)
        if counters is None:
            counters = self.vns[vn_id] = SubjectCounters()
        return counters


def build_buckets(specs: list[BoardSpec]) -> dict[tuple, Bucket]:
    """One bucket per distinct (facet, window, purity) across the catalogue."""
    buckets: dict[tuple, Bucket] = {}

    def ensure(facet: Facet, window: Window, require_pure: bool) -> None:
        key = (facet.canonical(), window.value, require_pure)
        if key not in buckets:
            buckets[key] = Bucket(facet=facet, window=window, require_pure=require_pure)

    for spec in specs:
        ensure(spec.facet, spec.window, spec.require_pure)

        # A velocity board compares its window against all time, so the lifetime bucket has
        # to exist whether or not some other board happens to ask for it.
        if spec.metric is Metric.VELOCITY:
            ensure(spec.facet, Window.ALL, False)

    # The unfiltered, all-time bucket carries the sole-voter tally and the vote histories,
    # which need every vote and so ride along here rather than paying for a pass of their
    # own. It is created unconditionally: the boards that read it are not necessarily the
    # ones that would otherwise have asked for this facet and window.
    base_facet = Facet()
    ensure(base_facet, Window.ALL, False)
    base = buckets[(base_facet.canonical(), Window.ALL.value, False)]
    base.track_single_voter = True

    # Histories are the largest thing this job holds, but the reputation shift written to
    # visual_novels is derived from them, so they are collected whether or not the catalogue
    # currently contains a board that reads them.
    base.track_history = True

    # Likewise the windowed per-title counts: their buckets exist because the columns need
    # them, not because a board happens to ask for that facet and window. Leaving it to
    # coincidence is how removing a board silently empties a database column.
    for window in PERSISTED_WINDOWS:
        ensure(base_facet, window, False)

    return buckets


def window_start(window: Window, reference: date) -> date | None:
    """Lower bound of a rolling window, or None when the window is unbounded."""
    days = WINDOW_DAYS.get(window)
    if days is None:
        return None
    return reference - timedelta(days=days)


def facet_membership(
    vn_facts: dict[str, VNFacts],
    facets: list[Facet],
    tagged_vn_ids: dict[int, frozenset] | None = None,
) -> dict[str, set]:
    """Resolve each facet to the set of VN ids satisfying it.

    Done once against ~60K titles rather than per vote. The alternative, caching a verdict
    per (facet, VN) pair as votes stream past, ends up holding the same information in a
    far more expensive shape.
    """
    tagged_vn_ids = tagged_vn_ids or {}
    membership: dict[str, set] = {}

    for facet in facets:
        canonical = facet.canonical()
        if canonical in membership:
            continue
        tagged = tagged_vn_ids.get(facet.tag)
        membership[canonical] = {
            vn_id for vn_id, facts in vn_facts.items() if matches(facts, facet, tagged)
        }

    return membership


def prepare_plan(
    buckets: dict[tuple, Bucket],
    vn_facts: dict[str, VNFacts],
    reference: date,
    tagged_vn_ids: dict[int, frozenset] | None = None,
) -> list[tuple]:
    """Flatten the buckets into the form the hot loop walks.

    Built once and reused across every chunk of the vote stream: resolving facet
    membership and window bounds per chunk would repeat work proportional to the number of
    chunks for no benefit.
    """
    membership = facet_membership(
        vn_facts, [b.facet for b in buckets.values()], tagged_vn_ids
    )
    return [
        (
            bucket,
            window_start(bucket.window, reference),
            membership[bucket.facet.canonical()],
        )
        for bucket in buckets.values()
    ]


def accumulate_chunk(rows, vn_facts: dict[str, VNFacts], plan: list[tuple]) -> int:
    """Fold one batch of vote rows into the buckets described by `plan`.

    `rows` yields (user_hash, vn_id, vote, vote_date). Votes on VNs absent from `vn_facts`
    are dropped: a vote whose title is not in the database cannot be faceted, and counting
    it in the unfiltered boards while excluding it from filtered ones would make the two
    disagree.
    """
    processed = 0

    for user_hash, vn_id, vote, vote_date in rows:
        if vote is None or vn_id not in vn_facts:
            continue

        processed += 1

        for bucket, start, members in plan:
            if start is not None and (vote_date is None or vote_date < start):
                continue

            if vn_id in members:
                counters = bucket.user(user_hash)
                counters.matched += 1
                counters.matched_total += vote
                counters.matched_sq += vote * vote

                vn_counters = bucket.vn(vn_id)
                vn_counters.matched += 1
                vn_counters.matched_total += vote
                vn_counters.matched_sq += vote * vote
            elif bucket.require_pure:
                # Only purity boards read this, and maintaining it everywhere would grow
                # every user dict for nothing.
                bucket.user(user_hash).unmatched += 1

            if bucket.track_single_voter:
                seen = bucket.single_voter.get(vn_id, _UNSEEN)
                if seen is _UNSEEN:
                    bucket.single_voter[vn_id] = user_hash
                elif seen is not _MANY_VOTERS:
                    bucket.single_voter[vn_id] = _MANY_VOTERS

            if bucket.track_history and vote_date is not None:
                bucket.history.setdefault(vn_id, []).append(
                    (vote_date.toordinal(), vote)
                )

    return processed


def accumulate_votes(
    rows,
    vn_facts: dict[str, VNFacts],
    buckets: dict[tuple, Bucket],
    reference: date,
    tagged_vn_ids: dict[int, frozenset] | None = None,
) -> int:
    """Plan and accumulate in one call, for callers holding the whole stream at once."""
    plan = prepare_plan(buckets, vn_facts, reference, tagged_vn_ids)
    return accumulate_chunk(rows, vn_facts, plan)


def sole_voter_counts(bucket: Bucket) -> dict[str, int]:
    """How many VNs each user is the only visible voter on."""
    counts: dict[str, int] = {}
    for voter in bucket.single_voter.values():
        if voter is _MANY_VOTERS:
            continue
        counts[voter] = counts.get(voter, 0) + 1
    return counts


@dataclass(slots=True)
class VoteActivity:
    """When the community votes, accumulated alongside the leaderboard walk.

    Riding on that walk rather than running its own query is the whole point: the vote table
    is already being read end to end, so these counters cost two dictionary increments per
    row and no additional scan.
    """

    #: Calendar year to vote count. How the community grew.
    by_year: dict = field(default_factory=dict)
    #: Month of the year, 1-12, pooled across all years. Whether reading is seasonal.
    by_month: dict = field(default_factory=dict)
    #: Day of the week, Monday as 0. Whether it is a weekend habit.
    by_weekday: dict = field(default_factory=dict)

    def record(self, when: date) -> None:
        self.by_year[when.year] = self.by_year.get(when.year, 0) + 1
        self.by_month[when.month] = self.by_month.get(when.month, 0) + 1
        weekday = when.weekday()
        self.by_weekday[weekday] = self.by_weekday.get(weekday, 0) + 1

    def as_payload(self) -> dict:
        """Sorted, JSON-ready form.

        Month and weekday are emitted as shares rather than counts: the raw totals are
        dominated by however many years of data happen to exist, which says nothing about
        seasonality.
        """
        month_total = sum(self.by_month.values()) or 1
        weekday_total = sum(self.by_weekday.values()) or 1
        return {
            "by_year": [
                {"year": year, "count": count}
                for year, count in sorted(self.by_year.items())
            ],
            "by_month": [
                {
                    "month": month,
                    "count": self.by_month.get(month, 0),
                    "share": round(self.by_month.get(month, 0) / month_total, 5),
                }
                for month in range(1, 13)
            ],
            "by_weekday": [
                {
                    "weekday": day,
                    "count": self.by_weekday.get(day, 0),
                    "share": round(self.by_weekday.get(day, 0) / weekday_total, 5),
                }
                for day in range(7)
            ],
            "total": sum(self.by_year.values()),
        }


def roll_up_by_entity(bucket: Bucket, entity_vns: dict[str, list[str]]) -> Bucket:
    """Pool the counters of each entity's visual novels into an entity-keyed bucket.

    Used for anything credited on titles rather than voting on them: studios, publishers,
    writers, voice actors. The score is the aggregate of the votes those titles received,
    not the average of their averages, so one obscure work cannot outweigh a landmark one.

    Results land on the user side of the bucket, which is why only VN boards read the VN
    side.
    """
    rolled = Bucket(facet=bucket.facet, window=bucket.window, require_pure=False)

    for entity_id, vn_ids in entity_vns.items():
        counters = rolled.user(entity_id)
        for vn_id in vn_ids:
            vn_counters = bucket.vns.get(vn_id)
            if vn_counters is None:
                continue
            counters.matched += vn_counters.matched
            counters.matched_total += vn_counters.matched_total
            counters.matched_sq += vn_counters.matched_sq
            counters.works += 1

    # An entity whose titles attracted no votes carries no information.
    rolled.users = {e: c for e, c in rolled.users.items() if c.matched}
    return rolled


def rank_velocity_board(
    spec: BoardSpec,
    windowed: Bucket,
    lifetime: Bucket,
) -> list[RankedEntry]:
    """Rank titles by how much of their lifetime attention arrived in the window.

    Needs two buckets rather than one, because the question is a ratio between a period and
    all time. A raw count of recent votes would just rank the perennially popular; this
    surfaces what is moving.
    """
    entries: list[RankedEntry] = []

    for vn_id, recent in windowed.vns.items():
        total = lifetime.vns.get(vn_id)
        if total is None or total.matched < max(spec.min_count, 1):
            continue

        entries.append(
            RankedEntry(
                key=vn_id,
                value=recent.matched / total.matched,
                count=total.matched,
                secondary={"recent": recent.matched, "lifetime": total.matched},
            )
        )

    return _order(entries, spec)


#: Minimum votes in each half before a shift is meaningful. Below this, one enthusiast
#: arriving late moves the number more than any change in reception would.
MIN_VOTES_PER_HALF = 10


def reputation_shift(history: list[tuple[int, int]]) -> tuple[float, int, float, float] | None:
    """How much a title's average moved between its earlier and later votes.

    Returns (shift, votes considered, earlier mean, later mean) on the 1-10 scale, or None
    when either half is too thin to say anything.

    Split by vote order rather than by calendar midpoint: a title that collected most of its
    votes in its first month and a trickle since would put almost everything in the "early"
    half under a date split, leaving the late half meaningless.
    """
    if len(history) < MIN_VOTES_PER_HALF * 2:
        return None

    ordered = sorted(history)
    midpoint = len(ordered) // 2
    earlier = [vote for _, vote in ordered[:midpoint]]
    later = [vote for _, vote in ordered[midpoint:]]

    if len(earlier) < MIN_VOTES_PER_HALF or len(later) < MIN_VOTES_PER_HALF:
        return None

    earlier_mean = sum(earlier) / len(earlier) / 10
    later_mean = sum(later) / len(later) / 10
    return (later_mean - earlier_mean, len(ordered), earlier_mean, later_mean)


def rank_reputation_board(spec: BoardSpec, bucket: Bucket) -> list[RankedEntry]:
    """Rank titles by how far their reception moved over their lifetime."""
    entries: list[RankedEntry] = []

    for vn_id, history in bucket.history.items():
        if len(history) < max(spec.min_count, 1):
            continue

        computed = reputation_shift(history)
        if computed is None:
            continue

        shift, considered, earlier_mean, later_mean = computed
        entries.append(
            RankedEntry(
                key=vn_id,
                value=shift,
                count=considered,
                secondary={
                    "early": round(earlier_mean, 2),
                    "late": round(later_mean, 2),
                },
            )
        )

    return _order(entries, spec)


def rank_rating_as_of(spec: BoardSpec, bucket: Bucket) -> list[RankedEntry]:
    """Rank titles by their standing at the end of a given year.

    Reconstructed from the stored vote histories by discarding everything cast after the
    cutoff. The prior is the mean across the surviving votes, not today's mean, so a board
    for 2010 is scored entirely on what was known in 2010.

    The result is not the same as the current chart filtered by release date: it shows what
    the community actually thought at the time, including titles that were briefly
    celebrated and titles that had not yet been discovered.
    """
    if spec.as_of_year is None:
        raise ValueError(f"{spec.slug}: rating-as-of requires as_of_year")

    cutoff = date(spec.as_of_year, 12, 31).toordinal()
    floor = max(spec.min_count, 1)

    surviving: dict[str, tuple[int, int]] = {}
    pooled_total = 0
    pooled_count = 0

    for vn_id, history in bucket.history.items():
        total = 0
        count = 0
        for day, vote in history:
            if day <= cutoff:
                total += vote
                count += 1
        if count:
            pooled_total += total
            pooled_count += count
        if count >= floor:
            surviving[vn_id] = (total, count)

    if not pooled_count:
        return []

    prior = pooled_total / pooled_count / 10

    entries = [
        RankedEntry(
            key=vn_id,
            value=bayesian_average(total, count, prior),
            count=count,
            secondary={"votes_then": count, "mean_then": round(total / count / 10, 2)},
        )
        for vn_id, (total, count) in surviving.items()
    ]

    return _order(entries, spec)


def bayesian_average(total: int, count: int, global_mean: float) -> float:
    """Blend a subject's mean toward the global mean in proportion to how little data it has."""
    if count <= 0:
        return 0.0
    own_mean = total / count / 10
    return (count * own_mean + BAYESIAN_PRIOR_VOTES * global_mean) / (
        count + BAYESIAN_PRIOR_VOTES
    )


def global_mean_vote(bucket: Bucket) -> float:
    """Mean vote across everything in a bucket, the prior for its Bayesian averages."""
    total = sum(c.matched_total for c in bucket.vns.values())
    count = sum(c.matched for c in bucket.vns.values())
    if not count:
        return 0.0
    return total / count / 10


@dataclass(slots=True)
class RankedEntry:
    """One scored subject, before it is turned into a display row."""

    key: str
    value: float
    count: int
    secondary: dict = field(default_factory=dict)


def rank_vote_board(
    spec: BoardSpec, bucket: Bucket, prior: float | None = None
) -> list[RankedEntry]:
    """Score and order a vote-derived board from its bucket."""
    if spec.metric is Metric.SOLE_VOTER:
        counts = sole_voter_counts(bucket)
        entries = [
            RankedEntry(key=uid, value=float(n), count=n)
            for uid, n in counts.items()
            if n >= spec.min_count
        ]
        return _order(entries, spec)

    # Only VN boards read the per-title counters. Users key the other side directly, and
    # producers arrive there too, pooled from their titles by roll_up_to_producers.
    source = bucket.vns if spec.subject is Subject.VN else bucket.users
    # The caller supplies the prior for a bucket that no longer holds the votes it was built
    # from. Rolling titles up into the entities that made them leaves the per-title side
    # empty, and a mean taken from that is zero, which damps every thinly-voted entity toward
    # the bottom of the scale rather than toward the middle of it.
    if spec.metric is not Metric.BAYESIAN:
        prior = 0.0
    elif prior is None:
        prior = global_mean_vote(bucket)

    entries: list[RankedEntry] = []
    for key, counters in source.items():
        if counters.matched < max(spec.min_count, 1):
            continue
        # For anything scored by pooling other people's titles, this is the floor that
        # matters. A single credit on a landmark work satisfies any vote floor by itself.
        if counters.works < spec.min_works:
            continue
        if spec.require_pure and counters.unmatched:
            continue

        if spec.metric is Metric.VOTES:
            value = float(counters.matched)
        elif spec.metric is Metric.VOTERS:
            value = float(counters.matched)
        elif spec.metric is Metric.AVG_SCORE:
            value = counters.average
        elif spec.metric is Metric.BAYESIAN:
            value = bayesian_average(counters.matched_total, counters.matched, prior)
        elif spec.metric is Metric.DIVISIVENESS:
            value = counters.stddev
        elif spec.metric is Metric.WORKS:
            value = float(counters.works)
        else:
            # VELOCITY needs two buckets and is dispatched to rank_velocity_board instead.
            raise ValueError(
                f"{spec.slug}: {spec.metric} cannot be scored from a single bucket"
            )

        secondary = {"average": round(counters.average, 2)}
        if counters.works:
            # Shown so a reader can see the sample behind the score rather than trusting it.
            secondary["works"] = counters.works

        entries.append(
            RankedEntry(key=key, value=value, count=counters.matched, secondary=secondary)
        )

    return _order(entries, spec)


#: Eras the reading mix is split into. Decade buckets, because that is how readers talk
#: about the medium, with everything before 2000 pooled: the years before that are thin
#: enough that a decade each would be mostly noise.
READING_ERAS = (
    ("pre2000", None, 1999),
    ("2000s", 2000, 2009),
    ("2010s", 2010, 2019),
    ("2020s", 2020, None),
)


def reading_trends(history: dict, vn_facts: dict, first_year: int) -> dict:
    """How the community's reading has moved through the medium's history.

    Two series, both from the vote histories the job already holds: how old a title
    typically is when someone votes on it, and which era those titles come from.

    Computed here rather than as its own query because every vote is already in memory with
    its date, and every title's release year is already loaded. A second pass over 1.9M rows
    to recover what the first pass had would be pure waste.

    Written to stay cheap over that many votes: day ordinals are mapped to years through a
    memo rather than by building a date per vote, and ages are counted into a histogram
    rather than appended to a list that then has to be sorted. Doing it the obvious way cost
    the nightly job two and a half minutes.
    """
    year_of: dict[int, int] = {}
    per_year: dict[int, dict] = {}

    for vn_id, votes in history.items():
        facts = vn_facts.get(vn_id)
        if facts is None or facts.year is None:
            continue
        released = facts.year

        era = None
        for name, low, high in READING_ERAS:
            if (low is None or released >= low) and (high is None or released <= high):
                era = name
                break

        for day_ordinal, _vote in votes:
            voted_in = year_of.get(day_ordinal)
            if voted_in is None:
                voted_in = year_of[day_ordinal] = date.fromordinal(day_ordinal).year
            if voted_in < first_year:
                continue

            bucket = per_year.get(voted_in)
            if bucket is None:
                bucket = per_year[voted_in] = {"votes": 0, "ages": {}, "eras": {}}
            bucket["votes"] += 1

            # Negative where a vote predates the recorded release date, which happens with
            # early access and approximate dates. Kept rather than dropped, since excluding
            # them would bias the age upward.
            age = voted_in - released
            bucket["ages"][age] = bucket["ages"].get(age, 0) + 1
            if era:
                bucket["eras"][era] = bucket["eras"].get(era, 0) + 1

    years = []
    for year in sorted(per_year):
        bucket = per_year[year]
        total = bucket["votes"]
        if not total:
            continue

        # Median straight off the histogram, so nothing the size of the vote table is sorted.
        seen, median, weighted = 0, 0, 0
        for age in sorted(bucket["ages"]):
            count = bucket["ages"][age]
            weighted += age * count
            if seen < total / 2 <= seen + count:
                median = age
            seen += count

        years.append({
            "year": year,
            "votes": total,
            "median_age": median,
            "mean_age": round(weighted / total, 1),
            "eras": {
                name: round(bucket["eras"].get(name, 0) / total, 4)
                for name, _low, _high in READING_ERAS
            },
        })

    return {"years": years, "eras": [name for name, _l, _h in READING_ERAS]}


@dataclass(slots=True)
class ReaderScan:
    """One reader's standing against the community, from the grouped vote scan.

    `bias` is the mean gap between their vote and the community's on the same titles, in
    rating points. `divergence` is the spread of that gap around their own average, which is
    a genuinely different question: a reader who marks everything two points low is
    predictable once you know the offset, so their bias is large and their divergence small.
    A reader who loves what the room dislikes and dislikes what it loves has the reverse.

    Taken as a spread rather than as a mean absolute gap on purpose. The absolute version
    tracks bias almost exactly, so the two boards reading these would be near-duplicates.
    """

    votes: int = 0
    bias: float = 0.0
    divergence: float = 0.0
    #: Typical number of other voters on the titles they voted on.
    median_voters: float = 0.0
    #: Typical release year of the titles they voted on.
    median_year: float = 0.0
    #: Width in years of the release-year band holding the middle 80% of their votes, with
    #: the band's own edges kept so a row can say which period it is.
    era_window: float = 0.0
    era_from: int = 0
    era_to: int = 0
    #: Slope of their votes regressed on the community average, damped toward 1.0 so a
    #: short list cannot outrank a long one on the strength of a noisier estimate.
    response: float = 0.0
    #: Share of the variance in their votes the community average accounts for. Low means
    #: the slope is a line drawn through a cloud and says nothing.
    response_fit: float = 0.0
    #: Evenness of their monthly vote counts, 0 to 1, and the span it was measured over.
    steadiness: float = 0.0
    active_months: int = 0
    span_months: int = 0
    last_active: str = ""


def rank_reader_scan(spec: BoardSpec, scans: dict[str, ReaderScan]) -> list[RankedEntry]:
    """Rank readers on a measure taken against the community rather than in isolation.

    A plain average score conflates two things: how generously someone scores, and how good
    the titles they chose to read were. Comparing each vote against the community's own mean
    for that title removes the second, which is what makes this rankable at all.
    """
    entries: list[RankedEntry] = []

    for key, scan in scans.items():
        if scan.votes < max(spec.min_count, 1):
            continue

        if spec.metric is Metric.VOTE_BIAS:
            value = scan.bias
            secondary = {"votes": scan.votes, "divergence": round(scan.divergence, 2)}
        elif spec.metric is Metric.VOTE_DIVERGENCE:
            value = scan.divergence
            secondary = {"votes": scan.votes, "bias": round(scan.bias, 2)}
        elif spec.metric is Metric.OBSCURITY:
            value = scan.median_voters
            secondary = {"votes": scan.votes}
        elif spec.metric is Metric.ERA:
            value = scan.median_year
            secondary = {"votes": scan.votes}
        elif spec.metric is Metric.ERA_WINDOW:
            value = scan.era_window
            secondary = {
                "votes": scan.votes,
                "from": scan.era_from,
                "to": scan.era_to,
            }
        elif spec.metric is Metric.VOTE_RESPONSE:
            value = scan.response
            secondary = {"votes": scan.votes, "fit": round(scan.response_fit, 2)}
        elif spec.metric is Metric.STEADINESS:
            value = scan.steadiness
            secondary = {
                "votes": scan.votes,
                "months": scan.active_months,
                "span": scan.span_months,
                "last": scan.last_active,
            }
        else:
            raise ValueError(f"{spec.slug}: {spec.metric} is not taken from the reader scan")

        entries.append(
            RankedEntry(key=key, value=value, count=scan.votes, secondary=secondary)
        )

    return _order(entries, spec)


def qualifying_title_scores(
    bucket: Bucket,
    vn_ids: list[str],
    prior: float,
    min_votes_per_title: int,
) -> tuple[list[float], int]:
    """The damped score of each title in a set that has enough votes to be judged.

    A title nobody has voted on is unproven rather than weak, so it is skipped instead of
    counting against whatever it belongs to.
    """
    scores: list[float] = []
    total_votes = 0
    for vn_id in vn_ids:
        counters = bucket.vns.get(vn_id)
        if counters is None or counters.matched < min_votes_per_title:
            continue
        scores.append(bayesian_average(counters.matched_total, counters.matched, prior))
        total_votes += counters.matched
    return scores, total_votes


def rank_title_aggregate(
    spec: BoardSpec,
    bucket: Bucket,
    entity_vns: dict[str, list[str]],
    prior: float,
    min_votes_per_title: int,
) -> list[RankedEntry]:
    """Rank a set of titles by the mean or spread of their scores, unweighted by votes.

    Unweighted is the point for tags: pooling every vote would let one hugely-voted title
    speak for a tag applied to hundreds of others. The question is what titles carrying this
    tag are typically like, not what the most-voted one is like.
    """
    entries: list[RankedEntry] = []

    for entity_id, vn_ids in entity_vns.items():
        scores, total_votes = qualifying_title_scores(
            bucket, vn_ids, prior, min_votes_per_title
        )
        if len(scores) < max(spec.min_works, 2):
            continue

        mean = sum(scores) / len(scores)
        if spec.metric is Metric.TITLE_MEAN:
            value = mean
        elif spec.metric is Metric.TITLE_SPREAD:
            variance = sum((x - mean) ** 2 for x in scores) / len(scores)
            value = math.sqrt(max(0.0, variance))
        else:
            raise ValueError(f"{spec.slug}: {spec.metric} does not aggregate title scores")

        entries.append(
            RankedEntry(
                key=entity_id,
                value=value,
                count=len(scores),
                secondary={"works": len(scores), "average": round(mean, 2),
                           "votes": total_votes},
            )
        )

    return _order(entries, spec)


def rank_reader_share(
    spec: BoardSpec,
    compositions: dict[str, dict[str, int]],
    numerator: str,
    denominator: str,
) -> list[RankedEntry]:
    """Rank readers by what proportion of their library is of one kind.

    A share rather than a count, which is the whole point: counting a reader's votes inside
    some corner of the database mostly re-ranks whoever votes most, while the share names the
    people whose reading actually is that thing.

    The floor applies to the denominator, not to the reader's total votes, because for some of
    these the denominator is already a subset: a reader with three thousand votes and eleven
    titles whose route structure anyone recorded has not told us anything about how they read.
    """
    entries: list[RankedEntry] = []

    for reader, counts in compositions.items():
        total = counts.get(denominator, 0)
        if total < max(spec.min_count, 1):
            continue
        matched = counts.get(numerator, 0)
        entries.append(
            RankedEntry(
                key=reader,
                value=matched / total,
                count=total,
                secondary={"matched": matched, "of": total},
            )
        )

    return _order(entries, spec)


@dataclass
class BacklogGap:
    """How the length of a reader's backlog compares with the length of what they finish.

    Both means are over VNDB's own 1-to-5 length category rather than an hour count, because
    the category is recorded for roughly twice as many titles and the comparison only needs
    the two sides measured the same way.

    No null correction: the two sides are drawn from one reader's own list, so under any
    reshuffling the expected difference between their means is zero, and a signed difference
    of means is already centred on no-effect. That is not true of the distance measures
    elsewhere here, which is why those carry a null and this does not.
    """

    finished: int = 0
    wishlist: int = 0
    finished_length: float = 0.0
    wishlist_length: float = 0.0

    @property
    def gap(self) -> float:
        return self.wishlist_length - self.finished_length


def rank_backlog_gap(spec: BoardSpec, backlogs: dict[str, BacklogGap]) -> list[RankedEntry]:
    """Rank readers by the gap between what they mean to read and what they get through.

    The sample is the smaller side, since that is what limits the comparison: a reader with
    four finished titles and a thousand wishlisted has one mean worth trusting and one not.
    """
    entries: list[RankedEntry] = []

    for reader, backlog in backlogs.items():
        sample = min(backlog.finished, backlog.wishlist)
        if sample < max(spec.min_count, 1):
            continue
        entries.append(
            RankedEntry(
                key=reader,
                value=backlog.gap,
                count=sample,
                secondary={
                    "finished": backlog.finished,
                    "wishlist": backlog.wishlist,
                    "finished_length": round(backlog.finished_length, 2),
                    "wishlist_length": round(backlog.wishlist_length, 2),
                },
            )
        )

    return _order(entries, spec)


def rank_reader_value(
    spec: BoardSpec,
    compositions: dict[str, dict[str, int]],
    field: str,
    count_field: str,
    scale: int = 10_000,
) -> list[RankedEntry]:
    """Rank readers by a share that was averaged before it arrived.

    Distinct from the plain share boards because the figure is a mean of per-item shares
    rather than one ratio, so there is no pair of counts to divide. It travels as an integer
    per ten thousand for the same reason every other figure here does, and is put back on the
    0-to-1 scale at the last moment. `scale` is what it was multiplied by on the way in.
    """
    entries: list[RankedEntry] = []

    for reader, counts in compositions.items():
        sample = counts.get(count_field, 0)
        if sample < max(spec.min_count, 1):
            continue
        entries.append(
            RankedEntry(
                key=reader,
                value=counts.get(field, 0) / scale,
                count=sample,
                secondary={"of": sample},
            )
        )

    return _order(entries, spec)


def rank_title_average(
    spec: BoardSpec,
    entity_vns: dict[str, list[str]],
    value_of,
    baseline: float | None = None,
) -> list[RankedEntry]:
    """Rank entities by the average of a per-title figure across the titles they cover.

    `value_of` returns the figure for one title, or None where it is not measured. Not
    measured is not zero: a title jiten has never analysed has no difficulty, and letting it
    count as easy would drag every broad tag toward the bottom of the board.

    Each title counts once regardless of its vote count, which is the whole point for a tag.
    The gap from `baseline` is carried alongside the average, since a difficulty of 3.1 only
    means something next to what an average title scores.
    """
    entries: list[RankedEntry] = []

    for entity_id, vn_ids in entity_vns.items():
        values = [value for value in map(value_of, vn_ids) if value is not None]
        if len(values) < max(spec.min_works, 2):
            continue

        mean = sum(values) / len(values)
        secondary = {"works": len(values)}
        if baseline is not None:
            secondary["baseline"] = round(baseline, 2)
            secondary["gap"] = round(mean - baseline, 2)

        entries.append(
            RankedEntry(key=entity_id, value=mean, count=len(values), secondary=secondary)
        )

    return _order(entries, spec)


#: Pulls a terminal-vote ratio toward 1.0 in proportion to how thin its expected count is.
#: Without it the board is led by titles whose ratio rests on a handful of readers.
TERMINAL_PRIOR = 10.0


def rank_terminal(spec: BoardSpec, terminal: dict[str, tuple]) -> list[RankedEntry]:
    """Rank titles by how often they were the last thing a reader logged.

    The ratio is observed against expected, where expected already accounts for when the
    votes were cast: the chance that any given vote turns out to be someone's last rises
    steadily across the record, so an unnormalised count would rank recency alone.
    """
    entries: list[RankedEntry] = []

    for vn_id, (raters, observed, expected) in terminal.items():
        if expected <= 0:
            continue
        value = (observed + TERMINAL_PRIOR) / (expected + TERMINAL_PRIOR)
        entries.append(
            RankedEntry(
                key=vn_id,
                value=value,
                count=observed,
                secondary={
                    "readers": raters,
                    "ended": observed,
                    "expected": round(expected, 1),
                },
            )
        )

    return _order(entries, spec)


def rank_series_span(spec: BoardSpec, spans: dict[str, tuple]) -> list[RankedEntry]:
    """Rank franchises by the years between their first and most recent entry."""
    entries: list[RankedEntry] = []

    for key, (entries_counted, first_year, last_year, span, votes) in spans.items():
        if entries_counted < max(spec.min_works, 2):
            continue
        entries.append(
            RankedEntry(
                key=key,
                value=span,
                count=entries_counted,
                secondary={
                    "works": entries_counted,
                    "first": first_year,
                    "latest": last_year,
                    "votes": votes,
                },
            )
        )

    return _order(entries, spec)


def rank_discovery_lag(
    spec: BoardSpec,
    bucket: Bucket,
    vn_facts: dict,
    min_cohort: int = 10,
) -> list[RankedEntry]:
    """Rank titles by how much later than their contemporaries the votes arrived.

    Measured against other titles released the same year, because the raw lag is mostly a
    statement about age: a title from the 1980s can only have been voted on decades later,
    since the database did not exist. Normalising within the release year asks the question
    that is actually interesting, which is whether a title took longer than its peers.
    """
    lags: dict[str, tuple[float, int, int]] = {}

    for vn_id, history in bucket.history.items():
        facts = vn_facts.get(vn_id)
        if facts is None or facts.released_ordinal is None or facts.year is None:
            continue
        if len(history) < max(spec.min_count, 1):
            continue

        after = sorted(
            day - facts.released_ordinal for day, _ in history if day > facts.released_ordinal
        )
        if len(after) < max(spec.min_count, 1):
            continue

        median_days = after[len(after) // 2]
        lags[vn_id] = (median_days / 365.25, facts.year, len(after))

    # Cohort means, so each title is compared with its own release year.
    by_year: dict[int, list[float]] = {}
    for years, year, _ in lags.values():
        by_year.setdefault(year, []).append(years)
    cohort_mean = {
        year: sum(values) / len(values)
        for year, values in by_year.items()
        if len(values) >= min_cohort
    }

    entries = [
        RankedEntry(
            key=vn_id,
            value=years - cohort_mean[year],
            count=votes,
            secondary={"median_years": round(years, 1), "year": year},
        )
        for vn_id, (years, year, votes) in lags.items()
        if year in cohort_mean
    ]

    return _order(entries, spec)


def rank_catalogue_floor(
    spec: BoardSpec,
    bucket: Bucket,
    entity_vns: dict[str, list[str]],
    prior: float,
    min_votes_per_title: int,
) -> list[RankedEntry]:
    """Rank entities by their weakest title rather than their average.

    Answers the question a reader actually has about a studio, which is whether the back
    catalogue can be picked from blind. An average hides one bad entry among several good
    ones; the floor is precisely what does not.

    Ranking on low variance instead would be a mistake: it rewards being consistently
    mediocre just as much as being consistently good.
    """
    entries: list[RankedEntry] = []

    for entity_id, vn_ids in entity_vns.items():
        scores, total_votes = qualifying_title_scores(
            bucket, vn_ids, prior, min_votes_per_title
        )
        if len(scores) < max(spec.min_works, 2):
            continue

        entries.append(
            RankedEntry(
                key=entity_id,
                value=min(scores),
                count=total_votes,
                secondary={
                    "works": len(scores),
                    "average": round(sum(scores) / len(scores), 2),
                },
            )
        )

    return _order(entries, spec)


@dataclass(slots=True)
class LabelCounts:
    """Per-subject tallies of VNDB list labels."""

    playing: int = 0
    finished: int = 0
    stalled: int = 0
    dropped: int = 0
    wishlist: int = 0

    @property
    def started(self) -> int:
        """Entries representing an actual reading attempt, wishlist excluded."""
        return self.playing + self.finished + self.stalled + self.dropped


#: Reading attempts blended into every rate, at the population's own rate. Without it a
#: title finished by 86 of 89 readers outranks one finished by 4,000 of 4,200, which is a
#: statement about sample size rather than about the titles.
RATE_PRIOR_READERS = 40

#: Where the job records the rates it damped toward, for the sorts that have to match it.
RATE_PRIOR_KEY = "leaderboard_rate_prior"


@dataclass(frozen=True)
class GlobalRates:
    """Population-wide completion and drop rates, used as the prior for damping."""

    finished: float = 0.0
    dropped: float = 0.0


def global_rates(counts: dict[str, LabelCounts]) -> GlobalRates:
    """The rates the whole population reads at, which thin samples are pulled toward."""
    started = sum(t.started for t in counts.values())
    if not started:
        return GlobalRates()
    return GlobalRates(
        finished=sum(t.finished for t in counts.values()) / started,
        dropped=sum(t.dropped for t in counts.values()) / started,
    )


def damped_rate(hits: int, sample: int, prior_rate: float) -> float:
    """A share pulled toward the population rate in proportion to how thin the sample is."""
    return (hits + RATE_PRIOR_READERS * prior_rate) / (sample + RATE_PRIOR_READERS)


def rank_label_board(spec: BoardSpec, counts: dict[str, LabelCounts]) -> list[RankedEntry]:
    """Score and order a board derived from list labels."""
    global_rate = global_rates(counts) if spec.metric in RATE_METRICS else GlobalRates()
    entries: list[RankedEntry] = []

    for key, tally in counts.items():
        if spec.metric is Metric.FINISHED:
            value, sample = float(tally.finished), tally.finished
        elif spec.metric is Metric.DROPPED:
            value, sample = float(tally.dropped), tally.dropped
        elif spec.metric is Metric.WISHLIST:
            value, sample = float(tally.wishlist), tally.wishlist
        elif spec.metric is Metric.DROP_RATE:
            sample = tally.started
            if not sample:
                continue
            value = damped_rate(tally.dropped, sample, global_rate.dropped)
        elif spec.metric is Metric.COMPLETION_RATE:
            sample = tally.started
            if not sample:
                continue
            value = damped_rate(tally.finished, sample, global_rate.finished)
        else:
            raise ValueError(f"{spec.slug}: {spec.metric} is not a label-derived metric")

        if sample < max(spec.min_count, 1):
            continue
        # A reader who has finished nothing has a perfect drop rate and nothing to say. The
        # floor is what separates giving up from labelling in bulk.
        if tally.finished < spec.min_finished:
            continue

        entries.append(
            RankedEntry(
                key=key,
                value=value,
                count=sample,
                secondary={
                    "finished": tally.finished,
                    "dropped": tally.dropped,
                    "started": tally.started,
                },
            )
        )

    return _order(entries, spec)


#: Boundaries stored per distribution: the 0th through 100th percentile inclusive.
SKETCH_SIZE = 101


def percentile_sketch(values: list[float]) -> list[float]:
    """Reduce a distribution to SKETCH_SIZE boundary values.

    Answering "you have read more than N% of readers" from the raw distribution would mean
    counting across 89,000 users per request. The sketch is about a kilobyte, is built once
    a night, and answers the same question by binary search. The cost is resolution: the
    answer is accurate to a percentile, which is all the sentence claims.
    """
    if not values:
        return []

    ordered = sorted(values)
    last = len(ordered) - 1
    return [ordered[round(i / (SKETCH_SIZE - 1) * last)] for i in range(SKETCH_SIZE)]


def percentile_of(sketch: list[float], value: float) -> float | None:
    """Where a value falls in a sketched distribution, as a percentage.

    Returns the share of the population at or below `value`.
    """
    if not sketch:
        return None

    # The sketch is sorted, so the count of boundaries not exceeding the value is the
    # percentile directly.
    low, high = 0, len(sketch)
    while low < high:
        mid = (low + high) // 2
        if sketch[mid] <= value:
            low = mid + 1
        else:
            high = mid

    return round(low / len(sketch) * 100, 1)


def share_below(sketch: list[float], value: float) -> float | None:
    """The share of the population strictly below `value`.

    Reported alongside the at-or-below share because the gap between the two is the share
    holding exactly this value, and on a distribution with a crowded floor that gap is the
    whole story: a reader who has given nothing up shares that with most of the population
    rather than standing above it.
    """
    if not sketch:
        return None

    low, high = 0, len(sketch)
    while low < high:
        mid = (low + high) // 2
        if sketch[mid] < value:
            low = mid + 1
        else:
            high = mid

    return round(low / len(sketch) * 100, 1)


def _order(entries: list[RankedEntry], spec: BoardSpec) -> list[RankedEntry]:
    """Sort by value, breaking ties on sample size then key so the order is stable.

    Stability matters more than it looks: an unstable order makes a board appear to churn
    every night even when nothing about the data changed.
    """
    return sorted(
        entries,
        key=lambda e: (e.value if spec.ascending else -e.value, -e.count, e.key),
    )
