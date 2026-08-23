"""Leaderboard endpoints.

Curated boards are built by the nightly worker and served straight from Redis, so those
handlers do no aggregation. That is the whole design for them: the underlying scans are far
too heavy for a request, and the data behind them only moves once a day.

Tag rankings are the exception, and are computed on request. There is one per tag per
question, which is far more than a nightly job should materialise, and each is a single
grouped scan rather than a slice of the full pass. They are cached under a key carrying the
dump date, so a new dump orphans the previous day's answers instead of needing them cleared.

Mounted on its own prefix rather than under /stats because the stats router claims
/stats/{vndb_uid}, which would swallow any path segment added beside it.
"""

import asyncio
import hashlib
import json
import logging
from contextlib import asynccontextmanager

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request, Response
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.cache import get_cache
from app.core.concurrency import Ceiling
from app.db.database import get_db
from app.db.models import Tag
from app.leaderboards.aggregate import percentile_of, share_below
from app.leaderboards.custom import (
    LIVE_ROW_LIMIT,
    MAX_TAG_ID,
    READER_QUESTIONS,
    TITLE_QUESTIONS,
    build_custom_ranking,
    user_vote_totals,
)
from app.leaderboards.reading_profile import (
    load_japanese_read,
    load_reading_drift,
    load_japanese_titles,
    load_reading_milestones,
    load_reading_profile,
    load_reading_years,
)
from app.leaderboards.compute import (
    PERCENTILE_KEY_PREFIX,
    RANK_INDEX_KEY_PREFIX,
    latest_vote_date,
    supports_language_variants,
)
from app.leaderboards.registry import BOARDS, board_for_slug
from app.leaderboards.serialize import (
    CatalogueResponse,
    LeaderboardResponse,
    RankResponse,
    Standing,
    StandingsResponse,
)
from app.leaderboards.spec import (
    ADULT_SCENE_TAG_CATEGORIES,
    CATALOGUE_CACHE_KEY,
    LANGUAGE_ALL,
    Facet,
    Subject,
    slug_cache_key,
)

logger = logging.getLogger(__name__)

router = APIRouter()
limiter = Limiter(key_func=get_remote_address)

#: Slices computed at once. Each is a scan against the pool the whole site shares, so this
#: is what keeps a spread of distinct slices from holding connections the rest of the service
#: needs. An answer already in the cache never reaches it.
_SLICE_CEILING = Ceiling(slots=4, wait_seconds=5.0, what="rankings")

#: Boards are rebuilt once a day. An hour of browser caching keeps repeat views free while
#: still picking up a refresh within the same day.
CACHE_SECONDS = 3600

#: How long a computed tag ranking is kept. Longer than the browser cache because the
#: answer cannot change until the next dump, and the key carries the dump date anyway.
_LIVE_TTL = 60 * 60 * 26

#: How long a slice that came back with nothing is kept.
#:
#: A slice can be narrow enough to hold nothing, and that answer is worth a moment so a
#: reload does not recompute it. It is not worth a day: the same query also returns nothing
#: while the figures behind it are still being derived, and holding that for the full window
#: leaves a panel empty long after the data arrives.
_EMPTY_SLICE_TTL = 60

MAX_ROWS = 100


def _etag(payload: dict) -> str:
    content = json.dumps(payload, sort_keys=True, default=str)
    return f'"{hashlib.md5(content.encode()).hexdigest()}"'


def _matches_etag(request: Request, etag: str) -> bool:
    header = request.headers.get("if-none-match")
    if not header:
        return False
    candidates = [value.strip() for value in header.split(",")]
    return etag in candidates or "*" in candidates


def _regenerating(detail: str) -> HTTPException:
    """Signal a board that exists but has no cached copy right now.

    Redis runs an eviction policy, and a board can also be missing between a flush and the
    nightly rebuild. Saying so is better than computing a different number on the fly and
    presenting it as the same board.
    """
    return HTTPException(status_code=503, detail=detail, headers={"Retry-After": "300"})


