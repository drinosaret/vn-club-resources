"""Character endpoints."""

import hashlib
import re
import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_, case, Float, cast

from app.db.database import get_db
from app.db import schemas
from app.db.models import (
    Character, CharacterVN, CharacterTrait, Trait,
    VisualNovel, VNSeiyuu, Staff
)
from app.db.query_utils import in_ids
from app.core.cache import get_cache
from app.core.concurrency import Ceiling
from app.core.search_utils import escape_like, relevance_rank

logger = logging.getLogger(__name__)

router = APIRouter()


#: Character ids a word's title lookup may contribute before the word stops constraining
#: the search at all.
#:
#: The ids are bound into the search as an array parameter. Past roughly a thousand of them
#: the planner stops using the trigram indexes on the name columns and filters every
#: character row instead. A word carried by that many titles says little about which
#: character is meant, so it is dropped from the search; holding it against the name
#: columns alone would instead require the character to be named after the title.
_TITLE_MATCH_CAP = 5000

#: Shortest word written in letters that is resolved against titles. Two Latin letters carry
#: no trigram, so the lookup cannot use the title index and the ids it returns are far too
#: broad to narrow anything. Two characters of Japanese are a whole title, so the minimum
#: applies only to words spelled out in letters.
_MIN_TITLE_WORD = 3

#: Words a search is cut to. Each one costs a round trip of its own, and past a handful
#: nothing further is being narrowed.
_MAX_SEARCH_WORDS = 6

#: Character searches run at once.
#:
#: A word too short to carry a trigram is answered by walking the character table, and the
#: short cache above spares only a repeat of the same query string while a typeahead sends
#: a different one on every keystroke.
_SEARCH_CEILING = Ceiling(slots=4, wait_seconds=5.0, what="character searches")


