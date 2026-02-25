"""Visual Novel metadata endpoints."""

import asyncio
import logging
import re
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete, case, and_, or_, text
from sqlalchemy.dialects.postgresql import insert

from slowapi import Limiter
from slowapi.util import get_remote_address

from app.db.database import get_db, async_session_maker
from app.db import schemas
from app.db.models import VisualNovel, Tag, VNTag, Trait, VNSimilarity, VNCoOccurrence, CharacterVN, CharacterTrait, Character, Producer, Release, ReleaseVN, ReleaseProducer, ReleasePlatform, Staff, VNStaff, VNSeiyuu, VNRelation, ExtlinksMaster, VNExtlink, WikidataEntry, ReleaseExtlink
from app.services.extlinks_service import build_extlink_url, build_wikidata_links, get_site_label, SHOP_SITES, LINK_SITES, LINK_SORT_ORDER, SHOP_SORT_ORDER, DEPRECATED_SITES, TRANSLATION_ONLY_SITES, NON_JP_CONSOLE_STORES
from app.core.vndb_client import get_vndb_client
from app.core.auth import require_admin
from app.core.cache import get_cache

logger = logging.getLogger(__name__)

router = APIRouter()
limiter = Limiter(key_func=get_remote_address)

# Security: maximum number of IDs allowed in comma-separated filter parameters
# to prevent DoS via excessively complex queries (each ID can generate a subquery)
MAX_FILTER_IDS = 30

# Genre tags used for percentile ranking in vote-stats endpoint
_GENRE_TAGS = [
    "Romance", "Drama", "Mystery", "Horror", "Action", "Fantasy", "Comedy",
    "Science Fiction", "Thriller", "Slice of Life", "Nakige", "Utsuge",
    "Adventure", "Supernatural", "Tragedy", "War", "Nukige", "Otome Game",
]

# VN length category labels (matches VNDB length field values 1-5)
_LENGTH_LABELS = {1: "Very Short", 2: "Short", 3: "Medium", 4: "Long", 5: "Very Long"}

# Minute ranges for each length category — must match get_length_filter() in search_vns
_LENGTH_RANGES = {
    1: (None, 120),      # Very Short: < 2h
    2: (120, 600),       # Short: 2-10h
    3: (600, 1800),      # Medium: 10-30h
    4: (1800, 3000),     # Long: 30-50h
    5: (3000, None),     # Very Long: 50h+
}


def _parse_id_list(value: str, max_items: int = MAX_FILTER_IDS) -> list[int]:
    """Parse a comma-separated string of numeric IDs with a safety cap."""
    ids = [int(t.strip()) for t in value.split(",") if t.strip().isdigit()]
    if len(ids) > max_items:
        raise HTTPException(
            status_code=400,
            detail=f"Too many filter IDs (max {max_items})",
        )
    return ids


def _parse_str_list(value: str, max_items: int = MAX_FILTER_IDS) -> list[str]:
    """Parse a comma-separated string of string IDs with a safety cap."""
    items = [s.strip() for s in value.split(",") if s.strip()]
    if len(items) > max_items:
        raise HTTPException(
            status_code=400,
            detail=f"Too many filter IDs (max {max_items})",
        )
    return items


def _escape_like(value: str) -> str:
    """Escape SQL LIKE wildcard characters in user input."""
    return value.replace('%', r'\%').replace('_', r'\_')


# NOTE: Route order matters in FastAPI!
# More specific routes must be defined BEFORE parameterized routes like /{vn_id}


@router.get("/sitemap-ids", include_in_schema=False)
async def get_vn_sitemap_ids(
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=10000, ge=0, le=50000),
    db: AsyncSession = Depends(get_db),
):
    """Get VN IDs and updated_at timestamps for sitemap generation.

    Lightweight endpoint that returns only the data needed to build sitemaps.
    Use limit=0 to get just the total count.
    """
    count_result = await db.execute(select(func.count(VisualNovel.id)))
    total = count_result.scalar_one()

    items = []
    if limit > 0:
        result = await db.execute(
            select(VisualNovel.id, VisualNovel.updated_at)
            .order_by(VisualNovel.id)
            .offset(offset)
            .limit(limit)
        )
        items = [
            {"id": row.id, "updated_at": row.updated_at.isoformat() if row.updated_at else None}
            for row in result
        ]

    return {"items": items, "total": total}


@router.get("/random/")
async def random_vn(
    db: AsyncSession = Depends(get_db),
):
    """Get a random visual novel ID (Japanese, rated, with 10+ votes)."""
    result = await db.execute(
        select(VisualNovel.id)
        .where(VisualNovel.olang == "ja")
        .where(VisualNovel.rating.isnot(None))
        .where(VisualNovel.votecount >= 10)
        .order_by(func.random())
        .limit(1)
    )
    vn_id = result.scalar_one_or_none()
    if not vn_id:
        return {"id": None}
    return {"id": vn_id}


