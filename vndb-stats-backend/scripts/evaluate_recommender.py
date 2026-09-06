#!/usr/bin/env python
"""Offline accuracy evaluation of the recommendation engine that is actually served.

WHAT IS MEASURED
    HybridRecommender.recommend(), instantiated and called exactly as the v2
    recommendations endpoint calls it: the profile is the user's Finished-and-voted
    titles, the exclusion set comes from compute_exclude_vn_ids over the same ulist
    labels, and every other argument keeps the endpoint's default. Nothing here scores
    a model the request path does not read.

HOLDOUT DESIGN
    Users with at least --min-rated rated-and-finished titles are sampled, their titles
    are ordered in time, and the most recent HOLDOUT_FRACTION of them become the ground
    truth. The rest are fed to the recommender as the profile. A time-ordered split
    mimics real use: the question is whether the engine would have suggested what the
    reader went on to read next. A random split leaks later taste into the profile and
    flatters the engine.

    Time field: ulist rows carry vote_date, finished, lastmod and added, none of them
    guaranteed. One field is chosen per user, the first of that order whose coverage
    over the user's rated-and-finished titles reaches MIN_TIME_FIELD_COVERAGE, so a
    single user's ordering never mixes two clocks. vote_date leads because the vote is
    the act being predicted; finished follows as the closest record of the reading
    itself; lastmod and added are weaker proxies and only used when nothing better
    covers the list. Rows null in the chosen field sort oldest, which keeps them in the
    profile and out of the ground truth: an unknown date cannot be evidence of
    recency. The coverage floor guarantees the holdout slice never reaches them. A user
    with no field above the floor is skipped and counted under skipped.

    The held-out titles are removed from the exclusion set before recommending. They
    stay eligible as candidates while being absent from the profile, which is the whole
    point of the exercise: leaving them excluded would return zero on every metric. The
    split asserts both halves of that invariant per user, and the first --probe-users
    users additionally have the candidate pool inspected directly, so a wiring change
    that makes ground truth unreachable fails loudly instead of reporting zeros. The
    probe reports the share of reachable ground truth the pool held rather than a count
    of it, since a count rises with the sample and compares between runs of one size
    only. --probe-users 0 turns it off, and the number probed is recorded so a stored
    result says whether it ran.

    Ground truth is restricted to titles the engine is able to return at all, meaning
    present in visual_novels and, while japanese_only holds, Japanese-original. Titles
    outside that set are unreachable by construction and would only add noise
    proportional to how many of them a user reads. The count dropped this way is
    reported.

    --exclude-related takes this further: titles related to the profile leave the
    ground truth too, on the run it is passed to and on that run's control alike, so the
    two are still asked about the same set of readable titles. Related titles are also
    the most predictable next reads a reader has, so a run under the mode reports lower
    absolute figures than one without it and the two are not comparable side by side; the
    flag sits under the paired-comparison guard for that reason. dropped_related in
    ground_truth_titles counts how many held-out titles this removed, taken before the
    reachability filter above, so the count can include a title that was unreachable
    regardless.

READ-ONLY
    Nothing here writes. recommend() issues only SELECTs; the cache write on the served
    path lives in the API layer, dispatched with asyncio.create_task after the call
    returns, so it is not reached from here. User lists are read straight from
    ulist_vns and ulist_labels rather than through UserService.get_user_list, which
    would populate Redis and make a username API call. Each session additionally asks
    Postgres for a read-only transaction where the server accepts it, and sessions are
    short-lived so a long run cannot park an idle transaction on the pool.

RESULTS
    Reported overall and sliced into three profile-size buckets, so a change that helps
    heavy readers while hurting light ones stays visible instead of averaging out. JSON
    lands in scripts/eval_results/.

    Two runs are compared per reader, never as two means: the spread between readers
    dwarfs the spread between two rankings of one reader. --compare joins the per-user
    blocks of both documents on uid and reports, per metric, the mean per-reader
    difference with a bootstrap interval, the paired t-test behind the decision, how many
    readers moved at all, and the effect the achieved sample could have detected. See
    rec_paired_stats.

PAGE SIZE
    --limit is the page the engine is asked for, and the three surfaces that ask for one
    ask for three different sizes: this harness defaults to the smallest, the
    recommendations page requests the middle one, and the precompute job that fills the
    cache the largest. Every stored number therefore describes the narrowest of the
    three. The default is held where it is so stored results stay comparable to each
    other, and the value it was run at is printed in the run banner and in every
    comparison. How much ground truth the pool can reach differs substantially between
    the three, so a held-out title ranked past the end of this page is a miss here and a
    hit on the served one.

POPULARITY
    A second table reports what the accuracy metrics cannot see. Held-out titles are
    what readers read, and readers concentrate on well-known titles, so the accuracy
    numbers above rise whenever a list leans harder on consensus. Judging a scoring
    change on them alone selects for popularity. The popularity metrics come from
    rec_pop_metrics and are aggregated separately, since each of them is undefined
    rather than zero for some readers.

    The run-level popularity slope under that table answers a question none of the
    per-reader numbers can: whether readers who read at different levels of popularity
    are served at different levels. A list can be well calibrated on tags for every
    reader and still place all of them on the same stretch of the popularity range.

DETERMINISM
    --seed fixes the user sample given the same eligible population. Two draws of
    different size under one seed are not independent of each other: where the eligible
    population is large against both sizes the sampler consumes the same random draws in
    the same order, so the smaller sample is a prefix of the larger one and every reader
    of a small run also appears in a larger one. That is a property of the sampler's
    implementation rather than a guarantee, and it lapses where the two sizes take
    different branches of it, so the overlap between two runs is measured per comparison
    and never assumed. Runs of different size consequently pair over the readers they
    share while their run-level means still cover two different reader sets, which is why
    --compare withholds the mean tables unless both runs cover the same readers exactly.

    Candidate selection inside the engine is itself deterministic for a fixed profile, so
    two runs of an unchanged engine over the same sample report identical metrics, and any
    movement is a real effect of whatever changed. The eligible population moves when a new
    dump lands, so a baseline taken before an import is not strictly comparable to one
    taken after.

WHAT THESE NUMBERS CANNOT TELL YOU
    Some of what the engine scores against has already seen the held-out votes and some
    of it has not, and the two are worth keeping apart.

    vn_similarities carries no rating data. compute_tag_vectors builds a tag vector per
    title out of the tag tables alone, and compute_vn_similarities compares those vectors
    against each other, so the similar-games signal is a statement about tags and cannot
    have read the answer. The tag, entity and trait signals read the same kind of source.

    vn_cooccurrence is built from the vote table, the sampled reader's held-out votes
    included, so the users-also-read signal does read a table that has already seen the
    answer, and it is among the heaviest signals.

    Title-level vote aggregates leak the same way. average_rating and votecount arrive
    from the dump as aggregates over every vote cast: average_rating feeds the quality
    signal and the exploration gate, and votecount decides the popularity bands the
    calibration matches a reader against. A held-out title is fractionally better rated
    and better known here than it was before the reader voted on it.

    Rebuilding any of that per evaluated reader is the only honest fix and costs more
    than the exercise is worth, so the leaking figures are useful for comparing one run
    of this script against another and worthless as an absolute claim or against any
    published benchmark.

RUNTIME
    One recommend() call per user, several seconds each against a local database, and
    slower the larger the profile. --fast targets a few minutes at the default
    concurrency and --full a long run; both log a running rate, and the report records
    the measured seconds per user. Sampling opens with one aggregate over the whole list
    table, which pauses before any user is scored.

SCORING SWITCHES
    The engine's scoring variants are environment switches. --switch NAME=VALUE sets one
    for the run, so a configuration is chosen per run rather than by editing the engine.
    The configuration travels in the result document: a stored number whose configuration
    is not recorded alongside it cannot be compared to anything.

    A switch does not stay at the value it was introduced with. Defaults move as variants
    are adopted, so an unswitched run today is not the control that an unswitched run was
    when an older baseline was stored, and reproducing a stored baseline means setting
    the switches recorded in that document's switches.effective block rather than running
    bare. --compare prints every switch the two runs disagree on, and every switch one of
    them records and the other does not, ahead of any delta.

    Two kinds of switch need care beyond that. Those in UNMEASURABLE_SWITCHES are read by
    the engine off an input this harness does not supply, so setting one moves nothing
    measurable while still appearing in the recorded configuration, and the run refuses
    rather than report control numbers under a switched label. Popularity calibration is
    coupled: any positive value also turns on relevance normalisation inside the re-rank
    whether or not the normalisation switch is set, so a run that sets one and not the
    other is warned about what is actually in effect.

Usage:
    python scripts/evaluate_recommender.py --fast
    python scripts/evaluate_recommender.py --full --label baseline
    python scripts/evaluate_recommender.py --fast --compare scripts/eval_results/<file>.json
    python scripts/evaluate_recommender.py --fast --switch REC_ENTITY_DESATURATION=1
    python scripts/local/paired_eval_compare.py <before>.json <after>.json
"""

