"""Popularity-aware metrics for the offline recommendation evaluation.

WHY THEY ARE SEPARATE FROM rec_metrics
    The accuracy metrics there are shared by several evaluation scripts and their
    signatures are fixed by those callers. These take a prepared view of the whole
    catalogue rather than one reader's ids, so they do not fit that shape, and a metric
    only one script reports does not belong in the shared module.

WHY THEY EXIST
    Held-out titles are drawn from what readers actually read, and readers concentrate
    on well-known ones. An accuracy metric therefore pays for returning popular titles,
    and a scoring change judged on accuracy alone selects for exactly that. The metrics
    here describe the popularity of what comes back, and measure accuracy restricted to
    the obscure part of the ground truth, so the two effects can be told apart.

COST
    Popularity ranks and the tag rollup are whole-catalogue reads, loaded once per run
    and passed to every per-user call. Per-title tag distributions are cached across
    readers, who overlap heavily in what they have read. Rebuilding any of it per reader
    would cost more than the recommendation call being measured.

UNDEFINED IS NOT ZERO
    Every per-user function returns None where its value does not exist: a reader who
    received nothing has no list composition, and a reader who held out nothing obscure
    has no obscure ground truth. Zero in either place reads as the worst possible score
    and would drag an average toward the behaviour being measured against. Callers must
    average over the readers a metric is defined for and report how many that was.
"""

import math
import statistics
from collections import Counter
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Tag, TagParent, VisualNovel, VNTag
from app.db.query_utils import in_ids
from rec_metrics import ndcg_at_k

# Head cutoffs, as a fraction of the catalogue ordered by votecount.
HEAD_THETAS = (0.01, 0.05)

# Levels below the tag-tree roots that the calibration rollup collapses to.
# load_tag_rollup states why this depth and not another.
ROLLUP_DEPTH = 1

# Share of the recommendation-side tag distribution kept when it is mixed with the
# profile side. calibration_kl states what the mixture is for.
CALIBRATION_MIX = 0.99


@dataclass(frozen=True)
class PopularityIndex:
    """Catalogue-wide popularity, built once per run.

    rank_fraction places each title on [0, 1) by descending votecount, so a title whose
    fraction is below theta sits in the top theta of the catalogue. novelty_bits holds
    -log2(p) per title, with p its share of all votes. reference_novelty_bits is the mean
    of novelty_bits under p itself, meaning the novelty a list drawn in proportion to
    popularity would score.

    log_popularity holds log10(votecount + 1) per title. It is the scale the popularity
    slope and gap are measured on: vote counts span orders of magnitude, so a difference
    between two readers means the same thing at either end of the range only in logs.
    """

    rank_fraction: dict[str, float]
    novelty_bits: dict[str, float]
    reference_novelty_bits: float
    log_popularity: dict[str, float] = field(default_factory=dict)

    @property
    def size(self) -> int:
        """Titles in the indexed population."""
        return len(self.rank_fraction)

    def is_head(self, vn_id: str, theta: float) -> bool:
        """Whether a title sits inside the top theta of the catalogue by votecount.

        A title the index does not hold is in the top theta of nothing and counts as
        tail. The index covers everything the run is able to return, so absence means
        the id falls outside the scored population rather than that it is obscure.
        """
        fraction = self.rank_fraction.get(vn_id)
        return fraction is not None and fraction < theta


