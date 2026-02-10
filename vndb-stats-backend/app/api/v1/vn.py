"""Visual Novel metadata endpoints."""

import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete, case, and_, or_, text
from sqlalchemy.dialects.postgresql import insert

from slowapi import Limiter
from slowapi.util import get_remote_address

from app.db.database import get_db
from app.db import schemas
from app.db.models import VisualNovel, Tag, VNTag, Trait, VNSimilarity, VNCoOccurrence, CharacterVN, CharacterTrait, Character, Producer, Release, ReleaseVN, ReleaseProducer, ReleasePlatform, Staff, VNStaff, VNSeiyuu, VNRelation
from app.core.vndb_client import get_vndb_client
from app.core.auth import require_admin
from app.core.cache import get_cache

logger = logging.getLogger(__name__)

router = APIRouter()
limiter = Limiter(key_func=get_remote_address)

# Security: maximum number of IDs allowed in comma-separated filter parameters
# to prevent DoS via excessively complex queries (each ID can generate a subquery)
MAX_FILTER_IDS = 30


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
    sort: str = Query(default="rating", description="Sort: rating, released, votecount, title"),
    sort_order: str = Query(default="desc", description="Sort order: asc, desc"),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=24, ge=1, le=100),

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
        include_children, year_min, year_max, min_rating, max_rating,
        length, minage, devstatus, olang, platform,
        exclude_length, exclude_minage, exclude_devstatus, exclude_olang, exclude_platform,
        staff, seiyuu, developer, publisher, producer,
        spoiler_level, nsfw, sort, sort_order, page, limit,
    )
    cache_key = f"browse:{hashlib.md5(str(cache_params).encode()).hexdigest()}"
    cached = await cache.get(cache_key)
    if cached:
        cached["query_time"] = round(time.time() - start_time, 3)
        return schemas.VNSearchResponse(**cached)

    # Only select the columns needed for VNSummary response (165 bytes/row vs 748 for full ORM)
    _browse_columns = [
        VisualNovel.id, VisualNovel.title, VisualNovel.title_jp,
        VisualNovel.title_romaji, VisualNovel.image_url, VisualNovel.image_sexual,
        VisualNovel.released, VisualNovel.rating, VisualNovel.votecount,
        VisualNovel.olang,
    ]
    query = select(*_browse_columns)
    count_query = select(func.count(VisualNovel.id))

    # Text search
    if q:
        eq = _escape_like(q)
        # Search in title, title_jp, and title_romaji
        search_filter = or_(
            VisualNovel.title.ilike(f"%{eq}%"),
            VisualNovel.title_jp.ilike(f"%{eq}%"),
            VisualNovel.title_romaji.ilike(f"%{eq}%"),
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

    # Execute (result rows are named tuples, not ORM objects)
    result = await db.execute(query)
    vns = result.all()

    count_result = await db.execute(count_query)
    total = count_result.scalar_one_or_none() or 0

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

        # Execute spoiler-inclusive count query
        spoiler_count_result = await db.execute(spoiler_count_query)
        total_with_spoilers = spoiler_count_result.scalar_one_or_none() or 0

    elapsed_time = time.time() - start_time

    response = schemas.VNSearchResponse(
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
            )
            for vn in vns
        ],
        total=total,
        total_with_spoilers=total_with_spoilers,
        page=page,
        pages=(total + limit - 1) // limit,
        query_time=round(elapsed_time, 3),
    )

    # Cache the response for 60 seconds (data only changes daily)
    await cache.set(cache_key, response.model_dump(mode="json"), ttl=60)

    return response


@router.get("/traits/counts")
async def get_trait_counts(
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

    # Get trait char_counts
    result = await db.execute(
        select(Trait.id, Trait.char_count)
        .where(Trait.id.in_(trait_ids))
    )

    counts = {f"i{row[0]}": row[1] or 0 for row in result.all()}

    # Get total characters in database for IDF calculation
    total_result = await db.execute(
        select(func.count(Character.id))
    )
    total_characters = total_result.scalar_one_or_none() or 0

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

    characters = []
    for char_vn, char in char_result.all():
        # Get traits for this character
        traits_result = await db.execute(
            select(CharacterTrait, Trait)
            .join(Trait, CharacterTrait.trait_id == Trait.id)
            .where(CharacterTrait.character_id == char.id)
            .order_by(Trait.group_name, Trait.name)
        )
        traits = [
            schemas.CharacterTraitInfo(
                id=f"i{trait.id}",
                name=trait.name,
                group_id=trait.group_id,
                group_name=trait.group_name,
                spoiler=char_trait.spoiler_level,
            )
            for char_trait, trait in traits_result.all()
        ]

        characters.append(schemas.VNCharacterResponse(
            id=char.id,
            name=char.name,
            original=char.original,
            image_url=char.image_url,
            role=char_vn.role or 'appears',
            spoiler=char_vn.spoiler_level or 0,
            traits=traits,
        ))

    return characters


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


@router.post("/{vn_id}/refresh", response_model=schemas.VNDetailResponse, dependencies=[Depends(require_admin)])
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