import argparse
import asyncio
import json
import logging
import os
import random
import re
import sys
import time
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from pathlib import Path

# Backend root for app imports, script directory for the shared metrics module
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))


def collect_switch_overrides(argv: list[str]) -> dict[str, str]:
    """Read every --switch NAME=VALUE out of the argument list into the environment.

    Runs before the engine is imported, because the engine binds its switches at import:
    setting them after that point would leave the run reporting a configuration it did
    not use. That is ahead of argparse, so the flag is picked out of the raw arguments
    here; parse_args declares it too and is what reports a malformed one.
    """
    assignments: list[str] = []
    for index, token in enumerate(argv):
        if token == "--switch" and index + 1 < len(argv):
            assignments.append(argv[index + 1])
        elif token.startswith("--switch="):
            assignments.append(token.split("=", 1)[1])

    overrides: dict[str, str] = {}
    for assignment in assignments:
        if "=" not in assignment:
            continue
        name, value = assignment.split("=", 1)
        name, value = name.strip(), value.strip()
        if not name:
            continue
        overrides[name] = value
        os.environ[name] = value
    return overrides


SWITCH_OVERRIDES = collect_switch_overrides(sys.argv[1:])

from sqlalchemy import and_, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import async_session
from app.db.models import UlistLabel, UlistVN, VisualNovel
from app.db.query_utils import in_ids
from app.services import hybrid_recommender as engine
from app.services.hybrid_recommender import HybridRecommender, switch_settings
from app.services.recommendation_filters import LABEL_FINISHED, compute_exclude_vn_ids
from app.services.recommendation_relations import related_to
from app.services.user_service import UserService
from rec_metrics import hit_at_k, mrr_at_k, ndcg_at_k, precision_at_k, recall_at_k
from rec_paired_stats import print_paired_comparison, refuse_mean_tables
from rec_pop_metrics import (
    HEAD_THETAS,
    ROLLUP_DEPTH,
    PopularityContext,
    load_popularity_context,
    pop_metric_names,
    run_pop_stats,
    user_pop_metrics,
)

logger = logging.getLogger("evaluate_recommender")

DEFAULT_SEED = 42

# Sample sizes per mode. Fast trades confidence interval for turnaround.
FAST_USERS = 200
FULL_USERS = 2000

HOLDOUT_FRACTION = 0.2

# Ordering fields in preference order, and the share of a user's rated-and-finished
# titles one of them must cover before it may order that user's split.
TIME_FIELDS = ("vote_date", "finished", "lastmod", "added")
MIN_TIME_FIELD_COVERAGE = 0.8

# Profile-size buckets, by rated-and-finished count before the split.
BUCKET_SMALL_MAX = 49
BUCKET_MEDIUM_MAX = 199
BUCKET_NAMES = ("small", "medium", "large")

# Reported metrics, each as (name, function, cutoff).
METRIC_SPECS = (
    ("ndcg@10", ndcg_at_k, 10),
    ("recall@20", recall_at_k, 20),
    ("mrr@10", mrr_at_k, 10),
    ("precision@10", precision_at_k, 10),
    ("hit@10", hit_at_k, 10),
)

# Cutoff for the popularity metrics. Held at the accuracy metrics' cutoff so the two
# tables describe the same slice of the list; run-level spread is counted over the whole
# list instead, since that question is about what the engine ever serves.
POP_K = 10
POP_METRIC_NAMES = pop_metric_names(POP_K)

# Users are prepared and scored in batches so that neither the ulist rows nor the
# per-user results of a full run have to be held all at once.
BATCH_USERS = 100
PROGRESS_EVERY = 25

# The engine widens its own candidate request by this factor; the pool probe mirrors it
# to inspect the same set the scored run sees. Used only where the engine does not
# publish a value of its own.
CANDIDATE_LIMIT_FACTOR = 5

# Users whose candidate pool is inspected, per mode. The probe answers whether the
# holdout is reachable at all, which a subsample settles as well as the whole sample
# does, so it is held well below the sample size on both modes.
PROBE_USERS_FAST = 20
PROBE_USERS_FULL = 50

# Probe slots that must have settled, whether the probe returned or raised, before an
# empty result can abort the run. Counting settled slots rather than returned ones keeps
# the check live in the case it exists for, where every probe raises.
PROBE_ABORT_MIN_USERS = 5

# Switches the engine reads off an input this harness does not supply, each with the
# reason it cannot be measured here. Setting one moves nothing the harness computes while
# still appearing in the recorded configuration, so a run would report control numbers
# under a switched label. A switch stays on this list only while the gap is structural:
# supplying the input the engine reads is what removes an entry, not deleting it.
UNMEASURABLE_SWITCHES = {
    "REC_UNRATED_AS_EVIDENCE": (
        "reads the unrated part of the user profile, which the served endpoint builds "
        "from the whole list and build_split here builds for itself out of rated votes"
    ),
    "REC_UNRATED_EVIDENCE_SCORE": (
        "scores the unrated part of the user profile, which the served endpoint builds "
        "from the whole list and build_split here builds for itself out of rated votes"
    ),
    "REC_PER_USER_WEIGHTS_USE_DROPPED": (
        "reads the reader's dropped titles, which the served endpoint passes to "
        "recommend() as negative evidence and the calls here leave unset"
    ),
}