@router.get("/search/", response_model=schemas.CharacterSearchResponse)
async def search_characters(
    q: str = Query(min_length=2, max_length=100, description="Search query for character name"),
    limit: int = Query(default=10, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
):
    """Search characters by name. Returns matching characters with their primary VN for context."""

    # Redis cache: 120s TTL for character search (data only changes daily)
    cache = get_cache()
    cache_key = f"char_search:{hashlib.sha256(f'{q}:{limit}'.encode()).hexdigest()}"
    cached = await cache.get(cache_key)
    if cached:
        return schemas.CharacterSearchResponse(**cached)

    # Search name and original (Japanese name)
    # Note: Character.aliases is never populated by the importer, so we skip it.
    # GIN trigram indexes on name/original (migration 032) enable fast ILIKE.
    relevance = relevance_rank(q, [Character.name, Character.original])

    # Each word has to match somewhere: the character's name in either script, or the
    # name of a title they appear in. A given name alone is shared by dozens of
    # characters and the list is cut short, so the title is the only other thing a
    # reader can add to say which one they mean; a title typed alone lists its cast, as
    # long as the word is not carried by more titles than _TITLE_MATCH_CAP admits.
    #
    # The title side is resolved to character ids of its own before the search runs, and
    # bound back in as an id set. An OR branch the planner cannot answer from an index
    # turns the whole disjunction into a filter applied to every character row, and the
    # trigram indexes on name and original go unused; a small id set keeps all three
    # branches index-eligible, which is what _TITLE_MATCH_CAP holds it to. The set travels
    # as a single array parameter, so what bounds its size is the plan it buys rather than
    # the driver's parameter limit.
    words = [word for word in q.split() if word][:_MAX_SEARCH_WORDS]
    # A query of nothing but separators leaves no word to match on. Every row would
    # qualify, which is a whole-table scan answering a question nobody asked.
    if not words:
        return schemas.CharacterSearchResponse(results=[])
    patterns = [f"%{escape_like(word)}%" for word in words]

    async with _SEARCH_CEILING.hold():
        # None marks a word whose title side was not resolved, which is not the same as a
        # word whose titles came back empty: the first constrains nothing, the second still
        # has to be met by the character's own name.
        title_matches: list[set[str] | None] = []
        for word, pattern in zip(words, patterns):
            if len(word) < _MIN_TITLE_WORD and any(c.isascii() and c.isalpha() for c in word):
                title_matches.append(None)
                continue
            matched = await db.execute(
                select(CharacterVN.character_id)
                .join(VisualNovel, VisualNovel.id == CharacterVN.vn_id)
                .where(
                    or_(
                        VisualNovel.title.ilike(pattern),
                        VisualNovel.title_jp.ilike(pattern),
                        VisualNovel.title_romaji.ilike(pattern),
                    )
                )
                .distinct()
                # One more than the cap is enough to tell a usable set from an oversized
                # one, and stops a broad word shipping its whole result back.
                .limit(_TITLE_MATCH_CAP + 1)
            )
            ids = set(matched.scalars().all())
            title_matches.append(None if len(ids) > _TITLE_MATCH_CAP else ids)

        def matches_word(pattern: str, character_ids: set[str]):
            return or_(
                Character.name.ilike(pattern),
                Character.original.ilike(pattern),
                in_ids(Character.id, character_ids),
            )

        # A word with no title side of its own drops out of the conjunction. When that
        # leaves nothing behind, the words are asked of the names alone: a conjunction of
        # nothing matches every row, which is the whole-table scan ruled out above.
        conjuncts = [
            matches_word(pattern, character_ids)
            for pattern, character_ids in zip(patterns, title_matches)
            if character_ids is not None
        ]
        if not conjuncts:
            conjuncts = [matches_word(pattern, set()) for pattern in patterns]

        # Ties between equally good name matches are common: a short given name is shared by
        # dozens of characters. They are broken by how well known the character's best title
        # is, since the one a reader is typing is far more often the heroine of a title with
        # thousands of votes than a bit part in one with a handful. The number of titles a
        # character appears in comes next, and the name last, so the order is stable.
        top_votes_sq = (
            select(func.coalesce(func.max(VisualNovel.votecount), 0))
            .select_from(CharacterVN)
            .join(VisualNovel, VisualNovel.id == CharacterVN.vn_id)
            .where(CharacterVN.character_id == Character.id)
            .correlate(Character)
            .scalar_subquery()
        )
        vn_count_sq = (
            select(func.count(CharacterVN.vn_id.distinct()))
            .where(CharacterVN.character_id == Character.id)
            .correlate(Character)
            .scalar_subquery()
        )

        query = (
            select(Character)
            .where(and_(*conjuncts))
            .order_by(relevance.asc(), top_votes_sq.desc(), vn_count_sq.desc(), Character.name.asc())
            .limit(limit)
        )
        result = await db.execute(query)
        characters = result.scalars().all()

    if not characters:
        return schemas.CharacterSearchResponse(results=[])

    # Bulk fetch primary VN for each character (prefer main role)
    char_ids = [c.id for c in characters]
    ranked_vns = (
        select(
            CharacterVN.character_id,
            VisualNovel.id.label("vn_id"),
            VisualNovel.title.label("vn_title"),
            VisualNovel.title_jp.label("vn_title_jp"),
            VisualNovel.title_romaji.label("vn_title_romaji"),
            func.row_number()
            .over(
                partition_by=CharacterVN.character_id,
                order_by=case(
                    (CharacterVN.role == "main", 1),
                    (CharacterVN.role == "primary", 2),
                    (CharacterVN.role == "side", 3),
                    else_=4,
                ),
            )
            .label("rn"),
        )
        .join(VisualNovel, VisualNovel.id == CharacterVN.vn_id)
        .where(CharacterVN.character_id.in_(char_ids))
        .subquery()
    )
    vns_result = await db.execute(
        select(ranked_vns.c.character_id, ranked_vns.c.vn_id, ranked_vns.c.vn_title, ranked_vns.c.vn_title_jp, ranked_vns.c.vn_title_romaji)
        .where(ranked_vns.c.rn == 1)
    )
    vn_by_char = {row[0]: (row[1], row[2], row[3], row[4]) for row in vns_result.all()}

    results = []
    for char in characters:
        vn_info = vn_by_char.get(char.id)
        results.append(
            schemas.CharacterSearchResult(
                id=char.id,
                name=char.name,
                original=char.original,
                image_url=char.image_url,
                image_sexual=char.image_sexual,
                vn_id=vn_info[0] if vn_info else None,
                vn_name=vn_info[1] if vn_info else None,
                vn_title_jp=vn_info[2] if vn_info else None,
                vn_title_romaji=vn_info[3] if vn_info else None,
            )
        )

    response = schemas.CharacterSearchResponse(results=results)
    await cache.set(cache_key, response.model_dump(), ttl=120)
    return response


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


@router.post("/batch", response_model=list[schemas.BatchItemBrief])
async def batch_characters(
    body: dict,
    db: AsyncSession = Depends(get_db),
):
    """Get minimal character info for a list of IDs. Used by shared layout loading."""
    ids = body.get("ids", [])
    if not isinstance(ids, list) or not ids or len(ids) > 100:
        raise HTTPException(status_code=400, detail="ids must be a list of 1-100 character IDs")

    char_ids = [i for i in ids if isinstance(i, str) and re.match(r"^c\d+$", i)]
    if not char_ids:
        return []

    result = await db.execute(
        select(
            Character.id,
            Character.name,
            Character.original,
            Character.image_url,
            Character.image_sexual,
        ).where(Character.id.in_(char_ids))
    )
    return [
        schemas.BatchItemBrief(
            id=row.id,
            title=row.name,
            title_jp=row.original,
            image_url=row.image_url,
            image_sexual=row.image_sexual,
        )
        for row in result
    ]


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

#: Similarity searches run at once.
#:
#: The comparison is against every character sharing a trait, so it is one of the slower
#: answers here, and the cache above only spares a repeat of the same one. A visitor working
#: through the catalogue asks for a different character every time and so misses every time,
#: which is the case this bounds.
_SIMILAR_CEILING = Ceiling(slots=4, wait_seconds=15.0, what="similarity searches")


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

    async with _SIMILAR_CEILING.hold():
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