async def load_popularity_index(
    session: AsyncSession,
    japanese_only: bool = True,
) -> PopularityIndex:
    """Rank the catalogue by votecount and derive its popularity distribution.

    The population must match the one the run can return, otherwise the head boundary
    is drawn over titles no reader could have been shown.

    Ordering is by descending votecount with the id as tiebreak, so equally voted titles
    land in a fixed order and two runs place the boundary in the same place.

        p(i) = votecount(i) / sum over the population of votecount

    An unvoted title is floored at one vote: p has to stay strictly positive for
    -log2(p) to be finite, and the floor keeps the vector a distribution.
    """
    stmt = select(VisualNovel.id, VisualNovel.votecount)
    if japanese_only:
        stmt = stmt.where(VisualNovel.olang == "ja")
    rows = (await session.execute(stmt)).all()
    if not rows:
        return PopularityIndex({}, {}, 0.0)

    ordered = sorted(rows, key=lambda row: (-(row.votecount or 0), row.id))
    total = len(ordered)
    rank_fraction = {row.id: position / total for position, row in enumerate(ordered)}

    votes = {row.id: max(row.votecount or 0, 1) for row in ordered}
    vote_total = sum(votes.values())
    novelty_bits = {
        vn_id: -math.log2(count / vote_total) for vn_id, count in votes.items()
    }
    reference = sum(
        (votes[vn_id] / vote_total) * bits for vn_id, bits in novelty_bits.items()
    )
    # Off the unfloored counts, so an unvoted title reads as zero rather than as one
    # vote. The floor above exists to keep a probability positive, which the log scale
    # does not need.
    log_popularity = {
        row.id: math.log10((row.votecount or 0) + 1) for row in ordered
    }
    return PopularityIndex(rank_fraction, novelty_bits, reference, log_popularity)


def tail_share_at_k(
    recommended: Sequence[str],
    k: int,
    index: PopularityIndex,
    theta: float,
) -> float | None:
    """Share of the top-k recommendations drawn from outside the head of the catalogue.

        tail_share@k = |{i in top-k : rank_fraction(i) >= theta}| / |top-k|

    theta is a fraction of the catalogue ordered by votecount, so theta = 0.01 asks how
    much of the list comes from outside the thousandth-and-so-on most voted titles.
    Descriptive only: a list of nothing but obscure titles scores 1.0 and is not thereby
    a good list. It is read next to tail_ndcg@k, which is the one that has to hold up.

    None when nothing was recommended.
    """
    top = list(recommended[:k])
    if not top:
        return None
    return sum(1 for vn_id in top if not index.is_head(vn_id, theta)) / len(top)


def tail_ndcg_at_k(
    recommended: Sequence[str],
    relevant: Iterable[str],
    k: int,
    index: PopularityIndex,
    theta: float,
) -> float | None:
    """NDCG@k against only the held-out titles that sit outside the head.

        tail_ndcg@k = ndcg_at_k(recommended, {r in relevant : rank_fraction(r) >= theta}, k)

    The ranking is the served one, unfiltered; only relevance is narrowed. Held-out
    titles are overwhelmingly popular, so plain NDCG rises whenever a list leans harder
    on consensus. This asks the narrower question of whether the reader's less-read
    titles were found, which is the part no amount of popularity can supply.

    None when the reader held nothing out from beyond the head: NDCG is undefined
    against an empty relevant set, and zero there would score the reader as a failure
    for having read popular titles.
    """
    tail_relevant = {vn_id for vn_id in relevant if not index.is_head(vn_id, theta)}
    if not tail_relevant:
        return None
    return float(ndcg_at_k(list(recommended), tail_relevant, k))


def novelty_at_k(
    recommended: Sequence[str],
    k: int,
    index: PopularityIndex,
) -> float | None:
    """Mean self-information of the top-k recommendations, in bits.

        novelty@k = mean over the top-k of -log2(p(i))

    p(i) is the title's share of all votes in the catalogue, standing in for the share
    of readers who hold it. A title everyone has carries little information; an obscure
    one carries a lot. The number means nothing on its own, so it is reported against
    index.reference_novelty_bits, the value a list sampled in proportion to popularity
    would score: above the reference the engine is more obscure than picking by
    popularity at random, below it the engine is more popular than that.

    Titles the index does not hold are skipped rather than floored, so a list that falls
    outside the indexed population reports None instead of an invented maximum.
    """
    bits = [
        index.novelty_bits[vn_id]
        for vn_id in recommended[:k]
        if vn_id in index.novelty_bits
    ]
    if not bits:
        return None
    return sum(bits) / len(bits)


