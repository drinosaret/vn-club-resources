"""
Recommendation endpoints.

============================================================================
DATA SOURCE: LOCAL POSTGRESQL DATABASE + PRECOMPUTED MODELS
============================================================================
Recommendations are generated from the LOCAL PostgreSQL database, which is
populated daily from VNDB database dumps, using the hybrid recommender's
blend of tag, collaborative, staff/seiyuu/producer affinity, and VN-VN
similarity signals.

>>> DO NOT add VNDB API calls for recommendation features <<<

The only VNDB API usage is in UserService for fetching the user's
current VN list (to know what they've played/rated).
============================================================================

Routes:
- GET /presets: the signal weights, limits, named vectors, and named lists
  a caller may use.
- GET /{vndb_uid}/v2: personalized recommendations from the hybrid
  recommender, with filtering, signal-list selection, and caching.
- GET /{vndb_uid}/v2/details/{vn_id}: the detailed per-signal breakdown for
  a single recommended title.
"""

import asyncio
import logging
import time
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.db.database import get_db

# Rate limiter for expensive recommendation endpoints
limiter = Limiter(key_func=get_remote_address)
from app.db.models import SystemMetadata, UserRecommendationCache, VisualNovel, VNDifficulty
from app.db.query_utils import in_ids, not_in_ids
from app.db.vn_filters import (
    FilterListTooLong,
    MAX_FILTER_IDS,
    VNFilterSpec,
    parse_vn_filters,
    AVERAGE_RATING,
    vn_filter_predicates,
)
from app.core.auth import is_admin_request
from app.core.cache import get_cache
from app.core.concurrency import Ceiling
from app.services.recommendation_cache import build_cache_records, write_user_page
from app.services import hybrid_recommender as engine_switches
from app.services.recommendation_relations import (
    CONTINUATION_LIMIT,
    continuations,
    related_to,
)
from app.services.user_service import UserService
from app.services.hybrid_recommender import (
    AGGREGATION,
    HybridRecommender,
    RecommendationResult,
    normalize_score,
    status_predicates,
)
from app.services.recommendation_filters import (
    LABEL_DROPPED,
    compute_exclude_vn_ids,
    finished_votes,
)
from app.services.recommendation_lists import (
    COMBINED,
    LIST_NAMES,
    SignalList,
    UnknownList,
    list_catalogue,
    order_by_signal,
    parse_list,
    reason_from,
    single_signal_weights,
    strongest_reason,
)
from app.services.recommendation_weights import (
    InvalidSignalWeights,
    WeightSelection,
    parse_signal_weights,
    preset_catalogue,
)

logger = logging.getLogger(__name__)

# Cache configuration
CACHE_TTL_HOURS = 24  # Consider cache fresh for 24 hours

# A page at or above this size stands in, in tests and comments, for "a typical full
# request"; the actual write and read gating scores against CACHED_PAGE_ROWS below.
CACHED_PAGE_LIMIT = 100

# Rows the request path scores and stores when it will write the cache. Larger than the
# page a request asks for so a filtered read of the stored page still has enough rows to
# answer from, and the same size the precompute writes so the two writers agree.
CACHED_PAGE_ROWS = 200

# Share of the requested page a filtered read of the cache has to fill before it is
# served rather than recomputed. Below it the filter has cut the stored page to a stub
# and the whole catalogue is worth searching.
FILTERED_CACHE_SHARE = 0.5

# Sequels the continuation strip is drawn from before the request's filters cut it. The
# strip shows CONTINUATION_LIMIT of them; drawing wider leaves a full strip where a filter
# removes some of the best candidates.
CONTINUATION_DRAW = 30

#: Recommendation pages scored at once.
#:
#: A request that neither cache can answer runs the whole recommender, which is measured in
#: seconds. A request naming a discovery level or its own weights is never cached, and its
#: value space is unbounded, so such requests can be issued one after another; this is what
#: keeps enough of them arriving together from occupying every worker. A page answered from
#: a cache returns before reaching it.
_RECS_CEILING = Ceiling(slots=4, wait_seconds=15.0, what="recommendation pages")


def cache_fills_page(*, cached: int, limit: int, filters_active: bool, page_limit: int) -> bool:
    """Whether the rows read from the cache are a complete enough answer."""
    if filters_active:
        return cached >= max(1, int(limit * FILTERED_CACHE_SHARE))
    return cached >= limit or cached < page_limit


def cache_cutoff(now: datetime, last_import: Optional[datetime]) -> datetime:
    """Rows older than this are not served.

    The later of the read TTL and the last import: a page scored against yesterday's
    catalogue is stale the moment today's lands, however young it is.
    """
    ttl_cutoff = now - timedelta(hours=CACHE_TTL_HOURS)
    if last_import is not None:
        # A stamp ahead of the clock (clock skew between the writer and this process)
        # must not push the cutoff into the future and reject every row.
        last_import = min(last_import, now)
        if last_import > ttl_cutoff:
            return last_import
    return ttl_cutoff


def scored_limit(*, limit: int, will_cache: bool) -> int:
    """How many rows to score: the page asked for, or the cache page when writing one."""
    return max(limit, CACHED_PAGE_ROWS) if will_cache else limit


# A signal list is never written to the page table, which holds one page per reader, so
# it is held in Redis for the life of the dump instead. Keyed on everything that decides
# the answer: the reader, the list, the page size, the spoiler level, and whether the
# reader's blacklist is kept off the page, since that decides the candidate set the list
# is drawn from. Under a prefix the import flushes.
LIST_CACHE_TTL_SECONDS = 24 * 3600


def list_cache_key(
    vndb_uid: str,
    list_name: str,
    limit: int,
    spoiler_level: int,
    exclude_blacklist: bool = True,
) -> str:
    return (
        f"rec:list:{vndb_uid}:{list_name}:{limit}:{spoiler_level}:{int(exclude_blacklist)}"
    )


def parse_import_stamp(value: str) -> Optional[datetime]:
    """Parse a stored import timestamp to naive UTC.

    The stamp is written by more than one job and not all of them agree on the
    form: some write a naive local-clock value, others a timezone-aware one.
    A timezone-aware value is converted so every caller compares against the
    same naive-UTC shape.
    """
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed


async def last_import_time(db: AsyncSession) -> Optional[datetime]:
    """When the catalogue last changed, or None where nothing has recorded it."""
    value = (
        await db.execute(select(SystemMetadata.value).where(SystemMetadata.key == "last_import"))
    ).scalar_one_or_none()
    if not value:
        return None
    return parse_import_stamp(value)


# Strong references to fire-and-forget writers. A task the event loop holds no reference
# to can be collected mid-run, which drops the cache write silently.
_background_tasks: set[asyncio.Task] = set()