@router.get("/search/", response_model=schemas.VNSearchResponse)
async def search_vns(
    # Text search
    q: str | None = Query(default=None, description="Search query for title"),
    first_char: str | None = Query(default=None, description="Filter by first letter (A-Z) or # for non-alpha"),

    # Tag filtering
    tags: str | None = Query(default=None, description="Comma-separated tag IDs to include"),
    exclude_tags: str | None = Query(default=None, description="Comma-separated tag IDs to exclude"),
    tag_mode: str = Query(default="and", description="Tag matching mode: 'and' (all tags) or 'or' (any tag)"),

    # Trait filtering (character traits)
    traits: str | None = Query(default=None, description="Comma-separated trait IDs to include"),
    exclude_traits: str | None = Query(default=None, description="Comma-separated trait IDs to exclude"),

    # Child tag/trait inclusion
    include_children: bool = Query(default=False, description="Include child tags/traits in filter (matches VNDB tag page behavior)"),

    # Numeric filters
    year_min: int | None = Query(default=None, description="Minimum release year"),
    year_max: int | None = Query(default=None, description="Maximum release year"),
    min_rating: float | None = Query(default=None, ge=0, le=10, description="Minimum rating"),
    max_rating: float | None = Query(default=None, ge=0, le=10, description="Maximum rating"),
    min_votecount: int | None = Query(default=None, ge=0, description="Minimum vote count"),
    max_votecount: int | None = Query(default=None, ge=0, description="Maximum vote count"),

    # Category filters (support comma-separated values for multi-select)
    length: str | None = Query(default=None, description="Length: very_short, short, medium, long, very_long (comma-separated)"),
    minage: str | None = Query(default=None, description="Age rating: all_ages, teen, adult (comma-separated)"),
    devstatus: str | None = Query(default="0", description="Dev status: 0=finished, 1=in_dev, 2=cancelled, -1=all (comma-separated)"),
    olang: str | None = Query(default=None, description="Original language code (ja, en, zh, etc.) (comma-separated)"),
    platform: str | None = Query(default=None, description="Platform (win, lin, mac, web, and, ios, swi, ps4, ps5) (comma-separated)"),

    # Exclude filters
    exclude_length: str | None = Query(default=None, description="Exclude lengths (comma-separated)"),
    exclude_minage: str | None = Query(default=None, description="Exclude age ratings (comma-separated)"),
    exclude_devstatus: str | None = Query(default=None, description="Exclude dev statuses (comma-separated)"),
    exclude_olang: str | None = Query(default=None, description="Exclude languages (comma-separated)"),
    exclude_platform: str | None = Query(default=None, description="Exclude platforms (comma-separated)"),

    # Entity filters (staff, seiyuu, developer, publisher, producer)
    staff: str | None = Query(default=None, description="Comma-separated staff IDs to filter by"),
    seiyuu: str | None = Query(default=None, description="Comma-separated seiyuu (staff) IDs to filter by"),
    developer: str | None = Query(default=None, description="Comma-separated developer (producer) IDs to filter by"),
    publisher: str | None = Query(default=None, description="Comma-separated publisher (producer) IDs to filter by"),
    producer: str | None = Query(default=None, description="Comma-separated producer IDs to filter by (matches developer OR publisher role)"),

    # Spoiler filter (for tag/trait searches)
    spoiler_level: int = Query(default=0, ge=0, le=2, description="Max spoiler level: 0=none, 1=minor, 2=major"),

    # Content filters
    nsfw: bool = Query(default=False, description="Include adult (18+) content"),

    # Sorting & pagination
    sort: str = Query(default="rating", description="Sort: rating, released, votecount, title, random"),
    sort_order: str = Query(default="desc", description="Sort order: asc, desc"),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=24, ge=1, le=100),

    response: Response = None,
    db: AsyncSession = Depends(get_db),
):
    """
    Search and filter visual novels with comprehensive options.

    Supports:
    - Text search by title
    - Alphabetical filtering (A-Z, #)
    - Tag include/exclude with AND/OR modes
    - Year range, rating range
    - Length, age rating, platform, language filters
    - NSFW content toggle
    - Multiple sort options
    """
    import time
    import hashlib
    start_time = time.time()

    # Redis cache: 60s TTL for browse results (data only changes daily)
    cache = get_cache()
    cache_params = (
        q, first_char, tags, exclude_tags, tag_mode, traits, exclude_traits,
        include_children, year_min, year_max, min_rating, max_rating, min_votecount, max_votecount,
        length, minage, devstatus, olang, platform,
        exclude_length, exclude_minage, exclude_devstatus, exclude_olang, exclude_platform,
        staff, seiyuu, developer, publisher, producer,
        spoiler_level, nsfw, sort, sort_order, page, limit,
    )
    cache_key = f"browse:{hashlib.sha256(str(cache_params).encode()).hexdigest()}"
    if sort != "random":
        cached = await cache.get(cache_key)
        if cached:
            cached["query_time"] = round(time.time() - start_time, 3)
            if response is not None:
                response.headers["Cache-Control"] = "public, max-age=30, stale-while-revalidate=300"
            return schemas.VNSearchResponse(**cached)

    # Only select the columns needed for VNSummary response
    _browse_columns = [
        VisualNovel.id, VisualNovel.title, VisualNovel.title_jp,
        VisualNovel.title_romaji, VisualNovel.image_url, VisualNovel.image_sexual,
        VisualNovel.released, VisualNovel.rating, VisualNovel.votecount,
        VisualNovel.olang,
    ]
    # Include description snippet only for text searches (used by search bar dropdown)
    if q:
        _browse_columns.append(func.left(VisualNovel.description, 200).label('description'))
    query = select(*_browse_columns)
    count_query = select(func.count(VisualNovel.id))

    # Text search
    if q:
        eq = _escape_like(q)
        # Direct substring match
        search_filter = or_(
            VisualNovel.title.ilike(f"%{eq}%"),
            VisualNovel.title_jp.ilike(f"%{eq}%"),
            VisualNovel.title_romaji.ilike(f"%{eq}%"),
            func.array_to_string(VisualNovel.aliases, ' ').ilike(f"%{eq}%"),
        )
        # Normalized match: strip punctuation/spaces so "muvluv" matches "Muv-Luv",
        # "steinsgate" matches "Steins;Gate", "fatestaynight" matches "Fate/stay night", etc.
        normalized_q = re.sub(r'[^a-zA-Z0-9]', '', q)
        if len(normalized_q) >= 2:
            _strip = lambda col: func.regexp_replace(col, '[^a-zA-Z0-9]', '', 'g')
            search_filter = or_(
                search_filter,
                _strip(VisualNovel.title).ilike(f"%{normalized_q}%"),
                _strip(VisualNovel.title_romaji).ilike(f"%{normalized_q}%"),
                _strip(func.array_to_string(VisualNovel.aliases, ' ')).ilike(f"%{normalized_q}%"),
            )
        query = query.where(search_filter)
        count_query = count_query.where(search_filter)

    # First character filter - check both title and title_romaji
    if first_char:
        if first_char == "#":
            # Non-alphabetic: neither title NOR title_romaji starts with A-Z
            char_filter = and_(
                ~VisualNovel.title.op("~")(r"^[A-Za-z]"),
                or_(VisualNovel.title_romaji.is_(None), ~VisualNovel.title_romaji.op("~")(r"^[A-Za-z]"))
            )
        else:
            # Alphabetic: title OR title_romaji starts with the letter
            efc = _escape_like(first_char)
            char_filter = or_(
                VisualNovel.title.ilike(f"{efc}%"),
                VisualNovel.title_romaji.ilike(f"{efc}%")
            )
        query = query.where(char_filter)
        count_query = count_query.where(char_filter)

    # Year range filter
    if year_min:
        year_filter = func.extract("year", VisualNovel.released) >= year_min
        query = query.where(year_filter)
        count_query = count_query.where(year_filter)

    if year_max:
        year_filter = func.extract("year", VisualNovel.released) <= year_max
        query = query.where(year_filter)
        count_query = count_query.where(year_filter)

    # Rating range
    if min_rating is not None:
        query = query.where(VisualNovel.rating >= min_rating)
        count_query = count_query.where(VisualNovel.rating >= min_rating)

    if max_rating is not None:
        query = query.where(VisualNovel.rating < max_rating)
        count_query = count_query.where(VisualNovel.rating < max_rating)

    # Vote count range
    if min_votecount is not None:
        query = query.where(VisualNovel.votecount >= min_votecount)
        count_query = count_query.where(VisualNovel.votecount >= min_votecount)

    if max_votecount is not None:
        query = query.where(VisualNovel.votecount <= max_votecount)
        count_query = count_query.where(VisualNovel.votecount <= max_votecount)

    # Length filter (using length_minutes when available)
    # Helper function for length filter conditions
    # Must match length_to_categories() logic: treat length_minutes <= 0 as invalid
    # and fall back to the legacy length field in those cases.
    def get_length_filter(length_key: str):
        length_ranges = {
            "very_short": (None, 120),      # < 2 hours
            "short": (120, 600),            # 2-10 hours
            "medium": (600, 1800),          # 10-30 hours
            "long": (1800, 3000),           # 30-50 hours
            "very_long": (3000, None),      # 50+ hours
        }
        length_values = {"very_short": 1, "short": 2, "medium": 3, "long": 4, "very_long": 5}
        if length_key not in length_ranges:
            return None
        min_len, max_len = length_ranges[length_key]
        conditions = []
        # Use length_minutes only when it's positive (valid data)
        if min_len is not None and max_len is not None:
            conditions.append((VisualNovel.length_minutes > 0) & (VisualNovel.length_minutes >= min_len) & (VisualNovel.length_minutes < max_len))
        elif min_len is not None:
            conditions.append((VisualNovel.length_minutes > 0) & (VisualNovel.length_minutes >= min_len))
        elif max_len is not None:
            conditions.append((VisualNovel.length_minutes > 0) & (VisualNovel.length_minutes < max_len))
        # Fall back to length category when length_minutes is null or non-positive
        conditions.append(
            or_(VisualNovel.length_minutes.is_(None), VisualNovel.length_minutes <= 0) &
            (VisualNovel.length == length_values[length_key])
        )
        return or_(*conditions)

    if length:
        length_values = [v.strip() for v in length.split(",") if v.strip()]
        if length_values:
            length_conditions = [get_length_filter(lv) for lv in length_values if get_length_filter(lv) is not None]
            if length_conditions:
                len_filter = or_(*length_conditions)
                query = query.where(len_filter)
                count_query = count_query.where(len_filter)

    if exclude_length:
        exclude_length_values = [v.strip() for v in exclude_length.split(",") if v.strip()]
        if exclude_length_values:
            exclude_conditions = [get_length_filter(lv) for lv in exclude_length_values if get_length_filter(lv) is not None]
            if exclude_conditions:
                exclude_filter = ~or_(*exclude_conditions)
                query = query.where(exclude_filter)
                count_query = count_query.where(exclude_filter)

    # Age rating filter
    def get_age_filter(age_key: str):
        if age_key == "all_ages":
            return VisualNovel.minage <= 12
        elif age_key == "teen":
            return (VisualNovel.minage > 12) & (VisualNovel.minage <= 17)
        elif age_key == "adult":
            return VisualNovel.minage >= 18
        return None

    if minage:
        minage_values = [v.strip() for v in minage.split(",") if v.strip()]
        if minage_values:
            age_conditions = [get_age_filter(av) for av in minage_values if get_age_filter(av) is not None]
            if age_conditions:
                age_filter = or_(*age_conditions)
                query = query.where(age_filter)
                count_query = count_query.where(age_filter)

    if exclude_minage:
        exclude_minage_values = [v.strip() for v in exclude_minage.split(",") if v.strip()]
        if exclude_minage_values:
            exclude_age_conditions = [get_age_filter(av) for av in exclude_minage_values if get_age_filter(av) is not None]
            if exclude_age_conditions:
                exclude_age_filter = ~or_(*exclude_age_conditions)
                query = query.where(exclude_age_filter)
                count_query = count_query.where(exclude_age_filter)

    # Development status filter (default: finished only)
    # Parse devstatus as comma-separated values (-1 means all/no filter)
    if devstatus and devstatus != "-1":
        devstatus_values = [int(v.strip()) for v in devstatus.split(",") if v.strip().lstrip('-').isdigit() and int(v.strip()) >= 0]
        if devstatus_values:
            if len(devstatus_values) == 1:
                status_filter = VisualNovel.devstatus == devstatus_values[0]
            else:
                status_filter = VisualNovel.devstatus.in_(devstatus_values)
            query = query.where(status_filter)
            count_query = count_query.where(status_filter)

    if exclude_devstatus:
        exclude_devstatus_values = [int(v.strip()) for v in exclude_devstatus.split(",") if v.strip().lstrip('-').isdigit() and int(v.strip()) >= 0]
        if exclude_devstatus_values:
            exclude_status_filter = ~VisualNovel.devstatus.in_(exclude_devstatus_values)
            query = query.where(exclude_status_filter)
            count_query = count_query.where(exclude_status_filter)

    # Original language filter
    if olang:
        olang_values = [v.strip() for v in olang.split(",") if v.strip()]
        if olang_values:
            if len(olang_values) == 1:
                lang_filter = VisualNovel.olang == olang_values[0]
            else:
                lang_filter = VisualNovel.olang.in_(olang_values)
            query = query.where(lang_filter)
            count_query = count_query.where(lang_filter)

    if exclude_olang:
        exclude_olang_values = [v.strip() for v in exclude_olang.split(",") if v.strip()]
        if exclude_olang_values:
            exclude_lang_filter = ~VisualNovel.olang.in_(exclude_olang_values)
            query = query.where(exclude_lang_filter)
            count_query = count_query.where(exclude_lang_filter)

    # Platform filter (query through release_vn and release_platforms tables)
    if platform:
        platform_values = [v.strip() for v in platform.split(",") if v.strip()]
        if platform_values:
            platform_subquery = (
                select(ReleaseVN.vn_id)
                .join(ReleasePlatform, ReleaseVN.release_id == ReleasePlatform.release_id)
                .where(ReleasePlatform.platform.in_(platform_values))
                .where(ReleaseVN.rtype == 'complete')
                .distinct()
            )
            query = query.where(VisualNovel.id.in_(platform_subquery))
            count_query = count_query.where(VisualNovel.id.in_(platform_subquery))

    if exclude_platform:
        exclude_platform_values = [v.strip() for v in exclude_platform.split(",") if v.strip()]
        if exclude_platform_values:
            exclude_platform_subquery = (
                select(ReleaseVN.vn_id)
                .join(ReleasePlatform, ReleaseVN.release_id == ReleasePlatform.release_id)
                .where(ReleasePlatform.platform.in_(exclude_platform_values))
                .where(ReleaseVN.rtype == 'complete')
                .distinct()
            )
            query = query.where(~VisualNovel.id.in_(exclude_platform_subquery))
            count_query = count_query.where(~VisualNovel.id.in_(exclude_platform_subquery))

    # NSFW filter (when false, exclude 18+ content)
    if not nsfw:
        nsfw_filter = or_(
            VisualNovel.minage < 18,
            VisualNovel.minage.is_(None)
        )
        query = query.where(nsfw_filter)
        count_query = count_query.where(nsfw_filter)

    # Tag include filter
    if tags:
        original_tag_ids = _parse_id_list(tags)
        if original_tag_ids:
            if tag_mode == "or":
                # OR mode: VN has ANY of the specified tags (or their children if include_children)
                if include_children:
                    # Collect all tag IDs including children for ALL specified tags
                    all_expanded_ids = []
                    for orig_tag_id in original_tag_ids:
                        descendant_result = await db.execute(
                            text("""
                                WITH RECURSIVE tag_tree AS (
                                    SELECT id FROM tags WHERE id = :tag_id
                                    UNION ALL
                                    SELECT tp.tag_id AS id FROM tag_parents tp JOIN tag_tree tt ON tp.parent_id = tt.id
                                )
                                SELECT DISTINCT id FROM tag_tree
                            """),
                            {"tag_id": orig_tag_id}
                        )
                        expanded_ids = [row[0] for row in descendant_result.fetchall()]
                        all_expanded_ids.extend(expanded_ids)
                    # Single subquery: match ANY of these tags
                    tag_subquery = select(VNTag.vn_id).where(
                        VNTag.tag_id.in_(all_expanded_ids),
                        VNTag.score >= 0,
                        VNTag.lie == False,
                        VNTag.spoiler_level <= spoiler_level,
                    ).distinct()
                else:
                    # OR mode without children: match any of the original tags
                    tag_subquery = select(VNTag.vn_id).where(
                        VNTag.tag_id.in_(original_tag_ids),
                        VNTag.score >= 0,
                        VNTag.lie == False,
                        VNTag.spoiler_level <= spoiler_level,
                    ).distinct()
                query = query.where(VisualNovel.id.in_(tag_subquery))
                count_query = count_query.where(VisualNovel.id.in_(tag_subquery))
            else:
                # AND mode (default): VN must have ALL specified tags
                if include_children:
                    # For each original tag, get it plus all descendants
                    # Require: (tag1 OR its children) AND (tag2 OR its children) etc.
                    for orig_tag_id in original_tag_ids:
                        descendant_result = await db.execute(
                            text("""
                                WITH RECURSIVE tag_tree AS (
                                    SELECT id FROM tags WHERE id = :tag_id
                                    UNION ALL
                                    SELECT tp.tag_id AS id FROM tag_parents tp JOIN tag_tree tt ON tp.parent_id = tt.id
                                )
                                SELECT DISTINCT id FROM tag_tree
                            """),
                            {"tag_id": orig_tag_id}
                        )
                        expanded_ids = [row[0] for row in descendant_result.fetchall()]
                        subquery = select(VNTag.vn_id).where(
                            VNTag.tag_id.in_(expanded_ids),
                            VNTag.score >= 0,
                            VNTag.lie == False,
                            VNTag.spoiler_level <= spoiler_level,
                        ).distinct()
                        query = query.where(VisualNovel.id.in_(subquery))
                        count_query = count_query.where(VisualNovel.id.in_(subquery))
                else:
                    # AND mode without children: must have each exact tag
                    for tag_id in original_tag_ids:
                        subquery = select(VNTag.vn_id).where(
                            VNTag.tag_id == tag_id,
                            VNTag.score >= 0,
                            VNTag.lie == False,
                            VNTag.spoiler_level <= spoiler_level,
                        )
                        query = query.where(VisualNovel.id.in_(subquery))
                        count_query = count_query.where(VisualNovel.id.in_(subquery))

    # Tag exclude filter
    if exclude_tags:
        exclude_tag_ids = _parse_id_list(exclude_tags)
        for tag_id in exclude_tag_ids:
            exclude_subquery = select(VNTag.vn_id).where(VNTag.tag_id == tag_id)
            query = query.where(~VisualNovel.id.in_(exclude_subquery))
            count_query = count_query.where(~VisualNovel.id.in_(exclude_subquery))

    # Trait include filter (query through character_traits → character_vn → vn)
    if traits:
        trait_ids = _parse_id_list(traits)
        if trait_ids:
            if tag_mode == "or":
                # OR mode: VN has character with any of the specified traits
                # Filter: spoiler_level <= max
                trait_subquery = (
                    select(CharacterVN.vn_id)
                    .join(CharacterTrait, CharacterVN.character_id == CharacterTrait.character_id)
                    .where(
                        CharacterTrait.trait_id.in_(trait_ids),
                        CharacterTrait.spoiler_level <= spoiler_level,
                    )
                    .distinct()
                )
                query = query.where(VisualNovel.id.in_(trait_subquery))
                count_query = count_query.where(VisualNovel.id.in_(trait_subquery))
            else:
                # AND mode (default): VN has character(s) with all specified traits
                # Filter: spoiler_level <= max
                for trait_id in trait_ids:
                    trait_subquery = (
                        select(CharacterVN.vn_id)
                        .join(CharacterTrait, CharacterVN.character_id == CharacterTrait.character_id)
                        .where(
                            CharacterTrait.trait_id == trait_id,
                            CharacterTrait.spoiler_level <= spoiler_level,
                        )
                        .distinct()
                    )
                    query = query.where(VisualNovel.id.in_(trait_subquery))
                    count_query = count_query.where(VisualNovel.id.in_(trait_subquery))

    # Trait exclude filter
    if exclude_traits:
        exclude_trait_ids = _parse_id_list(exclude_traits)
        for trait_id in exclude_trait_ids:
            exclude_trait_subquery = (
                select(CharacterVN.vn_id)
                .join(CharacterTrait, CharacterVN.character_id == CharacterTrait.character_id)
                .where(CharacterTrait.trait_id == trait_id)
                .distinct()
            )
            query = query.where(~VisualNovel.id.in_(exclude_trait_subquery))
            count_query = count_query.where(~VisualNovel.id.in_(exclude_trait_subquery))

    # Staff filter
    if staff:
        staff_ids = _parse_str_list(staff)
        if staff_ids:
            staff_sub = select(VNStaff.vn_id).where(VNStaff.staff_id.in_(staff_ids)).distinct()
            query = query.where(VisualNovel.id.in_(staff_sub))
            count_query = count_query.where(VisualNovel.id.in_(staff_sub))

    # Seiyuu filter
    if seiyuu:
        seiyuu_ids = _parse_str_list(seiyuu)
        if seiyuu_ids:
            seiyuu_sub = select(VNSeiyuu.vn_id).where(VNSeiyuu.staff_id.in_(seiyuu_ids)).distinct()
            query = query.where(VisualNovel.id.in_(seiyuu_sub))
            count_query = count_query.where(VisualNovel.id.in_(seiyuu_sub))

    # Developer filter (through release_vn -> release_producers)
    if developer:
        dev_ids = _parse_str_list(developer)
        if dev_ids:
            dev_sub = (
                select(ReleaseVN.vn_id)
                .join(ReleaseProducer, ReleaseVN.release_id == ReleaseProducer.release_id)
                .where(ReleaseProducer.producer_id.in_(dev_ids))
                .where(ReleaseProducer.developer == True)
                .distinct()
            )
            query = query.where(VisualNovel.id.in_(dev_sub))
            count_query = count_query.where(VisualNovel.id.in_(dev_sub))

    # Publisher filter (through release_vn -> release_producers)
    if publisher:
        pub_ids = _parse_str_list(publisher)
        if pub_ids:
            pub_sub = (
                select(ReleaseVN.vn_id)
                .join(ReleaseProducer, ReleaseVN.release_id == ReleaseProducer.release_id)
                .where(ReleaseProducer.producer_id.in_(pub_ids))
                .where(ReleaseProducer.publisher == True)
                .distinct()
            )
            query = query.where(VisualNovel.id.in_(pub_sub))
            count_query = count_query.where(VisualNovel.id.in_(pub_sub))

    # Producer filter (matches developer OR publisher role)
    # Used by producer stats pages to link to browse with all VNs by a producer
    if producer:
        prod_ids = _parse_str_list(producer)
        if prod_ids:
            # Match VNs where the producer is either developer OR publisher
            prod_sub = (
                select(ReleaseVN.vn_id)
                .join(ReleaseProducer, ReleaseVN.release_id == ReleaseProducer.release_id)
                .where(ReleaseProducer.producer_id.in_(prod_ids))
                .where(or_(ReleaseProducer.developer == True, ReleaseProducer.publisher == True))
                .distinct()
            )
            query = query.where(VisualNovel.id.in_(prod_sub))
            count_query = count_query.where(VisualNovel.id.in_(prod_sub))

    # Sorting - always include secondary sort by ID for stable pagination
    if sort == "random":
        query = query.order_by(func.random())
    else:
        sort_columns = {
            "rating": VisualNovel.rating,
            "released": VisualNovel.released,
            "votecount": VisualNovel.votecount,
            "title": VisualNovel.title,
        }
        sort_col = sort_columns.get(sort, VisualNovel.rating)
        if sort_order == "asc":
            query = query.order_by(sort_col.asc().nullslast(), VisualNovel.id.asc())
        else:
            query = query.order_by(sort_col.desc().nullslast(), VisualNovel.id.asc())

    # Pagination
    offset = (page - 1) * limit
    query = query.offset(offset).limit(limit)

    # Execute main query and count query in parallel using separate sessions.
    # asyncpg doesn't support concurrent queries on the same connection, so
    # the count query runs on a separate session from the pool.
    async def _run_count(q):
        async with async_session_maker() as s:
            r = await s.execute(q)
            return r.scalar_one_or_none() or 0

    result, total = await asyncio.gather(
        db.execute(query),
        _run_count(count_query),
    )
    vns = result.all()

    # Calculate total_with_spoilers when filtering by tags/traits with spoiler_level < 2
    total_with_spoilers = None
    has_tag_or_trait_filter = bool(tags) or bool(traits)
    if has_tag_or_trait_filter and spoiler_level < 2:
        # Build a count query with spoiler_level=2 to get the count including all spoilers
        spoiler_count_query = select(func.count(VisualNovel.id))

        # Apply all non-tag/trait filters (same as above)
        if q:
            eq = _escape_like(q)
            search_filter = or_(
                VisualNovel.title.ilike(f"%{eq}%"),
                VisualNovel.title_jp.ilike(f"%{eq}%"),
                VisualNovel.title_romaji.ilike(f"%{eq}%"),
            )
            spoiler_count_query = spoiler_count_query.where(search_filter)
        if first_char:
            if first_char == "#":
                char_filter = ~VisualNovel.title.op("~")(r"^[A-Za-z]")
            else:
                efc = _escape_like(first_char)
                char_filter = VisualNovel.title.ilike(f"{efc}%")
            spoiler_count_query = spoiler_count_query.where(char_filter)
        if year_min:
            spoiler_count_query = spoiler_count_query.where(func.extract("year", VisualNovel.released) >= year_min)
        if year_max:
            spoiler_count_query = spoiler_count_query.where(func.extract("year", VisualNovel.released) <= year_max)
        if min_rating is not None:
            spoiler_count_query = spoiler_count_query.where(VisualNovel.rating >= min_rating)
        if max_rating is not None:
            spoiler_count_query = spoiler_count_query.where(VisualNovel.rating < max_rating)
        if min_votecount is not None:
            spoiler_count_query = spoiler_count_query.where(VisualNovel.votecount >= min_votecount)
        if max_votecount is not None:
            spoiler_count_query = spoiler_count_query.where(VisualNovel.votecount <= max_votecount)
        if length:
            length_values = [v.strip() for v in length.split(",") if v.strip()]
            if length_values:
                length_conditions = [get_length_filter(lv) for lv in length_values if get_length_filter(lv) is not None]
                if length_conditions:
                    spoiler_count_query = spoiler_count_query.where(or_(*length_conditions))
        if exclude_length:
            exclude_length_values = [v.strip() for v in exclude_length.split(",") if v.strip()]
            if exclude_length_values:
                exclude_conditions = [get_length_filter(lv) for lv in exclude_length_values if get_length_filter(lv) is not None]
                if exclude_conditions:
                    spoiler_count_query = spoiler_count_query.where(~or_(*exclude_conditions))
        if minage:
            minage_values = [v.strip() for v in minage.split(",") if v.strip()]
            if minage_values:
                age_conditions = [get_age_filter(av) for av in minage_values if get_age_filter(av) is not None]
                if age_conditions:
                    spoiler_count_query = spoiler_count_query.where(or_(*age_conditions))
        if exclude_minage:
            exclude_minage_values = [v.strip() for v in exclude_minage.split(",") if v.strip()]
            if exclude_minage_values:
                exclude_age_conditions = [get_age_filter(av) for av in exclude_minage_values if get_age_filter(av) is not None]
                if exclude_age_conditions:
                    spoiler_count_query = spoiler_count_query.where(~or_(*exclude_age_conditions))
        if devstatus and devstatus != "-1":
            devstatus_values = [int(v.strip()) for v in devstatus.split(",") if v.strip().lstrip('-').isdigit() and int(v.strip()) >= 0]
            if devstatus_values:
                if len(devstatus_values) == 1:
                    spoiler_count_query = spoiler_count_query.where(VisualNovel.devstatus == devstatus_values[0])
                else:
                    spoiler_count_query = spoiler_count_query.where(VisualNovel.devstatus.in_(devstatus_values))
        if exclude_devstatus:
            exclude_devstatus_values = [int(v.strip()) for v in exclude_devstatus.split(",") if v.strip().lstrip('-').isdigit() and int(v.strip()) >= 0]
            if exclude_devstatus_values:
                spoiler_count_query = spoiler_count_query.where(~VisualNovel.devstatus.in_(exclude_devstatus_values))
        if olang:
            olang_values = [v.strip() for v in olang.split(",") if v.strip()]
            if olang_values:
                if len(olang_values) == 1:
                    spoiler_count_query = spoiler_count_query.where(VisualNovel.olang == olang_values[0])
                else:
                    spoiler_count_query = spoiler_count_query.where(VisualNovel.olang.in_(olang_values))
        if exclude_olang:
            exclude_olang_values = [v.strip() for v in exclude_olang.split(",") if v.strip()]
            if exclude_olang_values:
                spoiler_count_query = spoiler_count_query.where(~VisualNovel.olang.in_(exclude_olang_values))
        if platform:
            platform_values = [v.strip() for v in platform.split(",") if v.strip()]
            if platform_values:
                platform_subquery = (
                    select(ReleaseVN.vn_id)
                    .join(ReleasePlatform, ReleaseVN.release_id == ReleasePlatform.release_id)
                    .where(ReleasePlatform.platform.in_(platform_values))
                    .where(ReleaseVN.rtype == 'complete')
                    .distinct()
                )
                spoiler_count_query = spoiler_count_query.where(VisualNovel.id.in_(platform_subquery))
        if exclude_platform:
            exclude_platform_values = [v.strip() for v in exclude_platform.split(",") if v.strip()]
            if exclude_platform_values:
                exclude_platform_subquery = (
                    select(ReleaseVN.vn_id)
                    .join(ReleasePlatform, ReleaseVN.release_id == ReleasePlatform.release_id)
                    .where(ReleasePlatform.platform.in_(exclude_platform_values))
                    .where(ReleaseVN.rtype == 'complete')
                    .distinct()
                )
                spoiler_count_query = spoiler_count_query.where(~VisualNovel.id.in_(exclude_platform_subquery))
        if not nsfw:
            spoiler_count_query = spoiler_count_query.where(or_(VisualNovel.minage < 18, VisualNovel.minage.is_(None)))

        # Apply tag filters WITH spoiler_level=2 (include all spoilers)
        if tags:
            original_tag_ids = _parse_id_list(tags)
            if original_tag_ids:
                if tag_mode == "or":
                    # OR mode: VN has ANY of the specified tags (or their children if include_children)
                    if include_children:
                        all_expanded_ids = []
                        for orig_tag_id in original_tag_ids:
                            descendant_result = await db.execute(
                                text("""
                                    WITH RECURSIVE tag_tree AS (
                                        SELECT id FROM tags WHERE id = :tag_id
                                        UNION ALL
                                        SELECT tp.tag_id AS id FROM tag_parents tp JOIN tag_tree tt ON tp.parent_id = tt.id
                                    )
                                    SELECT DISTINCT id FROM tag_tree
                                """),
                                {"tag_id": orig_tag_id}
                            )
                            expanded_ids = [row[0] for row in descendant_result.fetchall()]
                            all_expanded_ids.extend(expanded_ids)
                        tag_subquery = select(VNTag.vn_id).where(
                            VNTag.tag_id.in_(all_expanded_ids),
                            VNTag.score >= 0,
                            VNTag.lie == False,
                            VNTag.spoiler_level <= 2,  # Include all spoilers
                        ).distinct()
                    else:
                        tag_subquery = select(VNTag.vn_id).where(
                            VNTag.tag_id.in_(original_tag_ids),
                            VNTag.score >= 0,
                            VNTag.lie == False,
                            VNTag.spoiler_level <= 2,  # Include all spoilers
                        ).distinct()
                    spoiler_count_query = spoiler_count_query.where(VisualNovel.id.in_(tag_subquery))
                else:
                    # AND mode (default): VN must have ALL specified tags
                    if include_children:
                        for orig_tag_id in original_tag_ids:
                            descendant_result = await db.execute(
                                text("""
                                    WITH RECURSIVE tag_tree AS (
                                        SELECT id FROM tags WHERE id = :tag_id
                                        UNION ALL
                                        SELECT tp.tag_id AS id FROM tag_parents tp JOIN tag_tree tt ON tp.parent_id = tt.id
                                    )
                                    SELECT DISTINCT id FROM tag_tree
                                """),
                                {"tag_id": orig_tag_id}
                            )
                            expanded_ids = [row[0] for row in descendant_result.fetchall()]
                            subquery = select(VNTag.vn_id).where(
                                VNTag.tag_id.in_(expanded_ids),
                                VNTag.score >= 0,
                                VNTag.lie == False,
                                VNTag.spoiler_level <= 2,  # Include all spoilers
                            ).distinct()
                            spoiler_count_query = spoiler_count_query.where(VisualNovel.id.in_(subquery))
                    else:
                        for tag_id in original_tag_ids:
                            subquery = select(VNTag.vn_id).where(
                                VNTag.tag_id == tag_id,
                                VNTag.score >= 0,
                                VNTag.lie == False,
                                VNTag.spoiler_level <= 2,  # Include all spoilers
                            )
                            spoiler_count_query = spoiler_count_query.where(VisualNovel.id.in_(subquery))

        # Apply exclude tag filters (no spoiler restriction)
        if exclude_tags:
            exclude_tag_ids = _parse_id_list(exclude_tags)
            for tag_id in exclude_tag_ids:
                exclude_subquery = select(VNTag.vn_id).where(VNTag.tag_id == tag_id)
                spoiler_count_query = spoiler_count_query.where(~VisualNovel.id.in_(exclude_subquery))

        # Apply trait filters WITH spoiler_level=2 (include all spoilers)
        if traits:
            trait_ids = _parse_id_list(traits)
            if trait_ids:
                if tag_mode == "or":
                    trait_subquery = (
                        select(CharacterVN.vn_id)
                        .join(CharacterTrait, CharacterVN.character_id == CharacterTrait.character_id)
                        .where(
                            CharacterTrait.trait_id.in_(trait_ids),
                            CharacterTrait.spoiler_level <= 2,  # Include all spoilers
                        )
                        .distinct()
                    )
                    spoiler_count_query = spoiler_count_query.where(VisualNovel.id.in_(trait_subquery))
                else:
                    for trait_id in trait_ids:
                        trait_subquery = (
                            select(CharacterVN.vn_id)
                            .join(CharacterTrait, CharacterVN.character_id == CharacterTrait.character_id)
                            .where(
                                CharacterTrait.trait_id == trait_id,
                                CharacterTrait.spoiler_level <= 2,  # Include all spoilers
                            )
                            .distinct()
                        )
                        spoiler_count_query = spoiler_count_query.where(VisualNovel.id.in_(trait_subquery))

        # Apply exclude trait filters (no spoiler restriction)
        if exclude_traits:
            exclude_trait_ids = _parse_id_list(exclude_traits)
            for trait_id in exclude_trait_ids:
                exclude_trait_subquery = (
                    select(CharacterVN.vn_id)
                    .join(CharacterTrait, CharacterVN.character_id == CharacterTrait.character_id)
                    .where(CharacterTrait.trait_id == trait_id)
                    .distinct()
                )
                spoiler_count_query = spoiler_count_query.where(~VisualNovel.id.in_(exclude_trait_subquery))

        # Apply entity filters to spoiler count query too
        if staff:
            staff_ids = _parse_str_list(staff)
            if staff_ids:
                staff_sub = select(VNStaff.vn_id).where(VNStaff.staff_id.in_(staff_ids)).distinct()
                spoiler_count_query = spoiler_count_query.where(VisualNovel.id.in_(staff_sub))
        if seiyuu:
            seiyuu_ids = _parse_str_list(seiyuu)
            if seiyuu_ids:
                seiyuu_sub = select(VNSeiyuu.vn_id).where(VNSeiyuu.staff_id.in_(seiyuu_ids)).distinct()
                spoiler_count_query = spoiler_count_query.where(VisualNovel.id.in_(seiyuu_sub))
        if developer:
            dev_ids = _parse_str_list(developer)
            if dev_ids:
                dev_sub = (
                    select(ReleaseVN.vn_id)
                    .join(ReleaseProducer, ReleaseVN.release_id == ReleaseProducer.release_id)
                    .where(ReleaseProducer.producer_id.in_(dev_ids))
                    .where(ReleaseProducer.developer == True)
                    .distinct()
                )
                spoiler_count_query = spoiler_count_query.where(VisualNovel.id.in_(dev_sub))
        if publisher:
            pub_ids = _parse_str_list(publisher)
            if pub_ids:
                pub_sub = (
                    select(ReleaseVN.vn_id)
                    .join(ReleaseProducer, ReleaseVN.release_id == ReleaseProducer.release_id)
                    .where(ReleaseProducer.producer_id.in_(pub_ids))
                    .where(ReleaseProducer.publisher == True)
                    .distinct()
                )
                spoiler_count_query = spoiler_count_query.where(VisualNovel.id.in_(pub_sub))

        # Execute spoiler-inclusive count query on a separate session
        total_with_spoilers = await _run_count(spoiler_count_query)

    elapsed_time = time.time() - start_time

    search_response = schemas.VNSearchResponse(
        results=[
            schemas.VNSummary(
                id=vn.id,
                title=vn.title,
                title_jp=vn.title_jp,
                title_romaji=vn.title_romaji,
                image_url=vn.image_url,
                image_sexual=vn.image_sexual,
                released=vn.released,
                rating=vn.rating,
                votecount=vn.votecount,
                olang=vn.olang,
                description=getattr(vn, 'description', None),
            )
            for vn in vns
        ],
        total=total,
        total_with_spoilers=total_with_spoilers,
        page=page,
        pages=(total + limit - 1) // limit,
        query_time=round(elapsed_time, 3),
    )

    # Cache the response for 1 hour (data only changes daily via VNDB dumps).
    # browse:* keys are flushed after each import in worker.py / initial_import.py.
    if sort != "random":
        await cache.set(cache_key, search_response.model_dump(mode="json"), ttl=3600)

    # HTTP cache headers for browser caching (production uses fetch cache: 'default').
    # 30s hard cache + 5min stale-while-revalidate = revisiting same filters is instant.
    if sort != "random" and response is not None:
        response.headers["Cache-Control"] = "public, max-age=30, stale-while-revalidate=300"

    return search_response