def median_log_popularity(
    vn_ids: Sequence[str],
    index: PopularityIndex,
) -> float | None:
    """Median log10(votecount + 1) over a set of titles.

    The median rather than the mean: the distribution of vote counts is long tailed even
    in logs, and one very well known title in a list of obscure ones would carry a mean
    far above where the list actually sits.

    Titles the index does not hold are skipped, and the value is None when none of them
    are held, so a list drawn from outside the indexed population reports nothing rather
    than a number derived from part of itself.
    """
    values = [
        index.log_popularity[vn_id]
        for vn_id in vn_ids
        if vn_id in index.log_popularity
    ]
    if not values:
        return None
    return statistics.median(values)


def popularity_gap_at_k(
    profile_vn_ids: Sequence[str],
    recommended: Sequence[str],
    k: int,
    index: PopularityIndex,
) -> float | None:
    """How far the top-k sits from the reader's own reading on the log popularity scale.

        popularity_gap@k = median log popularity of the top-k
                         - median log popularity of what the reader has read

    Zero means the list is pitched where the reader reads. A positive value means it is
    better known than their own reading, a negative one that it is more obscure. Signed
    and per-reader, so the two directions do not cancel in an average and two runs over
    the same readers can be compared as paired observations: a reader served closer to
    their own level moves toward zero whichever side they started on.

    None when either side has no title the index holds.
    """
    listed = median_log_popularity(recommended[:k], index)
    read = median_log_popularity(profile_vn_ids, index)
    if listed is None or read is None:
        return None
    return listed - read


def popularity_slope(pairs: Iterable[tuple[float, float]]) -> dict[str, float | int | None]:
    """How much of a reader's own popularity level the engine passes into their list.

        slope, intercept = OLS of median log rec popularity on median log read popularity
        r                = Pearson correlation between the two

    One point per reader, so this is a run-level statistic: it is a claim about how the
    engine treats readers who differ from each other, which no single reader's list can
    answer. A slope of 1 means a reader who reads a decade further into the tail than
    another is served a decade further into it. Zero means every reader is served from
    the same place regardless of where they read, and the engine's own popularity profile
    has replaced theirs.

    The correlation is reported alongside because a slope on its own does not say whether
    the relationship is there at all: a steep slope through scattered points describes
    nothing. Both are None with fewer than two readers, or where every reader reads at
    the same level, which leaves no spread to regress on.
    """
    points = [(float(read), float(listed)) for read, listed in pairs]
    count = len(points)
    if count < 2:
        return {"popularity_slope": None, "popularity_r": None, "popularity_slope_users": count}
    read_mean = sum(point[0] for point in points) / count
    listed_mean = sum(point[1] for point in points) / count
    covariance = sum((x - read_mean) * (y - listed_mean) for x, y in points)
    read_variance = sum((x - read_mean) ** 2 for x, y in points)
    listed_variance = sum((y - listed_mean) ** 2 for x, y in points)
    if read_variance <= 0:
        return {"popularity_slope": None, "popularity_r": None, "popularity_slope_users": count}
    slope = covariance / read_variance
    correlation = (
        covariance / math.sqrt(read_variance * listed_variance)
        if listed_variance > 0
        else None
    )
    return {
        "popularity_slope": slope,
        "popularity_r": correlation,
        "popularity_slope_users": count,
    }


def catalogue_coverage(distinct_items: int, catalogue_size: int) -> float | None:
    """Share of the catalogue that appeared in any reader's list.

        coverage = |distinct titles recommended across all readers| / |catalogue|

    Run-level rather than per-user: one reader's fifty titles say nothing about how much
    of the catalogue the engine is willing to reach across readers, which is what a
    complaint about the same titles recurring is about.

    None when the catalogue is empty.
    """
    if not catalogue_size:
        return None
    return distinct_items / catalogue_size