OUT_DIR = Path(__file__).resolve().parent / "eval_results"


@dataclass
class UserSplit:
    """One user's time-ordered profile/ground-truth split."""

    uid: str
    rated_total: int
    time_field: str
    train_votes: list[dict]
    holdout: set[str]
    ground_truth: set[str] = field(default_factory=set)
    exclude_vn_ids: set[str] = field(default_factory=set)
    related_ids: set[str] = field(default_factory=set)
    unreachable_truth: int = 0


@dataclass
class UserResult:
    """Metrics for one evaluated user."""

    uid: str
    bucket: str
    rated_total: int
    ground_truth: int
    returned: int
    metrics: dict[str, float]
    pop_metrics: dict[str, float | None] = field(default_factory=dict)
    # Kept in rank order. The run-level popularity figures are about how the served
    # lists overlap across readers, which cannot be recovered from per-user means.
    recommended: list[str] = field(default_factory=list)


def bucket_for(rated_total: int) -> str:
    """Profile-size bucket a user falls in."""
    if rated_total <= BUCKET_SMALL_MAX:
        return "small"
    if rated_total <= BUCKET_MEDIUM_MAX:
        return "medium"
    return "large"


def time_value(entry: UlistVN, field_name: str) -> float | None:
    """Comparable value of one ordering field, or None when the row does not carry it."""
    raw = getattr(entry, field_name, None)
    if raw is None:
        return None
    if isinstance(raw, date):
        return float(raw.toordinal())
    return float(raw)


def choose_time_field(entries: list[UlistVN]) -> str | None:
    """First ordering field covering enough of a user's titles to sort them by."""
    total = len(entries)
    if not total:
        return None
    for field_name in TIME_FIELDS:
        covered = sum(1 for entry in entries if time_value(entry, field_name) is not None)
        if covered / total >= MIN_TIME_FIELD_COVERAGE:
            return field_name
    return None


def build_split(
    uid: str,
    entries: list[UlistVN],
    label_rows: list[UlistLabel],
    user_service: UserService,
    exclude_blacklist: bool,
) -> tuple[UserSplit | None, str]:
    """Split one user into profile and ground truth, or report why it was skipped.

    The profile and exclusion set are built the way the served endpoint builds them:
    votes filtered to the Finished label, exclusions from compute_exclude_vn_ids.
    """
    processed = user_service._process_local_user_list(entries, label_rows)
    labels = processed["labels"]
    finished_vn_ids = set(labels.get(LABEL_FINISHED, []))
    votes = [v for v in processed["votes"] if v["vn_id"] in finished_vn_ids]
    if not votes:
        return None, "no_rated_finished"

    by_vid = {entry.vid: entry for entry in entries}
    rated_entries = [by_vid[v["vn_id"]] for v in votes if v["vn_id"] in by_vid]
    if len(rated_entries) != len(votes):
        return None, "missing_list_row"

    time_field = choose_time_field(rated_entries)
    if time_field is None:
        return None, "no_time_field"

    # Rows null in the chosen field sort oldest, so they can only land in the profile.
    # The vid tiebreak keeps equal timestamps in a stable order across runs.
    def sort_key(vote: dict) -> tuple[int, float, str]:
        value = time_value(by_vid[vote["vn_id"]], time_field)
        if value is None:
            return (0, 0.0, vote["vn_id"])
        return (1, value, vote["vn_id"])

    ordered = sorted(votes, key=sort_key)
    n_holdout = max(1, int(len(ordered) * HOLDOUT_FRACTION))
    train_votes = ordered[:-n_holdout]
    holdout = {v["vn_id"] for v in ordered[-n_holdout:]}
    if not train_votes:
        return None, "profile_empty_after_split"

    exclude_all = compute_exclude_vn_ids(labels, exclude_blacklist=exclude_blacklist)
    exclude_vn_ids = exclude_all - holdout

    train_ids = {v["vn_id"] for v in train_votes}
    assert not (holdout & exclude_vn_ids), (
        f"{uid}: held-out titles must stay in the candidate pool, "
        "otherwise every metric is trivially zero"
    )
    assert not (holdout & train_ids), f"{uid}: held-out titles must not be in the profile"

    return (
        UserSplit(
            uid=uid,
            rated_total=len(ordered),
            time_field=time_field,
            train_votes=train_votes,
            holdout=holdout,
            exclude_vn_ids=exclude_vn_ids,
        ),
        "",
    )


async def load_batch_splits(
    session: AsyncSession,
    uids: list[str],
    args: argparse.Namespace,
    skipped: dict[str, int],
    truth_stats: dict[str, int],
) -> list[UserSplit]:
    """Load one batch of users and build their splits, ground truth included.

    `skipped` and `truth_stats` accumulate across batches.
    """
    user_service = UserService(session)

    entry_rows = (
        await session.execute(select(UlistVN).where(in_ids(UlistVN.uid, uids)))
    ).scalars().all()
    label_rows = (
        await session.execute(select(UlistLabel).where(in_ids(UlistLabel.uid, uids)))
    ).scalars().all()

    entries_by_uid: dict[str, list[UlistVN]] = {}
    for entry in entry_rows:
        entries_by_uid.setdefault(entry.uid, []).append(entry)
    labels_by_uid: dict[str, list[UlistLabel]] = {}
    for label_row in label_rows:
        labels_by_uid.setdefault(label_row.uid, []).append(label_row)

    splits: list[UserSplit] = []
    for uid in uids:
        entries = entries_by_uid.get(uid, [])
        if not entries:
            skipped["no_list_rows"] = skipped.get("no_list_rows", 0) + 1
            continue
        split, reason = build_split(
            uid=uid,
            entries=entries,
            label_rows=labels_by_uid.get(uid, []),
            user_service=user_service,
            exclude_blacklist=args.exclude_blacklist,
        )
        if split is None:
            skipped[reason] = skipped.get(reason, 0) + 1
            continue
        splits.append(split)

    if args.exclude_related:
        await drop_related_truth(session, splits, truth_stats)

    await attach_ground_truth(session, splits, japanese_only=args.japanese_only)

    reachable: list[UserSplit] = []
    for split in splits:
        truth_stats["holdout_titles"] = truth_stats.get("holdout_titles", 0) + len(split.holdout)
        truth_stats["dropped_unreachable"] = (
            truth_stats.get("dropped_unreachable", 0) + split.unreachable_truth
        )
        if not split.ground_truth:
            skipped["no_reachable_ground_truth"] = skipped.get("no_reachable_ground_truth", 0) + 1
            continue
        reachable.append(split)
    return reachable