async def title_facts(db: AsyncSession, vn_ids: list[str]) -> dict[str, dict]:
    """Release year, length and difficulty band per title, in one query.

    Facts about the title rather than about the match, so they are read the same way on a
    computed page and a cached one. Difficulty exists only for analysed titles; the rest
    carry None, which the client renders as absent rather than as easy.
    """
    if not vn_ids:
        return {}
    rows = (
        await db.execute(
            select(
                VisualNovel.id,
                VisualNovel.released,
                VisualNovel.length,
                VisualNovel.length_minutes,
                VNDifficulty.difficulty,
            )
            .outerjoin(VNDifficulty, VNDifficulty.vn_id == VisualNovel.id)
            .where(in_ids(VisualNovel.id, vn_ids))
        )
    ).all()
    return {
        row.id: {
            "year": row.released.year if row.released else None,
            "length": row.length,
            "length_minutes": row.length_minutes,
            "difficulty": row.difficulty,
        }
        for row in rows
    }


router = APIRouter()


def resolve_signal_weights(raw: Optional[str]) -> Optional[WeightSelection]:
    """Read the `weights` parameter, turning a vector that cannot be read into a 400.

    A caller naming the defaults is not naming anything: the selection is returned either
    way, and `is_custom` is what the request path branches on, so an ordinary request
    stays ordinary however it was spelled.
    """
    try:
        return parse_signal_weights(raw)
    except InvalidSignalWeights as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# Declared before the routes that take a user id, since a bare path segment would
# otherwise be read as one.
@router.get("/presets")
async def get_weight_presets():
    """The signal weights a caller may set, their limits, the named vectors on offer, and
    the named lists the v2 endpoint serves.

    Published so every client offers the same set under the same names, and so a link
    carrying weights or a list means the same thing wherever it is opened.

    `enabled` says whether reader tuning is switched on at all. While it is false the
    `weights` parameter is ignored rather than refused, so a client offers the controls
    only when this says it may. `lists` is unaffected by it: a list is a view of the same
    page rather than a balance a reader set, and each entry pairs the token the `list`
    parameter takes with the signal it appears under in `scores` and `ranked_in`.
    """
    catalogue = preset_catalogue()
    catalogue["lists"] = list_catalogue()
    return catalogue


# ============ New Simplified Hybrid Endpoint ============


async def get_cached_recommendations(
    db: AsyncSession,
    user_id: str,
    exclude_vn_ids: set[str],
    limit: int,
    min_length: Optional[int] = None,
    max_length: Optional[int] = None,
    japanese_only: bool = True,
    filters: Optional[VNFilterSpec] = None,
    *,
    cutoff: datetime,
) -> tuple[list[dict], bool]:
    """
    Try to get recommendations from cache.

    The cache stores a score per title, not the pool it was drawn from, so any filter that
    is a predicate over a visual novel can be applied to the cached rows: the join to
    ``visual_novels`` is already here, and dropping a row cannot change what the rows that
    remain are worth. That covers the whole shared filter vocabulary, so filtered requests
    stay servable from cache. Filters that change how a title scores, rather than whether
    it qualifies, cannot be applied this way and force a recompute instead.

    Returns:
        (recommendations, is_from_cache)
    """
    # Query cached recommendations with VN details
    query = (
        select(
            UserRecommendationCache.vn_id,
            UserRecommendationCache.combined_score,
            UserRecommendationCache.tag_score,
            UserRecommendationCache.cf_score,
            UserRecommendationCache.hgat_score,
            UserRecommendationCache.users_also_read_score,
            UserRecommendationCache.developer_score,
            UserRecommendationCache.seiyuu_score,
            UserRecommendationCache.trait_score,
            UserRecommendationCache.quality_score,
            UserRecommendationCache.description_score,
            UserRecommendationCache.reason,
            UserRecommendationCache.confidence,
            UserRecommendationCache.predicted_rating,
            UserRecommendationCache.predicted_low,
            UserRecommendationCache.predicted_high,
            UserRecommendationCache.updated_at,
            VisualNovel.title,
            VisualNovel.title_jp,
            VisualNovel.title_romaji,
            VisualNovel.image_url,
            VisualNovel.image_sexual,
            VisualNovel.rating,
            VisualNovel.average_rating,
            VisualNovel.length,
        )
        .join(VisualNovel, UserRecommendationCache.vn_id == VisualNovel.id)
        .where(UserRecommendationCache.user_id == user_id)
        .where(UserRecommendationCache.updated_at >= cutoff)
        .where(not_in_ids(UserRecommendationCache.vn_id, exclude_vn_ids))
    )

    # Apply filters
    if min_length is not None:
        query = query.where(VisualNovel.length >= min_length)
    if max_length is not None:
        query = query.where(VisualNovel.length <= max_length)
    if japanese_only:
        query = query.where(VisualNovel.olang == "ja")
    if filters is not None:
        query = query.where(*vn_filter_predicates(filters, rating_column=AVERAGE_RATING))
    # A page cached before this default existed can hold an unfinished title, so the
    # clause is applied here too rather than trusted to have been true at write time.
    query = query.where(*status_predicates(filters if filters is not None else VNFilterSpec(nsfw=True)))

    # The stored order, not the score order. What the engine returns is a selection made
    # after scoring, by the diversity pass and by the popularity pass where that is on,
    # so re-sorting on `combined_score` would serve the chosen set in an order the engine
    # never produced. A row that carries no position sorts after the ranked ones, on score.
    query = query.order_by(
        UserRecommendationCache.rank.asc().nulls_last(),
        UserRecommendationCache.combined_score.desc(),
    )
    query = query.limit(limit)

    result = await db.execute(query)
    rows = result.all()

    if not rows:
        return [], False

    # A page written before the prediction was stored has none to show while every
    # computed page does. While the prediction is on, such a page is a miss: it is
    # recomputed once, and the rewrite carries the figure from then on.
    if engine_switches.PREDICTED_RATING and all(row.predicted_rating is None for row in rows):
        return [], False

    # Format cached results
    recommendations = []
    for row in rows:
        # Build match reasons from scores
        reasons = []
        if row.tag_score and row.tag_score > 0.3:
            reasons.append("Similar tags")
        if row.cf_score and row.cf_score > 0.3:
            reasons.append("Liked by similar users")
        if row.hgat_score and row.hgat_score > 0.3:
            reasons.append("Same developer/writer")
        if row.description_score and row.description_score > 0.5:
            reasons.append("Reads like your favorites")

        recommendations.append({
            "vn_id": row.vn_id,
            "title": row.title,
            # Omitted where it repeats the title, which it does for most Japanese titles.
            "title_jp": row.title_jp if row.title_jp != row.title else None,
            "title_romaji": row.title_romaji,
            "score": round(row.combined_score, 3),
            # Under the fusion aggregation the page's figure is the stored agreement, so
            # a cached page reports the number the run produced. Under any other
            # aggregation the fresh page reports the score-derived figure and sets the
            # agreement only on the side, and so does this; the same fallback serves rows
            # written before the agreement was stored.
            "normalized_score": (
                row.confidence
                if row.confidence is not None and AGGREGATION == "fusion"
                else normalize_score(row.combined_score)
            ),
            "confidence": row.confidence,
            # The same block the fresh path emits, minus the per-signal marks behind it,
            # which only the detail view reads and which it fetches fresh. Absent on rows
            # written before the prediction was stored, or by a run with it switched off.
            **(
                {
                    "predicted_rating": {
                        "mean": round(row.predicted_rating, 2),
                        "low": (
                            round(row.predicted_low, 2)
                            if row.predicted_low is not None
                            else None
                        ),
                        "high": (
                            round(row.predicted_high, 2)
                            if row.predicted_high is not None
                            else None
                        ),
                    }
                }
                if row.predicted_rating is not None
                else {}
            ),
            # The structured reason below is what the card reads; the strings here are a
            # rebuilt approximation and are kept only so both paths return the same keys.
            "match_reasons": reasons if reasons else ["Matches your preferences"],
            "image_url": row.image_url,
            "image_sexual": row.image_sexual,
            # The average across everyone who voted, which is the figure the fresh page
            # carries and the one the card names. The Bayesian column stands in where no
            # average is recorded, and is itself absent below the vote threshold.
            "rating": row.average_rating or row.rating,
            # What the card says put this title on the page, as the run that wrote the row
            # worked it out. Null on a row written by a writer that scored without
            # computing details, and on rows predating the column.
            "reason": row.reason,
            "scores": {
                name: round(value, 3)
                for name, value in (
                    ("tag", row.tag_score or 0),
                    ("similar_games", row.cf_score or 0),
                    ("users_also_read", row.users_also_read_score or 0),
                    ("developer", row.developer_score or 0),
                    ("staff", row.hgat_score or 0),
                    ("seiyuu", row.seiyuu_score or 0),
                    ("trait", row.trait_score or 0),
                    ("quality", row.quality_score or 0),
                    ("description", row.description_score or 0),
                )
                if value
            }
        })

    return recommendations, True