@router.get("", response_model=CatalogueResponse)
async def get_catalogue(request: Request, response: Response):
    """List every available board."""
    response.headers["Cache-Control"] = f"public, max-age={CACHE_SECONDS}"

    payload = await get_cache().get(CATALOGUE_CACHE_KEY)
    if payload is not None:
        # The cached catalogue outlives the code that built it, so a board dropped or
        # renamed since the last nightly run is still listed here while its own route
        # already answers 404. Drop anything the registry no longer defines: a shorter
        # catalogue is correct, a card that leads nowhere is not.
        live = {board.slug for board in BOARDS}
        boards = [entry for entry in payload.get("boards", []) if entry.get("slug") in live]
        if len(boards) != len(payload.get("boards", [])):
            payload = {**payload, "boards": boards}

    if payload is None:
        # Fall back to the registry so the catalogue page still renders before the first
        # nightly run. Counts are absent because nothing has been computed yet.
        payload = CatalogueResponse(
            boards=[
                {
                    "slug": board.slug,
                    "title": board.title,
                    "blurb": board.blurb,
                    "subject": board.subject.value,
                    "metric": board.metric.value,
                    "window": board.window.value,
                    "facet_description": "",
                    "total_ranked": 0,
                }
                for board in BOARDS
            ]
        ).model_dump(mode="json")

    etag = _etag(payload)
    response.headers["ETag"] = etag
    if _matches_etag(request, etag):
        return Response(status_code=304, headers={"ETag": etag})

    return payload


@router.get("/percentiles/{vndb_uid}")
async def get_user_percentiles(
    response: Response,
    vndb_uid: str,
    votes: int | None = Query(default=None, ge=0, description="The reader's vote count"),
    finished: int | None = Query(default=None, ge=0, description="Titles marked finished"),
    dropped: int | None = Query(default=None, ge=0, description="Titles given up on"),
    wishlist: int | None = Query(default=None, ge=0, description="Titles wishlisted"),
    average: float | None = Query(default=None, ge=0, le=10, description="Mean rating, 1 to 10"),
):
    """Where a reader sits in the population, on each tracked distribution.

    Answered from nightly boundary-value sketches rather than by counting across
    the whole user base, so this is a small cache read and a binary search. The caller
    supplies its own totals, which it already has from the stats it is rendering; sending
    them avoids recomputing a list the page has in hand.
    """
    response.headers["Cache-Control"] = f"private, max-age={CACHE_SECONDS}"

    cache = get_cache()
    supplied = {
        "votes": votes,
        "finished": finished,
        "dropped": dropped,
        "wishlist": wishlist,
        "average": average,
    }
    result: dict[str, dict] = {}

    for name, value in supplied.items():
        # None means the caller did not send the figure. Zero is a figure: a reader who has
        # given nothing up stands somewhere on that distribution, and it is the line they
        # would most want to see. Only the mean is skipped at zero, since the scale starts
        # at one and a zero there means there was nothing to average.
        if value is None or (name == "average" and not value):
            continue
        sketch = await cache.get(f"{PERCENTILE_KEY_PREFIX}{name}")
        if not sketch:
            continue
        percentile = percentile_of(sketch, float(value))
        if percentile is None:
            continue
        # Both edges of the reader's position travel, because the distance between them is
        # the share holding exactly this figure. Without it a crowded floor reads as a
        # placing above the crowd rather than a place inside it.
        result[name] = {
            "value": value,
            "percentile": percentile,
            "below": share_below(sketch, float(value)),
        }

    return {"uid": vndb_uid, "percentiles": result}