def gini(counts: Iterable[float]) -> float | None:
    """Gini coefficient of how often each recommended title was recommended.

        G = (2 * sum(i * x_i) - (n + 1) * sum(x_i)) / (n * sum(x_i))

    over x sorted ascending with i counting from 1. Zero means every served title was
    served equally often; values near 1 mean a handful of titles carry the whole run.

    Computed over the titles served at least once, not over the catalogue: how little of
    the catalogue is reached at all is what coverage reports, and including the unreached
    titles would hold the value against 1 whatever happened inside the served set.

    None when nothing was served, or when every count is zero.
    """
    values = sorted(float(count) for count in counts)
    n = len(values)
    total = sum(values)
    if not n or total <= 0:
        return None
    weighted = sum((position + 1) * value for position, value in enumerate(values))
    return (2 * weighted - (n + 1) * total) / (n * total)


async def load_tag_rollup(
    session: AsyncSession,
    depth: int = ROLLUP_DEPTH,
) -> dict[int, int]:
    """Map every tag onto the ancestor that stands for it `depth` levels below the roots.

    Raw tag ids are too sparse to compare two distributions built from a few dozen
    titles each: two lists can share a taste and still overlap on almost no individual
    tag, which leaves the divergence measuring sample size. Rolling up trades that
    precision for buckets both sides populate.

    Depth 1 is the level that carries taste. The roots are a handful of structural
    categories that nearly every tag falls under, so any two distributions built on them
    look alike. Their children are the genre, setting and character groupings a reader
    would name as taste, and there are a few dozen of them, which a fifty-title list
    populates densely. One level below that multiplies the buckets by an order of
    magnitude and puts them back out of reach of a list that size.

    The tag tree is a DAG, so a tag can descend from several ancestors at the chosen
    depth. The shallowest wins, and the lowest id among equally shallow ones, which
    makes the map identical on every run. A tag no root reaches stands for itself.
    """
    tag_ids = set((await session.execute(select(Tag.id))).scalars().all())
    edges = (await session.execute(select(TagParent.tag_id, TagParent.parent_id))).all()

    children: dict[int, list[int]] = {}
    with_parents: set[int] = set()
    for edge in edges:
        children.setdefault(edge.parent_id, []).append(edge.tag_id)
        with_parents.add(edge.tag_id)

    roots = sorted(tag_ids - with_parents)
    group: dict[int, int] = {root: root for root in roots}
    frontier = list(roots)
    level = 0
    while frontier:
        level += 1
        discovered: dict[int, int] = {}
        for node in frontier:
            for child in children.get(node, ()):
                if child in group:
                    continue
                # Above the cut a tag is its own bucket; below it, it inherits.
                candidate = child if level <= depth else group[node]
                previous = discovered.get(child)
                discovered[child] = (
                    candidate if previous is None else min(previous, candidate)
                )
        group.update(discovered)
        frontier = sorted(discovered)

    for tag_id in tag_ids:
        group.setdefault(tag_id, tag_id)
    return group


class TagGroupProfiles:
    """Per-title tag-group distributions, loaded once per title and reused all run.

    A title's distribution is its tag scores summed per rolled-up group and normalised,
    so a strongly applied tag counts for more than an incidental one. Tag filters match
    the ones the engine scores through, so both sides of a calibration comparison are
    described by the tags the engine itself saw.

    Readers overlap heavily in what they have read, so the same titles are asked for
    again and again; the cache is what keeps calibration off the per-reader cost. Two
    readers scored concurrently can each load the same title once, which repeats a query
    and cannot produce a different distribution.
    """

    def __init__(self, rollup: dict[int, int], spoiler_level: int = 0):
        self._rollup = rollup
        self._spoiler_level = spoiler_level
        self._cache: dict[str, dict[int, float]] = {}

    @property
    def cached_titles(self) -> int:
        """Titles whose distribution is already held."""
        return len(self._cache)

    async def get(
        self,
        session: AsyncSession,
        vn_ids: Iterable[str],
    ) -> dict[str, dict[int, float]]:
        """Group distributions for the requested titles, loading whatever is not held.

        A title carrying no tags is cached as an empty distribution rather than being
        asked for again on the next reader who has read it.
        """
        wanted = set(vn_ids)
        missing = sorted(vn_id for vn_id in wanted if vn_id not in self._cache)
        if missing:
            rows = (
                await session.execute(
                    select(VNTag.vn_id, VNTag.tag_id, VNTag.score)
                    .where(in_ids(VNTag.vn_id, missing))
                    .where(VNTag.spoiler_level <= self._spoiler_level)
                    .where(VNTag.score > 0)
                    .where(VNTag.lie == False)  # noqa: E712  disputed tags
                )
            ).all()
            weights: dict[str, dict[int, float]] = {vn_id: {} for vn_id in missing}
            for row in rows:
                group = self._rollup.get(row.tag_id, row.tag_id)
                by_group = weights[row.vn_id]
                by_group[group] = by_group.get(group, 0.0) + float(row.score)
            for vn_id, by_group in weights.items():
                total = sum(by_group.values())
                self._cache[vn_id] = (
                    {group: weight / total for group, weight in by_group.items()}
                    if total
                    else {}
                )
        return {vn_id: self._cache[vn_id] for vn_id in wanted}