def resolve_filter_overlaps(
    filters: VNFilterSpec,
    min_length: Optional[int],
    max_length: Optional[int],
    japanese_only: bool,
) -> tuple[Optional[int], Optional[int], bool]:
    """Settle the two axes this endpoint can describe twice.

    Length arrives either as named buckets, which read the recorded play time where it
    exists, or as a range over the coarse 1-5 column. They are two definitions of one
    axis, so intersecting them produces a set that answers neither question; the named
    buckets are the vocabulary shared with the search page, so they win outright and the
    range applies only in their absence.

    Original language arrives either as a list of codes or as the Japanese-only shorthand,
    and the same reasoning applies: an explicit list of languages says what is wanted, so
    the shorthand steps aside rather than intersecting with it and emptying the result.

    Returns the length range and language shorthand that survive.
    """
    if filters.length or filters.exclude_length:
        min_length = None
        max_length = None
    if filters.olang:
        japanese_only = False
    return min_length, max_length, japanese_only


async def filter_continuations(
    db: AsyncSession,
    entries: list[dict],
    *,
    filters: VNFilterSpec,
    min_length: Optional[int],
    max_length: Optional[int],
    limit: int = CONTINUATION_LIMIT,
) -> list[dict]:
    """The strip's entries that also satisfy the request's filters, in the order given.

    The strip is drawn from the reader's own list rather than from the scored page, so the
    filters the page was answered under reach it only here. A control that keeps adult
    titles off the results has to keep them off the strip above them as well, and a strip
    drawn from outside a named year, length or language contradicts the page it sits on.
    """
    if not entries:
        return []
    predicates = vn_filter_predicates(filters, rating_column=AVERAGE_RATING)
    if min_length is not None:
        predicates.append(VisualNovel.length >= min_length)
    if max_length is not None:
        predicates.append(VisualNovel.length <= max_length)
    if not predicates:
        return entries[:limit]
    ids = [entry["vn_id"] for entry in entries]
    rows = await db.execute(
        select(VisualNovel.id).where(in_ids(VisualNovel.id, ids)).where(*predicates)
    )
    allowed = set(rows.scalars().all())
    return [entry for entry in entries if entry["vn_id"] in allowed][:limit]


async def cache_recommendations_async(
    user_id: str,
    results: list[RecommendationResult],
    reasons: Optional[dict[str, dict]] = None,
):
    """Cache recommendations in the background (non-blocking).

    Writes in a session of its own, so the request session is not held open for it. The
    write is the reader's whole page, replacing what they had.

    The reasons travel with the scores because a card shows both and only one of them can
    be recovered from a stored row.
    """
    if not results:
        return

    records = build_cache_records(user_id, results, datetime.utcnow(), reasons)

    try:
        await write_user_page(user_id, records)
    except Exception as exc:
        # A page that fails to persist costs the next request a recompute; one that fails
        # every time is worth knowing about.
        logger.error(f"Recommendation cache write failed for {user_id}: {exc}")


