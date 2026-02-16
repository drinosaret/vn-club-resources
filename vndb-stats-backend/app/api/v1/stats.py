"""
Stats endpoints for user analytics.

============================================================================
DATA SOURCE: LOCAL POSTGRESQL DATABASE (NOT VNDB API)
============================================================================
All statistics in this module are computed from the LOCAL PostgreSQL database
which is populated daily from VNDB database dumps. This provides:
- Complete dataset (40k+ VNs, not API-limited samples)
- Fast queries (local DB, not remote API calls)
- Accurate statistics (full data, not rate-limited approximations)

The StatsService queries the local database models (see app/db/models.py).
DO NOT add VNDB API calls here for VN metadata, tags, or bulk data.

The only VNDB API usage should be in UserService for:
- Fetching a user's current VN list (needs real-time data)
- Username → UID lookups
============================================================================
"""

import asyncio
import hashlib
import json
import logging
import re
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from slowapi import Limiter
from slowapi.util import get_remote_address
from app.core.auth import require_admin, is_admin_request

from app.config import get_settings

# Rate limiter for user stats endpoint - prevents abuse of expensive calculations
# Key: IP address + user ID to limit requests per user profile
def _get_stats_rate_key(request: Request) -> str:
    """Rate limit key combining IP and user ID."""
    ip = get_remote_address(request)
    vndb_uid = request.path_params.get("vndb_uid", "unknown")
    return f"{ip}:{vndb_uid}"

stats_limiter = Limiter(key_func=_get_stats_rate_key)
from sqlalchemy import select, text, func, distinct
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.db import schemas
from app.db.models import Tag, Trait, Character, CharacterTrait, CharacterVN, VisualNovel, Staff, Producer
from app.services.stats_service import StatsService
from app.services.user_service import UserService

logger = logging.getLogger(__name__)

router = APIRouter()

# Cache durations in seconds
CACHE_GLOBAL_STATS = 3600  # 1 hour - global stats change infrequently
CACHE_TAG_STATS = 3600  # 1 hour - tag stats are stable
CACHE_USER_STATS = 1800  # 30 min - user stats based on their list


def generate_etag(data: dict) -> str:
    """Generate an ETag from response data."""
    content = json.dumps(data, sort_keys=True, default=str)
    return f'"{hashlib.md5(content.encode()).hexdigest()}"'


def check_etag_match(request: Request, etag: str) -> bool:
    """Check if the client's If-None-Match header matches the ETag."""
    if_none_match = request.headers.get("if-none-match")
    if if_none_match:
        # Handle multiple ETags (comma-separated)
        client_etags = [e.strip() for e in if_none_match.split(",")]
        return etag in client_etags or "*" in client_etags
    return False


async def resolve_user_id(user_service: UserService, user_input: str) -> str:
    """
    Resolve a username or UID to a VNDB UID.

    Args:
        user_service: UserService instance
        user_input: Either a VNDB UID (e.g., "u12345") or username (e.g., "username")

    Returns:
        VNDB UID (e.g., "u12345")

    Raises:
        HTTPException: If user is not found
    """
    # If it's already a UID format, return as-is
    if re.match(r'^u\d+$', user_input):
        return user_input

    # Otherwise, look up by username
    user_lookup = await user_service.lookup_user_by_username(user_input)
    if not user_lookup:
        raise HTTPException(status_code=404, detail=f"User {user_input} not found")
    return user_lookup.uid


@router.get("/global", response_model=schemas.GlobalStatsResponse)
async def get_global_stats(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
    nocache: bool = False,
):
    """
    Get global database statistics.

    Includes:
    - Total VN count and rated count
    - Average rating across all VNs
    - Score distribution (1-10)
    - Release year distribution with average ratings
    - Length distribution with average ratings
    - Age rating distribution with average ratings
    """
    # Global stats can be cached publicly (no user-specific data)
    response.headers["Cache-Control"] = f"public, max-age={CACHE_GLOBAL_STATS}"

    # Only allow cache bypass for admin requests
    if nocache and not await is_admin_request(request):
        nocache = False

    stats_service = StatsService(db)
    result = await stats_service.get_global_stats(force_refresh=nocache)

    # Generate and check ETag for 304 Not Modified
    etag = generate_etag(result.model_dump())
    response.headers["ETag"] = etag
    if check_etag_match(request, etag):
        return Response(status_code=304, headers={"ETag": etag})

    return result


@router.get("/tag/{tag_id}", response_model=schemas.TagStatsResponse)
async def get_tag_stats(
    tag_id: str,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
    nocache: bool = False,
):
    """
    Get aggregate statistics for all VNs with a specific tag.

    This endpoint computes stats from the FULL database, not a sample.

    Includes:
    - Tag information (name, description, category)
    - Average rating across all VNs with this tag
    - Total vote count
    - Score distribution (1-10)
    - Release year distribution with average ratings
    - Length distribution with average ratings
    - Age rating distribution with average ratings
    """
    # Tag stats can be cached publicly
    response.headers["Cache-Control"] = f"public, max-age={CACHE_TAG_STATS}"

    # Parse tag ID - accept both "g123" and "123" formats
    match = re.match(r'^g?(\d+)$', tag_id)
    if not match:
        raise HTTPException(status_code=400, detail="Invalid tag ID format")

    numeric_tag_id = int(match.group(1))

    if nocache and not await is_admin_request(request):
        nocache = False

    stats_service = StatsService(db)
    result = await stats_service.get_tag_stats(numeric_tag_id, force_refresh=nocache)

    if not result:
        raise HTTPException(status_code=404, detail=f"Tag {tag_id} not found")

    # Generate and check ETag for 304 Not Modified
    etag = generate_etag(result.model_dump())
    response.headers["ETag"] = etag
    if check_etag_match(request, etag):
        return Response(status_code=304, headers={"ETag": etag})

    return result


@router.get("/trait/{trait_id}", response_model=schemas.TraitStatsResponse)
async def get_trait_stats(
    trait_id: str,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
    nocache: bool = False,
):
    """
    Get aggregate statistics for all VNs with characters having a specific trait.

    This endpoint computes stats from the FULL database, not a sample.

    Includes:
    - Trait information (name, description, group)
    - Average rating across all VNs with this trait
    - Total vote count
    - Score distribution (1-10)
    - Release year distribution with average ratings
    - Length distribution with average ratings
    - Age rating distribution with average ratings
    """
    # Trait stats can be cached publicly
    response.headers["Cache-Control"] = f"public, max-age={CACHE_TAG_STATS}"

    # Parse trait ID - accept both "i123" and "123" formats
    match = re.match(r'^i?(\d+)$', trait_id)
    if not match:
        raise HTTPException(status_code=400, detail="Invalid trait ID format")

    numeric_trait_id = int(match.group(1))

    if nocache and not await is_admin_request(request):
        nocache = False

    stats_service = StatsService(db)
    result = await stats_service.get_trait_stats(numeric_trait_id, force_refresh=nocache)

    if not result:
        raise HTTPException(status_code=404, detail=f"Trait {trait_id} not found")

    # Generate and check ETag for 304 Not Modified
    etag = generate_etag(result.model_dump())
    response.headers["ETag"] = etag
    if check_etag_match(request, etag):
        return Response(status_code=304, headers={"ETag": etag})

    return result