def calibration_kl(
    profile_vn_ids: Sequence[str],
    recommended: Sequence[str],
    k: int,
    group_dists: Mapping[str, Mapping[int, float]],
) -> float | None:
    """Divergence in bits from the reader's tag mix to the recommended one.

        p(g)  = mean over profile titles of that title's share of group g
        q(g)  = sum over the top-k of (1 / log2(rank + 1)) * share of g, normalised
        q~(g) = 0.99 * q(g) + 0.01 * p(g)
        calibration_kl = sum over g of p(g) * log2(p(g) / q~(g))

    Zero means the list is spread over the same kinds of title the reader already reads.
    A large value means it has drifted onto other ground, which is what a list assembled
    from what is popular rather than from what the reader likes does. Both sides are
    built over the shallow tag-tree rollup, not raw tag ids, for the reason given in
    load_tag_rollup.

    The rank discount weights the head of the list, which is the part a reader sees, and
    matches the discount the accuracy metrics apply.

    The mixture keeps the divergence finite. A group the reader has and the list does
    not would otherwise divide by zero, and one absent bucket would collapse the whole
    measure to infinity regardless of how the rest lines up. Mixing in the profile side
    rather than a flat floor keeps the correction proportional to how much of the
    reader's taste the missing bucket accounts for.

    None when either side has no tagged titles, which leaves nothing to compare.
    """
    profile: dict[int, float] = {}
    tagged = 0
    for vn_id in profile_vn_ids:
        dist = group_dists.get(vn_id) or {}
        if not dist:
            continue
        tagged += 1
        for group, share in dist.items():
            profile[group] = profile.get(group, 0.0) + share
    if not tagged:
        return None
    p = {group: weight / tagged for group, weight in profile.items()}

    listed: dict[int, float] = {}
    weight_total = 0.0
    for rank, vn_id in enumerate(recommended[:k], start=1):
        dist = group_dists.get(vn_id) or {}
        if not dist:
            continue
        weight = 1.0 / math.log2(rank + 1)
        weight_total += weight
        for group, share in dist.items():
            listed[group] = listed.get(group, 0.0) + weight * share
    if weight_total <= 0:
        return None
    q = {group: weight / weight_total for group, weight in listed.items()}

    divergence = 0.0
    for group, p_g in p.items():
        if p_g <= 0:
            continue
        q_tilde = CALIBRATION_MIX * q.get(group, 0.0) + (1.0 - CALIBRATION_MIX) * p_g
        divergence += p_g * math.log2(p_g / q_tilde)
    return divergence


@dataclass
class PopularityContext:
    """The run-level state every per-user popularity metric reads.

    Assembled once by load_popularity_context and handed to each reader's evaluation, so
    the catalogue is ranked and the tag tree walked one time per run.
    """

    index: PopularityIndex
    profiles: TagGroupProfiles
    k: int