@router.get("/traits/counts")
@limiter.limit("30/minute")
async def get_trait_counts(
    request: Request,
    ids: str = Query(description="Comma-separated trait IDs (e.g., 'i1,i2,i3' or '1,2,3')"),
    db: AsyncSession = Depends(get_db),
):
    """
    Get global character counts for traits.

    Used for calculating IDF-based importance in trait tables.
    Returns a map of trait_id -> char_count.
    """
    # Parse trait IDs, handling both "i123" and "123" formats
    raw_ids = _parse_str_list(ids, max_items=1200)
    trait_ids = []
    for id_str in raw_ids:
        if id_str.startswith("i"):
            id_str = id_str[1:]
        if id_str.isdigit():
            trait_ids.append(int(id_str))

    if not trait_ids:
        return {"counts": {}, "total_characters": 0}

    cache = get_cache()

    # Cache total character count (only changes with daily dumps)
    total_cache_key = "trait_counts:total_characters"
    total_characters = await cache.get(total_cache_key)
    if total_characters is None:
        total_result = await db.execute(
            select(func.count(Character.id))
        )
        total_characters = total_result.scalar_one_or_none() or 0
        await cache.set(total_cache_key, total_characters, ttl=86400)

    # Cache trait counts by sorted ID set
    sorted_ids = sorted(trait_ids)
    cache_key = f"trait_counts:{','.join(map(str, sorted_ids))}"
    cached_counts = await cache.get(cache_key)
    if cached_counts is not None:
        return {"counts": cached_counts, "total_characters": total_characters}

    # Get trait char_counts from database
    result = await db.execute(
        select(Trait.id, Trait.char_count)
        .where(Trait.id.in_(trait_ids))
    )
    counts = {f"i{row[0]}": row[1] or 0 for row in result.all()}

    await cache.set(cache_key, counts, ttl=86400)

    return {"counts": counts, "total_characters": total_characters}