# A reader who changes a filter and then opens every signal list in turn issues on the
# order of twenty requests within a minute; the limit sits well above one session's
# worth so that browsing pattern never trips it. What a request costs the machine is
# bounded by _RECS_CEILING instead, which only the uncached path reaches.
@router.get("/{vndb_uid}/v2")
@limiter.limit("60/minute")
async def get_recommendations_v2(
    request: Request,
    vndb_uid: str,
    list_name: str = Query(
        default=COMBINED,
        alias="list",
        description=(
            "Which list to serve. The default blends every signal; any other name serves "
            "that one signal's own ranking. See /recommendations/presets for the names "
            "and the signal each one ranks on. Names: " + ", ".join(LIST_NAMES)
        ),
    ),
    limit: int = Query(default=50, ge=1, le=200, description="Number of recommendations"),
    min_rating: Optional[float] = Query(default=None, description="Minimum global rating"),
    min_length: Optional[int] = Query(default=None, ge=1, le=5, description="Minimum length (1-5)"),
    max_length: Optional[int] = Query(default=None, ge=1, le=5, description="Maximum length (1-5)"),
    include_tags: Optional[str] = Query(default=None, description="Comma-separated tag IDs to include"),
    exclude_tags: Optional[str] = Query(default=None, description="Comma-separated tag IDs to exclude"),
    include_traits: Optional[str] = Query(default=None, description="Comma-separated trait IDs to include"),
    exclude_traits: Optional[str] = Query(default=None, description="Comma-separated trait IDs to exclude"),
    skip_cache: bool = Query(default=False, description="Force fresh computation, bypass cache"),
    include_details: bool = Query(default=False, description="Include full details for popup (slower)"),
    japanese_only: bool = Query(default=True, description="Only show Japanese original language VNs"),
    spoiler_level: int = Query(default=0, ge=0, le=2, description="Max tag/trait spoiler level: 0=none, 1=minor, 2=major"),
    exclude_blacklist: bool = Query(default=True, description="Exclude VNs on the user's VNDB blacklist"),
    year_min: Optional[int] = Query(default=None, description="Earliest release year"),
    year_max: Optional[int] = Query(default=None, description="Latest release year"),
    max_rating: Optional[float] = Query(default=None, ge=0, le=10, description="Maximum global rating (exclusive)"),
    min_votecount: Optional[int] = Query(default=None, ge=0, description="Minimum VNDB vote count"),
    max_votecount: Optional[int] = Query(default=None, ge=0, description="Maximum VNDB vote count"),
    min_difficulty: Optional[float] = Query(default=None, ge=0, le=10, description="Minimum reading difficulty; restricts to analysed titles"),
    max_difficulty: Optional[float] = Query(default=None, ge=0, le=10, description="Maximum reading difficulty; restricts to analysed titles"),
    length: Optional[str] = Query(default=None, description="Comma-separated length buckets: very_short, short, medium, long, very_long"),
    exclude_length: Optional[str] = Query(default=None, description="Comma-separated length buckets to exclude"),
    minage: Optional[str] = Query(default=None, description="Comma-separated age brackets: all_ages, teen, adult"),
    exclude_minage: Optional[str] = Query(default=None, description="Comma-separated age brackets to exclude"),
    devstatus: Optional[str] = Query(default=None, description="Comma-separated development status codes"),
    exclude_devstatus: Optional[str] = Query(default=None, description="Comma-separated development status codes to exclude"),
    olang: Optional[str] = Query(default=None, description="Comma-separated original language codes; overrides japanese_only"),
    exclude_olang: Optional[str] = Query(default=None, description="Comma-separated original language codes to exclude"),
    platform: Optional[str] = Query(default=None, description="Comma-separated VNDB platform codes"),
    exclude_platform: Optional[str] = Query(default=None, description="Comma-separated VNDB platform codes to exclude"),
    staff: Optional[str] = Query(default=None, description="Comma-separated staff IDs"),
    seiyuu: Optional[str] = Query(default=None, description="Comma-separated voice actor IDs"),
    developer: Optional[str] = Query(default=None, description="Comma-separated developer IDs"),
    publisher: Optional[str] = Query(default=None, description="Comma-separated publisher IDs"),
    producer: Optional[str] = Query(default=None, description="Comma-separated producer IDs (developer or publisher)"),
    nsfw: bool = Query(default=True, description="Include adult titles"),
    discovery: Optional[float] = Query(
        default=None, ge=0.0, le=1.0,
        description=(
            "How closely the list is matched to how well known the reader's own titles are. "
            "0 leaves the ranking as scored, which favours the best known matches; 1 matches "
            "their own level. Unset follows the deployment default."
        ),
    ),
    weights: Optional[str] = Query(
        default=None,
        description=(
            "Signal weights for this request as comma-separated name:value pairs, naming "
            "only what differs from the default, for example tag:3.0,quality:0. "
            "See /recommendations/presets for the signal names, the limits, the named "
            "vectors, and whether reader tuning is switched on; while it is not, this is "
            "ignored and the ordinary page is served."
        ),
    ),
    db: AsyncSession = Depends(get_db),
):
    """
    Get personalized VN recommendations from the hybrid recommender.

    **`list`** chooses between the blend and one signal on its own. `combined`, the
    default, is the page described below. Any other name serves that signal's own ranking:
    the request is scored under a vector giving the named signal all the weight, which
    sends its own retrieval source looking and leaves the other eight unspent, so the page
    is drawn from that evidence rather than reordered out of the blend's pool. The
    `signal` a list ranks on is the key it appears under in `scores`, `signal_weights` and
    `ranked_in`, and `/recommendations/presets` publishes the pairing.

    On a single-signal page `normalized_score` is that signal's own score on the 0-100
    scale, since the percentage divides by the weight actually used. The page is ordered by
    that score and, where the score leaves titles level, by how strongly the reader is
    attached to the entities its retrieval source matched. `list.distinct_scores` says how
    many different values the signal produced across the page, so a client can tell a
    ranking from a set: at one, the signal scored every title alike and the order is
    entirely the retrieval affinity. `list.from_retrieval` says how many of the page that
    source named, the rest having reached it through the exploration draw.

    A single-signal page is neither read from nor written to the cache, which holds the
    combined page. It computes fresh every time, and costs less than the combined page
    because one retrieval source runs instead of nine.

    **`reason`** is on every card: the list it came from, how many of that list's entities
    matched, and the strongest few by name. On a combined page it is the reason belonging
    to whichever signal contributed most to the score. Several of the underlying detail
    lists are cut to a fixed depth, so `count` is a floor on a title that matched more than
    that depth and copy built on it should read as at least rather than exactly. Null where
    the ranking signal has no entities to name.

    **`ranked_in`** is where each signal placed the title, keyed by signal name. Ties inside
    one signal share the mean of the positions they span, so a position can fall between
    two whole numbers, and a signal that separated nothing puts everything it reached at
    one position. Absent signals did not rank the title inside their cut. The quality
    signal is not among them, and `signals_ranked` does not count it: it is served under no
    list, so a position it holds names nothing a reader can open.

    Scores candidates on what a title's own catalogue entry says about it (description
    affinity, developer, staff, character trait and seiyuu affinity), then adds what the
    readership has to say (tag affinity, VN-to-VN similarity, co-occurrence and a quality
    average), and re-ranks for diversity so one cluster cannot fill the list. The second
    group only exists once a title has been widely read, so it adds to a score and never
    divides one: a title nobody has voted on is ranked on the first group alone. Each
    result carries its per-signal breakdown under `scores`, and `normalized_score` is the
    0-100 match percentage.

    **`confidence`** is agreement between the signals: each signal ranks the pool on its
    own score, and 100 would be a title placed first in every one of those rankings.
    `signals_ranked` is how many of them it placed inside at all. A high figure from few
    rankings is a title one or two signals are certain about; a similar figure from many
    is a title everything mildly agrees on. Neither is a probability. The rankings are
    taken over the pool the request drew, which tracks `limit`, so two pages at different
    sizes carry percentages on different scales and should not be shown beside each other.

    **`predicted_rating`** is what the signals expect this reader to mark the title, as
    the mean of the per-signal predictions under `signals`. That mean may be weighted by
    how closely each signal has been measured to predict, in which case a signal's entry
    under `signals` is still its own mark and not its share of the result. `low` and
    `high` bound how far those predictions disagree with each other. They are not an error
    bar: signals sharing a mistake agree narrowly around the wrong number. They are absent
    where only one signal spoke, and the whole block is absent where none did.

    **Filters** share their names and meanings with `/vn/search/`, so the same control
    produces the same set on both pages. One default differs, because this endpoint ranks
    a reader's own profile rather than browsing the catalogue: adult titles are included
    unless `nsfw=false`. Development status is otherwise the same as search: unfinished
    and cancelled titles are left off the page unless the request names a status, with
    `devstatus=-1` naming every status.

    **Overlapping filters resolve in favour of the shared vocabulary:**
    - `length` and `exclude_length` name buckets and read the recorded play time where it
      exists. `min_length`/`max_length` compare the coarse 1-5 column, which is a different
      definition of the same axis, so they are ignored whenever a bucket is named and apply
      unchanged otherwise.
    - `olang` names original languages outright, so it supersedes the `japanese_only`
      shorthand rather than intersecting with it.

    **Cache behavior:**
    - Pre-computed recommendations are served from cache when younger than the read TTL
      and no more recent than the last catalogue import, whichever cuts the window
      shorter.
    - Cache miss triggers fresh computation and caches results for next time, storing a
      page wider than any single request asks for so a filtered read still has enough
      rows to answer from.
    - Use `skip_cache=true` to force fresh computation
    - Cache is only used when spoiler_level=0 (default)
    - Every filter above is a predicate over a visual novel, so it applies to the cached
      rows and does not force a recompute. A filtered read needs at least half the stored
      page to survive the filter; short of that, the cache has been cut to a stub and a
      fresh computation searches the whole catalogue instead.
    - The cached page was drawn under the default original-language scope. A request that
      widens or renames that scope, through `japanese_only` or `olang`, is computed fresh
      and is not written back, so it is never answered from a page drawn under the other
      scope.
    - The cached page was drawn with the reader's blacklist held off it. A request asking
      for blacklisted titles, through `exclude_blacklist=false`, is computed fresh and is
      not written back, since the stored page can only have such titles subtracted from it
      and never added back.
    - A cache hit is served in the order it was computed in, which the diversity and
      popularity passes settled after scoring, not in score order.
    - A cache hit carries the `reason` and `confidence` stored with each row and does not
      carry `signals_ranked` or `ranked_in`: the latter are properties of the pool a run
      scored and no column holds them. `include_details` is likewise not honoured on a
      cache hit, no column holding the full breakdown.
    - Only the combined list is cached. Any other value of `list` is scored under a vector
      of its own, which is what already holds a tuned request out of the shared cache.

    **`pool`** reports the candidate pool the page was drawn from, so an empty result
    caused by a narrow filter can be told apart from one caused by an empty profile.

    **`continuations`** is unread, finished, official direct sequels of titles the reader
    marked at or above their own mean score, carried on both the cached and the fresh
    page. It is empty on a single-signal page, while the feature is switched off, or for a
    reader with no finished votes. It is blocked by the reader's own list, including the
    blacklist where `exclude_blacklist` is on, rather than by the wider set of related
    titles the page itself may be excluding, since that wider set would otherwise remove
    the very sequels the strip exists to show. It honours the same filter set the page
    does, so it never carries a title the page below it would have left out.

    **`signal_weights`** reports what each signal was worth to this reader, for a client
    breaking a match percentage down per signal. It is absent from a page served out of
    the cache, whose scores were written under whatever weights were in force then; a
    client without it falls back to the published defaults. On a single-signal page it is
    the vector that page was scored under, one signal at its usual weight and the rest at
    zero.

    **`weights`** lets a reader set that balance themselves for one request. Only the
    signals that differ from the default need naming. Out-of-range values are clamped
    rather than refused, and the `weights` block in the response says what was adjusted.
    A tuned request is computed fresh and is neither read from nor written to the shared
    cache, which holds one page per reader under the default balance. `normalized_score`
    then divides by the total of the weights actually used, so the percentage keeps
    meaning the share of what the title could have scored. The parameter is read only
    while reader tuning is switched on, which `/recommendations/presets` reports. Naming a
    list as well sets the balance twice: the list decides, and `list.weights_ignored` says
    so while the `weights` block still reports what was asked for.

    Returns recommendations with match reasons explaining why each VN was recommended.
    """
    total_start = time.time()
    user_service = UserService(db)
    weight_selection = resolve_signal_weights(weights)
    custom_weights = weight_selection.weights if weight_selection and weight_selection.is_custom else None

    try:
        selected_list: Optional[SignalList] = parse_list(list_name)
    except UnknownList as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    # A list is a balance in its own right, so the two controls cannot both decide one.
    # The list wins, since it is what the reader last asked for and a tuned vector reaches
    # the endpoint from a link that outlives the tab it was made on. What was asked for is
    # still reported, beside the fact that it did not apply.
    weights_ignored = bool(selected_list and custom_weights)
    # The list overrides an explicit weights param, so the request's own value has to be
    # kept aside here: the cache gate below cares whether the reader named weights, not
    # what the list substituted in their place.
    custom_weights_named = custom_weights
    if selected_list is not None:
        custom_weights = single_signal_weights(selected_list.signal)

    try:
        filter_spec = parse_vn_filters(
            year_min=year_min,
            year_max=year_max,
            min_rating=min_rating,
            max_rating=max_rating,
            min_votecount=min_votecount,
            max_votecount=max_votecount,
            min_difficulty=min_difficulty,
            max_difficulty=max_difficulty,
            length=length,
            exclude_length=exclude_length,
            minage=minage,
            exclude_minage=exclude_minage,
            # Unfinished and cancelled titles are left off the page unless a status is
            # named here; an empty tuple is what an unset value maps to, and `-1` maps to
            # one naming every status.
            devstatus=devstatus,
            exclude_devstatus=exclude_devstatus,
            olang=olang,
            exclude_olang=exclude_olang,
            platform=platform,
            exclude_platform=exclude_platform,
            staff=staff,
            seiyuu=seiyuu,
            developer=developer,
            publisher=publisher,
            producer=producer,
            nsfw=nsfw,
        )
    except FilterListTooLong as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    # The finished-only default is lifted only by naming every status outright, since an
    # empty status set is what an unfiltered request carries.
    if devstatus == "-1":
        filter_spec = replace(filter_spec, devstatus=(0, 1, 2))

    min_length, max_length, japanese_only = resolve_filter_overlaps(
        filter_spec, min_length, max_length, japanese_only
    )

    # Whether the reader asked for anything beyond the defaults every request carries.
    # A filtered request is held to filling the page it asked for; an unfiltered one takes
    # whatever the pool holds, as it always has.
    filters_active = (
        bool(vn_filter_predicates(filter_spec, rating_column=AVERAGE_RATING))
        or min_length is not None
        or max_length is not None
    )

    # Whether the request runs under the original-language scope every request carries by
    # default. The cache holds one page per reader, drawn under that scope; a request that
    # widens or renames it wants titles the cached page was never drawn from, and cached
    # rows carry no record of the scope behind them, so such a request is neither answered
    # from the cache nor written back into it. Naming languages outright clears the
    # shorthand and carries the language predicate in the filter spec instead, so a request
    # that spells the default scope that way is computed fresh too.
    default_language_scope = japanese_only

    # Get user data
    user_data = await user_service.get_user_list(vndb_uid)
    if not user_data:
        raise HTTPException(status_code=404, detail=f"User {vndb_uid} not found")

    # Exclude VNs the user has already engaged with (Playing/Finished/Stalled/Dropped);
    # blacklisted VNs (label 6) are excluded only when exclude_blacklist is set (default on,
    # exposed as a user toggle on the recommendations page).
    labels = user_data.get("labels", {})
    exclude_vn_ids = compute_exclude_vn_ids(labels, exclude_blacklist=exclude_blacklist)

    user_votes = finished_votes(user_data)

    # The engine widens the exclusion set itself when it runs, from the same read set, so
    # it is handed the raw set: widening here and there again would reach two hops. The
    # widened set is for the cached page, which is read before the engine runs and may
    # hold rows written before related titles were kept off it.
    read_ids = {vote["vn_id"] for vote in user_votes} | exclude_vn_ids
    page_exclude_ids = exclude_vn_ids
    if engine_switches.RELATION_EXCLUSION:
        page_exclude_ids = exclude_vn_ids | await related_to(db, read_ids)

    # Unread direct sequels of what the reader liked. One small query, taken on both the
    # cached and the fresh path, since the strip is a fact about the reader's list rather
    # than about the run. Only the combined view carries it: a single-signal list is a
    # question about one signal and the strip is not an answer to it.
    #
    # Blocked by the reader's own list alone, not by the widened exclusion set: the
    # widening pulls in every title related to what the reader has read, which includes
    # the very sequels this strip exists to surface. The request's filters are applied to
    # the draw afterwards, so the strip and the page below it describe the same corner of
    # the catalogue.
    continuations_block: list[dict] = []
    if engine_switches.CONTINUATIONS and selected_list is None and user_votes:
        scores_out_of_ten = {vote["vn_id"]: vote["score"] / 10.0 for vote in user_votes}
        reader_mean = sum(scores_out_of_ten.values()) / len(scores_out_of_ten)
        drawn = await continuations(
            db,
            vn_scores=scores_out_of_ten,
            threshold=reader_mean,
            blocked=read_ids,
            japanese_only=japanese_only,
            limit=CONTINUATION_DRAW,
        )
        continuations_block = await filter_continuations(
            db,
            drawn,
            filters=filter_spec,
            min_length=min_length,
            max_length=max_length,
        )

    # Only allow cache bypass for admin requests
    if skip_cache and not await is_admin_request(request):
        skip_cache = False

    # Parse tag filters (not cacheable - applied post-hoc)
    include_tag_ids = None
    exclude_tag_ids = None
    if include_tags:
        include_tag_ids = [int(t.strip()) for t in include_tags.split(",") if t.strip().isdigit()][:MAX_FILTER_IDS]
    if exclude_tags:
        exclude_tag_ids = [int(t.strip()) for t in exclude_tags.split(",") if t.strip().isdigit()][:MAX_FILTER_IDS]

    # Parse trait filters (not cacheable - applied post-hoc)
    include_trait_ids = None
    exclude_trait_ids = None
    if include_traits:
        include_trait_ids = [int(t.strip()) for t in include_traits.split(",") if t.strip().isdigit()][:MAX_FILTER_IDS]
    if exclude_traits:
        exclude_trait_ids = [int(t.strip()) for t in exclude_traits.split(",") if t.strip().isdigit()][:MAX_FILTER_IDS]

    # Try cache first (if no tag/trait filters, not skipped, and default spoiler level)
    # Cache is computed at spoiler_level=0, so bypass for higher levels.
    # The cache is shared between requests for one reader and holds a score per title
    # rather than the weights behind it, so a request that set its own weights cannot be
    # answered from it and must not be written back into it.
    from_cache = False
    if not skip_cache and default_language_scope and exclude_blacklist and discovery is None and not custom_weights and not include_tag_ids and not exclude_tag_ids and not include_trait_ids and not exclude_trait_ids and spoiler_level == 0:
        # Later than the read TTL whenever the catalogue changed inside that window: a
        # page scored against the previous dump is stale the moment the new one lands.
        cutoff = cache_cutoff(datetime.utcnow(), await last_import_time(db))
        cached_results, from_cache = await get_cached_recommendations(
            db=db,
            user_id=vndb_uid,
            exclude_vn_ids=page_exclude_ids,
            limit=limit,
            min_length=min_length,
            max_length=max_length,
            japanese_only=japanese_only,
            filters=filter_spec,
            cutoff=cutoff,
        )
        # The cache holds one page's worth of titles, so a narrow filter can leave only a
        # few of them standing. Falling through to a fresh computation then costs one
        # request but searches the whole catalogue, which is the difference between three
        # results and a full page.
        fills = cache_fills_page(
            cached=len(cached_results),
            limit=limit,
            filters_active=filters_active,
            page_limit=CACHED_PAGE_ROWS,
        )
        if from_cache and cached_results and fills:
            facts = await title_facts(db, [rec["vn_id"] for rec in cached_results])
            for rec in cached_results:
                rec.update(facts.get(rec["vn_id"], {}))
            elapsed = time.time() - total_start
            return {
                "recommendations": cached_results,
                "count": len(cached_results),
                "excluded_count": len(page_exclude_ids),
                "elapsed_seconds": round(elapsed, 2),
                "from_cache": True,
                # Only the combined list is cached, so a cache hit is always this one.
                "list": {"name": COMBINED, "signal": None},
                "continuations": continuations_block,
                "pool": {
                    "candidates": len(cached_results),
                    "requested": limit,
                    "filtered": filters_active,
                    "widened": False,
                    "topped_up": False,
                    "thin": len(cached_results) < limit,
                },
            }

    # Cache miss - compute fresh recommendations
    # A filtered run is not written back: its results describe the corner of the catalogue
    # the filter asked for, and the cache is read by requests that asked for no such thing.
    # A run under any other original-language scope, or one drawn from a candidate set the
    # reader's blacklist was not held off, is held out for the same reason.
    will_cache = (
        not custom_weights
        and discovery is None
        and not filters_active
        and default_language_scope
        and exclude_blacklist
        and not include_tag_ids
        and not exclude_tag_ids
        and not include_trait_ids
        and not exclude_trait_ids
        and spoiler_level == 0
        and selected_list is None
        # The client asked for a full page; only a full-page request fills the cache,
        # so a small preview does not pay to score rows nobody asked to see.
        and limit >= CACHED_PAGE_LIMIT
    )

    # A signal tab under the default scope with no filters is the same answer every time
    # until the next import, so it is held whole. A held page does not re-apply the
    # reader's exclusions on a hit, so a title finished between two requests stays on
    # that tab until the import flush or the TTL clears it; that is the accepted cost
    # of caching a whole page rather than recomputing it per reader.
    list_cacheable = (
        selected_list is not None
        and not custom_weights_named
        and discovery is None
        and not filters_active
        and default_language_scope
        and not include_tag_ids
        and not exclude_tag_ids
        and not include_trait_ids
        and not exclude_trait_ids
        and spoiler_level == 0
    )
    if list_cacheable and not skip_cache:
        held = await get_cache().get(
            list_cache_key(
                vndb_uid, selected_list.name, limit, spoiler_level, exclude_blacklist
            )
        )
        if isinstance(held, dict):
            held["from_cache"] = True
            held["elapsed_seconds"] = round(time.time() - total_start, 2)
            return held

    recommender = HybridRecommender(db)
    async with _RECS_CEILING.hold():
        results = await recommender.recommend(
            user_votes=user_votes,
            exclude_vn_ids=exclude_vn_ids,
            limit=scored_limit(limit=limit, will_cache=will_cache),
            # min_rating travels inside the spec, which is what pushes it into the candidate
            # queries alongside the rest of the vocabulary.
            min_length=min_length,
            max_length=max_length,
            filters=filter_spec,
            include_tags=include_tag_ids,
            exclude_tags=exclude_tag_ids,
            include_traits=include_trait_ids,
            exclude_traits=exclude_trait_ids,
            # Every card names what put it on the page, and the matched entities behind that
            # are computed here or nowhere. Measured against a run that skips them, the extra
            # work sits inside the run-to-run spread; what it costs is payload, which
            # `include_details` still governs.
            skip_details=False,
            japanese_only=japanese_only,
            spoiler_level=spoiler_level,
            # Titles the reader started and abandoned. Read only by the per-reader weight
            # fit, and only when it is set to use them; nothing else sees them.
            negative_vn_ids=set(labels.get(LABEL_DROPPED, [])),
            signal_weights=custom_weights,
            popularity_calibration=discovery,
            reader_id=vndb_uid,
        )

    # A single-signal page comes back in the order the diversity pass settled, which is an
    # order over a blend. Put in the order the signal itself gives, so the list ranks on
    # what it claims to rank on; see recommendation_lists.order_by_signal.
    arm_ranking: list[tuple[str, float]] = []
    if selected_list is not None:
        arm_ranking = recommender.last_ranked_arms.get(selected_list.arm or "", [])
        results = order_by_signal(results, selected_list, arm_ranking)

    # One reason per card: the list's own where a list was named, and otherwise whichever
    # signal contributed most to the score. Built once, since the cache write stores the
    # same answer the response carries.
    reasons: dict[str, dict] = {}
    for r in results:
        reason = (
            reason_from(r, selected_list)
            if selected_list is not None
            else strongest_reason(r, recommender.last_signal_weights)
        )
        if reason is not None:
            reasons[r.vn_id] = reason

    elapsed = time.time() - total_start

    # The page written is the whole scored set; the page returned is what was asked for.
    page = results[:limit]
    if will_cache and results:
        cache_task = asyncio.create_task(cache_recommendations_async(vndb_uid, results, reasons))
        _background_tasks.add(cache_task)
        cache_task.add_done_callback(_background_tasks.discard)
    results = page

    # Where each signal placed each title, keyed by signal name so it reads against
    # `scores` and `signal_weights`. Taken over the pool the run scored, which is what
    # `confidence` is computed from, rather than over the page: a position recomputed over
    # the page alone is a different number under the same name.
    #
    # Quality is left out: it is served under no list, so a position it holds names
    # nothing a reader can open.
    signal_rankings = recommender.last_signal_rankings or {}
    signal_positions = {
        signal: positions
        for signal, positions in signal_rankings.items()
        if signal != "quality"
    }
    # Taken off the count the engine reports, which spans every ranking the fusion read.
    # A ranking whose signal carried no weight was not fused, so it is not in that count
    # and nothing is owed back for it.
    quality_ranked = (
        signal_rankings.get("quality", {})
        if recommender.last_signal_weights.get("quality", 0.0) > 0
        else {}
    )

    # Format response
    facts = await title_facts(db, [r.vn_id for r in results])
    recommendations_data = []
    for r in results:
        rec = {
            "vn_id": r.vn_id,
            "title": r.title,
            # Omitted where it repeats the title, which it does for most Japanese titles.
            "title_jp": r.title_jp if r.title_jp != r.title else None,
            "title_romaji": r.title_romaji,
            "score": round(r.score, 3),
            "normalized_score": r.normalized_score,
            "match_reasons": r.match_reasons,
            "image_url": r.image_url,
            "image_sexual": r.image_sexual,
            "rating": r.rating,
            # How far the signals agree, 0-100, and how many of their rankings the title
            # placed inside. Zero where no signal ranked the title inside its own cut.
            #
            # Both are properties of the pool a run scored rather than of a stored row.
            # The agreement is stored with the row so a cached page reports the same match
            # figure this one does; the count of rankings is not, and is absent there.
            "confidence": r.confidence,
            "signals_ranked": r.signals_ranked - (1 if r.vn_id in quality_ranked else 0),
            # Which signals ranked this title, and where. Ties inside one signal share the
            # mean of the positions they span, so a position can fall between two whole
            # numbers and a signal that separated nothing puts every title it reached at
            # the same one.
            "ranked_in": {
                signal: round(positions[r.vn_id], 1)
                for signal, positions in signal_positions.items()
                if r.vn_id in positions
            },
            # How many of the list's own entities matched, and the strongest few by name.
            # Null where the signal that ranked this title has no entities to name.
            "reason": reasons.get(r.vn_id),
            "scores": {
                name: round(value, 3)
                for name, value in (
                    ("tag", r.tag_score),
                    ("similar_games", r.similar_games_score),
                    ("users_also_read", r.users_also_read_score),
                    ("developer", r.developer_score),
                    ("staff", r.staff_score),
                    ("seiyuu", r.seiyuu_score),
                    ("trait", r.trait_score),
                    ("quality", r.quality_score),
                    ("description", r.description_score),
                )
                if value
            },
        }
        # Shown only while the collaborative signal carries weight: at none it takes no
        # part in the score, and a zero beside the signals that did would read as a verdict.
        if engine_switches.CF_SIGNAL_WEIGHT > 0:
            rec["scores"]["collaborative"] = round(r.collaborative_score, 3)
        # The mark the signals expect this reader to give, with the range they disagree
        # over and the per-signal marks behind it. The range is the scatter between the
        # signals and not an error bar on the mean; absent where fewer than two spoke.
        # The whole block is absent while the prediction is switched off.
        if r.predicted_rating is not None:
            rec["predicted_rating"] = {
                "mean": round(r.predicted_rating, 2),
                "low": (
                    round(r.predicted_rating_low, 2)
                    if r.predicted_rating_low is not None
                    else None
                ),
                "high": (
                    round(r.predicted_rating_high, 2)
                    if r.predicted_rating_high is not None
                    else None
                ),
                "signals": {
                    name: round(value, 2)
                    for name, value in r.predicted_ratings.items()
                },
            }
        # Only include details if requested (to reduce payload size)
        if include_details:
            rec["details"] = {
                "matched_tags": r.matched_tags,
                "matched_staff": r.matched_staff,
                "matched_developers": r.matched_developers,
                "matched_seiyuu": r.matched_seiyuu,
                "matched_traits": r.matched_traits,
                "contributing_vns": r.contributing_vns,
                "similar_games": r.similar_games_details,
                "users_also_read": r.users_also_read_details,
                "description_matches": r.description_matches,
            }
        rec.update(facts.get(r.vn_id, {}))
        recommendations_data.append(rec)

    pool = dict(recommender.last_pool or {})
    # The engine reports the size it scored, which is the cache page on a run that
    # fills the cache; the client asked for the page it is given.
    pool["requested"] = limit
    pool["thin"] = pool.get("candidates", 0) < limit

    # What this list is, and how much of a ranking it managed. Both figures are facts about
    # this run rather than judgements: a signal whose scorer returns one value over its own
    # candidates ranks nothing, and a page whose titles its own retrieval source never
    # named is a page that source did not choose.
    list_block: dict = {"name": COMBINED, "signal": None}
    if selected_list is not None:
        scores = [
            getattr(r, f"{selected_list.signal}_score", 0.0) for r in results
        ]
        reached = {vn_id for vn_id, _ in arm_ranking}
        list_block = {
            "name": selected_list.name,
            "signal": selected_list.signal,
            "distinct_scores": len({round(score, 6) for score in scores}),
            "from_retrieval": sum(1 for r in results if r.vn_id in reached),
            "weights_ignored": weights_ignored,
        }

    response = {
        "recommendations": recommendations_data,
        "count": len(results),
        "excluded_count": len(exclude_vn_ids),
        "elapsed_seconds": round(elapsed, 2),
        "from_cache": False,
        "list": list_block,
        "pool": pool,
        "continuations": continuations_block,
        # What each signal was worth to this reader. A client that breaks a match
        # percentage down per signal has to divide by the same numbers the score was
        # built from, and those are not the same for every reader.
        "signal_weights": {
            name: round(weight, 4)
            for name, weight in recommender.last_signal_weights.items()
        },
    }
    # Present only where the request named weights, so a client can show what it asked
    # for beside what was applied and name any value that had to be adjusted.
    if weight_selection is not None:
        response["weights"] = weight_selection.describe()
    if list_cacheable:
        # The weights block describes the request that wrote the entry, not the ones
        # that read it, so it is dropped before the page is stored for replay.
        cached_response = {key: value for key, value in response.items() if key != "weights"}
        await get_cache().set(
            list_cache_key(
                vndb_uid, selected_list.name, limit, spoiler_level, exclude_blacklist
            ),
            cached_response,
            ttl=LIST_CACHE_TTL_SECONDS,
        )
    return response