@router.get("/reading-profile/{vndb_uid}")
async def get_reading_profile(
    response: Response,
    vndb_uid: str,
    db: AsyncSession = Depends(get_db),
):
    """How one reader's votes stand against the whole record.

    Three things the rest of a reader's page cannot say, because each needs every vote rather
    than one list: what only they have read, how far their ratings sit from the community, and
    how well travelled their reading is.

    Computed on request. One reader is a few tens of milliseconds, and materialising tens of
    thousands of readers nightly to answer for the few who visit would be the wrong trade.
    Where a nightly sketch exists the figure also carries its place in the population, since
    a median of twelve other voters means nothing until you know what most people read.
    """
    response.headers["Cache-Control"] = f"private, max-age={CACHE_SECONDS}"

    profile = await load_reading_profile(db, vndb_uid)
    if profile is None:
        raise HTTPException(
            status_code=404, detail=f"No public votes found for {vndb_uid}"
        )

    cache = get_cache()

    async def placed(name: str, value: float | None) -> float | None:
        if value is None:
            return None
        sketch = await cache.get(f"{PERCENTILE_KEY_PREFIX}{name}")
        return percentile_of(sketch, float(value)) if sketch else None

    japanese = await load_japanese_read(db, vndb_uid)
    milestones = await load_reading_milestones(db, vndb_uid)
    drift = await load_reading_drift(db, vndb_uid)

    def point(m):
        if m is None:
            return None
        # All three title forms travel together: which one to show is the reader's
        # setting, held in the browser, so the choice cannot be made here.
        return {
            "date": m.date,
            "title": m.title,
            "title_jp": m.title_jp,
            "title_romaji": m.title_romaji,
            "score": m.score,
            "href": f"/vn/{m.vn_id.lstrip('v')}",
        }

    return {
        "uid": vndb_uid,
        "japanese": (
            None
            if japanese is None
            else {
                "characters": japanese.characters,
                "measured": japanese.measured,
                "finished": japanese.finished,
                "difficulty": japanese.difficulty,
                "coverage": round(japanese.coverage, 1),
            }
        ),
        "milestones": (
            None
            if milestones is None
            else {
                "first": point(milestones.first),
                "latest": point(milestones.latest),
                "longest_gap_days": milestones.longest_gap_days,
                "active_days": milestones.active_days,
            }
        ),
        "drift": (
            None
            if drift is None
            else {
                "early": drift.early.__dict__,
                "late": drift.late.__dict__,
            }
        ),
        "rated": profile.rated,
        "sole_voter": profile.sole_voter,
        "median_other_voters": profile.median_other_voters,
        "bias": profile.bias,
        "divergence": profile.divergence,
        "comparable": profile.comparable,
        "era_from": profile.era_from,
        "era_to": profile.era_to,
        "era_median": profile.era_median,
        "percentiles": {
            # Obscurity runs the other way to everything else here: a low median means a
            # reader is further off the map, so the percentile is inverted to read as
            # "more obscure than", which is the direction a reader expects.
            # Placed against the all-language distribution, because the figure above it
            # counts every language. The board's own sketch covers Japanese-original titles
            # only, and a figure measured over one population cannot be ranked in another.
            "obscurity": (
                None
                if profile.median_other_voters is None
                else _invert(await placed("obscurity_all", profile.median_other_voters))
            ),
            "bias": await placed("bias", profile.bias),
        },
    }


def _invert(percentile: float | None) -> float | None:
    """Turn a place in an ascending distribution into a place in the descending one."""
    return None if percentile is None else round(100.0 - percentile, 1)


@router.get("/japanese-titles/{vndb_uid}")
async def get_japanese_titles(
    response: Response,
    vndb_uid: str,
    db: AsyncSession = Depends(get_db),
):
    """The finished titles behind a reader's character total, heaviest first.

    Split from the profile rather than folded into it: the profile is fetched on every visit
    to size a card, and this list is only wanted by somebody who opens it.
    """
    response.headers["Cache-Control"] = f"private, max-age={CACHE_SECONDS}"

    titles = await load_japanese_titles(db, vndb_uid)
    return {
        "uid": vndb_uid,
        "titles": [
            {
                "vn_id": t.vn_id,
                "title": t.title,
                "title_jp": t.title_jp,
                "title_romaji": t.title_romaji,
                "characters": t.characters,
                "difficulty": t.difficulty,
                "href": f"/vn/{t.vn_id.lstrip('v')}",
                "source_href": f"https://jiten.moe/decks/media/{t.deck_id}/detail",
            }
            for t in titles
        ],
    }