# VNDB dump stores abbreviated tag category codes
TAG_CATEGORY_LABELS = {"cont": "Content", "tech": "Technical", "ero": "Sexual"}


@router.get("/search-tags-traits", response_model=schemas.TagTraitSearchResponse)
async def search_tags_traits(
    q: str = Query(min_length=2, description="Search query (minimum 2 characters)"),
    limit: int = Query(default=20, ge=1, le=50, description="Maximum results to return"),
    db: AsyncSession = Depends(get_db),
):
    """
    Search tags and traits for autocomplete.

    Returns combined results from both tags and traits tables,
    matching against name and aliases. Results are sorted by
    relevance (exact matches first) and count (popularity).

    Used by the recommendations page filter autocomplete.
    """
    eq = _escape_like(q)
    search_pattern = f"%{eq}%"
    starts_with_pattern = f"{eq}%"
    half_limit = limit // 2

    # Search tags (searchable only)
    # Priority: exact match > starts with > contains, then by popularity
    tag_query = (
        select(Tag.id, Tag.name, Tag.category, Tag.vn_count)
        .where(Tag.searchable == True)
        .where(
            (Tag.name.ilike(search_pattern)) |
            (func.array_to_string(Tag.aliases, ' ').ilike(search_pattern))
        )
        .order_by(
            # Exact match first
            (func.lower(Tag.name) == q.lower()).desc(),
            # Starts with second
            Tag.name.ilike(starts_with_pattern).desc(),
            # Then by popularity
            Tag.vn_count.desc().nulls_last()
        )
        .limit(half_limit + 5)  # Get a few extra for balancing
    )

    tag_result = await db.execute(tag_query)
    tag_rows = tag_result.all()

    # Search traits (searchable only)
    trait_query = (
        select(Trait.id, Trait.name, Trait.group_name, Trait.char_count)
        .where(Trait.searchable == True)
        .where(
            (Trait.name.ilike(search_pattern)) |
            (func.array_to_string(Trait.aliases, ' ').ilike(search_pattern))
        )
        .order_by(
            # Exact match first
            (func.lower(Trait.name) == q.lower()).desc(),
            # Starts with second
            Trait.name.ilike(starts_with_pattern).desc(),
            # Then by popularity
            Trait.char_count.desc().nulls_last()
        )
        .limit(half_limit + 5)  # Get a few extra for balancing
    )

    trait_result = await db.execute(trait_query)
    trait_rows = trait_result.all()

    # Combine and balance results
    results: list[schemas.TagTraitSearchResult] = []

    # Interleave tags and traits for balanced results
    tag_idx = 0
    trait_idx = 0

    while len(results) < limit and (tag_idx < len(tag_rows) or trait_idx < len(trait_rows)):
        # Alternate between tags and traits
        if tag_idx < len(tag_rows) and (trait_idx >= len(trait_rows) or tag_idx <= trait_idx):
            row = tag_rows[tag_idx]
            results.append(schemas.TagTraitSearchResult(
                id=row[0],
                name=row[1],
                type="tag",
                category=TAG_CATEGORY_LABELS.get(row[2], row[2]),
                count=row[3] or 0,
            ))
            tag_idx += 1
        elif trait_idx < len(trait_rows):
            row = trait_rows[trait_idx]
            results.append(schemas.TagTraitSearchResult(
                id=row[0],
                name=row[1],
                type="trait",
                category=row[2],  # group_name
                count=row[3] or 0,
            ))
            trait_idx += 1

    return schemas.TagTraitSearchResponse(
        results=results[:limit],
        total_tags=len(tag_rows),
        total_traits=len(trait_rows),
    )