@router.get("/{vndb_uid}/v2/details/{vn_id}")
@limiter.limit("30/minute")
async def get_recommendation_details(
    request: Request,
    vndb_uid: str,
    vn_id: str,
    list_name: str = Query(
        default=COMBINED,
        alias="list",
        description=(
            "Which list this breakdown was opened from. A signal list is a balance in its "
            "own right, so passing it here is what makes the breakdown agree with the card "
            "beside it. Names: " + ", ".join(LIST_NAMES)
        ),
    ),
    spoiler_level: int = Query(0, ge=0, le=2, description="Max tag/trait spoiler level (0=None, 1=Minor, 2=Major)"),
    weights: Optional[str] = Query(
        default=None,
        description=(
            "Signal weights this breakdown is computed under, in the same format the list "
            "endpoint takes. Pass what the list was fetched with, or the two will disagree."
        ),
    ),
    db: AsyncSession = Depends(get_db),
):
    """
    Get detailed breakdown for why a specific VN was recommended to a user.

    This endpoint computes the detailed match reasons for a single VN,
    useful for showing a "Why this recommendation?" popup without
    slowing down the main recommendations list.

    `weights` exists so the popup can be computed under the same balance as the list it
    was opened from. Omitting it where the list set it leaves the breakdown adding up to a
    different percentage than the card beside it.

    Returns:
    - matched_tags: Tags that match user preferences with weighted scores
    - matched_staff: Staff members from user's preferred creators
    - matched_developers: Developers from user's preferred studios
    - contributing_vns: User's VNs that are similar to this one
    - collab: Collaborative filtering details (similar users who rated this)
    """
    total_start = time.time()
    user_service = UserService(db)
    weight_selection = resolve_signal_weights(weights)
    custom_weights = weight_selection.weights if weight_selection and weight_selection.is_custom else None

    try:
        selected_list: Optional[SignalList] = parse_list(list_name)
    except UnknownList as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    # A list is a balance in its own right, so the two controls cannot both decide one.
    # The list wins, since it is what the reader last asked for and a tuned vector reaches
    # the endpoint from a link that outlives the tab it was made on. What was asked for is
    # still reported, beside the fact that it did not apply.
    weights_ignored = bool(selected_list and custom_weights)
    if selected_list is not None:
        custom_weights = single_signal_weights(selected_list.signal)

    # Get user data
    user_data = await user_service.get_user_list(vndb_uid)
    if not user_data:
        raise HTTPException(status_code=404, detail=f"User {vndb_uid} not found")

    labels = user_data.get("labels", {})
    user_votes = finished_votes(user_data)

    # Use optimized single-VN details method
    recommender = HybridRecommender(db)
    result = await recommender.get_details_for_vn(
        user_votes=user_votes,
        vn_id=vn_id,
        spoiler_level=spoiler_level,
        negative_vn_ids=set(labels.get(LABEL_DROPPED, [])),
        signal_weights=custom_weights,
        # No popularity term here: calibration decides which titles reach a list, and this
        # breakdown explains one title the reader already has in front of them.
    )

    if not result:
        raise HTTPException(status_code=404, detail=f"VN {vn_id} not found")

    elapsed = time.time() - total_start

    details_response = {
        "vn_id": result.vn_id,
        "title": result.title,
        "score": round(result.score, 3),
        "normalized_score": result.normalized_score,
        "scores": {
            "tag": round(result.tag_score, 3),
            "similar_games": round(result.similar_games_score, 3),
            "users_also_read": round(result.users_also_read_score, 3),
            "developer": round(result.developer_score, 3),
            "staff": round(result.staff_score, 3),
            "seiyuu": round(result.seiyuu_score, 3),
            "trait": round(result.trait_score, 3),
            "quality": round(result.quality_score, 3),
            "description": round(result.description_score, 3),
        },
        "details": {
            "matched_tags": result.matched_tags,
            "matched_staff": result.matched_staff,
            "matched_developers": result.matched_developers,
            "matched_seiyuu": result.matched_seiyuu,
            "matched_traits": result.matched_traits,
            "contributing_vns": result.contributing_vns,
            "similar_games": result.similar_games_details,
            "users_also_read": result.users_also_read_details,
            "description_matches": result.description_matches,
        },
        # The weight vector this breakdown was scored under, so a per-signal
        # contribution can be worked out for this reader rather than from a copy of the
        # global weights held elsewhere.
        "signal_weights": {
            name: round(weight, 4)
            for name, weight in recommender.last_signal_weights.items()
        },
        # True where a list and a weight vector both reached this request. The list
        # decides, the same way it does on the list endpoint, and this says so.
        "weights_ignored": weights_ignored,
        "elapsed_seconds": round(elapsed, 2),
    }
    if weight_selection is not None:
        details_response["weights"] = weight_selection.describe()
    return details_response