@router.get("/reading-years/{vndb_uid}")
async def get_reading_years(
    response: Response,
    vndb_uid: str,
    db: AsyncSession = Depends(get_db),
):
    """A reader's rating history year by year, newest first.

    Keyed on when each vote was cast rather than when the title came out, so a year here is
    what somebody was doing then. Computed on request from the dated votes, which is a single
    grouped pass over one reader.
    """
    response.headers["Cache-Control"] = f"private, max-age={CACHE_SECONDS}"

    years = await load_reading_years(db, vndb_uid)
    return {
        "uid": vndb_uid,
        "years": [
            {
                "year": year.year,
                "rated": year.rated,
                "average": year.average,
                "best": (
                    None
                    if not year.best_id
                    else {
                        "id": year.best_id,
                        "title": year.best_title,
                        "title_jp": year.best_title_jp,
                        "title_romaji": year.best_title_romaji,
                        "score": year.best_score,
                        "href": f"/vn/{year.best_id.lstrip('v')}",
                    }
                ),
            }
            for year in years
        ],
    }


@router.get("/standings/{vndb_uid}", response_model=StandingsResponse)
async def get_standings(response: Response, vndb_uid: str):
    """Every reader board this person places on.

    Reads the nightly rank indexes, which go deeper than the rows a board displays. Boards
    where the reader falls outside that depth are omitted rather than reported vaguely: a
    listing that said "somewhere below the indexed depth" on every board would be noise.
    """
    response.headers["Cache-Control"] = f"private, max-age={CACHE_SECONDS}"

    uid = vndb_uid if vndb_uid.startswith("u") else f"u{vndb_uid}"
    cache = get_cache()
    standings = []

    for board in BOARDS:
        if board.subject is not Subject.USER:
            continue

        index = await cache.get(f"{RANK_INDEX_KEY_PREFIX}{board.slug}")
        if not index:
            continue

        rank = (index.get("ranks") or {}).get(uid)
        if rank is None:
            continue

        total = index.get("total", 0)
        standings.append(
            Standing(
                slug=board.slug,
                title=board.title,
                rank=rank,
                total_ranked=total,
                percentile=round((1 - (rank - 1) / total) * 100, 1) if total else None,
            )
        )

    # Best placements first: that is the order someone reads their own results in.
    standings.sort(key=lambda item: item.rank)
    return StandingsResponse(uid=uid, standings=standings)


