"""Public mini-game endpoints. Currently: the Higher or Lower VN game pool."""

import logging

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.cache import get_cache
from app.db.database import get_db
from app.db.models import CoverBlacklist, Producer, Release, ReleaseProducer, ReleaseVN, Tag, VNTag, VisualNovel

logger = logging.getLogger(__name__)

router = APIRouter()

POOL_CACHE_TTL = 3600  # pool only changes on the daily import

# The site blurs covers at image_sexual >= 1.5. The SFW pool shows only what the site
# shows unblurred; the NSFW pool adds the rest, blurred client-side.
SFW_MAX_SEXUAL = 1.5


class HigherLowerVN(BaseModel):
    id: str
    title: str
    title_jp: str | None = None
    title_romaji: str | None = None
    image_url: str | None = None
    image_sexual: float | None = None
    votecount: int
    rating: float | None = None
    year: int | None = None
    developer: str | None = None
    developer_original: str | None = None  # romanized form, for the title preference toggle
    tags: list[str] = []


class HigherLowerPool(BaseModel):
    pool: list[HigherLowerVN]
    count: int
    metric: str = "votecount"


@router.get("/higher-lower/pool", response_model=HigherLowerPool)
async def higher_lower_pool(
    # FastAPI injects Response (annotate as bare Response, not a union, or it tries to
    # build a Pydantic field and fails to start). No default, so it comes first.
    response: Response,
    olang: str = Query(default="ja", pattern=r"^[a-z]{2,5}$"),
    # SFW (default) drops covers the site would blur; NSFW keeps them (blurred client-side).
    nsfw: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
):
    """Popularity-ranked VN pool for the Higher or Lower game: every eligible title.

    Filtering runs at the DB so rounds can run client-side off this one fetch.
    Blacklisted covers are always excluded (the proxy would replace them with a
    placeholder anyway). SFW (the default) also drops covers at or above the site's
    1.5 blur threshold, so the pool is exactly what the site shows unblurred. NSFW
    keeps those covers; the client blurs them with the site's usual reveal flow.

    rating and released are required so every pool entry can be compared by any of
    the game's modes (votes, rating, release year). Bump the cache key version below
    when the query changes so a stale Redis pool is not served.
    """
    cache = get_cache()
    cache_key = f"games:hl:pool:v12:{olang}:{int(nsfw)}"
    cached = await cache.get(cache_key)

    if cached is None:
        stmt = (
            select(
                VisualNovel.id,
                VisualNovel.title,
                VisualNovel.title_jp,
                VisualNovel.title_romaji,
                VisualNovel.image_url,
                VisualNovel.image_sexual,
                VisualNovel.votecount,
                VisualNovel.rating,
                func.extract("year", VisualNovel.released).label("year"),
            )
            .where(VisualNovel.olang == olang)
            .where(VisualNovel.image_url.isnot(None))
            .where(VisualNovel.votecount >= 10)  # floor out unknowable obscurities
            .where(VisualNovel.rating.isnot(None))
            .where(VisualNovel.released.isnot(None))
            .where(VisualNovel.id.notin_(select(CoverBlacklist.vn_id)))
        )
        if not nsfw:
            stmt = stmt.where(func.coalesce(VisualNovel.image_sexual, 0) < SFW_MAX_SEXUAL)
        stmt = stmt.order_by(VisualNovel.votecount.desc())
        rows = (await db.execute(stmt)).all()

        # Developers are not denormalized on the VN, so fetch one per VN in a single
        # batch join. DISTINCT ON keeps the developer of the earliest official, non-patch
        # release, which is the original developer (not a later port or remaster studio).
        vn_ids = [r.id for r in rows]
        dev_map: dict[str, tuple[str, str | None]] = {}
        if vn_ids:
            dev_rows = (
                await db.execute(
                    select(ReleaseVN.vn_id, Producer.name, Producer.original)
                    .distinct(ReleaseVN.vn_id)
                    .join(Release, Release.id == ReleaseVN.release_id)
                    .join(ReleaseProducer, ReleaseProducer.release_id == ReleaseVN.release_id)
                    .join(Producer, Producer.id == ReleaseProducer.producer_id)
                    .where(ReleaseVN.vn_id.in_(vn_ids))
                    .where(ReleaseProducer.developer.is_(True))
                    .where(Release.official.is_(True))
                    .where(Release.patch.is_(False))
                    .order_by(ReleaseVN.vn_id, Release.released.asc().nulls_last(), Producer.name)
                )
            ).all()
            dev_map = {vid: (name, original) for vid, name, original in dev_rows}

        # Top spoiler-free content tags per VN: a genre preview and a soft signal to
        # guess by (window-ranked by relevance, never ero or spoiler tags).
        tag_map: dict[str, list[str]] = {}
        if vn_ids:
            rn = func.row_number().over(
                partition_by=VNTag.vn_id,
                order_by=(VNTag.score.desc(), Tag.vn_count.desc()),
            ).label("rn")
            tag_sub = (
                select(VNTag.vn_id.label("vn_id"), Tag.name.label("name"), rn)
                .join(Tag, Tag.id == VNTag.tag_id)
                .where(VNTag.vn_id.in_(vn_ids))
                .where(VNTag.spoiler_level == 0)
                .where(VNTag.lie.is_(False))
                .where(VNTag.score >= 1.0)
                .where(Tag.category == "cont")  # VNDB code for content tags (not ero/tech)
                .where(Tag.searchable.is_(True))
                .subquery()
            )
            tag_rows = (
                await db.execute(
                    select(tag_sub.c.vn_id, tag_sub.c.name)
                    .where(tag_sub.c.rn <= 3)
                    .order_by(tag_sub.c.vn_id, tag_sub.c.rn)
                )
            ).all()
            for vid, name in tag_rows:
                tag_map.setdefault(vid, []).append(name)

        pool = [
            {
                "id": r.id,
                "title": r.title,
                "title_jp": r.title_jp,
                "title_romaji": r.title_romaji,
                "image_url": r.image_url,
                "image_sexual": r.image_sexual,
                "votecount": r.votecount,
                "rating": r.rating,
                "year": int(r.year) if r.year is not None else None,
                "developer": dev_map.get(r.id, (None, None))[0],
                "developer_original": dev_map.get(r.id, (None, None))[1],
                "tags": tag_map.get(r.id, []),
            }
            for r in rows
        ]
        cached = {"pool": pool, "count": len(pool), "metric": "votecount"}
        await cache.set(cache_key, cached, ttl=POOL_CACHE_TTL)

    response.headers["Cache-Control"] = "public, max-age=300, stale-while-revalidate=3600"
    return HigherLowerPool(**cached)