@router.get("/tag/{tag_id}/vns-by-category", response_model=schemas.VNListByCategoryResponse)
async def get_tag_vns_by_category(
    tag_id: str,
    category_type: str,
    category_value: str,
    response: Response,
    db: AsyncSession = Depends(get_db),
    limit: int = 20,
    offset: int = 0,
):
    """
    Get VNs with a specific tag filtered by category.

    Category types:
    - release_year: Filter by year (e.g., "2017")
    - length: Filter by length category (very_short, short, medium, long, very_long)
    - score: Filter by score bucket (1-10)
    - age_rating: Filter by age category (all_ages, teen, adult)

    Returns paginated list of VNs sorted by rating descending.
    """
    response.headers["Cache-Control"] = f"public, max-age={CACHE_TAG_STATS}"

    # Parse tag ID
    match = re.match(r'^g?(\d+)$', tag_id)
    if not match:
        raise HTTPException(status_code=400, detail="Invalid tag ID format")

    numeric_tag_id = int(match.group(1))

    # Validate category_type
    valid_types = ["release_year", "length", "score", "age_rating"]
    if category_type not in valid_types:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid category_type. Must be one of: {', '.join(valid_types)}"
        )

    # Validate limit/offset
    limit = max(1, min(100, limit))
    offset = max(0, offset)

    stats_service = StatsService(db)
    vns, total = await stats_service.get_tag_vns_by_category(
        numeric_tag_id, category_type, category_value, limit, offset
    )

    return schemas.VNListByCategoryResponse(
        vns=[schemas.VNSummary(**vn) for vn in vns],
        total=total,
        limit=limit,
        offset=offset,
        has_more=offset + len(vns) < total,
    )


@router.get("/tag/{tag_id}/vns-with-tags", response_model=schemas.TagVNsWithTagsResponse)
async def get_tag_vns_with_tags(
    tag_id: str,
    response: Response,
    db: AsyncSession = Depends(get_db),
    page: int = 1,
    limit: int = 24,
    sort: str = "rating",
    spoiler_level: int = Query(0, ge=0, le=2),
    olang: str | None = Query(default=None),
):
    """
    Get VNs with a specific tag, including full tag data for each VN.

    This endpoint returns ALL tags for each VN with complete data (id, name, score,
    vn_count, spoiler) needed for IDF-weighted sorting on the frontend.

    Sort options: rating (default), votecount, released
    """
    response.headers["Cache-Control"] = f"public, max-age={CACHE_TAG_STATS}"

    # Parse tag ID
    match = re.match(r'^g?(\d+)$', tag_id)
    if not match:
        raise HTTPException(status_code=400, detail="Invalid tag ID format")

    numeric_tag_id = int(match.group(1))

    # Validate sort
    valid_sorts = ["rating", "votecount", "released"]
    if sort not in valid_sorts:
        sort = "rating"

    # Validate page and limit
    page = max(1, page)
    limit = max(1, min(100, limit))

    # Get tag info
    tag_result = await db.execute(
        select(Tag).where(Tag.id == numeric_tag_id)
    )
    tag = tag_result.scalar_one_or_none()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")

    stats_service = StatsService(db)
    vns, total, pages = await stats_service.get_tag_vns_with_full_tags(
        numeric_tag_id, page, limit, sort, spoiler_level=spoiler_level, olang=olang
    )

    return schemas.TagVNsWithTagsResponse(
        tag=schemas.TagDetailResponse(
            id=f"g{tag.id}",
            name=tag.name,
            description=tag.description,
            category=tag.category,
            vn_count=tag.vn_count or 0,
            aliases=tag.aliases.split(",") if tag.aliases and isinstance(tag.aliases, str) else None,
        ),
        vns=[schemas.VNWithTags(
            id=vn["id"],
            title=vn["title"],
            title_jp=vn["title_jp"],
            title_romaji=vn["title_romaji"],
            image_url=vn["image_url"],
            image_sexual=vn["image_sexual"],
            released=vn["released"],
            rating=vn["rating"],
            votecount=vn["votecount"],
            olang=vn["olang"],
            tags=[schemas.VNTagInfo(**t) for t in vn["tags"]],
        ) for vn in vns],
        total=total,
        page=page,
        pages=pages,
    )


@router.get("/tag/{tag_id}/debug/length-vns", dependencies=[Depends(require_admin)])
async def debug_tag_length_vns(
    tag_id: str,
    category: str,
    db: AsyncSession = Depends(get_db),
    limit: int = 5000,
    offset: int = 0,
):
    """Debug helper: return VN IDs counted in a length bucket for a tag.

    This is intended for debugging count mismatches vs VNDB. It returns the
    computed bucket using the same logic as the tag stats distribution.

    Query params:
    - category: very_short | short | medium | long | very_long
    - limit/offset: paging over the matching VN list
    """
    match = re.match(r'^g?(\d+)$', tag_id)
    if not match:
        raise HTTPException(status_code=400, detail="Invalid tag ID format")
    numeric_tag_id = int(match.group(1))

    valid = {"very_short", "short", "medium", "long", "very_long"}
    if category not in valid:
        raise HTTPException(status_code=400, detail=f"Invalid category. Must be one of: {', '.join(sorted(valid))}")

    limit = max(1, min(20000, limit))
    offset = max(0, offset)

    stats_service = StatsService(db)
    return await stats_service.debug_tag_length_vns(numeric_tag_id, category, limit=limit, offset=offset)


@router.get("/tag/{tag_id}/similar")
async def get_similar_tags(
    tag_id: str,
    response: Response,
    db: AsyncSession = Depends(get_db),
    limit: int = 30,
):
    """
    Get tags similar to the specified tag using NPMI-based similarity.

    NPMI (Normalized Pointwise Mutual Information) measures how much more
    likely two tags co-occur than expected by chance. This naturally penalizes
    overly common tags like "ADV" that appear on almost every VN.

    Returns tags sorted by similarity score (0-1), where higher means more related.
    """
    response.headers["Cache-Control"] = "public, max-age=3600"

    # Parse tag ID (accepts "g123" or "123")
    match = re.match(r'^g?(\d+)$', tag_id)
    if not match:
        raise HTTPException(status_code=400, detail="Invalid tag ID format")

    numeric_tag_id = int(match.group(1))
    limit = max(1, min(50, limit))

    stats_service = StatsService(db)
    return await stats_service.get_similar_tags(numeric_tag_id, limit=limit)