@router.get("/custom", response_model=LeaderboardResponse)
# Answers here are cached under a key built from the facets asked for, so unlike the
# curated boards the keyspace grows with the variety of requests rather than with the
# data. The ceiling holds that growth to a rate the cache can carry.
@limiter.limit("10/minute")
async def get_custom_ranking(
    request: Request,
    response: Response,
    subject: str = Query("vns", pattern="^(vns|readers)$"),
    question: str = Query("rated", description="Which question to ask of the slice"),
    tag: int | None = Query(None, ge=1, le=MAX_TAG_ID),
    olang: str | None = Query(
        "ja",
        pattern="^(any|[a-z]{2,3})$",
        description="Original language. 'any' widens to every language.",
    ),
    year_min: int | None = Query(None, ge=1970, le=2100),
    year_max: int | None = Query(None, ge=1970, le=2100),
    platform: str | None = Query(None, pattern="^[a-z0-9]{2,4}$"),
    length: int | None = Query(None, ge=1, le=5),
    minage_max: int | None = Query(None, ge=0, le=18),
    lang_only: str | None = Query(
        None,
        pattern="^[a-z]{2,3}$",
        description="Released in this language and no other, so 'ja' means never translated",
    ),
    free: str | None = Query(
        None,
        pattern="^(any|free|ja)$",
        description="'free' has a free release anywhere, 'ja' means every Japanese release is free",
    ),
    votecount_max: int | None = Query(
        None,
        ge=1,
        le=MAX_TAG_ID,
        description="Ceiling on VNDB's own vote count, for the under-read slice",
    ),
    difficulty_min: float | None = Query(None, ge=0, le=6),
    difficulty_max: float | None = Query(None, ge=0, le=6),
    year: int | None = Query(None, ge=1990, le=2100, description="Only for the as-of question"),
    limit: int = Query(LIVE_ROW_LIMIT, ge=1, le=LIVE_ROW_LIMIT),
    db: AsyncSession = Depends(get_db),
):
    """One ranking over any slice of the database, computed now rather than nightly.

    Declared above the board route because that one claims a bare path segment and would
    otherwise treat this prefix as a board slug.

    Every axis is optional, so the empty slice is the whole database and each parameter only
    narrows it. A slice can be narrow enough to hold nothing, which is answered with an empty
    ranking and the population stated rather than with an error: "nothing matched" is a
    result, and the difference between that and a failure is worth keeping visible.
    """
    if subject == "vns" and question not in TITLE_QUESTIONS:
        raise HTTPException(status_code=400, detail=f"Unknown question {question} for titles")
    if subject == "readers" and question not in READER_QUESTIONS:
        raise HTTPException(status_code=400, detail=f"Unknown question {question} for readers")
    if subject == "vns" and TITLE_QUESTIONS[question][0].needs_year and year is None:
        raise HTTPException(
            status_code=400, detail=f"The {question} question needs a year to judge by"
        )
    if year_min is not None and year_max is not None and year_min > year_max:
        raise HTTPException(status_code=400, detail="year_min cannot exceed year_max")
    # A reader ranking narrowed to one adult-scene tag reports how much of a named person's
    # reading carries that tag, which is a claim about the person rather than about any
    # title. The refusal sits here rather than in the picker because this route answers
    # whatever it is asked, whoever asks it.
    if subject == "readers" and tag is not None:
        category = await db.scalar(select(Tag.category).where(Tag.id == tag))
        if category in ADULT_SCENE_TAG_CATEGORIES:
            raise HTTPException(
                status_code=400,
                detail="Reader rankings cannot be narrowed to this tag",
            )

    facet = Facet(
        olang=None if olang in (None, "any") else olang,
        lang_only=lang_only,
        year_min=year_min,
        year_max=year_max,
        platform=platform,
        length=length,
        minage_max=minage_max,
        freeware=free == "free",
        jp_freeware=free == "ja",
        votecount_max=votecount_max,
        difficulty_min=difficulty_min,
        difficulty_max=difficulty_max,
        tag=tag,
    )

    dump_date = await latest_vote_date(db)
    key = f"lb:v1:slice:{dump_date}:{subject}:{question}:{year}:{facet.canonical()}"

    payload = await get_cache().get(key)
    if payload is None:
        async with _SLICE_CEILING.hold():
            # The denominator behind a share does not depend on the slice, so it is cached in
            # its own right; without that, each first view would pay for it again.
            totals = None
            if subject == "readers" and question == "share":
                totals_key = f"lb:v1:votetotals:{dump_date}:{facet.olang or 'all'}"
                totals = await get_cache().get(totals_key)
                if totals is None:
                    totals = await user_vote_totals(db, facet.olang)
                    await get_cache().set(totals_key, totals, ttl=_LIVE_TTL)

            payload = await build_custom_ranking(
                db,
                subject=subject,
                question_key=question,
                facet=facet,
                year=year,
                limit=LIVE_ROW_LIMIT,
                totals=totals,
            )
            if payload is None:
                raise HTTPException(status_code=404, detail=f"No tag with id {tag}")
            payload["dump_date"] = str(dump_date)
            await get_cache().set(
                key, payload, ttl=_LIVE_TTL if payload.get("rows") else _EMPTY_SLICE_TTL
            )

    # An empty slice is kept out of caches for the same reason it is barely kept in Redis.
    if payload.get("rows"):
        response.headers["Cache-Control"] = f"public, max-age={CACHE_SECONDS}"
    else:
        response.headers["Cache-Control"] = "no-store"
    payload = {**payload, "rows": payload.get("rows", [])[:limit]}

    etag = _etag(payload)
    response.headers["ETag"] = etag
    if _matches_etag(request, etag):
        return Response(status_code=304, headers={"ETag": etag})
    return payload


