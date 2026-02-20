"""Browse endpoints for searching tags, traits, staff, seiyuu, developers, and publishers.

Staff, seiyuu, and producer endpoints use precomputed columns (vn_count, roles, etc.)
populated during data import, matching the pattern Tags (vn_count) and Traits (char_count)
already use. This eliminates expensive subquery joins on every request.
"""

import logging

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_, and_

from app.db.database import get_db
from app.db import schemas
from app.db.models import Tag, Trait, Staff, Producer

logger = logging.getLogger(__name__)

router = APIRouter()

EntityType = Literal["tags", "traits", "staff", "seiyuu", "producers"]


@router.get("/random/{entity_type}")
async def random_entity(
    entity_type: EntityType,
    db: AsyncSession = Depends(get_db),
):
    """Get a random entity ID. entity_type: tags, traits, staff, seiyuu, producers."""
    if entity_type == "tags":
        query = select(Tag.id).where(Tag.vn_count > 0).order_by(func.random()).limit(1)
    elif entity_type == "traits":
        query = select(Trait.id).where(Trait.char_count > 0).order_by(func.random()).limit(1)
    elif entity_type == "staff":
        query = select(Staff.id).where(Staff.vn_count > 0).where(Staff.lang == "ja").order_by(func.random()).limit(1)
    elif entity_type == "seiyuu":
        query = select(Staff.id).where(Staff.seiyuu_vn_count > 0).where(Staff.lang == "ja").order_by(func.random()).limit(1)
    else:  # producers
        query = select(Producer.id).where(Producer.vn_count > 0).where(Producer.lang == "ja").order_by(func.random()).limit(1)

    result = await db.execute(query)
    entity_id = result.scalar_one_or_none()
    return {"id": entity_id}


def _escape_like(value: str) -> str:
    """Escape SQL LIKE wildcard characters in user input."""
    return value.replace('%', r'\%').replace('_', r'\_')


def _staff_char_filter(first_char: str):
    """Build first-character filter for staff (checks both name and original)."""
    if first_char == "#":
        return and_(
            ~Staff.name.op("~")(r"^[A-Za-z]"),
            or_(Staff.original.is_(None), ~Staff.original.op("~")(r"^[A-Za-z]"))
        )
    efc = _escape_like(first_char)
    return or_(Staff.name.ilike(f"{efc}%"), Staff.original.ilike(f"{efc}%"))


def _producer_char_filter(first_char: str):
    """Build first-character filter for producers (checks both name and original)."""
    if first_char == "#":
        return and_(
            ~Producer.name.op("~")(r"^[A-Za-z]"),
            or_(Producer.original.is_(None), ~Producer.original.op("~")(r"^[A-Za-z]"))
        )
    efc = _escape_like(first_char)
    return or_(Producer.name.ilike(f"{efc}%"), Producer.original.ilike(f"{efc}%"))


# ============ Tags ============