@router.get("/tag/{tag_id}/children")
async def get_tag_children(
    tag_id: str,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """
    Get all direct child tags of a given tag.

    Returns child tags sorted by name with their VN counts.
    """
    response.headers["Cache-Control"] = "public, max-age=3600"

    # Parse tag ID (accepts "g123" or "123")
    match = re.match(r'^g?(\d+)$', tag_id)
    if not match:
        raise HTTPException(status_code=400, detail="Invalid tag ID format")

    numeric_tag_id = int(match.group(1))

    result = await db.execute(text("""
        SELECT DISTINCT t.id, t.name, t.vn_count
        FROM tags t JOIN tag_parents tp ON t.id = tp.tag_id
        WHERE tp.parent_id = :parent_id
        ORDER BY t.name
    """), {"parent_id": numeric_tag_id})
    children = result.fetchall()

    return [
        {"id": f"g{row[0]}", "name": row[1], "vn_count": row[2]}
        for row in children
    ]


@router.get("/tag/{tag_id}/parents")
async def get_tag_parents(
    tag_id: str,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """
    Get the parent chain from root to the specified tag (for breadcrumb navigation).

    Returns an ordered list of parent tags from root to immediate parent.
    Does not include the current tag itself.
    """
    response.headers["Cache-Control"] = "public, max-age=3600"

    # Parse tag ID (accepts "g123" or "123")
    match = re.match(r'^g?(\d+)$', tag_id)
    if not match:
        raise HTTPException(status_code=400, detail="Invalid tag ID format")

    numeric_tag_id = int(match.group(1))

    # Recursive CTE to get all ancestors
    result = await db.execute(text("""
        WITH RECURSIVE parent_chain AS (
            SELECT id, name, parent_id, 0 as depth FROM tags WHERE id = :tag_id
            UNION ALL
            SELECT t.id, t.name, t.parent_id, pc.depth + 1
            FROM tags t JOIN parent_chain pc ON t.id = pc.parent_id
        )
        SELECT id, name FROM parent_chain WHERE depth > 0 ORDER BY depth DESC
    """), {"tag_id": numeric_tag_id})

    parents = [{"id": f"g{row[0]}", "name": row[1]} for row in result.fetchall()]
    return parents


@router.get("/trait/{trait_id}/children")
async def get_trait_children(
    trait_id: str,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """
    Get all direct child traits of a given trait.

    Returns child traits sorted by name with their character counts.
    """
    response.headers["Cache-Control"] = "public, max-age=3600"

    # Parse trait ID (accepts "i123" or "123")
    match = re.match(r'^i?(\d+)$', trait_id)
    if not match:
        raise HTTPException(status_code=400, detail="Invalid trait ID format")

    numeric_trait_id = int(match.group(1))

    result = await db.execute(text("""
        SELECT DISTINCT t.id, t.name, t.char_count
        FROM traits t JOIN trait_parents tp ON t.id = tp.trait_id
        WHERE tp.parent_id = :parent_id
        ORDER BY t.name
    """), {"parent_id": numeric_trait_id})
    children = result.fetchall()

    return [
        {"id": f"i{row[0]}", "name": row[1], "char_count": row[2]}
        for row in children
    ]


@router.get("/trait/{trait_id}/parents")
async def get_trait_parents(
    trait_id: str,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """
    Get the parent chain from root to the specified trait (for breadcrumb navigation).

    Returns an ordered list of parent traits from root to immediate parent.
    Does not include the current trait itself.
    """
    response.headers["Cache-Control"] = "public, max-age=3600"

    # Parse trait ID (accepts "i123" or "123")
    match = re.match(r'^i?(\d+)$', trait_id)
    if not match:
        raise HTTPException(status_code=400, detail="Invalid trait ID format")

    numeric_trait_id = int(match.group(1))

    # Recursive CTE to get all ancestors via group_id
    result = await db.execute(text("""
        WITH RECURSIVE parent_chain AS (
            SELECT id, name, group_id, 0 as depth FROM traits WHERE id = :trait_id
            UNION ALL
            SELECT t.id, t.name, t.group_id, pc.depth + 1
            FROM traits t JOIN parent_chain pc ON t.id = pc.group_id
        )
        SELECT id, name FROM parent_chain WHERE depth > 0 ORDER BY depth DESC
    """), {"trait_id": numeric_trait_id})

    parents = [{"id": f"i{row[0]}", "name": row[1]} for row in result.fetchall()]
    return parents


@router.get("/trait/{trait_id}/characters", response_model=schemas.TraitCharactersResponse)
async def get_trait_characters(
    trait_id: str,
    response: Response,
    db: AsyncSession = Depends(get_db),
    page: int = 1,
    limit: int = 24,
    olang: str | None = Query(default=None),
):
    """
    Get characters with a specific trait.

    Returns a paginated list of characters with the specified trait,
    including their VN appearances. Can be filtered by VN original language.
    """
    response.headers["Cache-Control"] = f"public, max-age={CACHE_TAG_STATS}"

    # Parse trait ID (accepts "i123" or "123")
    match = re.match(r'^i?(\d+)$', trait_id)
    if not match:
        raise HTTPException(status_code=400, detail="Invalid trait ID format")

    numeric_trait_id = int(match.group(1))

    # Validate page and limit
    page = max(1, page)
    limit = max(1, min(100, limit))
    offset = (page - 1) * limit

    # Build the base query for characters with this trait
    # Join Character -> CharacterTrait -> CharacterVN -> VisualNovel
    base_query = (
        select(Character)
        .join(CharacterTrait, Character.id == CharacterTrait.character_id)
        .where(CharacterTrait.trait_id == numeric_trait_id)
    )

    # If filtering by language, we need to ensure at least one VN matches
    if olang:
        base_query = (
            base_query
            .join(CharacterVN, Character.id == CharacterVN.character_id)
            .join(VisualNovel, CharacterVN.vn_id == VisualNovel.id)
            .where(VisualNovel.olang == olang)
        )

    # Get distinct characters (a character may appear in multiple VNs)
    base_query = base_query.distinct()

    # Count total characters
    count_query = select(func.count()).select_from(base_query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar_one_or_none() or 0

    # Calculate total pages
    pages = (total + limit - 1) // limit if total > 0 else 1

    # Fetch paginated characters
    chars_query = base_query.order_by(Character.name).offset(offset).limit(limit)
    chars_result = await db.execute(chars_query)
    characters = chars_result.scalars().all()

    # Batch-fetch VN appearances for all characters in a single query
    char_ids = [char.id for char in characters]
    char_vn_map: dict[str, list[schemas.TraitCharacterVNInfo]] = {cid: [] for cid in char_ids}

    if char_ids:
        # Use a window function to limit to 3 VNs per character
        vn_with_row = (
            select(
                CharacterVN.character_id,
                VisualNovel.id,
                VisualNovel.title,
                VisualNovel.title_jp,
                VisualNovel.title_romaji,
                VisualNovel.olang,
                func.row_number().over(
                    partition_by=CharacterVN.character_id,
                    order_by=VisualNovel.id,
                ).label("rn"),
            )
            .join(VisualNovel, CharacterVN.vn_id == VisualNovel.id)
            .where(CharacterVN.character_id.in_(char_ids))
        )
        if olang:
            vn_with_row = vn_with_row.where(VisualNovel.olang == olang)
        vn_subq = vn_with_row.subquery()
        vns_query = select(vn_subq).where(vn_subq.c.rn <= 3)

        vns_result = await db.execute(vns_query)
        for row in vns_result.fetchall():
            char_vn_map[row[0]].append(
                schemas.TraitCharacterVNInfo(
                    id=row[1],
                    title=row[2],
                    title_jp=row[3],
                    title_romaji=row[4],
                    olang=row[5],
                )
            )

    char_vn_data = [
        schemas.TraitCharacter(
            id=char.id,
            name=char.name,
            original=char.original,
            image_url=char.image_url,
            image_sexual=char.image_sexual,
            sex=char.sex,
            vns=char_vn_map.get(char.id, []),
        )
        for char in characters
    ]

    return schemas.TraitCharactersResponse(
        characters=char_vn_data,
        total=total,
        page=page,
        pages=pages,
    )


@router.get("/trait/{trait_id}/vns-with-tags", response_model=schemas.TraitVNsWithTagsResponse)
async def get_trait_vns_with_tags(
    trait_id: str,
    response: Response,
    db: AsyncSession = Depends(get_db),
    page: int = 1,
    limit: int = 24,
    sort: str = "rating",
    spoiler_level: int = Query(0, ge=0, le=2),
    olang: str | None = Query(default=None),
):
    """
    Get VNs with characters having a specific trait, including full tag data for each VN.

    This endpoint returns ALL tags for each VN with complete data (id, name, score,
    vn_count, spoiler) needed for IDF-weighted sorting on the frontend.

    Sort options: rating (default), votecount, released
    """
    response.headers["Cache-Control"] = f"public, max-age={CACHE_TAG_STATS}"

    # Parse trait ID
    match = re.match(r'^i?(\d+)$', trait_id)
    if not match:
        raise HTTPException(status_code=400, detail="Invalid trait ID format")

    numeric_trait_id = int(match.group(1))

    # Validate sort
    valid_sorts = ["rating", "votecount", "released"]
    if sort not in valid_sorts:
        sort = "rating"

    # Validate page and limit
    page = max(1, page)
    limit = max(1, min(100, limit))

    stats_service = StatsService(db)
    vns, total, pages = await stats_service.get_trait_vns_with_full_tags(
        numeric_trait_id, page, limit, sort, spoiler_level=spoiler_level, olang=olang
    )

    return schemas.TraitVNsWithTagsResponse(
        vns=[schemas.VNWithTags(
            id=vn["id"],
            title=vn["title"],
            title_jp=vn["title_jp"],
            title_romaji=vn["title_romaji"],
            image_url=vn["image_url"],
            image_sexual=vn["image_sexual"],
            released=vn["released"],
            rating=vn["rating"],
            votecount=vn["votecount"],
            olang=vn["olang"],
            tags=[schemas.VNTagInfo(**t) for t in vn["tags"]],
        ) for vn in vns],
        total=total,
        page=page,
        pages=pages,
    )


@router.get("/trait/{trait_id}/vns-by-category", response_model=schemas.VNListByCategoryResponse)
async def get_trait_vns_by_category(
    trait_id: str,
    category_type: str,
    category_value: str,
    response: Response,
    db: AsyncSession = Depends(get_db),
    limit: int = 20,
    offset: int = 0,
):
    """
    Get VNs with characters having a specific trait, filtered by category.

    Category types:
    - release_year: Filter by year (e.g., "2017")
    - length: Filter by length category (very_short, short, medium, long, very_long)
    - score: Filter by score bucket (1-10)
    - age_rating: Filter by age category (all_ages, teen, adult)

    Returns paginated list of VNs sorted by rating descending.
    """
    response.headers["Cache-Control"] = f"public, max-age={CACHE_TAG_STATS}"

    # Parse trait ID
    match = re.match(r'^i?(\d+)$', trait_id)
    if not match:
        raise HTTPException(status_code=400, detail="Invalid trait ID format")

    numeric_trait_id = int(match.group(1))

    # Validate category_type
    valid_types = ["release_year", "length", "score", "age_rating"]
    if category_type not in valid_types:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid category_type. Must be one of: {', '.join(valid_types)}"
        )

    # Validate limit/offset
    limit = max(1, min(100, limit))
    offset = max(0, offset)

    stats_service = StatsService(db)
    vns, total = await stats_service.get_trait_vns_by_category(
        numeric_trait_id, category_type, category_value, limit, offset
    )

    return schemas.VNListByCategoryResponse(
        vns=[schemas.VNSummary(**vn) for vn in vns],
        total=total,
        limit=limit,
        offset=offset,
        has_more=offset + len(vns) < total,
    )


@router.get("/trait/{trait_id}/similar")
async def get_similar_traits(
    trait_id: str,
    response: Response,
    db: AsyncSession = Depends(get_db),
    limit: int = 30,
):
    """
    Get traits similar to the specified trait using NPMI-based similarity.

    NPMI (Normalized Pointwise Mutual Information) measures how much more
    likely two traits co-occur on characters than expected by chance.
    This naturally penalizes overly common traits like "Pale" or "Slim".

    Returns traits sorted by similarity score (0-1), where higher means more related.
    """
    response.headers["Cache-Control"] = "public, max-age=3600"

    # Parse trait ID (accepts "i123" or "123")
    match = re.match(r'^i?(\d+)$', trait_id)
    if not match:
        raise HTTPException(status_code=400, detail="Invalid trait ID format")

    numeric_trait_id = int(match.group(1))
    limit = max(1, min(50, limit))

    stats_service = StatsService(db)
    return await stats_service.get_similar_traits(numeric_trait_id, limit=limit)


@router.get("/tag/{tag_id}/traits")
async def get_tag_traits(
    tag_id: str,
    response: Response,
    db: AsyncSession = Depends(get_db),
    limit: int = 30,
):
    """
    Get traits related to the specified tag using NPMI-based similarity.

    Finds traits that appear on characters in VNs with this tag,
    ranked by how much more likely they co-occur than expected by chance.
    This naturally penalizes overly common traits like "Pale" or "Slim".
    """
    response.headers["Cache-Control"] = "public, max-age=3600"

    # Parse tag ID (accepts "g123" or "123")
    match = re.match(r'^g?(\d+)$', tag_id)
    if not match:
        raise HTTPException(status_code=400, detail="Invalid tag ID format")

    numeric_tag_id = int(match.group(1))
    limit = max(1, min(50, limit))

    stats_service = StatsService(db)
    return await stats_service.get_tag_traits(numeric_tag_id, limit=limit)


@router.get("/trait/{trait_id}/tags")
async def get_trait_tags(
    trait_id: str,
    response: Response,
    db: AsyncSession = Depends(get_db),
    limit: int = 30,
):
    """
    Get tags related to the specified trait using NPMI-based similarity.

    Finds tags on VNs that have characters with this trait,
    ranked by how much more likely they co-occur than expected by chance.
    This naturally penalizes overly common tags like "ADV" or "Romance".
    """
    response.headers["Cache-Control"] = "public, max-age=3600"

    # Parse trait ID (accepts "i123" or "123")
    match = re.match(r'^i?(\d+)$', trait_id)
    if not match:
        raise HTTPException(status_code=400, detail="Invalid trait ID format")

    numeric_trait_id = int(match.group(1))
    limit = max(1, min(50, limit))

    stats_service = StatsService(db)
    return await stats_service.get_trait_tags(numeric_trait_id, limit=limit)


@router.get("/{vndb_uid}", response_model=schemas.UserStatsResponse)
@stats_limiter.limit("10/minute")  # Limit expensive stats calculations per user
async def get_user_stats(
    vndb_uid: str,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
    force_refresh: bool = Query(False, description="Clear Redis cache and re-read from local database"),
):
    """
    Get comprehensive statistics for a VNDB user.

    Accepts either a VNDB UID (e.g., "u12345") or a username (e.g., "username").

    Data comes from local database (populated by daily VNDB database dumps).
    Use `?force_refresh=true` to clear Redis cache and re-read from database.

    Includes:
    - Summary stats (total VNs, average score, etc.)
    - Score distribution
    - Release year distribution
    - Monthly activity
    - Platform breakdown
    """
    # User stats are private (user-specific data)
    response.headers["Cache-Control"] = f"private, max-age={CACHE_USER_STATS}"

    user_service = UserService(db)
    stats_service = StatsService(db)

    # Resolve username to UID if needed
    uid = await resolve_user_id(user_service, vndb_uid)

    # Force refresh clears Redis cache and re-reads from local database
    if force_refresh:
        logger.info(f"Force refresh requested for {uid}")
        await user_service.refresh_user_data(uid)

    # Fetch or refresh user data
    user_data = await user_service.get_user_list(uid, force_refresh=force_refresh)
    if not user_data:
        raise HTTPException(status_code=404, detail=f"User {vndb_uid} not found")

    # Calculate stats with timeout to prevent blocking
    settings = get_settings()
    try:
        async with asyncio.timeout(settings.user_stats_timeout):
            stats = await stats_service.calculate_user_stats(uid, user_data)
    except asyncio.TimeoutError:
        logger.warning(f"Stats calculation timed out for {uid} after {settings.user_stats_timeout}s")
        raise HTTPException(
            status_code=504,
            detail=f"Stats calculation timed out. User may have too many VNs. Please try again."
        )
    except Exception as e:
        logger.error(f"Failed to calculate stats for {uid}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to calculate stats. Please try again later.")

    # Generate and check ETag for 304 Not Modified
    etag = generate_etag(stats.model_dump())
    response.headers["ETag"] = etag
    if check_etag_match(request, etag):
        return Response(status_code=304, headers={"ETag": etag})

    return stats


@router.get("/{vndb_uid}/tags", response_model=schemas.TagAnalyticsResponse)
async def get_user_tag_analytics(
    vndb_uid: str,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """
    Get tag analytics for a user.

    Includes:
    - Top tags by frequency and average score
    - Tag preferences (loved vs avoided)
    - Tag trends over time
    - Comparison to global averages
    """
    # User-specific tag analytics
    response.headers["Cache-Control"] = f"private, max-age={CACHE_USER_STATS}"

    user_service = UserService(db)
    stats_service = StatsService(db)

    # Resolve username to UID if needed
    uid = await resolve_user_id(user_service, vndb_uid)

    user_data = await user_service.get_user_list(uid)
    if not user_data:
        raise HTTPException(status_code=404, detail=f"User {vndb_uid} not found")

    tag_analytics = await stats_service.calculate_tag_analytics(uid, user_data)

    # Generate and check ETag for 304 Not Modified
    etag = generate_etag(tag_analytics.model_dump())
    response.headers["ETag"] = etag
    if check_etag_match(request, etag):
        return Response(status_code=304, headers={"ETag": etag})

    return tag_analytics


@router.get("/{vndb_uid}/compare/{other_uid}", response_model=schemas.UserComparisonResponse)
async def compare_users(
    vndb_uid: str,
    other_uid: str,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """
    Compare statistics between two users.

    Includes:
    - Compatibility score
    - Shared VNs and scores
    - Score correlation
    - Biggest disagreements
    - Common and differing tag preferences
    """
    # User comparison is private
    response.headers["Cache-Control"] = f"private, max-age={CACHE_USER_STATS}"

    user_service = UserService(db)
    stats_service = StatsService(db)

    # Resolve usernames to UIDs if needed
    uid1 = await resolve_user_id(user_service, vndb_uid)
    uid2 = await resolve_user_id(user_service, other_uid)

    user1_data = await user_service.get_user_list(uid1)
    user2_data = await user_service.get_user_list(uid2)

    if not user1_data:
        raise HTTPException(status_code=404, detail=f"User {vndb_uid} not found")
    if not user2_data:
        raise HTTPException(status_code=404, detail=f"User {other_uid} not found")

    # Calculate tag analytics for both users (for enhanced comparison)
    try:
        tag_analytics1 = await stats_service.calculate_tag_analytics(uid1, user1_data)
        tag_analytics2 = await stats_service.calculate_tag_analytics(uid2, user2_data)

        # Convert to dict format expected by compare_users
        user1_data["tag_stats"] = [
            {"tag_id": t.tag_id, "name": t.name, "count": t.count, "avg_score": t.avg_score}
            for t in tag_analytics1.top_tags
        ]
        user2_data["tag_stats"] = [
            {"tag_id": t.tag_id, "name": t.name, "count": t.count, "avg_score": t.avg_score}
            for t in tag_analytics2.top_tags
        ]
    except Exception:
        # Tag analytics may fail for some users - continue without it
        pass

    comparison = await stats_service.compare_users(uid1, user1_data, uid2, user2_data)

    # Generate and check ETag for 304 Not Modified
    etag = generate_etag(comparison.model_dump())
    response.headers["ETag"] = etag
    if check_etag_match(request, etag):
        return Response(status_code=304, headers={"ETag": etag})

    return comparison


@router.get("/{vndb_uid}/similar", response_model=list[schemas.SimilarUserResponse])
async def get_similar_users(
    vndb_uid: str,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
    limit: int = 10,
):
    """
    Find users with similar VN tastes.

    Returns a list of users sorted by compatibility score (highest first).
    Compares against all users in the database who share rated VNs with the target user.
    """
    user_service = UserService(db)
    stats_service = StatsService(db)

    # Resolve username to UID if needed
    uid = await resolve_user_id(user_service, vndb_uid)

    # Get target user's data
    user_data = await user_service.get_user_list(uid)
    if not user_data:
        raise HTTPException(status_code=404, detail=f"User {vndb_uid} not found")

    # Find similar users
    similar_users = await stats_service.find_similar_users(uid, user_data, limit=limit)

    # Generate and check ETag for 304 Not Modified
    response_data = [u.model_dump() for u in similar_users]
    etag = generate_etag({"users": response_data})
    response.headers["ETag"] = etag
    response.headers["Cache-Control"] = f"private, max-age={CACHE_USER_STATS}"
    if check_etag_match(request, etag):
        return Response(status_code=304, headers={"ETag": etag})

    return similar_users


# ============ Producer Stats Endpoints ============

@router.get("/producer/{producer_id}", response_model=schemas.ProducerStatsResponse)
async def get_producer_stats(
    producer_id: str,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
    nocache: bool = False,
):
    """
    Get aggregate statistics for all VNs by a specific producer/developer.

    This endpoint computes stats from the FULL database, not a sample.

    Includes:
    - Producer information (name, type, description)
    - Average and Bayesian rating across all VNs
    - Total vote count
    - Score distribution (1-10)
    - Release year distribution with average ratings
    - Length distribution with average ratings
    - Age rating distribution with average ratings
    """
    # Producer stats can be cached publicly
    response.headers["Cache-Control"] = f"public, max-age={CACHE_TAG_STATS}"

    # Parse producer ID - accept both "p123" and "123" formats
    match = re.match(r'^p?(\d+)$', producer_id)
    if not match:
        raise HTTPException(status_code=400, detail="Invalid producer ID format")

    if nocache and not await is_admin_request(request):
        nocache = False

    stats_service = StatsService(db)
    result = await stats_service.get_producer_stats(producer_id, force_refresh=nocache)

    if not result:
        raise HTTPException(status_code=404, detail=f"Producer {producer_id} not found")

    # Generate and check ETag for 304 Not Modified
    etag = generate_etag(result.model_dump())
    response.headers["ETag"] = etag
    if check_etag_match(request, etag):
        return Response(status_code=304, headers={"ETag": etag})

    return result


@router.get("/producer/{producer_id}/vns", response_model=schemas.ProducerVNsResponse)
async def get_producer_vns(
    producer_id: str,
    response: Response,
    db: AsyncSession = Depends(get_db),
    page: int = 1,
    limit: int = 24,
    sort: str = "rating",
):
    """
    Get paginated list of VNs by a producer/developer.

    Args:
        producer_id: Producer ID (e.g., "p42" or "42")
        page: Page number (1-indexed)
        limit: Items per page (max 100)
        sort: Sort order - "rating" (default), "released", "votecount"
    """
    # Can be cached publicly
    response.headers["Cache-Control"] = f"public, max-age={CACHE_TAG_STATS}"

    # Parse producer ID
    match = re.match(r'^p?(\d+)$', producer_id)
    if not match:
        raise HTTPException(status_code=400, detail="Invalid producer ID format")

    # Validate limit
    limit = min(limit, 100)

    stats_service = StatsService(db)
    result = await stats_service.get_producer_vns(producer_id, page=page, limit=limit, sort=sort)

    if not result:
        raise HTTPException(status_code=404, detail=f"Producer {producer_id} not found")

    return result


@router.get("/producer/{producer_id}/vns-with-tags", response_model=schemas.ProducerVNsWithTagsResponse)
async def get_producer_vns_with_tags(
    producer_id: str,
    response: Response,
    db: AsyncSession = Depends(get_db),
    page: int = 1,
    limit: int = 24,
    sort: str = "rating",
    spoiler_level: int = Query(0, ge=0, le=2),
    olang: str | None = Query(default=None),
):
    """
    Get paginated list of VNs by a producer/developer, with full tag data.

    This endpoint returns VNs with all their tags including vn_count and spoiler
    information needed for weighted sorting on the frontend.

    Args:
        producer_id: Producer ID (e.g., "p42" or "42")
        page: Page number (1-indexed)
        limit: Items per page (max 100)
        sort: Sort order - "rating" (default), "released", "votecount"
    """
    response.headers["Cache-Control"] = f"public, max-age={CACHE_TAG_STATS}"

    match = re.match(r'^p?(\d+)$', producer_id)
    if not match:
        raise HTTPException(status_code=400, detail="Invalid producer ID format")

    limit = min(limit, 100)

    stats_service = StatsService(db)
    result = await stats_service.get_producer_vns_with_tags(producer_id, page=page, limit=limit, sort=sort, spoiler_level=spoiler_level, olang=olang)

    if not result:
        raise HTTPException(status_code=404, detail=f"Producer {producer_id} not found")

    vns, total, pages = result
    return schemas.ProducerVNsWithTagsResponse(
        vns=[schemas.VNWithTags(**vn) for vn in vns],
        total=total,
        page=page,
        pages=pages,
    )


@router.get("/producer/{producer_id}/similar", response_model=list[schemas.SimilarProducerResponse])
async def get_similar_producers(
    producer_id: str,
    response: Response,
    db: AsyncSession = Depends(get_db),
    limit: int = 10,
):
    """
    Get producers similar to the specified producer.

    Similarity is based on shared staff members.

    Args:
        producer_id: Producer ID (e.g., "p42" or "42")
        limit: Maximum number of similar producers to return
    """
    # Can be cached publicly
    response.headers["Cache-Control"] = f"public, max-age={CACHE_TAG_STATS}"

    # Parse producer ID
    match = re.match(r'^p?(\d+)$', producer_id)
    if not match:
        raise HTTPException(status_code=400, detail="Invalid producer ID format")

    # Validate limit
    limit = min(limit, 50)

    stats_service = StatsService(db)
    result = await stats_service.get_similar_producers(producer_id, limit=limit)

    return result


# ============ Staff Stats Endpoints ============

@router.get("/staff/{staff_id}", response_model=schemas.StaffStatsResponse)
async def get_staff_stats(
    staff_id: str,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
    nocache: bool = False,
):
    """
    Get aggregate statistics for all VNs a staff member worked on.

    This endpoint computes stats from the FULL database, not a sample.

    Includes:
    - Staff information (name, gender, description)
    - Average and Bayesian rating across all VNs
    - Role breakdown (scenario, art, music, etc.)
    - Total vote count
    - Score distribution (1-10)
    - Release year distribution with average ratings
    - Length distribution with average ratings
    - Age rating distribution with average ratings
    """
    # Staff stats can be cached publicly
    response.headers["Cache-Control"] = f"public, max-age={CACHE_TAG_STATS}"

    # Parse staff ID - accept both "s123" and "123" formats
    match = re.match(r'^s?(\d+)$', staff_id)
    if not match:
        raise HTTPException(status_code=400, detail="Invalid staff ID format")

    if nocache and not await is_admin_request(request):
        nocache = False

    stats_service = StatsService(db)
    result = await stats_service.get_staff_stats(staff_id, force_refresh=nocache)

    if not result:
        raise HTTPException(status_code=404, detail=f"Staff {staff_id} not found")

    # Generate and check ETag for 304 Not Modified
    etag = generate_etag(result.model_dump())
    response.headers["ETag"] = etag
    if check_etag_match(request, etag):
        return Response(status_code=304, headers={"ETag": etag})

    return result


@router.get("/staff/{staff_id}/vns", response_model=schemas.StaffVNsResponse)
async def get_staff_vns(
    staff_id: str,
    response: Response,
    db: AsyncSession = Depends(get_db),
    page: int = 1,
    limit: int = 24,
    sort: str = "rating",
):
    """
    Get paginated list of VNs a staff member worked on.

    Args:
        staff_id: Staff ID (e.g., "s42" or "42")
        page: Page number (1-indexed)
        limit: Items per page (max 100)
        sort: Sort order - "rating" (default), "released", "votecount"
    """
    # Can be cached publicly
    response.headers["Cache-Control"] = f"public, max-age={CACHE_TAG_STATS}"

    # Parse staff ID
    match = re.match(r'^s?(\d+)$', staff_id)
    if not match:
        raise HTTPException(status_code=400, detail="Invalid staff ID format")

    # Validate limit
    limit = min(limit, 100)

    stats_service = StatsService(db)
    result = await stats_service.get_staff_vns(staff_id, page=page, limit=limit, sort=sort)

    if not result:
        raise HTTPException(status_code=404, detail=f"Staff {staff_id} not found")

    return result


@router.get("/staff/{staff_id}/vns-with-tags", response_model=schemas.StaffVNsWithTagsResponse)
async def get_staff_vns_with_tags(
    staff_id: str,
    response: Response,
    db: AsyncSession = Depends(get_db),
    page: int = 1,
    limit: int = 24,
    sort: str = "rating",
    spoiler_level: int = Query(0, ge=0, le=2),
    olang: str | None = Query(default=None),
):
    """
    Get paginated list of VNs a staff member worked on, with full tag data.

    This endpoint returns VNs with all their tags including vn_count and spoiler
    information needed for weighted sorting on the frontend.

    Args:
        staff_id: Staff ID (e.g., "s42" or "42")
        page: Page number (1-indexed)
        limit: Items per page (max 100)
        sort: Sort order - "rating" (default), "released", "votecount"
    """
    response.headers["Cache-Control"] = f"public, max-age={CACHE_TAG_STATS}"

    match = re.match(r'^s?(\d+)$', staff_id)
    if not match:
        raise HTTPException(status_code=400, detail="Invalid staff ID format")

    limit = min(limit, 100)

    stats_service = StatsService(db)
    result = await stats_service.get_staff_vns_with_tags(staff_id, page=page, limit=limit, sort=sort, spoiler_level=spoiler_level, olang=olang)

    if not result:
        raise HTTPException(status_code=404, detail=f"Staff {staff_id} not found")

    vns, total, pages = result
    return schemas.StaffVNsWithTagsResponse(
        vns=[schemas.VNWithTags(**vn) for vn in vns],
        total=total,
        page=page,
        pages=pages,
    )


# ============ Seiyuu Stats Endpoints ============

@router.get("/seiyuu/{staff_id}", response_model=schemas.SeiyuuStatsResponse)
async def get_seiyuu_stats(
    staff_id: str,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
    nocache: bool = False,
):
    """
    Get aggregate statistics for all VNs a voice actor (seiyuu) appeared in.

    This endpoint computes stats from the FULL database, not a sample.

    Includes:
    - Staff information (name, gender, description)
    - Average and Bayesian rating across all VNs
    - Number of characters voiced
    - Total vote count
    - Score distribution (1-10)
    - Release year distribution with average ratings
    - Length distribution with average ratings
    - Age rating distribution with average ratings
    """
    # Seiyuu stats can be cached publicly
    response.headers["Cache-Control"] = f"public, max-age={CACHE_TAG_STATS}"

    # Parse staff ID - accept both "s123" and "123" formats
    match = re.match(r'^s?(\d+)$', staff_id)
    if not match:
        raise HTTPException(status_code=400, detail="Invalid staff ID format")

    if nocache and not await is_admin_request(request):
        nocache = False

    stats_service = StatsService(db)
    result = await stats_service.get_seiyuu_stats(staff_id, force_refresh=nocache)

    if not result:
        raise HTTPException(status_code=404, detail=f"Seiyuu {staff_id} not found")

    # Generate and check ETag for 304 Not Modified
    etag = generate_etag(result.model_dump())
    response.headers["ETag"] = etag
    if check_etag_match(request, etag):
        return Response(status_code=304, headers={"ETag": etag})

    return result


@router.get("/seiyuu/{staff_id}/vns", response_model=schemas.SeiyuuVNsResponse)
async def get_seiyuu_vns(
    staff_id: str,
    response: Response,
    db: AsyncSession = Depends(get_db),
    page: int = 1,
    limit: int = 24,
    sort: str = "rating",
):
    """
    Get paginated list of VNs a voice actor (seiyuu) appeared in.

    Args:
        staff_id: Staff ID (e.g., "s42" or "42")
        page: Page number (1-indexed)
        limit: Items per page (max 100)
        sort: Sort order - "rating" (default), "released", "votecount"
    """
    # Can be cached publicly
    response.headers["Cache-Control"] = f"public, max-age={CACHE_TAG_STATS}"

    # Parse staff ID
    match = re.match(r'^s?(\d+)$', staff_id)
    if not match:
        raise HTTPException(status_code=400, detail="Invalid staff ID format")

    # Validate limit
    limit = min(limit, 100)

    stats_service = StatsService(db)
    result = await stats_service.get_seiyuu_vns(staff_id, page=page, limit=limit, sort=sort)

    if not result:
        raise HTTPException(status_code=404, detail=f"Seiyuu {staff_id} not found")

    return result


@router.get("/seiyuu/{staff_id}/vns-with-tags", response_model=schemas.SeiyuuVNsWithTagsResponse)
async def get_seiyuu_vns_with_tags(
    staff_id: str,
    response: Response,
    db: AsyncSession = Depends(get_db),
    page: int = 1,
    limit: int = 24,
    sort: str = "rating",
    spoiler_level: int = Query(0, ge=0, le=2),
    olang: str | None = Query(default=None),
):
    """
    Get paginated list of VNs a voice actor (seiyuu) appeared in, with full tag data.

    This endpoint returns VNs with all their tags including vn_count and spoiler
    information needed for weighted sorting on the frontend.

    Args:
        staff_id: Staff ID (e.g., "s42" or "42")
        page: Page number (1-indexed)
        limit: Items per page (max 100)
        sort: Sort order - "rating" (default), "released", "votecount"
    """
    response.headers["Cache-Control"] = f"public, max-age={CACHE_TAG_STATS}"

    match = re.match(r'^s?(\d+)$', staff_id)
    if not match:
        raise HTTPException(status_code=400, detail="Invalid staff ID format")

    limit = min(limit, 100)

    stats_service = StatsService(db)
    result = await stats_service.get_seiyuu_vns_with_tags(staff_id, page=page, limit=limit, sort=sort, spoiler_level=spoiler_level, olang=olang)

    if not result:
        raise HTTPException(status_code=404, detail=f"Seiyuu {staff_id} not found")

    vns, total, pages = result
    return schemas.SeiyuuVNsWithTagsResponse(
        vns=[schemas.VNWithTags(**vn) for vn in vns],
        total=total,
        page=page,
        pages=pages,
    )


@router.get("/seiyuu/{staff_id}/characters", response_model=schemas.SeiyuuCharactersResponse)
async def get_seiyuu_characters(
    staff_id: str,
    response: Response,
    db: AsyncSession = Depends(get_db),
    page: int = 1,
    limit: int = 24,
    sort: str = "name",
):
    """Get paginated list of characters voiced by a seiyuu."""
    response.headers["Cache-Control"] = f"public, max-age={CACHE_TAG_STATS}"

    match = re.match(r'^s?(\d+)$', staff_id)
    if not match:
        raise HTTPException(status_code=400, detail="Invalid staff ID format")

    valid_sorts = ["name", "vn_count"]
    if sort not in valid_sorts:
        sort = "name"

    limit = max(1, min(100, limit))
    page = max(1, page)

    stats_service = StatsService(db)
    result = await stats_service.get_seiyuu_characters(staff_id, page=page, limit=limit, sort=sort)

    if not result:
        raise HTTPException(status_code=404, detail=f"Seiyuu {staff_id} not found")

    return result


# ============ Sitemap ID endpoints ============


@router.get("/tags/sitemap-ids")
async def get_tag_sitemap_ids(
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50000, ge=0, le=50000),
    db: AsyncSession = Depends(get_db),
):
    """Get tag IDs for sitemap generation."""
    count_result = await db.execute(
        select(func.count(Tag.id)).where(Tag.vn_count > 0)
    )
    total = count_result.scalar_one()

    items = []
    if limit > 0:
        result = await db.execute(
            select(Tag.id)
            .where(Tag.vn_count > 0)
            .order_by(Tag.id)
            .offset(offset)
            .limit(limit)
        )
        items = [{"id": row.id} for row in result]

    return {"items": items, "total": total}


@router.get("/traits/sitemap-ids")
async def get_trait_sitemap_ids(
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50000, ge=0, le=50000),
    db: AsyncSession = Depends(get_db),
):
    """Get trait IDs for sitemap generation."""
    count_result = await db.execute(
        select(func.count(Trait.id)).where(Trait.char_count > 0)
    )
    total = count_result.scalar_one()

    items = []
    if limit > 0:
        result = await db.execute(
            select(Trait.id)
            .where(Trait.char_count > 0)
            .order_by(Trait.id)
            .offset(offset)
            .limit(limit)
        )
        items = [{"id": row.id} for row in result]

    return {"items": items, "total": total}


@router.get("/staff/sitemap-ids")
async def get_staff_sitemap_ids(
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50000, ge=0, le=50000),
    db: AsyncSession = Depends(get_db),
):
    """Get staff IDs for sitemap generation."""
    count_result = await db.execute(
        select(func.count(Staff.id)).where(Staff.vn_count > 0)
    )
    total = count_result.scalar_one()

    items = []
    if limit > 0:
        result = await db.execute(
            select(Staff.id)
            .where(Staff.vn_count > 0)
            .order_by(Staff.id)
            .offset(offset)
            .limit(limit)
        )
        items = [{"id": row.id} for row in result]

    return {"items": items, "total": total}


@router.get("/seiyuu/sitemap-ids")
async def get_seiyuu_sitemap_ids(
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50000, ge=0, le=50000),
    db: AsyncSession = Depends(get_db),
):
    """Get seiyuu (voice actor) IDs for sitemap generation."""
    count_result = await db.execute(
        select(func.count(Staff.id)).where(Staff.seiyuu_vn_count > 0)
    )
    total = count_result.scalar_one()

    items = []
    if limit > 0:
        result = await db.execute(
            select(Staff.id)
            .where(Staff.seiyuu_vn_count > 0)
            .order_by(Staff.id)
            .offset(offset)
            .limit(limit)
        )
        items = [{"id": row.id} for row in result]

    return {"items": items, "total": total}


@router.get("/producers/sitemap-ids")
async def get_producer_sitemap_ids(
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50000, ge=0, le=50000),
    db: AsyncSession = Depends(get_db),
):
    """Get producer IDs for sitemap generation."""
    count_result = await db.execute(
        select(func.count(Producer.id)).where(Producer.vn_count > 0)
    )
    total = count_result.scalar_one()

    items = []
    if limit > 0:
        result = await db.execute(
            select(Producer.id)
            .where(Producer.vn_count > 0)
            .order_by(Producer.id)
            .offset(offset)
            .limit(limit)
        )
        items = [{"id": row.id} for row in result]

    return {"items": items, "total": total}