async def load_popularity_context(
    session: AsyncSession,
    k: int,
    japanese_only: bool = True,
    spoiler_level: int = 0,
    rollup_depth: int = ROLLUP_DEPTH,
) -> PopularityContext:
    """Build the shared popularity state for one run.

    japanese_only and spoiler_level have to match what the run asks the engine for,
    otherwise the head boundary and the tag distributions describe a different
    population than the one being scored.
    """
    index = await load_popularity_index(session, japanese_only=japanese_only)
    rollup = await load_tag_rollup(session, depth=rollup_depth)
    return PopularityContext(
        index=index,
        profiles=TagGroupProfiles(rollup, spoiler_level=spoiler_level),
        k=k,
    )


def theta_suffix(theta: float) -> str:
    """Metric-name suffix naming a head cutoff."""
    return f"{round(theta * 100)}pct"


def pop_metric_names(k: int) -> tuple[str, ...]:
    """Per-user popularity metric keys, in report order."""
    names: list[str] = []
    for theta in HEAD_THETAS:
        names.append(f"tail_share@{k}_{theta_suffix(theta)}")
    for theta in HEAD_THETAS:
        names.append(f"tail_ndcg@{k}_{theta_suffix(theta)}")
    names.append(f"novelty@{k}")
    names.append(f"calibration_kl@{k}")
    # The two medians are reported beside the gap between them because the gap alone
    # does not say which side moved, and the run-level slope is fitted from these pairs.
    names.append("read_pop_median")
    names.append(f"rec_pop_median@{k}")
    names.append(f"popularity_gap@{k}")
    return tuple(names)


async def user_pop_metrics(
    session: AsyncSession,
    context: PopularityContext,
    profile_vn_ids: Sequence[str],
    recommended: Sequence[str],
    relevant: Iterable[str],
) -> dict[str, float | None]:
    """Every per-user popularity metric for one reader, keyed by pop_metric_names.

    One tag query per reader at worst, and none once the reader's titles are all cached.
    Values that do not exist for this reader come back as None; see the module docstring
    on why they must not be folded into an average as zero.
    """
    k = context.k
    index = context.index
    relevant = set(relevant)
    dists = await context.profiles.get(
        session, set(profile_vn_ids) | set(recommended[:k])
    )

    values: dict[str, float | None] = {}
    for theta in HEAD_THETAS:
        values[f"tail_share@{k}_{theta_suffix(theta)}"] = tail_share_at_k(
            recommended, k, index, theta
        )
    for theta in HEAD_THETAS:
        values[f"tail_ndcg@{k}_{theta_suffix(theta)}"] = tail_ndcg_at_k(
            recommended, relevant, k, index, theta
        )
    values[f"novelty@{k}"] = novelty_at_k(recommended, k, index)
    values[f"calibration_kl@{k}"] = calibration_kl(profile_vn_ids, recommended, k, dists)
    values["read_pop_median"] = median_log_popularity(profile_vn_ids, index)
    values[f"rec_pop_median@{k}"] = median_log_popularity(recommended[:k], index)
    values[f"popularity_gap@{k}"] = popularity_gap_at_k(
        profile_vn_ids, recommended, k, index
    )
    return values


def run_pop_stats(
    recommended_lists: Iterable[Sequence[str]],
    index: PopularityIndex,
    popularity_pairs: Iterable[tuple[float, float]] = (),
) -> dict:
    """Spread of the served lists over the catalogue, for the run as a whole.

    Counted over each reader's full list rather than a top-k prefix: the question is how
    much of the catalogue the engine is willing to serve at all, and truncating the
    lists answers a narrower one.

    popularity_pairs carries one (read median, rec median) point per reader the two are
    defined for; see popularity_slope for what is fitted from them. It belongs here
    rather than among the per-user metrics for the same reason coverage does: it
    describes how the engine treats readers who differ, which no single list shows.
    """
    counts: Counter[str] = Counter()
    for recommended in recommended_lists:
        counts.update(recommended)
    return {
        **popularity_slope(popularity_pairs),
        "catalogue_size": index.size,
        "distinct_items": len(counts),
        "recommendations_counted": sum(counts.values()),
        "coverage": catalogue_coverage(len(counts), index.size),
        "gini_recommended": gini(counts.values()),
        "novelty_reference_bits": index.reference_novelty_bits,
    }