async def drop_related_truth(
    session: AsyncSession,
    splits: list[UserSplit],
    truth_stats: dict[str, int],
) -> None:
    """Take titles related to the profile out of the holdout, without touching exclusions.

    Under the relation exclusion the engine cannot return a title related to anything the
    reader has read, so leaving such a title in the ground truth scores the engine on a
    question it is forbidden to answer. The related set is recorded on the split rather
    than folded into exclude_vn_ids: recommend() widens the exclusion set from votes plus
    exclusions by itself when the switch is on, and adding the same relations here first
    would widen a second hop past what the served engine ever excludes. exclusions_for_
    engine below is what actually decides what the engine is handed.
    """
    for split in splits:
        read_ids = {v["vn_id"] for v in split.train_votes} | split.exclude_vn_ids
        related = await related_to(session, read_ids)
        split.related_ids = related
        dropped = split.holdout & related
        split.holdout -= dropped
        truth_stats["dropped_related"] = truth_stats.get("dropped_related", 0) + len(dropped)


def exclusions_for_engine(split: UserSplit) -> set[str]:
    """What the engine is handed as its exclusion set for this reader.

    Under the relation switch the engine widens the set itself from the same read set, so
    it receives the raw exclusions; handing it the widened set as well would reach two
    hops. Off, the harness widens instead, so a control run is asked the same question.
    """
    if engine.RELATION_EXCLUSION:
        return set(split.exclude_vn_ids)
    return split.exclude_vn_ids | split.related_ids


async def attach_ground_truth(
    session: AsyncSession,
    splits: list[UserSplit],
    japanese_only: bool,
) -> None:
    """Reduce each holdout to the titles the engine is able to return."""
    wanted: set[str] = set()
    for split in splits:
        wanted |= split.holdout
    if not wanted:
        return

    rows = (
        await session.execute(
            select(VisualNovel.id, VisualNovel.olang, VisualNovel.devstatus).where(
                in_ids(VisualNovel.id, wanted)
            )
        )
    ).all()
    # The engine never returns an unfinished title, so a held-out one of those would
    # score a question the engine cannot answer, not a miss.
    eligible = {
        row.id
        for row in rows
        if (not japanese_only or row.olang == "ja") and row.devstatus == 0
    }

    for split in splits:
        split.ground_truth = split.holdout & eligible
        split.unreachable_truth = len(split.holdout) - len(split.ground_truth)


async def mark_read_only(session: AsyncSession) -> None:
    """Ask Postgres to refuse writes on this transaction where it accepts the request."""
    try:
        await session.execute(text("SET TRANSACTION READ ONLY"))
    except Exception as exc:
        # A server that will not take the hint still sees no write from this script.
        logger.debug(f"Read-only transaction not set: {exc}")
        await session.rollback()


def candidate_limit_factor() -> int:
    """How much wider than a page the engine asks for candidates.

    Read from the engine's own settings rather than copied, since the factor is a switch
    and a probe scoring a differently sized pool than the run describes nothing.
    """
    return int(switch_settings().get("REC_CANDIDATE_LIMIT_FACTOR", CANDIDATE_LIMIT_FACTOR))


async def probe_candidate_pool(
    recommender: HybridRecommender,
    split: UserSplit,
    args: argparse.Namespace,
) -> tuple[int, int]:
    """Ground-truth titles in the engine's candidate pool for one user, and how many
    were reachable.

    Every argument recommend() passes to candidate selection is passed here too,
    including the filter spec and the pool target, so the probe describes the pool that
    was actually scored rather than a differently built one. It confirms the exclusion
    wiring rather than measuring quality: a pool that never contains ground truth caps
    every metric at zero regardless of scoring.

    Returned as a pair so the run can report a recall. A raw hit count rises with the
    sample and with how much each reader held out, and compares between two runs only
    when both of those match.
    """
    profile = await recommender._build_user_profile(
        split.train_votes, spoiler_level=args.spoiler_level
    )
    # Routed through the engine's own widening so the probe inspects the pool the scored
    # call actually sees, in every flag/switch combination.
    exclusions = await recommender._exclusions_with_relations(
        split.train_votes, exclusions_for_engine(split)
    )
    candidates = await recommender._get_candidates(
        exclude_vn_ids=exclusions,
        min_rating=None,
        min_length=None,
        max_length=None,
        include_tags=None,
        exclude_tags=None,
        include_traits=None,
        exclude_traits=None,
        limit=args.limit * candidate_limit_factor(),
        high_rated_vns=profile.get("high_rated_vns", []),
        elite_tag_ids=profile.get("elite_tag_ids"),
        japanese_only=args.japanese_only,
        spoiler_level=args.spoiler_level,
        # The scored call carries no filter spec of its own and stops widening once the
        # pool reaches a page, and both decide what the pool ends up holding.
        filters=None,
        target_pool=args.limit,
    )
    candidate_ids = {candidate["id"] for candidate in candidates}
    return len(candidate_ids & split.ground_truth), len(split.ground_truth)


async def evaluate_user(
    split: UserSplit,
    args: argparse.Namespace,
    probe: bool,
    pop_context: PopularityContext,
) -> tuple[UserResult, tuple[int, int] | None]:
    """Score one user against their held-out titles.

    Returns the metrics and, when probed, how many held-out titles the candidate pool
    held for this user against how many it could have held.
    """
    async with async_session() as session:
        await mark_read_only(session)
        recommender = HybridRecommender(session)

        probe_hits = None
        if probe:
            probe_hits = await probe_candidate_pool(recommender, split, args)

        exclusions = exclusions_for_engine(split)
        assert not (split.holdout & exclusions), (
            f"{split.uid}: held-out titles must stay reachable under the exclusion set "
            "the engine is actually handed"
        )
        results = await recommender.recommend(
            user_votes=split.train_votes,
            exclude_vn_ids=exclusions,
            limit=args.limit,
            min_rating=None,
            min_length=None,
            max_length=None,
            include_tags=None,
            exclude_tags=None,
            include_traits=None,
            exclude_traits=None,
            skip_details=True,
            japanese_only=args.japanese_only,
            spoiler_level=args.spoiler_level,
            reader_id=split.uid,
        )

        recommended = [r.vn_id for r in results]
        # Calibration reads tag distributions, which are cached across readers, so a
        # title costs one query however many of them have read it.
        pop_metrics = await user_pop_metrics(
            session=session,
            context=pop_context,
            profile_vn_ids=[vote["vn_id"] for vote in split.train_votes],
            recommended=recommended,
            relevant=split.ground_truth,
        )

    metrics = {
        name: float(fn(recommended, split.ground_truth, k)) for name, fn, k in METRIC_SPECS
    }
    return (
        UserResult(
            uid=split.uid,
            bucket=bucket_for(split.rated_total),
            rated_total=split.rated_total,
            ground_truth=len(split.ground_truth),
            returned=len(recommended),
            metrics=metrics,
            pop_metrics=pop_metrics,
            recommended=recommended,
        ),
        probe_hits,
    )