@router.get("/search-filters", response_model=schemas.FilterSearchResponse)
async def search_all_filters(
    q: str = Query(min_length=2, description="Search query (minimum 2 characters)"),
    limit: int = Query(default=30, ge=1, le=50, description="Maximum results to return"),
    db: AsyncSession = Depends(get_db),
):
    """
    Search tags, traits, staff, seiyuu, developers, and publishers for browse page autocomplete.

    Returns combined results from all entity types, sorted by relevance and popularity.
    Each result includes a type discriminator for frontend display.
    """
    eq = _escape_like(q)
    search_pattern = f"%{eq}%"
    starts_with_pattern = f"{eq}%"
    per_type = max(3, limit // 6 + 2)  # Allocate per-type budget with extras

    # 1. Search tags (same logic as /search-tags-traits)
    tag_query = (
        select(Tag.id, Tag.name, Tag.category, Tag.vn_count)
        .where(Tag.searchable == True)
        .where(
            (Tag.name.ilike(search_pattern)) |
            (func.array_to_string(Tag.aliases, ' ').ilike(search_pattern))
        )
        .order_by(
            (func.lower(Tag.name) == q.lower()).desc(),
            Tag.name.ilike(starts_with_pattern).desc(),
            Tag.vn_count.desc().nulls_last()
        )
        .limit(per_type)
    )

    # 2. Search traits
    trait_query = (
        select(Trait.id, Trait.name, Trait.group_name, Trait.char_count)
        .where(Trait.searchable == True)
        .where(
            (Trait.name.ilike(search_pattern)) |
            (func.array_to_string(Trait.aliases, ' ').ilike(search_pattern))
        )
        .order_by(
            (func.lower(Trait.name) == q.lower()).desc(),
            Trait.name.ilike(starts_with_pattern).desc(),
            Trait.char_count.desc().nulls_last()
        )
        .limit(per_type)
    )

    # 3. Search staff (by name or original name)
    # Get VN count via subquery for sorting
    staff_vn_count = (
        select(func.count(func.distinct(VNStaff.vn_id)))
        .where(VNStaff.staff_id == Staff.id)
        .correlate(Staff)
        .scalar_subquery()
    )
    staff_query = (
        select(Staff.id, Staff.name, Staff.original, staff_vn_count.label("vn_count"))
        .where(
            (Staff.name.ilike(search_pattern)) |
            (Staff.original.ilike(search_pattern))
        )
        .order_by(
            (func.lower(Staff.name) == q.lower()).desc(),
            Staff.name.ilike(starts_with_pattern).desc(),
            staff_vn_count.desc()
        )
        .limit(per_type)
    )

    # 4. Search seiyuu (staff who have seiyuu credits)
    seiyuu_vn_count = (
        select(func.count(func.distinct(VNSeiyuu.vn_id)))
        .where(VNSeiyuu.staff_id == Staff.id)
        .correlate(Staff)
        .scalar_subquery()
    )
    seiyuu_query = (
        select(Staff.id, Staff.name, Staff.original, seiyuu_vn_count.label("vn_count"))
        .where(
            (Staff.name.ilike(search_pattern)) |
            (Staff.original.ilike(search_pattern))
        )
        .where(
            Staff.id.in_(select(func.distinct(VNSeiyuu.staff_id)))
        )
        .order_by(
            (func.lower(Staff.name) == q.lower()).desc(),
            Staff.name.ilike(starts_with_pattern).desc(),
            seiyuu_vn_count.desc()
        )
        .limit(per_type)
    )

    # 5. Search developers (producers with developer credits)
    dev_vn_count = (
        select(func.count(func.distinct(ReleaseVN.vn_id)))
        .join(ReleaseProducer, ReleaseVN.release_id == ReleaseProducer.release_id)
        .where(ReleaseProducer.producer_id == Producer.id)
        .where(ReleaseProducer.developer == True)
        .correlate(Producer)
        .scalar_subquery()
    )
    developer_query = (
        select(Producer.id, Producer.name, Producer.original, dev_vn_count.label("vn_count"))
        .where(
            (Producer.name.ilike(search_pattern)) |
            (Producer.original.ilike(search_pattern))
        )
        .where(
            Producer.id.in_(
                select(func.distinct(ReleaseProducer.producer_id))
                .where(ReleaseProducer.developer == True)
            )
        )
        .order_by(
            (func.lower(Producer.name) == q.lower()).desc(),
            Producer.name.ilike(starts_with_pattern).desc(),
            dev_vn_count.desc()
        )
        .limit(per_type)
    )

    # 6. Search publishers (producers with publisher credits)
    pub_vn_count = (
        select(func.count(func.distinct(ReleaseVN.vn_id)))
        .join(ReleaseProducer, ReleaseVN.release_id == ReleaseProducer.release_id)
        .where(ReleaseProducer.producer_id == Producer.id)
        .where(ReleaseProducer.publisher == True)
        .correlate(Producer)
        .scalar_subquery()
    )
    publisher_query = (
        select(Producer.id, Producer.name, Producer.original, pub_vn_count.label("vn_count"))
        .where(
            (Producer.name.ilike(search_pattern)) |
            (Producer.original.ilike(search_pattern))
        )
        .where(
            Producer.id.in_(
                select(func.distinct(ReleaseProducer.producer_id))
                .where(ReleaseProducer.publisher == True)
            )
        )
        .order_by(
            (func.lower(Producer.name) == q.lower()).desc(),
            Producer.name.ilike(starts_with_pattern).desc(),
            pub_vn_count.desc()
        )
        .limit(per_type)
    )

    # Execute queries sequentially (async sessions don't support concurrent operations)
    tag_rows = (await db.execute(tag_query)).all()
    trait_rows = (await db.execute(trait_query)).all()
    staff_rows = (await db.execute(staff_query)).all()
    seiyuu_rows = (await db.execute(seiyuu_query)).all()
    dev_rows = (await db.execute(developer_query)).all()
    pub_rows = (await db.execute(publisher_query)).all()

    # Build typed result lists
    tag_results = [
        schemas.FilterSearchResult(
            id=str(row[0]), name=row[1], type="tag",
            category=TAG_CATEGORY_LABELS.get(row[2], row[2]),
            count=row[3] or 0,
        ) for row in tag_rows
    ]
    trait_results = [
        schemas.FilterSearchResult(
            id=str(row[0]), name=row[1], type="trait",
            category=row[2], count=row[3] or 0,
        ) for row in trait_rows
    ]
    staff_results = [
        schemas.FilterSearchResult(
            id=row[0], name=row[1], original=row[2] or None, type="staff",
            category="Staff", count=row[3] or 0,
        ) for row in staff_rows
    ]
    seiyuu_results = [
        schemas.FilterSearchResult(
            id=row[0], name=row[1], original=row[2] or None, type="seiyuu",
            category="Voice Actor", count=row[3] or 0,
        ) for row in seiyuu_rows
    ]
    dev_results = [
        schemas.FilterSearchResult(
            id=row[0], name=row[1], original=row[2] or None, type="developer",
            category="Developer", count=row[3] or 0,
        ) for row in dev_rows
    ]
    pub_results = [
        schemas.FilterSearchResult(
            id=row[0], name=row[1], original=row[2] or None, type="publisher",
            category="Publisher", count=row[3] or 0,
        ) for row in pub_rows
    ]

    # Interleave: tags/traits first (most common use), then entities
    all_groups = [tag_results, trait_results, staff_results, seiyuu_results, dev_results, pub_results]
    results: list[schemas.FilterSearchResult] = []
    indices = [0] * len(all_groups)

    while len(results) < limit:
        added = False
        for i, group in enumerate(all_groups):
            if indices[i] < len(group):
                results.append(group[indices[i]])
                indices[i] += 1
                added = True
                if len(results) >= limit:
                    break
        if not added:
            break

    return schemas.FilterSearchResponse(results=results[:limit])


@router.get("/top", response_model=list[schemas.TopVN])
async def get_top_vns(
    sort: str = Query(default="rating", description="Sort by: rating, votecount"),
    limit: int = Query(default=10, ge=1, le=100, description="Number of results"),
    db: AsyncSession = Depends(get_db),
):
    """
    Get top VNs by rating or vote count.

    Used by the global stats page to display highest rated and most popular VNs.
    Requires minimum 100 votes for rating-based ranking to ensure reliability.
    """
    if sort == "rating":
        order_by = VisualNovel.rating.desc().nulls_last()
        # For rating-based ranking, require minimum votes for reliability
        min_votes_filter = VisualNovel.votecount >= 100
    else:  # votecount
        order_by = VisualNovel.votecount.desc().nulls_last()
        min_votes_filter = VisualNovel.votecount > 0

    query = (
        select(VisualNovel)
        .where(VisualNovel.rating.isnot(None))
        .where(min_votes_filter)
        .order_by(order_by)
        .limit(limit)
    )

    result = await db.execute(query)
    vns = result.scalars().all()

    return [
        schemas.TopVN(
            id=vn.id,
            title=vn.title,
            alttitle=vn.title_jp,
            image_url=vn.image_url,
            image_sexual=vn.image_sexual,
            released=vn.released.isoformat() if vn.released else None,
            rating=vn.rating,
            votecount=vn.votecount,
            rank=i + 1,
            olang=vn.olang,
        )
        for i, vn in enumerate(vns)
    ]


@router.get("/{vn_id}/similar", response_model=schemas.SimilarVNsResponse)
async def get_similar_vns(
    vn_id: str,
    limit: int = Query(default=10, ge=1, le=50, description="Number of similar VNs to return per category"),
    db: AsyncSession = Depends(get_db),
):
    """
    Get similar visual novels using precomputed similarity data.

    Returns two types of recommendations:
    - content_similar: VNs with similar tags (content-based filtering)
    - users_also_read: VNs that users who liked this VN also enjoyed (collaborative filtering)
    """
    # Normalize VN ID (accept both "v123" and "123" formats)
    normalized_id = vn_id if vn_id.startswith("v") else f"v{vn_id}"

    # Get content-based similar VNs from vn_similarities table
    content_query = (
        select(VNSimilarity, VisualNovel)
        .join(VisualNovel, VNSimilarity.similar_vn_id == VisualNovel.id)
        .where(VNSimilarity.vn_id == normalized_id)
        .order_by(VNSimilarity.similarity_score.desc())
        .limit(limit)
    )
    content_result = await db.execute(content_query)
    content_rows = content_result.all()

    content_similar = [
        schemas.SimilarVN(
            vn_id=vn.id,
            title=vn.title,
            title_jp=vn.title_jp,
            title_romaji=vn.title_romaji,
            image_url=vn.image_url,
            image_sexual=vn.image_sexual,
            rating=vn.rating,
            similarity=sim.similarity_score,
            olang=vn.olang,
        )
        for sim, vn in content_rows
    ]

    # Get collaborative filtering similar VNs from vn_cooccurrence table
    collab_query = (
        select(VNCoOccurrence, VisualNovel)
        .join(VisualNovel, VNCoOccurrence.similar_vn_id == VisualNovel.id)
        .where(VNCoOccurrence.vn_id == normalized_id)
        .order_by(VNCoOccurrence.co_rating_score.desc())
        .limit(limit)
    )
    collab_result = await db.execute(collab_query)
    collab_rows = collab_result.all()

    users_also_read = [
        schemas.SimilarVN(
            vn_id=vn.id,
            title=vn.title,
            title_jp=vn.title_jp,
            title_romaji=vn.title_romaji,
            image_url=vn.image_url,
            image_sexual=vn.image_sexual,
            rating=vn.rating,
            similarity=cooccur.co_rating_score,
            olang=vn.olang,
            user_count=cooccur.user_count,
        )
        for cooccur, vn in collab_rows
    ]

    return schemas.SimilarVNsResponse(
        content_similar=content_similar,
        users_also_read=users_also_read,
    )


@router.get("/{vn_id}/characters", response_model=list[schemas.VNCharacterResponse])
async def get_vn_characters(
    vn_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Get all characters for a visual novel with their roles and traits.

    Characters are ordered by role importance: main > primary > side > appears.
    """
    # Normalize VN ID
    normalized_id = vn_id if vn_id.startswith("v") else f"v{vn_id}"

    # Verify VN exists
    vn_check = await db.execute(
        select(VisualNovel.id).where(VisualNovel.id == normalized_id)
    )
    if not vn_check.scalar_one_or_none():
        raise HTTPException(status_code=404, detail=f"VN {vn_id} not found")

    # Get characters for this VN with role info
    char_result = await db.execute(
        select(CharacterVN, Character)
        .join(Character, CharacterVN.character_id == Character.id)
        .where(CharacterVN.vn_id == normalized_id)
        .order_by(
            # Order by role importance
            case(
                (CharacterVN.role == 'main', 1),
                (CharacterVN.role == 'primary', 2),
                (CharacterVN.role == 'side', 3),
                else_=4
            ),
            Character.name
        )
    )

    char_rows = char_result.all()
    char_ids = [char.id for _, char in char_rows]

    # Bulk fetch all traits for all characters in one query (avoids N+1)
    traits_by_char: dict[str, list[schemas.CharacterTraitInfo]] = {}
    if char_ids:
        all_traits = await db.execute(
            select(CharacterTrait, Trait)
            .join(Trait, CharacterTrait.trait_id == Trait.id)
            .where(CharacterTrait.character_id.in_(char_ids))
            .order_by(Trait.group_name, Trait.name)
        )
        for char_trait, trait in all_traits.all():
            traits_by_char.setdefault(char_trait.character_id, []).append(
                schemas.CharacterTraitInfo(
                    id=f"i{trait.id}",
                    name=trait.name,
                    group_id=trait.group_id,
                    group_name=trait.group_name,
                    spoiler=char_trait.spoiler_level,
                )
            )

    characters = [
        schemas.VNCharacterResponse(
            id=char.id,
            name=char.name,
            original=char.original,
            image_url=char.image_url,
            role=char_vn.role or 'appears',
            spoiler=char_vn.spoiler_level or 0,
            traits=traits_by_char.get(char.id, []),
        )
        for char_vn, char in char_rows
    ]

    return characters


@router.get("/{vn_id}/vote-stats", response_model=schemas.VNVoteStatsResponse)
async def get_vn_vote_stats(
    vn_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Get vote statistics for a VN: distribution, votes over time, score over time."""
    normalized_id = vn_id if vn_id.startswith("v") else f"v{vn_id}"

    # Redis cache (1 hour — data changes daily)
    cache = get_cache()
    cache_key = f"vn:vote-stats:{normalized_id}"
    cached = await cache.get(cache_key)
    if cached:
        return schemas.VNVoteStatsResponse(**cached)

    # Verify VN exists and get its official votecount + average (includes private votes)
    vn_check = await db.execute(
        select(VisualNovel.id, VisualNovel.votecount, VisualNovel.average_rating).where(VisualNovel.id == normalized_id)
    )
    vn_row = vn_check.one_or_none()
    if not vn_row:
        raise HTTPException(status_code=404, detail=f"VN {vn_id} not found")
    official_votecount = vn_row[1] or 0
    official_average = vn_row[2]  # From VNDB dump c_average (includes private votes)

    # 1. Score distribution (10 buckets, 1-10)
    # Use round() to match VNDB's bucketing (e.g. vote 95 = 9.5 → bucket 10)
    # Integer division (floor) would put 95-99 in bucket 9, only 100 in bucket 10
    dist_result = await db.execute(
        text("""
            SELECT
                LEAST(GREATEST(round(vote / 10.0)::int, 1), 10) AS bucket,
                COUNT(*) AS cnt
            FROM global_votes
            WHERE vn_id = :vn_id
            GROUP BY bucket
            ORDER BY bucket
        """),
        {"vn_id": normalized_id}
    )
    distribution = {str(i): 0 for i in range(1, 11)}
    total_votes = 0
    weighted_sum = 0
    for row in dist_result.fetchall():
        bucket = int(row[0])
        count = int(row[1])
        distribution[str(bucket)] = count
        total_votes += count
        weighted_sum += bucket * count

    average_score = round(weighted_sum / total_votes, 2) if total_votes > 0 else None

    # 2+3. Monthly vote counts and average scores (combined into single query)
    monthly_result = await db.execute(
        text("""
            SELECT
                to_char(date, 'YYYY-MM') AS month,
                COUNT(*) AS cnt,
                AVG(vote::float / 10.0) AS avg_score
            FROM global_votes
            WHERE vn_id = :vn_id AND date IS NOT NULL
            GROUP BY month
            ORDER BY month
        """),
        {"vn_id": normalized_id}
    )
    votes_over_time = []
    score_over_time = []
    cumulative = 0
    running_sum = 0.0
    running_count = 0
    for row in monthly_result.fetchall():
        month, count, avg_score_raw = row[0], int(row[1]), float(row[2])
        # Votes
        cumulative += count
        votes_over_time.append(schemas.VNMonthlyVotes(
            month=month, count=count, cumulative=cumulative,
        ))
        # Scores — use full precision for running sum, only round for display
        running_sum += avg_score_raw * count
        running_count += count
        score_over_time.append(schemas.VNMonthlyScore(
            month=month,
            avg_score=round(avg_score_raw, 2),
            cumulative_avg=round(running_sum / running_count, 2),
            vote_count=count,
        ))

    # Scale cumulative values to match official votecount (includes private votes)
    if votes_over_time and official_votecount > cumulative > 0:
        scale = official_votecount / cumulative
        for entry in votes_over_time:
            entry.cumulative = round(entry.cumulative * scale)

    # Adjust cumulative_avg to match official average (includes private votes).
    # A constant offset is the best approximation — private vote timestamps are
    # unknown, so we can't distribute the correction across time periods.
    # This ensures the final cumulative_avg matches VNDB's displayed average.
    if score_over_time and official_average and running_count > 0:
        public_avg = running_sum / running_count
        if abs(public_avg - official_average) > 0.001:
            offset = official_average - public_avg
            for entry in score_over_time:
                entry.cumulative_avg = round(max(1.0, min(10.0, entry.cumulative_avg + offset)), 2)

    # 4. Global medians for niche quadrant (24-hour cache)
    global_medians = None
    gm_cache_key = "global:medians"
    gm_cached = await cache.get(gm_cache_key)
    if gm_cached:
        global_medians = schemas.GlobalMedians(**gm_cached)
    else:
        try:
            gm_result = await db.execute(
                text("""
                    SELECT
                        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY rating) AS median_rating,
                        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY votecount) AS median_votecount,
                        PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY rating) AS p75_rating,
                        PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY votecount) AS p75_votecount
                    FROM visual_novels
                    WHERE rating IS NOT NULL AND votecount >= 10
                """)
            )
            gm_row = gm_result.one_or_none()
            if gm_row and gm_row[0] is not None:
                global_medians = schemas.GlobalMedians(
                    median_rating=round(float(gm_row[0]), 2),
                    median_votecount=round(float(gm_row[1]), 0),
                    p75_rating=round(float(gm_row[2]), 2),
                    p75_votecount=round(float(gm_row[3]), 0),
                )
                await cache.set(gm_cache_key, global_medians.model_dump(mode="json"), ttl=86400)
        except Exception:
            logger.warning("Failed to compute global medians", exc_info=True)

    # 5. Comparative context
    developer_rank = None
    genre_percentile = None
    length_comparison = None

    # Fetch VN rating + length once for use across comparative sections
    vn_extra_result = await db.execute(
        select(VisualNovel.rating, VisualNovel.length, VisualNovel.length_minutes).where(VisualNovel.id == normalized_id)
    )
    vn_extra_row = vn_extra_result.one_or_none()
    this_vn_rating = vn_extra_row[0] if vn_extra_row else None
    this_vn_length = vn_extra_row[1] if vn_extra_row else None
    this_vn_length_minutes = vn_extra_row[2] if vn_extra_row else None

    # 5a. Developer rank — find developer, rank this VN among their works
    try:
        dev_result = await db.execute(
            text("""
                SELECT DISTINCT rp.producer_id, p.name, p.original
                FROM release_producers rp
                JOIN release_vn rv ON rp.release_id = rv.release_id
                JOIN producers p ON p.id = rp.producer_id
                WHERE rv.vn_id = :vn_id AND rp.developer = true
                LIMIT 1
            """),
            {"vn_id": normalized_id}
        )
        dev_row = dev_result.one_or_none()
        if dev_row:
            dev_id, dev_name, dev_original = dev_row[0], dev_row[1], dev_row[2]
            rank_result = await db.execute(
                text("""
                    WITH all_dev_vns AS (
                        SELECT DISTINCT rv.vn_id, vn.rating
                        FROM release_vn rv
                        JOIN release_producers rp ON rv.release_id = rp.release_id
                        JOIN visual_novels vn ON rv.vn_id = vn.id
                        WHERE rp.producer_id = :dev_id
                          AND rp.developer = true
                    ),
                    dev_vns AS (
                        SELECT * FROM all_dev_vns WHERE rating IS NOT NULL
                    )
                    SELECT
                        (SELECT COUNT(*) FROM dev_vns) AS total,
                        (SELECT COUNT(*) FROM dev_vns
                         WHERE rating > COALESCE(
                             (SELECT rating FROM dev_vns WHERE vn_id = :vn_id), 0
                         )) + 1 AS rank,
                        (SELECT COUNT(*) FROM all_dev_vns) AS total_all
                """),
                {"dev_id": dev_id, "vn_id": normalized_id}
            )
            rank_row = rank_result.one_or_none()
            if rank_row and rank_row[0] >= 2:
                total_all = int(rank_row[2])
                developer_rank = schemas.DeveloperRankContext(
                    developer_id=dev_id,
                    developer_name=dev_name,
                    developer_name_original=dev_original,
                    rank=int(rank_row[1]),
                    total=int(rank_row[0]),
                    total_all=total_all if total_all > int(rank_row[0]) else None,
                )
    except Exception:
        logger.warning(f"Failed to compute developer rank for {normalized_id}", exc_info=True)

    # 5b. Genre percentile — pick best genre tag, compute percentile among VNs with that tag
    try:
        if this_vn_rating is not None:
            top_tag_result = await db.execute(
                text("""
                    SELECT vt.tag_id, t.name
                    FROM vn_tags vt
                    JOIN tags t ON t.id = vt.tag_id
                    WHERE vt.vn_id = :vn_id
                      AND vt.lie = false
                      AND vt.score > 0
                      AND t.name = ANY(:genre_names)
                    ORDER BY vt.score DESC
                    LIMIT 1
                """),
                {"vn_id": normalized_id, "genre_names": _GENRE_TAGS}
            )
            top_tag_row = top_tag_result.one_or_none()
            if top_tag_row:
                tag_id, tag_name = top_tag_row[0], top_tag_row[1]
                pct_result = await db.execute(
                    text("""
                        WITH RECURSIVE tag_tree AS (
                            SELECT CAST(:tag_id AS INTEGER) AS id, 0 AS depth
                            UNION
                            SELECT tp.tag_id, tt.depth + 1
                            FROM tag_parents tp
                            JOIN tag_tree tt ON tp.parent_id = tt.id
                            WHERE tt.depth < 10
                        ),
                        genre_vns AS (
                            SELECT DISTINCT vn.id, vn.rating, vn.olang
                            FROM vn_tags vt
                            JOIN visual_novels vn ON vt.vn_id = vn.id
                            WHERE vt.tag_id IN (SELECT id FROM tag_tree)
                              AND vn.rating IS NOT NULL
                              AND vn.votecount >= 10
                              AND vt.score >= 0
                              AND vt.lie = false
                        )
                        SELECT
                            COUNT(*) AS total,
                            ROUND(100.0 * SUM(CASE WHEN rating <= :vn_rating THEN 1 ELSE 0 END)
                                  / GREATEST(COUNT(*), 1), 1) AS percentile,
                            SUM(CASE WHEN olang = 'ja' THEN 1 ELSE 0 END) AS jp_count
                        FROM genre_vns
                    """),
                    {"tag_id": tag_id, "vn_rating": float(this_vn_rating)}
                )
                pct_row = pct_result.one_or_none()
                if pct_row and pct_row[0] >= 10:
                    genre_percentile = schemas.GenrePercentileContext(
                        tag_id=tag_id,
                        tag_name=tag_name,
                        percentile=float(pct_row[1]),
                        total_in_genre=int(pct_row[0]),
                        jp_count=int(pct_row[2]) if pct_row[2] else 0,
                    )
    except Exception:
        logger.warning(f"Failed to compute genre percentile for {normalized_id}", exc_info=True)

    # 5c. Length comparison — average rating for VNs with same length category
    # Uses length_minutes ranges (matching browse page logic) with fallback to categorical length
    try:
        # Determine effective length category from length_minutes if available
        effective_length = this_vn_length
        if this_vn_length_minutes and this_vn_length_minutes > 0:
            for cat, (min_m, max_m) in _LENGTH_RANGES.items():
                above_min = min_m is None or this_vn_length_minutes >= min_m
                below_max = max_m is None or this_vn_length_minutes < max_m
                if above_min and below_max:
                    effective_length = cat
                    break

        if effective_length is not None and this_vn_rating is not None and effective_length in _LENGTH_LABELS:
            min_m, max_m = _LENGTH_RANGES[effective_length]
            # Build minutes condition to match browse page get_length_filter()
            if min_m is not None and max_m is not None:
                minutes_cond = "length_minutes > 0 AND length_minutes >= :min_m AND length_minutes < :max_m"
            elif min_m is not None:
                minutes_cond = "length_minutes > 0 AND length_minutes >= :min_m"
            else:
                minutes_cond = "length_minutes > 0 AND length_minutes < :max_m"

            len_avg_result = await db.execute(
                text(f"""
                    SELECT AVG(rating) AS avg_rating, COUNT(*) AS cnt,
                           SUM(CASE WHEN olang = 'ja' THEN 1 ELSE 0 END) AS jp_count
                    FROM visual_novels
                    WHERE (
                        ({minutes_cond})
                        OR ((length_minutes IS NULL OR length_minutes <= 0) AND length = :length_cat)
                    )
                      AND rating IS NOT NULL
                      AND votecount >= 10
                """),
                {
                    "length_cat": effective_length,
                    **({"min_m": min_m} if min_m is not None else {}),
                    **({"max_m": max_m} if max_m is not None else {}),
                }
            )
            len_row = len_avg_result.one_or_none()
            if len_row and len_row[1] >= 5:
                length_comparison = schemas.LengthComparisonContext(
                    vn_score=round(float(this_vn_rating), 2),
                    length_avg_score=round(float(len_row[0]), 2),
                    length_label=_LENGTH_LABELS[effective_length],
                    count_in_length=int(len_row[1]),
                    jp_count=int(len_row[2]) if len_row[2] else 0,
                )
    except Exception:
        logger.warning(f"Failed to compute length comparison for {normalized_id}", exc_info=True)

    context = schemas.ComparativeContext(
        developer_rank=developer_rank,
        genre_percentile=genre_percentile,
        length_comparison=length_comparison,
    ) if any([developer_rank, genre_percentile, length_comparison]) else None

    response = schemas.VNVoteStatsResponse(
        vn_id=normalized_id,
        total_votes=total_votes,
        average_score=average_score,
        score_distribution=distribution,
        votes_over_time=votes_over_time,
        score_over_time=score_over_time,
        context=context,
        global_medians=global_medians,
    )

    await cache.set(cache_key, response.model_dump(mode="json"), ttl=3600)
    return response


@router.get("/{vn_id}", response_model=schemas.VNDetailResponse)
async def get_vn_details(
    vn_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Get detailed information about a visual novel.

    Includes:
    - Basic metadata (title, description, release date)
    - Rating and vote distribution
    - Tags with relevance scores
    - Similar VNs
    """
    result = await db.execute(
        select(VisualNovel).where(VisualNovel.id == vn_id)
    )
    vn = result.scalar_one_or_none()

    if not vn:
        raise HTTPException(status_code=404, detail=f"VN {vn_id} not found")

    # Get tags for this VN (exclude 0.0 scores and disputed/lie tags)
    tags_result = await db.execute(
        select(Tag, VNTag.score, VNTag.spoiler_level)
        .join(VNTag, Tag.id == VNTag.tag_id)
        .where(VNTag.vn_id == vn_id, VNTag.score > 0, VNTag.lie == False)
        .order_by(VNTag.score.desc())
    )
    tags = [
        schemas.VNTagInfo(
            id=f"g{tag.id}",  # Format as "g123" for compatibility with tag detail pages
            name=tag.name,
            category=tag.category,
            score=score,
            spoiler=spoiler_level,
            vn_count=tag.vn_count or 0,
        )
        for tag, score, spoiler_level in tags_result
    ]

    # Query developers through the release path: VN -> ReleaseVN -> ReleaseProducer -> Producer
    developers_result = await db.execute(
        select(Producer.id, Producer.name, Producer.original)
        .distinct()
        .join(ReleaseProducer, Producer.id == ReleaseProducer.producer_id)
        .join(ReleaseVN, ReleaseProducer.release_id == ReleaseVN.release_id)
        .where(ReleaseVN.vn_id == vn_id)
        .where(ReleaseProducer.developer == True)
    )
    developers = [
        schemas.DeveloperInfo(id=row[0], name=row[1], original=row[2])
        for row in developers_result.all()
    ]

    # Query relations, joining with VisualNovel to get metadata for each related VN
    relations_result = await db.execute(
        select(
            VNRelation.related_vn_id,
            VNRelation.relation,
            VNRelation.official,
            VisualNovel.title,
            VisualNovel.title_jp,
            VisualNovel.title_romaji,
            VisualNovel.image_url,
            VisualNovel.image_sexual,
            VisualNovel.rating,
            VisualNovel.olang,
        )
        .join(VisualNovel, VNRelation.related_vn_id == VisualNovel.id)
        .where(VNRelation.vn_id == vn_id)
    )
    relations = [
        schemas.VNRelationInfo(
            id=row[0],
            title=row[3],
            title_jp=row[4],
            title_romaji=row[5],
            relation=row[1],
            relation_official=row[2],
            image_url=row[6],
            image_sexual=row[7],
            rating=row[8],
            olang=row[9],
        )
        for row in relations_result.all()
    ]

    # ── External links ──

    # 1. VN-level direct extlinks (wikidata, renai, wp, encubed)
    vn_links_result = await db.execute(
        select(ExtlinksMaster.site, ExtlinksMaster.value)
        .join(VNExtlink, VNExtlink.link_id == ExtlinksMaster.id)
        .where(VNExtlink.vn_id == vn_id)
    )

    vn_links = []
    wikidata_qid = None
    has_en_wikipedia = False
    for site, value in vn_links_result:
        if site == "wikidata":
            wikidata_qid = value
            continue
        if site in DEPRECATED_SITES or site in TRANSLATION_ONLY_SITES or site in NON_JP_CONSOLE_STORES:
            continue
        if site == "wp":
            has_en_wikipedia = True
        url = build_extlink_url(site, value)
        if url:
            vn_links.append(schemas.ExtlinkInfo(
                site=site, url=url, label=get_site_label(site)
            ))

    # 2. Wikidata-resolved links (Wikipedia, IGDB, HowLongToBeat, etc.)
    if wikidata_qid:
        try:
            qid_num = int(wikidata_qid.lstrip("Qq"))
            wd_result = await db.execute(
                select(WikidataEntry).where(WikidataEntry.id == qid_num)
            )
            wd_row = wd_result.scalar_one_or_none()
            if wd_row:
                wd_dict = {col: getattr(wd_row, col) for col in [
                    "enwiki", "jawiki", "mobygames_game", "gamefaqs_game",
                    "howlongtobeat", "igdb_game", "pcgamingwiki",
                    "steam", "gog", "lutris", "wine",
                    "anidb_anime", "ann_anime", "acdb_source",
                ]}
                wd_links = build_wikidata_links(wd_dict)
                vn_links.extend([
                    schemas.ExtlinkInfo(site=l["site"], url=l["url"], label=l["label"])
                    for l in wd_links
                    if not (l["site"] == "enwiki" and has_en_wikipedia)
                ])
        except Exception as e:
            logger.debug(f"Failed to resolve wikidata Q{wikidata_qid} for {vn_id}: {e}")

    # 3. Release-level links and shop links (deduplicated by site)
    release_links_result = await db.execute(
        select(ExtlinksMaster.site, ExtlinksMaster.value)
        .join(ReleaseExtlink, ReleaseExtlink.link_id == ExtlinksMaster.id)
        .join(ReleaseVN, ReleaseVN.release_id == ReleaseExtlink.release_id)
        .where(ReleaseVN.vn_id == vn_id)
    )

    seen_shop_sites: set[str] = set()
    seen_link_sites: set[str] = {l.site for l in vn_links}
    shops = []
    for site, value in release_links_result:
        if site in DEPRECATED_SITES or site in TRANSLATION_ONLY_SITES or site in NON_JP_CONSOLE_STORES:
            continue
        if site in SHOP_SITES and site not in seen_shop_sites:
            seen_shop_sites.add(site)
            url = build_extlink_url(site, value)
            if url:
                shops.append(schemas.ExtlinkInfo(
                    site=site, url=url, label=get_site_label(site)
                ))
        elif site in LINK_SITES and site not in seen_link_sites:
            seen_link_sites.add(site)
            url = build_extlink_url(site, value)
            if url:
                vn_links.append(schemas.ExtlinkInfo(
                    site=site, url=url, label=get_site_label(site)
                ))

    # Deduplicate: remove from Links any site that also appears in Shops
    if shops:
        shop_site_set = {s.site for s in shops}
        vn_links = [l for l in vn_links if l.site not in shop_site_set]

    # Sort links and shops by priority
    vn_links.sort(key=lambda l: LINK_SORT_ORDER.get(l.site, 50))
    shops.sort(key=lambda s: SHOP_SORT_ORDER.get(s.site, 50))

    return schemas.VNDetailResponse(
        id=vn.id,
        title=vn.title,
        title_jp=vn.title_jp,
        title_romaji=vn.title_romaji,
        description=vn.description,
        image_url=vn.image_url,
        image_sexual=vn.image_sexual,
        released=vn.released,
        length=vn.length,
        rating=vn.rating,
        votecount=vn.votecount,
        languages=vn.languages or [],
        platforms=vn.platforms or [],
        developers=developers,
        tags=tags,
        relations=relations,
        olang=vn.olang,
        updated_at=vn.updated_at,
        links=vn_links,
        shops=shops,
    )


@router.post("/{vn_id}/refresh", response_model=schemas.VNDetailResponse, dependencies=[Depends(require_admin)], include_in_schema=False)
@limiter.limit("5/minute")
async def refresh_vn(
    request: Request,
    vn_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Refresh VN data from VNDB API and save to database.

    Fetches fresh data from VNDB, updates the VisualNovel record,
    and refreshes tag relationships.
    """
    # Normalize VN ID
    normalized_id = vn_id if vn_id.startswith("v") else f"v{vn_id}"

    # Fetch from VNDB API
    vndb_client = get_vndb_client()
    fields = (
        "id,title,titles{title,latin,lang,official,main},aliases,"
        "description,image{url,sexual},length,released,"
        "languages,platforms,developers{id,name},devstatus,"
        "rating,votecount,popularity,tags{id,rating,spoiler,lie},olang,"
        "relations{id,relation,relation_official}"
    )

    try:
        results = await vndb_client.get_vn_by_ids([normalized_id], fields=fields)
    except Exception as e:
        logger.error(f"Failed to fetch VN {normalized_id} from VNDB: {e}")
        raise HTTPException(status_code=502, detail="Failed to fetch from VNDB API")

    if not results:
        raise HTTPException(status_code=404, detail=f"VN {normalized_id} not found on VNDB")

    vn_data = results[0]

    # Parse titles
    title = vn_data.get("title", "")
    title_jp = None
    title_romaji = None
    aliases = vn_data.get("aliases", []) or []

    if titles := vn_data.get("titles", []):
        for t in titles:
            if t.get("main") and t.get("lang") == "ja":
                title_jp = t.get("title")
            if t.get("latin"):
                title_romaji = t.get("latin")

    # Parse image
    image_url = None
    image_sexual = None
    if image := vn_data.get("image"):
        image_url = image.get("url")
        image_sexual = image.get("sexual")

    # Parse release date
    released = None
    if released_str := vn_data.get("released"):
        try:
            # VNDB returns dates as "YYYY-MM-DD" or partial like "YYYY-MM" or "YYYY"
            if len(released_str) == 10:
                released = datetime.strptime(released_str, "%Y-%m-%d").date()
            elif len(released_str) == 7:
                released = datetime.strptime(released_str + "-01", "%Y-%m-%d").date()
            elif len(released_str) == 4:
                released = datetime.strptime(released_str + "-01-01", "%Y-%m-%d").date()
        except ValueError:
            pass

    # Parse developers
    developers_list = []
    if devs := vn_data.get("developers"):
        developers_list = [d.get("id") for d in devs if d.get("id")]

    # Update or insert VN record
    now = datetime.utcnow()
    vn_values = {
        "id": normalized_id,
        "title": title,
        "title_jp": title_jp,
        "title_romaji": title_romaji,
        "aliases": aliases,
        "description": vn_data.get("description"),
        "image_url": image_url,
        "image_sexual": image_sexual,
        "length": vn_data.get("length"),
        "released": released,
        "languages": vn_data.get("languages") or [],
        "platforms": vn_data.get("platforms") or [],
        "developers": developers_list,
        "devstatus": vn_data.get("devstatus", 0),
        # VNDB API returns rating in 0-100 scale, convert to 1-10 scale
        "rating": vn_data.get("rating") / 10 if vn_data.get("rating") else None,
        "votecount": vn_data.get("votecount"),
        "popularity": vn_data.get("popularity"),
        "olang": vn_data.get("olang"),
        "updated_at": now,
    }

    # UPSERT the VN
    stmt = insert(VisualNovel).values(**vn_values)
    stmt = stmt.on_conflict_do_update(
        index_elements=["id"],
        set_={k: v for k, v in vn_values.items() if k != "id"},
    )
    await db.execute(stmt)

    # Refresh tags: delete old and insert new
    await db.execute(delete(VNTag).where(VNTag.vn_id == normalized_id))

    if tags_data := vn_data.get("tags"):
        for tag in tags_data:
            tag_id = tag.get("id")
            if not tag_id:
                continue
            # Extract numeric tag ID from format like "g123"
            if isinstance(tag_id, str) and tag_id.startswith("g"):
                tag_id = int(tag_id[1:])
            elif isinstance(tag_id, str):
                try:
                    tag_id = int(tag_id)
                except ValueError:
                    continue

            # Check if tag exists in our database
            tag_exists = await db.execute(select(Tag.id).where(Tag.id == tag_id))
            if not tag_exists.scalar_one_or_none():
                continue  # Skip tags we don't have

            tag_stmt = insert(VNTag).values(
                vn_id=normalized_id,
                tag_id=tag_id,
                score=tag.get("rating", 0),
                spoiler_level=tag.get("spoiler", 0),
                lie=tag.get("lie", False),
            )
            tag_stmt = tag_stmt.on_conflict_do_update(
                index_elements=["vn_id", "tag_id"],
                set_={
                    "score": tag.get("rating", 0),
                    "spoiler_level": tag.get("spoiler", 0),
                    "lie": tag.get("lie", False),
                },
            )
            await db.execute(tag_stmt)

    # Refresh relations: delete old and insert new
    await db.execute(delete(VNRelation).where(VNRelation.vn_id == normalized_id))

    if relations_data := vn_data.get("relations"):
        for rel in relations_data:
            rel_id = rel.get("id", "")
            if not rel_id:
                continue
            if not rel_id.startswith("v"):
                rel_id = f"v{rel_id}"

            # Check if related VN exists in our database
            related_exists = await db.execute(
                select(VisualNovel.id).where(VisualNovel.id == rel_id)
            )
            if not related_exists.scalar_one_or_none():
                continue

            rel_stmt = insert(VNRelation).values(
                vn_id=normalized_id,
                related_vn_id=rel_id,
                relation=rel.get("relation", ""),
                official=rel.get("relation_official", True),
            )
            rel_stmt = rel_stmt.on_conflict_do_update(
                index_elements=["vn_id", "related_vn_id"],
                set_={
                    "relation": rel.get("relation", ""),
                    "official": rel.get("relation_official", True),
                },
            )
            await db.execute(rel_stmt)

    await db.commit()

    # Fetch and return the updated VN using the existing endpoint logic
    result = await db.execute(select(VisualNovel).where(VisualNovel.id == normalized_id))
    vn = result.scalar_one_or_none()

    if not vn:
        raise HTTPException(status_code=500, detail="Failed to retrieve updated VN")

    # Get tags (exclude disputed/lie tags)
    tags_result = await db.execute(
        select(Tag, VNTag.score, VNTag.spoiler_level)
        .join(VNTag, Tag.id == VNTag.tag_id)
        .where(VNTag.vn_id == normalized_id, VNTag.score > 0, VNTag.lie == False)
        .order_by(VNTag.score.desc())
    )
    tags = [
        schemas.VNTagInfo(
            id=f"g{tag.id}",
            name=tag.name,
            category=tag.category,
            score=score,
            spoiler=spoiler_level,
            vn_count=tag.vn_count or 0,
        )
        for tag, score, spoiler_level in tags_result
    ]

    # Get developers
    developers_result = await db.execute(
        select(Producer.id, Producer.name, Producer.original)
        .distinct()
        .join(ReleaseProducer, Producer.id == ReleaseProducer.producer_id)
        .join(ReleaseVN, ReleaseProducer.release_id == ReleaseVN.release_id)
        .where(ReleaseVN.vn_id == normalized_id)
        .where(ReleaseProducer.developer == True)
    )
    developers = [
        schemas.DeveloperInfo(id=row[0], name=row[1], original=row[2])
        for row in developers_result.all()
    ]

    # Get relations
    relations_result = await db.execute(
        select(
            VNRelation.related_vn_id,
            VNRelation.relation,
            VNRelation.official,
            VisualNovel.title,
            VisualNovel.title_jp,
            VisualNovel.title_romaji,
            VisualNovel.image_url,
            VisualNovel.image_sexual,
            VisualNovel.rating,
            VisualNovel.olang,
        )
        .join(VisualNovel, VNRelation.related_vn_id == VisualNovel.id)
        .where(VNRelation.vn_id == normalized_id)
    )
    relations = [
        schemas.VNRelationInfo(
            id=row[0],
            title=row[3],
            title_jp=row[4],
            title_romaji=row[5],
            relation=row[1],
            relation_official=row[2],
            image_url=row[6],
            image_sexual=row[7],
            rating=row[8],
            olang=row[9],
        )
        for row in relations_result.all()
    ]

    return schemas.VNDetailResponse(
        id=vn.id,
        title=vn.title,
        title_jp=vn.title_jp,
        title_romaji=vn.title_romaji,
        description=vn.description,
        image_url=vn.image_url,
        image_sexual=vn.image_sexual,
        released=vn.released,
        length=vn.length,
        rating=vn.rating,
        votecount=vn.votecount,
        languages=vn.languages or [],
        platforms=vn.platforms or [],
        developers=developers,
        tags=tags,
        relations=relations,
        olang=vn.olang,
        updated_at=vn.updated_at,
    )