@router.get("/custom/questions")
async def get_custom_questions():
    """What the slice route can be asked, so the picker is built from the same definitions.

    Shipping this rather than a copy in the frontend keeps one list: a question added here
    appears in the picker without a second edit, and one removed cannot linger there.
    """
    def described(question) -> dict:
        return {
            "key": question.key,
            "label": question.label,
            "blurb": question.blurb,
            "metric": question.metric.value,
            "high_means": question.high_means,
            "needs_difficulty": question.needs_difficulty,
            "needs_year": question.needs_year,
        }

    return {
        "vns": [described(entry[0]) for entry in TITLE_QUESTIONS.values()],
        "readers": [described(question) for question in READER_QUESTIONS.values()],
    }


@router.get("/{slug}", response_model=LeaderboardResponse)
async def get_board(
    request: Request,
    response: Response,
    slug: str,
    limit: int = Query(default=MAX_ROWS, ge=1, le=MAX_ROWS),
    offset: int = Query(default=0, ge=0),
    language: str = Query(
        default=LANGUAGE_ALL,
        pattern="^(all|ja)$",
        description="'ja' restricts a visual novel board to Japanese-original titles",
    ),
):
    """Serve one board.

    `language` defaults to `all`. The site's own pages ask for `ja`, since they are about
    reading Japanese, but defaulting the API that way would hand a third-party consumer a
    filtered ranking without their having asked for one.
    """
    spec = board_for_slug(slug)
    if spec is None:
        raise HTTPException(status_code=404, detail=f"No leaderboard named {slug}")

    response.headers["Cache-Control"] = f"public, max-age={CACHE_SECONDS}"

    # A board with no Japanese variant serves its only ranking either way, rather than
    # 404ing on a language the caller could not have known was unavailable.
    wanted = language if supports_language_variants(spec) else LANGUAGE_ALL

    payload = await get_cache().get(slug_cache_key(slug, wanted))
    if payload is None:
        raise _regenerating(f"Leaderboard {slug} is being rebuilt")

    rows = payload.get("rows", [])
    payload = {**payload, "rows": rows[offset : offset + limit]}

    etag = _etag(payload)
    response.headers["ETag"] = etag
    if _matches_etag(request, etag):
        return Response(status_code=304, headers={"ETag": etag})

    return payload


@router.get("/{slug}/rank", response_model=RankResponse)
async def get_rank(slug: str, id: str = Query(..., description="Subject id, e.g. u12345")):
    """Where one subject sits on a board.

    Only answerable within the stored rows: the nightly job keeps the top slice, not the
    whole ranking, so a subject outside it reports no rank rather than a guess.
    """
    spec = board_for_slug(slug)
    if spec is None:
        raise HTTPException(status_code=404, detail=f"No leaderboard named {slug}")

    payload = await get_cache().get(slug_cache_key(slug))
    if payload is None:
        raise _regenerating(f"Leaderboard {slug} is being rebuilt")

    total = payload.get("total_ranked", 0)
    for row in payload.get("rows", []):
        if row.get("id") == id:
            rank = row.get("rank")
            percentile = (1 - (rank - 1) / total) * 100 if total and rank else None
            return RankResponse(
                slug=slug,
                id=id,
                rank=rank,
                total_ranked=total,
                percentile=round(percentile, 1) if percentile is not None else None,
                value=row.get("value"),
            )

    return RankResponse(slug=slug, id=id, rank=None, total_ranked=total)