async def sample_users(session: AsyncSession, args: argparse.Namespace) -> list[str]:
    """Draw the seeded user sample from everyone with enough rated-and-finished titles."""
    stmt = (
        select(UlistVN.uid, func.count().label("rated"))
        .join(
            UlistLabel,
            and_(UlistLabel.uid == UlistVN.uid, UlistLabel.vid == UlistVN.vid),
        )
        .where(UlistLabel.label == int(LABEL_FINISHED))
        .where(UlistVN.vote.isnot(None))
        .group_by(UlistVN.uid)
        .having(func.count() >= args.min_rated)
    )
    # One aggregate over the whole list table, so this pauses before anything is scored.
    logger.info("Scanning list data for eligible users")
    rows = (await session.execute(stmt)).all()

    # Sorting before sampling makes the draw depend on the seed and the eligible
    # population only, not on the order Postgres happened to return groups in.
    eligible = sorted(row.uid for row in rows)
    logger.info(f"Eligible users with {args.min_rated}+ rated finished titles: {len(eligible):,}")
    if not eligible:
        return []

    rng = random.Random(args.seed)
    return rng.sample(eligible, k=min(args.users, len(eligible)))


def aggregate(results: list[UserResult]) -> dict[str, float]:
    """Mean of every metric over a set of users."""
    if not results:
        return {name: 0.0 for name, _, _ in METRIC_SPECS}
    return {
        name: sum(r.metrics[name] for r in results) / len(results)
        for name, _, _ in METRIC_SPECS
    }


def aggregate_pop(results: list[UserResult]) -> dict[str, dict]:
    """Mean of every popularity metric over the users it is defined for.

    Deliberately not part of aggregate(). An accuracy metric is zero for a user the
    engine failed, which is the right score; a popularity metric is absent for such a
    user, and folding that absence in as zero reports a maximally popular, maximally
    miscalibrated list. Every value here is therefore averaged over its own set of
    users, and how many that was travels with it: a mean over a handful of readers is
    not the same claim as one over the sample.
    """
    metrics: dict[str, float | None] = {}
    defined: dict[str, int] = {}
    for name in POP_METRIC_NAMES:
        values = [
            value for value in (r.pop_metrics.get(name) for r in results)
            if value is not None
        ]
        defined[name] = len(values)
        metrics[name] = sum(values) / len(values) if values else None
    return {"metrics": metrics, "defined_users": defined}


def popularity_pairs(results: list[UserResult]) -> list[tuple[float, float]]:
    """One (read median, rec median) point per reader both are defined for.

    Read off the per-user metrics rather than recomputed, so the run-level fit and the
    per-user table describe the same numbers.
    """
    read_name = "read_pop_median"
    rec_name = f"rec_pop_median@{POP_K}"
    pairs = []
    for result in results:
        read = result.pop_metrics.get(read_name)
        listed = result.pop_metrics.get(rec_name)
        if read is None or listed is None:
            continue
        pairs.append((read, listed))
    return pairs


def build_payload(
    args: argparse.Namespace,
    timestamp: datetime,
    sampled: int,
    results: list[UserResult],
    skipped: dict[str, int],
    truth_stats: dict[str, int],
    probe: dict,
    pop_context: PopularityContext,
    runtime_seconds: float,
) -> dict:
    """Assemble the result document from values decided by the caller."""
    buckets = {}
    for name in BUCKET_NAMES:
        members = [r for r in results if r.bucket == name]
        buckets[name] = {
            "users": len(members),
            "metrics": aggregate(members),
            "pop": aggregate_pop(members),
        }

    empty_results = sum(1 for r in results if r.returned == 0)
    return {
        "label": args.label,
        "mode": args.mode,
        "seed": args.seed,
        "timestamp": timestamp.isoformat(),
        # What was asked for and what the engine bound. They differ when a name is
        # misspelled or belongs to no switch, which is otherwise invisible: the run
        # completes and reports the unswitched numbers under the switched label.
        "switches": {
            "requested": dict(sorted(SWITCH_OVERRIDES.items())),
            "effective": switch_settings(),
        },
        "users": {
            "requested": args.users,
            "sampled": sampled,
            "evaluated": len(results),
            "skipped": dict(sorted(skipped.items())),
        },
        "config": {
            "min_rated": args.min_rated,
            "holdout_fraction": HOLDOUT_FRACTION,
            "limit": args.limit,
            "japanese_only": args.japanese_only,
            "exclude_blacklist": args.exclude_blacklist,
            "exclude_related": args.exclude_related,
            "spoiler_level": args.spoiler_level,
            "concurrency": args.concurrency,
            # Recorded so a stored probe of zero can be read as "not run" rather than as
            # a pool that held nothing.
            "probe_users": args.probe_users,
            "min_time_field_coverage": MIN_TIME_FIELD_COVERAGE,
            "bucket_bounds": {
                "small_max": BUCKET_SMALL_MAX,
                "medium_max": BUCKET_MEDIUM_MAX,
            },
        },
        "overall": {
            "users": len(results),
            "metrics": aggregate(results),
            "pop": aggregate_pop(results),
        },
        "buckets": buckets,
        # Run-level rather than per-user: how much of the catalogue is reached, how
        # evenly, and how much of a reader's own popularity level survives into their
        # list, are all statements about the served lists taken together.
        "popularity": {
            "k": POP_K,
            "head_thetas": list(HEAD_THETAS),
            "rollup_depth": ROLLUP_DEPTH,
            **run_pop_stats(
                (r.recommended for r in results),
                pop_context.index,
                popularity_pairs=popularity_pairs(results),
            ),
        },
        # Per user, so two runs over the same sample can be compared as paired observations.
        # A difference in means says nothing on its own here: the spread between readers
        # dwarfs the spread between two rankings of the same reader, and only the per-reader
        # difference separates a real change from the sample.
        "per_user": sorted(
            (
                {
                    "uid": r.uid,
                    "bucket": r.bucket,
                    "rated_total": r.rated_total,
                    "ground_truth": r.ground_truth,
                    "returned": r.returned,
                    "metrics": {k: round(v, 6) for k, v in r.metrics.items()},
                    "pop_metrics": {
                        k: (None if v is None else round(v, 6))
                        for k, v in r.pop_metrics.items()
                    },
                }
                for r in results
            ),
            key=lambda row: row["uid"],
        ),
        "diagnostics": {
            "runtime_seconds": round(runtime_seconds, 1),
            "seconds_per_user": round(runtime_seconds / len(results), 2) if results else None,
            "mean_ground_truth_size": (
                round(sum(r.ground_truth for r in results) / len(results), 2) if results else None
            ),
            "ground_truth_titles": dict(sorted(truth_stats.items())),
            "users_with_no_recommendations": empty_results,
            "candidate_pool_probe": probe,
            # Titles whose tag distribution was loaded at all. Against the number of
            # users, it says how much of the calibration cost the cache absorbed.
            "tag_profiles_cached": pop_context.profiles.cached_titles,
        },
    }


def write_payload(payload: dict, timestamp: datetime, label: str, mode: str) -> Path:
    """Write the result document under eval_results and return its path."""
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    slug = re.sub(r"[^a-z0-9]+", "-", label.lower()).strip("-") or "run"
    path = OUT_DIR / f"{timestamp.strftime('%Y%m%dT%H%M%SZ')}_{mode}_{slug}.json"
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return path