@router.get("/tags", response_model=schemas.BrowseTagsResponse)
async def browse_tags(
    q: str | None = Query(default=None, description="Search query for tag name or aliases"),
    first_char: str | None = Query(default=None, description="Filter by first letter (A-Z) or # for non-alpha"),
    category: str | None = Query(default=None, description="Filter by category: cont, tech, ero"),
    sort: str = Query(default="vn_count", description="Sort: name, vn_count"),
    sort_order: str = Query(default="desc", description="Sort order: asc, desc"),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=50, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    """Browse and search tags with filtering and pagination."""
    query = select(Tag)
    count_query = select(func.count(Tag.id))

    # Text search in name and aliases
    if q:
        eq = _escape_like(q)
        search_filter = or_(
            Tag.name.ilike(f"%{eq}%"),
            func.array_to_string(Tag.aliases, ' ').ilike(f"%{eq}%"),
        )
        query = query.where(search_filter)
        count_query = count_query.where(search_filter)

    # First character filter
    if first_char:
        if first_char == "#":
            char_filter = ~Tag.name.op("~")(r"^[A-Za-z]")
        else:
            efc = _escape_like(first_char)
            char_filter = Tag.name.ilike(f"{efc}%")
        query = query.where(char_filter)
        count_query = count_query.where(char_filter)

    # Category filter
    if category:
        query = query.where(Tag.category == category)
        count_query = count_query.where(Tag.category == category)

    # Sorting
    sort_columns = {"name": Tag.name, "vn_count": Tag.vn_count}
    sort_col = sort_columns.get(sort, Tag.vn_count)
    if sort_order == "asc":
        query = query.order_by(sort_col.asc().nullslast(), Tag.id.asc())
    else:
        query = query.order_by(sort_col.desc().nullslast(), Tag.id.asc())

    # Pagination
    offset = (page - 1) * limit
    query = query.offset(offset).limit(limit)

    result = await db.execute(query)
    tags = result.scalars().all()

    count_result = await db.execute(count_query)
    total = count_result.scalar_one_or_none() or 0

    return schemas.BrowseTagsResponse(
        items=[
            schemas.BrowseTagItem(
                id=tag.id,
                name=tag.name,
                description=(tag.description[:200] + "...") if tag.description and len(tag.description) > 200 else tag.description,
                category=tag.category,
                vn_count=tag.vn_count or 0,
            )
            for tag in tags
        ],
        total=total,
        page=page,
        pages=(total + limit - 1) // limit if total > 0 else 1,
    )


# ============ Traits ============

@router.get("/traits", response_model=schemas.BrowseTraitsResponse)
async def browse_traits(
    q: str | None = Query(default=None, description="Search query for trait name or aliases"),
    first_char: str | None = Query(default=None, description="Filter by first letter (A-Z) or # for non-alpha"),
    group_name: str | None = Query(default=None, description="Filter by trait group (e.g. Hair, Eyes, Personality)"),
    sort: str = Query(default="char_count", description="Sort: name, char_count"),
    sort_order: str = Query(default="desc", description="Sort order: asc, desc"),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=50, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    """Browse and search traits with filtering and pagination."""
    query = select(Trait)
    count_query = select(func.count(Trait.id))

    # Text search
    if q:
        eq = _escape_like(q)
        search_filter = or_(
            Trait.name.ilike(f"%{eq}%"),
            func.array_to_string(Trait.aliases, ' ').ilike(f"%{eq}%"),
        )
        query = query.where(search_filter)
        count_query = count_query.where(search_filter)

    # First character filter
    if first_char:
        if first_char == "#":
            char_filter = ~Trait.name.op("~")(r"^[A-Za-z]")
        else:
            efc = _escape_like(first_char)
            char_filter = Trait.name.ilike(f"{efc}%")
        query = query.where(char_filter)
        count_query = count_query.where(char_filter)

    # Group filter
    if group_name:
        query = query.where(Trait.group_name == group_name)
        count_query = count_query.where(Trait.group_name == group_name)

    # Sorting
    sort_columns = {"name": Trait.name, "char_count": Trait.char_count}
    sort_col = sort_columns.get(sort, Trait.char_count)
    if sort_order == "asc":
        query = query.order_by(sort_col.asc().nullslast(), Trait.id.asc())
    else:
        query = query.order_by(sort_col.desc().nullslast(), Trait.id.asc())

    # Pagination
    offset = (page - 1) * limit
    query = query.offset(offset).limit(limit)

    result = await db.execute(query)
    traits = result.scalars().all()

    count_result = await db.execute(count_query)
    total = count_result.scalar_one_or_none() or 0

    return schemas.BrowseTraitsResponse(
        items=[
            schemas.BrowseTraitItem(
                id=trait.id,
                name=trait.name,
                description=(trait.description[:200] + "...") if trait.description and len(trait.description) > 200 else trait.description,
                group_name=trait.group_name,
                char_count=trait.char_count or 0,
            )
            for trait in traits
        ],
        total=total,
        page=page,
        pages=(total + limit - 1) // limit if total > 0 else 1,
    )


# ============ Staff ============

@router.get("/staff", response_model=schemas.BrowseStaffResponse)
async def browse_staff(
    q: str | None = Query(default=None, description="Search query for staff name"),
    first_char: str | None = Query(default=None, description="Filter by first letter (A-Z) or # for non-alpha"),
    role: str | None = Query(default=None, description="Filter by role: scenario, art, music, songs, director, staff"),
    lang: str | None = Query(default=None, description="Filter by language code (ja, en, etc.)"),
    gender: str | None = Query(default=None, description="Filter by gender (m, f)"),
    sort: str = Query(default="vn_count", description="Sort: name, vn_count"),
    sort_order: str = Query(default="desc", description="Sort order: asc, desc"),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=50, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    """Browse and search staff members with filtering and pagination.

    Uses precomputed vn_count and roles columns for fast queries.
    """
    query = select(Staff)
    count_query = select(func.count()).select_from(Staff)

    # Text search
    if q:
        eq = _escape_like(q)
        search_filter = or_(
            Staff.name.ilike(f"%{eq}%"),
            Staff.original.ilike(f"%{eq}%"),
        )
        query = query.where(search_filter)
        count_query = count_query.where(search_filter)

    # First character filter
    if first_char:
        char_filter = _staff_char_filter(first_char)
        query = query.where(char_filter)
        count_query = count_query.where(char_filter)

    # Role filter - uses precomputed roles array column
    if role:
        query = query.where(Staff.roles.any(role))
        count_query = count_query.where(Staff.roles.any(role))

    # Language filter
    if lang:
        query = query.where(Staff.lang == lang)
        count_query = count_query.where(Staff.lang == lang)

    # Gender filter
    if gender:
        query = query.where(Staff.gender == gender)
        count_query = count_query.where(Staff.gender == gender)

    # Sorting - uses precomputed vn_count column
    sort_col = Staff.name if sort == "name" else Staff.vn_count
    if sort_order == "asc":
        query = query.order_by(sort_col.asc().nullslast(), Staff.id.asc())
    else:
        query = query.order_by(sort_col.desc().nullslast(), Staff.id.asc())

    # Pagination
    offset = (page - 1) * limit
    query = query.offset(offset).limit(limit)

    result = await db.execute(query)
    staff_list = result.scalars().all()

    count_result = await db.execute(count_query)
    total = count_result.scalar_one_or_none() or 0

    return schemas.BrowseStaffResponse(
        items=[
            schemas.BrowseStaffItem(
                id=s.id,
                name=s.name,
                original=s.original,
                gender=s.gender,
                lang=s.lang,
                vn_count=s.vn_count or 0,
                roles=sorted(s.roles) if s.roles else [],
                description=s.description,
            )
            for s in staff_list
        ],
        total=total,
        page=page,
        pages=(total + limit - 1) // limit if total > 0 else 1,
    )


# ============ Seiyuu ============

@router.get("/seiyuu", response_model=schemas.BrowseSeiyuuResponse)
async def browse_seiyuu(
    q: str | None = Query(default=None, description="Search query for seiyuu name"),
    first_char: str | None = Query(default=None, description="Filter by first letter (A-Z) or # for non-alpha"),
    lang: str | None = Query(default=None, description="Filter by language code (ja, en, etc.)"),
    gender: str | None = Query(default=None, description="Filter by gender (m, f)"),
    sort: str = Query(default="vn_count", description="Sort: name, vn_count, character_count"),
    sort_order: str = Query(default="desc", description="Sort order: asc, desc"),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=50, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    """Browse and search voice actors (seiyuu) with filtering and pagination.

    Uses precomputed seiyuu_vn_count and seiyuu_char_count columns.
    Only shows staff with seiyuu credits (seiyuu_vn_count > 0).
    """
    # Filter to only staff with seiyuu credits
    query = select(Staff).where(Staff.seiyuu_vn_count > 0)
    count_query = select(func.count()).select_from(Staff).where(Staff.seiyuu_vn_count > 0)

    # Text search
    if q:
        eq = _escape_like(q)
        search_filter = or_(
            Staff.name.ilike(f"%{eq}%"),
            Staff.original.ilike(f"%{eq}%"),
        )
        query = query.where(search_filter)
        count_query = count_query.where(search_filter)

    # First character filter
    if first_char:
        char_filter = _staff_char_filter(first_char)
        query = query.where(char_filter)
        count_query = count_query.where(char_filter)

    # Language filter
    if lang:
        query = query.where(Staff.lang == lang)
        count_query = count_query.where(Staff.lang == lang)

    # Gender filter
    if gender:
        query = query.where(Staff.gender == gender)
        count_query = count_query.where(Staff.gender == gender)

    # Sorting - uses precomputed columns
    if sort == "name":
        sort_col = Staff.name
    elif sort == "character_count":
        sort_col = Staff.seiyuu_char_count
    else:
        sort_col = Staff.seiyuu_vn_count

    if sort_order == "asc":
        query = query.order_by(sort_col.asc().nullslast(), Staff.id.asc())
    else:
        query = query.order_by(sort_col.desc().nullslast(), Staff.id.asc())

    # Pagination
    offset = (page - 1) * limit
    query = query.offset(offset).limit(limit)

    result = await db.execute(query)
    staff_list = result.scalars().all()

    count_result = await db.execute(count_query)
    total = count_result.scalar_one_or_none() or 0

    return schemas.BrowseSeiyuuResponse(
        items=[
            schemas.BrowseSeiyuuItem(
                id=s.id,
                name=s.name,
                original=s.original,
                gender=s.gender,
                lang=s.lang,
                vn_count=s.seiyuu_vn_count or 0,
                character_count=s.seiyuu_char_count or 0,
                description=s.description,
            )
            for s in staff_list
        ],
        total=total,
        page=page,
        pages=(total + limit - 1) // limit if total > 0 else 1,
    )


# ============ Developers (deprecated — use /producers?role=developer) ============

@router.get("/developers", response_model=schemas.BrowseProducersResponse, include_in_schema=False)
async def browse_developers(
    q: str | None = Query(default=None, description="Search query for developer name"),
    first_char: str | None = Query(default=None, description="Filter by first letter (A-Z) or # for non-alpha"),
    type: str | None = Query(default=None, description="Filter by type: co (company), in (individual), ng (amateur group)"),
    lang: str | None = Query(default=None, description="Filter by language code (ja, en, etc.)"),
    sort: str = Query(default="vn_count", description="Sort: name, vn_count"),
    sort_order: str = Query(default="desc", description="Sort order: asc, desc"),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=50, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    """Browse developers. Deprecated: Use /producers?role=developer instead."""
    # Only producers with developer credits
    query = select(Producer).where(Producer.dev_vn_count > 0)
    count_query = select(func.count()).select_from(Producer).where(Producer.dev_vn_count > 0)

    # Text search
    if q:
        eq = _escape_like(q)
        search_filter = or_(
            Producer.name.ilike(f"%{eq}%"),
            Producer.original.ilike(f"%{eq}%"),
        )
        query = query.where(search_filter)
        count_query = count_query.where(search_filter)

    if first_char:
        char_filter = _producer_char_filter(first_char)
        query = query.where(char_filter)
        count_query = count_query.where(char_filter)

    if type:
        query = query.where(Producer.type == type)
        count_query = count_query.where(Producer.type == type)

    if lang:
        query = query.where(Producer.lang == lang)
        count_query = count_query.where(Producer.lang == lang)

    sort_col = Producer.name if sort == "name" else Producer.dev_vn_count
    if sort_order == "asc":
        query = query.order_by(sort_col.asc().nullslast(), Producer.id.asc())
    else:
        query = query.order_by(sort_col.desc().nullslast(), Producer.id.asc())

    offset = (page - 1) * limit
    query = query.offset(offset).limit(limit)

    result = await db.execute(query)
    producers = result.scalars().all()

    count_result = await db.execute(count_query)
    total = count_result.scalar_one_or_none() or 0

    return schemas.BrowseProducersResponse(
        items=[
            schemas.BrowseProducerItem(
                id=p.id, name=p.name, original=p.original,
                type=p.type, lang=p.lang,
                vn_count=p.dev_vn_count or 0,
                description=p.description,
            )
            for p in producers
        ],
        total=total, page=page,
        pages=(total + limit - 1) // limit if total > 0 else 1,
    )


# ============ Publishers (deprecated — use /producers?role=publisher) ============

@router.get("/publishers", response_model=schemas.BrowseProducersResponse, include_in_schema=False)
async def browse_publishers(
    q: str | None = Query(default=None, description="Search query for publisher name"),
    first_char: str | None = Query(default=None, description="Filter by first letter (A-Z) or # for non-alpha"),
    type: str | None = Query(default=None, description="Filter by type: co (company), in (individual), ng (amateur group)"),
    lang: str | None = Query(default=None, description="Filter by language code (ja, en, etc.)"),
    sort: str = Query(default="vn_count", description="Sort: name, vn_count"),
    sort_order: str = Query(default="desc", description="Sort order: asc, desc"),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=50, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    """Browse publishers. Deprecated: Use /producers?role=publisher instead."""
    # Only producers with publisher credits
    query = select(Producer).where(Producer.pub_vn_count > 0)
    count_query = select(func.count()).select_from(Producer).where(Producer.pub_vn_count > 0)

    if q:
        eq = _escape_like(q)
        search_filter = or_(
            Producer.name.ilike(f"%{eq}%"),
            Producer.original.ilike(f"%{eq}%"),
        )
        query = query.where(search_filter)
        count_query = count_query.where(search_filter)

    if first_char:
        char_filter = _producer_char_filter(first_char)
        query = query.where(char_filter)
        count_query = count_query.where(char_filter)

    if type:
        query = query.where(Producer.type == type)
        count_query = count_query.where(Producer.type == type)

    if lang:
        query = query.where(Producer.lang == lang)
        count_query = count_query.where(Producer.lang == lang)

    sort_col = Producer.name if sort == "name" else Producer.pub_vn_count
    if sort_order == "asc":
        query = query.order_by(sort_col.asc().nullslast(), Producer.id.asc())
    else:
        query = query.order_by(sort_col.desc().nullslast(), Producer.id.asc())

    offset = (page - 1) * limit
    query = query.offset(offset).limit(limit)

    result = await db.execute(query)
    producers = result.scalars().all()

    count_result = await db.execute(count_query)
    total = count_result.scalar_one_or_none() or 0

    return schemas.BrowseProducersResponse(
        items=[
            schemas.BrowseProducerItem(
                id=p.id, name=p.name, original=p.original,
                type=p.type, lang=p.lang,
                vn_count=p.pub_vn_count or 0,
                description=p.description,
            )
            for p in producers
        ],
        total=total, page=page,
        pages=(total + limit - 1) // limit if total > 0 else 1,
    )


# ============ Producers (unified) ============

@router.get("/producers", response_model=schemas.BrowseProducersResponse)
async def browse_producers(
    q: str | None = Query(default=None, description="Search query for producer name"),
    first_char: str | None = Query(default=None, description="Filter by first letter (A-Z) or # for non-alpha"),
    type: str | None = Query(default=None, description="Filter by type: co (company), in (individual), ng (amateur group)"),
    lang: str | None = Query(default=None, description="Filter by language code (ja, en, etc.)"),
    role: str | None = Query(default=None, description="Filter by role: developer, publisher"),
    sort: str = Query(default="vn_count", description="Sort: name, vn_count"),
    sort_order: str = Query(default="desc", description="Sort order: asc, desc"),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=50, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    """Browse and search all producers with optional role filtering.

    Uses precomputed vn_count, dev_vn_count, pub_vn_count columns.
    """
    # Select the appropriate vn_count column based on role
    if role == "developer":
        vn_count_col = Producer.dev_vn_count
        query = select(Producer).where(Producer.dev_vn_count > 0)
        count_query = select(func.count()).select_from(Producer).where(Producer.dev_vn_count > 0)
    elif role == "publisher":
        vn_count_col = Producer.pub_vn_count
        query = select(Producer).where(Producer.pub_vn_count > 0)
        count_query = select(func.count()).select_from(Producer).where(Producer.pub_vn_count > 0)
    else:
        vn_count_col = Producer.vn_count
        query = select(Producer)
        count_query = select(func.count()).select_from(Producer)

    # Text search
    if q:
        eq = _escape_like(q)
        search_filter = or_(
            Producer.name.ilike(f"%{eq}%"),
            Producer.original.ilike(f"%{eq}%"),
        )
        query = query.where(search_filter)
        count_query = count_query.where(search_filter)

    # First character filter
    if first_char:
        char_filter = _producer_char_filter(first_char)
        query = query.where(char_filter)
        count_query = count_query.where(char_filter)

    # Type filter
    if type:
        query = query.where(Producer.type == type)
        count_query = count_query.where(Producer.type == type)

    # Language filter
    if lang:
        query = query.where(Producer.lang == lang)
        count_query = count_query.where(Producer.lang == lang)

    # Sorting
    sort_col = Producer.name if sort == "name" else vn_count_col
    if sort_order == "asc":
        query = query.order_by(sort_col.asc().nullslast(), Producer.id.asc())
    else:
        query = query.order_by(sort_col.desc().nullslast(), Producer.id.asc())

    # Pagination
    offset = (page - 1) * limit
    query = query.offset(offset).limit(limit)

    result = await db.execute(query)
    producers = result.scalars().all()

    count_result = await db.execute(count_query)
    total = count_result.scalar_one_or_none() or 0

    return schemas.BrowseProducersResponse(
        items=[
            schemas.BrowseProducerItem(
                id=p.id,
                name=p.name,
                original=p.original,
                type=p.type,
                lang=p.lang,
                vn_count=getattr(p, vn_count_col.key) or 0,
                description=p.description,
            )
            for p in producers
        ],
        total=total,
        page=page,
        pages=(total + limit - 1) // limit if total > 0 else 1,
    )
