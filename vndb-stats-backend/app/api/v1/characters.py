"""Character endpoints."""

import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, case, Float, cast

from app.db.database import get_db
from app.db import schemas
from app.db.models import (
    Character, CharacterVN, CharacterTrait, Trait,
    VisualNovel, VNSeiyuu, Staff
)
from app.core.cache import get_cache

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/sitemap-ids", include_in_schema=False)
async def get_character_sitemap_ids(
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=10000, ge=0, le=50000),
    db: AsyncSession = Depends(get_db),
):
    """Get character IDs for sitemap generation.

    Lightweight endpoint that returns only the data needed to build sitemaps.
    Use limit=0 to get just the total count.
    """
    count_result = await db.execute(select(func.count(Character.id)))
    total = count_result.scalar_one()

    items = []
    if limit > 0:
        result = await db.execute(
            select(Character.id)
            .order_by(Character.id)
            .offset(offset)
            .limit(limit)
        )
        items = [{"id": row.id} for row in result]

    return {"items": items, "total": total}


@router.get("/{char_id}", response_model=schemas.CharacterDetailResponse)
async def get_character(
    char_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Get full character details including traits, VNs, and voice actors.

    Returns comprehensive character information similar to VNDB's character pages.
    """
    # Normalize character ID
    normalized_id = char_id if char_id.startswith("c") else f"c{char_id}"

    # Get character base info
    result = await db.execute(
        select(Character).where(Character.id == normalized_id)
    )
    character = result.scalar_one_or_none()

    if not character:
        raise HTTPException(status_code=404, detail=f"Character {char_id} not found")

    # Get character traits with trait info
    traits_result = await db.execute(
        select(CharacterTrait, Trait)
        .join(Trait, CharacterTrait.trait_id == Trait.id)
        .where(CharacterTrait.character_id == normalized_id)
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

    # Get VNs this character appears in
    vns_result = await db.execute(
        select(CharacterVN, VisualNovel)
        .join(VisualNovel, CharacterVN.vn_id == VisualNovel.id)
        .where(CharacterVN.character_id == normalized_id)
        .order_by(
            # Order by role importance: main > primary > side > appears
            case(
                (CharacterVN.role == 'main', 1),
                (CharacterVN.role == 'primary', 2),
                (CharacterVN.role == 'side', 3),
                else_=4
            ),
            VisualNovel.rating.desc().nullslast()
        )
    )
    vns = [
        schemas.CharacterVNInfo(
            id=vn.id,
            title=vn.title,
            title_jp=vn.title_jp,
            title_romaji=vn.title_romaji,
            role=char_vn.role or 'appears',
            image_url=vn.image_url,
            image_sexual=vn.image_sexual,
        )
        for char_vn, vn in vns_result.all()
    ]

    # Get voice actors for this character
    # VNSeiyuu links vn_id + staff_id + character_id
    seiyuu_result = await db.execute(
        select(VNSeiyuu, Staff)
        .join(Staff, VNSeiyuu.staff_id == Staff.id)
        .where(VNSeiyuu.character_id == normalized_id)
        .distinct(Staff.id)
    )
    voiced_by = [
        schemas.VoiceActorInfo(
            id=staff.id,
            name=staff.name,
            original=staff.original,
            note=seiyuu.note,
        )
        for seiyuu, staff in seiyuu_result.all()
    ]

    # Build birthday if available
    birthday = None
    if character.birthday_month and character.birthday_day:
        birthday = [character.birthday_month, character.birthday_day]
    elif character.birthday_month:
        birthday = [character.birthday_month]

    return schemas.CharacterDetailResponse(
        id=character.id,
        name=character.name,
        original=character.original,
        aliases=character.aliases,
        description=character.description,
        image_url=character.image_url,
        image_sexual=character.image_sexual,
        sex=character.sex,
        blood_type=character.blood_type,
        height=character.height,
        weight=character.weight,
        bust=character.bust,
        waist=character.waist,
        hips=character.hips,
        cup=character.cup,
        age=character.age,
        birthday=birthday,
        traits=traits,
        vns=vns,
        voiced_by=voiced_by,
    )


SIMILAR_CHARS_CACHE_TTL = 86400  # 24 hours — data only changes on daily import


@router.get("/{char_id}/similar", response_model=list[schemas.SimilarCharacterResponse])
async def get_similar_characters(
    char_id: str,
    limit: int = Query(default=10, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
):
    """
    Find characters with similar traits using Jaccard similarity.

    Returns characters that share the most non-spoiler traits with the target character.
    """
    normalized_id = char_id if char_id.startswith("c") else f"c{char_id}"

    # Check Redis cache first
    cache = get_cache()
    cache_key = f"char:similar:{normalized_id}:{limit}"
    cached = await cache.get(cache_key)
    if cached is not None:
        return [schemas.SimilarCharacterResponse(**item) for item in cached]

    # Verify character exists and get its non-spoiler traits in one query
    target_traits_result = await db.execute(
        select(CharacterTrait.trait_id)
        .where(
            and_(
                CharacterTrait.character_id == normalized_id,
                CharacterTrait.spoiler_level == 0,
            )
        )
    )
    target_trait_ids = set(row[0] for row in target_traits_result.all())

    if not target_trait_ids:
        # Character has no traits (or doesn't exist) — cache empty result
        await cache.set(cache_key, [], ttl=SIMILAR_CHARS_CACHE_TTL)
        return []

    # --- Single optimized query for Jaccard similarity ---
    #
    # shared_counts: characters sharing at least one target trait
    # total_counts is scoped to ONLY those candidates (not the whole table)

    shared_counts = (
        select(
            CharacterTrait.character_id.label("candidate_id"),
            func.count(CharacterTrait.trait_id).label("shared_count"),
        )
        .where(
            and_(
                CharacterTrait.trait_id.in_(target_trait_ids),
                CharacterTrait.character_id != normalized_id,
                CharacterTrait.spoiler_level == 0,
            )
        )
        .group_by(CharacterTrait.character_id)
        .having(func.count(CharacterTrait.trait_id) >= 2)
        .subquery()
    )

    # total_counts scoped to candidates only (via JOIN, not full table scan)
    total_counts = (
        select(
            CharacterTrait.character_id.label("char_id"),
            func.count(CharacterTrait.trait_id).label("total_count"),
        )
        .where(CharacterTrait.spoiler_level == 0)
        .where(
            CharacterTrait.character_id.in_(
                select(shared_counts.c.candidate_id)
            )
        )
        .group_by(CharacterTrait.character_id)
        .subquery()
    )

    target_count = len(target_trait_ids)
    jaccard_expr = cast(shared_counts.c.shared_count, Float) / (
        target_count + total_counts.c.total_count - shared_counts.c.shared_count
    )

    result = await db.execute(
        select(
            Character,
            shared_counts.c.shared_count,
            total_counts.c.total_count,
            jaccard_expr.label("jaccard"),
        )
        .join(shared_counts, Character.id == shared_counts.c.candidate_id)
        .join(total_counts, Character.id == total_counts.c.char_id)
        .order_by(jaccard_expr.desc())
        .limit(limit)
    )

    candidates = result.all()

    if not candidates:
        await cache.set(cache_key, [], ttl=SIMILAR_CHARS_CACHE_TTL)
        return []

    # --- Bulk fetch shared trait names and VN titles (2 queries, not 2*N) ---

    candidate_ids = [char.id for char, *_ in candidates]

    # Bulk: shared trait names per candidate (up to 5 per character via window)
    ranked_traits = (
        select(
            CharacterTrait.character_id,
            Trait.name,
            func.row_number()
            .over(
                partition_by=CharacterTrait.character_id,
                order_by=Trait.name,
            )
            .label("rn"),
        )
        .join(Trait, Trait.id == CharacterTrait.trait_id)
        .where(
            and_(
                CharacterTrait.character_id.in_(candidate_ids),
                CharacterTrait.trait_id.in_(target_trait_ids),
                CharacterTrait.spoiler_level == 0,
            )
        )
        .subquery()
    )
    traits_result = await db.execute(
        select(ranked_traits.c.character_id, ranked_traits.c.name).where(
            ranked_traits.c.rn <= 5
        )
    )
    traits_by_char: dict[str, list[str]] = {}
    for char_id_val, trait_name in traits_result.all():
        traits_by_char.setdefault(char_id_val, []).append(trait_name)

    # Bulk: primary VN per candidate (best role)
    ranked_vns = (
        select(
            CharacterVN.character_id,
            VisualNovel.title,
            VisualNovel.title_jp,
            VisualNovel.title_romaji,
            VisualNovel.olang,
            func.row_number()
            .over(
                partition_by=CharacterVN.character_id,
                order_by=case(
                    (CharacterVN.role == "main", 1),
                    (CharacterVN.role == "primary", 2),
                    else_=3,
                ),
            )
            .label("rn"),
        )
        .join(VisualNovel, VisualNovel.id == CharacterVN.vn_id)
        .where(CharacterVN.character_id.in_(candidate_ids))
        .subquery()
    )
    vns_result = await db.execute(
        select(
            ranked_vns.c.character_id,
            ranked_vns.c.title,
            ranked_vns.c.title_jp,
            ranked_vns.c.title_romaji,
            ranked_vns.c.olang,
        ).where(ranked_vns.c.rn == 1)
    )
    vn_by_char: dict[str, tuple] = {}
    for row in vns_result.all():
        vn_by_char[row[0]] = (row[1], row[2], row[3], row[4])

    # --- Assemble response ---

    similar_characters = []
    for char, shared_count, total_count, jaccard in candidates:
        vn_info = vn_by_char.get(char.id)
        similar_characters.append(
            schemas.SimilarCharacterResponse(
                id=char.id,
                name=char.name,
                original=char.original,
                image_url=char.image_url,
                image_sexual=char.image_sexual,
                similarity=round(jaccard, 3) if jaccard else 0,
                shared_traits=traits_by_char.get(char.id, []),
                vn_title=vn_info[0] if vn_info else None,
                vn_title_jp=vn_info[1] if vn_info else None,
                vn_title_romaji=vn_info[2] if vn_info else None,
                olang=vn_info[3] if vn_info else None,
            )
        )

    # Cache the result
    await cache.set(
        cache_key,
        [item.model_dump() for item in similar_characters],
        ttl=SIMILAR_CHARS_CACHE_TTL,
    )

    return similar_characters