def print_metrics(payload: dict) -> None:
    """Print the overall and per-bucket metric tables."""
    print()
    print("=" * 72)
    print(f"HYBRID RECOMMENDER EVALUATION  [{payload['label']}]")
    print("=" * 72)
    overall = payload["overall"]
    config = payload.get("config", {})
    print(f"Users evaluated: {overall['users']:,}   mode={payload['mode']}   seed={payload['seed']}")
    # The page size decides what a metric can reach, and the three surfaces that ask the
    # engine for a page ask for three different sizes, so it belongs beside the numbers.
    print(
        f"Page size: limit={config.get('limit')}   min_rated={config.get('min_rated')}   "
        f"japanese_only={config.get('japanese_only')}"
    )
    probe = payload.get("diagnostics", {}).get("candidate_pool_probe", {})
    if probe.get("users"):
        recall = format_value(probe.get("pool_recall"), width=1).strip()
        print(
            f"Candidate pool held {recall} of reachable ground truth "
            f"over {probe['users']:,} probed readers "
            f"({probe.get('ground_truth_in_pool', 0):,} of "
            f"{probe.get('reachable_ground_truth', 0):,} titles)."
        )
    else:
        print("Candidate pool probe did not run, so pool reachability is unverified.")
    effective = payload.get("switches", {}).get("effective", {})
    if effective:
        print("Switches: " + "  ".join(f"{name}={value}" for name, value in effective.items()))
    print()
    header = f"{'Slice':<10} {'Users':>7}"
    for name, _, _ in METRIC_SPECS:
        header += f"{name:>13}"
    print(header)
    print("-" * len(header))

    def row(name: str, block: dict) -> str:
        line = f"{name:<10} {block['users']:>7,}"
        for metric_name, _, _ in METRIC_SPECS:
            # A slice nobody fell into has no score; a zero there reads as a bad score.
            if block["users"]:
                line += f"{block['metrics'][metric_name]:>13.4f}"
            else:
                line += f"{'-':>13}"
        return line

    print(row("overall", overall))
    for bucket_name in BUCKET_NAMES:
        print(row(bucket_name, payload["buckets"][bucket_name]))
    print("-" * len(header))
    print(
        f"Buckets by rated-and-finished count: small <= {BUCKET_SMALL_MAX}, "
        f"medium <= {BUCKET_MEDIUM_MAX}, large above."
    )


def format_value(value: float | None, width: int = 11, places: int = 4) -> str:
    """Right-aligned number, or a dash where the metric has no value."""
    if value is None:
        return f"{'-':>{width}}"
    return f"{value:>{width}.{places}f}"


def print_pop_metrics(payload: dict) -> None:
    """Print the popularity table, transposed so metric names have room."""
    pop = payload.get("popularity", {})
    print()
    print("=" * 72)
    print(f"POPULARITY PROFILE  (top-{pop.get('k', POP_K)} of each list)")
    print("=" * 72)

    slices = [("overall", payload["overall"])] + [
        (name, payload["buckets"][name]) for name in BUCKET_NAMES
    ]
    header = f"{'Metric':<20}"
    for name, _ in slices:
        header += f"{name:>11}"
    header += f"{'users':>8}"
    print(header)
    print("-" * len(header))

    for metric_name in POP_METRIC_NAMES:
        line = f"{metric_name:<20}"
        for _, block in slices:
            metrics = block.get("pop", {}).get("metrics", {})
            line += format_value(metrics.get(metric_name))
        overall_defined = payload["overall"].get("pop", {}).get("defined_users", {})
        line += f"{overall_defined.get(metric_name, 0):>8,}"
        print(line)
    print("-" * len(header))

    measured = payload["overall"].get("pop", {}).get("metrics", {}).get(f"novelty@{POP_K}")
    reference = pop.get("novelty_reference_bits")
    if measured is not None and reference is not None:
        verdict = "more obscure than" if measured > reference else "more popular than"
        print(
            f"Novelty {measured:.2f} bits against a popularity-proportional reference of "
            f"{reference:.2f} bits: {verdict} drawing by popularity."
        )
    slope = pop.get("popularity_slope")
    if slope is not None:
        correlation = pop.get("popularity_r")
        print(
            f"Popularity slope {slope:.3f} (r {format_value(correlation, width=1, places=3).strip()}) "
            f"over {pop.get('popularity_slope_users', 0):,} readers: the share of a reader's "
            "own popularity level that reaches their list, 1.0 being served at their own level."
        )
    coverage = pop.get("coverage")
    if coverage is not None:
        print(
            f"Catalogue coverage {pop.get('distinct_items', 0):,} of "
            f"{pop.get('catalogue_size', 0):,} titles ({coverage * 100:.2f}%), "
            f"Gini {format_value(pop.get('gini_recommended'), width=1).strip()} over the "
            "titles served at least once."
        )
    print(
        "tail_ndcg is the headline: accuracy over held-out titles from outside the head, "
        "which popularity alone cannot supply."
    )
    print(
        "tail_share is descriptive, not a target. Each mean covers only the users the "
        "metric is defined for, counted in the users column."
    )


def print_comparison(previous: dict, current: dict) -> None:
    """Print a per-slice metric delta table against an earlier result document.

    Descriptive, and read after the paired table rather than instead of it: these are
    differences of means over readers, which is the form of the question the paired
    comparison exists to correct. What they add is the bucket breakdown, since a change
    that helps heavy readers while hurting light ones averages out at run level.
    """
    print()
    print("=" * 72)
    print("COMPARISON: PER-SLICE MEANS")
    print("=" * 72)
    print(
        f"previous: {previous.get('label')}  {previous.get('timestamp')}  "
        f"seed={previous.get('seed')}  limit={previous.get('config', {}).get('limit')}"
    )
    print(
        f"current:  {current.get('label')}  {current.get('timestamp')}  "
        f"seed={current.get('seed')}  limit={current.get('config', {}).get('limit')}"
    )
    print()

    header = f"{'Slice':<10} {'Metric':<13} {'previous':>11} {'current':>11} {'delta':>11}"
    print(header)
    print("-" * len(header))
    slices = [("overall", previous.get("overall", {}), current.get("overall", {}))]
    for bucket_name in BUCKET_NAMES:
        slices.append(
            (
                bucket_name,
                previous.get("buckets", {}).get(bucket_name, {}),
                current.get("buckets", {}).get(bucket_name, {}),
            )
        )

    for slice_name, prev_block, curr_block in slices:
        prev_metrics = prev_block.get("metrics", {})
        curr_metrics = curr_block.get("metrics", {})
        if not prev_block.get("users") and not curr_block.get("users"):
            print(f"{slice_name:<10} {'(no users in either run)':<13}")
            continue
        for metric_name, _, _ in METRIC_SPECS:
            prev_value = prev_metrics.get(metric_name)
            curr_value = curr_metrics.get(metric_name)
            if prev_value is None or curr_value is None:
                print(f"{slice_name:<10} {metric_name:<13} {'n/a':>11} {'n/a':>11} {'n/a':>11}")
                continue
            delta = curr_value - prev_value
            print(
                f"{slice_name:<10} {metric_name:<13} {prev_value:>11.4f} "
                f"{curr_value:>11.4f} {delta:>+11.4f}"
            )
    print("-" * len(header))


