"""
Hybrid recommendation engine.

Scores a candidate set on nine signals, split into two kinds. Catalogue signals are facts
whoever made a title published about it and exist whether or not anyone has read it:
description affinity, developer, staff, seiyuu and character trait affinity. Consensus
signals exist only once enough readers have been through a title: tag affinity, VN-to-VN
similarity, co-occurrence ("users also read") and a raw quality term. SIGNAL_WEIGHTS
below is the source of truth for how they are balanced; read it rather than trusting any
prose restatement of the numbers.

Design notes that are not obvious from the scoring itself:
- A title is scored on the share of its own catalogue evidence that matches the reader,
  and the consensus signals are then added on top. Coverage of every consensus signal
  tracks how widely a title has been read, so a blend that divides by all of them at once
  ranks by readership; keeping the two apart is what makes a title nobody has voted on
  fully rankable. CATALOGUE_BLEND holds both shapes, so the change is measurable.
- Description affinity is read from a matrix of embedded descriptions that a nightly job
  builds. Serving does a dot product and loads no model: both sides of every comparison
  are titles, and titles are embedded offline.
- The two item-item signals read nightly-materialised tables rather than computing
  similarity per request.
- The nine scores are combined either as a weighted sum or as agreement between the
  rankings each signal produces on its own; AGGREGATION selects, and the section on rank
  agreement says what each shape can and cannot express. The agreement figure is recorded
  under both, so a page ordered one way still reports what the other made of it.
- Results are re-ranked for diversity after scoring, so a single strong cluster cannot
  fill the whole list. Under POPULARITY_CALIBRATION that same pass also matches the
  page's spread over the catalogue's popularity range to the reader's own, which is a
  property of the list rather than of any title and so cannot come out of the scoring.
- Candidate selection is reproducible: the same reader and the same inputs pick the same
  pool, which is what makes a change in the scoring measurable against a prior run.
- Scoring variants are switches read from the environment at import, each defaulting to
  the behaviour it replaces, so one can be turned on per evaluation run and measured on
  its own. A variant that cannot be turned off is a variant that cannot be measured.
- SIGNAL_WEIGHTS is the balance every reader is scored under. Under PER_USER_WEIGHTS it
  becomes the point a reader's own weights are shrunk toward rather than the weights
  themselves, and the vector a request scored under travels back on last_signal_weights.
  Every reader's weights add up to the same total either way, so a score means one thing
  across readers. A caller may also pass a vector of its own, which is the one case where
  the total moves; the match percentage then divides by that total instead, since a
  candidate can only be measured against the weight it could have earned.
"""

import asyncio
import hashlib
from collections import Counter
import logging
import math
import os
from dataclasses import dataclass, field, replace
from typing import Iterable, Mapping, Optional, Sequence, Union
import numpy as np
from scipy.sparse import csr_matrix
from sklearn.metrics.pairwise import cosine_similarity
from sqlalchemy import select, func, and_, case, exists, literal, or_
from sqlalchemy.ext.asyncio import AsyncSession

import random
from app.db.models import (
    VisualNovel, VNTag, Tag, GlobalVote, VNStaff, Staff,
    VNSimilarity, VNCoOccurrence, VNSeiyuu, CharacterVN, CharacterTrait, Trait,
    ReleaseVN, ReleaseProducer, Producer, CFUserFactors, CFVNFactors
)
from app.config import get_settings
from app.db.database import async_session
from app.db.query_utils import in_ids, not_in_ids
from app.db.vn_filters import AVERAGE_RATING, VNFilterSpec, vn_filter_predicates
from app.services.catalogue_cache import DailyValue
from app.services.description_vectors import get_description_vectors
from app.services.profile_cache import profile_key, read_profile, write_profile
from app.services.recommendation_relations import related_to
from app.services.stage_timing import StageTimer

logger = logging.getLogger(__name__)


def _env_float(name: str, default: float) -> float:
    """Read a float switch from the environment, keeping the default when unusable.

    An unreadable value falls back rather than raising: a mistyped switch must leave the
    engine on its default behaviour, not take the request path down with it.
    """
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return float(raw)
    except ValueError:
        logger.warning(f"{name} is not a number; keeping {default}")
        return default


def _env_int(name: str, default: int) -> int:
    """Read an integer switch from the environment, keeping the default when unusable."""
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return int(raw)
    except ValueError:
        logger.warning(f"{name} is not an integer; keeping {default}")
        return default


def _env_floats(name: str, default: tuple[float, ...]) -> tuple[float, ...]:
    """Read an ascending, non-empty tuple of floats from the environment.

    A list that is empty or out of order describes no partition of the range it is meant
    to cut, so it falls back rather than producing a partition nobody intended.
    """
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        values = tuple(float(part) for part in raw.split(",") if part.strip())
    except ValueError:
        logger.warning(f"{name} is not a comma-separated list of numbers; keeping {default}")
        return default
    if not values or list(values) != sorted(values):
        logger.warning(f"{name} has to be ascending and non-empty; keeping {default}")
        return default
    return values


def _env_shares(
    name: str,
    length: int,
    default: tuple[float, ...] = (),
) -> tuple[float, ...]:
    """Read a fixed-length list of non-negative shares, keeping the default where unusable.

    Unlike the ascending reader above, a share list describes how much of a budget each
    slot receives, so its order carries meaning and no ordering is imposed on it. A list
    of the wrong length describes a partition of something other than what it is applied
    to, and a list summing to nothing describes no allocation at all; both fall back, as a
    mistyped switch has to leave the engine on the behaviour it was configured with rather
    than on a partition nobody intended. An empty default is what a caller reads as
    "unset" and answers with its own behaviour.
    """
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        values = tuple(float(part) for part in raw.split(",") if part.strip())
    except ValueError:
        logger.warning(f"{name} is not a comma-separated list of numbers; keeping {default}")
        return default
    if len(values) != length:
        logger.warning(f"{name} needs exactly {length} values; keeping {default}")
        return default
    if any(value < 0 for value in values) or sum(values) <= 0:
        logger.warning(f"{name} needs non-negative values summing above zero; keeping {default}")
        return default
    return values


def allocate_shares(total: int, shares: tuple[float, ...]) -> tuple[int, ...]:
    """Split a whole budget between slots in proportion to their shares.

    Integer slots and fractional shares do not divide evenly, so the remainder is handed
    out by largest fractional part with the slot's own index settling a tie: the split is
    a function of its inputs alone and the same budget always falls the same way. A slot
    given a positive share keeps at least one place, since a share small enough to floor
    to zero still says the band is wanted rather than excluded.
    """
    if total <= 0 or not shares:
        return tuple(0 for _ in shares)
    weight = sum(shares)
    exact = [total * share / weight for share in shares]
    quotas = [
        max(1, int(value)) if share > 0 else 0
        for value, share in zip(exact, shares)
    ]
    remaining = total - sum(quotas)
    if remaining > 0:
        order = sorted(
            range(len(shares)),
            key=lambda index: (-(exact[index] - int(exact[index])), index),
        )
        for position in range(remaining):
            quotas[order[position % len(order)]] += 1
    return tuple(quotas)


def _env_signal_map(name: str, defaults: dict[str, float]) -> dict[str, float]:
    """Read a per-signal constant from the environment as `signal=value` pairs.

    Signals left out keep their default, so a sweep can move one of them without
    restating the other seven.
    """
    values = dict(defaults)
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return values
    for part in raw.split(","):
        if not part.strip():
            continue
        signal, _, value = part.partition("=")
        signal = signal.strip()
        if signal not in values:
            logger.warning(f"{name} names an unknown signal {signal!r}; ignoring it")
            continue
        try:
            values[signal] = float(value)
        except ValueError:
            logger.warning(f"{name} gives {signal} a non-numeric value; keeping the default")
    return values


def _env_flag(name: str, default: bool) -> bool:
    """Read a boolean switch from the environment. Only "1" turns a switch on."""
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    return raw.strip() == "1"


# Tags to ignore (presentation-related, not content)
IGNORE_TAGS = {
    32,    # ADV (Adventure game format)
    2040,  # NVL (Novel format)
    2461,  # Engine: Ren'Py
    1434,  # Engine: KiriKiri
    1431,  # Engine: VNDS
    43,    # Sexual Content (too common to be useful)
}

# Whether character-trait affinity takes part in the blend. Read here rather than with the
# other switches because the weight total is summed from the weights below and is bound as
# a default argument before that block runs.
#
# The term saturates: an entity signal clamps its summed per-entity contributions at 1.0,
# and a candidate's trait sum clears that ceiling on its character count alone, so it
# returns the same value for most of the catalogue while carrying weight. Off, its weight
# leaves the total as well, so the remaining signals keep the shares they hold relative to
# each other and a match percentage still divides by the weight a candidate could earn. Off
# also skips the trait loaders, which are the slowest in the scoring path.
TRAIT_SIGNAL = _env_flag("REC_TRAIT_SIGNAL", True)

# ---------------------------------------------------------------------------
# Which scoring model a run uses
# ---------------------------------------------------------------------------
# "catalogue" scores a title mainly on facts its publisher supplies, which exist for a
# title nobody has read, and lets crowd-derived signals add on top of that. "legacy" is
# the flat blend those signals used to share with the crowd-derived ones under one fixed
# divisor. The model name picks the defaults for the switches below, so one setting
# reproduces either engine and a run that changes it changes all of it at once; each of
# those switches can still be set on its own to isolate a single part of the difference.
#
# Under "legacy" the description weight is zero and its terms drop out of every sum
# exactly, so the two models are comparable rather than merely similar.
SCORING_MODEL = (os.getenv("REC_SCORING_MODEL") or "catalogue").strip() or "catalogue"
LEGACY_SCORING = SCORING_MODEL == "legacy"

# Signals whose evidence a title carries whatever its readership. A description, a
# developer, a staff list, a cast and their traits are published by whoever made the
# title; none of them require anyone to have played it.
CATALOGUE_SIGNALS = ("description", "developer", "staff", "seiyuu", "trait")

# Signals that exist only once enough readers have been through a title: tags are
# crowd-contributed, both item-item tables are built from vote patterns, and a rating is
# a vote average. Coverage of all four tracks readership rather than merit.
CONSENSUS_SIGNALS = ("tag", "similar_games", "users_also_read", "quality")

# Order every weight vector is written and summed in. Description is last so that a sum
# under the legacy vector, where its weight is zero, is bit-for-bit the sum that vector
# produced before the signal existed.
SIGNAL_ORDER = (
    "tag",
    "similar_games",
    "users_also_read",
    "quality",
    "developer",
    "staff",
    "trait",
    "seiyuu",
    "description",
)

# The flat blend, kept reachable so a change to the balance can be measured against it.
LEGACY_SIGNAL_WEIGHTS = {
    "tag": 2.5,
    "similar_games": 2.0,
    "users_also_read": 2.0,
    "quality": 1.5,
    "developer": 0.6,
    "staff": 0.5,
    "trait": 0.5,
    "seiyuu": 0.3,
    "description": 0.0,
}

# The catalogue-first balance. Two thirds of the weight sits on signals a title carries
# whatever its readership, and the reasoning per signal is:
#
# - description leads because it is the only dense content signal that does not depend on
#   crowd participation: over half of the least-read band has usable prose against a
#   thirtieth of a percent with a co-occurrence row.
# - developer is the widest-covered fact in the catalogue and was carrying a fifteenth of
#   the total.
# - tag affinity keeps the largest consensus weight because it is the most informative
#   signal for a title that has tags, but it is crowd-contributed and its coverage falls
#   by a factor of eight from the best-known band to the least-read one, so it is a
#   popularity proxy as much as a content one and cannot lead the blend.
# - similar_games is computed from those same tag vectors, so it inherits that bias and
#   is demoted with it.
# - users_also_read is kept rather than dropped, because for the titles that have a
#   co-occurrence row it says something no other signal does, but it exists for a
#   thirtieth of a percent of the largest band and cannot be worth a fifth of the total.
# - quality is a property of the title alone, identical for every reader, so it decides
#   nothing personal and is held to a small share.
#
# The total is held at roughly the flat blend's, so a raw score means about the same thing
# either side of the change and only what it is made of moves.
#
# The vector is close to flat, and deliberately. Under the agreement aggregation a weight is
# what a signal's ranking counts for, and a signal able to place every candidate already
# reaches every candidate; giving it several times another signal's weight on top settles
# the page on one view of a title before the others are consulted. Description is the clear
# case: it can score anything carrying prose, so its reach is the widest of the nine and its
# weight is the one that most needs to stay ordinary.
CATALOGUE_SIGNAL_WEIGHTS = {
    "tag": 1.4,
    "similar_games": 1.2,
    "users_also_read": 1.2,
    "quality": 0.8,
    "developer": 1.2,
    "staff": 1.0,
    "trait": 0.7,
    "seiyuu": 0.7,
    "description": 1.2,
}

# The same balance pushed as far toward the catalogue as it will go, reachable through
# REC_SIGNAL_WEIGHTS. Measured against the vector above it reaches a little further into
# the catalogue and seats considerably more of the least-read band on a page, and it costs
# roughly twice as much of the reader's own held-out reading to do it. The extra reach is
# a small fraction of what the shipped vector already recovers, and the extra cost is not,
# which is why it is not the default; a run that wants reach at any price sets it.
REACH_SIGNAL_WEIGHTS = {
    "tag": 1.0,
    "similar_games": 0.4,
    "users_also_read": 0.2,
    "quality": 0.4,
    "developer": 1.4,
    "staff": 1.0,
    "trait": 0.7,
    "seiyuu": 0.4,
    "description": 4.0,
}

# Whether description affinity takes part at all. Off, its weight leaves the total with
# it, so the remaining signals keep their shares and a match percentage still divides by
# the weight a candidate could earn.
DESC_SIGNAL = _env_flag("REC_DESC_SIGNAL", not LEGACY_SCORING)


def _default_signal_weights() -> dict[str, float]:
    """The vector before the environment is allowed to override individual weights."""
    base = LEGACY_SIGNAL_WEIGHTS if LEGACY_SCORING else CATALOGUE_SIGNAL_WEIGHTS
    weights = {name: base[name] for name in SIGNAL_ORDER}
    if not TRAIT_SIGNAL:
        weights["trait"] = 0.0
    if not DESC_SIGNAL:
        weights["description"] = 0.0
    return weights


# Keyed by the signal names used in the API response, so a client can line the weights up
# with the per-signal scores it receives. Adding a signal here without scoring it, or
# scoring one absent from here, skews every match percentage.
#
# Individual weights are overridable so a sweep can move one of them without editing the
# module or restating the rest.
SIGNAL_WEIGHTS = _env_signal_map("REC_SIGNAL_WEIGHTS", _default_signal_weights())

# Score a VN would reach by maxing out every signal; the divisor for the 0-100 scale.
MAX_WEIGHTED_SCORE = sum(SIGNAL_WEIGHTS.values())


def candidate_pool_size(limit: int) -> int:
    """Candidates collected for a page of `limit`, held under the ceiling."""
    pool = max(1, limit) * CANDIDATE_LIMIT_FACTOR
    if CANDIDATE_LIMIT_MAX > 0:
        return min(pool, CANDIDATE_LIMIT_MAX)
    return pool


def weight_total(weights: dict[str, float]) -> float:
    """Score a candidate would reach under one weight vector with every signal maxed out.

    Summed in the order MAX_WEIGHTED_SCORE is, so the global vector passed through here
    returns that constant exactly rather than a value differing in its last bits.
    """
    return sum(weights[name] for name in SIGNAL_WEIGHTS)


def normalize_score(total_score: float, max_score: float = MAX_WEIGHTED_SCORE) -> int:
    """Map a raw weighted score onto the 0-100 scale shown as a match percentage.

    Every surface that displays a match percentage must go through this, including the
    cached-result path: a second formula elsewhere silently changes what the same
    recommendation appears to be worth.

    The divisor is the weight a candidate could actually have earned, which is the sum of
    the weights the score was built from. It is the global total for every request that
    does not name its own weights, and a percentage computed against any other number
    stops describing the score beside it.
    """
    if max_score <= 0:
        return 0
    return min(100, round((total_score / max_score) * 100))


# ---------------------------------------------------------------------------
# The catalogue-first blend
# ---------------------------------------------------------------------------
# Two sums rather than one. The catalogue block is divided by the weight of the catalogue
# evidence the title actually carries and put back on the block's full scale, so a title
# is scored on the share of what is known about it that matches the reader, not against a
# total it has no data to reach. The consensus block is added as it stands: a title with
# no crowd data earns none of it, but that is a bonus withheld rather than a division a
# title cannot survive.
#
# The two blocks are kept apart because renormalising the consensus block the same way
# would restore exactly the effect this removes. Coverage of tags, both item-item tables
# and ratings tracks how widely a title has been read, so dividing by the crowd evidence
# present scales a well-read title's crowd score down and a thin one's up, and the
# ranking is decided by how much of each kind of evidence exists rather than by what it
# says. The catalogue block has no such coupling: description, developer, staff, cast and
# traits are published regardless of readership.
#
# The ceiling is unchanged. Both blocks are bounded by their own weight totals, so the
# blend cannot exceed their sum and the match percentage divides by the same number it
# always did. A title with the whole catalogue behind it and no crowd data at all reaches
# the catalogue block's share of the total and no more, which is the honest statement of
# what is known about it.
CATALOGUE_BLEND = _env_flag("REC_CATALOGUE_BLEND", not LEGACY_SCORING)

# Floor under the catalogue block's divisor, on the same scale as the weights. Without it
# a title carrying one thin catalogue fact and matching it perfectly earns the whole
# block, so a single developer match would score as high as a title that matched on
# everything known about it. It is the point below which a title is judged to have said
# too little about itself to be scored as though it had said everything.
# Floor under the catalogue divisor, as a share of the catalogue block's own weight rather
# than an absolute. Stated absolutely it silently stops working when the weights move: a
# floor above everything a thin candidate can carry divides every thin candidate by the
# same number, and a title that said nothing on a signal lands exactly where one that
# spoke and matched nothing lands. A share holds the same meaning under any vector.
CATALOGUE_EVIDENCE_FLOOR_SHARE = _env_float("REC_CATALOGUE_EVIDENCE_FLOOR_SHARE", 0.45)

# Whether an entity signal counts as evidence only where the reader has some history with
# the candidate's own entities.
#
# Tags and descriptions live in a dense space both sides share, so a low score there is a
# verdict: the reader's tastes and the title's subject matter were compared and did not
# meet. Developers, staff, voice actors and traits do not. The catalogue holds thousands
# of each and a reader has encountered tens, so a candidate whose studio the reader has
# never read returns zero because the two lists do not intersect, not because the studio
# was weighed and found wanting.
#
# Counted as evidence, those zeros are the whole of the difference the catalogue block is
# supposed to make: nearly every title in the catalogue names a developer, so nearly every
# candidate carries that weight in its divisor while scoring nothing on it, and the
# signals that did have something to say are scaled down to make room for it. Off, the
# divisor follows the candidate's data alone.
CATALOGUE_MATCH_PRESENCE = _env_flag("REC_CATALOGUE_MATCH_PRESENCE", not LEGACY_SCORING)


def entity_evidence(user_weights: Optional[dict], vn_entities) -> bool:
    """Whether a candidate's entities of one kind are evidence about this reader.

    Off, this is whether the candidate has any, which is what presence meant before the
    reader's side of the comparison was taken into account.
    """
    if not vn_entities:
        return False
    if not CATALOGUE_MATCH_PRESENCE:
        return True
    return bool(user_weights) and any(entity in user_weights for entity in vn_entities)


def catalogue_weight_total(weights: dict[str, float]) -> float:
    """Weight the catalogue block carries under one vector."""
    return sum(weights[name] for name in CATALOGUE_SIGNALS)


def catalogue_scale(signals_present: set[str], weights: dict[str, float]) -> float:
    """Factor putting the catalogue block back on its full scale after dividing it by the
    weight of the catalogue evidence behind one candidate.

    Zero where the candidate carries no catalogue evidence at all: there is nothing to
    put back on scale, and the block's terms are all zero anyway.
    """
    total = catalogue_weight_total(weights)
    if total <= 0:
        return 0.0
    present = sum(
        weights[name] for name in CATALOGUE_SIGNALS if name in signals_present
    )
    if present <= 0:
        return 0.0
    floor = total * CATALOGUE_EVIDENCE_FLOOR_SHARE
    return total / max(present, min(floor, total))


def catalogue_blend_total(
    scores: dict[str, float],
    weights: dict[str, float],
    signals_present: set[str],
) -> float:
    """Blend one candidate's per-signal scores as catalogue evidence plus a consensus term.

    The list path and the single-title details path both call this, so a breakdown cannot
    add up differently from the score it is shown beside.
    """
    contributions = [
        scores[name] * weights[name]
        for name in CATALOGUE_SIGNALS
        if name in signals_present
    ]
    if BLEND_TOP_K:
        # A title earns its place on its best reasons rather than on the breadth of its
        # faint ones. Summed over everything, a close match on one thing scores below a
        # title that is unremarkable on several, because there are more ways to be
        # unremarkable than to be close.
        contributions = sorted(contributions, reverse=True)[:BLEND_TOP_K]
    catalogue = sum(contributions)
    consensus = sum(scores[name] * weights[name] for name in CONSENSUS_SIGNALS)
    return catalogue * catalogue_scale(signals_present, weights) + consensus


# Floor under the divisor applied to a candidate's weighted total. Both switches below
# are read once at import, so a run is configured from the environment rather than by
# editing the module, and one variable can be swept per run.
#
# Read only while the catalogue blend is off, which is the flat sum this divides.
#
# At the full weight total every candidate divides by the full total, since no subset of
# the weights can exceed their sum, so the scoring is that of an ungated engine. Lowering
# it lets a candidate be judged on the signals that had something to say about it instead
# of against a total it has no data to reach; the floor is what stops a title carrying
# one thin signal from being scaled up without limit.
EVIDENCE_DENOMINATOR = _env_float("REC_EVIDENCE_DENOMINATOR", 6.0)

# When on, a title with no raw average rating has no quality evidence rather than a
# mid-scale stand-in. The stand-in awards a fixed share of the quality weight to a title
# nobody has rated, and mixes the raw average with the Bayesian one, which are different
# scales.
QUALITY_STRICT = _env_flag("REC_QUALITY_STRICT", True)

# When on, tag affinity is measured against the candidate's own tag mass rather than a
# per-reader constant, so a title is scored on the share of it that matches rather than on
# how many tags it carries. Exhaustive tagging correlates with a title's kind rather than
# its closeness, and the accompanying breadth bonus is stood down with it.
TAG_COSINE = _env_flag("REC_TAG_COSINE", False)

# How much of the tag term is the average quality of a match rather than the total of one.
# The sum divides by a per-reader constant, so nothing in the divisor describes the
# candidate and the score grows with the number of tags a title carries. Tags are
# contributed by readers, so how many a title has records how widely it has been read, and
# a term meant to measure taste ends up measuring readership: a well-documented title
# outscores a closer match that fewer people have tagged. The average divides by what the
# candidate actually matched on, so a sparsely tagged title is judged on the tags it has.
# Zero is the total alone; one is the average alone; between them the two are blended.
TAG_MEAN_NORM = _env_float("REC_TAG_MEAN_NORM", 0.0)

# Share of a reader's own list a tag has to cover before it is trusted to describe them.
# The fixed count it replaces is reached by a handful of titles whatever the list length, so
# on a long list a tag seen a few times earns the same confidence as one seen throughout,
# and rarity weighting then promotes the former. Zero keeps the fixed count.
TAG_SUPPORT_SHARE = _env_float("REC_TAG_SUPPORT_SHARE", 0.0)

# When on, tags VNDB files under its technical category are left out of a reader's taste
# profile. They record how a title was built and presented rather than what it is about, so
# a reader who has read several titles sharing one is described by an interface feature.
# Titles are not filtered by them either way; only the profile ignores them.
TAG_EXCLUDE_TECHNICAL = _env_flag("REC_TAG_EXCLUDE_TECHNICAL", True)

# When on, the broad candidate draw admits a title on the strength of its own average rather
# than the shrunk one. The shrunk figure is absent until a title has been rated by enough
# readers, so gating on it selects for having been read rather than for being worth reading,
# and most of the catalogue is never drawn at all. Well-regarded thin titles are the ones it
# costs, and they are what a reader of niche titles is looking for.
EXPLORATION_OPEN = _env_flag("REC_EXPLORATION_OPEN", True)

# Floor the open draw applies to a title's own average, on the 1-10 scale.
# Floor the open draw applies to a title's own average, on the 1-10 scale. Zero admits a
# title whatever it scored, including one nobody has scored: an average is a summary of who
# has already read something, and a draw that gates on it can only reach what has been read.
EXPLORATION_MIN_AVERAGE = _env_float("REC_EXPLORATION_MIN_AVERAGE", 0.0)

# Votes a title needs before the open draw will consider it. The average-rating gate above
# admits a title nobody has rated on purpose, since being unrated is the ordinary state of
# most of the catalogue rather than a mark against a title; this floor then removes the same
# titles again. Zero lets them through and is the wider draw the gate was written for.
EXPLORATION_MIN_VOTES = _env_int("REC_EXPLORATION_MIN_VOTES", 0)

# Readers a co-read pair needs before the arm will follow it. The count is a property of how
# widely the pair has been read rather than of how strongly the two go together, so a floor
# on it reaches only titles that are already well read.
COOCCURRENCE_MIN_USERS = _env_int("REC_COOCCURRENCE_MIN_USERS", 2)

# When on, the broad draw takes an equal share from each popularity band rather than one
# shuffle over the whole gate. Readership is concentrated enough that a single shuffle
# returns almost nothing from the bands only a few hundred titles occupy, and a page can
# only be matched to a reader who reads there if the pool reaches there first. Coverage is
# candidate generation's job; which band a given reader is served from is the ranking's.
EXPLORATION_STRATIFIED = _env_flag("REC_EXPLORATION_STRATIFIED", True)

# Tags are scored on the reader's absolute average for a tag, while staff, developers,
# seiyuu and traits are stored as a delta from that reader's own average. At 1.0 tags are
# centred the same way, so a tag carried by titles the reader rated below their own mean
# stops reading as a preference. 0.0 leaves the absolute score, which is the older shape;
# the default sits halfway, where the paired holdout showed the gain.
TAG_CENTERING = _env_float("REC_TAG_CENTERING", 0.5)

# Entity scoring adds the reader's average back onto the stored delta, so an entity they
# rate below their own mean still contributes, just less: nothing in the profile can say
# "not this". When on, the delta is used as it stands and those entities subtract.
DISLIKE_NEGATIVE = _env_flag("REC_DISLIKE_NEGATIVE", False)

# A title related to one the reader has read, by any relation the catalogue records, is
# a title the reader already knows about: a sequel, an earlier part, a fan disc, an
# alternate edition, a shared setting. Every signal reads such a title as a strong match,
# because it shares the studio, the staff, the cast and most of the premise with a title
# the reader rated, so left in the pool it fills the top of the page with reminders. When
# on, the exclusion set is widened to everything related to the read set before any
# source is asked.
RELATION_EXCLUSION = _env_flag("REC_RELATION_EXCLUSION", True)

# Direct sequels of the titles the reader liked, shown as a strip of their own rather
# than competing with discoveries. Read by the request path; the engine only declares it
# so a stored evaluation run records it alongside the exclusion above.
CONTINUATIONS = _env_flag("REC_CONTINUATIONS", True)

# The entity signals at their default add the reader's mean back onto a stored delta
# from that mean, which leaves only the count-confidence factor: a studio read five times
# at exactly the reader's own mark outscores one read once and loved, several times over.
# When on, an entity contributes the reader's centred mark for it, on the reader's own
# scale, times that same confidence factor, so rating and volume each enter once.
ENTITY_PREFERENCE = _env_flag("REC_ENTITY_PREFERENCE", False)

# Titles an entity has to appear on before its mark is fully trusted, shared by the
# scoring term and the retrieval gate. The same figure the profile builder uses.
ENTITY_CONFIDENCE_COUNT = 5


def entity_confidence(count: float) -> float:
    """How far a mark over `count` titles is trusted, 0-1."""
    return min(1.0, float(count) / ENTITY_CONFIDENCE_COUNT)


def entity_preference(mean: float, reader_mean: float, spread: float) -> float:
    """The reader's mark for an entity on the unit interval.

    Even at the reader's mean, certain one spread above it, nothing one spread below.
    Spread is the reader's own, so a reader who uses two values and one who uses ten are
    read on their own scale rather than on a fixed number of rating points.
    """
    spread = max(1.0, float(spread))
    value = 0.5 + (float(mean) - float(reader_mean)) / (2.0 * spread)
    return max(0.0, min(1.0, value))


# Where each entity kind keeps its damped means and title counts in the profile, keyed
# by the name of its preference map.
ENTITY_PROFILE_KEYS = {
    "preferred_developers": ("dev_means", "dev_counts"),
    "preferred_staff": ("staff_means", "staff_counts"),
    "preferred_seiyuu": ("seiyuu_means", "seiyuu_counts"),
    "preferred_traits": ("trait_means", "trait_counts"),
}

# The broad draw reaches titles nothing else would name, and the least-read band is most
# of it. A title with neither a description nor a tag gives every signal nothing to read,
# so it can only land on the page by the order the pool arrived in. When on, the draw
# asks for at least one of the two.
EXPLORATION_REQUIRE_EVIDENCE = _env_flag("REC_EXPLORATION_REQUIRE_EVIDENCE", False)

# The description job embeds text past this length and nothing shorter, so the same
# floor is what decides whether the premise signal can see a title.
EVIDENCE_DESCRIPTION_LENGTH = 50


def exploration_evidence_predicate():
    """The clause the broad draw adds under the evidence floor, or None when it is off."""
    if not EXPLORATION_REQUIRE_EVIDENCE:
        return None
    has_tag = exists(select(VNTag.vn_id).where(VNTag.vn_id == VisualNovel.id))
    has_text = func.length(func.coalesce(VisualNovel.description, "")) > EVIDENCE_DESCRIPTION_LENGTH
    return or_(has_text, has_tag)


# Half-life, in days, over which a reader's own vote loses weight in their profile. Taste
# moves, and a mark given years ago says less about what to read next than one given
# last month. Age is measured from the reader's newest vote rather than from today, so a
# reader who has not voted for a while is not read as having no taste at all. Zero is no
# decay, and a vote the dump holds no date for keeps full weight.
VOTE_HALF_LIFE_DAYS = _env_float("REC_VOTE_HALF_LIFE_DAYS", 0.0)


def vote_weights(user_votes: list[dict]) -> dict[str, float]:
    """Per-title weight of each vote in the profile, 0-1, by age."""
    ids = [vote.get("vn_id") or vote.get("id") for vote in user_votes]
    if VOTE_HALF_LIFE_DAYS <= 0:
        return {vn_id: 1.0 for vn_id in ids if vn_id}
    dated = [vote["vote_date"] for vote in user_votes if vote.get("vote_date") is not None]
    newest = max(dated) if dated else None
    half_life_seconds = VOTE_HALF_LIFE_DAYS * 86400.0
    weights: dict[str, float] = {}
    for vote in user_votes:
        vn_id = vote.get("vn_id") or vote.get("id")
        if not vn_id:
            continue
        when = vote.get("vote_date")
        if when is None or newest is None:
            weights[vn_id] = 1.0
            continue
        age = max(0.0, float(newest - when))
        weights[vn_id] = 0.5 ** (age / half_life_seconds)
    return weights


def weighted_support(
    vn_scores: dict[str, float], vn_list: list[str], weights: dict[str, float]
) -> tuple[float, float]:
    """An entity's support and mean mark over the titles it appears on, vote-weighted.

    Support replaces the plain count in the damping and confidence formulas, so a title
    the reader marked long ago counts for less of an entity's evidence as well as less
    of its mean.
    """
    support = 0.0
    total = 0.0
    for vn_id in vn_list:
        weight = weights.get(vn_id, 1.0)
        support += weight
        total += weight * vn_scores[vn_id]
    if support <= 0:
        return 0.0, 0.0
    return support, total / support


def status_predicates(spec: VNFilterSpec) -> list:
    """The finished-only clause, unless the request named a development status.

    The broad draw has always asked for finished titles; the other sources nominate by
    similarity, description or entity and cannot see a title's status without joining the
    title table, which an unfiltered request must not do. The clause is applied instead at
    the cut every nominated id passes through, and in the quality fallback, so a nomination
    spent on an unfinished title is the small cost of keeping those arms join-free. It is
    computed after the request's own filters have been counted, so it never triggers the
    widening a reader's filter does.
    """
    if spec.devstatus or spec.exclude_devstatus:
        return []
    return [VisualNovel.devstatus == 0]


# Weight of the collaborative-filtering signal: the reader's and the title's latent
# factors from the nightly model. It sits outside the weight vector, since the vector is
# what readers tune and what every published percentage divides by, and an unmeasured
# signal must not appear there. Zero leaves the signal out of the total and out of every
# ranking, which is the default until it has been measured to earn a place. The term is
# for the offline harness: a cached page has no column for it, so a served page under
# any other value would fold it into the stored total with nothing to explain it. It is
# added after the dislike damping and so is not damped by disliked tags; a measured lift
# has to be read with that in mind.
CF_SIGNAL_WEIGHT = _env_float("REC_CF_SIGNAL_WEIGHT", 0.0)


def collaborative_scores(reader: Optional[np.ndarray], items: dict[str, np.ndarray]) -> dict[str, float]:
    """Dot product of the reader's vector with each title's, min-max scaled over the pool.

    Scaled over the pool because the model's scale means nothing to the other signals;
    the best candidate on this signal reads one and the worst zero, which is the range
    every other term already occupies.
    """
    if reader is None or not items:
        return {}
    raw = {vn_id: float(reader @ vector) for vn_id, vector in items.items()}
    low, high = min(raw.values()), max(raw.values())
    if high <= low:
        return {vn_id: 0.0 for vn_id in raw}
    return {vn_id: (value - low) / (high - low) for vn_id, value in raw.items()}


# Applied to a centred preference, sign preserved. Above 1.0 it widens the gap between a
# reader's strong feelings and their mild ones, which matters most for a reader who uses a
# narrow band of the rating scale and whose merely-tolerated titles otherwise outnumber
# their favourites by an order of magnitude.
TASTE_SHARPNESS = _env_float("REC_TASTE_SHARPNESS", 1.0)

# How far a title can be marked down for being made of material the reader's own marks
# argue against. Applied as a factor on the finished score rather than as a term inside it:
# subtracting from the total makes a title that matches nothing outrank one that matches a
# great deal with a single flaw, because absence of evidence then scores better than mixed
# evidence. A factor cannot do that, since a title with nothing to damp also has nothing to
# keep. 0.0 leaves every score untouched.
DISLIKE_DAMPING = _env_float("REC_DISLIKE_DAMPING", 0.0)

# How many of the reader's own titles must carry a tag before its low marks are read as a
# dislike rather than as one bad experience that happened to be tagged.
DISLIKE_MIN_SUPPORT = _env_int("REC_DISLIKE_MIN_SUPPORT", 3)

# The most a title can be marked down to. A page of nothing but faint matches is worse than
# a strong match carrying something unwelcome, so the damping stops short of dismissal.
DISLIKE_FLOOR = _env_float("REC_DISLIKE_FLOOR", 0.35)


def dislike_damping(vn_tags: dict[int, float], tag_dislikes: dict[int, float]) -> float:
    """How much of a candidate is made of material the reader marks below their own average.

    Measured as a share of the candidate's own tag mass, not as a count, so an exhaustively
    tagged title is not marked down merely for carrying more tags than a sparse one.
    """
    if DISLIKE_DAMPING <= 0 or not tag_dislikes or not vn_tags:
        return 1.0
    total = sum(vn_tags.values())
    if total <= 0:
        return 1.0
    disliked = sum(
        severity * vn_tags[tag_id]
        for tag_id, severity in tag_dislikes.items()
        if tag_id in vn_tags
    )
    return max(DISLIKE_FLOOR, 1.0 - DISLIKE_DAMPING * (disliked / total))


def sharpen(delta: float) -> float:
    """Widen a centred preference without moving its sign or its zero."""
    if TASTE_SHARPNESS == 1.0:
        return delta
    return math.copysign(abs(delta) ** TASTE_SHARPNESS, delta)

# Every signal is built from rated titles, so a reader who logs what they read without
# scoring it has an empty profile and is served nothing at all. When on, their finished
# titles enter the profile at a fixed score: choosing to read something is a preference,
# and a weaker one than a rating the reader actually gave, so the score sits below the
# range real ratings occupy and cannot outrank one.
UNRATED_AS_EVIDENCE = _env_flag("REC_UNRATED_AS_EVIDENCE", False)
UNRATED_EVIDENCE_SCORE = _env_float("REC_UNRATED_EVIDENCE_SCORE", 70.0)


def evidence_gating_active() -> bool:
    """Whether the denominator is set low enough to change any candidate's score."""
    return EVIDENCE_DENOMINATOR < MAX_WEIGHTED_SCORE


def present_signals(
    has_tags: bool,
    has_similar_games: bool,
    has_users_also_read: bool,
    has_quality: bool,
    has_developers: bool,
    has_staff: bool,
    has_traits: bool,
    has_seiyuu: bool,
    has_description: bool = False,
) -> set[str]:
    """Names of the signals that had a source to speak from for one candidate.

    Presence is a property of the data, not of the score. A zero computed over sixty
    tags is a verdict on the candidate; a zero standing in for a table row that does not
    exist is silence, and the two must not be counted the same way.
    """
    return {
        name
        for name, present in (
            ("tag", has_tags),
            ("similar_games", has_similar_games),
            ("users_also_read", has_users_also_read),
            ("quality", has_quality),
            ("developer", has_developers),
            ("staff", has_staff),
            ("trait", has_traits),
            ("seiyuu", has_seiyuu),
            ("description", has_description),
        )
        if present
    }


def evidence_scale(signals_present: set[str]) -> float:
    """Factor putting a candidate's weighted total back on the 0-MAX_WEIGHTED_SCORE scale
    after dividing it by the weight of the evidence behind it.

    Returns exactly 1.0 whenever the floor sits at or above the full weight total, so the
    scale is a no-op at the default rather than a rounding of one.
    """
    if EVIDENCE_DENOMINATOR >= MAX_WEIGHTED_SCORE:
        return 1.0
    present_weight = 0.0
    for signal, weight in SIGNAL_WEIGHTS.items():
        if signal in signals_present:
            present_weight += weight
    denominator = max(EVIDENCE_DENOMINATOR, present_weight)
    if denominator <= 0 or denominator >= MAX_WEIGHTED_SCORE:
        return 1.0
    return MAX_WEIGHTED_SCORE / denominator


def quality_score_for(
    average_rating: Optional[float],
    bayesian_rating: Optional[float],
) -> tuple[float, bool]:
    """Quality term for a candidate, and whether a rating existed to compute it from.

    Maps a 5.0-10.0 raw average onto 0.0-1.0; anything at or below the midpoint is 0.
    """
    if QUALITY_STRICT:
        if average_rating is None:
            return 0.0, False
        return max(0, (average_rating - 5.0) / 5.0), True
    vn_avg_rating = average_rating or bayesian_rating or 7.0
    return max(0, (vn_avg_rating - 5.0) / 5.0), True


# ---------------------------------------------------------------------------
# Description affinity
# ---------------------------------------------------------------------------
# Descriptions are embedded by a nightly job and read here as a matrix of unit vectors,
# so a request measures closeness with a dot product and loads no model. A title absent
# from the matrix has no description worth reading and takes no part in this signal; it
# is not scored zero, which would read a silence as a rejection.
#
# The vectors are mean-centred, so a cosine between two of them runs roughly -0.3 to 1.0
# rather than filling 0 to 1: two parts of one work land between 0.6 and 0.95, a genuine
# thematic neighbour between 0.3 and 0.5, and an unrelated pair near zero. Feeding a raw
# cosine to a weighted sum that assumes a 0-1 term would hand the signal about half the
# weight it is given, so the range the corpus actually occupies is mapped onto the range
# the sum expects. Below the floor is no match rather than a negative one: material a
# reader has not read is not evidence against a title.
DESC_COSINE_FLOOR = _env_float("REC_DESC_COSINE_FLOOR", 0.0)
DESC_COSINE_CEILING = _env_float("REC_DESC_COSINE_CEILING", 0.6)

# Whether a candidate is measured against the nearest of a reader's favourites or against
# their average. A reader with two unrelated tastes is described badly by one vector: the
# average of both points where neither is, and every title near it is near nothing the
# reader actually read.
DESC_BEST_MATCH = _env_flag("REC_DESC_BEST_MATCH", True)

# How many of a reader's favourites the signal measures against.
DESC_SEEDS = _env_int("REC_DESC_SEEDS", 12)


def description_affinity(cosine: float) -> float:
    """One cosine as a 0-1 signal term."""
    span = DESC_COSINE_CEILING - DESC_COSINE_FLOOR
    if span <= 0:
        return 1.0 if cosine >= DESC_COSINE_CEILING else 0.0
    return min(1.0, max(0.0, (cosine - DESC_COSINE_FLOOR) / span))


# ---------------------------------------------------------------------------
# Scoring switches
#
# Bound once at import from the settings layer, so a run picks a configuration through
# the environment instead of by editing this module, and two runs of the same code can
# differ by exactly one of them. Every default reproduces the scoring as it stands
# without the switch, which is what makes an unswitched run the control a switched run
# is measured against; a default that quietly moves rebases every stored result, so it
# moves only alongside the baseline it is compared to.
# ---------------------------------------------------------------------------
_scoring_settings = get_settings()

# The entity signals (developer, staff, seiyuu, trait) each sum their per-entity
# contributions and clamp the sum at 1.0. On a candidate with several matches, or one
# strong one, the sum clears the ceiling by itself, so the term returns the same value
# for every such candidate: it keeps its weight while separating nothing. When on,
# combine_entity_matches blends the strongest match with the top few instead, which
# stays inside the 0-1 range the weighted total assumes without flattening onto it.
ENTITY_DESATURATION = _scoring_settings.rec_entity_desaturation
ENTITY_DESATURATION_TOP_N = max(1, _scoring_settings.rec_entity_desaturation_top_n)

# The diversity re-ranker blends relevance against a dissimilarity term bounded at 1.0.
# Relevance arrives on the raw weighted scale, where the two are not comparable
# quantities and the blend weight understates how much diversity is actually being
# asked for. When on, relevance is rescaled onto the same 0-1 range first, so the blend
# weight means the share it reads as.
MMR_NORMALIZE_RELEVANCE = _scoring_settings.rec_mmr_normalize_relevance

# Diversity a candidate is credited with when it carries no tag at the requested spoiler
# level. The term is a cosine distance, which is undefined against an empty vector rather
# than maximal, so the default awards the largest possible bonus to the candidates least
# able to earn it. Lowering it treats an absent vector as no diversity evidence. Titles
# with a handful of tags sit next to the untagged ones in the pool and are not covered by
# this, so it bounds the effect rather than removing it.
DIVERSITY_UNTAGGED = _env_float("REC_DIVERSITY_UNTAGGED", 1.0)

# Share of the candidate cut reserved for the sources that name titles related to what the
# reader has already read, against the sources that draw broadly. The cut runs on a salted
# digest that is blind to which source nominated a candidate, so at a pool narrower than
# the union the broad draws displace the related ones in proportion to how many ids each
# contributed rather than to what they are worth. Zero leaves the cut source-blind. Slots
# a bucket cannot fill go to the other, so the share is a floor, not a quota.
CANDIDATE_CUT_PRIORITY_SHARE = _env_float("REC_CANDIDATE_CUT_PRIORITY_SHARE", 0.0)

# When on, the original-language restriction is pushed into the sources that do not carry
# it, alongside the reader's own filters. Each source truncates with a LIMIT and the
# restriction is applied afterwards, at the cut, so a source spends part of its budget on
# titles that are discarded before anything scores them. The sources it costs are the ones
# reading a similarity table, which are also the ones drawing furthest from the head of the
# catalogue, so the budget lost is taken from reach and handed to the broad draw, which is
# the only source already spending all of its own.
#
# It costs those sources a primary-key join each, on rows they were fetching anyway.
SOURCE_OLANG_PUSHDOWN = _env_flag("REC_SOURCE_OLANG_PUSHDOWN", False)

# Candidates collected per result before the cut. Read by the evaluation harness as well,
# so a pool probe describes the pool the scorer was handed rather than a differently sized
# one.
CANDIDATE_LIMIT_FACTOR = _env_int("REC_CANDIDATE_LIMIT_FACTOR", 20)

# Ceiling on the collected pool, whatever the page size implies. The multiple above is what
# a short page needs to be drawn from something wider than itself, but the pool is what
# every signal is scored over, so holding the multiple at a long page buys candidates that
# no reader reaches while the cost of scoring them is paid on the request. Zero lifts the
# ceiling.
CANDIDATE_LIMIT_MAX = _env_int("REC_CANDIDATE_LIMIT_MAX", 900)

# When on, the elite-tag draw ranks a title by the total score of the reader's elite tags it
# carries rather than by its single best one. Tag scores sit on a coarse scale where the top
# value is shared by a large part of the table, so ranking on the best one alone leaves the
# whole draw to the tiebreak; the total separates a title carrying several of the reader's
# tags from one carrying a single common tag.
ELITE_TAG_SUM_ORDER = _env_flag("REC_ELITE_TAG_SUM_ORDER", False)

# Whether the nearest descriptions to a reader's favourites are collected as candidates.
# Every other source reads a table built from vote patterns or crowd-contributed tags, so
# between them they reach the part of the catalogue that has been read, and the broad draw
# reaches the rest at random. This arm is the only one that can name a specific unread
# title as related to what a reader liked, which is what a page has to be able to do
# before most of the catalogue is reachable at all.
#
# It costs no query. The matrix is already resident, and the scan is one matrix product
# handed to a worker thread so the event loop is not held for its duration.
DESC_RETRIEVAL = _env_flag("REC_DESC_RETRIEVAL", not LEGACY_SCORING)

# Favourites the arm looks around, and neighbours taken per favourite. Per favourite
# rather than over the union, so a reader's second interest is not crowded out by
# whichever of their tastes has the denser neighbourhood.
DESC_RETRIEVAL_SEEDS = _env_int("REC_DESC_RETRIEVAL_SEEDS", 12)
DESC_RETRIEVAL_PER_SEED = _env_int("REC_DESC_RETRIEVAL_PER_SEED", 30)

# Share of the collected pool the arm may contribute, before the cut that narrows the
# union to what the scorer sees. The matrix carries every language and the arm cannot
# filter, so part of what it nominates is dropped downstream; the share is a ceiling on
# what it takes from the other sources rather than a quota it fills.
DESC_RETRIEVAL_SHARE = _env_float("REC_DESC_RETRIEVAL_SHARE", 0.6)

# Whether the four entity signals reach a title of their own accord.
#
# Developer, staff, seiyuu and character-trait affinity are all scored and all carry a
# weight a reader can move, but a candidate can only be scored on a signal once some
# source has put it in the pool, and every source above reaches a title through a
# similarity table, crowd-contributed tags or a shuffle. A studio a reader has read
# repeatedly is therefore in the pool by accident or not at all, and raising the weight on
# that signal reorders what the other sources found instead of deciding what is looked
# for. Each arm asks the reader's own strongest affinities of one kind for titles they
# have not read.
#
# On, because a weight that cannot cause retrieval is not a control. Separately switchable,
# because an arm costs a query on every uncached request and its cost and its effect have
# to be measurable one at a time.
DEVELOPER_RETRIEVAL = _env_flag("REC_DEVELOPER_RETRIEVAL", True)
STAFF_RETRIEVAL = _env_flag("REC_STAFF_RETRIEVAL", True)
SEIYUU_RETRIEVAL = _env_flag("REC_SEIYUU_RETRIEVAL", True)
# Tied to the signal: with the signal off the term is not scored, so titles fetched for it
# would be fetched on evidence nothing reads.
TRAIT_RETRIEVAL = _env_flag("REC_TRAIT_RETRIEVAL", TRAIT_SIGNAL)

# Entities one arm asks about, strongest affinity first. A single query covers all of
# them, so this bounds the rows an arm touches rather than the number of queries it costs.
ENTITY_RETRIEVAL_ENTITIES = _env_int("REC_ENTITY_RETRIEVAL_ENTITIES", 20)

# Exponent on how many of the reader's own titles an entity appears on, applied to that
# entity's affinity when the retrieval arms choose which entities to ask about. An affinity
# is a mean, so without this the entities asked about are the ones met once and enjoyed
# rather than the ones the reader returns to. Zero ranks on the mean alone.
ENTITY_SUPPORT_WEIGHT = _env_float("REC_ENTITY_SUPPORT_WEIGHT", 0.5)

# Affinity a creator has to clear before an arm will fetch their other work. An affinity is
# an average excess over the reader's own mean, so a creator whose work the reader returns
# to repeatedly sits near zero by construction: many readings average out to the reader's
# own taste. Admitting only positive affinities therefore asks about the creators met once
# and enjoyed while passing over the ones read most, which is the opposite of the question
# an arm exists to answer. The floor is set below zero so returning to someone's work
# counts as interest in it, and far enough above the bottom that a creator the reader's own
# marks argue against is still left alone.
ENTITY_RETRIEVAL_MIN_AFFINITY = _env_float("REC_ENTITY_RETRIEVAL_MIN_AFFINITY", -0.35)

# Whether an entity arm serves each entity a share of its budget rather than ordering every
# title it found by affinity. Ordered globally the strongest entity fills the budget alone.
ENTITY_ROUND_ROBIN = _env_flag("REC_ENTITY_ROUND_ROBIN", True)

# Slots each arm may contribute to the collected pool, before the cut that narrows the
# union to what the scorer sees. Fixed shares, set against how much the signal is worth
# and how wide its evidence is: a developer is named for nearly every title in the
# catalogue and is the strongest of the four, a cast and a character's traits are the
# weakest and the widest-matching.
DEVELOPER_RETRIEVAL_LIMIT = _env_int("REC_DEVELOPER_RETRIEVAL_LIMIT", 60)
STAFF_RETRIEVAL_LIMIT = _env_int("REC_STAFF_RETRIEVAL_LIMIT", 40)
SEIYUU_RETRIEVAL_LIMIT = _env_int("REC_SEIYUU_RETRIEVAL_LIMIT", 30)
TRAIT_RETRIEVAL_LIMIT = _env_int("REC_TRAIT_RETRIEVAL_LIMIT", 30)

# Characters a trait may be carried by before the trait arm stops asking about it. A trait
# held by a large share of the catalogue's characters names most of the catalogue, so it
# separates nothing while the arm pays its whole scan for it; the ceiling is what keeps the
# arm's cost bounded by the reader's narrower traits rather than by their broadest one.
TRAIT_RETRIEVAL_MAX_CHARS = _env_int("REC_TRAIT_RETRIEVAL_MAX_CHARS", 3000)

# Share of the tag term measured against the reader's individual titles rather than
# against the mean of them. A profile is one vector averaged over everything a reader
# liked, and an average over two distinct tastes points at neither: it sits between them,
# and a title halfway between two things a reader enjoys outscores a title squarely inside
# one of them. The term measured here is the closest single favourite, which is the
# comparison a title's own page makes and the one readers find useful.
#
# Both halves are kept. The mean still carries what is consistent across a whole list,
# which no single title does, so the two answer different questions and the split says how
# much of the term each one settles.
TAG_BEST_MATCH = _env_float("REC_TAG_BEST_MATCH", 0.5)

# Favourites the term compares against, best first. It is a cosine per candidate per
# favourite over sparse vectors, so this bounds a cost paid on every uncached request.
TAG_BEST_MATCH_SEEDS = _env_int("REC_TAG_BEST_MATCH_SEEDS", 12)

# Whether the two item-item signals score a candidate on the single favourite it is
# closest to. Both read one row per favourite and have to fold those rows into one term.
# Off, the term is the strongest match blended with the mean of the matches, and the mean
# ranks a candidate down for also resembling favourites it resembles less, which is more
# evidence for it rather than less. Breadth is credited separately, by the bonus for
# matching several.
ITEM_ITEM_BEST_MATCH = _env_flag("REC_ITEM_ITEM_BEST_MATCH", True)


# Whether the cut that narrows the collected union to the pool the scorer sees keeps each
# source's share of it. The union is wider than the pool, and a cut blind to which source
# named an id keeps them in proportion to how many ids each contributed rather than to what
# the request asked for: a source given a large budget then hands most of what it found to
# the same even slice as everything else, and the split decided at collection is undone one
# step later. Off, the cut takes an even slice of the union and no source is favoured.
CANDIDATE_CUT_BY_SOURCE = _env_flag("REC_CANDIDATE_CUT_BY_SOURCE", True)


# The candidate sources, in the order they are collected. Named so a budget can be
# addressed by source rather than by position in a tuple of numbers.
RETRIEVAL_ARM_ORDER = (
    "similar",
    "exploration",
    "elite_tag",
    "description",
    "cooccurrence",
    "developer",
    "staff",
    "seiyuu",
    "trait",
)

# The signal each source fetches evidence for. A weight decides how a candidate ranks
# once it is in the pool, and this is what lets the same weight decide whether anything
# goes looking for one: a source serving a signal the reader turned down spends less of
# the budget, and one serving a signal they turned up spends more.
#
# The exploration draw is absent because it serves no single signal. It is the only
# source that reaches a title unconnected to anything the reader has read, so nothing on
# the slider panel describes it and no slider owns it.
RETRIEVAL_ARM_SIGNALS = {
    "similar": "similar_games",
    "elite_tag": "tag",
    "description": "description",
    "cooccurrence": "users_also_read",
    "developer": "developer",
    "staff": "staff",
    "seiyuu": "seiyuu",
    "trait": "trait",
}

# Whether the weight vector decides the split of the collection budget as well as the
# ranking. Off, every source spends a fixed budget and a weight can only reorder what the
# sources happened to find, which for a signal whose source is small is the difference
# between a control and a decoration.
RETRIEVAL_WEIGHT_BUDGETS = _env_flag("REC_RETRIEVAL_WEIGHT_BUDGETS", True)

# How sharply a source's budget follows its signal's weight. A source's share is its
# fixed share scaled by the weight the request gives its signal against the weight the
# default vector gives it, raised to this. One leaves the two proportional: a signal
# asked for at twice its usual weight fetches twice as much. Above one the split is more
# decisive than the ranking, below one more conservative. The scaling is relative to the
# default weight rather than absolute, so a request naming no weights receives exactly
# the fixed split whatever the default vector happens to be.
RETRIEVAL_WEIGHT_GAMMA = _env_float("REC_RETRIEVAL_WEIGHT_GAMMA", 1.0)

# Least of its usual share a source keeps while its signal carries any weight at all.
# A pool drawn from one source is a page with one kind of reason behind it, and a reader
# lowering a slider is saying they want less of that evidence rather than none of it.
# Zero is left reachable and means what it says: at no weight the source is not consulted
# and costs nothing.
RETRIEVAL_ARM_FLOOR = _env_float("REC_RETRIEVAL_ARM_FLOOR", 0.25)


# ---------------------------------------------------------------------------
# What a retrieval arm returns
#
# An arm answers with the titles it found, strongest first, each carrying the quantity it
# ranked that title by. The quantities are the arm's own and mean different things between
# arms, so nothing compares them directly; what crosses arms is the position. A caller
# wanting only membership takes the ids.
#
# Every arm already computed an ordering to decide what survived its own limit, so this
# keeps a quantity that existed rather than deriving one.
# ---------------------------------------------------------------------------
RankedCandidates = list[tuple[str, float]]


def ranked_ids(ranked: Sequence[tuple[str, float]]) -> list[str]:
    """The ids of a ranked answer, order kept."""
    return [vn_id for vn_id, _ in ranked]


def dedupe_ranked(pairs: Iterable[tuple[str, float]]) -> RankedCandidates:
    """One entry per id, at the best position it reached.

    A title connected to several of the reader's own is named once per connection, and the
    strongest of them is what the arm found: keeping the first occurrence of an already
    ordered sequence keeps that one and discards the weaker repeats.
    """
    seen: set[str] = set()
    ranked: RankedCandidates = []
    for vn_id, strength in pairs:
        if vn_id in seen:
            continue
        seen.add(vn_id)
        ranked.append((vn_id, float(strength)))
    return ranked


def retrieval_budgets(
    baseline: dict[str, int],
    weights: Optional[dict[str, float]] = None,
) -> dict[str, int]:
    """Split the collection budget between the candidate sources under one weight vector.

    The budget as a whole is what the fixed shares already add up to, so this decides how
    it is divided and never how much is spent. Each source's share is its fixed share
    scaled by how the request weights the signal it serves, measured against the default
    weight for that signal: at the default vector every scale is one and the split is the
    fixed one exactly.

    The exploration draw serves no single signal, so it follows the mean of the vector.
    That leaves it steady when a reader redistributes weight and shrinking only when they
    flatten the whole panel, and it cannot displace a source a reader asked for: raising
    one weight moves that source's share by the whole of the change and exploration's by a
    ninth of it.

    A signal at no weight leaves its source at nothing, which the caller reads as not
    running it at all rather than as running it for no rows.
    """
    if not RETRIEVAL_WEIGHT_BUDGETS or not weights:
        return dict(baseline)

    default_mean = sum(SIGNAL_WEIGHTS.values()) / len(SIGNAL_WEIGHTS)
    try:
        asked_mean = sum(weights[name] for name in SIGNAL_WEIGHTS) / len(SIGNAL_WEIGHTS)
    except KeyError:
        # A vector naming fewer signals than the engine scores describes a split of
        # something other than this budget, so the fixed one stands.
        logger.warning("Weight vector does not name every signal; keeping the fixed budgets")
        return dict(baseline)

    # A vector naming one signal is a request for that signal's own answer, not for a page
    # balanced around it. The sources serving other signals already fall to nothing on their
    # own weight; the broad draw follows no signal and would otherwise keep its share and
    # fill the rest of the page with titles the named signal never reached. A list that
    # finds forty answers is forty answers.
    named = [name for name in SIGNAL_WEIGHTS if weights.get(name, 0) > 0]
    single_signal = len(named) == 1

    def scale(arm: str) -> float:
        if arm not in RETRIEVAL_ARM_SIGNALS:
            if single_signal:
                return 0.0
            ratio = asked_mean / default_mean if default_mean > 0 else 1.0
            return max(0.0, ratio) ** RETRIEVAL_WEIGHT_GAMMA
        signal = RETRIEVAL_ARM_SIGNALS[arm]
        asked = weights[signal]
        if asked <= 0:
            return 0.0
        usual = SIGNAL_WEIGHTS.get(signal, 0.0)
        if usual <= 0:
            # The default vector does not score this signal, so there is no usual share to
            # scale. Asking for it at all buys the fixed share and no more.
            return 1.0
        return max(RETRIEVAL_ARM_FLOOR, (asked / usual) ** RETRIEVAL_WEIGHT_GAMMA)

    names = [name for name in RETRIEVAL_ARM_ORDER if name in baseline]
    shares = tuple(max(0.0, baseline[name]) * scale(name) for name in names)
    if sum(shares) <= 0:
        return dict(baseline)
    quotas = allocate_shares(sum(max(0, baseline[name]) for name in names), shares)
    return dict(zip(names, quotas))


# ---------------------------------------------------------------------------
# Predicted rating
#
# A signal that ranks a candidate can sometimes also say what the reader would mark it.
# The profile already holds every entity as the reader's own damped mean rating for the
# titles carrying it, on the same 1-10 scale a rating is given on, so a candidate's
# prediction under one signal is an average over the entities it matched. Nothing is
# rescaled: the quantity being averaged is already a rating, and the reader's own mean is
# what it is measured against.
#
# A signal holding no such quantity abstains. A number derived from a closeness has the
# shape of a rating and none of its meaning, and once produced it enters the mean and the
# interval on equal terms with the predictions that do mean something. Silence is
# recoverable downstream; a fabricated mark is not.
# ---------------------------------------------------------------------------
RATING_FLOOR = 1.0
RATING_CEILING = 10.0

# Whether the engine computes a predicted rating per signal alongside the per-signal
# scores. Off, nothing here runs and no result carries a prediction, so the scoring and
# the ordering are the ones the engine had without it.
PREDICTED_RATING = _env_flag("REC_PREDICTED_RATING", False)

# How much of the reader's own list an entity has to stand on before its mean is trusted
# on its own. Below it the entity's mean and the reader's are mixed in proportion. The
# default is off because the means being averaged are damped toward the reader's own
# already, and shrinking a shrunk mean measures worse than the mean alone: what is left to
# correct is real signal from an entity the reader has read a few times.
PREDICTION_MIN_SUPPORT = _env_int("REC_PREDICTION_MIN_SUPPORT", 0)

# Least closeness a neighbour needs before it is read as saying anything about a
# candidate. Below it the reader's mark for that title is noise being averaged in.
PREDICTION_NEIGHBOUR_FLOOR = _env_float("REC_PREDICTION_NEIGHBOUR_FLOOR", 0.15)

# How many of the reader's own titles a neighbour-based prediction is read off.
PREDICTION_NEIGHBOURS = _env_int("REC_PREDICTION_NEIGHBOURS", 10)

# Whether the crowd's own average is offered as a prediction of what this reader would
# mark a title, shifted by how far the reader sits from the crowd on the titles they have
# both rated. Unshifted it predicts the crowd rather than the reader; the shift is what
# makes it a statement about this reader at all.
PREDICTION_QUALITY = _env_flag("REC_PREDICTION_QUALITY", True)

# Whether the signals' marks are combined by how well each of them predicts, rather than
# counted once each. The signals are not equally accurate: measured against marks readers
# went on to give, the crowd's own average lands closer than tag affinity does, and a
# plain mean spends as much of itself on the weaker of the two. An unweighted combination
# of members that differ that much is worse than its best member alone, and against
# held-out ratings on readers whose lists the weights below were not read from, it is.
# Weighting recovers nearly all of that difference while keeping the result a combination,
# which is what the per-signal marks and the spread between them are reported against.
# Off, every signal that spoke counts once and the interval is the plain sample one.
PREDICTION_WEIGHTED = _env_flag("REC_PREDICTION_WEIGHTED", True)

# How much each signal's mark improves on knowing nothing about a title but the reader's
# own average, in points of the 1-10 scale, measured over held-out ratings on the titles
# that signal spoke about. A signal carries its entry directly, so a signal that halves
# the distance another one closes has half its say.
#
# Improvement over the reader's own mean rather than distance from the truth, because the
# reader's mean is what the combination would fall back to if every signal abstained, and
# it already accounts for most of where a mark lands. Two signals can be almost equally
# accurate in absolute terms while one of them adds several times as much as the other to
# what the reader's average already says, and it is that difference the weights exist to
# express.
#
# Only the ratios are used, so scaling the whole table changes nothing. The numbers
# describe the catalogue and the reading population they were measured on and drift with
# both, so they are overridable one at a time and a sweep can move one without restating
# the rest.
PREDICTION_SIGNAL_WEIGHT = _env_signal_map(
    "REC_PREDICTION_SIGNAL_WEIGHT",
    {
        "quality": 0.209,
        "developer": 0.174,
        "similar_games": 0.144,
        "staff": 0.113,
        "seiyuu": 0.070,
        "description": 0.044,
        "tag": 0.042,
        "trait": 0.012,
    },
)

# Floor under an entry in that table. A signal measured as adding nothing to the reader's
# own average still spoke, and a weight of zero would drop it from the mean and from the
# spread while leaving it listed among the signals that had something to say. The floor
# also keeps an environment override from reducing the combination to a single number.
MIN_PREDICTION_WEIGHT = 0.005


def clamp_rating(value: float) -> float:
    """A predicted mark, held inside the scale marks are given on."""
    return min(RATING_CEILING, max(RATING_FLOOR, value))


def predict_from_entities(
    matched: Sequence[tuple[float, float, float]],
    reader_mean: float,
) -> Optional[float]:
    """One signal's predicted rating from the entities a candidate matched.

    Each entry is the entity's own mean rating from this reader, the weight it carries in
    the average, and how many of the reader's titles stand behind it. Weight and support
    are separate because they answer different questions: weight is how much of the
    candidate the entity accounts for, support is how much the reader's mark for it can be
    trusted, and a tag can be central to a title while resting on two of the reader's.

    The best-supported match decides how far the result may leave the reader's mean, so a
    candidate matching only thinly held entities is predicted close to it.

    None where nothing matched. That is silence, not a low mark.
    """
    total = 0.0
    weight = 0.0
    best_support = 0.0
    for score, entry_weight, support in matched:
        entry_weight = max(0.0, float(entry_weight))
        if entry_weight <= 0:
            continue
        total += float(score) * entry_weight
        weight += entry_weight
        best_support = max(best_support, max(0.0, float(support)))
    if weight <= 0:
        return None
    mean = total / weight
    if PREDICTION_MIN_SUPPORT > 0 and best_support < PREDICTION_MIN_SUPPORT:
        trust = best_support / PREDICTION_MIN_SUPPORT
        mean = trust * mean + (1 - trust) * reader_mean
    return clamp_rating(mean)


def predict_from_neighbours(
    neighbours: Sequence[tuple[float, float]],
    limit: int = 0,
) -> Optional[float]:
    """A predicted rating read off the reader's own marks for the titles a candidate
    resembles.

    Each entry pairs a closeness with the mark the reader gave that title. The closeness
    weights the average and is never itself turned into a rating: it says which of the
    reader's titles the mark should be read from, not what the mark is.

    The reader's whole rated list has to be on the other side of this, not their
    favourites. Neighbours drawn from titles the reader liked carry only marks above their
    mean, so an average over them is bounded below by the worst favourite and predicts
    every candidate well however little it resembles anything.

    None where no neighbour is close enough to speak.
    """
    close = sorted(
        (
            (closeness, rating)
            for closeness, rating in neighbours
            if closeness > PREDICTION_NEIGHBOUR_FLOOR
        ),
        reverse=True,
    )
    if limit > 0:
        close = close[:limit]
    total = sum(closeness * rating for closeness, rating in close)
    weight = sum(closeness for closeness, _ in close)
    if weight <= 0:
        return None
    return clamp_rating(total / weight)

# ---------------------------------------------------------------------------
# The mean of the per-signal predictions, and the spread between them
#
# The interval is the disagreement between the signals, not a forecast error. It says how
# far apart the signals that spoke are, and nothing about whether they are collectively
# right: signals sharing a mistake produce a narrow interval around the wrong number. It
# is quoted as a confidence interval for the mean of the individual predictions, which is
# the quantity it actually describes.
#
# One prediction has no spread. A range invented around a single number would be read as a
# measurement and is not one, so a lone signal is reported as a point and nothing else.
#
# Under PREDICTION_WEIGHTED the mean is weighted and so is the spread, and the count the
# interval is scaled by stops being the number of signals that spoke. Weighting is a claim
# that some of those signals say more than others, and an interval that ignored it would
# report the confidence of a panel while quoting the verdict of its chair. The count used
# instead is the effective one: how many equally weighted signals would carry as much as
# these unequally weighted ones do. It equals the number that spoke when the weights are
# level and falls away from it as they spread.
# ---------------------------------------------------------------------------

# Two-sided 97.5% Student-t quantiles by degrees of freedom, indexed from df=1. Only as
# deep as the signal count can reach; beyond it the last entry stands, which is within a
# few hundredths of the normal quantile.
_T_QUANTILES = (
    12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228,
)


def _t_quantile(degrees_of_freedom: int) -> float:
    index = min(max(degrees_of_freedom, 1), len(_T_QUANTILES)) - 1
    return _T_QUANTILES[index]


def prediction_weight(signal: str) -> float:
    """How much of the combined mark one signal carries.

    How much that signal was measured to add over the reader's own average. A signal the
    table does not name is treated as typical rather than dropped: an unmeasured signal is
    not the same as one measured and found to say nothing.
    """
    weights = PREDICTION_SIGNAL_WEIGHT
    typical = sum(weights.values()) / len(weights) if weights else 1.0
    return max(weights.get(signal, typical), MIN_PREDICTION_WEIGHT)


def prediction_interval(
    predictions: Union[Mapping[str, float], Iterable[float]],
) -> tuple[Optional[float], Optional[float], Optional[float]]:
    """Mean of the signals' predicted marks, with the range the signals disagree over.

    Takes the signals by name so each can be weighted by how well it predicts. A bare
    sequence carries no names, so it is always averaged; that is the caller with nothing
    to weight by rather than a caller opting out.

    Returns mean, low, high. Low and high are None where fewer than two signals spoke:
    the spread of one number is not zero, it is unmeasured, and reporting it as zero
    claims an agreement that was never tested.

    The range is the 95% interval for the mean under the signals' own scatter, held inside
    the scale marks are given on. It widens sharply when only two or three signals speak,
    which is the honest reading of how little that many numbers say about their own spread.
    """
    if isinstance(predictions, Mapping):
        weighted = [
            (float(value), prediction_weight(signal) if PREDICTION_WEIGHTED else 1.0)
            for signal, value in predictions.items()
        ]
    else:
        weighted = [(float(value), 1.0) for value in predictions]
    if not weighted:
        return None, None, None
    total = sum(weight for _, weight in weighted)
    mean = sum(value * weight for value, weight in weighted) / total
    if len(weighted) < 2:
        return clamp_rating(mean), None, None
    effective = total**2 / sum(weight**2 for _, weight in weighted)
    # The weighted scatter, on the same footing as the unweighted one: dividing by the
    # weight left after one effective signal is spent estimating the mean is what makes
    # this reduce exactly to the plain sample variance when the weights are level.
    spread = total * (1 - 1 / effective)
    if spread <= 0:
        return clamp_rating(mean), None, None
    variance = sum(weight * (value - mean) ** 2 for value, weight in weighted) / spread
    half = _t_quantile(int(effective) - 1) * math.sqrt(variance / effective)
    return clamp_rating(mean), clamp_rating(mean - half), clamp_rating(mean + half)


# ---------------------------------------------------------------------------
# Rank agreement between the signals
#
# The alternative to the weighted sum. Each signal ranks the candidates it scored above
# zero, and a candidate's standing is how high it placed across those rankings rather than
# how much score it accumulated in them.
#
# Two properties the weighted sum does not have:
#
# - Nothing is compared across signals except position, so no signal has to be put on any
#   other's scale. Under a sum a term's influence is its spread times its weight, and only
#   the weight is visible, so the balance a weight vector describes is not the balance the
#   scoring runs at.
# - A signal that gives most candidates the same score cannot decide anything. Its tied
#   candidates share one position, and a position shared by many is a deep one, so a
#   signal that separates nothing contributes little to everyone. Under a sum the same
#   signal adds a near-identical term to every candidate at full weight: it moves no
#   ordering at any setting, which is a slider that cannot do anything.
#
# Reciprocal rank fusion is the standard form: a candidate scores 1/(k + position) in each
# ranking it reaches, summed. k sets how much a top position is worth against a deep one.
# ---------------------------------------------------------------------------

# Whether the combined list is ordered by agreement between the signals' rankings or by
# the weighted sum of their scores. Agreement is the default. A signal returning the same
# score for most candidates is inert in a sum, since a constant added to every candidate
# cannot reorder them at any weight, so a reader adjusting that signal's weight sees the
# list stand still. Under agreement each signal contributes a position instead, which no
# amount of flatness can turn into a constant. The sum stays reachable so the two remain
# measurable against each other on one deployment.
AGGREGATION = (os.getenv("REC_AGGREGATION") or "fusion").strip().lower() or "fusion"

# Damping in 1/(k + position). It fixes the ratio between the best and the worst admitted
# position, which is the whole of how the shape trades depth in one ranking against
# breadth across several. The value carried over from the retrieval literature is 60,
# chosen for runs thousands of entries deep; over a ranking cut at FUSION_DEPTH it leaves
# first place worth about twice last place, so a title top of one ranking cannot outrank
# one sitting at the bottom of three and the aggregate collapses into a count of rankings
# reached. Lower is sharper: at the default, first place is worth several times last, so
# placing top of one ranking beats placing deep in a handful.
FUSION_K = _env_float("REC_FUSION_K", 10.0)

# How far down each signal's ranking still counts as that signal recommending a title.
# Without a cut every signal holding data for a candidate votes for it, the count of
# rankings a title reached becomes a count of signals that had something on file, and the
# aggregate stops distinguishing the titles a signal actually put near the top.
#
# The cut is absolute while the pool it cuts is proportional to the page size, so an
# agreement figure describes a title against the pool its own request drew. Two requests
# at different page sizes do not produce comparable percentages, and a client showing one
# beside the other is comparing two scales.
FUSION_DEPTH = _env_int("REC_FUSION_DEPTH", 64)


def rank_positions(ranked: Sequence[tuple[str, float]]) -> dict[str, float]:
    """Position of each entry in a ranking, tied entries sharing the mean of the positions
    they span.

    Ties have to share rather than be broken, and the shared position has to be the mean
    of the block rather than its first place. A signal scoring forty candidates alike has
    not put any of them first; giving that block first place would let a signal that
    separates nothing outrank every signal that does, which is the failure this shape
    exists to avoid. The mean puts the block where its size says it belongs, so the less a
    signal discriminates the less it contributes to anything.

    Input must already be ordered, strongest first.
    """
    positions: dict[str, float] = {}
    start = 0
    while start < len(ranked):
        end = start + 1
        while end < len(ranked) and ranked[end][1] == ranked[start][1]:
            end += 1
        # Positions number from one, so the block spans start+1 through end.
        shared = (start + 1 + end) / 2
        for vn_id, _ in ranked[start:end]:
            positions[vn_id] = shared
        start = end
    return positions


def signal_ranking(
    scores: Iterable[tuple[str, float]],
    depth: int = 0,
) -> dict[str, float]:
    """One signal's ranking over the candidates it scored, as position per candidate.

    A zero is not a vote. It is either a signal with no data for the title or a signal
    saying the title matches nothing it knows about the reader, and neither is a
    recommendation.

    ``depth`` drops the positions past the cut. A tied block is admitted on its shared
    position, so the cut never has to choose between candidates the signal called equal.
    """
    ranked = sorted(
        ((vn_id, float(score)) for vn_id, score in scores if score > 0),
        key=lambda pair: (-pair[1], pair[0]),
    )
    positions = rank_positions(ranked)
    if depth > 0:
        positions = {
            vn_id: position for vn_id, position in positions.items() if position <= depth
        }
    return positions


def fuse_rankings(
    rankings: Iterable[dict[str, float]],
    k: float = FUSION_K,
    shares: Optional[Iterable[float]] = None,
) -> dict[str, tuple[float, int]]:
    """Sum 1/(k + position) across the rankings, with the count of rankings each candidate
    reached.

    The count travels with the total because the total alone cannot be read: the same
    figure comes from one first place and from three middling ones, and which of those a
    title is changes what it is being offered as.

    `shares` weights each ranking's contribution. Without it a signal that can place every
    candidate contributes to every candidate, while one that speaks for a handful
    contributes to a handful, so the broadest signal decides the page whatever it is worth:
    reach becomes weight by the back door. A share per ranking makes what a signal is worth
    a property of the vector the request carries rather than of how much of the catalogue
    it happens to describe.
    """
    weights = list(shares) if shares is not None else None
    fused: dict[str, tuple[float, int]] = {}
    for index, positions in enumerate(rankings):
        share = 1.0 if weights is None else (weights[index] if index < len(weights) else 0.0)
        if share <= 0:
            continue
        for vn_id, position in positions.items():
            total, reached = fused.get(vn_id, (0.0, 0))
            fused[vn_id] = (total + share / (k + position), reached + 1)
    return fused


def fusion_confidence(
    total: float,
    rankings_run: int,
    k: float = FUSION_K,
    share_total: Optional[float] = None,
) -> int:
    """Agreement between the signals as a percentage, 0-100.

    100% is a title placed first in every ranking that ran. A title first in one ranking
    of nine and absent from the rest reaches about eleven; one placed mid-table in all
    nine reaches somewhat less. The figure states breadth and depth of agreement together,
    and it is not a probability, a predicted rating, or a share of anything.

    The denominator counts the rankings that actually ran for this reader rather than
    every signal the engine holds, so a reader for whom a signal produced nothing is not
    permanently held below 100%. Rankings can carry unequal weight, so a caller that
    weights them passes their combined share as the ceiling; without it each ranking
    counts for one.
    """
    if rankings_run <= 0:
        return 0
    ceiling = (rankings_run if share_total is None else share_total) / (k + 1.0)
    if ceiling <= 0:
        return 0
    return int(round(min(1.0, total / ceiling) * 100))

# Environment variable per switch, paired with the module global it is bound to. Kept
# beside the constants so a switch added without a way to record it is visible here.
SWITCH_ENV_VARS = (
    ("REC_PREDICTED_RATING", "PREDICTED_RATING"),
    ("REC_PREDICTION_MIN_SUPPORT", "PREDICTION_MIN_SUPPORT"),
    ("REC_PREDICTION_NEIGHBOUR_FLOOR", "PREDICTION_NEIGHBOUR_FLOOR"),
    ("REC_PREDICTION_NEIGHBOURS", "PREDICTION_NEIGHBOURS"),
    ("REC_PREDICTION_QUALITY", "PREDICTION_QUALITY"),
    ("REC_PREDICTION_WEIGHTED", "PREDICTION_WEIGHTED"),
    ("REC_PREDICTION_SIGNAL_WEIGHT", "PREDICTION_SIGNAL_WEIGHT"),
    ("REC_AGGREGATION", "AGGREGATION"),
    ("REC_FUSION_K", "FUSION_K"),
    ("REC_FUSION_DEPTH", "FUSION_DEPTH"),
    ("REC_SCORING_MODEL", "SCORING_MODEL"),
    ("REC_SIGNAL_WEIGHTS", "SIGNAL_WEIGHTS"),
    ("REC_CATALOGUE_BLEND", "CATALOGUE_BLEND"),
    ("REC_CATALOGUE_EVIDENCE_FLOOR_SHARE", "CATALOGUE_EVIDENCE_FLOOR_SHARE"),
    ("REC_CATALOGUE_MATCH_PRESENCE", "CATALOGUE_MATCH_PRESENCE"),
    ("REC_DESC_SIGNAL", "DESC_SIGNAL"),
    ("REC_DESC_COSINE_FLOOR", "DESC_COSINE_FLOOR"),
    ("REC_DESC_COSINE_CEILING", "DESC_COSINE_CEILING"),
    ("REC_DESC_BEST_MATCH", "DESC_BEST_MATCH"),
    ("REC_DESC_SEEDS", "DESC_SEEDS"),
    ("REC_DESC_RETRIEVAL", "DESC_RETRIEVAL"),
    ("REC_DESC_RETRIEVAL_SEEDS", "DESC_RETRIEVAL_SEEDS"),
    ("REC_DESC_RETRIEVAL_PER_SEED", "DESC_RETRIEVAL_PER_SEED"),
    ("REC_DESC_RETRIEVAL_SHARE", "DESC_RETRIEVAL_SHARE"),
    ("REC_DESC_RETRIEVAL_BAND_SHARES", "DESC_RETRIEVAL_BAND_SHARES"),
    ("REC_DEVELOPER_RETRIEVAL", "DEVELOPER_RETRIEVAL"),
    ("REC_STAFF_RETRIEVAL", "STAFF_RETRIEVAL"),
    ("REC_SEIYUU_RETRIEVAL", "SEIYUU_RETRIEVAL"),
    ("REC_TRAIT_RETRIEVAL", "TRAIT_RETRIEVAL"),
    ("REC_ENTITY_RETRIEVAL_ENTITIES", "ENTITY_RETRIEVAL_ENTITIES"),
    ("REC_ENTITY_SUPPORT_WEIGHT", "ENTITY_SUPPORT_WEIGHT"),
    ("REC_ENTITY_RETRIEVAL_MIN_AFFINITY", "ENTITY_RETRIEVAL_MIN_AFFINITY"),
    ("REC_ENTITY_ROUND_ROBIN", "ENTITY_ROUND_ROBIN"),
    ("REC_DEVELOPER_RETRIEVAL_LIMIT", "DEVELOPER_RETRIEVAL_LIMIT"),
    ("REC_STAFF_RETRIEVAL_LIMIT", "STAFF_RETRIEVAL_LIMIT"),
    ("REC_SEIYUU_RETRIEVAL_LIMIT", "SEIYUU_RETRIEVAL_LIMIT"),
    ("REC_TRAIT_RETRIEVAL_LIMIT", "TRAIT_RETRIEVAL_LIMIT"),
    ("REC_TRAIT_RETRIEVAL_MAX_CHARS", "TRAIT_RETRIEVAL_MAX_CHARS"),
    ("REC_RETRIEVAL_WEIGHT_BUDGETS", "RETRIEVAL_WEIGHT_BUDGETS"),
    ("REC_RETRIEVAL_WEIGHT_GAMMA", "RETRIEVAL_WEIGHT_GAMMA"),
    ("REC_RETRIEVAL_ARM_FLOOR", "RETRIEVAL_ARM_FLOOR"),
    ("REC_TAG_BEST_MATCH", "TAG_BEST_MATCH"),
    ("REC_TAG_BEST_MATCH_SEEDS", "TAG_BEST_MATCH_SEEDS"),
    ("REC_ITEM_ITEM_BEST_MATCH", "ITEM_ITEM_BEST_MATCH"),
    ("REC_CANDIDATE_CUT_BY_SOURCE", "CANDIDATE_CUT_BY_SOURCE"),
    ("REC_EVIDENCE_DENOMINATOR", "EVIDENCE_DENOMINATOR"),
    ("REC_QUALITY_STRICT", "QUALITY_STRICT"),
    ("REC_TAG_COSINE", "TAG_COSINE"),
    ("REC_TAG_MEAN_NORM", "TAG_MEAN_NORM"),
    ("REC_TAG_SUPPORT_SHARE", "TAG_SUPPORT_SHARE"),
    ("REC_TAG_EXCLUDE_TECHNICAL", "TAG_EXCLUDE_TECHNICAL"),
    ("REC_EXPLORATION_OPEN", "EXPLORATION_OPEN"),
    ("REC_EXPLORATION_MIN_AVERAGE", "EXPLORATION_MIN_AVERAGE"),
    ("REC_EXPLORATION_MIN_VOTES", "EXPLORATION_MIN_VOTES"),
    ("REC_COOCCURRENCE_MIN_USERS", "COOCCURRENCE_MIN_USERS"),
    ("REC_EXPLORATION_STRATIFIED", "EXPLORATION_STRATIFIED"),
    ("REC_DISLIKE_DAMPING", "DISLIKE_DAMPING"),
    ("REC_DISLIKE_MIN_SUPPORT", "DISLIKE_MIN_SUPPORT"),
    ("REC_DISLIKE_FLOOR", "DISLIKE_FLOOR"),
    ("REC_TASTE_SHARPNESS", "TASTE_SHARPNESS"),
    ("REC_DISLIKE_NEGATIVE", "DISLIKE_NEGATIVE"),
    ("REC_RELATION_EXCLUSION", "RELATION_EXCLUSION"),
    ("REC_CONTINUATIONS", "CONTINUATIONS"),
    ("REC_ENTITY_PREFERENCE", "ENTITY_PREFERENCE"),
    ("REC_EXPLORATION_REQUIRE_EVIDENCE", "EXPLORATION_REQUIRE_EVIDENCE"),
    ("REC_VOTE_HALF_LIFE_DAYS", "VOTE_HALF_LIFE_DAYS"),
    ("REC_CF_SIGNAL_WEIGHT", "CF_SIGNAL_WEIGHT"),
    ("REC_TAG_CENTERING", "TAG_CENTERING"),
    ("REC_UNRATED_AS_EVIDENCE", "UNRATED_AS_EVIDENCE"),
    ("REC_UNRATED_EVIDENCE_SCORE", "UNRATED_EVIDENCE_SCORE"),
    ("REC_ENTITY_DESATURATION", "ENTITY_DESATURATION"),
    ("REC_ENTITY_DESATURATION_TOP_N", "ENTITY_DESATURATION_TOP_N"),
    ("REC_MMR_NORMALIZE_RELEVANCE", "MMR_NORMALIZE_RELEVANCE"),
    ("REC_DIVERSITY_UNTAGGED", "DIVERSITY_UNTAGGED"),
    ("REC_CANDIDATE_CUT_PRIORITY_SHARE", "CANDIDATE_CUT_PRIORITY_SHARE"),
    ("REC_CANDIDATE_LIMIT_FACTOR", "CANDIDATE_LIMIT_FACTOR"),
    ("REC_CANDIDATE_LIMIT_MAX", "CANDIDATE_LIMIT_MAX"),
    ("REC_EXPLORATION_BAND_SHARES", "EXPLORATION_BAND_SHARES"),
    ("REC_CANDIDATE_CUT_BAND_SHARES", "CANDIDATE_CUT_BAND_SHARES"),
    ("REC_SOURCE_OLANG_PUSHDOWN", "SOURCE_OLANG_PUSHDOWN"),
    ("REC_RETRIEVAL_SEED_SPREAD", "RETRIEVAL_SEED_SPREAD"),
    ("REC_TRAIT_SIGNAL", "TRAIT_SIGNAL"),
    ("REC_ELITE_TAG_SUM_ORDER", "ELITE_TAG_SUM_ORDER"),
    ("REC_POPULARITY_CALIBRATION", "POPULARITY_CALIBRATION"),
    ("REC_POPULARITY_BAND_EDGES", "POPULARITY_BAND_EDGES"),
    ("REC_POPULARITY_CALIBRATION_MIX", "POPULARITY_CALIBRATION_MIX"),
    ("REC_POPULARITY_PROFILE_FLOOR", "POPULARITY_PROFILE_FLOOR"),
    ("REC_POPULARITY_CALIBRATION_POOL", "POPULARITY_CALIBRATION_POOL"),
    ("REC_BLEND_TOP_K", "BLEND_TOP_K"),
    ("REC_BLEND_TOP_K_RESCALE", "BLEND_TOP_K_RESCALE"),
    ("REC_PER_USER_WEIGHTS", "PER_USER_WEIGHTS"),
    ("REC_PER_USER_WEIGHTS_GAMMA", "PER_USER_WEIGHTS_GAMMA"),
    ("REC_PER_USER_WEIGHTS_MAX_RATIO", "PER_USER_WEIGHTS_MAX_RATIO"),
    ("REC_PER_USER_WEIGHTS_MIN_PROFILE", "PER_USER_WEIGHTS_MIN_PROFILE"),
    ("REC_PER_USER_WEIGHTS_MIN_CLASS", "PER_USER_WEIGHTS_MIN_CLASS"),
    ("REC_PER_USER_WEIGHTS_MIN_PAIRS", "PER_USER_WEIGHTS_MIN_PAIRS"),
    ("REC_PER_USER_WEIGHTS_SEED_SHARE", "PER_USER_WEIGHTS_SEED_SHARE"),
    ("REC_PER_USER_WEIGHTS_USE_DROPPED", "PER_USER_WEIGHTS_USE_DROPPED"),
    ("REC_PER_USER_WEIGHTS_ABAR", "SIGNAL_AUC_MEAN"),
    ("REC_PER_USER_WEIGHTS_TAU2", "SIGNAL_AUC_VARIANCE"),
)


def switch_settings() -> dict[str, str | bool | int | float | tuple[float, ...] | dict[str, float]]:
    """Effective value of each declared switch, keyed by the variable that overrides it.

    A stored result that does not name the configuration behind it cannot be compared
    against another, so a run record carries this rather than its own arguments alone.
    """
    return {env_var: globals()[global_name] for env_var, global_name in SWITCH_ENV_VARS}


def combine_entity_matches(contributions: list[float]) -> float:
    """Fold one candidate's per-entity affinity contributions into a single 0-1 term.

    Shared by every entity signal so the four cannot drift apart, and so a change to how
    matches combine is made once rather than in four places that only look alike.

    The result is clamped either way: the weighted total is divided by a fixed sum that
    assumes each signal is bounded at 1.0, and a term above that would take score from
    the signals it is meant to sit alongside.
    """
    if not contributions:
        return 0.0
    if not ENTITY_DESATURATION:
        return min(1.0, sum(contributions, 0.0))
    strongest = sorted(contributions, reverse=True)[:ENTITY_DESATURATION_TOP_N]
    # Half the term is the single best match and half the mean of the best few, so depth
    # on one entity and breadth across several are both visible in the result, and
    # neither one alone pins the term at its ceiling.
    return min(1.0, 0.5 * (sum(strongest) / len(strongest)) + 0.5 * strongest[0])


# Order in which the eight weighted terms are added. Floating-point addition is not
# associative, so the order is named rather than left to dictionary iteration: summing
# the same terms in another order moves the last bits of every score, and with them any
# ranking that turns on a tie.
SIGNAL_SUM_ORDER = (
    "tag",
    "similar_games",
    "users_also_read",
    "developer",
    "staff",
    "seiyuu",
    "trait",
    "quality",
    "description",
)


def weighted_total(scores: dict[str, float], weights: dict[str, float]) -> float:
    """Blend one candidate's per-signal scores under a weight vector, as one flat sum.

    The shape the catalogue blend replaces, kept reachable so the blend can be measured
    against it. Under a vector giving description no weight it returns exactly what it
    returned before that signal existed.
    """
    return sum(scores[name] * weights[name] for name in SIGNAL_SUM_ORDER)


def strongest_reasons(scores: dict[str, float], weights: dict[str, float]) -> float:
    """A candidate's score from the few signals with most to say about it.

    A flat sum over every signal answers "how much does this title have going for it at
    all", which is a different question from "is there a reason to read this". A title that
    is a close match on one thing and unremarkable on the rest sums below one that is
    unremarkable on everything, because there are more ways to be unremarkable than to be
    close. Summing only the leading contributions asks the second question: a title earns
    its place on the strength of its best reasons rather than on the breadth of its faint
    ones.

    Scaled back up by how much of the weight the kept signals represent, so a score keeps
    the range the rest of the system reads it at and stays comparable to one blended over
    every signal.
    """
    contributions = sorted(
        (scores[name] * weights[name] for name in SIGNAL_SUM_ORDER), reverse=True
    )
    kept = contributions[:BLEND_TOP_K]
    total = sum(kept)
    if not BLEND_TOP_K_RESCALE:
        return total
    whole = weight_total(weights)
    leading = sum(sorted(weights[name] for name in SIGNAL_SUM_ORDER)[-BLEND_TOP_K:])
    if leading <= 0:
        return total
    return total * (whole / leading)


def blend_total(
    scores: dict[str, float],
    weights: dict[str, float],
    signals_present: set[str],
) -> float:
    """One candidate's finished weighted score under whichever model is configured.

    Every scoring path goes through here, so the list, the single-title breakdown and the
    per-reader fit cannot end up blending the same signals differently.
    """
    if CATALOGUE_BLEND:
        return catalogue_blend_total(scores, weights, signals_present)
    if BLEND_TOP_K and BLEND_TOP_K < len(SIGNAL_SUM_ORDER):
        total = strongest_reasons(scores, weights)
    else:
        total = weighted_total(scores, weights)
    if evidence_gating_active():
        total *= evidence_scale(signals_present)
    return total


# ---------------------------------------------------------------------------
# Per-reader signal weights
# ---------------------------------------------------------------------------
# One weight vector serves every reader, so a reader whose taste runs against the
# consensus is scored largely on signals that do not describe them. The quality term is
# the clearest case: it carries a sixth of the total and is the same number for every
# reader, being a property of the title alone.
#
# When on, each reader's own history is used to ask, per signal, how well that signal
# ranks the titles they liked above the titles they did not, and the vector is tilted
# toward the signals that answer well for them. The estimate is thin by construction:
# the middle of the readership has single-figure profiles, and the sampling error of a
# rank statistic over twenty titles is larger than any plausible spread between readers.
# Each per-signal estimate is therefore shrunk toward the population mean in proportion
# to its own sampling variance, which leaves a short profile on the global vector and
# moves only a long one, and makes cold start free rather than a special case.
#
# The tilted vector is rescaled to the same total as the global one. Preserving that
# total is what keeps a score comparable between readers, keeps normalize_score meaning
# one thing, and keeps this separate from any change to the divisor.
# How many of a candidate's signals its score is built from, strongest first. Zero, or a
# count reaching every signal, is the flat sum over all of them.
BLEND_TOP_K = _env_int("REC_BLEND_TOP_K", 0)

# Whether a shortened blend is scaled back onto the range a full one occupies, so the
# 0-100 match percentage keeps meaning what it means elsewhere.
BLEND_TOP_K_RESCALE = _env_flag("REC_BLEND_TOP_K_RESCALE", True)

PER_USER_WEIGHTS = _env_flag("REC_PER_USER_WEIGHTS", False)

# Spread of the map from evidence to weight. At 0 every reader keeps the global vector,
# so it is a second, independent way of turning the tilt off.
PER_USER_WEIGHTS_GAMMA = _env_float("REC_PER_USER_WEIGHTS_GAMMA", 0.5)

# Ceiling on how far one signal's weight may move, applied before the rescale. Without
# it a confident-looking estimate on a noisy statistic can hand a reader a single-signal
# engine.
PER_USER_WEIGHTS_MAX_RATIO = _env_float("REC_PER_USER_WEIGHTS_MAX_RATIO", 2.0)

# Floors under the evidence a fit needs. Below any of them the reader keeps the global
# vector: the fit half of the profile must hold enough titles on each side of the
# reader's own mean, and enough pairs between them, for the statistic to mean anything.
PER_USER_WEIGHTS_MIN_PROFILE = _env_int("REC_PER_USER_WEIGHTS_MIN_PROFILE", 20)
PER_USER_WEIGHTS_MIN_CLASS = _env_int("REC_PER_USER_WEIGHTS_MIN_CLASS", 5)
PER_USER_WEIGHTS_MIN_PAIRS = _env_int("REC_PER_USER_WEIGHTS_MIN_PAIRS", 25)

# Share of the profile that builds the taste model the fit scores against. The rest is
# what the signals are asked to rank. The two halves are disjoint because both item-item
# tables would otherwise return a title's own row and every signal would look perfect.
PER_USER_WEIGHTS_SEED_SHARE = _env_float("REC_PER_USER_WEIGHTS_SEED_SHARE", 0.6)

# Whether titles the reader started and abandoned count as negatives alongside the ones
# they rated below their own mean. They are the stronger evidence of the two, the reader
# having chosen the title and then rejected it, but under half the readership has enough
# of them, and they reach the engine only from the request path.
PER_USER_WEIGHTS_USE_DROPPED = _env_flag("REC_PER_USER_WEIGHTS_USE_DROPPED", False)

# Population mean of the per-signal rank statistic, and its variance between readers.
# Both are cross-reader quantities that no single request can compute, so they are
# constants here, measured by scripts/local/fit_signal_weight_priors.py over readers
# outside the evaluation sample.
#
# The mean is the point a reader is shrunk toward and measured against, so a signal that
# is equally informative for everyone moves nobody's vector. A variance of zero says
# readers do not differ on that signal and disables it for personalisation by
# construction, which is the right answer for a term that returns the same value for
# every candidate.
# A mean well above the midpoint says a signal ranks the average reader's own likes
# correctly, which is not the same as saying it separates one reader from another: the
# variance is what carries that, and two of the entity terms have none. A term clamped at
# its ceiling for every candidate is all ties, and all ties is the middle of the scale
# with no spread around it, so no reader's vector moves on it.
SIGNAL_AUC_MEAN = _env_signal_map(
    "REC_PER_USER_WEIGHTS_ABAR",
    {
        "tag": 0.6302,
        "similar_games": 0.6062,
        "users_also_read": 0.5444,
        "quality": 0.7874,
        "developer": 0.5780,
        "staff": 0.5769,
        "trait": 0.5221,
        "seiyuu": 0.6011,
        # Unmeasured. A variance of zero leaves the signal on its global weight for every
        # reader, which is the right answer until the priors are refitted over the new
        # signal set.
        "description": 0.5,
    },
)
SIGNAL_AUC_VARIANCE = _env_signal_map(
    "REC_PER_USER_WEIGHTS_TAU2",
    {
        "tag": 0.00690,
        "similar_games": 0.00486,
        "users_also_read": 0.00327,
        "quality": 0.00828,
        "developer": 0.00244,
        "staff": 0.0,
        "trait": 0.0,
        "seiyuu": 0.00043,
        "description": 0.0,
    },
)


def signal_weights_for(personal: Optional[dict[str, float]]) -> dict[str, float]:
    """The weight vector a request scores under.

    Both scoring paths take their weights from here and from nowhere else, so the list
    and the breakdown cannot disagree about what a title was worth.
    """
    if not PER_USER_WEIGHTS or not personal:
        return dict(SIGNAL_WEIGHTS)
    return dict(personal)


def tie_aware_auc(positives: list[float], negatives: list[float]) -> Optional[float]:
    """Probability that a signal scores a liked title above a disliked one, ties split.

    Ties carry half a point because a signal that is silent about both titles has
    expressed no opinion. A signal returning the same value for every title is all ties
    and lands on exactly 0.5, which is the correct reading of no information rather than
    a low one.
    """
    n_pos, n_neg = len(positives), len(negatives)
    if not n_pos or not n_neg:
        return None
    combined = sorted(
        [(score, 1) for score in positives] + [(score, 0) for score in negatives],
        key=lambda item: item[0],
    )
    positive_rank_sum = 0.0
    start = 0
    rank = 1
    while start < len(combined):
        end = start
        while end < len(combined) and combined[end][0] == combined[start][0]:
            end += 1
        # Everything tied shares the middle of the ranks the group spans.
        midrank = rank + (end - start - 1) / 2.0
        positive_rank_sum += midrank * sum(1 for index in range(start, end) if combined[index][1])
        rank += end - start
        start = end
    return (positive_rank_sum - n_pos * (n_pos + 1) / 2.0) / (n_pos * n_neg)


def auc_variance(area: float, n_pos: int, n_neg: int) -> float:
    """Sampling variance of tie_aware_auc, by the Hanley and McNeil estimator.

    This is what decides how far a reader is allowed to move off the global vector, so
    it is estimated rather than approximated by a count: two readers with the same number
    of titles do not carry the same evidence if one of them splits evenly and the other
    does not.
    """
    if n_pos <= 0 or n_neg <= 0:
        return float("inf")
    q1 = area / (2.0 - area) if area < 2.0 else 0.0
    q2 = 2.0 * area * area / (1.0 + area)
    squared = area * area
    return (
        area * (1.0 - area)
        + (n_pos - 1) * (q1 - squared)
        + (n_neg - 1) * (q2 - squared)
    ) / (n_pos * n_neg)


def personal_signal_weights(fits: dict[str, tuple[float, float]]) -> dict[str, float]:
    """Turn per-signal evidence into a weight vector summing to the global total.

    `fits` maps a signal to its rank statistic and that statistic's sampling variance.
    A signal absent from it keeps its global weight.

    Shrinkage is the n/(n+k) form the codebase already applies to thin per-tag evidence,
    with k derived from the measured spread between readers rather than assumed: near
    the middle of the scale the variance of the statistic runs about 1/(6m) at m titles a
    side, so the balance point sits in the tens of titles rather than the low single
    figures that suit a damped mean of ratings.
    """
    ratios: dict[str, float] = {}
    for signal in SIGNAL_WEIGHTS:
        prior_mean = SIGNAL_AUC_MEAN.get(signal, 0.5)
        prior_variance = SIGNAL_AUC_VARIANCE.get(signal, 0.0)
        fit = fits.get(signal)
        if fit is None or prior_variance <= 0.0 or PER_USER_WEIGHTS_GAMMA == 0.0:
            ratios[signal] = 1.0
            continue
        area, variance = fit
        weight_of_evidence = prior_variance / (prior_variance + variance)
        shrunk = prior_mean + weight_of_evidence * (area - prior_mean)
        exponent = PER_USER_WEIGHTS_GAMMA * (shrunk - prior_mean) / math.sqrt(prior_variance)
        ratio = math.exp(exponent)
        ceiling = max(1.0, PER_USER_WEIGHTS_MAX_RATIO)
        ratios[signal] = min(max(ratio, 1.0 / ceiling), ceiling)

    tilted = {signal: SIGNAL_WEIGHTS[signal] * ratios[signal] for signal in SIGNAL_WEIGHTS}
    # Summed in the order MAX_WEIGHTED_SCORE was, so a reader whose evidence says nothing
    # divides by exactly one and lands back on the global vector rather than near it.
    total = sum(tilted.values())
    if total <= 0:
        return dict(SIGNAL_WEIGHTS)
    scale = MAX_WEIGHTED_SCORE / total
    return {signal: weight * scale for signal, weight in tilted.items()}


def vote_scores(user_votes: list[dict]) -> dict[str, float]:
    """A reader's votes as {vn_id: 0-10}, read the way the profile builder reads them."""
    scores: dict[str, float] = {}
    for vote in user_votes:
        vn_id = vote.get("vn_id") or vote.get("id")
        if not vn_id:
            continue
        scores[vn_id] = vote.get("score", vote.get("vote", 50)) / 10.0
    return scores


def profile_fingerprint(vn_scores: dict[str, float]) -> str:
    """Digest of a profile, stable under the order its titles arrive in."""
    parts = "|".join(f"{vn_id}:{vn_scores[vn_id]:.4f}" for vn_id in sorted(vn_scores))
    return hashlib.sha256(parts.encode("utf-8")).hexdigest()


def fit_split(vn_scores: dict[str, float]) -> tuple[list[str], list[str]]:
    """Divide a profile into the half that models taste and the half signals must rank.

    Split on a digest of the title id salted with the profile. The votes reaching the
    engine carry no dates, so there is no reading order to divide on; a digest gives one
    profile the same two halves on every request while giving two readers different ones,
    and covers the whole profile rather than its recent end.
    """
    salt = profile_fingerprint(vn_scores)
    ordered = sorted(
        vn_scores,
        key=lambda vn_id: hashlib.sha256(f"{vn_id}\x1f{salt}".encode("utf-8")).hexdigest(),
    )
    cut = int(len(ordered) * PER_USER_WEIGHTS_SEED_SHARE)
    return ordered[:cut], ordered[cut:]


def attach_source_titles(
    details: list[dict],
    titles: dict[str, dict[str, Optional[str]]],
) -> list[dict]:
    """Copy each source VN's title variants onto its match entry.

    The client picks between the forms per the reader's title preference, so all of them
    have to travel with the match, not just the database title.
    """
    enriched = []
    for detail in details:
        source_id = detail["source_vn_id"]
        variants = titles.get(source_id) or {}
        enriched.append({
            **detail,
            "source_title": variants.get("title") or source_id,
            "source_title_jp": variants.get("title_jp"),
            "source_title_romaji": variants.get("title_romaji"),
        })
    return enriched


def exploration_seed(
    high_rated_vns: Optional[list[str]],
    elite_tag_ids: Optional[set[int]] = None,
) -> str:
    """Salt that makes the exploration slice differ between readers.

    Two identical requests have to yield the same list, so the salt is derived from the
    profile rather than drawn per request. That keeps the explored titles steady between
    page loads and moves them only when the reader's own taste profile moves.

    Both profile parts feed the salt because either can be empty on its own: a reader who
    rates generously has no high-rated set, and one whose ratings are spread thin has no
    elite tags. Deriving from a single empty part would hand every such reader the same
    salt, and with it the same explored titles.
    """
    parts = [
        "|".join(sorted(high_rated_vns or ())),
        ",".join(str(t) for t in sorted(elite_tag_ids or ())),
    ]
    return hashlib.sha256("\x1f".join(parts).encode("utf-8")).hexdigest()


def stable_shuffle_order(column, seed: str, domain: str) -> tuple:
    """ORDER BY terms giving a text id column a total, reproducible pseudo-random order.

    Used where a candidate set is truncated but no signal in the row should decide who
    survives: ordering on a value the scorer also reads would bias the pool, and leaving
    the order to the planner makes the same request answerable two ways. The id itself
    settles digest ties so the order is total.

    The domain separates orderings that share a seed. One ordering used both to select a
    slice and to truncate a larger set containing it would sort that whole slice ahead of
    everything else, so each position needs a digest of its own.
    """
    return (func.md5(func.concat(column, f"{domain}\x1f{seed}")), column)


# ---------------------------------------------------------------------------
# Per-reader popularity calibration
# ---------------------------------------------------------------------------
# Where a reader reads on the catalogue's popularity range is part of their taste, and
# no signal carries it. Vote counts span several orders of magnitude and the candidate
# pool is dense in the middle of that range, so scoring alone hands readers at opposite
# ends of it lists drawn from the same middle: the list describes the pool rather than
# the reader.
#
# When on, the served page is re-ranked so its spread over a few popularity bands
# follows the reader's own spread, trading relevance against divergence from that target
# in one greedy pass. No score changes: the same candidates are ranked under the same
# weights, and only which of them reach the page and in what order moves. The single
# title details path therefore keeps reporting exactly what the list path scored.
#
# Zero leaves the page the scorer produced, in its order. One asks for the closest match
# to the reader's own spread the candidates allow, and settles ties inside a band on
# relevance, so the better candidate of two equally well placed ones still wins.
POPULARITY_CALIBRATION = _env_float("REC_POPULARITY_CALIBRATION", 0.0)
# Off by default. This reranks a scored page toward the popularity range the reader's own
# titles occupy, which means it can seat a weak match above a strong one: measured over
# readers it left a quarter of the first page out of match order, and pushed the single best
# match off the page entirely for a third of them. Reaching titles outside the head is
# candidate generation's job, where exploration already does it on merit; deciding which of
# them a reader sees belongs to the score, not to a distribution target. Exposed as the
# discovery control for readers who want to spend match quality on it deliberately.

# Boundaries between the popularity bands, on log10(votecount + 1) and ascending. Bands
# rather than raw counts because two lists of a few dozen titles share no vote counts at
# all and cannot be compared title by title; a small fixed support is what makes one
# reader's spread comparable to their list's, and to another reader's.
#
# The range is cut where reading happens rather than evenly over the catalogue. Most of
# the catalogue is barely read at all and sits under the first edge, contributing a
# small share of all reading; the edges above it divide the range the readership
# occupies into comparable shares of that reading. Fewer bands leave a reader of niche
# titles and a reader of the best known ones inside one band, which is the distinction
# this exists to represent. More of them cut finer than a page-length list can populate.
POPULARITY_BAND_EDGES = _env_floats(
    "REC_POPULARITY_BAND_EDGES", (1.5, 2.25, 2.85, 3.4)
)

# Share of the target mixed into the list's own band distribution before the divergence
# is taken. A band the list has not reached would otherwise divide by zero and make
# every comparison infinite, and at the first pick every band but one is empty. Mixing
# in the target rather than a flat floor keeps the correction proportional to how much
# of the reader's own reading the unreached band accounts for.
POPULARITY_CALIBRATION_MIX = _env_float("REC_POPULARITY_CALIBRATION_MIX", 0.01)

# Weight the reader's lowest-ranked title carries in the target, against 1.0 for their
# highest. Rank inside the reader's own list settles it, as the favourites selection
# settles the same question, so neither a coarse nor a generous rating scale decides how
# much of a reader's reading describes them. The floor keeps a title they thought little
# of in the picture: they still chose to read it, and that choice is what places them on
# the popularity range.
POPULARITY_PROFILE_FLOOR = _env_float("REC_POPULARITY_PROFILE_FLOOR", 0.25)

# Candidates a calibrated re-ranking pass may choose from, as a multiple of the page
# size. Zero hands it the whole scored pool.
#
# It defaults to the cut the uncalibrated pass already takes, so calibration adds a term
# to the pass rather than a larger pass. A wider cut is the obvious thing to want, on the
# grounds that the head of a relevance ranking is where the pool's popularity is
# narrowest; measured, it moves neither the slope nor the gap, while the cost of the
# pass grows with it, because the diversity term compares every remaining candidate
# against the recent selections. The divergence itself is a few dozen operations a slot
# whatever the pool holds.
POPULARITY_CALIBRATION_POOL = _env_int("REC_POPULARITY_CALIBRATION_POOL", 5)


def _band_thresholds(edges: tuple[float, ...]) -> tuple[int, ...]:
    """Least vote count falling in each band above the lowest.

    The edges are stated on log10(votecount + 1) because the spread is multiplicative: the
    distance from ten votes to a hundred is the same kind of distance as from a hundred to
    a thousand. Vote counts are integers, so each edge has an exact integer threshold, and
    both the Python and the SQL band read that instead of taking a logarithm per row. The
    tolerance settles an edge whose threshold is a whole number, where the logarithm of the
    count either side of it is representable only to within a rounding.
    """
    return tuple(math.ceil(10.0 ** edge - 1.0 - 1e-9) for edge in edges)


POPULARITY_BAND_THRESHOLDS = _band_thresholds(POPULARITY_BAND_EDGES)


def popularity_band(votecount: Optional[int]) -> int:
    """Index of the band a title's vote count falls in, least read first.

    A title with no recorded votes is unread rather than unplaceable, so it lands in the
    lowest band.
    """
    value = max(0, votecount or 0)
    band = 0
    for threshold in POPULARITY_BAND_THRESHOLDS:
        if value < threshold:
            break
        band += 1
    return band


def popularity_band_expression():
    """`popularity_band` as SQL, so a draw can be cut per band without loading the rows.

    Kept beside the Python version because the two have to agree: a band boundary that
    differs between selection and scoring would aim the page at a target the pool was never
    filled against. Both read the same thresholds, so they cannot disagree.

    Compared against the raw count rather than its logarithm. The column is indexed and the
    comparison is integer, where a logarithm is computed per row in arbitrary precision and
    once per edge, on a query that scans the catalogue.
    """
    votes = func.coalesce(VisualNovel.votecount, 0)
    expression = literal(0)
    for threshold in POPULARITY_BAND_THRESHOLDS:
        expression = expression + case((votes >= threshold, 1), else_=0)
    return expression


POPULARITY_BAND_COUNT = len(POPULARITY_BAND_EDGES) + 1


# ---------------------------------------------------------------------------
# Where retrieval draws from on the popularity range
# ---------------------------------------------------------------------------
# The broad draw is stratified by popularity band and takes the same number of titles
# from each. The catalogue is not shaped that way: the least-read band holds most of it
# and the best-known band a few hundred titles, so an equal quota is not a neutral draw
# but a large upweighting of the head, and the draw ends up the most popularity-skewed of
# the sources feeding the pool rather than the counterweight it is meant to be.
#
# A share per band, least read first, replaces the equal quota. Empty restores it. The
# default is the share of the eligible Japanese catalogue each band holds, taken before
# the arm's own vote floor, so the draw is proportional to what there is to draw from.
# Anything between this and equal trades reach against how much of the draw lands where a
# page can still be filled from it, and the choice is not delicate: measured, a vector
# taken after the vote floor and a vector tilted further toward the least-read band both
# land within noise of this one.
EXPLORATION_BAND_SHARES = _env_shares(
    "REC_EXPLORATION_BAND_SHARES",
    POPULARITY_BAND_COUNT,
    default=(0.815, 0.139, 0.032, 0.010, 0.004),
)

# The same, for the cut that narrows the collected union to the pool the scorer sees. The
# cut runs on a salted digest, so the pool it leaves has the popularity profile the union
# arrived with, and the union is the sum of what the sources happened to reach. A share
# per band makes the pool's spread a property of the request rather than of the sources.
#
# Empty leaves the cut uniform. Bands the union cannot fill hand their slots back, so the
# shares are a floor on reach rather than a cap on the head: a request whose union holds
# nothing outside the best-known bands still fills its pool.
#
# It works against itself past a modest tilt, and the reason bounds where it is useful.
# Most of the catalogue carries a quarter of the tags of the best-known titles, no
# co-occurrence row and often no average, so several of the weighted signals read zero for
# it whatever it is worth: a slot spent on such a title is a slot removed from the set
# actually competing for the page, and a pool filled with them leaves the scorer choosing
# the page from the head alone. Reaching further is the draw's job, where the titles are
# collected in proportion rather than forced into the pool a page is taken from.
CANDIDATE_CUT_BAND_SHARES = _env_shares(
    "REC_CANDIDATE_CUT_BAND_SHARES", POPULARITY_BAND_COUNT
)

# Share of each favourite's description neighbours drawn from each popularity band, least
# read first. Empty, which is the default, takes the nearest neighbours outright.
#
# The case for it: a reader's favourites are among the best-known titles they have read,
# and a title's nearest descriptions are its own sequels, its studio's other work and
# whatever it was imitating, which are read to about the same degree, so an unstratified
# draw returns a neighbourhood as widely read as the seed. Ranking within a band and
# taking a quota per band asks instead which of the titles almost nobody has read are
# closest to this one, and that question has an answer everywhere in the catalogue.
#
# Measured, it is worth nothing once the seeds themselves are spread over the reader's own
# range, which addresses the same thing at the source and does it better: with spread
# seeds it moved neither how much of the catalogue a run reached nor how much of a page
# the least-read band held. It stays reachable for a configuration that does not spread
# its seeds, where it is also close to neutral. Off it costs nothing; on it needs each row
# of the matrix placed on the popularity range, which is one scan of the catalogue per
# process.
DESC_RETRIEVAL_BAND_SHARES = _env_shares(
    "REC_DESC_RETRIEVAL_BAND_SHARES", POPULARITY_BAND_COUNT
)

# When on, the sources that read a reader's own list draw their seeds across the
# popularity range that list occupies rather than off the top of it. A reader's
# highest-rated titles are the best known ones they have read, and a neighbourhood lookup
# returns titles of roughly the source's own standing, so seeding on rank alone asks the
# related sources about the head of the catalogue whatever else the reader has read.
#
# Only retrieval reads the spread list. The item-item signals keep scoring against the
# reader's favourites, so what a title is worth to them does not move with this.
#
# It is what makes each reader's neighbourhood their own. Every reader's best-known titles
# are drawn from the same few hundred, so seeding on rank asks nearly the same question for
# everybody and the pages come back alike; seeding across their range asks about the part
# of their list nobody else has read. Measured over one set of readers it is the largest
# single contributor to how much of the catalogue a run reaches, and it roughly halves how
# much two readers' pages have in common. It costs one batched read over titles the reader
# has already rated.
RETRIEVAL_SEED_SPREAD = _env_flag("REC_RETRIEVAL_SEED_SPREAD", not LEGACY_SCORING)


# Popularity band of every row of the description matrix, in row order, held for the life
# of the process alongside the matrix it indexes. Vote counts move slowly and a band is a
# wide bucket, so a figure from the last restart places a title in the same band as one
# read now for all but a handful of titles a day, and reading it per request would cost a
# scan of the catalogue on every page.
_description_bands: Optional[tuple[str, np.ndarray]] = None


def spread_seeds(
    vn_scores: dict[str, float],
    votecounts: dict[str, int],
    target: int,
) -> list[str]:
    """The reader's own titles, drawn evenly across the popularity bands they occupy.

    Rank inside a band still decides which of its titles are taken, so the reader's own
    judgement chooses within each part of their range and only the range itself is
    widened. Bands the reader has not read are skipped rather than filled from elsewhere,
    and a short draw is topped up in rank order, so a reader whose reading sits in one
    band keeps the list they had.

    A title the catalogue cannot place carries no band, and is held back for the top-up
    rather than counted into a band it is not known to belong to.
    """
    banded: dict[int, list[tuple[float, str]]] = {}
    for vn_id, score in vn_scores.items():
        votecount = votecounts.get(vn_id)
        if votecount is None:
            continue
        banded.setdefault(popularity_band(votecount), []).append((-score, vn_id))
    for entries in banded.values():
        entries.sort()

    picked: list[str] = []
    seen: set[str] = set()
    depth = 0
    while len(picked) < target:
        taken = 0
        for band in sorted(banded):
            entries = banded[band]
            if depth >= len(entries) or len(picked) >= target:
                continue
            vn_id = entries[depth][1]
            picked.append(vn_id)
            seen.add(vn_id)
            taken += 1
        if not taken:
            break
        depth += 1

    if len(picked) < target:
        for vn_id, _ in sorted(vn_scores.items(), key=lambda kv: kv[1], reverse=True):
            if len(picked) >= target:
                break
            if vn_id not in seen:
                picked.append(vn_id)
                seen.add(vn_id)

    # Consumers take the head of this list where they cannot afford all of it, so it is
    # handed back in the reader's own order of preference rather than in draw order.
    picked.sort(key=lambda vn_id: (-vn_scores[vn_id], vn_id))
    return picked


def reader_rating_weights(vn_scores: dict[str, float]) -> dict[str, float]:
    """How much each title a reader has read counts toward describing them.

    Rank inside the reader's own list, not the rating itself. Ratings mean different
    things between readers, so a fixed mark decides how much of a list is heard rather
    than which part of it the reader liked. Tied ratings share the middle of the ranks
    they span, which leaves a reader who uses a handful of values with those titles
    counting alike instead of in whatever order they arrived.
    """
    total = len(vn_scores)
    if not total:
        return {}
    below: dict[float, int] = {}
    equal: dict[float, int] = {}
    for position, score in enumerate(sorted(vn_scores.values())):
        below.setdefault(score, position)
        equal[score] = equal.get(score, 0) + 1
    floor = POPULARITY_PROFILE_FLOOR
    return {
        vn_id: floor
        + (1.0 - floor) * ((below[score] + (equal[score] + 1) / 2.0) / total)
        for vn_id, score in vn_scores.items()
    }


def popularity_target(
    vn_scores: dict[str, float],
    votecounts: dict[str, int],
) -> dict[int, float]:
    """The reader's own spread over the popularity bands, as a distribution.

    A title the catalogue cannot place is left out rather than counted as unread: the
    target describes where the reader reads, and a missing count says nothing about that.
    """
    banded: dict[int, float] = {}
    total = 0.0
    for vn_id, weight in reader_rating_weights(vn_scores).items():
        votecount = votecounts.get(vn_id)
        if votecount is None:
            continue
        band = popularity_band(votecount)
        banded[band] = banded.get(band, 0.0) + weight
        total += weight
    if total <= 0:
        return {}
    return {band: weight / total for band, weight in banded.items()}


@dataclass(frozen=True)
class PopularityCalibration:
    """A reader's target spread over the popularity bands, and where candidates sit in it.

    `strength` is the share of the re-ranking decision the divergence carries, against
    the relevance and diversity blend it is traded against. Both sides are on 0-1, which
    is what makes the share mean what it says; a divergence traded against a raw
    weighted total would describe far less of the decision than its name claims.
    """

    target: dict[int, float]
    bands: dict[str, int]
    strength: float

    def divergence_by_band(
        self,
        listed: dict[int, float],
        listed_weight: float,
        position_weight: float,
        bands: set[int],
    ) -> dict[int, float]:
        """Divergence from the target for each band a candidate could occupy at one slot.

            KL(target || list) = sum over bands of p(b) * log2(p(b) / q~(b))
            q~(b) = (1 - mix) * q(b) + mix * p(b)

        Every candidate falling in the same band moves the list distribution the same
        way, so this is computed once per band rather than once per candidate: over a
        pool of several hundred that is a handful of evaluations a slot instead of
        several hundred.

        The sum runs over the target's own bands. A candidate from a band the reader
        never reads still registers, by taking a slot's worth of weight away from the
        bands they do.
        """
        divergences: dict[int, float] = {}
        total = listed_weight + position_weight
        if total <= 0:
            return {band: 0.0 for band in bands}
        for band in bands:
            divergence = 0.0
            for group, share in self.target.items():
                weight = listed.get(group, 0.0)
                if group == band:
                    weight += position_weight
                smoothed = (
                    (1.0 - POPULARITY_CALIBRATION_MIX) * (weight / total)
                    + POPULARITY_CALIBRATION_MIX * share
                )
                divergence += share * math.log2(share / smoothed)
            divergences[band] = divergence
        return divergences


# How many of a reader's own favourites drive the item-item signals and the candidate
# sources built from them. Matches the slice those consumers take.
HIGH_RATED_TARGET = 20


# Elite tier multipliers for user's top-ranked tags
# These boost the influence of a user's strongest preferences
ELITE_TIER_1_MULTIPLIER = 4.0  # Top 5 tags - core preferences
ELITE_TIER_2_MULTIPLIER = 2.5  # Tags 6-10 - strong preferences
ELITE_TIER_3_MULTIPLIER = 1.6  # Tags 11-20 - notable preferences
BEST_MATCH_WEIGHT = 0.4        # Weight for best-match component in tag scoring

# Multipliers applied to every candidate source's limit when a filtered pool comes back
# too small to fill a page. A filter applied inside a source query returns fewer rows
# rather than different ones, so a narrow filter shrinks the pool instead of shifting it,
# and the only way to recover the missing candidates is to look further down the same
# ordering. The steps are far apart because a filter that starves the pool usually starves
# it by an order of magnitude, and each additional step costs a full round of source
# queries. Collection stops at the first step that fills the page, and an unfiltered
# request never takes more than the first.
CANDIDATE_WIDENING_STEPS = (1, 4, 16)

# Extra candidates the quality-ranked top-up fetches per requested result when the widened
# pool still falls short. Scoring and diversity re-ranking both need more rows than the
# page holds, or the page is whatever the top-up happened to find, in rating order.
TOP_UP_POOL_MULTIPLIER = 3


def tag_vector_magnitude(tags: dict[int, float]) -> float:
    """Euclidean length of one title's tag vector."""
    return math.sqrt(sum(v ** 2 for v in tags.values()))


def tag_cosine(
    tags_a: dict[int, float],
    tags_b: dict[int, float],
    mag_a: Optional[float] = None,
    mag_b: Optional[float] = None,
) -> float:
    """Cosine between two tag vectors, reusing magnitudes the caller already holds.

    Zero where either vector is empty, which is an absence of evidence rather than a
    measured distance; a caller that needs to tell the two apart checks the vector itself.
    """
    if not tags_a or not tags_b:
        return 0.0

    common_tags = set(tags_a.keys()).intersection(set(tags_b.keys()))
    if not common_tags:
        return 0.0

    dot_product = sum(tags_a[t] * tags_b[t] for t in common_tags)
    if mag_a is None:
        mag_a = tag_vector_magnitude(tags_a)
    if mag_b is None:
        mag_b = tag_vector_magnitude(tags_b)
    if mag_a == 0 or mag_b == 0:
        return 0.0

    return dot_product / (mag_a * mag_b)


class _TagSimilarityCache:
    """Cosines within one candidate pool, computed once per pair.

    A greedy re-rank poses the same comparison repeatedly: the frontier it measures against
    advances by one title per slot while the pool it measures does not change. Magnitudes
    are held apart from pair results because a magnitude belongs to a single title and is
    otherwise recomputed over its whole vector on every comparison that title takes part in.
    """

    def __init__(self, all_tags: dict[str, dict[int, float]]):
        self._all_tags = all_tags
        self._magnitudes: dict[str, float] = {}
        self._pairs: dict[tuple[str, str], float] = {}

    def magnitude(self, vn_id: str) -> float:
        cached = self._magnitudes.get(vn_id)
        if cached is None:
            cached = tag_vector_magnitude(self._all_tags.get(vn_id, {}))
            self._magnitudes[vn_id] = cached
        return cached

    def between(self, vn_id_a: str, vn_id_b: str) -> float:
        """Cosine between two titles in the pool.

        Keyed on the pair in the order it was asked for. The dot product sums over an
        unordered intersection, so the two orders can differ in the last bits of the
        result, and one key per order keeps a repeated answer identical to the first.
        """
        key = (vn_id_a, vn_id_b)
        cached = self._pairs.get(key)
        if cached is None:
            cached = tag_cosine(
                self._all_tags.get(vn_id_a, {}),
                self._all_tags.get(vn_id_b, {}),
                self.magnitude(vn_id_a),
                self.magnitude(vn_id_b),
            )
            self._pairs[key] = cached
        return cached


@dataclass
class RecommendationResult:
    """A single recommendation with explanation."""
    vn_id: str
    title: str
    score: float
    match_reasons: list[str]
    image_url: Optional[str] = None
    image_sexual: Optional[float] = None  # For NSFW blur (0=safe, 1=suggestive, 2=explicit)
    rating: Optional[float] = None
    title_jp: Optional[str] = None       # Original Japanese title (kanji/kana)
    title_romaji: Optional[str] = None   # Romanized title
    tag_score: float = 0.0
    similar_games_score: float = 0.0      # From VNSimilarity table
    users_also_read_score: float = 0.0    # From VNCoOccurrence table
    developer_score: float = 0.0
    staff_score: float = 0.0
    seiyuu_score: float = 0.0
    trait_score: float = 0.0
    quality_score: float = 0.0  # Based on raw average rating (not Bayesian)
    # Closeness between this title's description and the reader's favourites. Zero also
    # stands for "no description was embedded for this title", which the scoring tells
    # apart and a client cannot; description_matches being empty is the signal that the
    # term took no part.
    description_score: float = 0.0
    # Agreement between the reader's and the title's latent factors, scaled over the pool.
    # Zero for every title while the signal carries no weight or the model lacks the reader.
    collaborative_score: float = 0.0
    normalized_score: int = 0  # 0-100 scale for display

    # Detailed breakdown for popup (populated when generating recommendations)
    matched_tags: list[dict] = field(default_factory=list)
    # [{"id": ..., "name": ..., "user_weight": ..., "vn_score": ...}]

    matched_staff: list[dict] = field(default_factory=list)
    # [{"id": ..., "name": ..., "name_original": ..., "user_avg_rating": ...}]

    matched_developers: list[dict] = field(default_factory=list)
    # [{"name": ..., "name_original": ..., "user_avg_rating": ...}]

    matched_seiyuu: list[dict] = field(default_factory=list)
    # [{"id": ..., "name": ..., "name_original": ..., "weighted_score": ..., "count": ...}]

    matched_traits: list[dict] = field(default_factory=list)
    # [{"id": ..., "name": ..., "weighted_score": ..., "count": ...}]

    contributing_vns: list[dict] = field(default_factory=list)
    # [{"id": ..., "title": ..., "similarity": ...}]

    similar_games_details: list[dict] = field(default_factory=list)
    # [{"source_vn_id": ..., "source_title": ..., "source_title_jp": ...,
    #   "source_title_romaji": ..., "similarity": ...}]

    users_also_read_details: list[dict] = field(default_factory=list)
    # [{"source_vn_id": ..., "source_title": ..., "source_title_jp": ...,
    #   "source_title_romaji": ..., "co_score": ..., "user_count": ...}]

    description_matches: list[dict] = field(default_factory=list)
    # [{"source_vn_id": ..., "source_title": ..., "source_title_jp": ...,
    #   "source_title_romaji": ..., "similarity": ..., "affinity": ...}]

    # What each signal expects this reader to mark this title, 1-10, keyed by signal name.
    # Only the signals that had a basis for a mark appear; see _predicted_ratings for which
    # abstain and why. Empty unless PREDICTED_RATING is on.
    predicted_ratings: dict[str, float] = field(default_factory=dict)

    # The mean of those predictions and the range the signals disagree over; see
    # prediction_interval, which also says what the range does and does not mean. The
    # bounds are None where one signal spoke alone, and all three are None where none did.
    predicted_rating: Optional[float] = None
    predicted_rating_low: Optional[float] = None
    predicted_rating_high: Optional[float] = None

    # How far the signals agree on this title, 0-100, and how many of their rankings it
    # reached; see fusion_confidence. Present whichever way the list was ordered, so the
    # two aggregations can be read against each other on one page. Zero where the title
    # placed inside no signal's ranking.
    confidence: int = 0
    signals_ranked: int = 0


class HybridRecommender:
    """Hybrid recommendation engine.

    Blends the signals defined in SIGNAL_WEIGHTS; see the module docstring.
    """

    def __init__(self, db: AsyncSession):
        self.db = db
        self._tag_vectors: Optional[dict] = None  # vn_id -> sparse vector
        self._vn_tags_map: Optional[dict] = None  # vn_id -> {tag_id: score}
        self._all_tag_ids: Optional[list] = None  # ordered list of all tag IDs
        # Producer ids seen behind each producer name, filled as developers are loaded.
        # Developer preferences are keyed by name and the release chain is keyed by id, and
        # names are not unique: resolving through this map rather than through a lookup over
        # the whole producer table keeps an affinity on the producer that earned it.
        self._producer_ids_by_name: dict[str, set[str]] = {}
        # Accounting for the last candidate pool built, so a caller can report why a page
        # came back short. Set by _get_candidates; None until a run has produced one.
        self.last_pool: Optional[dict] = None
        # Each retrieval arm's own answer from the last collection pass, strongest first.
        # The pool it produced is a set, so the orderings the arms computed to decide what
        # survived their limits exist nowhere else. The broad draw is absent: it is a
        # shuffle over titles unconnected to the reader, and an order it did not compute is
        # not one to publish.
        self.last_ranked_arms: dict[str, RankedCandidates] = {}
        # Position each signal put each scored candidate at on the last run, for a caller
        # showing what a title's agreement figure was made of. Signals that ranked nothing
        # are absent, and the whole map covers the scored pool rather than the page: a
        # position recomputed over the page alone is a different number under the same
        # name.
        self.last_signal_rankings: dict[str, dict[str, float]] = {}
        # Weight vector the last scored request ran under, for a caller that wants to
        # show what a title's score was made of. The global vector until a request has
        # scored anything, which is also what every reader without a fit is scored under.
        self.last_signal_weights: dict[str, float] = dict(SIGNAL_WEIGHTS)
        # Divisor the last request's match percentages were computed against. It tracks
        # the weight vector rather than the constant, since a caller supplying its own
        # weights moves the score a candidate could have reached.
        self.last_score_divisor: float = MAX_WEIGHTED_SCORE
        # Fitted vector, keyed by the profile it was fitted from. Both scoring paths on
        # one instance then read one vector rather than fitting it twice.
        self._signal_weight_fit: Optional[tuple[str, Optional[dict[str, float]]]] = None

    def _calculate_bayesian_score(
        self,
        user_avg: float,
        count: int,
        user_overall_avg: float,
        prior_weight: int = 3,
    ) -> float:
        """
        Calculate Bayesian (damped mean) score for tag/staff ranking.

        Formula: (count × user_avg + prior_weight × user_overall_avg) / (count + prior_weight)

        This pulls tags with few VNs toward the user's overall average, while tags with
        many VNs approach the user's raw average. A lower prior_weight gives more
        influence to the user's own ratings.

        Args:
            user_avg: User's average rating for VNs with this tag (0-10 scale)
            count: Number of user's VNs with this tag
            user_overall_avg: User's overall average rating (0-10 scale)
            prior_weight: Smoothing factor (default 3)

        Returns:
            Bayesian score (0-10 scale)
        """
        if count == 0:
            return user_overall_avg
        return (count * user_avg + prior_weight * user_overall_avg) / (count + prior_weight)

    def _calculate_weighted_score(
        self,
        bayesian_score: float,
        count: int,
        min_confidence_count: int = 5,  # Match stats page calculation
    ) -> float:
        """
        Calculate confidence-weighted score for tag/staff ranking.

        Formula: bayesian_score * min(1, count / min_confidence_count)

        This penalizes tags with few instances (unreliable data) while leaving
        tags with sufficient instances at their Bayesian score.

        Args:
            bayesian_score: The Bayesian damped mean score
            count: Number of user's VNs with this tag
            min_confidence_count: Count at which confidence reaches 100%

        Returns:
            Weighted score (higher = better preference signal)
        """
        confidence = min(1.0, count / min_confidence_count)
        return bayesian_score * confidence

    async def _load_technical_tag_ids(self) -> set[int]:
        """Tags VNDB files as technical, cached for the process.

        The category records presentation and engine facts rather than subject matter, so a
        profile built from them describes the software a reader used rather than the stories
        they chose.

        The set is read from the catalogue rather than passed in, so it is one of the few
        things a profile needs that the caller cannot supply. A load that fails leaves the set
        empty, which lets those tags into the profile rather than failing the request; it is
        logged as an error and not cached, so the next request tries again.
        """
        try:
            return await _TECHNICAL_TAGS.get()
        except Exception as e:
            logger.error(f"Failed to load technical tag ids: {e}, treating none as technical")
            return set()

    async def _load_tag_idf_weights(self) -> dict[int, float]:
        """
        IDF (Inverse Document Frequency) weight per tag, cached for the process.

        IDF = log(total_vns / tag_vn_count)

        Rare tags (low vn_count) get higher IDF, making them more influential.
        Common tags (high vn_count) get lower IDF, dampening their impact.

        This ensures niche tags like "Nakige" (368 VNs, IDF~2.2) contribute more
        than generic tags like "Romance" (17k VNs, IDF~0.5) to the recommendation score.

        A load that fails leaves every tag at a weight of one, which removes rarity from
        the scoring; it is logged as an error and not cached, so the next request tries
        again.
        """
        try:
            return await _TAG_IDF.get()
        except Exception as e:
            logger.error(f"Failed to load IDF weights: {e}, using default IDF=1.0")
            return {}

    async def _signal_weights(
        self,
        user_votes: list[dict],
        spoiler_level: int = 0,
        negative_vn_ids: Optional[set[str]] = None,
    ) -> dict[str, float]:
        """Weight vector this reader is scored under, fitted at most once per instance.

        Issues no query and touches nothing while the switch is off, so the default path
        costs what it did before.
        """
        if not PER_USER_WEIGHTS:
            return dict(SIGNAL_WEIGHTS)
        fingerprint = profile_fingerprint(vote_scores(user_votes))
        if self._signal_weight_fit is None or self._signal_weight_fit[0] != fingerprint:
            try:
                fitted = await self._fit_signal_weights(
                    user_votes, spoiler_level=spoiler_level, negative_vn_ids=negative_vn_ids
                )
            except Exception as exc:
                # A reader whose fit cannot be computed is a reader with no fit, which is
                # already an ordinary case and already lands on the global vector.
                logger.warning(f"Signal weight fit failed, using the global vector: {exc}")
                fitted = None
            self._signal_weight_fit = (fingerprint, fitted)
        return signal_weights_for(self._signal_weight_fit[1])

    def _description_scores(
        self,
        candidate_ids: list[str],
        favourites: list[str],
    ) -> dict[str, float]:
        """Description affinity for the candidates that have a description, 0-1.

        Ids missing from the result were never embedded, which the caller reads as this
        signal having nothing to say about them rather than as a score of zero.

        Only the candidates are touched, not the whole matrix: a retrieved pool is a few
        hundred rows against nearly fifty thousand.
        """
        if not DESC_SIGNAL or not candidate_ids or not favourites:
            return {}
        vectors = get_description_vectors()
        if vectors is None:
            return {}

        seeds = favourites[:max(1, DESC_SEEDS)]
        if DESC_BEST_MATCH:
            rows = vectors.rows_for(seeds)
            if not len(rows):
                return {}
            raw = vectors.score_candidates_best_match(candidate_ids, rows)
        else:
            taste = vectors.mean_vector(seeds)
            if taste is None:
                return {}
            raw = vectors.score_candidates(candidate_ids, taste)

        return {vn_id: description_affinity(value) for vn_id, value in raw.items()}

    def _description_neighbours(
        self,
        candidate_ids: list[str],
        favourites: list[str],
    ) -> dict[str, list[dict]]:
        """Which of a reader's own titles each candidate's description is closest to.

        The explanation behind the signal, computed for a finished page rather than for
        the whole pool: it is one small matrix product either way, and only the titles a
        reader is shown need a reason attached.
        """
        if not DESC_SIGNAL or not candidate_ids or not favourites:
            return {}
        vectors = get_description_vectors()
        if vectors is None:
            return {}

        # Both sides are narrowed to what was embedded before the rows are taken, so a
        # row index and its id stay at the same position on either axis of the product.
        seeds = [
            vn_id
            for vn_id in favourites[:max(1, DESC_SEEDS)]
            if vectors.vector(vn_id) is not None
        ]
        candidates = [
            vn_id for vn_id in candidate_ids if vectors.vector(vn_id) is not None
        ]
        seed_rows = vectors.rows_for(seeds)
        if not len(seed_rows) or not candidates:
            return {}

        block = np.asarray(vectors.matrix[vectors.rows_for(candidates)], dtype=np.float32)
        queries = np.asarray(vectors.matrix[seed_rows], dtype=np.float32)
        similarity = block @ queries.T

        neighbours: dict[str, list[dict]] = {}
        for position, vn_id in enumerate(candidates):
            row = similarity[position]
            order = np.argsort(-row)[:3]
            entries = [
                {
                    "source_vn_id": seeds[index],
                    "similarity": round(float(row[index]), 3),
                    "affinity": round(description_affinity(float(row[index])), 3),
                }
                for index in order
                if description_affinity(float(row[index])) > 0
            ]
            if entries:
                neighbours[vn_id] = entries
        return neighbours

    def _description_rating_neighbours(
        self,
        candidate_ids: list[str],
        vn_scores: dict[str, float],
    ) -> dict[str, list[tuple[float, float]]]:
        """Each candidate against the reader's whole rated list: closeness paired with the
        mark the reader gave.

        The reader's whole list, not their favourites. The signal's own retrieval and its
        reason both read the favourites, which is right for finding a candidate and wrong
        for predicting a mark: an average over marks that are all above the reader's mean
        is above their mean whatever the candidate is. The titles a reader disliked are
        what let this prediction fall.

        One product against the resident matrix, both sides narrowed to what was embedded
        first, so a row index and its id stay at the same position on either axis.
        """
        if not candidate_ids or not vn_scores:
            return {}
        vectors = get_description_vectors()
        if vectors is None:
            return {}

        sources = [vn_id for vn_id in vn_scores if vectors.vector(vn_id) is not None]
        candidates = [
            vn_id for vn_id in candidate_ids if vectors.vector(vn_id) is not None
        ]
        if not sources or not candidates:
            return {}

        block = np.asarray(vectors.matrix[vectors.rows_for(candidates)], dtype=np.float32)
        queries = np.asarray(vectors.matrix[vectors.rows_for(sources)], dtype=np.float32)
        similarity = block @ queries.T

        # Only the nearest few are read off, so the rest of each row is never sorted.
        depth = min(max(1, PREDICTION_NEIGHBOURS), similarity.shape[1])
        ratings = np.fromiter(
            (vn_scores[vn_id] for vn_id in sources), dtype=np.float32, count=len(sources)
        )
        nearest = np.argpartition(-similarity, depth - 1, axis=1)[:, :depth]

        neighbours: dict[str, list[tuple[float, float]]] = {}
        for position, vn_id in enumerate(candidates):
            picked = nearest[position]
            entries = [
                (float(similarity[position, index]), float(ratings[index]))
                for index in picked
            ]
            if entries:
                neighbours[vn_id] = entries
        return neighbours

    async def _description_row_bands(self, vectors) -> Optional[np.ndarray]:
        """Popularity band per matrix row, loaded once per process.

        Read through a session of its own rather than the request's. It is a scan of the
        catalogue, taken once for the life of the process and belonging to no request, and
        every candidate source is written to emit one statement whose shape is a function
        of the request's filters. Borrowing the request's session would put a statement
        that is neither into the middle of that sequence.

        A row the catalogue does not place lands in the least-read band, which is where a
        title with no recorded votes belongs anyway.
        """
        global _description_bands
        if _description_bands is not None and _description_bands[0] == vectors.model_version:
            return _description_bands[1]

        async with async_session() as db:
            rows = await db.execute(select(VisualNovel.id, VisualNovel.votecount))
            counts = {row.id: row.votecount for row in rows.all()}
        bands = np.fromiter(
            (popularity_band(counts.get(vn_id)) for vn_id in vectors.ids),
            dtype=np.int8,
            count=len(vectors.ids),
        )
        _description_bands = (vectors.model_version, bands)
        logger.info("Placed %d description rows on the popularity range", len(bands))
        return bands

    async def _get_description_candidates(
        self,
        *,
        favourites: list[str],
        exclude_vn_ids: set[str],
        limit: int,
        per_seed: int,
    ) -> RankedCandidates:
        """Titles whose descriptions read closest to the reader's own favourites.

        Ranked by the interleave rather than by the cosine: the order is the point of the
        interleave, and the cosines behind two different favourites are not one scale. The
        strength carried alongside is the cosine the title was picked on.

        No query and no model: one product against the resident matrix, taken on a worker
        thread because it is the only part of candidate collection that spends real CPU
        rather than waiting on the database.

        Neighbours are taken per favourite and interleaved by rank, so every favourite is
        represented before any of them is represented twice, and under a band share each
        favourite's own quota is filled band by band. The matrix carries no language or
        filter information, so what comes back is tested against the request's filters
        downstream like any other source's ids.
        """
        if not DESC_RETRIEVAL or limit <= 0 or per_seed <= 0 or not favourites:
            return []
        vectors = get_description_vectors()
        if vectors is None:
            return []

        seeds = favourites[:max(1, DESC_RETRIEVAL_SEEDS)]
        seed_rows = vectors.rows_for(seeds)
        if not len(seed_rows):
            return []

        bands = None
        if DESC_RETRIEVAL_BAND_SHARES:
            bands = await self._description_row_bands(vectors)

        def _neighbours() -> list[tuple[str, float]]:
            queries = np.asarray(vectors.matrix[seed_rows], dtype=np.float32)
            similarity = np.asarray(vectors.matrix) @ queries.T
            take = min(per_seed, similarity.shape[0])
            if bands is None:
                quotas = None
                band_rows = None
            else:
                quotas = allocate_shares(take, DESC_RETRIEVAL_BAND_SHARES)
                band_rows = [np.flatnonzero(bands == index) for index in range(len(quotas))]

            def best(scores, rows, count):
                """The `count` highest-scoring of `rows`, best first."""
                count = min(count, len(rows))
                if count <= 0:
                    return np.empty(0, dtype=np.int64)
                subset = scores[rows]
                top = np.argpartition(-subset, count - 1)[:count]
                return rows[top[np.argsort(-subset[top])]]

            per_column = []
            for column in range(similarity.shape[1]):
                scores = similarity[:, column]
                if quotas is None:
                    per_column.append(best(scores, np.arange(scores.shape[0]), take))
                    continue
                # Each band contributes its own nearest, and the bands are interleaved so
                # a band that cannot fill its quota shortens the column rather than
                # handing its places to the crowded ones.
                picked = [best(scores, band_rows[i], quotas[i]) for i in range(len(quotas))]
                merged: list[int] = []
                for depth in range(max((len(p) for p in picked), default=0)):
                    for entries in picked:
                        if depth < len(entries):
                            merged.append(int(entries[depth]))
                per_column.append(np.asarray(merged, dtype=np.int64))

            ranked: list[tuple[str, float]] = []
            for depth in range(max((len(column) for column in per_column), default=0)):
                for position, column in enumerate(per_column):
                    if depth < len(column):
                        row = int(column[depth])
                        ranked.append(
                            (vectors.ids[row], float(similarity[row, position]))
                        )
            return ranked

        ranked = await asyncio.to_thread(_neighbours)

        # A title is its own nearest neighbour, so the seeds are held out here as well as
        # by the caller's exclusion set: the arm must not nominate what it was asked about.
        seen = set(seeds)
        picked: RankedCandidates = []
        for vn_id, closeness in ranked:
            if len(picked) >= limit:
                break
            if vn_id in exclude_vn_ids or vn_id in seen:
                continue
            seen.add(vn_id)
            picked.append((vn_id, closeness))
        return picked

    async def _fit_signal_weights(
        self,
        user_votes: list[dict],
        spoiler_level: int = 0,
        negative_vn_ids: Optional[set[str]] = None,
    ) -> Optional[dict[str, float]]:
        """Fit a reader's weight vector, or None where the evidence does not support one."""
        evidence = await self._fit_signal_evidence(
            user_votes, spoiler_level=spoiler_level, negative_vn_ids=negative_vn_ids
        )
        if evidence is None:
            return None
        return personal_signal_weights(evidence["fits"])

    async def _fit_signal_evidence(
        self,
        user_votes: list[dict],
        spoiler_level: int = 0,
        negative_vn_ids: Optional[set[str]] = None,
    ) -> Optional[dict]:
        """Per-signal evidence for one reader, or None where there is not enough of it.

        Returns the raw statistic and its sampling variance per signal, not the weights
        derived from them. The population mean and between-reader variance those weights
        are measured against cannot be computed from one reader, so the two are kept apart:
        anything that refits those constants needs the raw values.

        Half the profile builds the taste model; the other half is what the signals are
        asked to rank, split above and below the reader's own mean on the first half. The
        reader's own mean rather than a fixed mark, because scales differ enough between
        readers that a fixed one decides how many titles are gradeable at all.

        The two halves are disjoint so that neither item-item table can return a title's
        own row: a title scored against a similarity list seeded by itself matches
        perfectly and every reader would look like a similarity reader.
        """
        scores = vote_scores(user_votes)
        if len(scores) < PER_USER_WEIGHTS_MIN_PROFILE:
            return None

        seed_ids, target_ids = fit_split(scores)
        if not seed_ids or not target_ids:
            return None

        seed_mean = sum(scores[vn_id] for vn_id in seed_ids) / len(seed_ids)
        positives = [vn_id for vn_id in target_ids if scores[vn_id] > seed_mean]
        negatives = [vn_id for vn_id in target_ids if scores[vn_id] < seed_mean]
        if PER_USER_WEIGHTS_USE_DROPPED and negative_vn_ids:
            # Abandoned titles carry no rating, so they can only ever be negatives, and
            # they are sorted so the fit does not depend on the order a set iterated in.
            negatives = negatives + sorted(
                vn_id for vn_id in negative_vn_ids if vn_id not in scores
            )
        if (
            len(positives) < PER_USER_WEIGHTS_MIN_CLASS
            or len(negatives) < PER_USER_WEIGHTS_MIN_CLASS
            or len(positives) * len(negatives) < PER_USER_WEIGHTS_MIN_PAIRS
        ):
            return None

        seed_set = set(seed_ids)
        seed_votes = [
            vote for vote in user_votes
            if (vote.get("vn_id") or vote.get("id")) in seed_set
        ]
        seed_profile = await self._build_user_profile(seed_votes, spoiler_level=spoiler_level)
        by_signal = await self._score_signals_for_fit(
            positives + negatives, seed_profile, spoiler_level=spoiler_level
        )

        fits: dict[str, tuple[float, float]] = {}
        for signal, signal_scores in by_signal.items():
            area = tie_aware_auc(
                [signal_scores[vn_id] for vn_id in positives],
                [signal_scores[vn_id] for vn_id in negatives],
            )
            if area is None:
                continue
            fits[signal] = (area, auc_variance(area, len(positives), len(negatives)))

        logger.debug(
            f"Fitted signal weights over {len(positives)} liked and {len(negatives)} "
            f"disliked titles from a {len(scores)}-title profile"
        )
        return {
            "fits": fits,
            "n_pos": len(positives),
            "n_neg": len(negatives),
            "n_profile": len(scores),
        }

    async def _score_signals_for_fit(
        self,
        vn_ids: list[str],
        profile: dict,
        spoiler_level: int = 0,
    ) -> dict[str, dict[str, float]]:
        """Score a set of the reader's own titles under each signal separately.

        Uses the scorers the request path uses, so the fit measures the signals as they
        are actually computed. A title missing from an item-item table scores zero here
        exactly as it does when it is a candidate, which is what makes the two comparable.
        """
        if not vn_ids:
            return {}

        all_tags = await self._batch_get_vn_tags(vn_ids, spoiler_level=spoiler_level)
        all_developers = await self._batch_get_vn_developers(vn_ids)
        all_staff = await self._batch_get_vn_staff(vn_ids)
        all_seiyuu = await self._batch_get_vn_seiyuu(vn_ids)
        all_traits = await self._batch_get_vn_traits(vn_ids, spoiler_level=spoiler_level)

        rating_rows = await self.db.execute(
            select(VisualNovel.id, VisualNovel.average_rating, VisualNovel.rating)
            .where(in_ids(VisualNovel.id, vn_ids))
        )
        ratings = {
            row.id: quality_score_for(row.average_rating, row.rating)[0]
            for row in rating_rows.all()
        }

        favourites = profile.get("high_rated_vns", [])
        vn_scores = profile.get("vn_scores", {})
        similar = await self._batch_get_similar_games_scores(vn_ids, favourites, vn_scores)
        also_read = await self._batch_get_users_also_read_scores(vn_ids, favourites, vn_scores)

        return {
            "tag": {
                vn_id: self._compute_tag_score_fast(profile, all_tags.get(vn_id, {}))
                for vn_id in vn_ids
            },
            "similar_games": {vn_id: similar.get(vn_id, (0.0, []))[0] for vn_id in vn_ids},
            "users_also_read": {vn_id: also_read.get(vn_id, (0.0, []))[0] for vn_id in vn_ids},
            "quality": {vn_id: ratings.get(vn_id, 0.0) for vn_id in vn_ids},
            "developer": {
                vn_id: self._compute_developer_score_fast(profile, all_developers.get(vn_id, []))
                for vn_id in vn_ids
            },
            "staff": {
                vn_id: self._compute_staff_score_fast(profile, all_staff.get(vn_id, []))
                for vn_id in vn_ids
            },
            "trait": {
                vn_id: self._compute_trait_score_fast(profile, all_traits.get(vn_id, {}))
                for vn_id in vn_ids
            },
            "seiyuu": {
                vn_id: self._compute_seiyuu_score_fast(profile, all_seiyuu.get(vn_id, []))
                for vn_id in vn_ids
            },
            # Description affinity is left out on purpose. A title with no usable prose
            # takes no part in that signal, and a rank statistic over one reader's titles
            # has no way to express a term that is absent for some of them: filling the
            # gap with zero would measure the coverage of the corpus rather than how well
            # the signal ranks that reader. A signal with no fit keeps its global weight.
        }

    async def _exclusions_with_relations(
        self, user_votes: list[dict], exclude_vn_ids: set[str]
    ) -> set[str]:
        """The exclusion set, widened to everything related to the reader's read set.

        The read set is the rated titles plus whatever the caller already excluded, since
        a title the reader dropped is as much theirs as one they finished. Off, the set
        is returned unchanged and no query is issued.
        """
        exclude_vn_ids = set(exclude_vn_ids)
        if not RELATION_EXCLUSION:
            return exclude_vn_ids
        read_ids = {
            vote.get("vn_id") or vote.get("id") for vote in user_votes
        } | exclude_vn_ids
        read_ids.discard(None)
        return exclude_vn_ids | await related_to(self.db, read_ids)

    async def recommend(
        self,
        user_votes: list[dict],  # [{vn_id, score}, ...]
        exclude_vn_ids: set[str],
        limit: int = 50,
        min_rating: Optional[float] = None,
        min_length: Optional[int] = None,
        max_length: Optional[int] = None,
        include_tags: Optional[list[int]] = None,
        exclude_tags: Optional[list[int]] = None,
        include_traits: Optional[list[int]] = None,
        exclude_traits: Optional[list[int]] = None,
        skip_details: bool = False,
        japanese_only: bool = True,
        spoiler_level: int = 0,
        filters: Optional[VNFilterSpec] = None,
        negative_vn_ids: Optional[set[str]] = None,
        signal_weights: Optional[dict[str, float]] = None,
        popularity_calibration: Optional[float] = None,
        reader_id: Optional[str] = None,
    ) -> list[RecommendationResult]:
        """
        Get personalized recommendations for a user.

        Args:
            user_votes: User's VN ratings [{vn_id: "v123", score: 85}, ...]
            exclude_vn_ids: VN IDs to exclude (already played)
            negative_vn_ids: VNs the reader started and abandoned. Read only while the
                per-reader weight fit is on and set to use them; nothing scores them.
            signal_weights: Weight vector to score under, naming every signal. A
                reader who has said how the signals should be balanced has answered the
                question the per-reader fit exists to guess, so it is not consulted.
                Absent, the vector is chosen as before and the divisor is unchanged.
            limit: Max recommendations to return
            min_rating: Minimum global rating filter
            min_length: Minimum length (1-5) filter
            max_length: Maximum length (1-5) filter
            include_tags: Only include VNs with these tags
            exclude_tags: Exclude VNs with these tags
            include_traits: Only include VNs with characters having these traits
            exclude_traits: Exclude VNs with characters having these traits
            japanese_only: Only include Japanese original language VNs (default True)
            filters: Shared visual novel filter vocabulary, pushed into candidate
                selection rather than applied to its results
            reader_id: The reader's VNDB id, read only by the collaborative signal, which
                looks the reader up in the nightly model; absent, that signal is silent.

        Returns:
            List of RecommendationResult sorted by score

        Also sets ``last_pool``, describing the candidate pool the page was drawn from.
        """
        self.last_pool = {
            "candidates": 0,
            "requested": limit,
            "filtered": False,
            "widened": False,
            "topped_up": False,
            "thin": True,
        }
        if not user_votes:
            return []

        timings = StageTimer()

        exclude_vn_ids = await self._exclusions_with_relations(user_votes, exclude_vn_ids)
        timings.mark("relations")

        # Build user profile from their ratings
        user_profile = await self._build_user_profile(user_votes, spoiler_level=spoiler_level)
        timings.mark("profile")
        high_rated_vns = user_profile.get("high_rated_vns", [])
        vn_scores = user_profile.get("vn_scores", {})  # VN ID -> score (0-10)
        logger.info(f"User has {len(high_rated_vns)} favourites driving the item-item signals")

        if signal_weights is None:
            signal_weights = await self._signal_weights(
                user_votes, spoiler_level=spoiler_level, negative_vn_ids=negative_vn_ids
            )
            score_divisor = MAX_WEIGHTED_SCORE
        else:
            signal_weights = dict(signal_weights)
            score_divisor = weight_total(signal_weights)
        # The collaborative term sits outside the vector, so the total a candidate could
        # reach grows by its weight while it is on and the percentage stays a share.
        if CF_SIGNAL_WEIGHT > 0:
            score_divisor += CF_SIGNAL_WEIGHT
        self.last_signal_weights = signal_weights
        self.last_score_divisor = score_divisor
        timings.mark("weights")

        # Which of the reader's own titles the related candidate sources are seeded from.
        # The lookup is one batched read over titles the reader has rated, taken only
        # while the spread is asked for; off, nothing here runs and no query is issued.
        seed_vns = None
        if RETRIEVAL_SEED_SPREAD and vn_scores:
            seed_vns = spread_seeds(
                vn_scores,
                await self._batch_get_votecounts(list(vn_scores)),
                HIGH_RATED_TARGET,
            )

        # Get candidate VNs using similarity-based selection
        candidates = await self._get_candidates(
            exclude_vn_ids=exclude_vn_ids,
            min_rating=min_rating,
            min_length=min_length,
            max_length=max_length,
            include_tags=include_tags,
            exclude_tags=exclude_tags,
            include_traits=include_traits,
            exclude_traits=exclude_traits,
            limit=candidate_pool_size(limit),
            high_rated_vns=high_rated_vns,
            elite_tag_ids=user_profile.get("elite_tag_ids"),
            japanese_only=japanese_only,
            spoiler_level=spoiler_level,
            filters=filters,
            # A pool that reaches the page size is the point at which widening stops:
            # below it the page is short no matter how well the scoring runs.
            target_pool=limit,
            seed_vns=seed_vns,
            user_profile=user_profile,
            # The vector the pool will be ranked under decides how the pool is collected
            # as well, so a signal a reader turns up sends its source looking rather than
            # only reordering what the other sources happened to find.
            signal_weights=signal_weights,
        )
        timings.mark("retrieval")

        if not candidates:
            return []

        # Batch load tags for all candidates (optimization)
        candidate_ids = [vn["id"] for vn in candidates]
        all_tags = await self._batch_get_vn_tags(candidate_ids, spoiler_level=spoiler_level)
        timings.mark("cand_tags")
        all_developers = await self._batch_get_vn_developers(candidate_ids)
        timings.mark("cand_developers")
        all_staff = await self._batch_get_vn_staff(candidate_ids)
        timings.mark("cand_staff")
        all_seiyuu = await self._batch_get_vn_seiyuu(candidate_ids)
        timings.mark("cand_seiyuu")
        all_traits = await self._batch_get_vn_traits(candidate_ids, spoiler_level=spoiler_level)
        timings.mark("cand_traits")

        # Load tag names for generating specific match reasons
        user_tag_ids = set(user_profile["tag_weights"].keys())
        all_vn_tag_ids = set()
        for vn_tags in all_tags.values():
            all_vn_tag_ids.update(vn_tags.keys())
        relevant_tag_ids = user_tag_ids.intersection(all_vn_tag_ids)
        tag_names = await self._batch_get_tag_names(relevant_tag_ids)

        # Load staff names for matching staff (only for details)
        staff_names = {}
        seiyuu_names = {}
        trait_names = {}
        if not skip_details:
            user_staff_ids = set(user_profile.get("preferred_staff", {}).keys())
            all_vn_staff_ids = set()
            for staff_list in all_staff.values():
                all_vn_staff_ids.update(staff_list)
            relevant_staff_ids = user_staff_ids.intersection(all_vn_staff_ids)
            staff_names = await self._batch_get_staff_names(relevant_staff_ids)

            # Load seiyuu names (seiyuu are also staff)
            user_seiyuu_ids = set(user_profile.get("preferred_seiyuu", {}).keys())
            all_vn_seiyuu_ids = set()
            for seiyuu_list in all_seiyuu.values():
                all_vn_seiyuu_ids.update(seiyuu_list)
            relevant_seiyuu_ids = user_seiyuu_ids.intersection(all_vn_seiyuu_ids)
            seiyuu_names = await self._batch_get_staff_names(relevant_seiyuu_ids)

            # Load trait names
            user_trait_ids = set(user_profile.get("preferred_traits", {}).keys())
            all_vn_trait_ids = set()
            for trait_dict in all_traits.values():
                all_vn_trait_ids.update(trait_dict.keys())
            relevant_trait_ids = user_trait_ids.intersection(all_vn_trait_ids)
            trait_names = await self._batch_get_trait_names(relevant_trait_ids)

        # Titles and tags of the reader's favourites, for the "because you liked" list.
        # The candidate tag load above covers candidates only, and the favourites are by
        # definition not candidates, so without this read the list is always empty.
        user_vn_titles = {}
        favourite_tags: dict[str, dict] = {}
        if not skip_details:
            user_vn_titles = await self._batch_get_vn_titles(high_rated_vns[:20])
            favourite_tags = await self._batch_get_vn_tags(
                high_rated_vns[:20], spoiler_level=spoiler_level
            )
        timings.mark("names")

        # Batch load Similar Games scores (from VNSimilarity table - same as VN page)
        similar_games_data = await self._batch_get_similar_games_scores(
            candidate_ids=candidate_ids,
            high_rated_vns=high_rated_vns,
            vn_scores=vn_scores,
        )

        # Batch load Users Also Read scores (from VNCoOccurrence table - same as VN page)
        users_also_read_data = await self._batch_get_users_also_read_scores(
            candidate_ids=candidate_ids,
            high_rated_vns=high_rated_vns,
            vn_scores=vn_scores,
        )
        timings.mark("item_item")

        # Latent-factor agreement over the pool. Two queries, issued only while the signal
        # carries weight and the caller named a reader, so the default request costs
        # nothing for it.
        cf_scores: dict[str, float] = {}
        if CF_SIGNAL_WEIGHT > 0 and reader_id:
            cf_scores = await self._collaborative_scores_for(reader_id, candidate_ids)
        timings.mark("collaborative")

        # Description affinity for the pool, from the resident matrix. Ids absent from it
        # carry no description worth reading and take no part in the signal.
        description_scores = self._description_scores(candidate_ids, high_rated_vns)

        # Read against the reader's whole rated list rather than their favourites, since a
        # prediction has to be able to fall; see _description_rating_neighbours.
        rating_neighbours = (
            self._description_rating_neighbours(candidate_ids, vn_scores)
            if PREDICTED_RATING
            else {}
        )
        similarity_neighbours = (
            await self._similarity_rating_neighbours(candidate_ids, vn_scores)
            if PREDICTED_RATING
            else {}
        )
        timings.mark("description")

        # Availability of the two item-item signals, one batched probe each. Both are
        # consensus signals, which the catalogue blend adds as they stand rather than
        # dividing by, so the probes are read only by the flat sum's divisor and the
        # blended path issues neither query.
        evidence_gated = evidence_gating_active() and not CATALOGUE_BLEND
        similarity_available: set[str] = set()
        cooccurrence_available: set[str] = set()
        if evidence_gated:
            similarity_available = await self._batch_get_similarity_presence(candidate_ids)
            cooccurrence_available = await self._batch_get_cooccurrence_presence(candidate_ids)
        timings.mark("evidence")

        # Score each candidate using cached data
        scored = []
        for vn in candidates:
            vn_id = vn["id"]
            vn_tags = all_tags.get(vn_id, {})
            vn_developers = all_developers.get(vn_id, [])
            vn_staff = all_staff.get(vn_id, [])
            vn_seiyuu = all_seiyuu.get(vn_id, [])
            vn_traits = all_traits.get(vn_id, {})

            # Compute scores using cached data
            tag_score = self._compute_tag_score_fast(user_profile, vn_tags)
            developer_score = self._compute_developer_score_fast(user_profile, vn_developers)
            staff_score = self._compute_staff_score_fast(user_profile, vn_staff)
            seiyuu_score = self._compute_seiyuu_score_fast(user_profile, vn_seiyuu)
            trait_score = self._compute_trait_score_fast(user_profile, vn_traits)

            # Compute quality score from average rating (not Bayesian)
            quality_score, quality_present = quality_score_for(
                vn.get("average_rating"), vn.get("rating")
            )

            # Get VN page similarity scores (Similar Games + Users Also Read)
            similar_games_score, similar_games_details_raw = similar_games_data.get(vn_id, (0.0, []))
            users_also_read_score, users_also_read_details_raw = users_also_read_data.get(vn_id, (0.0, []))

            # Enrich details with VN titles (for display in frontend)
            similar_games_details = attach_source_titles(similar_games_details_raw, user_vn_titles)
            users_also_read_details = attach_source_titles(users_also_read_details_raw, user_vn_titles)

            description_score = description_scores.get(vn_id, 0.0)
            collaborative_score = cf_scores.get(vn_id, 0.0)

            predicted_ratings = self._predicted_ratings(
                user_profile,
                vn_tags=vn_tags,
                vn_developers=vn_developers,
                vn_staff=vn_staff,
                vn_seiyuu=vn_seiyuu,
                vn_traits=vn_traits,
                average_rating=vn.get("average_rating"),
                description_neighbours=rating_neighbours.get(vn_id, ()),
                similarity_neighbours=similarity_neighbours.get(vn_id, ()),
            )
            predicted_mean, predicted_low, predicted_high = prediction_interval(
                predicted_ratings
            )

            # Catalogue evidence, put on its own scale, plus what the crowd has to add.
            total_score = blend_total(
                {
                    "tag": tag_score,
                    "similar_games": similar_games_score,
                    "users_also_read": users_also_read_score,
                    "developer": developer_score,
                    "staff": staff_score,
                    "seiyuu": seiyuu_score,
                    "trait": trait_score,
                    "quality": quality_score,
                    "description": description_score,
                },
                signal_weights,
                present_signals(
                    has_tags=bool(vn_tags),
                    has_similar_games=vn_id in similarity_available,
                    has_users_also_read=vn_id in cooccurrence_available,
                    has_quality=quality_present,
                    has_developers=entity_evidence(
                        user_profile.get("preferred_developers"), vn_developers
                    ),
                    has_staff=entity_evidence(
                        user_profile.get("preferred_staff"), vn_staff
                    ),
                    has_traits=entity_evidence(
                        user_profile.get("preferred_traits"), vn_traits
                    ),
                    has_seiyuu=entity_evidence(
                        user_profile.get("preferred_seiyuu"), vn_seiyuu
                    ),
                    has_description=vn_id in description_scores,
                ),
            )

            # Marked down for carrying material the reader's own marks argue against. A
            # factor rather than a subtraction, so a candidate with nothing to damp cannot
            # rise above one that matches well apart from a single unwelcome element.
            total_score *= dislike_damping(vn_tags, user_profile.get("tag_dislikes", {}))

            # A term outside the weight vector: the vector is what readers tune and what
            # every published percentage divides by, and an unmeasured signal must not
            # appear there. Off, the weight is zero and nothing here moves.
            if CF_SIGNAL_WEIGHT > 0:
                total_score += CF_SIGNAL_WEIGHT * collaborative_score

            # Calculate normalized score (0-100) before popularity penalty
            overall_normalized_score = normalize_score(total_score, score_divisor)

            # Note: Popularity penalty disabled - letting quality scores speak for themselves

            # Build simple match reasons (details computed later for top results only)
            reasons = []
            user_tags = user_profile["tag_weights"]

            # Always use fast path for scoring loop - details added after MMR
            # Count matching tags for basic reason
            matching_tag_count = sum(1 for tag_id in vn_tags if tag_id in user_tags and user_tags[tag_id] > 0)
            if tag_score > 0.2 and matching_tag_count > 0:
                # Get top 3 tag names for reason
                # Named by how far above the reader's own mean they rate the tag, so the
                # line says what they like rather than what they have read most of.
                tag_means = user_profile.get("tag_means", {})
                reader_mean = user_profile.get("user_overall_avg", 7.0)
                ranked = [
                    (
                        tag_id,
                        (tag_means.get(tag_id, reader_mean) - reader_mean) * vn_tags.get(tag_id, 0),
                    )
                    for tag_id in vn_tags
                    if tag_id in user_tags
                ]
                top_tags = sorted(
                    [pair for pair in ranked if pair[1] > 0], key=lambda x: (-x[1], x[0])
                )[:3]
                if top_tags:
                    top_tag_names = [tag_names.get(tid, f"Tag {tid}") for tid, _ in top_tags]
                    reasons.append(", ".join(top_tag_names))

            if description_score > 0.5:
                reasons.append("Reads like your favorites")

            if similar_games_score > 0.3:
                reasons.append("Similar to your favorites")

            if users_also_read_score > 0.3:
                reasons.append("Fans also enjoyed")

            if developer_score > 0.2:
                # The line names studios, so it is the studio signal that earns it.
                user_devs = user_profile.get("preferred_developers", {})
                vn_devs_set = set(vn_developers)
                matching_devs = list(vn_devs_set.intersection(user_devs.keys()))[:2]
                if matching_devs:
                    reasons.append("By " + ", ".join(matching_devs))

            # Initialize empty detail containers (populated after MMR if needed)
            matched_tags_detail = []
            matched_developers_detail = []
            matched_staff_detail = []
            matched_seiyuu_detail = []
            matched_traits_detail = []
            contributing_vns_detail = []

            scored.append(RecommendationResult(
                vn_id=vn_id,
                title=vn["title"],
                score=total_score,
                normalized_score=overall_normalized_score,
                match_reasons=reasons if reasons else ["Matches your preferences"],
                image_url=vn.get("image_url"),
                image_sexual=vn.get("image_sexual"),
                rating=vn.get("average_rating") or vn.get("rating"),  # Prefer average
                title_jp=vn.get("title_jp"),
                title_romaji=vn.get("title_romaji"),
                tag_score=tag_score,
                similar_games_score=similar_games_score,
                users_also_read_score=users_also_read_score,
                developer_score=developer_score,
                staff_score=staff_score,
                seiyuu_score=seiyuu_score,
                trait_score=trait_score,
                quality_score=quality_score,
                description_score=description_score,
                collaborative_score=collaborative_score,
                matched_tags=matched_tags_detail,
                matched_staff=matched_staff_detail,
                matched_developers=matched_developers_detail,
                matched_seiyuu=matched_seiyuu_detail,
                matched_traits=matched_traits_detail,
                contributing_vns=contributing_vns_detail,
                similar_games_details=similar_games_details,
                users_also_read_details=users_also_read_details,
                predicted_ratings=predicted_ratings,
                predicted_rating=predicted_mean,
                predicted_rating_low=predicted_low,
                predicted_rating_high=predicted_high,
            ))

        timings.mark("scoring")

        # How far the signals agree on each candidate, and under the fusion aggregation the
        # order the page is built in. Kept together so a page ordered either way reports
        # the same agreement figure.
        weighted_scores = self._apply_rank_agreement(scored, score_divisor, signal_weights)

        # Sort by score, ties settled by the weighted sum where one aggregation leaves
        # candidates level that the other separates.
        scored.sort(
            key=lambda x: (x.score, weighted_scores.get(x.vn_id, x.score)), reverse=True
        )

        # The reader's own popularity spread, and where each candidate sits against it.
        # Built here, after scoring, so it re-ranks what the engine already produced
        # rather than deciding what is scored.
        calibration = await self._popularity_calibration(
            vn_scores, candidates, popularity_calibration
        )
        timings.mark("ordering")

        # Limit candidates for diversity reranking (performance optimization)
        # Only need 2x limit since MMR will select from top candidates anyway
        pool_size = limit * 2
        if calibration is not None:
            pool_size = (
                limit * POPULARITY_CALIBRATION_POOL
                if POPULARITY_CALIBRATION_POOL > 0
                else len(scored)
            )
        candidates_for_mmr = scored[:pool_size] if len(scored) > pool_size else scored
        logger.info(f"MMR input: {len(candidates_for_mmr)} candidates (from {len(scored)} total)")

        # Apply diversity reranking to prevent clustering
        diverse_results = await self._apply_diversity_reranking(
            recommendations=candidates_for_mmr,
            all_tags=all_tags,
            limit=limit,
            diversity_weight=0.3,
            calibration=calibration,
        )
        timings.mark("diversity")

        # Compute details only for final results (performance optimization)
        # This is done AFTER MMR so we only compute for ~100 results, not 400+
        if not skip_details:
            logger.info(f"Computing details for {len(diverse_results)} final results")
            user_overall_avg = user_profile.get("user_overall_avg", 7.0)
            tag_weighted_scores = user_profile.get("tag_weighted_scores", {})
            tag_absolute_scores = user_profile.get("tag_absolute_scores", {})
            tag_counts = user_profile.get("tag_counts", {})
            tag_idf = user_profile.get("tag_idf", {})
            max_tag_weighted = user_profile.get("max_tag_weighted", 1.0)
            user_devs = user_profile.get("preferred_developers", {})
            user_staff_prefs = user_profile.get("preferred_staff", {})
            dev_weighted_scores = user_profile.get("dev_weighted_scores", {})
            dev_counts = user_profile.get("dev_counts", {})
            dev_means = user_profile.get("dev_means", {})
            staff_weighted_scores = user_profile.get("staff_weighted_scores", {})
            staff_counts = user_profile.get("staff_counts", {})
            staff_means = user_profile.get("staff_means", {})
            max_dev_weighted = user_profile.get("max_dev_weighted", 1.0)
            max_staff_weighted = user_profile.get("max_staff_weighted", 1.0)
            user_seiyuu_prefs = user_profile.get("preferred_seiyuu", {})
            seiyuu_weighted_scores = user_profile.get("seiyuu_weighted_scores", {})
            seiyuu_counts = user_profile.get("seiyuu_counts", {})
            max_seiyuu_weighted = user_profile.get("max_seiyuu_weighted", 1.0)
            user_trait_prefs = user_profile.get("preferred_traits", {})
            trait_weighted_scores = user_profile.get("trait_weighted_scores", {})
            trait_counts = user_profile.get("trait_counts", {})
            max_trait_weighted = user_profile.get("max_trait_weighted", 1.0)
            user_tags = user_profile["tag_weights"]

            matched_dev_names = {
                dev
                for result in diverse_results
                for dev in all_developers.get(result.vn_id, [])
                if dev in user_devs
            }
            dev_originals = await self._batch_get_producer_originals(matched_dev_names)

            # Which of the reader's own titles each finished result reads closest to.
            # Computed over the page rather than the pool: the reason is only shown for
            # titles that reached it.
            description_neighbours = self._description_neighbours(
                [result.vn_id for result in diverse_results], high_rated_vns
            )

            for result in diverse_results:
                vn_id = result.vn_id
                vn_tags = all_tags.get(vn_id, {})
                vn_developers = all_developers.get(vn_id, [])
                vn_staff = all_staff.get(vn_id, [])
                vn_seiyuu = all_seiyuu.get(vn_id, [])
                vn_traits = all_traits.get(vn_id, {})

                # === Detailed matched tags ===
                matched_tags_detail = []
                for tag_id, vn_tag_score in vn_tags.items():
                    if tag_id in user_tags and user_tags[tag_id] > 0:
                        tag_absolute = tag_absolute_scores.get(tag_id, 0)
                        idf = tag_idf.get(tag_id, 1.0)
                        contribution = user_tags[tag_id] * vn_tag_score
                        weighted_score_raw = tag_weighted_scores.get(tag_id, user_overall_avg)
                        normalized_score = (weighted_score_raw / max_tag_weighted) * 100 if max_tag_weighted > 0 else 0
                        matched_tags_detail.append({
                            "id": tag_id,
                            "name": tag_names.get(tag_id, f"Tag {tag_id}"),
                            "user_weight": round(tag_absolute, 2),
                            "vn_score": round(vn_tag_score, 2),
                            "contribution": round(contribution, 2),
                            "idf": round(idf, 2),
                            "weighted_score": round(normalized_score, 1),
                            "count": round(tag_counts.get(tag_id, 0), 1),
                        })
                matched_tags_detail.sort(key=lambda x: x["weighted_score"], reverse=True)
                result.matched_tags = matched_tags_detail[:10]

                # === Detailed matched developers ===
                matched_developers_detail = []
                vn_devs_set = set(vn_developers)
                for dev_name in vn_devs_set.intersection(user_devs.keys()):
                    dev_delta = user_devs.get(dev_name, 0)
                    # Under the preference switch the stored value is a centred preference
                    # rather than a delta in rating points, so the reader's mark for the
                    # entity is read from its damped mean instead.
                    if ENTITY_PREFERENCE:
                        user_avg_rating = dev_means.get(dev_name, user_overall_avg)
                    else:
                        user_avg_rating = dev_delta + user_overall_avg
                    weighted_score_raw = dev_weighted_scores.get(dev_name, user_overall_avg)
                    normalized_score = (weighted_score_raw / max_dev_weighted) * 100 if max_dev_weighted > 0 else 0
                    matched_developers_detail.append({
                        "name": dev_name,
                        "name_original": dev_originals.get(dev_name),
                        "user_avg_rating": round(user_avg_rating, 1),
                        "weight": round(dev_delta, 2),
                        "weighted_score": round(normalized_score, 1),
                        "count": round(dev_counts.get(dev_name, 0), 1),
                    })
                matched_developers_detail.sort(key=lambda x: x["weighted_score"], reverse=True)
                result.matched_developers = matched_developers_detail

                # === Detailed matched staff ===
                matched_staff_detail = []
                vn_staff_set = set(vn_staff)
                for staff_id in vn_staff_set.intersection(user_staff_prefs.keys()):
                    staff_entry = staff_names.get(staff_id) or {}
                    staff_name = staff_entry.get("name") or ""
                    if staff_name:
                        staff_delta = user_staff_prefs.get(staff_id, 0)
                        if ENTITY_PREFERENCE:
                            user_avg_rating = staff_means.get(staff_id, user_overall_avg)
                        else:
                            user_avg_rating = staff_delta + user_overall_avg
                        weighted_score_raw = staff_weighted_scores.get(staff_id, user_overall_avg)
                        normalized_score = (weighted_score_raw / max_staff_weighted) * 100 if max_staff_weighted > 0 else 0
                        matched_staff_detail.append({
                            "id": staff_id,
                            "name": staff_name,
                            "name_original": staff_entry.get("original"),
                            "user_avg_rating": round(user_avg_rating, 1),
                            "weight": round(staff_delta, 2),
                            "weighted_score": round(normalized_score, 1),
                            "count": round(staff_counts.get(staff_id, 0), 1),
                        })
                matched_staff_detail.sort(key=lambda x: x["weighted_score"], reverse=True)
                result.matched_staff = matched_staff_detail

                # === Detailed matched seiyuu ===
                matched_seiyuu_detail = []
                vn_seiyuu_set = set(vn_seiyuu)
                for seiyuu_id in vn_seiyuu_set.intersection(user_seiyuu_prefs.keys()):
                    seiyuu_entry = seiyuu_names.get(seiyuu_id) or {}
                    seiyuu_name = seiyuu_entry.get("name") or ""
                    if seiyuu_name:
                        weighted_score_raw = seiyuu_weighted_scores.get(seiyuu_id, user_overall_avg)
                        normalized_score = (weighted_score_raw / max_seiyuu_weighted) * 100 if max_seiyuu_weighted > 0 else 0
                        matched_seiyuu_detail.append({
                            "id": seiyuu_id,
                            "name": seiyuu_name,
                            "name_original": seiyuu_entry.get("original"),
                            "weighted_score": round(normalized_score, 1),
                            "count": round(seiyuu_counts.get(seiyuu_id, 0), 1),
                        })
                matched_seiyuu_detail.sort(key=lambda x: x["weighted_score"], reverse=True)
                result.matched_seiyuu = matched_seiyuu_detail[:5]

                # === Detailed matched traits ===
                matched_traits_detail = []
                for trait_id, trait_weight in vn_traits.items():
                    if trait_id in user_trait_prefs:
                        trait_name = trait_names.get(trait_id, "")
                        if trait_name:
                            weighted_score_raw = trait_weighted_scores.get(trait_id, user_overall_avg)
                            normalized_score = (weighted_score_raw / max_trait_weighted) * 100 if max_trait_weighted > 0 else 0
                            matched_traits_detail.append({
                                "id": trait_id,
                                "name": trait_name,
                                "weighted_score": round(normalized_score, 1),
                                "count": round(trait_counts.get(trait_id, 0), 1),
                            })
                matched_traits_detail.sort(key=lambda x: x["weighted_score"], reverse=True)
                result.matched_traits = matched_traits_detail[:5]

                # === Contributing VNs (computes similarity for each) ===
                contributing_vns_detail = []
                for user_vn_id in high_rated_vns[:20]:
                    user_vn_tags = favourite_tags.get(user_vn_id, {})
                    if not user_vn_tags:
                        continue
                    sim = self._compute_tag_similarity(user_vn_tags, vn_tags)
                    if sim > 0.3:
                        titles = user_vn_titles.get(user_vn_id) or {}
                        contributing_vns_detail.append({
                            "id": user_vn_id,
                            "title": titles.get("title") or user_vn_id,
                            "title_jp": titles.get("title_jp"),
                            "title_romaji": titles.get("title_romaji"),
                            "similarity": round(sim * 100, 0),
                        })
                contributing_vns_detail.sort(key=lambda x: x["similarity"], reverse=True)
                result.contributing_vns = contributing_vns_detail[:5]

                result.description_matches = attach_source_titles(
                    description_neighbours.get(vn_id, []), user_vn_titles
                )

        timings.mark("details")
        logger.info("Recommendation timing: %s", timings.report())
        return diverse_results

    async def get_details_for_vn(
        self,
        user_votes: list[dict],
        vn_id: str,
        spoiler_level: int = 0,
        negative_vn_ids: Optional[set[str]] = None,
        signal_weights: Optional[dict[str, float]] = None,
    ) -> Optional[RecommendationResult]:
        """
        Compute detailed recommendation breakdown for a single VN.

        This is optimized for fetching details on-demand after the initial
        recommendations list is displayed (without details).

        Scores under the same weight vector as the list, which ``last_signal_weights``
        carries back to the caller: a breakdown adding up to a different total than the
        percentage beside it is worse than no breakdown. A caller that supplied its own
        weights to the list must supply the same ones here for that to hold.
        """
        if not user_votes:
            return None

        # Build user profile
        user_profile = await self._build_user_profile(user_votes, spoiler_level=spoiler_level)
        high_rated_vns = user_profile.get("high_rated_vns", [])
        vn_scores = user_profile.get("vn_scores", {})

        if signal_weights is None:
            signal_weights = await self._signal_weights(
                user_votes, spoiler_level=spoiler_level, negative_vn_ids=negative_vn_ids
            )
            score_divisor = MAX_WEIGHTED_SCORE
        else:
            signal_weights = dict(signal_weights)
            score_divisor = weight_total(signal_weights)
        self.last_signal_weights = signal_weights
        self.last_score_divisor = score_divisor

        # Get VN info
        vn_result = await self.db.execute(
            select(VisualNovel)
            .where(VisualNovel.id == vn_id)
        )
        vn_row = vn_result.scalars().first()
        if not vn_row:
            return None

        # Load data for just this VN
        vn_tags = (await self._batch_get_vn_tags([vn_id], spoiler_level=spoiler_level)).get(vn_id, {})
        vn_developers = (await self._batch_get_vn_developers([vn_id])).get(vn_id, [])
        vn_staff = (await self._batch_get_vn_staff([vn_id])).get(vn_id, [])
        vn_seiyuu = (await self._batch_get_vn_seiyuu([vn_id])).get(vn_id, [])
        vn_traits = (await self._batch_get_vn_traits([vn_id], spoiler_level=spoiler_level)).get(vn_id, {})

        # Load tag names
        user_tag_ids = set(user_profile["tag_weights"].keys())
        vn_tag_ids = set(vn_tags.keys())
        relevant_tag_ids = user_tag_ids.intersection(vn_tag_ids)
        tag_names = await self._batch_get_tag_names(relevant_tag_ids)

        # Load staff names
        user_staff_ids = set(user_profile.get("preferred_staff", {}).keys())
        vn_staff_set = set(vn_staff)
        relevant_staff_ids = user_staff_ids.intersection(vn_staff_set)
        staff_names = await self._batch_get_staff_names(relevant_staff_ids)

        # Load seiyuu names (seiyuu are also staff)
        user_seiyuu_ids = set(user_profile.get("preferred_seiyuu", {}).keys())
        vn_seiyuu_set = set(vn_seiyuu)
        relevant_seiyuu_ids = user_seiyuu_ids.intersection(vn_seiyuu_set)
        seiyuu_names = await self._batch_get_staff_names(relevant_seiyuu_ids)

        # Load trait names
        user_trait_ids = set(user_profile.get("preferred_traits", {}).keys())
        vn_trait_ids = set(vn_traits.keys())
        relevant_trait_ids = user_trait_ids.intersection(vn_trait_ids)
        trait_names = await self._batch_get_trait_names(relevant_trait_ids)

        # Load user's VN titles for "because you liked" section
        user_vn_titles = await self._batch_get_vn_titles(high_rated_vns[:20])

        # Load tags for user's VNs (for similarity computation)
        all_tags = await self._batch_get_vn_tags(high_rated_vns[:20], spoiler_level=spoiler_level)
        all_tags[vn_id] = vn_tags

        # Compute scores
        tag_score = self._compute_tag_score_fast(user_profile, vn_tags)
        developer_score = self._compute_developer_score_fast(user_profile, vn_developers)
        staff_score = self._compute_staff_score_fast(user_profile, vn_staff)
        seiyuu_score = self._compute_seiyuu_score_fast(user_profile, vn_seiyuu)
        trait_score = self._compute_trait_score_fast(user_profile, vn_traits)

        # Quality score based on average rating
        quality_score, quality_present = quality_score_for(
            vn_row.average_rating, vn_row.rating
        )

        # Get Similar Games score (from VNSimilarity table)
        similar_games_data = await self._batch_get_similar_games_scores([vn_id], high_rated_vns, vn_scores)
        similar_games_score, similar_games_details_raw = similar_games_data.get(vn_id, (0.0, []))

        # Get Users Also Read score (from VNCoOccurrence table)
        users_also_read_data = await self._batch_get_users_also_read_scores([vn_id], high_rated_vns, vn_scores)
        users_also_read_score, users_also_read_details_raw = users_also_read_data.get(vn_id, (0.0, []))

        # Enrich details with VN titles (for display in frontend)
        similar_games_details = attach_source_titles(similar_games_details_raw, user_vn_titles)
        users_also_read_details = attach_source_titles(users_also_read_details_raw, user_vn_titles)

        description_scores = self._description_scores([vn_id], high_rated_vns)
        description_score = description_scores.get(vn_id, 0.0)

        # Presence is read exactly as the list path reads it. The two sums must agree or
        # the breakdown shown for a title contradicts the score it was listed with, and
        # the two item-item probes cost a query each, so they are only issued by the path
        # that divides by them.
        evidence_gated = evidence_gating_active() and not CATALOGUE_BLEND
        signals = present_signals(
            has_tags=bool(vn_tags),
            has_similar_games=(
                bool(await self._batch_get_similarity_presence([vn_id]))
                if evidence_gated else False
            ),
            has_users_also_read=(
                bool(await self._batch_get_cooccurrence_presence([vn_id]))
                if evidence_gated else False
            ),
            has_quality=quality_present,
            has_developers=entity_evidence(
                user_profile.get("preferred_developers"), vn_developers
            ),
            has_staff=entity_evidence(user_profile.get("preferred_staff"), vn_staff),
            has_traits=entity_evidence(user_profile.get("preferred_traits"), vn_traits),
            has_seiyuu=entity_evidence(user_profile.get("preferred_seiyuu"), vn_seiyuu),
            has_description=vn_id in description_scores,
        )

        total_score = blend_total(
            {
                "tag": tag_score,
                "similar_games": similar_games_score,
                "users_also_read": users_also_read_score,
                "developer": developer_score,
                "staff": staff_score,
                "seiyuu": seiyuu_score,
                "trait": trait_score,
                "quality": quality_score,
                "description": description_score,
            },
            signal_weights,
            signals,
        )

        # The single-title breakdown has to agree with the page it was opened from.
        total_score *= dislike_damping(vn_tags, user_profile.get("tag_dislikes", {}))

        # Calculate normalized score (0-100) before any adjustments
        overall_normalized_score = normalize_score(total_score, score_divisor)

        # Build detailed breakdown
        user_tags = user_profile["tag_weights"]
        tag_weighted_scores = user_profile.get("tag_weighted_scores", {})
        tag_absolute_scores = user_profile.get("tag_absolute_scores", {})
        tag_counts = user_profile.get("tag_counts", {})
        tag_idf = user_profile.get("tag_idf", {})
        user_overall_avg = user_profile.get("user_overall_avg", 7.0)
        max_tag_weighted = user_profile.get("max_tag_weighted", 1.0)
        max_dev_weighted = user_profile.get("max_dev_weighted", 1.0)
        max_staff_weighted = user_profile.get("max_staff_weighted", 1.0)

        # Matched tags
        matched_tags_detail = []
        for tag_id, vn_tag_score in vn_tags.items():
            if tag_id in user_tags and user_tags[tag_id] > 0:
                # Get absolute score for display (not IDF-weighted)
                tag_absolute = tag_absolute_scores.get(tag_id, 0)
                idf = tag_idf.get(tag_id, 1.0)
                # Contribution to score uses IDF-weighted user_tags
                contribution = user_tags[tag_id] * vn_tag_score
                weighted_score_raw = tag_weighted_scores.get(tag_id, user_overall_avg)
                # Normalize to 0-100 scale where user's top tag = 100 (matches stats page)
                normalized_score = (weighted_score_raw / max_tag_weighted) * 100 if max_tag_weighted > 0 else 0
                matched_tags_detail.append({
                    "id": tag_id,
                    "name": tag_names.get(tag_id, f"Tag {tag_id}"),
                    "user_weight": round(tag_absolute, 2),  # Display absolute, not IDF-weighted
                    "vn_score": round(vn_tag_score, 2),
                    "contribution": round(contribution, 2),
                    "idf": round(idf, 2),  # NEW: Show IDF for transparency
                    "weighted_score": round(normalized_score, 1),
                    "count": round(tag_counts.get(tag_id, 0), 1),
                })
        matched_tags_detail.sort(key=lambda x: x["weighted_score"], reverse=True)
        matched_tags_detail = matched_tags_detail[:10]

        # Matched developers
        user_devs = user_profile.get("preferred_developers", {})
        dev_weighted_scores = user_profile.get("dev_weighted_scores", {})
        dev_counts = user_profile.get("dev_counts", {})
        dev_means = user_profile.get("dev_means", {})
        vn_devs_set = set(vn_developers)
        matched_dev_names = vn_devs_set.intersection(user_devs.keys())
        dev_originals = await self._batch_get_producer_originals(matched_dev_names)

        matched_developers_detail = []
        for dev_name in matched_dev_names:
            dev_delta = user_devs.get(dev_name, 0)
            if ENTITY_PREFERENCE:
                user_avg_rating = dev_means.get(dev_name, user_overall_avg)
            else:
                user_avg_rating = dev_delta + user_overall_avg
            weighted_score_raw = dev_weighted_scores.get(dev_name, user_overall_avg)
            # Normalize to 0-100 scale where user's top developer = 100 (matches stats page)
            normalized_score = (weighted_score_raw / max_dev_weighted) * 100 if max_dev_weighted > 0 else 0
            matched_developers_detail.append({
                "name": dev_name,
                "name_original": dev_originals.get(dev_name),
                "user_avg_rating": round(user_avg_rating, 1),
                "weight": round(dev_delta, 2),
                "weighted_score": round(normalized_score, 1),
                "count": round(dev_counts.get(dev_name, 0), 1),
            })
        matched_developers_detail.sort(key=lambda x: x["weighted_score"], reverse=True)

        # Matched staff
        user_staff_prefs = user_profile.get("preferred_staff", {})
        staff_weighted_scores = user_profile.get("staff_weighted_scores", {})
        staff_counts = user_profile.get("staff_counts", {})
        staff_means = user_profile.get("staff_means", {})

        matched_staff_detail = []
        for staff_id in vn_staff_set.intersection(user_staff_prefs.keys()):
            staff_entry = staff_names.get(staff_id) or {}
            staff_name = staff_entry.get("name") or ""
            if staff_name:
                staff_delta = user_staff_prefs.get(staff_id, 0)
                if ENTITY_PREFERENCE:
                    user_avg_rating = staff_means.get(staff_id, user_overall_avg)
                else:
                    user_avg_rating = staff_delta + user_overall_avg
                weighted_score_raw = staff_weighted_scores.get(staff_id, user_overall_avg)
                # Normalize to 0-100 scale where user's top staff = 100 (matches stats page)
                normalized_score = (weighted_score_raw / max_staff_weighted) * 100 if max_staff_weighted > 0 else 0
                matched_staff_detail.append({
                    "id": staff_id,
                    "name": staff_name,
                    "name_original": staff_entry.get("original"),
                    "user_avg_rating": round(user_avg_rating, 1),
                    "weight": round(staff_delta, 2),
                    "weighted_score": round(normalized_score, 1),
                    "count": round(staff_counts.get(staff_id, 0), 1),
                })
        matched_staff_detail.sort(key=lambda x: x["weighted_score"], reverse=True)

        # Matched seiyuu
        user_seiyuu_prefs = user_profile.get("preferred_seiyuu", {})
        seiyuu_weighted_scores = user_profile.get("seiyuu_weighted_scores", {})
        seiyuu_counts = user_profile.get("seiyuu_counts", {})
        max_seiyuu_weighted = user_profile.get("max_seiyuu_weighted", 1.0)

        matched_seiyuu_detail = []
        for seiyuu_id in vn_seiyuu_set.intersection(user_seiyuu_prefs.keys()):
            seiyuu_entry = seiyuu_names.get(seiyuu_id) or {}
            seiyuu_name = seiyuu_entry.get("name") or ""
            if seiyuu_name:
                weighted_score_raw = seiyuu_weighted_scores.get(seiyuu_id, user_overall_avg)
                normalized_score = (weighted_score_raw / max_seiyuu_weighted) * 100 if max_seiyuu_weighted > 0 else 0
                matched_seiyuu_detail.append({
                    "id": seiyuu_id,
                    "name": seiyuu_name,
                    "name_original": seiyuu_entry.get("original"),
                    "weighted_score": round(normalized_score, 1),
                    "count": round(seiyuu_counts.get(seiyuu_id, 0), 1),
                })
        matched_seiyuu_detail.sort(key=lambda x: x["weighted_score"], reverse=True)
        matched_seiyuu_detail = matched_seiyuu_detail[:5]

        # Matched traits
        user_trait_prefs = user_profile.get("preferred_traits", {})
        trait_weighted_scores = user_profile.get("trait_weighted_scores", {})
        trait_counts = user_profile.get("trait_counts", {})
        max_trait_weighted = user_profile.get("max_trait_weighted", 1.0)

        matched_traits_detail = []
        for trait_id in vn_trait_ids.intersection(user_trait_prefs.keys()):
            trait_name = trait_names.get(trait_id, "")
            if trait_name:
                weighted_score_raw = trait_weighted_scores.get(trait_id, user_overall_avg)
                normalized_score = (weighted_score_raw / max_trait_weighted) * 100 if max_trait_weighted > 0 else 0
                matched_traits_detail.append({
                    "id": trait_id,
                    "name": trait_name,
                    "weighted_score": round(normalized_score, 1),
                    "count": round(trait_counts.get(trait_id, 0), 1),
                })
        matched_traits_detail.sort(key=lambda x: x["weighted_score"], reverse=True)
        matched_traits_detail = matched_traits_detail[:5]

        # Contributing VNs
        contributing_vns_detail = []
        for user_vn_id in high_rated_vns[:20]:
            user_vn_tags = all_tags.get(user_vn_id, {})
            if not user_vn_tags:
                continue
            sim = self._compute_tag_similarity(user_vn_tags, vn_tags)
            if sim > 0.3:
                titles = user_vn_titles.get(user_vn_id) or {}
                contributing_vns_detail.append({
                    "id": user_vn_id,
                    "title": titles.get("title") or user_vn_id,
                    "title_jp": titles.get("title_jp"),
                    "title_romaji": titles.get("title_romaji"),
                    "similarity": round(sim * 100, 0),
                })
        contributing_vns_detail.sort(key=lambda x: x["similarity"], reverse=True)
        contributing_vns_detail = contributing_vns_detail[:5]

        # Build match reasons
        reasons = []
        if tag_score > 0.2 and matched_tags_detail:
            # Ranked the same way as the list page's line, by how far above the reader's
            # own mean they rate the tag, so a title reads the same in both places. The
            # detail list keeps its own order for the breakdown.
            tag_means = user_profile.get("tag_means", {})
            reader_mean = user_overall_avg
            ranked = [
                (
                    t["id"],
                    (tag_means.get(t["id"], reader_mean) - reader_mean) * vn_tags.get(t["id"], 0),
                )
                for t in matched_tags_detail
            ]
            top_tags = sorted(
                [pair for pair in ranked if pair[1] > 0], key=lambda x: (-x[1], x[0])
            )[:3]
            if top_tags:
                names_by_id = {t["id"]: t["name"] for t in matched_tags_detail}
                reasons.append(", ".join(names_by_id[tid] for tid, _ in top_tags))
        if description_score > 0.5:
            reasons.append("Reads like your favorites")
        if similar_games_score > 0.3:
            reasons.append("Similar to your favorites")
        if users_also_read_score > 0.3:
            reasons.append("Fans also enjoyed")
        if developer_score > 0.2 or staff_score > 0.2:
            # The line names studios and staff alike, so either signal earns it.
            creator_names = [d["name"] for d in matched_developers_detail[:2]]
            creator_names += [s["name"] for s in matched_staff_detail[:2]]
            creator_names = [c for c in creator_names if c][:2]
            if creator_names:
                reasons.append("By " + ", ".join(creator_names))

        return RecommendationResult(
            vn_id=vn_id,
            title=vn_row.title,
            score=total_score,
            normalized_score=overall_normalized_score,
            match_reasons=reasons if reasons else ["Matches your preferences"],
            image_url=vn_row.image_url,
            image_sexual=vn_row.image_sexual,
            rating=vn_row.average_rating or vn_row.rating,  # Prefer average
            title_jp=vn_row.title_jp,
            title_romaji=vn_row.title_romaji,
            tag_score=tag_score,
            similar_games_score=similar_games_score,
            users_also_read_score=users_also_read_score,
            developer_score=developer_score,
            staff_score=staff_score,
            seiyuu_score=seiyuu_score,
            trait_score=trait_score,
            quality_score=quality_score,
            description_score=description_score,
            matched_tags=matched_tags_detail,
            matched_staff=matched_staff_detail,
            matched_developers=matched_developers_detail,
            matched_seiyuu=matched_seiyuu_detail,
            matched_traits=matched_traits_detail,
            contributing_vns=contributing_vns_detail,
            similar_games_details=similar_games_details,
            users_also_read_details=users_also_read_details,
            description_matches=attach_source_titles(
                self._description_neighbours([vn_id], high_rated_vns).get(vn_id, []),
                user_vn_titles,
            ),
        )

    async def _batch_get_vn_tags(self, vn_ids: list[str], spoiler_level: int = 0) -> dict[str, dict[int, float]]:
        """Batch load tags for multiple VNs."""
        if not vn_ids:
            return {}

        result = await self.db.execute(
            select(VNTag.vn_id, VNTag.tag_id, VNTag.score)
            .where(in_ids(VNTag.vn_id, vn_ids))
            .where(VNTag.spoiler_level <= spoiler_level)
            .where(VNTag.score > 0)
            .where(VNTag.lie == False)  # exclude disputed/incorrect tags
        )

        tags_by_vn: dict[str, dict[int, float]] = {}
        for row in result.all():
            if row.vn_id not in tags_by_vn:
                tags_by_vn[row.vn_id] = {}
            tags_by_vn[row.vn_id][row.tag_id] = row.score

        return tags_by_vn

    async def _batch_get_vn_developers(self, vn_ids: list[str]) -> dict[str, list[str]]:
        """Batch load developers for multiple VNs.

        Queries through: VN → ReleaseVN → ReleaseProducer → Producer
        Returns producer names (not IDs) for matching against user preferences.

        The id each name came from is recorded alongside, on rows the query was fetching
        anyway. Retrieval reaches a studio by id and the preferences it is given are keyed
        by name, and two producers can carry the same name, so the resolution has to come
        from the titles the name was read off rather than from a lookup over the whole
        producer table.
        """
        if not vn_ids:
            return {}

        # Query developers through the release chain
        result = await self.db.execute(
            select(ReleaseVN.vn_id, ReleaseProducer.producer_id, Producer.name)
            .select_from(ReleaseVN)
            .join(ReleaseProducer, ReleaseVN.release_id == ReleaseProducer.release_id)
            .join(Producer, ReleaseProducer.producer_id == Producer.id)
            .where(in_ids(ReleaseVN.vn_id, vn_ids))
            .where(ReleaseProducer.developer == True)
            .distinct()
        )

        developers_by_vn: dict[str, list[str]] = {vn_id: [] for vn_id in vn_ids}
        for row in result.all():
            if not row.name:
                continue
            # Distinct on the wider row, so one title can repeat a name under two ids.
            if row.name not in developers_by_vn[row.vn_id]:
                developers_by_vn[row.vn_id].append(row.name)
            self._producer_ids_by_name.setdefault(row.name, set()).add(row.producer_id)

        return developers_by_vn

    async def _batch_get_vn_staff(self, vn_ids: list[str]) -> dict[str, list[str]]:
        """Batch load staff for multiple VNs.

        One person can hold several credits on one title, so the rows are distinct on the
        pair rather than on the row. A repeated credit is one person either way: counted
        twice it adds to a candidate's contribution sum, and on the profile side it inflates
        the supporting count, which is both the confidence denominator and the Bayesian
        weight.
        """
        if not vn_ids:
            return {}

        try:
            result = await self.db.execute(
                select(VNStaff.vn_id, VNStaff.staff_id)
                .where(in_ids(VNStaff.vn_id, vn_ids))
                .distinct()
            )

            staff_by_vn: dict[str, list[str]] = {}
            for row in result.all():
                if row.vn_id not in staff_by_vn:
                    staff_by_vn[row.vn_id] = []
                staff_by_vn[row.vn_id].append(row.staff_id)

            return staff_by_vn
        except Exception as exc:
            # An empty map here scores a whole signal at zero while the response still
            # reports it at full weight, so the failure is logged as one.
            logger.error(f"Staff load failed, signal scored as absent: {exc}")
            return {}

    async def _batch_get_vn_seiyuu(self, vn_ids: list[str]) -> dict[str, list[str]]:
        """Batch load voice actors (seiyuu) for multiple VNs."""
        if not vn_ids:
            return {}

        try:
            result = await self.db.execute(
                select(VNSeiyuu.vn_id, VNSeiyuu.staff_id)
                .where(in_ids(VNSeiyuu.vn_id, vn_ids))
            )

            seiyuu_by_vn: dict[str, list[str]] = {}
            for row in result.all():
                if row.vn_id not in seiyuu_by_vn:
                    seiyuu_by_vn[row.vn_id] = []
                # Only add if not already present (can have multiple characters voiced by same VA)
                if row.staff_id not in seiyuu_by_vn[row.vn_id]:
                    seiyuu_by_vn[row.vn_id].append(row.staff_id)

            return seiyuu_by_vn
        except Exception as exc:
            # An empty map here scores a whole signal at zero while the response still
            # reports it at full weight, so the failure is logged as one.
            logger.error(f"Voice actor load failed, signal scored as absent: {exc}")
            return {}

    async def _batch_get_vn_traits(self, vn_ids: list[str], spoiler_level: int = 0) -> dict[str, dict[int, int]]:
        """Batch load character traits for multiple VNs.

        Returns {vn_id: {trait_id: count}} where count is how many characters
        in that VN have that trait. Filters by max spoiler level.

        Empty while the trait signal is off, which stands the query down on both the
        candidate and the profile side. A title then has no trait evidence, so the term
        neither scores nor counts toward the evidence a candidate is measured against.
        """
        if not vn_ids or not TRAIT_SIGNAL:
            return {}

        try:
            # Join CharacterVN -> CharacterTrait to get traits per VN.
            # A pool of candidates carries hundreds of thousands of character-trait pairs,
            # so the pairs are collected per title in the database and counted here: the
            # result is one row per title rather than one per pair, which is what the
            # transfer and the row-by-row construction on this side are paid for.
            result = await self.db.execute(
                select(
                    CharacterVN.vn_id,
                    func.array_agg(CharacterTrait.trait_id).label("trait_ids"),
                )
                .join(CharacterTrait, CharacterTrait.character_id == CharacterVN.character_id)
                .where(in_ids(CharacterVN.vn_id, vn_ids))
                .where(CharacterTrait.spoiler_level <= spoiler_level)
                .group_by(CharacterVN.vn_id)
            )

            # Count is how many characters in the title carry the trait, so repeats within
            # a title are what the tally is made of and must not be collapsed earlier.
            traits_by_vn: dict[str, dict[int, int]] = {
                row.vn_id: dict(Counter(row.trait_ids)) for row in result.all()
            }

            return traits_by_vn
        except Exception as e:
            logger.warning(f"Failed to load VN traits: {e}")
            return {}

    async def _batch_get_similarity_presence(self, vn_ids: list[str]) -> set[str]:
        """Which of these VNs have a row in the tag-similarity table at all.

        Both item-item tables hold a top-K neighbour list per source VN, so a VN absent
        from the source column has no neighbour list and the signal has nothing to say
        about it. A VN that has one but does not appear alongside this reader's
        favourites scores zero on evidence, which is a different thing.
        """
        if not vn_ids:
            return set()
        result = await self.db.execute(
            select(VNSimilarity.vn_id)
            .where(in_ids(VNSimilarity.vn_id, vn_ids))
            .distinct()
        )
        return {row.vn_id for row in result.all()}

    async def _batch_get_cooccurrence_presence(self, vn_ids: list[str]) -> set[str]:
        """Which of these VNs have a row in the co-readership table at all.

        The table is built from shared readership, so it cannot reach a title below the
        readership floor used to build it. That absence tracks how widely read a title
        is, which is exactly what must not be scored as a low opinion of it.
        """
        if not vn_ids:
            return set()
        result = await self.db.execute(
            select(VNCoOccurrence.vn_id)
            .where(in_ids(VNCoOccurrence.vn_id, vn_ids))
            .distinct()
        )
        return {row.vn_id for row in result.all()}

    async def _batch_get_tag_names(self, tag_ids: set[int]) -> dict[int, str]:
        """Batch load tag names for display."""
        if not tag_ids:
            return {}

        try:
            result = await self.db.execute(
                select(Tag.id, Tag.name)
                .where(Tag.id.in_(list(tag_ids)))
            )
            return {row.id: row.name for row in result.all()}
        except Exception as e:
            logger.warning(f"Failed to load tag names: {e}")
            return {}

    async def _batch_get_staff_names(self, staff_ids: set[str]) -> dict[str, dict[str, Optional[str]]]:
        """Batch load staff names for display.

        `name` holds the native form and `original` the romanised one, so both travel
        together for the reader's name preference to choose from.
        """
        if not staff_ids:
            return {}

        try:
            result = await self.db.execute(
                select(Staff.id, Staff.name, Staff.original)
                .where(Staff.id.in_(list(staff_ids)))
            )
            return {
                row.id: {"name": row.name, "original": row.original}
                for row in result.all()
            }
        except Exception as e:
            logger.warning(f"Failed to load staff names: {e}")
            return {}

    async def _batch_get_trait_names(self, trait_ids: set[int]) -> dict[int, str]:
        """Batch load trait names for display."""
        if not trait_ids:
            return {}

        try:
            result = await self.db.execute(
                select(Trait.id, Trait.name)
                .where(Trait.id.in_(list(trait_ids)))
            )
            return {row.id: row.name for row in result.all()}
        except Exception as e:
            logger.warning(f"Failed to load trait names: {e}")
            return {}

    async def _batch_get_vn_titles(self, vn_ids: list[str]) -> dict[str, dict[str, Optional[str]]]:
        """Batch load VN title variants for display.

        Carries every form a reader's title preference can select between, since the
        database title alone is Japanese for some works and Latin for others.
        """
        if not vn_ids:
            return {}

        try:
            result = await self.db.execute(
                select(
                    VisualNovel.id,
                    VisualNovel.title,
                    VisualNovel.title_jp,
                    VisualNovel.title_romaji,
                )
                .where(VisualNovel.id.in_(vn_ids))
            )
            return {
                row.id: {
                    "title": row.title,
                    "title_jp": row.title_jp,
                    "title_romaji": row.title_romaji,
                }
                for row in result.all()
            }
        except Exception as e:
            logger.warning(f"Failed to load VN titles: {e}")
            return {}

    async def _batch_get_producer_originals(self, names: set[str]) -> dict[str, str]:
        """Map producer names to their romanised form.

        Developer preferences are keyed by producer name rather than id, so the romanised
        form has to be reachable by that same key.
        """
        if not names:
            return {}

        try:
            result = await self.db.execute(
                select(Producer.name, Producer.original)
                .where(Producer.name.in_(list(names)))
            )
            return {row.name: row.original for row in result.all() if row.original}
        except Exception as e:
            logger.warning(f"Failed to load producer names: {e}")
            return {}

    async def _batch_get_collab_details(
        self,
        candidate_ids: list[str],
        high_rated_vns: list[str],
    ) -> dict[str, dict]:
        """
        Batch get collaborative filtering details for all candidates.

        Returns {vn_id: {"similar_users_count": N, "their_avg_rating": X}}
        """
        if not candidate_ids or not high_rated_vns:
            return {}

        try:
            # Get aggregated co-occurrence data
            result = await self.db.execute(
                select(
                    VNCoOccurrence.similar_vn_id,
                    func.sum(VNCoOccurrence.user_count).label("user_sum"),
                    func.avg(VNCoOccurrence.co_rating_score).label("avg_score"),
                )
                .where(VNCoOccurrence.vn_id.in_(high_rated_vns))
                .where(VNCoOccurrence.similar_vn_id.in_(candidate_ids))
                .group_by(VNCoOccurrence.similar_vn_id)
            )

            details = {}
            for row in result.all():
                details[row.similar_vn_id] = {
                    "similar_users_count": int(row.user_sum or 0),
                    "their_avg_rating": round((row.avg_score or 0) * 10, 1),  # Convert to 0-10 scale
                }
            return details
        except Exception as e:
            logger.warning(f"Failed to load collab details: {e}")
            return {}

    def _compute_tag_score_fast(
        self, user_profile: dict, vn_tags: dict[int, float]
    ) -> float:
        """
        Compute tag match score using IDF-weighted affinity sum.

        Score = sum(user_affinity[tag] * vn_tag_score[tag]) / max_possible_score

        Where:
        - user_affinity already includes IDF weighting (from _build_user_profile)
        - vn_tag_score is VNDB's 0-3 relevance score for the tag on this VN

        This approach:
        - Rewards strong matches on niche tags (high IDF like Nakige)
        - Uses absolute preference scores, not deltas from average
        - Considers how strongly the tag applies to the VN (0-3 score)
        """
        user_tags = user_profile["tag_weights"]  # IDF-weighted affinities (with elite boosting)
        elite_tag_ids = user_profile.get("elite_tag_ids", set())  # User's top 10 tags
        if not user_tags or not vn_tags:
            return 0.0

        # Compute weighted sum: user affinity * VN tag relevance score
        # Also track best match among elite tags for the best-match component
        weighted_sum = 0.0
        matched_count = 0
        best_elite_contribution = 0.0
        for tag_id, vn_score in vn_tags.items():
            # A centred weight below zero is a tag the reader's own marks argue against. It
            # is skipped rather than subtracted unless dislike is allowed to count, since on
            # the uncentred default every weight is positive and nothing here would change.
            if tag_id in user_tags and (user_tags[tag_id] > 0 or DISLIKE_NEGATIVE):
                # vn_score is 0-3 from VNDB (how strongly tag applies to VN)
                # user_tags[tag_id] is IDF-weighted user preference (with elite boosting)
                contribution = user_tags[tag_id] * vn_score
                weighted_sum += contribution
                matched_count += 1

                # Track best match among elite tags (user's top 10)
                if tag_id in elite_tag_ids:
                    best_elite_contribution = max(best_elite_contribution, contribution)

        if matched_count == 0:
            return 0.0
        if weighted_sum <= 0:
            # Everything the candidate matched on, the reader's marks argue against. Zero is
            # the floor: the signal declines to endorse rather than scoring below nothing.
            return 0.0

        # Normalize by computing max possible score
        # Use user's top N tag weights (sorted by IDF-weighted value)
        # to avoid over-normalization from obscure tags
        top_user_weights = sorted(
            [w for w in user_tags.values() if w > 0],
            reverse=True
        )[:15]  # Top 15 tags

        # Max possible = sum of top weights * max VN tag score (3.0)
        max_possible = sum(top_user_weights) * 3.0

        if max_possible <= 0:
            return 0.0

        # Normalize sum-based score to 0-1 range
        if TAG_COSINE:
            # Divided by the candidate's own tag mass rather than by a per-reader constant,
            # so the score measures how much of a title matches rather than how much of it
            # there is. Without it the sum grows with the number of tags a title carries and
            # an exhaustively tagged title outscores a closer but sparser match, which the
            # IDF weighting sharpens: a family of individually rare tags that travel together
            # contributes once per member. This is the same comparison vn_similarities makes.
            candidate_norm = math.sqrt(sum(s * s for s in vn_tags.values()))
            reader_norm = math.sqrt(sum(w * w for w in user_tags.values() if w > 0))
            denominator = candidate_norm * reader_norm
            sum_score = weighted_sum / denominator if denominator > 0 else 0.0
        else:
            sum_score = weighted_sum / max_possible

        if TAG_MEAN_NORM > 0:
            # Per matched tag rather than in total, against the best a single tag could
            # contribute, so the term reads as the average strength of what matched.
            per_tag_ceiling = top_user_weights[0] * 3.0
            if per_tag_ceiling > 0:
                mean_score = min(1.0, (weighted_sum / matched_count) / per_tag_ceiling)
                share = min(1.0, TAG_MEAN_NORM)
                sum_score = (1 - share) * sum_score + share * mean_score

        # Calculate best-match component
        # This ensures VNs matching user's top tags strongly get credit
        # even if they don't match many other tags
        max_elite_contrib = top_user_weights[0] * 3.0 if top_user_weights else 1.0
        best_match_score = min(1.0, best_elite_contribution / max_elite_contrib) if max_elite_contrib > 0 else 0.0

        # Blend the two components: the sum rewards breadth of overlap, the best-match term
        # rewards depth on the user's top tags. BEST_MATCH_WEIGHT sets the split.
        blended = (1 - BEST_MATCH_WEIGHT) * sum_score + BEST_MATCH_WEIGHT * best_match_score

        # Small bonus for matching many tags (up to 10% boost). It rewards the same breadth
        # the cosine is there to stop counting twice, so the two do not run together.
        match_bonus = 0.0 if TAG_COSINE else min(0.1, matched_count * 0.01)

        blended = self._blend_tag_best_match(user_profile, vn_tags, blended)

        return min(1.0, max(0.0, blended + match_bonus))

    @staticmethod
    def _blend_tag_best_match(
        user_profile: dict,
        vn_tags: dict[int, float],
        profile_score: float,
    ) -> float:
        """Fold in how close the candidate is to the single favourite it most resembles.

        The score handed in is measured against one vector averaged over the reader's whole
        list, which describes a reader with one taste well and a reader with two badly. This
        measures the same candidate against each favourite on its own and keeps the best,
        scaled by how highly that favourite was rated, so a title squarely inside one of a
        reader's tastes is not ranked below a title sitting between them.

        A profile carrying no favourite vectors leaves the handed-in score unchanged, so a
        caller holding a profile without them scores on the averaged term alone.
        """
        seeds = user_profile.get("seed_tag_profiles")
        if TAG_BEST_MATCH <= 0 or not seeds or not vn_tags:
            return profile_score

        tag_idf = user_profile.get("tag_idf") or {}
        excluded = user_profile.get("excluded_tag_ids") or set()
        # Scaled the same way the seed vectors were, and narrowed the same way, so the two
        # sides of the cosine are the same measurement.
        candidate = {
            tag_id: score * tag_idf.get(tag_id, 1.0)
            for tag_id, score in vn_tags.items()
            if tag_id not in IGNORE_TAGS and tag_id not in excluded
        }
        if not candidate:
            return profile_score
        candidate_norm = tag_vector_magnitude(candidate)
        if candidate_norm <= 0:
            return profile_score

        best = 0.0
        for vector, magnitude, rating_weight in seeds:
            cosine = tag_cosine(candidate, vector, candidate_norm, magnitude)
            if cosine <= 0:
                continue
            best = max(best, cosine * rating_weight)
            if best >= 1.0:
                break

        share = min(1.0, TAG_BEST_MATCH)
        return (1 - share) * profile_score + share * min(1.0, best)

    def _compute_entity_score_fast(
        self,
        user_profile: dict,
        vn_entities,
        weights_key: str,
        max_key: str,
        counts: Optional[dict] = None,
    ) -> float:
        """Affinity between a reader's preferences of one entity kind and a candidate's.

        The profile stores a preference as a delta from the reader's own average, so the
        average is added back before the result is scaled against their strongest
        preference of that kind. That puts a generous rater and a harsh one on one scale.
        Under the entity-preference switch the reader's centred mark and the title count
        enter once each instead.

        `counts` carries the number of characters behind each entity where the entity
        kind has one, and is None for the kinds a title either has or does not.
        """
        user_weights = user_profile.get(weights_key, {})
        max_weighted = user_profile.get(max_key, 10.0)
        user_avg = user_profile.get("user_overall_avg", 7.0)

        if not user_weights or not vn_entities:
            return 0.0

        means_key, counts_key = ENTITY_PROFILE_KEYS[weights_key]
        means = user_profile.get(means_key, {})
        seen = user_profile.get(counts_key, {})
        spread = user_profile.get("user_rating_spread", 1.0)

        contributions = []
        for entity_id in vn_entities:
            if entity_id not in user_weights:
                continue
            if ENTITY_PREFERENCE:
                # Rating and volume each enter once: the centred mark says whether the
                # reader liked the entity, the count says how far to trust that. An entity
                # the profile holds no mean for has no mark to read.
                mean = means.get(entity_id)
                if mean is None:
                    contribution = 0.0
                else:
                    contribution = entity_confidence(seen.get(entity_id, 1)) * entity_preference(
                        mean, user_avg, spread
                    )
            else:
                # Adding the average back turns the stored preference into an absolute
                # mark, so an entity the reader rates below their own mean still reads as
                # a mild yes. Left as a delta it reads as a no, which is the only way the
                # profile can decline a candidate rather than merely fail to endorse it.
                base = user_weights[entity_id] if DISLIKE_NEGATIVE else user_weights[entity_id] + user_avg
                contribution = base / max_weighted if max_weighted > 0 else 0.0
            if counts is not None:
                # Repeats inside one title count for more, with diminishing returns.
                contribution *= min(2.0, 1.0 + (counts[entity_id] - 1) * 0.3)
            contributions.append(contribution)

        return combine_entity_matches(contributions)

    def _apply_rank_agreement(
        self,
        scored: list[RecommendationResult],
        score_divisor: float,
        weights: Optional[dict[str, float]] = None,
    ) -> dict[str, float]:
        """Rank the pool under each signal on its own, fuse the positions, and record the
        agreement on every result.

        This runs whichever aggregation is configured, so a page ordered by the weighted
        sum still carries what the fusion made of it and the two are readable against each
        other from one run.

        Under the fusion aggregation the agreement also becomes the score the page is
        ordered, cut and cached by. It is put back on the weighted sum's scale first, so
        every stage after this reads one range, and the match percentage the page shows is
        then the agreement figure rather than a second number derived differently.

        A page ranked on one signal is the exception for the percentage. Agreement over a
        single ranking is a function of position alone, first place 100 and anything past
        the fusion depth 0, which says nothing about how strongly the signal matched. That
        page shows each title's own score as a share of the strongest on it instead, so the
        bottom of a page where every title matched well reads as a strong match and not as
        nothing. The order is unchanged either way.

        Returns the weighted totals the fusion replaced, for a caller that still needs to
        separate candidates the fusion left level. Empty when nothing was replaced.
        """
        if not scored:
            return {}

        rankings = []
        shares = []
        self.last_signal_rankings = {}
        # Each ranking counts for what the request weights its signal at, against the mean
        # weight, so the default vector leaves every ranking at one and a reader who lifts a
        # signal lifts the standing of what it placed highly.
        mean_weight = (
            sum(weights[name] for name in SIGNAL_SUM_ORDER) / len(SIGNAL_SUM_ORDER)
            if weights else 0.0
        )
        for signal in SIGNAL_SUM_ORDER:
            positions = signal_ranking(
                (
                    (result.vn_id, getattr(result, f"{signal}_score"))
                    for result in scored
                ),
                FUSION_DEPTH,
            )
            # A signal that ranked nothing is not a ranking a title could have placed in,
            # so it is left out of the count the percentage divides by as well.
            if positions:
                rankings.append(positions)
                shares.append(
                    (weights[signal] / mean_weight) if mean_weight > 0 else 1.0
                )
                self.last_signal_rankings[signal] = positions

        # The collaborative term ranks alongside the nine so the fusion sees it, and its
        # share is read off the same mean the others use. Absent while its weight is zero.
        if CF_SIGNAL_WEIGHT > 0:
            positions = signal_ranking(
                ((result.vn_id, result.collaborative_score) for result in scored),
                FUSION_DEPTH,
            )
            if positions:
                rankings.append(positions)
                shares.append((CF_SIGNAL_WEIGHT / mean_weight) if mean_weight > 0 else 1.0)
                self.last_signal_rankings["collaborative"] = positions

        fused = fuse_rankings(rankings, FUSION_K, shares)
        # The score and the percentage divide by one ceiling: the shares a title could
        # have collected, rather than the count of rankings, since the shares are unequal
        # whenever the request weights the signals unevenly.
        share_total = sum(shares)
        ceiling = share_total / (FUSION_K + 1.0) if rankings else 0.0
        replaced: dict[str, float] = {}

        single_signal = (
            weights is not None
            and sum(1 for name in SIGNAL_SUM_ORDER if weights.get(name, 0.0) > 0) == 1
        )
        strongest = max((result.score for result in scored), default=0.0)

        for result in scored:
            total, reached = fused.get(result.vn_id, (0.0, 0))
            result.confidence = fusion_confidence(
                total, len(rankings), FUSION_K, share_total=share_total
            )
            result.signals_ranked = reached
            if AGGREGATION == "fusion":
                replaced[result.vn_id] = result.score
                if single_signal:
                    result.normalized_score = (
                        int(round(min(1.0, result.score / strongest) * 100))
                        if strongest > 0
                        else 0
                    )
                else:
                    result.normalized_score = result.confidence
                agreement = min(1.0, total / ceiling) if ceiling > 0 else 0.0
                result.score = agreement * score_divisor

        return replaced

    def _predicted_ratings(
        self,
        user_profile: dict,
        *,
        vn_tags: Optional[dict[int, float]] = None,
        vn_developers: Optional[list[str]] = None,
        vn_staff: Optional[list[str]] = None,
        vn_seiyuu: Optional[list[str]] = None,
        vn_traits: Optional[dict[int, int]] = None,
        average_rating: Optional[float] = None,
        description_neighbours: Sequence[tuple[float, float]] = (),
        similarity_neighbours: Sequence[tuple[float, float]] = (),
    ) -> dict[str, float]:
        """What each signal expects this reader to mark this candidate, 1-10.

        One entry per signal that has a basis for a mark. A signal with nothing to say is
        absent rather than present at the reader's mean: the two are different claims, and
        a caller taking a mean and a spread over these has to be able to tell how many
        signals actually spoke.

        Five signals read the profile's own per-entity damped means, which are already
        marks this reader gave. Their weights pair how much of the candidate an entity accounts for
        with how much of the reader's list stands behind it; see predict_from_entities.

        Two signals are read off the reader's own marks for the titles a candidate sits
        closest to, over their whole rated list rather than the favourites the scoring
        reads. A closeness is never turned into a mark: it decides which of the reader's
        marks to average and nothing else. Read off favourites alone the average could not
        fall below the worst favourite, whatever the candidate resembled.

        Co-occurrence abstains. Against held-out ratings it does not beat the reader's own
        mean, and that holds with its sources widened the same way, so what it lacks is
        predictive power rather than reach.
        """
        if not PREDICTED_RATING:
            return {}

        reader_mean = user_profile.get("user_overall_avg", 7.0)
        predictions: dict[str, float] = {}

        tag_scores = user_profile.get("tag_means") or {}
        tag_counts = user_profile.get("tag_counts") or {}
        tag_idf = user_profile.get("tag_idf") or {}
        if vn_tags and tag_scores:
            matched = [
                (
                    tag_scores[tag_id],
                    # How much of the candidate the tag accounts for, taken as how strongly
                    # it applies against how few titles carry it: a title's ordinary tags
                    # are shared with most of the catalogue and say least about it.
                    vn_score * tag_idf.get(tag_id, 1.0) * tag_counts.get(tag_id, 0),
                    tag_counts.get(tag_id, 0),
                )
                for tag_id, vn_score in vn_tags.items()
                if tag_id in tag_scores
            ]
            value = predict_from_entities(matched, reader_mean)
            if value is not None:
                predictions["tag"] = value

        for signal, entities, scores_key, counts_key in (
            ("developer", vn_developers, "dev_means", "dev_counts"),
            ("staff", vn_staff, "staff_means", "staff_counts"),
            ("seiyuu", vn_seiyuu, "seiyuu_means", "seiyuu_counts"),
        ):
            scores = user_profile.get(scores_key) or {}
            counts = user_profile.get(counts_key) or {}
            if not entities or not scores:
                continue
            matched = [
                (scores[entity], counts.get(entity, 0), counts.get(entity, 0))
                for entity in dict.fromkeys(entities)
                if entity in scores
            ]
            value = predict_from_entities(matched, reader_mean)
            if value is not None:
                predictions[signal] = value

        trait_scores = user_profile.get("trait_means") or {}
        trait_counts = user_profile.get("trait_counts") or {}
        if vn_traits and trait_scores:
            matched = [
                (
                    trait_scores[trait_id],
                    # A trait carried by several of a cast is more of what the title is
                    # than one carried by a single character, with the repeats worth less
                    # each time.
                    min(3.0, float(cast_count)) * trait_counts.get(trait_id, 0),
                    trait_counts.get(trait_id, 0),
                )
                for trait_id, cast_count in vn_traits.items()
                if trait_id in trait_scores
            ]
            value = predict_from_entities(matched, reader_mean)
            if value is not None:
                predictions["trait"] = value

        for signal, neighbours in (
            ("description", description_neighbours),
            ("similar_games", similarity_neighbours),
        ):
            if not neighbours:
                continue
            value = predict_from_neighbours(neighbours, PREDICTION_NEIGHBOURS)
            if value is not None:
                predictions[signal] = value

        if PREDICTION_QUALITY and average_rating is not None:
            # The crowd's mark, moved by how far this reader sits from the crowd on the
            # titles they have both marked. Unshifted it predicts the crowd and would be
            # the same number for every reader; the shift is the whole of what makes it a
            # statement about this one.
            predictions["quality"] = clamp_rating(
                average_rating + user_profile.get("crowd_rating_shift", 0.0)
            )

        return predictions

    def _compute_developer_score_fast(
        self,
        user_profile: dict,
        vn_developers: list[str],
    ) -> float:
        """Compute developer/publisher match using WEIGHTED preferences.

        Uses the actual Bayesian-weighted scores from the user profile,
        not just binary overlap. A developer with avg rating 9 contributes
        more than one with avg rating 7.
        """
        return self._compute_entity_score_fast(
            user_profile,
            vn_developers,
            "preferred_developers",
            "max_dev_weighted",
        )

    def _compute_staff_score_fast(
        self,
        user_profile: dict,
        vn_staff: list[str],
    ) -> float:
        """Compute staff (writers, artists) match using WEIGHTED preferences.

        Uses the actual Bayesian-weighted scores from the user profile,
        not just binary overlap. A 9-rated writer contributes more than
        a 7-rated writer.
        """
        return self._compute_entity_score_fast(
            user_profile,
            vn_staff,
            "preferred_staff",
            "max_staff_weighted",
        )

    def _compute_seiyuu_score_fast(
        self,
        user_profile: dict,
        vn_seiyuu: list[str],
    ) -> float:
        """Compute voice actor (seiyuu) preference match using weighted preferences."""
        return self._compute_entity_score_fast(
            user_profile,
            vn_seiyuu,
            "preferred_seiyuu",
            "max_seiyuu_weighted",
        )

    def _compute_trait_score_fast(
        self,
        user_profile: dict,
        vn_traits: dict[int, int],  # {trait_id: count}
    ) -> float:
        """Compute character trait preference match using weighted preferences.

        vn_traits contains trait_id -> count of characters with that trait, so a title
        whose cast repeats a trait the reader favours scores above one that touches it
        once.
        """
        return self._compute_entity_score_fast(
            user_profile,
            vn_traits,
            "preferred_traits",
            "max_trait_weighted",
            counts=vn_traits,
        )

    async def _batch_get_votecounts(self, vn_ids: list[str]) -> dict[str, int]:
        """Vote counts for a set of titles, in one query."""
        if not vn_ids:
            return {}
        rows = (
            await self.db.execute(
                select(VisualNovel.id, VisualNovel.votecount).where(
                    in_ids(VisualNovel.id, vn_ids)
                )
            )
        ).all()
        return {row.id: row.votecount or 0 for row in rows}

    async def _popularity_calibration(
        self,
        vn_scores: dict[str, float],
        candidates: list[dict],
        popularity_calibration: Optional[float] = None,
    ) -> Optional[PopularityCalibration]:
        """The reader's popularity target and the candidates' bands, or None to skip it.

        Candidate vote counts ride along on the rows scoring already loaded, so the only
        read this adds is one batched lookup over the reader's own titles, taken only
        while the switch is on. Off, nothing here runs and no query is issued.

        None where the reader's own reading cannot be placed on the popularity range at
        all, which leaves the page as the scorer ranked it rather than matching it to an
        empty target.
        """
        strength = (
            POPULARITY_CALIBRATION if popularity_calibration is None
            else max(0.0, min(1.0, popularity_calibration))
        )
        if strength <= 0 or not vn_scores or not candidates:
            return None
        votecounts = await self._batch_get_votecounts(list(vn_scores))
        target = popularity_target(vn_scores, votecounts)
        if not target:
            return None
        return PopularityCalibration(
            target=target,
            bands={vn["id"]: popularity_band(vn.get("votecount")) for vn in candidates},
            strength=strength,
        )

    async def _apply_diversity_reranking(
        self,
        recommendations: list[RecommendationResult],
        all_tags: dict[str, dict[int, float]],
        limit: int,
        diversity_weight: float = 0.3,
        calibration: Optional[PopularityCalibration] = None,
    ) -> list[RecommendationResult]:
        """
        Apply Maximal Marginal Relevance (MMR) diversity reranking.

        Balances relevance (original score) with diversity (dissimilarity to
        already-selected items). This prevents results from clustering around
        similar VNs.

        Args:
            recommendations: Scored recommendations sorted by score
            all_tags: Pre-loaded tags for candidates {vn_id: {tag_id: score}}
            limit: Number of results to return
            diversity_weight: Weight for diversity (0 = pure relevance, 1 = pure diversity)
            calibration: Reader's popularity spread to match, or None to leave the
                popularity of the page to the scoring

        Returns:
            Reranked list balancing relevance and diversity

        Popularity calibration is folded into this pass rather than run before or after
        it. Both are selections of one page out of one pool, so running them in sequence
        gives the second an already-cut page to choose from and nothing to choose with;
        whichever ran last would decide the page alone. In one pass the two criteria are
        traded explicitly: relevance and diversity blend as they always have, and that
        blend is what the divergence is weighed against.

        The blend has to be on 0-1 for the trade to mean what it says, so a calibrated
        pass rescales relevance whether or not the relevance switch is on. That leaves
        the diversity weight reading as the share it names as well, which it does not on
        the uncalibrated default path.
        """
        if len(recommendations) <= limit and calibration is None:
            return recommendations

        # Relevance and diversity are blended below, so they have to be the same kind of
        # quantity. Diversity is a cosine distance bounded at 1.0 while relevance is a
        # raw weighted total, which leaves the blend weight describing a far smaller
        # share of the decision than it names. The rescale puts the pool's own relevance
        # range onto 0-1, and is computed once here because the pool does not change
        # while the loop selects from it. A pool whose scores are all equal carries no
        # relevance to rescale, and selection there falls to diversity alone.
        relevance_by_id: Optional[dict[str, float]] = None
        if MMR_NORMALIZE_RELEVANCE or calibration is not None:
            lowest = min(r.score for r in recommendations)
            span = max(r.score for r in recommendations) - lowest
            relevance_by_id = {
                r.vn_id: ((r.score - lowest) / span if span > 0 else 0.0)
                for r in recommendations
            }

        if calibration is None:
            # Start with the highest-scored item. Taken by score rather than by position,
            # so the pass does not rest on the caller having sorted the pool first.
            opening = max(
                range(len(recommendations)), key=lambda i: recommendations[i].score
            )
            selected: list[RecommendationResult] = [recommendations[opening]]
            remaining = recommendations[:opening] + recommendations[opening + 1:]
        else:
            # The first slot is the one the reader sees, so it takes part in the
            # calibration rather than being handed to the top score before the target is
            # consulted. Against an empty list every band but the candidate's own is
            # unreached, so the first pick goes to the band the reader reads most, and to
            # the best-scored candidate in it.
            selected = []
            remaining = list(recommendations)

        # Rank-discounted band weights of what is already selected. The discount matches
        # the one the accuracy metrics apply, so the head of the page, which is the part
        # a reader sees, carries the most of the target it is matched against.
        listed_bands: dict[int, float] = {}
        listed_weight = 0.0

        # Magnitudes and pairwise cosines are memoised across the whole selection. The
        # frontier is the tail of the selected list, so it slides by one item a slot and
        # re-poses almost every comparison it posed the slot before, and a magnitude is a
        # property of one title rather than of a pair.
        similarity = _TagSimilarityCache(all_tags)

        while len(selected) < limit and remaining:
            # Ranked on the calibrated objective, with the relevance and diversity blend
            # settling a tie. The objective alone leaves every candidate sharing a band
            # tied at full calibration strength, where the whole of the first term drops
            # out and only the order the pool happened to arrive in separates them.
            best_key = (-float('inf'), -float('inf'))
            best_idx = 0
            divergences: dict[int, float] = {}
            position_weight = 0.0
            if calibration is not None:
                position_weight = 1.0 / math.log2(len(selected) + 2)
                divergences = calibration.divergence_by_band(
                    listed_bands,
                    listed_weight,
                    position_weight,
                    {calibration.bands.get(r.vn_id, 0) for r in remaining},
                )

            for idx, candidate in enumerate(remaining):
                # Relevance: original score (normalized)
                relevance = (
                    candidate.score if relevance_by_id is None
                    else relevance_by_id[candidate.vn_id]
                )

                # Diversity: minimum dissimilarity to recently selected items
                # Only compare to last 10 selected (they represent the "diversity frontier")
                # This is O(remaining × 10) instead of O(remaining × selected)
                candidate_tags = all_tags.get(candidate.vn_id, {})
                if not candidate_tags:
                    # Nothing to measure a distance against.
                    diversity = DIVERSITY_UNTAGGED
                else:
                    max_similarity = 0.0
                    recent_selected = selected[-10:] if len(selected) > 10 else selected
                    for selected_item in recent_selected:
                        max_similarity = max(
                            max_similarity,
                            similarity.between(candidate.vn_id, selected_item.vn_id),
                        )
                    diversity = 1.0 - max_similarity

                # MMR score: balance relevance and diversity
                blend = (1 - diversity_weight) * relevance + diversity_weight * diversity

                if calibration is None:
                    objective = blend
                else:
                    # Both terms are on 0-1, so the strength is the share of the decision
                    # it reads as. At full strength the blend leaves the objective
                    # entirely, which is what the tie-break below exists to catch: without
                    # it every candidate in the chosen band scores alike and the pick falls
                    # to whichever the pool listed first.
                    objective = (
                        (1.0 - calibration.strength) * blend
                        - calibration.strength
                        * divergences[calibration.bands.get(candidate.vn_id, 0)]
                    )

                if (objective, blend) > best_key:
                    best_key = (objective, blend)
                    best_idx = idx

            # Add best candidate to selected
            chosen = remaining[best_idx]
            selected.append(chosen)
            remaining.pop(best_idx)
            if calibration is not None:
                band = calibration.bands.get(chosen.vn_id, 0)
                listed_bands[band] = listed_bands.get(band, 0.0) + position_weight
                listed_weight += position_weight

        return selected

    def _compute_tag_similarity(
        self,
        tags_a: dict[int, float],
        tags_b: dict[int, float],
    ) -> float:
        """Compute cosine similarity between two tag vectors."""
        return tag_cosine(tags_a, tags_b)

    async def _crowd_rating_shift(self, vn_scores: dict[str, float]) -> float:
        """How far this reader sits from the catalogue average on the titles they have marked.

        A generous reader marks above the crowd everywhere and a harsh one below it, by
        roughly a constant, so the crowd's average for an unread title becomes a statement
        about this reader once that constant is added back. Zero where none of their titles
        carries a catalogue average, which leaves the crowd's mark standing unshifted.
        """
        if not vn_scores:
            return 0.0
        rows = await self.db.execute(
            select(VisualNovel.id, VisualNovel.average_rating).where(
                in_ids(VisualNovel.id, list(vn_scores))
            )
        )
        deltas = [
            vn_scores[row.id] - row.average_rating
            for row in rows.all()
            if row.average_rating is not None and row.id in vn_scores
        ]
        if not deltas:
            return 0.0
        return sum(deltas) / len(deltas)

    async def _build_user_profile(self, user_votes: list[dict], spoiler_level: int = 0) -> dict:
        """The reader's profile, read from the cache where a build for these inputs exists.

        A build is the largest cost of a cold run and every list, popup and filtered
        request for one reader needs the same one, so it is stored under a key made of the
        inputs that decide it; see profile_cache. A store that cannot be reached is a
        rebuild, never an error.
        """
        key = profile_key(user_votes, spoiler_level, switch_settings())
        cached = await read_profile(key)
        if cached is not None:
            return cached
        profile = await self._compute_user_profile(user_votes, spoiler_level=spoiler_level)
        if profile.get("vn_scores"):
            await write_profile(key, profile)
        return profile

    async def _compute_user_profile(self, user_votes: list[dict], spoiler_level: int = 0) -> dict:
        """
        Build user's tag preference profile from their ratings using Bayesian weighting.

        Uses the same scoring approach as the stats page:
        1. Calculate Bayesian damped mean for each tag/staff
        2. Apply confidence penalty for low-count items

        Returns dict with:
        - tag_weights: {tag_id: weight} - Bayesian-weighted scores
        - high_rated_vns: list of vn_ids with high ratings
        - preferred_staff: {staff_id: weight}
        - preferred_developers: {developer_name: weight}
        """
        # Extract VN IDs and scores (0-10 scale)
        vn_scores = {}  # vn_id -> score (0-10)
        high_rated_vns = []

        for vote in user_votes:
            vn_id = vote.get("vn_id") or vote.get("id")
            raw_score = vote.get("score", vote.get("vote", 50))

            if not vn_id:
                continue

            # Convert to 0-10 scale (VNDB stores as 10-100)
            score = raw_score / 10.0
            vn_scores[vn_id] = score

        # Favourites are read off the reader's own scale rather than a fixed mark. Scales
        # differ enough that a fixed one decides how much of the engine a reader gets: the
        # two item-item signals and two of the four candidate sources are all built from
        # this list, so a reader whose ratings never reach the mark loses them entirely.
        # Coarse scales make that common, since a reader using five values places most of
        # a list on one of them.
        #
        # Above the reader's own mean, best first, is the set that survives both habits. A
        # reader who already had a full list of favourites keeps the same one, because the
        # top of their list sits above their mean either way.
        # The reader's own best, best first. A fixed mark decides how much of the engine a
        # reader gets rather than what they like: the two item-item signals and two of the
        # four candidate sources are all built from this list, so a reader whose ratings
        # never reach the mark loses them entirely. Coarse scales make that ordinary, since
        # a reader using five values places most of a list on one of them.
        #
        # Rank alone settles it, so the list is the same length for everyone who has read
        # enough, and identical to the fixed mark's for any reader whose top of list already
        # cleared it. How much each entry then counts is already a matter of its score:
        # every consumer weights by the reader's own rating, so a thinly liked title at the
        # bottom of a short list carries correspondingly little.
        high_rated_vns = [
            vn_id
            for vn_id, _ in sorted(
                vn_scores.items(), key=lambda kv: kv[1], reverse=True
            )[:HIGH_RATED_TARGET]
        ]

        if not vn_scores:
            return {
                "tag_weights": {},
                "tag_dislikes": {},
                "high_rated_vns": [],
                "preferred_staff": {},
                "preferred_developers": {},
                "preferred_developer_ids": {},
                "dev_id_counts": {},
                "preferred_seiyuu": {},
                "preferred_traits": {},
                "seed_tag_profiles": [],
                "user_overall_avg": 7.0,  # Default
                "user_rating_spread": 1.0,
                "crowd_rating_shift": 0.0,
            }

        # Calculate user's overall average rating (for Bayesian prior)
        user_overall_avg = sum(vn_scores.values()) / len(vn_scores)

        # The reader's own spread of marks, for reading an entity's mean on their scale.
        # Floored at one point: a reader who has used a single value has no spread, and
        # every difference would otherwise read as certain.
        variance = sum((score - user_overall_avg) ** 2 for score in vn_scores.values()) / len(vn_scores)
        user_rating_spread = max(1.0, math.sqrt(variance))

        # Batch load all data
        vn_ids = list(vn_scores.keys())
        weights_by_vote = vote_weights(user_votes)
        all_tags = await self._batch_get_vn_tags(vn_ids, spoiler_level=spoiler_level)
        all_developers = await self._batch_get_vn_developers(vn_ids)
        all_staff = await self._batch_get_vn_staff(vn_ids)
        all_seiyuu = await self._batch_get_vn_seiyuu(vn_ids)
        all_traits = await self._batch_get_vn_traits(vn_ids, spoiler_level=spoiler_level)

        # Load IDF weights for tag scoring
        tag_idf = await self._load_tag_idf_weights()

        # Only the predicted rating reads this, and it is a query of its own.
        crowd_rating_shift = 0.0
        if PREDICTED_RATING and PREDICTION_QUALITY:
            crowd_rating_shift = await self._crowd_rating_shift(vn_scores)

        excluded_tag_ids: set[int] = set()
        if TAG_EXCLUDE_TECHNICAL:
            excluded_tag_ids = await self._load_technical_tag_ids()

        # The reader's favourites as tag vectors of their own, rarity-weighted the same way
        # the profile below is, kept alongside it. A profile is a mean over everything the
        # reader liked, and a mean over two distinct tastes describes neither of them: it
        # sits between them and matches a title halfway between two things they enjoy above
        # a title squarely inside one. Holding the individual titles as well lets the tag
        # term ask how close a candidate is to the single title it most resembles, which is
        # the comparison the same reader gets from a title's own page.
        #
        # No query of its own: these are rows already loaded to build the profile, kept
        # rather than folded away, and only for the favourites the term reads.
        seed_tag_profiles: list[tuple[dict[int, float], float, float]] = []
        if TAG_BEST_MATCH > 0:
            for seed_id in high_rated_vns[:max(1, TAG_BEST_MATCH_SEEDS)]:
                vector = {
                    tag_id: score * tag_idf.get(tag_id, 1.0)
                    for tag_id, score in all_tags.get(seed_id, {}).items()
                    if tag_id not in IGNORE_TAGS and tag_id not in excluded_tag_ids
                }
                if not vector:
                    continue
                seed_tag_profiles.append(
                    (
                        vector,
                        tag_vector_magnitude(vector),
                        # How much the reader liked it, on the same 0-1 scale the two
                        # item-item signals weight their own sources by.
                        min(1.0, vn_scores.get(seed_id, user_overall_avg) / 10.0),
                    )
                )

        # Group VNs by tag: {tag_id: [vn_ids]}
        tag_to_vns: dict[int, list[str]] = {}
        for vn_id in vn_ids:
            vn_tags = all_tags.get(vn_id, {})
            for tag_id in vn_tags.keys():
                if tag_id in IGNORE_TAGS or tag_id in excluded_tag_ids:
                    continue
                if tag_id not in tag_to_vns:
                    tag_to_vns[tag_id] = []
                tag_to_vns[tag_id].append(vn_id)

        # How much of this reader's own list a tag must cover to be fully trusted. A count
        # that does not move with the list is reached by a few titles however long the list
        # is, so on a long one an incidental tag is trusted as much as a defining one, and
        # rarity weighting then ranks the incidental one higher.
        tag_confidence_count = 5
        if TAG_SUPPORT_SHARE > 0:
            tag_confidence_count = max(5, round(TAG_SUPPORT_SHARE * len(vn_ids)))

        # Calculate Bayesian-weighted tag scores with IDF weighting
        tag_weights = {}  # For scoring: IDF-weighted absolute preference
        tag_dislikes = {}  # tag_id -> 0..1 shortfall against the reader's own average
        tag_absolute_scores = {}  # Raw absolute scores for display
        tag_weighted_scores = {}  # For display: actual weighted score (0-10 scale)
        # The damped mean before the confidence factor is applied. Two different
        # quantities: the factor scales a mean down toward nothing to rank a thinly
        # supported entity below a well supported one, which makes the result a ranking
        # score and not a mark anybody gave. The prediction needs the mark, and the
        # damping inside this mean already pulls a thin one toward the reader's own.
        tag_means = {}  # tag_id -> damped mean rating (0-10 scale)
        tag_counts = {}  # For reference
        for tag_id, vn_list in tag_to_vns.items():
            count, tag_avg = weighted_support(vn_scores, vn_list, weights_by_vote)

            # Apply Bayesian damping (pulls low-count toward user's average)
            bayesian = self._calculate_bayesian_score(
                user_avg=tag_avg,
                count=count,
                user_overall_avg=user_overall_avg,
                prior_weight=3,
            )

            # Apply confidence penalty (low-count = less reliable)
            # The stats page figure, so the two agree.
            weighted = self._calculate_weighted_score(
                bayesian_score=bayesian,
                count=count,
                min_confidence_count=tag_confidence_count,
            )

            # Store actual weighted score for display (0-10 scale)
            tag_weighted_scores[tag_id] = weighted
            tag_means[tag_id] = bayesian
            tag_absolute_scores[tag_id] = weighted  # Absolute score for display
            tag_counts[tag_id] = count

            # NEW: Use IDF-weighted absolute score for recommendations
            # This makes niche tags (high IDF) more influential than common tags
            # Nakige (IDF~2.2) will contribute ~4x more than Romance (IDF~0.5)
            idf = tag_idf.get(tag_id, 1.0)
            # Centred, a tag reads as a preference rather than as the reader's average mark
            # for the titles carrying it. Uncentred is the older shape, kept as the default.
            affinity = weighted - TAG_CENTERING * user_overall_avg
            if TAG_CENTERING > 0:
                affinity = sharpen(affinity)
            tag_weights[tag_id] = affinity * idf

            # A tag the reader marks below their own average, on enough of their list to be
            # a judgement rather than one disappointing title. Severity is the shortfall as
            # a share of their average, so it means the same for a harsh and a kind rater.
            if weighted < user_overall_avg and count >= DISLIKE_MIN_SUPPORT:
                tag_dislikes[tag_id] = min(
                    1.0, (user_overall_avg - weighted) / max(user_overall_avg, 1.0)
                )

        # Apply elite tier boosting to user's top tags
        # This ensures their strongest preferences dominate recommendations
        elite_tag_ids = set()
        sorted_by_weight = sorted(tag_weights.items(), key=lambda x: x[1], reverse=True)
        for rank, (tag_id, _) in enumerate(sorted_by_weight):
            if rank < 5:
                # Top 5 tags get maximum boost
                tag_weights[tag_id] *= ELITE_TIER_1_MULTIPLIER
                elite_tag_ids.add(tag_id)
            elif rank < 10:
                # Tags 6-10 get strong boost
                tag_weights[tag_id] *= ELITE_TIER_2_MULTIPLIER
                elite_tag_ids.add(tag_id)
            elif rank < 20:
                # Tags 11-20 get moderate boost
                tag_weights[tag_id] *= ELITE_TIER_3_MULTIPLIER

        logger.debug(f"Applied elite tier boosting to {len(elite_tag_ids)} top tags")

        # Group VNs by staff: {staff_id: [vn_ids]}
        staff_to_vns: dict[str, list[str]] = {}
        for vn_id in vn_ids:
            vn_staff = all_staff.get(vn_id, [])
            for staff_id in vn_staff:
                if staff_id not in staff_to_vns:
                    staff_to_vns[staff_id] = []
                staff_to_vns[staff_id].append(vn_id)

        # Calculate Bayesian-weighted staff scores
        preferred_staff = {}  # For scoring: delta from user's average
        staff_weighted_scores = {}  # For display: actual weighted score (0-10 scale)
        staff_means = {}  # staff_id -> damped mean rating (0-10 scale)
        staff_counts = {}  # For reference
        for staff_id, vn_list in staff_to_vns.items():
            count, staff_avg = weighted_support(vn_scores, vn_list, weights_by_vote)

            bayesian = self._calculate_bayesian_score(
                user_avg=staff_avg,
                count=count,
                user_overall_avg=user_overall_avg,
                prior_weight=3,
            )
            # The stats page figure, so the two agree.
            weighted = self._calculate_weighted_score(
                bayesian_score=bayesian,
                count=count,
                min_confidence_count=ENTITY_CONFIDENCE_COUNT,
            )
            # Store actual weighted score for display
            staff_weighted_scores[staff_id] = weighted
            staff_means[staff_id] = bayesian
            staff_counts[staff_id] = count
            if ENTITY_PREFERENCE:
                # Centred on the even point, so a positive value still means liked and
                # the retrieval gate below reads the same sign it always did.
                preferred_staff[staff_id] = (
                    entity_preference(bayesian, user_overall_avg, user_rating_spread) - 0.5
                )
            else:
                preferred_staff[staff_id] = sharpen(weighted - user_overall_avg)

        # Group VNs by developer: {developer: [vn_ids]}
        dev_to_vns: dict[str, list[str]] = {}
        for vn_id in vn_ids:
            vn_developers = all_developers.get(vn_id, [])
            for developer in vn_developers:
                if developer not in dev_to_vns:
                    dev_to_vns[developer] = []
                dev_to_vns[developer].append(vn_id)

        # Calculate Bayesian-weighted developer scores
        preferred_developers = {}  # For scoring: delta from user's average
        dev_weighted_scores = {}  # For display: actual weighted score (0-10 scale)
        dev_means = {}  # developer -> damped mean rating (0-10 scale)
        dev_counts = {}  # For reference
        for developer, vn_list in dev_to_vns.items():
            count, dev_avg = weighted_support(vn_scores, vn_list, weights_by_vote)

            bayesian = self._calculate_bayesian_score(
                user_avg=dev_avg,
                count=count,
                user_overall_avg=user_overall_avg,
                prior_weight=3,
            )
            # The stats page figure, so the two agree.
            weighted = self._calculate_weighted_score(
                bayesian_score=bayesian,
                count=count,
                min_confidence_count=ENTITY_CONFIDENCE_COUNT,
            )
            # Store actual weighted score for display
            dev_weighted_scores[developer] = weighted
            dev_means[developer] = bayesian
            dev_counts[developer] = count
            if ENTITY_PREFERENCE:
                preferred_developers[developer] = (
                    entity_preference(bayesian, user_overall_avg, user_rating_spread) - 0.5
                )
            else:
                preferred_developers[developer] = sharpen(weighted - user_overall_avg)

        # The same affinities against the key the release chain holds, for the retrieval
        # arm. Only the ids seen on this reader's own titles are taken, so a studio sharing
        # a name with one they like is not credited with their taste; a name that did reach
        # two ids on their list is one weight against both, which is what a name-keyed
        # preference can say.
        preferred_developer_ids: dict[str, float] = {}
        # The support behind each id, so the retrieval arm can temper its ranking the
        # same way it does for the other entity kinds. Two names sharing an id keep the
        # larger count, matching the weight rule above.
        dev_id_counts: dict[str, float] = {}
        for developer, weight in preferred_developers.items():
            for producer_id in self._producer_ids_by_name.get(developer, ()):
                preferred_developer_ids[producer_id] = max(
                    preferred_developer_ids.get(producer_id, weight), weight
                )
                dev_id_counts[producer_id] = max(
                    dev_id_counts.get(producer_id, 0), dev_counts.get(developer, 0)
                )

        # Group VNs by seiyuu: {staff_id: [vn_ids]}
        seiyuu_to_vns: dict[str, list[str]] = {}
        for vn_id in vn_ids:
            vn_seiyuu = all_seiyuu.get(vn_id, [])
            for staff_id in vn_seiyuu:
                if staff_id not in seiyuu_to_vns:
                    seiyuu_to_vns[staff_id] = []
                seiyuu_to_vns[staff_id].append(vn_id)

        # Calculate Bayesian-weighted seiyuu scores
        preferred_seiyuu = {}  # For scoring: delta from user's average
        seiyuu_weighted_scores = {}  # For display: actual weighted score (0-10 scale)
        seiyuu_means = {}  # staff_id -> damped mean rating (0-10 scale)
        seiyuu_counts = {}  # For reference
        for staff_id, vn_list in seiyuu_to_vns.items():
            count, seiyuu_avg = weighted_support(vn_scores, vn_list, weights_by_vote)

            bayesian = self._calculate_bayesian_score(
                user_avg=seiyuu_avg,
                count=count,
                user_overall_avg=user_overall_avg,
                prior_weight=3,
            )
            weighted = self._calculate_weighted_score(
                bayesian_score=bayesian,
                count=count,
                min_confidence_count=ENTITY_CONFIDENCE_COUNT,
            )
            # Store actual weighted score for display
            seiyuu_weighted_scores[staff_id] = weighted
            seiyuu_means[staff_id] = bayesian
            seiyuu_counts[staff_id] = count
            if ENTITY_PREFERENCE:
                preferred_seiyuu[staff_id] = (
                    entity_preference(bayesian, user_overall_avg, user_rating_spread) - 0.5
                )
            else:
                preferred_seiyuu[staff_id] = sharpen(weighted - user_overall_avg)

        # Group VNs by trait: {trait_id: [vn_ids]}
        # Traits are counted per character, so a VN with 3 tsundere characters
        # contributes more to the tsundere trait preference
        trait_to_vns: dict[int, list[str]] = {}
        for vn_id in vn_ids:
            vn_traits = all_traits.get(vn_id, {})
            for trait_id in vn_traits.keys():
                if trait_id not in trait_to_vns:
                    trait_to_vns[trait_id] = []
                trait_to_vns[trait_id].append(vn_id)

        # Calculate Bayesian-weighted trait scores
        preferred_traits = {}  # For scoring: delta from user's average
        trait_weighted_scores = {}  # For display: actual weighted score (0-10 scale)
        trait_means = {}  # trait_id -> damped mean rating (0-10 scale)
        trait_counts = {}  # For reference
        for trait_id, vn_list in trait_to_vns.items():
            count, trait_avg = weighted_support(vn_scores, vn_list, weights_by_vote)

            bayesian = self._calculate_bayesian_score(
                user_avg=trait_avg,
                count=count,
                user_overall_avg=user_overall_avg,
                prior_weight=3,
            )
            weighted = self._calculate_weighted_score(
                bayesian_score=bayesian,
                count=count,
                min_confidence_count=ENTITY_CONFIDENCE_COUNT,
            )
            # Store actual weighted score for display
            trait_weighted_scores[trait_id] = weighted
            trait_means[trait_id] = bayesian
            trait_counts[trait_id] = count
            if ENTITY_PREFERENCE:
                preferred_traits[trait_id] = (
                    entity_preference(bayesian, user_overall_avg, user_rating_spread) - 0.5
                )
            else:
                preferred_traits[trait_id] = sharpen(weighted - user_overall_avg)

        # Calculate max weighted scores for normalization (to match stats page display)
        max_tag_weighted = max(tag_weighted_scores.values()) if tag_weighted_scores else 1.0
        max_staff_weighted = max(staff_weighted_scores.values()) if staff_weighted_scores else 1.0
        max_dev_weighted = max(dev_weighted_scores.values()) if dev_weighted_scores else 1.0
        max_seiyuu_weighted = max(seiyuu_weighted_scores.values()) if seiyuu_weighted_scores else 1.0
        max_trait_weighted = max(trait_weighted_scores.values()) if trait_weighted_scores else 1.0

        logger.info(
            f"Built user profile: {len(tag_weights)} tags, {len(preferred_staff)} staff, "
            f"{len(preferred_developers)} developers, {len(preferred_seiyuu)} seiyuu, "
            f"{len(preferred_traits)} traits (user avg: {user_overall_avg:.2f})"
        )

        return {
            "tag_weights": tag_weights,  # IDF-weighted absolute scores for scoring (with elite boosting)
            "tag_dislikes": tag_dislikes,
            "tag_absolute_scores": tag_absolute_scores,  # Raw absolute scores for display
            "tag_weighted_scores": tag_weighted_scores,  # For display (0-10 scale)
            "tag_counts": tag_counts,
            "tag_idf": tag_idf,  # IDF values for transparency in display
            "excluded_tag_ids": excluded_tag_ids,  # Tags carrying no content, for symmetry
            "seed_tag_profiles": seed_tag_profiles,  # Favourites as vectors, for best match
            "max_tag_weighted": max_tag_weighted,  # For normalization
            "elite_tag_ids": elite_tag_ids,  # User's top 10 tags (for best-match scoring)
            "high_rated_vns": high_rated_vns,
            "vn_scores": vn_scores,  # VN ID -> score (0-10) for weighting
            "preferred_staff": preferred_staff,
            "staff_weighted_scores": staff_weighted_scores,  # For display (0-10 scale)
            "staff_counts": staff_counts,
            "max_staff_weighted": max_staff_weighted,  # For normalization
            "preferred_developers": preferred_developers,
            "preferred_developer_ids": preferred_developer_ids,  # Same weights, keyed for retrieval
            "dev_id_counts": dev_id_counts,
            "dev_weighted_scores": dev_weighted_scores,  # For display (0-10 scale)
            "dev_counts": dev_counts,
            "max_dev_weighted": max_dev_weighted,  # For normalization
            "preferred_seiyuu": preferred_seiyuu,
            "seiyuu_weighted_scores": seiyuu_weighted_scores,  # For display (0-10 scale)
            "seiyuu_counts": seiyuu_counts,
            "max_seiyuu_weighted": max_seiyuu_weighted,  # For normalization
            "preferred_traits": preferred_traits,
            "trait_weighted_scores": trait_weighted_scores,  # For display (0-10 scale)
            "trait_counts": trait_counts,
            "max_trait_weighted": max_trait_weighted,  # For normalization
            "user_overall_avg": user_overall_avg,
            "user_rating_spread": user_rating_spread,
            "crowd_rating_shift": crowd_rating_shift,
            # Damped means, on the scale a rating is given on, for the predicted rating.
            "tag_means": tag_means,
            "staff_means": staff_means,
            "dev_means": dev_means,
            "seiyuu_means": seiyuu_means,
            "trait_means": trait_means,
        }

    async def _get_vn_tags(self, vn_id: str, spoiler_level: int = 0) -> dict[int, float]:
        """Get tags for a VN as {tag_id: score}."""
        result = await self.db.execute(
            select(VNTag.tag_id, VNTag.score)
            .where(VNTag.vn_id == vn_id)
            .where(VNTag.spoiler_level <= spoiler_level)
            .where(VNTag.score > 0)
            .where(VNTag.lie == False)  # exclude disputed/incorrect tags
        )
        return {row.tag_id: row.score for row in result.all()}

    async def _get_vn_staff(self, vn_id: str) -> list[str]:
        """Get staff IDs for a VN (writers, artists, etc)."""
        try:
            result = await self.db.execute(
                select(VNStaff.staff_id)
                .where(VNStaff.vn_id == vn_id)
            )
            return [row.staff_id for row in result.all()]
        except Exception:
            return []

    async def _get_vn_developers(self, vn_id: str) -> list[str]:
        """Get developer names for a VN."""
        try:
            result = await self.db.execute(
                select(Producer.name)
                .select_from(ReleaseVN)
                .join(ReleaseProducer, ReleaseVN.release_id == ReleaseProducer.release_id)
                .join(Producer, ReleaseProducer.producer_id == Producer.id)
                .where(ReleaseVN.vn_id == vn_id)
                .where(ReleaseProducer.developer == True)
                .distinct()
            )
            return [row.name for row in result.all() if row.name]
        except Exception:
            return []

    def _restrict_to_filters(self, query, predicates, join_on=None):
        """Narrow a candidate query to the titles the reader's filters admit.

        Every candidate source truncates with a LIMIT, so a filter applied to the rows a
        source returns can only subtract from an already-chosen slice: the rows it removes
        are not replaced by the next-best matching ones, and a filter matching a small
        corner of the database ends up with a handful of candidates even though thousands
        of titles qualify. Pushing the predicates into the source query instead lets each
        source spend its whole limit on rows that can survive.

        Sources reading a similarity table rather than ``visual_novels`` pass ``join_on``
        so the predicates have their column to sit on. That join is a primary-key lookup
        per row the source was already fetching, which is a smaller cost than the pool
        collapse it prevents, and it only appears when a filter is set.
        """
        if not predicates:
            return query
        if join_on is not None:
            query = query.join(VisualNovel, join_on == VisualNovel.id)
        return query.where(*predicates)

    async def _get_similar_vn_candidates(
        self,
        high_rated_vns: list[str],
        exclude_vn_ids: set[str],
        limit: int,
        spoiler_level: int = 0,
        filters: Optional[list] = None,
    ) -> RankedCandidates:
        """
        Get candidate VN IDs similar to user's highly-rated VNs.
        First tries pre-computed VNSimilarity table, falls back to live tag matching.

        Ranked by the similarity the table holds, closest first. The fallback's own
        ordering follows behind it rather than being merged into it: the two measure
        different things, and a fallback only runs where the table had little to say.
        """
        if not high_rated_vns:
            return []

        similar_vns: RankedCandidates = []

        # Try pre-computed similarity table first
        try:
            similarity_query = (
                select(VNSimilarity.similar_vn_id, VNSimilarity.similarity_score)
                .where(VNSimilarity.vn_id.in_(high_rated_vns))
                .where(not_in_ids(VNSimilarity.similar_vn_id, exclude_vn_ids))
            )
            similarity_query = self._restrict_to_filters(
                similarity_query, filters, VNSimilarity.similar_vn_id
            )
            result = await self.db.execute(
                similarity_query
                # Tied scores are common, so the id columns settle which of them survive
                # the limit and keep repeat requests answerable one way only.
                .order_by(
                    VNSimilarity.similarity_score.desc(),
                    VNSimilarity.similar_vn_id,
                    VNSimilarity.vn_id,
                )
                .limit(limit)
            )
            raw_similar = [(row.similar_vn_id, row.similarity_score) for row in result.all()]

            if raw_similar:
                # Take top similar VNs by similarity score
                raw_similar.sort(key=lambda x: x[1], reverse=True)
                similar_vns = dedupe_ranked(raw_similar[:limit])

                logger.info(f"VNSimilarity found {len(similar_vns)} candidates")
        except Exception as e:
            logger.warning(f"VNSimilarity lookup failed: {e}")

        # If pre-computed table is empty, find candidates via live tag matching
        if len(similar_vns) < limit // 2:
            logger.info("Using live tag matching for candidate selection")
            tag_based = await self._get_tag_based_candidates(
                high_rated_vns=high_rated_vns,
                exclude_vn_ids=exclude_vn_ids.union(ranked_ids(similar_vns)),
                limit=limit - len(similar_vns),
                spoiler_level=spoiler_level,
                filters=filters,
            )
            similar_vns = dedupe_ranked(similar_vns + tag_based)

        return similar_vns

    async def _get_tag_based_candidates(
        self,
        high_rated_vns: list[str],
        exclude_vn_ids: set[str],
        limit: int,
        spoiler_level: int = 0,
        filters: Optional[list] = None,
    ) -> RankedCandidates:
        """
        Find candidate VNs by matching tags with user's favorites.
        Uses IDF weighting so rare/niche tags count more than common ones.

        Ranked by the summed tag score behind the match, strongest first.

        The filters restrict the candidates, never the profile: the tag weights above are
        derived from what the reader has already rated, which no filter on the result set
        should reshape.
        """
        if not high_rated_vns:
            return []

        # Get top tags from user's highly-rated VNs with their scores
        tag_result = await self.db.execute(
            select(VNTag.tag_id, func.sum(VNTag.score).label('total_score'))
            .where(VNTag.vn_id.in_(high_rated_vns[:20]))
            .where(VNTag.spoiler_level <= spoiler_level)
            .where(VNTag.tag_id.notin_(IGNORE_TAGS))
            .where(VNTag.lie == False)  # exclude disputed/incorrect tags
            .group_by(VNTag.tag_id)
            # The tag id breaks score ties so the same profile always yields the same
            # tag set, and with it the same candidates downstream.
            .order_by(func.sum(VNTag.score).desc(), VNTag.tag_id)
            .limit(50)  # Get more tags for IDF filtering
        )
        user_tags = {row.tag_id: row.total_score for row in tag_result.all()}

        if not user_tags:
            return []

        # Get IDF weights for these tags (inverse of how common they are)
        idf_result = await self.db.execute(
            select(VNTag.tag_id, func.count(func.distinct(VNTag.vn_id)).label('doc_count'))
            .where(VNTag.tag_id.in_(list(user_tags.keys())))
            .where(VNTag.spoiler_level <= spoiler_level)
            .where(VNTag.lie == False)  # exclude disputed/incorrect tags
            .group_by(VNTag.tag_id)
        )
        tag_doc_counts = {row.tag_id: row.doc_count for row in idf_result.all()}

        # Get total VN count for IDF calculation
        total_vns_result = await self.db.execute(
            select(func.count(func.distinct(VisualNovel.id)))
        )
        total_vns = total_vns_result.scalar_one_or_none() or 10000

        # Compute IDF-weighted tag importance
        # IDF = log(total_docs / doc_count) - rare tags get higher weights
        tag_idf_weights = {}
        for tag_id, user_score in user_tags.items():
            doc_count = tag_doc_counts.get(tag_id, total_vns)
            idf = math.log(total_vns / max(doc_count, 1))
            # TF-IDF: user's tag score * IDF weight
            tag_idf_weights[tag_id] = user_score * idf

        # Select top 30 tags by IDF-weighted importance (favors niche tags)
        sorted_tags = sorted(tag_idf_weights.items(), key=lambda x: x[1], reverse=True)
        top_tag_ids = [tag_id for tag_id, _ in sorted_tags[:30]]

        if not top_tag_ids:
            return []

        # Find VNs with these tags, weighted by IDF
        # Use a subquery to compute weighted match scores
        candidates_query = (
            select(
                VNTag.vn_id,
                func.sum(VNTag.score).label('weighted_score'),
                func.count(VNTag.tag_id).label('match_count')
            )
            .where(VNTag.tag_id.in_(top_tag_ids))
            .where(VNTag.spoiler_level <= spoiler_level)
            .where(VNTag.score >= 1.0)
            .where(VNTag.lie == False)  # exclude disputed/incorrect tags
        )
        if exclude_vn_ids:
            candidates_query = candidates_query.where(
                not_in_ids(VNTag.vn_id, exclude_vn_ids)
            )
        candidates_query = self._restrict_to_filters(
            candidates_query, filters, VNTag.vn_id
        )
        candidates_query = (
            candidates_query
            .group_by(VNTag.vn_id)
            .having(func.count(VNTag.tag_id) >= 3)
            # The vn id breaks weighted-score ties, so which of the equally good matches
            # survive the limit is fixed rather than left to the planner.
            .order_by(func.sum(VNTag.score).desc(), VNTag.vn_id)
            .limit(limit)
        )

        result = await self.db.execute(candidates_query)
        raw_candidates = [(row.vn_id, row.weighted_score) for row in result.all()]

        if not raw_candidates:
            return []

        # Sort by tag score and return top candidates (no popularity penalty)
        raw_candidates.sort(key=lambda x: x[1], reverse=True)
        ranked = dedupe_ranked(raw_candidates[:limit])
        logger.info(f"Tag-based selection found {len(ranked)} candidates using IDF-weighted tags")
        return ranked

    async def _get_elite_tag_candidates(
        self,
        elite_tag_ids: set[int],
        exclude_vn_ids: set[str],
        limit: int,
        spoiler_level: int = 0,
        filters: Optional[list] = None,
        seed: str = "",
    ) -> RankedCandidates:
        """
        Find VNs matching ANY of the reader's elite tags.
        No minimum tag count requirement - even 1 elite tag match qualifies.
        This ensures rare tags the user loves can surface recommendations.

        Ranked by how strongly the elite tags apply, which is what the query already
        orders on.
        """
        if not elite_tag_ids:
            return []

        # Find VNs with ANY elite tag, ordered by tag score
        strength = (
            func.sum(VNTag.score) if ELITE_TAG_SUM_ORDER else func.max(VNTag.score)
        )
        query = (
            select(
                VNTag.vn_id,
                strength.label('best_score')
            )
            .where(VNTag.tag_id.in_(elite_tag_ids))
            .where(VNTag.spoiler_level <= spoiler_level)
            .where(VNTag.score >= 2.0)  # Strong tag presence only
            .where(VNTag.lie == False)  # exclude disputed/incorrect tags
        )
        if exclude_vn_ids:
            query = query.where(not_in_ids(VNTag.vn_id, exclude_vn_ids))
        query = self._restrict_to_filters(query, filters, VNTag.vn_id)

        query = (
            query
            .group_by(VNTag.vn_id)
            # Tag scores sit on a coarse scale and most of the qualifying rows share the
            # top value, so ties are not the exception here, they are most of the draw. The
            # id alone would settle them in catalogue order, which is age order, and hand
            # every reader sharing one common tag the same opening stretch of the table. A
            # salted digest settles them without any property of the row deciding who
            # survives, and falls the same way on a repeat request.
            .order_by(
                strength.desc(),
                *stable_shuffle_order(VNTag.vn_id, seed, "elite_tag"),
            )
            .limit(limit)
        )

        result = await self.db.execute(query)
        elite_vns = dedupe_ranked((row.vn_id, row.best_score) for row in result.all())

        logger.info(f"Elite tag query found {len(elite_vns)} VNs matching tags {elite_tag_ids}")
        return elite_vns

    async def _get_cooccurrence_candidates(
        self,
        high_rated_vns: list[str],
        exclude_vn_ids: set[str],
        limit: int,
        filters: Optional[list] = None,
    ) -> RankedCandidates:
        """
        Get candidates from VNCoOccurrence - VNs that fans of user's favorites also read.
        This ensures VNs with high co-occurrence (but different tag profiles) are considered.

        Ranked by the strongest co-rating behind the title, which is the first of the
        rows the query's own ordering reaches it on.
        """
        if not high_rated_vns:
            return []

        query = (
            select(VNCoOccurrence.similar_vn_id, VNCoOccurrence.co_rating_score)
            .where(VNCoOccurrence.vn_id.in_(high_rated_vns[:20]))
            .where(VNCoOccurrence.user_count >= COOCCURRENCE_MIN_USERS)
        )
        if exclude_vn_ids:
            query = query.where(not_in_ids(VNCoOccurrence.similar_vn_id, exclude_vn_ids))
        query = self._restrict_to_filters(query, filters, VNCoOccurrence.similar_vn_id)

        # The similar vn id breaks co-rating ties so the truncated set is reproducible.
        query = query.order_by(
            VNCoOccurrence.co_rating_score.desc(), VNCoOccurrence.similar_vn_id
        ).limit(limit)

        result = await self.db.execute(query)
        cooccurrence_vns = dedupe_ranked(
            (row.similar_vn_id, row.co_rating_score) for row in result.all()
        )

        logger.info(f"Co-occurrence candidates: {len(cooccurrence_vns)} VNs from top favorites")
        return cooccurrence_vns

    @staticmethod
    def _top_entities(weights, count: int, counts: Optional[dict] = None) -> dict:
        """The reader's strongest affinities of one kind, strongest first.

        An affinity is a delta from the reader's own average, so only a positive one says
        the entity was liked rather than merely encountered. Under the entity-preference
        switch it is instead a centred preference on the unit interval, which keeps the
        same sign convention without being a delta in rating points.

        Ranked on how much of the reader's own list the entity accounts for as well as on
        how far above their average it sits. An affinity is a mean, so an entity met once
        and enjoyed carries a larger one than an entity read many times with the ordinary
        spread of opinion, and on affinity alone a reader's most-read studio loses its place
        to a title they happened to like. Support enters under a root so it tempers the
        ranking rather than replacing it with a frequency count. Zero leaves the mean alone.

        The entity id settles ties, so the same profile always asks about the same entities
        and the arm returns the same titles on a repeat request.
        """
        if not weights or count <= 0:
            return {}
        support = counts or {}

        def rank(entity: str, weight: float) -> float:
            if ENTITY_SUPPORT_WEIGHT <= 0:
                return weight
            seen = max(1.0, float(support.get(entity, 1) or 1))
            return (1.0 + weight) * (seen ** ENTITY_SUPPORT_WEIGHT)

        ranked = sorted(
            (
                (entity, float(weight))
                for entity, weight in weights.items()
                if weight is not None and weight > (
                    # A centred preference is admitted above the even point, since under
                    # the switch the count already tempers a thinly met entity.
                    0.0 if ENTITY_PREFERENCE else ENTITY_RETRIEVAL_MIN_AFFINITY
                )
            ),
            key=lambda item: (-rank(item[0], item[1]), str(item[0])),
        )
        return dict(ranked[:count])

    def _entity_candidate_query(
        self,
        *,
        vn_column,
        entity_column,
        weights: dict,
        exclude_vn_ids: set[str],
        limit: int,
        filters: Optional[list],
        seed: str,
        domain: str,
        join=None,
        extra_where: tuple = (),
    ):
        """One query for the unread titles connected to entities this reader rated well.

        One query rather than one per entity: the affinities are carried into the statement
        as a mapping over the entity column, so the whole set is asked about in a single
        pass over the index on it.

        The ordering is the strongest affinity a title carries, then how many of the
        reader's entities it carries at all. Depth first, because a title by a studio the
        reader has read repeatedly is the point of the arm and a title sharing one minor
        credit is not; breadth second, so between two titles matching an entity equally well
        the one matching more of them is taken. Beyond that a salted digest settles it,
        since the id alone would order by catalogue age and hand every reader the same
        opening stretch of the table.
        """
        affinity = case(
            {entity: weight for entity, weight in weights.items()},
            value=entity_column,
            else_=0.0,
        )
        strength = func.max(affinity)
        breadth = func.count(entity_column.distinct())
        query = select(vn_column.label("vn_id"), strength.label("affinity"))
        if join is not None:
            query = join(query)
        query = query.where(entity_column.in_(list(weights)), *extra_where)
        if exclude_vn_ids:
            query = query.where(not_in_ids(vn_column, exclude_vn_ids))
        query = self._restrict_to_filters(query, filters, vn_column)
        query = query.group_by(vn_column).order_by(
            strength.desc(),
            breadth.desc(),
            *stable_shuffle_order(vn_column, seed, domain),
        )
        if ENTITY_ROUND_ROBIN and len(weights) > 1:
            # A share per entity rather than one ordering over all of them. Ordered
            # globally, the strongest affinity fills the budget before the next entity is
            # reached, so an arm asked about twenty entities answers about two and a reader
            # raising its weight only buys more of the same two. The quota is the ceiling
            # each entity is served before the rest are, and what an entity cannot fill
            # falls through to the others.
            ranked = query.add_columns(
                strength.label("entity_rank"),
                func.row_number()
                .over(partition_by=strength, order_by=(breadth.desc(), *stable_shuffle_order(vn_column, seed, domain)))
                .label("in_entity"),
            ).subquery()
            per_entity = max(1, limit // max(1, len(weights)))
            return (
                select(ranked.c.vn_id, ranked.c.affinity)
                .order_by(
                    case((ranked.c.in_entity <= per_entity, 0), else_=1),
                    ranked.c.entity_rank.desc(),
                    ranked.c.in_entity,
                )
                .limit(limit)
            )
        return query.limit(limit)

    async def _get_developer_candidates(
        self,
        *,
        weights,
        counts: Optional[dict] = None,
        exclude_vn_ids: set[str],
        limit: int,
        spoiler_level: int = 0,
        filters: Optional[list] = None,
        seed: str = "",
    ) -> RankedCandidates:
        """Unread titles from the studios this reader rated above their own average.

        Ranked by the strongest affinity a title carries, which the query already labels.

        Keyed by producer id, which is what the release chain holds. The reader's developer
        affinities are keyed by name, and a name identifies a studio only loosely: the
        catalogue holds distinct producers under names differing by case alone, so a name
        looked up across the whole table would fetch a stranger's catalogue under a studio
        this reader likes. The ids are taken from the reader's own titles instead, so an
        affinity reaches exactly the producer that earned it.
        """
        entities = self._top_entities(weights, ENTITY_RETRIEVAL_ENTITIES, counts)
        if not entities or limit <= 0:
            return []

        query = self._entity_candidate_query(
            vn_column=ReleaseVN.vn_id,
            entity_column=ReleaseProducer.producer_id,
            weights=entities,
            exclude_vn_ids=exclude_vn_ids,
            limit=limit,
            filters=filters,
            seed=seed,
            domain="developer",
            join=lambda query: query.select_from(ReleaseProducer).join(
                ReleaseVN, ReleaseVN.release_id == ReleaseProducer.release_id
            ),
            # A studio that only published a title said nothing about how it reads.
            extra_where=(ReleaseProducer.developer == True,),  # noqa: E712
        )
        result = await self.db.execute(query)
        return dedupe_ranked((row.vn_id, row.affinity) for row in result.all())

    async def _get_staff_candidates(
        self,
        *,
        weights,
        counts: Optional[dict] = None,
        exclude_vn_ids: set[str],
        limit: int,
        spoiler_level: int = 0,
        filters: Optional[list] = None,
        seed: str = "",
    ) -> RankedCandidates:
        """Unread titles crediting the writers, artists and composers this reader rated well.

        Ranked by the strongest affinity a title carries.
        """
        entities = self._top_entities(weights, ENTITY_RETRIEVAL_ENTITIES, counts)
        if not entities or limit <= 0:
            return []

        query = self._entity_candidate_query(
            vn_column=VNStaff.vn_id,
            entity_column=VNStaff.staff_id,
            weights=entities,
            exclude_vn_ids=exclude_vn_ids,
            limit=limit,
            filters=filters,
            seed=seed,
            domain="staff",
        )
        result = await self.db.execute(query)
        return dedupe_ranked((row.vn_id, row.affinity) for row in result.all())

    async def _get_seiyuu_candidates(
        self,
        *,
        weights,
        counts: Optional[dict] = None,
        exclude_vn_ids: set[str],
        limit: int,
        spoiler_level: int = 0,
        filters: Optional[list] = None,
        seed: str = "",
    ) -> RankedCandidates:
        """Unread titles cast with the voice actors this reader rated well.

        Ranked by the strongest affinity a title carries.
        """
        entities = self._top_entities(weights, ENTITY_RETRIEVAL_ENTITIES, counts)
        if not entities or limit <= 0:
            return []

        query = self._entity_candidate_query(
            vn_column=VNSeiyuu.vn_id,
            entity_column=VNSeiyuu.staff_id,
            weights=entities,
            exclude_vn_ids=exclude_vn_ids,
            limit=limit,
            filters=filters,
            seed=seed,
            domain="seiyuu",
        )
        result = await self.db.execute(query)
        return dedupe_ranked((row.vn_id, row.affinity) for row in result.all())

    async def _get_trait_candidates(
        self,
        *,
        weights,
        counts: Optional[dict] = None,
        exclude_vn_ids: set[str],
        limit: int,
        spoiler_level: int = 0,
        filters: Optional[list] = None,
        seed: str = "",
    ) -> RankedCandidates:
        """Unread titles whose cast carries the character traits this reader rated well.

        Ranked by the strongest affinity a title carries.

        The published per-trait character count decides which of the reader's traits are
        worth asking about. It is a primary-key read of the ids already chosen, and it
        bounds what the arm itself then scans: the trait table holds millions of rows and
        the broadest traits hold a large share of them between them.
        """
        entities = self._top_entities(weights, ENTITY_RETRIEVAL_ENTITIES, counts)
        if not entities or limit <= 0:
            return []

        selective = await self.db.execute(
            select(Trait.id)
            .where(Trait.id.in_(list(entities)))
            .where(func.coalesce(Trait.char_count, 0) <= TRAIT_RETRIEVAL_MAX_CHARS)
        )
        allowed = {row.id for row in selective.all()}
        entities = {
            trait_id: weight
            for trait_id, weight in entities.items()
            if trait_id in allowed
        }
        if not entities:
            return []

        query = self._entity_candidate_query(
            vn_column=CharacterVN.vn_id,
            entity_column=CharacterTrait.trait_id,
            weights=entities,
            exclude_vn_ids=exclude_vn_ids,
            limit=limit,
            filters=filters,
            seed=seed,
            domain="trait",
            join=lambda query: query.select_from(CharacterTrait).join(
                CharacterVN, CharacterVN.character_id == CharacterTrait.character_id
            ),
            extra_where=(CharacterTrait.spoiler_level <= spoiler_level,),
        )
        result = await self.db.execute(query)
        return dedupe_ranked((row.vn_id, row.affinity) for row in result.all())

    async def _collaborative_scores_for(self, reader_id: str, candidate_ids: list[str]) -> dict[str, float]:
        """The collaborative signal over the pool, or nothing for a reader the model lacks.

        The model keys readers by the bare numeric id, so the uid prefix is dropped
        before the lookup.
        """
        bare = reader_id[1:] if reader_id.startswith("u") else reader_id
        row = (
            await self.db.execute(select(CFUserFactors.factors).where(CFUserFactors.user_hash == bare))
        ).first()
        if row is None:
            return {}
        reader = np.asarray(row.factors, dtype=np.float32)
        item_rows = (
            await self.db.execute(
                select(CFVNFactors.vn_id, CFVNFactors.factors).where(in_ids(CFVNFactors.vn_id, candidate_ids))
            )
        ).all()
        items = {r.vn_id: np.asarray(r.factors, dtype=np.float32) for r in item_rows}
        return collaborative_scores(reader, items)

    async def _batch_get_similar_games_scores(
        self,
        candidate_ids: list[str],
        high_rated_vns: list[str],
        vn_scores: dict[str, float] = None,
    ) -> dict[str, tuple[float, list[dict]]]:
        """
        Score candidates by similarity to user's favorites using VNSimilarity table.
        This is the same data shown in "Similar Games" on VN pages.

        Contributions are weighted by how highly the user rated the source VN.
        VNs rated 10.0 contribute more than VNs rated 8.5.

        Returns: {vn_id: (score, [{source_vn_id, similarity}])}
        """
        if not high_rated_vns or not candidate_ids:
            return {}

        vn_scores = vn_scores or {}

        # Query VNSimilarity: for each candidate, find how similar it is to user's favorites
        query = (
            select(
                VNSimilarity.similar_vn_id,
                VNSimilarity.vn_id.label('source_vn_id'),
                VNSimilarity.similarity_score,
            )
            .where(VNSimilarity.vn_id.in_(high_rated_vns[:20]))
            .where(VNSimilarity.similar_vn_id.in_(candidate_ids))
            .order_by(VNSimilarity.similarity_score.desc())
        )

        result = await self.db.execute(query)
        rows = result.all()

        # Aggregate: candidate gets credit for being similar to ANY favorite
        # Weight by how highly the user rated the source VN
        candidate_data: dict[str, list[tuple[str, float, float]]] = {}  # vn_id -> [(source_id, similarity, user_rating_weight)]
        for row in rows:
            cand_id = row.similar_vn_id
            source_vn_id = row.source_vn_id
            # User's rating of source VN (0-10 scale), normalized to 0-1
            # VNs rated 10.0 get full weight, 8.5 gets 0.85 weight
            user_rating_weight = vn_scores.get(source_vn_id, 7.0) / 10.0
            if cand_id not in candidate_data:
                candidate_data[cand_id] = []
            candidate_data[cand_id].append((source_vn_id, row.similarity_score, user_rating_weight))

        # Compute final scores
        # Score = weighted_best_match + weighted_avg, with bonus for multiple matches
        final_scores = {}
        for cand_id, matches in candidate_data.items():
            # Weight similarity scores by user's rating of the source VN
            weighted_scores = [(m[1] * m[2]) for m in matches]
            raw_scores = [m[1] for m in matches]

            max_weighted = max(weighted_scores)
            avg_weighted = sum(weighted_scores) / len(weighted_scores)

            # Bonus for matching multiple favorites (up to 30%)
            match_bonus = min(1.3, 1.0 + len(matches) * 0.05)
            # The closest single favourite, since the mean of the matches ranks a candidate
            # down for also resembling favourites it resembles less. Breadth is credited by
            # the bonus above rather than by pulling the strongest match toward the rest.
            if ITEM_ITEM_BEST_MATCH:
                score = max_weighted * match_bonus
            else:
                score = (0.6 * max_weighted + 0.4 * avg_weighted) * match_bonus

            # Store details for display (top 5 matches, sorted by weighted score)
            sorted_matches = sorted(matches, key=lambda x: -(x[1] * x[2]))[:5]
            details = [
                {"source_vn_id": m[0], "similarity": m[1], "user_rating_weight": round(m[2], 2)}
                for m in sorted_matches
            ]
            final_scores[cand_id] = (min(1.0, score), details)

        logger.info(f"Similar Games scores: {len(final_scores)} candidates")
        return final_scores

    async def _similarity_rating_neighbours(
        self,
        candidate_ids: list[str],
        vn_scores: dict[str, float],
    ) -> dict[str, list[tuple[float, float]]]:
        """Each candidate against the reader's whole rated list through the similarity
        table: closeness paired with the mark the reader gave.

        A separate read from the one that scores this signal, and over a wider source set.
        The score is asked which of the reader's favourites a candidate resembles, which is
        the right question for finding one; a prediction read off favourites alone cannot
        fall below the worst of them, so it needs the titles the reader disliked as well.

        One query, both sides bounded by lists the request already holds.
        """
        if not candidate_ids or not vn_scores:
            return {}
        rows = (
            await self.db.execute(
                select(
                    VNSimilarity.vn_id,
                    VNSimilarity.similar_vn_id,
                    VNSimilarity.similarity_score,
                )
                .where(in_ids(VNSimilarity.vn_id, list(vn_scores)))
                .where(in_ids(VNSimilarity.similar_vn_id, candidate_ids))
            )
        ).all()
        neighbours: dict[str, list[tuple[float, float]]] = {}
        for row in rows:
            rating = vn_scores.get(row.vn_id)
            if rating is None:
                continue
            neighbours.setdefault(row.similar_vn_id, []).append(
                (float(row.similarity_score or 0.0), rating)
            )
        return neighbours

    async def _batch_get_users_also_read_scores(
        self,
        candidate_ids: list[str],
        high_rated_vns: list[str],
        vn_scores: dict[str, float] = None,
    ) -> dict[str, tuple[float, list[dict]]]:
        """
        Score candidates by co-occurrence patterns using VNCoOccurrence table.
        This is the same data shown in "Users Also Read" on VN pages.

        Contributions are weighted by how highly the user rated the source VN.
        VNs rated 10.0 contribute more than VNs rated 8.5.

        Returns: {vn_id: (score, [{source_vn_id, co_score, user_count}])}
        """
        if not high_rated_vns or not candidate_ids:
            logger.info("Users Also Read: skipping - no high_rated_vns or candidates")
            return {}

        vn_scores = vn_scores or {}

        logger.info(f"Users Also Read query: high_rated_vns[:5]={high_rated_vns[:5]}, {len(candidate_ids)} candidates")

        # Query VNCoOccurrence: for each candidate, find co-rating with user's favorites
        query = (
            select(
                VNCoOccurrence.similar_vn_id,
                VNCoOccurrence.vn_id.label('source_vn_id'),
                VNCoOccurrence.co_rating_score,
                VNCoOccurrence.user_count,
            )
            .where(VNCoOccurrence.vn_id.in_(high_rated_vns[:20]))
            .where(VNCoOccurrence.similar_vn_id.in_(candidate_ids))
            .order_by(VNCoOccurrence.co_rating_score.desc())
        )

        result = await self.db.execute(query)
        rows = result.all()
        logger.info(f"Users Also Read: {len(rows)} co-occurrence rows found")

        # Aggregate per candidate
        # Store tuple: (source_vn_id, co_rating_score, user_count, user_rating_weight)
        candidate_data: dict[str, list[tuple[str, float, int, float]]] = {}
        for row in rows:
            cand_id = row.similar_vn_id
            source_vn_id = row.source_vn_id
            # User's rating of source VN (0-10 scale), normalized to 0-1
            # VNs rated 10.0 get full weight, 8.5 gets 0.85 weight
            user_rating_weight = vn_scores.get(source_vn_id, 7.0) / 10.0
            if cand_id not in candidate_data:
                candidate_data[cand_id] = []
            candidate_data[cand_id].append((source_vn_id, row.co_rating_score, row.user_count, user_rating_weight))

        # Compute final scores
        # co_rating_score ranges from ~0-12, normalize to 0-1 for proper weighting
        CO_RATING_SCALE = 10.0  # Normalize by dividing by this value

        final_scores = {}
        for cand_id, matches in candidate_data.items():
            # Normalize and weight raw scores by user's rating of source VN
            weighted_scores = [min(1.0, m[1] / CO_RATING_SCALE) * m[3] for m in matches]
            user_counts = [m[2] for m in matches]

            max_score = max(weighted_scores)
            avg_score = sum(weighted_scores) / len(weighted_scores)
            total_users = sum(user_counts)

            # Confidence based on user count (max at 50 total users)
            confidence = min(1.0, total_users / 50)
            # Bonus for multiple matching favorites
            match_bonus = min(1.3, 1.0 + len(matches) * 0.05)

            best = max_score if ITEM_ITEM_BEST_MATCH else 0.6 * max_score + 0.4 * avg_score
            score = best * confidence * match_bonus

            # Store details (top 5 matches, sorted by weighted score)
            sorted_matches = sorted(matches, key=lambda x: -(x[1] / CO_RATING_SCALE * x[3]))[:5]
            details = [
                {"source_vn_id": m[0], "co_score": m[1], "user_count": m[2], "user_rating_weight": round(m[3], 2)}
                for m in sorted_matches
            ]
            final_scores[cand_id] = (min(1.0, score), details)

        logger.info(f"Users Also Read scores: {len(final_scores)} candidates")
        return final_scores

    async def _get_candidates(
        self,
        exclude_vn_ids: set[str],
        min_rating: Optional[float],
        min_length: Optional[int],
        max_length: Optional[int],
        include_tags: Optional[list[int]],
        exclude_tags: Optional[list[int]],
        include_traits: Optional[list[int]],
        exclude_traits: Optional[list[int]],
        limit: int,
        high_rated_vns: Optional[list[str]] = None,
        elite_tag_ids: Optional[set[int]] = None,
        japanese_only: bool = True,
        spoiler_level: int = 0,
        filters: Optional[VNFilterSpec] = None,
        target_pool: Optional[int] = None,
        seed_vns: Optional[list[str]] = None,
        user_profile: Optional[dict] = None,
        signal_weights: Optional[dict[str, float]] = None,
    ) -> list[dict]:
        """
        Get candidate VNs using similarity-based selection.

        Instead of just top-rated VNs, we now:
        1. Get VNs similar to user's favorites (from VNSimilarity table)
        2. Add a per-reader exploration slice (20% of results)
        3. Add VNs matching elite tags (user's top 5) to ensure rare tag coverage
        4. Add VNs whose descriptions read closest to the reader's favorites
        5. Apply user's filters
        6. Fallback to quality-based selection if no similarity data
        7. Filter by original language if japanese_only=True
        8. Filter by character traits if specified

        Every source but the fourth reaches a title through a table built from what
        readers did, so between them they cover the read part of the catalogue and the
        broad slice reaches the rest at random. The fourth is what lets an unread title be
        collected because it suits this reader rather than because it came up in a
        shuffle.

        The filters in ``filters`` are pushed into the source queries themselves rather
        than applied to what they return; see ``_restrict_to_filters``. Where they still
        leave the pool too small to fill a page, collection is repeated with wider source
        limits and, as a last resort, topped up from quality-ranked titles that match. The
        result of that accounting is published on ``last_pool`` so a caller can tell an
        empty page caused by a filter from one caused by an empty profile.

        A request carrying no filter of its own takes a single collection pass with the
        source limits unchanged, so the pool it sees is the pool it has always seen.

        ``signal_weights`` divides that budget between the sources. The total is unchanged
        and the split at the default vector is the fixed one, so what moves is which source
        spends it: the point of a slider is to send retrieval looking rather than to
        reorder whatever the other sources returned.
        """
        # An absent spec has to contribute no predicate whatsoever. The spec's own default
        # hides adult titles, which is the browse page's default rather than this one's: a
        # personalised list is drawn from what the reader has already rated, so nothing is
        # held back from it unless the request says so.
        spec = filters if filters is not None else VNFilterSpec(nsfw=True)
        # The minimum-rating filter predates the shared vocabulary and still arrives as its
        # own argument, so it joins the spec here and is pushed into the sources with the
        # rest rather than being applied once at the end.
        if min_rating is not None and spec.min_rating is None:
            spec = replace(spec, min_rating=min_rating)
        predicates = vn_filter_predicates(spec, rating_column=AVERAGE_RATING)

        # Distinguishes a filter the reader asked for from the defaults every request
        # carries: the language default and the exclusion list narrow the pool too, but
        # widening for them would change what an ordinary request returns. The tag and
        # trait filters count, since they subtract from the pool more sharply than any
        # other filter here.
        filters_active = bool(
            predicates
            or min_length is not None
            or max_length is not None
            or include_tags
            or exclude_tags
            or include_traits
            or exclude_traits
        )
        status = status_predicates(spec)
        target = target_pool if target_pool is not None else max(1, limit // 5)

        # Every stage below is truncated by a limit, and the same request has to return the
        # same list, so each one carries an ordering of its own. The seed is fixed before
        # the first pass: a wider pass then reads further down the same ordering instead of
        # drawing a different slice, which keeps the earlier candidates in the pool.
        seed = exploration_seed(high_rated_vns, elite_tag_ids)

        # Which of the reader's titles the related sources are asked about. It is the
        # favourites unless the caller names another list, and the salt above is taken
        # from the favourites either way, so a request that changes the seeds changes
        # what those sources return without also redrawing the broad slice.
        source_vns = seed_vns if seed_vns is not None else high_rated_vns

        steps = CANDIDATE_WIDENING_STEPS if filters_active else CANDIDATE_WIDENING_STEPS[:1]
        candidates: list[dict] = []
        all_candidate_ids: set[str] = set()
        priority_ids: set[str] = set()
        passes = 0

        for widen in steps:
            passes += 1
            all_candidate_ids, priority_ids, source_buckets = await self._collect_candidate_ids(
                exclude_vn_ids=exclude_vn_ids,
                limit=limit,
                high_rated_vns=source_vns,
                elite_tag_ids=elite_tag_ids,
                japanese_only=japanese_only,
                spoiler_level=spoiler_level,
                predicates=predicates,
                seed=seed,
                widen=widen,
                user_profile=user_profile,
                signal_weights=signal_weights,
            )
            if not all_candidate_ids:
                break

            candidates = await self._fetch_candidate_details(
                candidate_ids=all_candidate_ids,
                limit=limit * widen,
                predicates=predicates + status,
                min_length=min_length,
                max_length=max_length,
                japanese_only=japanese_only,
                seed=seed,
                priority_ids=priority_ids,
                source_buckets=source_buckets,
            )
            candidates = await self._apply_content_filters(
                candidates,
                include_tags=include_tags,
                exclude_tags=exclude_tags,
                include_traits=include_traits,
                exclude_traits=exclude_traits,
                spoiler_level=spoiler_level,
            )
            if len(candidates) >= target:
                break
            if widen != steps[-1]:
                logger.info(
                    f"Filtered candidate pool held {len(candidates)} of {target}; "
                    f"widening past x{widen}"
                )

        topped_up = False
        if not all_candidate_ids:
            # Fallback: no source produced anything, so rank on quality alone.
            logger.info("Using fallback candidate selection (no similarity data)")
            candidates = await self._quality_candidates(
                exclude_vn_ids=exclude_vn_ids,
                limit=limit,
                predicates=predicates + status,
                min_length=min_length,
                max_length=max_length,
                japanese_only=japanese_only,
            )
            candidates = await self._apply_content_filters(
                candidates,
                include_tags=include_tags,
                exclude_tags=exclude_tags,
                include_traits=include_traits,
                exclude_traits=exclude_traits,
                spoiler_level=spoiler_level,
            )
        elif filters_active and len(candidates) < target:
            # The widest pass still could not fill the page, which means the reader's own
            # similarity graph holds too few matching titles rather than that the filter
            # matches nothing. Ranking the remaining matches on quality degrades the page
            # from personalised to merely good, which is what a reader asking for a narrow
            # corner of the database can be given.
            extra = await self._quality_candidates(
                exclude_vn_ids=exclude_vn_ids | all_candidate_ids,
                limit=target * TOP_UP_POOL_MULTIPLIER,
                predicates=predicates + status,
                min_length=min_length,
                max_length=max_length,
                japanese_only=japanese_only,
            )
            extra = await self._apply_content_filters(
                extra,
                include_tags=include_tags,
                exclude_tags=exclude_tags,
                include_traits=include_traits,
                exclude_traits=exclude_traits,
                spoiler_level=spoiler_level,
            )
            if extra:
                candidates = candidates + extra
                topped_up = True

        self.last_pool = {
            "candidates": len(candidates),
            "requested": target,
            "filtered": filters_active,
            "widened": passes > 1,
            "topped_up": topped_up,
            "thin": len(candidates) < target,
        }
        return candidates

    async def _collect_candidate_ids(
        self,
        *,
        exclude_vn_ids: set[str],
        limit: int,
        high_rated_vns: Optional[list[str]],
        elite_tag_ids: Optional[set[int]],
        japanese_only: bool,
        spoiler_level: int,
        predicates: list,
        seed: str,
        widen: int = 1,
        user_profile: Optional[dict] = None,
        signal_weights: Optional[dict[str, float]] = None,
    ) -> tuple[set[str], set[str]]:
        """Union the candidate sources, each restricted to what the filters admit.

        ``widen`` multiplies every source's limit. Each source keeps its own share of the
        pool at any width, so widening deepens all of them rather than letting whichever
        source happens to match the filter best crowd out the others.

        ``signal_weights`` is the vector the pool will be ranked under, and it decides how
        the budget is divided as well: a source whose signal the request turns up is given
        more of the pool to fill, and one whose signal is at zero is not consulted. Absent,
        every source spends the fixed share it always had.

        Returns the union, the ids named by the sources that read the reader's own list
        rather than drawing broadly, and the union split by the source that named each id
        with the share that source was given. The union is a set, so which source nominated
        an id is not recoverable from it, and the cut downstream is the only place that
        distinction can still be made.

        Each source's own ranking is kept on ``last_ranked_arms`` rather than returned. It
        is what a stage aggregating agreement between the sources reads, and the union this
        returns has already thrown it away; putting it in the return would change a shape
        several callers unpack.
        """
        all_candidate_ids: set[str] = set()
        priority_ids: set[str] = set()
        ranked_arms: dict[str, RankedCandidates] = {}
        # Which source first named each id. The union is wider than the pool, so the cut
        # downstream decides how much of each source's find survives, and it cannot make
        # that decision from a set of ids alone. First namer, since a source excludes what
        # the ones before it already collected and an id it did not have to look for is
        # not evidence it contributed.
        source_of: dict[str, str] = {}

        # One line per pass over the sources, since which source dominates a pass depends
        # on the reader's list rather than on the code.
        sources = StageTimer()

        def record(arm: str, ids) -> None:
            sources.mark(arm)
            for vn_id in ids:
                source_of.setdefault(vn_id, arm)

        # The fixed share each source would spend, and then the same total divided by what
        # the request asked for. Widening multiplies the result rather than the input, so
        # a wider pass deepens the split the request chose instead of redrawing it.
        exploration_limit = max(50, int(limit * 0.2))
        baseline = {
            "similar": int(limit * 0.8),
            "exploration": exploration_limit * 3,
            "elite_tag": 50,
            "description": max(0, int(limit * DESC_RETRIEVAL_SHARE)),
            "cooccurrence": 100,
            "developer": DEVELOPER_RETRIEVAL_LIMIT,
            "staff": STAFF_RETRIEVAL_LIMIT,
            "seiyuu": SEIYUU_RETRIEVAL_LIMIT,
            "trait": TRAIT_RETRIEVAL_LIMIT,
        }
        budgets = retrieval_budgets(baseline, signal_weights)

        # The broad draw restricts on language itself; the three sources below reach
        # visual_novels only through a join, so the restriction is theirs to opt into.
        if SOURCE_OLANG_PUSHDOWN and japanese_only:
            source_predicates = list(predicates) + [VisualNovel.olang == "ja"]
        else:
            source_predicates = predicates

        # Try similarity-based candidates if user has favorites
        if high_rated_vns and budgets["similar"] > 0:
            try:
                similar_ranked = await self._get_similar_vn_candidates(
                    high_rated_vns=high_rated_vns,
                    exclude_vn_ids=exclude_vn_ids,
                    limit=budgets["similar"] * widen,
                    spoiler_level=spoiler_level,
                    filters=source_predicates,
                )
                ranked_arms["similar"] = similar_ranked
                similar_candidate_ids = ranked_ids(similar_ranked)
                all_candidate_ids.update(similar_candidate_ids)
                priority_ids.update(similar_candidate_ids)
                record("similar", similar_candidate_ids)
            except Exception as e:
                logger.warning(f"Similarity lookup failed: {e}")

        # Add exploration candidates
        if budgets["exploration"] > 0:
            try:
                if EXPLORATION_OPEN:
                    exploration_query = select(VisualNovel.id).where(
                        func.coalesce(VisualNovel.average_rating, EXPLORATION_MIN_AVERAGE)
                        >= EXPLORATION_MIN_AVERAGE,
                        func.coalesce(VisualNovel.votecount, 0) >= EXPLORATION_MIN_VOTES,
                        VisualNovel.devstatus == 0,
                    )
                else:
                    exploration_query = select(VisualNovel.id).where(
                        VisualNovel.rating >= 6.0  # Decent quality (VNDB scale is 1-10)
                    )
                if exclude_vn_ids:
                    exploration_query = exploration_query.where(
                        not_in_ids(VisualNovel.id, exclude_vn_ids)
                    )
                if japanese_only:
                    exploration_query = exploration_query.where(
                        VisualNovel.olang == "ja"
                    )
                evidence = exploration_evidence_predicate()
                if evidence is not None:
                    exploration_query = exploration_query.where(evidence)
                exploration_query = self._restrict_to_filters(exploration_query, predicates)
                # Exploration still has to spread readers across different titles, which the
                # per-reader salt does without the list changing between two identical requests.
                exploration_total = budgets["exploration"] * widen
                if EXPLORATION_STRATIFIED:
                    # Ranked within band, then cut per band, so the thinly populated bands
                    # survive a draw the crowded ones would otherwise fill on their own.
                    band = popularity_band_expression()
                    ordering = stable_shuffle_order(VisualNovel.id, seed, "exploration")
                    shares = EXPLORATION_BAND_SHARES
                    columns = [
                        func.row_number()
                        .over(partition_by=band, order_by=ordering)
                        .label("in_band"),
                    ]
                    if shares:
                        columns.append(band.label("band"))
                    within = exploration_query.add_columns(*columns).subquery()
                    if shares:
                        # Each band's own quota, so the draw's spread over the range is set
                        # here rather than by how much of the catalogue each band holds.
                        quotas = allocate_shares(exploration_total, shares)
                        per_band = case(
                            *(
                                (within.c.band == index, quota)
                                for index, quota in enumerate(quotas)
                            ),
                            else_=0,
                        )
                    else:
                        per_band = max(1, exploration_total // POPULARITY_BAND_COUNT)
                    exploration_query = (
                        select(within.c.id).where(within.c.in_band <= per_band)
                    )
                else:
                    exploration_query = exploration_query.order_by(
                        *stable_shuffle_order(VisualNovel.id, seed, "exploration")
                    ).limit(exploration_total)
                exploration_result = await self.db.execute(exploration_query)
                exploration_ids = {row.id for row in exploration_result.all()}
                all_candidate_ids.update(exploration_ids)
                record("exploration", exploration_ids)
            except Exception as e:
                logger.warning(f"Exploration query failed: {e}")

        # Add elite tag candidates - VNs matching user's top 5 tags
        # These bypass the normal >= 3 tag filter to ensure rare tag matches
        if elite_tag_ids and budgets["elite_tag"] > 0:
            try:
                elite_ranked = await self._get_elite_tag_candidates(
                    elite_tag_ids=elite_tag_ids,
                    exclude_vn_ids=exclude_vn_ids.union(all_candidate_ids),
                    limit=budgets["elite_tag"] * widen,
                    spoiler_level=spoiler_level,
                    filters=source_predicates,
                    seed=seed,
                )
                ranked_arms["elite_tag"] = elite_ranked
                elite_candidates = ranked_ids(elite_ranked)
                all_candidate_ids.update(elite_candidates)
                record("elite_tag", elite_candidates)
                logger.info(f"Added {len(elite_candidates)} elite tag candidates")
            except Exception as e:
                logger.warning(f"Elite tag candidate query failed: {e}")

        # Add description neighbours - titles whose own prose reads closest to the
        # reader's favourites. Every other source here reaches a title through a table
        # built from what readers did, so between them they cover the part of the
        # catalogue that has been read; a title nobody has voted on is reachable only by
        # the broad draw, which reaches it at random rather than because it suits anyone.
        if high_rated_vns and budgets["description"] > 0:
            try:
                description_ranked = await self._get_description_candidates(
                    favourites=high_rated_vns,
                    exclude_vn_ids=exclude_vn_ids.union(all_candidate_ids),
                    limit=budgets["description"] * widen,
                    per_seed=DESC_RETRIEVAL_PER_SEED * widen,
                )
                ranked_arms["description"] = description_ranked
                description_candidates = ranked_ids(description_ranked)
                all_candidate_ids.update(description_candidates)
                priority_ids.update(description_candidates)
                record("description", description_candidates)
                logger.info(f"Added {len(description_candidates)} description candidates")
            except Exception as e:
                logger.warning(f"Description candidate lookup failed: {e}")

        # Add co-occurrence candidates - VNs that fans of user's favorites also read
        # This ensures high co-occurrence VNs (with different tag profiles) are considered
        if high_rated_vns and budgets["cooccurrence"] > 0:
            try:
                cooccurrence_ranked = await self._get_cooccurrence_candidates(
                    high_rated_vns=high_rated_vns,
                    exclude_vn_ids=exclude_vn_ids.union(all_candidate_ids),
                    limit=budgets["cooccurrence"] * widen,
                    filters=source_predicates,
                )
                ranked_arms["cooccurrence"] = cooccurrence_ranked
                cooccurrence_candidates = ranked_ids(cooccurrence_ranked)
                all_candidate_ids.update(cooccurrence_candidates)
                priority_ids.update(cooccurrence_candidates)
                record("cooccurrence", cooccurrence_candidates)
                logger.info(f"Added {len(cooccurrence_candidates)} co-occurrence candidates")
            except Exception as e:
                logger.warning(f"Co-occurrence candidate query failed: {e}")

        # An arm per entity signal. Each of the four is scored and carries a weight the
        # reader can move, and until one of these puts a title in the pool that weight can
        # only reorder what the sources above happened to find. Each is one query, asking
        # the reader's own strongest affinities of that kind for titles they have not read.
        #
        # They are counted with the sources that read the reader's list rather than with the
        # broad draw, since every id they name is there because of something the reader
        # rated.
        profile = user_profile or {}
        for name, enabled, weights, counts, arm in (
            (
                "developer",
                DEVELOPER_RETRIEVAL,
                profile.get("preferred_developer_ids"),
                profile.get("dev_id_counts") or profile.get("dev_counts"),
                self._get_developer_candidates,
            ),
            (
                "staff",
                STAFF_RETRIEVAL,
                profile.get("preferred_staff"),
                profile.get("staff_counts"),
                self._get_staff_candidates,
            ),
            (
                "seiyuu",
                SEIYUU_RETRIEVAL,
                profile.get("preferred_seiyuu"),
                profile.get("seiyuu_counts"),
                self._get_seiyuu_candidates,
            ),
            (
                "trait",
                TRAIT_RETRIEVAL,
                profile.get("preferred_traits"),
                profile.get("trait_counts"),
                self._get_trait_candidates,
            ),
        ):
            if not enabled or not weights or budgets[name] <= 0:
                continue
            try:
                entity_ranked = await arm(
                    weights=weights,
                    counts=counts,
                    exclude_vn_ids=exclude_vn_ids.union(all_candidate_ids),
                    limit=budgets[name] * widen,
                    spoiler_level=spoiler_level,
                    filters=source_predicates,
                    seed=seed,
                )
            except Exception as e:
                logger.warning(f"{name} candidate query failed: {e}")
                continue
            ranked_arms[name] = entity_ranked
            entity_candidates = ranked_ids(entity_ranked)
            all_candidate_ids.update(entity_candidates)
            priority_ids.update(entity_candidates)
            record(name, entity_candidates)
            logger.info(f"Added {len(entity_candidates)} {name} candidates")

        self.last_ranked_arms = ranked_arms
        logger.info("Retrieval sources: %s", sources.report())
        return all_candidate_ids, priority_ids, self._source_buckets(source_of, budgets)

    @staticmethod
    def _source_buckets(
        source_of: dict[str, str],
        budgets: dict[str, int],
    ) -> list[tuple[set[str], int]]:
        """The collected union split by source, each with the share that source was given.

        Ordered by the collection order so the split is a function of its inputs alone and
        the cut falls the same way on a repeat request. Sources that found nothing are left
        out: a share reserved for an empty bucket is a slot no candidate can fill.
        """
        grouped: dict[str, set[str]] = {}
        for vn_id, arm in source_of.items():
            grouped.setdefault(arm, set()).add(vn_id)
        return [
            (grouped[arm], max(1, budgets.get(arm, 0)))
            for arm in RETRIEVAL_ARM_ORDER
            if grouped.get(arm)
        ]

    @staticmethod
    def _candidate_columns():
        """The VN columns every candidate row carries into scoring."""
        return (
            VisualNovel.id,
            VisualNovel.title,
            VisualNovel.title_jp,
            VisualNovel.title_romaji,
            VisualNovel.image_url,
            VisualNovel.image_sexual,
            VisualNovel.rating,
            VisualNovel.average_rating,
            VisualNovel.length,
            # Read by the popularity re-ranking, which runs after scoring. Carried on the
            # row scoring already loads rather than fetched separately, so placing a
            # candidate on the popularity range costs no query of its own.
            VisualNovel.votecount,
        )

    @staticmethod
    def _candidate_rows(rows) -> list[dict]:
        return [
            {
                "id": row.id,
                "title": row.title,
                "title_jp": row.title_jp,
                "title_romaji": row.title_romaji,
                "image_url": row.image_url,
                "image_sexual": row.image_sexual,
                "rating": row.rating,
                "average_rating": row.average_rating,
                "length": row.length,
                "votecount": row.votecount,
            }
            for row in rows
        ]

    async def _fetch_candidate_details(
        self,
        *,
        candidate_ids: set[str],
        limit: int,
        predicates: list,
        min_length: Optional[int],
        max_length: Optional[int],
        japanese_only: bool,
        seed: str,
        priority_ids: Optional[set[str]] = None,
        source_buckets: Optional[list[tuple[set[str], int]]] = None,
    ) -> list[dict]:
        """Load the scoring columns for a collected candidate set.

        The filters are repeated here even though the sources already applied them: the
        set arrives as a union of sources, and a source whose query failed contributes ids
        that were never tested against them.

        ``source_buckets`` carries the union split by the source that named each id, with
        the share that source was given. The union is wider than the pool, so without it
        the split decided at collection is undone here: an even slice keeps each source in
        proportion to how many ids it happened to contribute rather than to what the
        request asked for, and a source given a large budget hands most of its find back.

        ``priority_ids`` names the candidates drawn by the sources that read the reader's
        own list, against those drawn broadly. It is consulted only while the priority
        share is set; at zero the cut is source-blind, as it is without it.

        Three shapes of cut are available and they partition the same slots, so a request
        takes one of them: keeping each source's share, reserving a share for the related
        sources, or spreading the pool over the popularity bands. They are tried in that
        order, and where none applies the cut is an even slice.
        """
        query = select(*self._candidate_columns()).where(
            VisualNovel.id.in_(candidate_ids)
        )

        # Apply filters
        if min_length is not None:
            query = query.where(VisualNovel.length >= min_length)
        if max_length is not None:
            query = query.where(VisualNovel.length <= max_length)
        if japanese_only:
            query = query.where(VisualNovel.olang == "ja")
        query = self._restrict_to_filters(query, predicates)

        # No popularity ordering - let the scoring decide. The collected set can still
        # overflow the limit, so the cut runs on a salted digest: it takes an even slice of
        # the pool without letting rating or age decide who reaches the scorer, and it falls
        # the same way on a repeat request. Its domain differs from the one the exploration
        # slice was drawn with, so that slice competes for a place here like any other source.
        shuffle = stable_shuffle_order(VisualNovel.id, seed, "candidate_cut")
        share = CANDIDATE_CUT_PRIORITY_SHARE
        band_shares = CANDIDATE_CUT_BAND_SHARES

        if CANDIDATE_CUT_BY_SOURCE and source_buckets and len(source_buckets) > 1:
            # Each source ranked within its own find and served its share of the pool
            # first, so the split the request chose survives the narrowing. Rows past a
            # source's quota keep their place behind the served ones, so a source holding
            # fewer ids than its share hands the remainder to the rest rather than
            # shortening the pool.
            bucket = case(
                *(
                    (in_ids(VisualNovel.id, ids), index)
                    for index, (ids, _) in enumerate(source_buckets)
                ),
                else_=len(source_buckets),
            )
            ranked = query.add_columns(
                bucket.label("bucket"),
                func.row_number()
                .over(partition_by=bucket, order_by=shuffle)
                .label("in_bucket"),
            ).subquery()
            quotas = allocate_shares(limit, tuple(size for _, size in source_buckets))
            quota = case(
                *(
                    (ranked.c.bucket == index, value)
                    for index, value in enumerate(quotas)
                ),
                else_=0,
            )
            cut = (
                select(ranked)
                .order_by(
                    case((ranked.c.in_bucket <= quota, 0), else_=1),
                    ranked.c.bucket,
                    ranked.c.in_bucket,
                )
                .limit(limit)
            )
            result = await self.db.execute(cut)
            return self._candidate_rows(result.all())

        if band_shares and (share <= 0 or not priority_ids):
            # Each band ranked within itself and served its share first, so which part of
            # the popularity range the scorer is offered is set here rather than left to
            # whichever bands the sources happened to reach. Rows past a band's quota keep
            # their place behind the served ones, so a band with fewer titles than its
            # share hands the remainder to the rest instead of shortening the pool.
            band = popularity_band_expression()
            ranked = query.add_columns(
                band.label("band"),
                func.row_number()
                .over(partition_by=band, order_by=shuffle)
                .label("in_band"),
            ).subquery()
            quotas = allocate_shares(limit, band_shares)
            quota = case(
                *(
                    (ranked.c.band == index, value)
                    for index, value in enumerate(quotas)
                ),
                else_=0,
            )
            cut = (
                select(ranked)
                .order_by(
                    case((ranked.c.in_band <= quota, 0), else_=1),
                    ranked.c.in_band,
                    ranked.c.band,
                )
                .limit(limit)
            )
            result = await self.db.execute(cut)
            return self._candidate_rows(result.all())

        if share <= 0 or not priority_ids:
            query = query.order_by(*shuffle).limit(limit)
            result = await self.db.execute(query)
            return self._candidate_rows(result.all())

        # An even slice of the union is a slice in proportion to how many ids each source
        # contributed, which is not what any of them is worth: the broad draws are the
        # largest and the least specific to this reader. Each bucket is ranked within
        # itself and served its share first, so neither can be crowded out. Whatever a
        # bucket leaves unclaimed falls to the other, since an unfilled reservation is a
        # smaller pool rather than a better one.
        bucket = case((in_ids(VisualNovel.id, priority_ids), 0), else_=1)
        ranked = query.add_columns(
            bucket.label("bucket"),
            func.row_number()
            .over(partition_by=bucket, order_by=shuffle)
            .label("in_bucket"),
        ).subquery()
        reserved = max(1, min(limit, round(limit * share)))
        quota = case((ranked.c.bucket == 0, reserved), else_=limit - reserved)
        cut = (
            select(ranked)
            .order_by(
                case((ranked.c.in_bucket <= quota, 0), else_=1),
                ranked.c.bucket,
                ranked.c.in_bucket,
            )
            .limit(limit)
        )

        result = await self.db.execute(cut)
        return self._candidate_rows(result.all())

    async def _quality_candidates(
        self,
        *,
        exclude_vn_ids: set[str],
        limit: int,
        predicates: list,
        min_length: Optional[int],
        max_length: Optional[int],
        japanese_only: bool,
    ) -> list[dict]:
        """Matching titles ranked by rating alone, for when no source can fill the page."""
        query = select(*self._candidate_columns()).where(VisualNovel.rating.isnot(None))

        if exclude_vn_ids:
            query = query.where(not_in_ids(VisualNovel.id, exclude_vn_ids))
        if min_length is not None:
            query = query.where(VisualNovel.length >= min_length)
        if max_length is not None:
            query = query.where(VisualNovel.length <= max_length)
        if japanese_only:
            query = query.where(VisualNovel.olang == "ja")
        query = self._restrict_to_filters(query, predicates)

        # Order by rating for fallback (better than random); the id breaks rating ties
        # so the same filters always cut the list in the same place.
        query = query.order_by(VisualNovel.rating.desc(), VisualNovel.id)
        query = query.limit(limit)

        result = await self.db.execute(query)
        return self._candidate_rows(result.all())

    async def _apply_content_filters(
        self,
        candidates: list[dict],
        *,
        include_tags: Optional[list[int]],
        exclude_tags: Optional[list[int]],
        include_traits: Optional[list[int]],
        exclude_traits: Optional[list[int]],
        spoiler_level: int,
    ) -> list[dict]:
        """Apply the tag and trait filters, which are matched per candidate.

        Unlike the rest of the vocabulary these subtract from a pool that was chosen
        without them, so a narrow tag leaves a short list. The widening passes above exist
        to give that subtraction a bigger pool to work on.
        """
        if not candidates:
            return candidates
        if include_tags or exclude_tags:
            candidates = await self._filter_by_tags(
                candidates, include_tags, exclude_tags, spoiler_level=spoiler_level
            )
        if include_traits or exclude_traits:
            candidates = await self._filter_by_traits(
                candidates, include_traits, exclude_traits, spoiler_level=spoiler_level
            )
        return candidates

    async def _filter_by_tags(
        self,
        candidates: list[dict],
        include_tags: Optional[list[int]],
        exclude_tags: Optional[list[int]],
        spoiler_level: int = 0,
    ) -> list[dict]:
        """Filter candidates by tag requirements."""
        if not include_tags and not exclude_tags:
            return candidates

        # Only the filtered tags matter here, so the query is narrowed to them rather than
        # loading every tag on every candidate.
        relevant_tags = set(include_tags or []) | set(exclude_tags or [])
        vn_ids = [vn["id"] for vn in candidates]

        result = await self.db.execute(
            select(VNTag.vn_id, VNTag.tag_id)
            .where(VNTag.vn_id.in_(vn_ids))
            .where(VNTag.tag_id.in_(relevant_tags))
            .where(VNTag.spoiler_level <= spoiler_level)
            .where(VNTag.score > 0)
            .where(VNTag.lie == False)  # exclude disputed/incorrect tags
        )

        vn_tags: dict[str, set[int]] = {}
        for vn_id, tag_id in result.all():
            vn_tags.setdefault(vn_id, set()).add(tag_id)

        include_set = set(include_tags) if include_tags else None
        exclude_set = set(exclude_tags) if exclude_tags else None

        filtered = []
        for vn in candidates:
            vn_tag_ids = vn_tags.get(vn["id"], set())

            # Check include tags (VN must have at least one)
            if include_set and not vn_tag_ids & include_set:
                continue

            # Check exclude tags (VN must not have any)
            if exclude_set and vn_tag_ids & exclude_set:
                continue

            filtered.append(vn)

        return filtered

    async def _filter_by_traits(
        self,
        candidates: list[dict],
        include_traits: Optional[list[int]],
        exclude_traits: Optional[list[int]],
        spoiler_level: int = 0,
    ) -> list[dict]:
        """Filter candidates by character trait requirements.

        Traits are linked to characters, not directly to VNs, so we need to:
        1. Get all characters for each VN
        2. Get all traits for those characters
        3. Check if the VN matches the trait requirements
        """
        if not include_traits and not exclude_traits:
            return candidates

        # Get all VN IDs we need to check
        vn_ids = [vn["id"] for vn in candidates]

        # Batch query: get trait IDs for each VN through character relationships
        # VN -> CharacterVN -> CharacterTrait -> trait_id
        query = (
            select(CharacterVN.vn_id, CharacterTrait.trait_id)
            .join(CharacterTrait, CharacterVN.character_id == CharacterTrait.character_id)
            .where(CharacterVN.vn_id.in_(vn_ids))
            .where(CharacterTrait.spoiler_level <= spoiler_level)
        )
        result = await self.db.execute(query)

        # Build a map of vn_id -> set of trait_ids
        vn_traits: dict[str, set[int]] = {}
        for row in result.all():
            vn_id = row[0]
            trait_id = row[1]
            if vn_id not in vn_traits:
                vn_traits[vn_id] = set()
            vn_traits[vn_id].add(trait_id)

        # Filter candidates
        filtered = []
        for vn in candidates:
            vn_trait_ids = vn_traits.get(vn["id"], set())

            # Check include traits (VN must have at least one character with the trait)
            if include_traits:
                if not vn_trait_ids.intersection(set(include_traits)):
                    continue

            # Check exclude traits (VN must not have any character with the trait)
            if exclude_traits:
                if vn_trait_ids.intersection(set(exclude_traits)):
                    continue

            filtered.append(vn)

        return filtered

    async def _compute_tag_score(self, user_profile: dict, vn_id: str) -> float:
        """
        Compute tag similarity score between user profile and VN.

        Uses cosine similarity between:
        - User's weighted tag preferences
        - VN's tag vector
        """
        user_tags = user_profile["tag_weights"]
        if not user_tags:
            return 0.0

        vn_tags = await self._get_vn_tags(vn_id)
        if not vn_tags:
            return 0.0

        # Compute dot product (cosine similarity numerator)
        dot_product = 0.0
        for tag_id, vn_score in vn_tags.items():
            if tag_id in user_tags:
                dot_product += user_tags[tag_id] * vn_score

        # Compute magnitudes
        user_magnitude = np.sqrt(sum(v ** 2 for v in user_tags.values()))
        vn_magnitude = np.sqrt(sum(v ** 2 for v in vn_tags.values()))

        if user_magnitude == 0 or vn_magnitude == 0:
            return 0.0

        # Cosine similarity
        similarity = dot_product / (user_magnitude * vn_magnitude)

        # Normalize to 0-1 range (similarity can be negative)
        return max(0.0, min(1.0, (similarity + 1) / 2))

    async def _compute_collab_score(
        self, user_votes: list[dict], vn_id: str
    ) -> float:
        """
        Compute collaborative filtering score.

        Finds users who highly rated the same VNs as this user,
        then checks if they also highly rated the candidate VN.
        """
        # Get user's highly rated VNs
        high_rated = [
            v.get("vn_id") or v.get("id")
            for v in user_votes
            if (v.get("score") or v.get("vote", 0)) >= 85
        ]

        if not high_rated:
            return 0.0

        try:
            # Find users who also rated these VNs highly
            similar_users_query = (
                select(GlobalVote.user_hash)
                .where(GlobalVote.vn_id.in_(high_rated))
                .where(GlobalVote.vote >= 85)
                .group_by(GlobalVote.user_hash)
                .having(func.count(GlobalVote.vn_id) >= 2)  # At least 2 overlapping
                .limit(100)
            )
            result = await self.db.execute(similar_users_query)
            similar_users = [row.user_hash for row in result.all()]

            if not similar_users:
                return 0.0

            # Check if these users rated the candidate VN
            votes_query = (
                select(func.avg(GlobalVote.vote), func.count(GlobalVote.vote))
                .where(GlobalVote.vn_id == vn_id)
                .where(GlobalVote.user_hash.in_(similar_users))
            )
            result = await self.db.execute(votes_query)
            row = result.first()

            if not row or row[1] == 0:
                return 0.0

            avg_vote = row[0]
            vote_count = row[1]

            # Score based on average vote and confidence (vote count)
            # Normalize to 0-1 range
            base_score = (avg_vote - 50) / 50  # -1 to 1
            confidence = min(1.0, vote_count / 10)  # Max confidence at 10 votes

            return max(0.0, base_score * confidence)

        except Exception as e:
            logger.warning(f"Collab score failed for {vn_id}: {e}")
            return 0.0

    async def _compute_staff_score(
        self, user_votes: list[dict], vn_id: str
    ) -> float:
        """
        Compute staff/developer match score.

        Gives bonus if VN shares staff/developers with user's favorites.
        """
        # Get user's high-rated VNs
        high_rated = [
            v.get("vn_id") or v.get("id")
            for v in user_votes
            if (v.get("score") or v.get("vote", 0)) >= 85
        ]

        if not high_rated:
            return 0.0

        # Get staff and developers from user's favorites
        user_staff = set()
        user_developers = set()
        for rated_vn_id in high_rated[:20]:  # Limit for performance
            staff = await self._get_vn_staff(rated_vn_id)
            user_staff.update(staff)
            developers = await self._get_vn_developers(rated_vn_id)
            user_developers.update(developers)

        if not user_staff and not user_developers:
            return 0.0

        # Check candidate VN's staff/developers
        vn_staff = set(await self._get_vn_staff(vn_id))
        vn_developers = set(await self._get_vn_developers(vn_id))

        staff_overlap = len(user_staff.intersection(vn_staff))
        developer_overlap = len(user_developers.intersection(vn_developers))

        # Score based on overlap
        score = 0.0
        if developer_overlap > 0:
            score += 0.5  # Developer match is strong signal
        if staff_overlap > 0:
            score += min(0.5, staff_overlap * 0.1)  # Staff matches add up

        return min(1.0, score)


async def _build_technical_tags() -> set[int]:
    async with async_session() as db:
        result = await db.execute(select(Tag.id).where(Tag.category == "tech"))
        return {row.id for row in result.all()}


async def _build_tag_idf() -> dict[int, float]:
    async with async_session() as db:
        total_result = await db.execute(select(func.count(VisualNovel.id)))
        total_vns = total_result.scalar_one_or_none() or 1

        result = await db.execute(select(Tag.id, Tag.vn_count).where(Tag.vn_count > 0))
        rows = result.all()

    weights: dict[int, float] = {}
    for row in rows:
        # IDF formula: log(N / df) where df = document frequency (vn_count)
        idf = math.log(total_vns / (row.vn_count + 1))
        # Floor at 0.1 to prevent near-zero weights for very common tags
        weights[row.id] = max(0.1, idf)
    return weights


_TECHNICAL_TAGS: DailyValue[set[int]] = DailyValue(_build_technical_tags)
_TAG_IDF: DailyValue[dict[int, float]] = DailyValue(_build_tag_idf)


async def get_recommendations_for_user(
    db: AsyncSession,
    vndb_uid: str,
    user_votes: list[dict],
    exclude_vn_ids: set[str],
    limit: int = 50,
    **filters
) -> list[RecommendationResult]:
    """
    Convenience function to get recommendations for a user.

    Args:
        db: Database session
        vndb_uid: User's VNDB ID (for logging)
        user_votes: User's VN ratings
        exclude_vn_ids: VNs to exclude
        limit: Max results
        **filters: Additional filters (min_rating, min_length, etc)

    Returns:
        List of recommendations
    """
    recommender = HybridRecommender(db)

    try:
        results = await recommender.recommend(
            user_votes=user_votes,
            exclude_vn_ids=exclude_vn_ids,
            limit=limit,
            **filters
        )
        logger.info(f"Generated {len(results)} recommendations for {vndb_uid}")
        return results
    except Exception as e:
        logger.error(f"Recommendation failed for {vndb_uid}: {e}")
        return []