def print_pop_comparison(previous: dict, current: dict) -> None:
    """Print popularity deltas against an earlier result document.

    A run written before these metrics existed carries none of them, and its rows read
    as absent rather than as zero movement.
    """
    print()
    print("=" * 72)
    print("COMPARISON: POPULARITY")
    print("=" * 72)

    # Wide enough for the run-level keys, which are longer than any metric name.
    label_width = 22
    header = (
        f"{'Slice':<10} {'Metric':<{label_width}} "
        f"{'previous':>11} {'current':>11} {'delta':>11}"
    )
    print(header)
    print("-" * len(header))

    slices = [("overall", previous.get("overall", {}), current.get("overall", {}))]
    for bucket_name in BUCKET_NAMES:
        slices.append(
            (
                bucket_name,
                previous.get("buckets", {}).get(bucket_name, {}),
                current.get("buckets", {}).get(bucket_name, {}),
            )
        )

    for slice_name, prev_block, curr_block in slices:
        prev_metrics = prev_block.get("pop", {}).get("metrics", {})
        curr_metrics = curr_block.get("pop", {}).get("metrics", {})
        if not prev_block.get("users") and not curr_block.get("users"):
            print(f"{slice_name:<10} {'(no users in either run)':<{label_width}}")
            continue
        for metric_name in POP_METRIC_NAMES:
            prev_value = prev_metrics.get(metric_name)
            curr_value = curr_metrics.get(metric_name)
            line = f"{slice_name:<10} {metric_name:<{label_width}} "
            line += format_value(prev_value) + format_value(curr_value)
            if prev_value is None or curr_value is None:
                line += f"{'-':>11}"
            else:
                line += f"{curr_value - prev_value:>+11.4f}"
            print(line)
    print("-" * len(header))

    # Run-level values, which have no slices to break down.
    for key, places in (
        ("popularity_slope", 4),
        ("popularity_r", 4),
        ("coverage", 6),
        ("gini_recommended", 4),
        ("novelty_reference_bits", 2),
    ):
        prev_value = previous.get("popularity", {}).get(key)
        curr_value = current.get("popularity", {}).get(key)
        line = f"{'run':<10} {key:<{label_width}} "
        line += format_value(prev_value, places=places) + format_value(curr_value, places=places)
        if prev_value is None or curr_value is None:
            line += f"{'-':>11}"
        else:
            line += f"{curr_value - prev_value:>+11.{places}f}"
        print(line)
    print("-" * len(header))
    print(
        "The reference novelty moves only when the catalogue does, so a delta on it "
        "means the two runs read different data and the rest is not paired."
    )
    print(
        "Every delta in this table is a difference of means. The per-reader intervals "
        "and tests are in the paired table above it."
    )


def warn_coupled_switches() -> None:
    """Warn where setting one switch also turns on what another switch names.

    Popularity calibration is folded into the same re-rank pass as the diversity blend,
    and that pass rescales relevance onto 0-1 whenever a calibration is present, whether
    or not the normalisation switch asked for it. A run that sets the first and not the
    second is measuring both, and would otherwise be read as isolating one change.
    """
    settings = switch_settings()
    calibration = settings.get("REC_POPULARITY_CALIBRATION") or 0.0
    normalise = settings.get("REC_MMR_NORMALIZE_RELEVANCE")
    if calibration and not normalise:
        logger.warning(
            f"REC_POPULARITY_CALIBRATION={calibration} also turns relevance "
            "normalisation on inside the re-rank, so this run measures that as well "
            f"despite REC_MMR_NORMALIZE_RELEVANCE={normalise}."
        )


def warn_relation_mismatch(args: argparse.Namespace) -> None:
    """Warn when the engine excludes related titles but the harness never dropped them.

    With REC_RELATION_EXCLUSION on, the engine cannot return a title related to anything
    the reader has read, but a related title stays in the ground truth unless --exclude-
    related also ran. Every metric is then capped below what the engine could ever reach
    for a reason invisible in the stored numbers.
    """
    if engine.RELATION_EXCLUSION and not args.exclude_related:
        logger.warning(
            "REC_RELATION_EXCLUSION is on but --exclude-related was not passed: related "
            "held-out titles stay in the ground truth even though the engine is not "
            "allowed to return them, which caps every metric for no visible reason."
        )


async def run(args: argparse.Namespace, timestamp: datetime) -> int:
    started = time.time()
    warn_coupled_switches()
    warn_relation_mismatch(args)

    # Checked before the run rather than after it, since the run is long.
    if args.compare and not Path(args.compare).is_file():
        logger.error(f"Comparison file not found: {args.compare}")
        return 1

    async with async_session() as session:
        await mark_read_only(session)
        sample = await sample_users(session, args)
        if not sample:
            logger.error("No users matched the sampling criteria; nothing to evaluate.")
            return 1
        # Catalogue-wide reads, done once here and passed to every user. The head
        # boundary and the tag rollup have to describe the population the run scores
        # against, so they take the same filters the engine is called with.
        pop_context = await load_popularity_context(
            session,
            k=POP_K,
            japanese_only=args.japanese_only,
            spoiler_level=args.spoiler_level,
        )

    logger.info(f"Sampled {len(sample):,} users (seed={args.seed}, mode={args.mode})")
    logger.info(
        f"Popularity index over {pop_context.index.size:,} titles, "
        f"reference novelty {pop_context.index.reference_novelty_bits:.2f} bits"
    )

    semaphore = asyncio.Semaphore(args.concurrency)
    results: list[UserResult] = []
    skipped: dict[str, int] = {}
    truth_stats: dict[str, int] = {}
    probe = {
        "requested_users": args.probe_users,
        "users": 0,
        "users_with_pool_hit": 0,
        "ground_truth_in_pool": 0,
        "reachable_ground_truth": 0,
        "pool_recall": None,
        "resolved": 0,
    }
    failures = 0
    done = 0
    probes_started = 0

    async def worker(split: UserSplit, probe_this: bool) -> None:
        nonlocal done, failures
        async with semaphore:
            try:
                result, probe_hits = await evaluate_user(
                    split, args, probe_this, pop_context
                )
            except Exception as exc:
                failures += 1
                # A probe that raised still settles its slot. Counting only the ones that
                # returned would let a run whose probes all fail slip past the check below.
                if probe_this:
                    probe["resolved"] += 1
                logger.warning(f"{split.uid}: evaluation failed: {exc}")
                return
        if probe_hits is not None:
            hits, reachable = probe_hits
            probe["users"] += 1
            probe["resolved"] += 1
            probe["ground_truth_in_pool"] += hits
            probe["reachable_ground_truth"] += reachable
            if hits:
                probe["users_with_pool_hit"] += 1
        results.append(result)
        done += 1
        if done % PROGRESS_EVERY == 0:
            elapsed = time.time() - started
            rate = done / elapsed if elapsed else 0.0
            pending = max(0, len(sample) - done - sum(skipped.values()))
            eta = f", ~{pending / rate / 60:.1f} min left" if rate else ""
            logger.info(
                f"Evaluated {done} of {len(sample)} sampled users ({rate:.2f} users/s{eta})"
            )

    for start in range(0, len(sample), BATCH_USERS):
        batch = sample[start:start + BATCH_USERS]
        async with async_session() as session:
            await mark_read_only(session)
            splits = await load_batch_splits(session, batch, args, skipped, truth_stats)

        tasks = []
        for split in splits:
            probe_this = probes_started < args.probe_users
            if probe_this:
                probes_started += 1
            tasks.append(worker(split, probe_this))
        if tasks:
            await asyncio.gather(*tasks)

        # Checked as soon as the probe quota is filled: a pool that never contains
        # ground truth makes every number meaningless, and a full run is long. The pool
        # holds only a fraction of any one reader's reachable ground truth, so an empty
        # probe is ordinary and only a run of them is evidence of a wiring fault.
        quota_filled = probe["resolved"] >= args.probe_users > 0
        if (
            quota_filled
            and probe["resolved"] >= PROBE_ABORT_MIN_USERS
            and not probe["ground_truth_in_pool"]
        ):
            raise RuntimeError(
                f"No held-out title appeared in the candidate pool across "
                f"{probe['resolved']} probed users, {probe['users']} of which returned a "
                "pool at all. Check the exclusion set and candidate filters before "
                "trusting any metric."
            )

    if failures:
        skipped["evaluation_error"] = failures

    if probe["reachable_ground_truth"]:
        probe["pool_recall"] = round(
            probe["ground_truth_in_pool"] / probe["reachable_ground_truth"], 4
        )

    if not results:
        logger.error("No user produced a result; not writing a report.")
        return 1

    runtime = time.time() - started
    # Users complete out of order under concurrency; summing in a fixed order keeps the
    # aggregates identical between runs that produced identical per-user metrics.
    results.sort(key=lambda r: r.uid)
    payload = build_payload(
        args=args,
        timestamp=timestamp,
        sampled=len(sample),
        results=results,
        skipped=skipped,
        truth_stats=truth_stats,
        probe=probe,
        pop_context=pop_context,
        runtime_seconds=runtime,
    )

    path = write_payload(payload, timestamp, args.label, args.mode)
    print_metrics(payload)
    print_pop_metrics(payload)
    print()
    print(f"Runtime {runtime / 60:.1f} min for {len(results):,} users. Written to {path}")

    if args.compare:
        previous = json.loads(Path(args.compare).read_text(encoding="utf-8"))
        # Comparability and the paired inference come first, since they decide whether
        # the delta tables below them say anything at all.
        report = print_paired_comparison(
            previous, payload, allow_incomparable=args.allow_incomparable
        )
        # The per-slice tables below are differences of means, so they need the two runs
        # to cover one reader set and not merely to overlap.
        withheld = refuse_mean_tables(report, args.allow_incomparable)
        if withheld is None:
            print_comparison(previous, payload)
            print_pop_comparison(previous, payload)
            if not report.comparable:
                print()
                print(
                    "The tables above are INCOMPARABLE: see the config differences at the top."
                )
        else:
            print()
            print(
                f"Per-slice mean tables withheld: {withheld}. This run is written and can "
                "be compared against a matching one, or rerun with --allow-incomparable "
                "to see the tables labelled as such."
            )

    return 0


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Evaluate the served hybrid recommender against a time-ordered holdout.",
    )
    mode_group = parser.add_mutually_exclusive_group()
    mode_group.add_argument(
        "--fast", action="store_true", help=f"sample {FAST_USERS} users, for iteration"
    )
    mode_group.add_argument(
        "--full", action="store_true", help=f"sample {FULL_USERS} users"
    )
    parser.add_argument(
        "--users", type=int, default=None, help="override the sample size for the chosen mode"
    )
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED, help="user sampling seed")
    parser.add_argument("--label", default="baseline", help="name for this run, used in the filename")
    parser.add_argument(
        "--switch",
        action="append",
        default=[],
        metavar="NAME=VALUE",
        help=(
            "set one scoring switch for this run, repeatable. "
            f"Declared switches: {', '.join(switch_settings())}"
        ),
    )
    parser.add_argument(
        "--compare", default=None, help="previous result JSON to print a delta table against"
    )
    parser.add_argument(
        "--allow-incomparable",
        action="store_true",
        help=(
            "release every table --compare would otherwise withhold: a result run under a "
            "different configuration, and one covering a different set of readers"
        ),
    )
    parser.add_argument(
        "--allow-unmeasurable-switch",
        action="store_true",
        help="run anyway with a switch this harness structurally bypasses",
    )
    parser.add_argument(
        "--min-rated",
        type=int,
        default=20,
        help="minimum rated-and-finished titles a sampled user must have",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=50,
        help="recommendations requested per user, matching the served default",
    )
    parser.add_argument(
        "--concurrency", type=int, default=4, help="users evaluated in parallel"
    )
    parser.add_argument(
        "--probe-users",
        type=int,
        default=None,
        help=(
            "users whose candidate pool is inspected to confirm the holdout is reachable "
            f"(default {PROBE_USERS_FAST} fast, {PROBE_USERS_FULL} full; 0 disables)"
        ),
    )
    parser.add_argument("--spoiler-level", type=int, default=0, choices=(0, 1, 2))
    parser.add_argument(
        "--japanese-only", action=argparse.BooleanOptionalAction, default=True
    )
    parser.add_argument(
        "--exclude-blacklist", action=argparse.BooleanOptionalAction, default=True
    )
    parser.add_argument(
        "--exclude-related",
        action="store_true",
        help=(
            "keep titles related to the profile out of the ground truth, so a run under "
            "REC_RELATION_EXCLUSION is scored on what it can still return; pass it on the "
            "switched run and on its control alike, since it changes what is measured"
        ),
    )
    args = parser.parse_args(argv)

    declared = set(switch_settings())
    for assignment in args.switch:
        if "=" not in assignment or not assignment.split("=", 1)[0].strip():
            parser.error(f"--switch expects NAME=VALUE, got {assignment!r}")
        name = assignment.split("=", 1)[0].strip()
        if name not in declared:
            # Not fatal: a switch may be declared elsewhere in the engine. The run
            # record keeps requested and effective apart so a name that bound nothing
            # can still be told from one that did.
            logger.warning(f"{name} is not a switch this module declares")
        if name in UNMEASURABLE_SWITCHES:
            message = (
                f"{name} {UNMEASURABLE_SWITCHES[name]}. The run would report unswitched "
                "numbers under a switched label."
            )
            if not args.allow_unmeasurable_switch:
                parser.error(message + " Pass --allow-unmeasurable-switch to run anyway.")
            logger.warning(message)

    args.mode = "full" if args.full else "fast"
    if args.users is None:
        args.users = FULL_USERS if args.full else FAST_USERS
    if args.probe_users is None:
        args.probe_users = PROBE_USERS_FULL if args.full else PROBE_USERS_FAST
    return args


def main(argv: list[str]) -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )
    # The engine logs a paragraph per user at INFO, which buries progress on a long run.
    logging.getLogger("app.services.hybrid_recommender").setLevel(logging.WARNING)

    args = parse_args(argv)
    # Stamped once here so every field of the report and its filename describe the same run.
    timestamp = datetime.now(timezone.utc)
    return asyncio.run(run(args, timestamp))


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
