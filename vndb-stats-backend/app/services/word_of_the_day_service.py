"""Service for selecting and managing the daily Word of the Day spotlight."""

import logging
import math
import random
from datetime import date, timedelta

from sqlalchemy import select, delete, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import WordOfTheDay, VisualNovel, Tag, VNTag
from app.services.jiten_client import fetch_full_word_data, get_vocabulary_ids_in_range, get_word_info, get_example_sentences, JitenAPIError

logger = logging.getLogger(__name__)

# Selection criteria
MIN_FREQ = 1
MAX_FREQ = 999999  # All available vocabulary
NO_REPEAT_DAYS = 365
FALLBACK_RANGES = []


async def get_current(db: AsyncSession) -> WordOfTheDay | None:
    """Get today's Word of the Day (UTC date)."""
    return await get_by_date(db, date.today())


async def get_by_date(db: AsyncSession, target_date: date) -> WordOfTheDay | None:
    """Get Word of the Day for a specific date."""
    result = await db.execute(
        select(WordOfTheDay).where(WordOfTheDay.date == target_date)
    )
    return result.scalar_one_or_none()


async def get_or_select(db: AsyncSession) -> WordOfTheDay | None:
    """Get today's pick, selecting a new one if none exists."""
    pick = await get_current(db)
    if pick:
        return pick
    return await _select_and_save(db)


async def _select_and_save(db: AsyncSession, use_random_seed: bool = False) -> WordOfTheDay | None:
    """Run selection algorithm, persist result."""
    today = date.today()

    # Get recent word_ids to exclude
    cutoff = today - timedelta(days=NO_REPEAT_DAYS)
    recent_result = await db.execute(
        select(WordOfTheDay.word_id).where(WordOfTheDay.date > cutoff)
    )
    recent_ids = set(recent_result.scalars().all())

    # Try primary range, then fallbacks
    ranges = [(MIN_FREQ, MAX_FREQ)] + FALLBACK_RANGES
    word_id = None

    for min_f, max_f in ranges:
        try:
            all_ids = await get_vocabulary_ids_in_range(min_f, max_f)
        except JitenAPIError as e:
            logger.warning(f"Failed to fetch vocabulary range {min_f}-{max_f}: {e}")
            return None

        candidates = [wid for wid in all_ids if wid not in recent_ids]
        if not candidates:
            continue

        # Deterministic seed for scheduled selection, true random for rerolls
        rng = random.Random() if use_random_seed else random.Random(today.isoformat())
        rng.shuffle(candidates)

        # Try candidates until we find a real word (not a name) with VN sentences
        name_prefixes = ("name-", "surname", "place", "given", "person", "company", "product", "organization", "unclass")
        for candidate_id in candidates[:50]:  # Try up to 50 candidates
            try:
                candidate_info = await get_word_info(candidate_id)
            except JitenAPIError:
                continue
            pos = candidate_info.get("partsOfSpeech", [])
            # Skip if all POS tags are name-related
            if pos and all(any(p.startswith(prefix) for prefix in name_prefixes) for p in pos):
                continue
            # Require at least one VN example sentence
            try:
                sentences = await get_example_sentences(candidate_id, 0, media_type=7)
            except Exception:
                sentences = []
            if not sentences:
                continue
            word_id = candidate_id
            break

        if word_id:
            break

    if word_id is None:
        logger.warning("No eligible word found for Word of the Day")
        return None

    # Fetch full data from jiten.moe
    try:
        cached_data = await fetch_full_word_data(word_id)
    except JitenAPIError as e:
        logger.warning(f"Failed to fetch word data for {word_id}: {e}")
        return None

    pick = WordOfTheDay(
        word_id=word_id,
        reading_index=0,
        date=today,
        cached_data=cached_data,
    )
    db.add(pick)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        return await get_current(db)

    await db.refresh(pick)
    return pick


async def set_override(
    db: AsyncSession, word_id: int, target_date: date,
    admin_name: str, reading_index: int = 0,
) -> WordOfTheDay | None:
    """Admin override: delete existing + insert for a specific date."""
    try:
        cached_data = await fetch_full_word_data(word_id, reading_index)
    except JitenAPIError as e:
        logger.warning(f"Failed to fetch word data for override {word_id}: {e}")
        return None

    await db.execute(delete(WordOfTheDay).where(WordOfTheDay.date == target_date))

    pick = WordOfTheDay(
        word_id=word_id,
        reading_index=reading_index,
        date=target_date,
        cached_data=cached_data,
        is_override=True,
        override_by=admin_name,
    )
    db.add(pick)
    await db.commit()
    await db.refresh(pick)
    return pick


async def reroll_today(db: AsyncSession) -> WordOfTheDay | None:
    """Delete today's pick and select a new one with true randomness."""
    today = date.today()
    await db.execute(delete(WordOfTheDay).where(WordOfTheDay.date == today))
    await db.commit()
    return await _select_and_save(db, use_random_seed=True)


async def get_history(db: AsyncSession, limit: int = 30) -> list[WordOfTheDay]:
    """Get past picks ordered by date descending."""
    result = await db.execute(
        select(WordOfTheDay)
        .order_by(WordOfTheDay.date.desc())
        .limit(limit)
    )
    return list(result.scalars().all())


async def compute_related_tags(
    db: AsyncSession, vn_decks: list[dict], top_n: int = 8,
) -> list[dict]:
    """Find VNDB tags overrepresented in VNs where a word appears."""
    vn_ids = [
        f"v{d['vndb_id']}" for d in vn_decks
        if isinstance(d, dict) and d.get("vndb_id")
    ]
    if len(vn_ids) < 3:
        return []

    num_word_vns = len(vn_ids)

    # Total VN count for baseline
    total_result = await db.execute(select(func.count(VisualNovel.id)))
    total_vns = total_result.scalar() or 1

    # Aggregate tags across the word's VNs
    stmt = (
        select(
            Tag.id,
            Tag.name,
            Tag.category,
            Tag.vn_count,
            func.count(VNTag.vn_id).label("word_vn_count"),
        )
        .join(Tag, Tag.id == VNTag.tag_id)
        .where(
            VNTag.vn_id.in_(vn_ids),
            VNTag.spoiler_level == 0,
            VNTag.lie == False,  # noqa: E712
            VNTag.score >= 1.0,
            Tag.category.in_(["cont", "tech"]),
            Tag.vn_count >= 10,
        )
        .group_by(Tag.id, Tag.name, Tag.category, Tag.vn_count)
        .having(func.count(VNTag.vn_id) >= 2)
    )
    result = await db.execute(stmt)
    rows = result.all()

    scored = []
    for row in rows:
        word_frac = row.word_vn_count / num_word_vns
        global_frac = row.vn_count / total_vns
        overrep = word_frac / max(global_frac, 0.001)
        if overrep <= 1.2:
            continue
        score = overrep * math.log(row.word_vn_count + 1)
        scored.append({
            "id": row.id,
            "name": row.name,
            "category": row.category,
            "relevance": round(overrep, 2),
            "word_vn_count": row.word_vn_count,
            "_score": score,
        })

    scored.sort(key=lambda x: x["_score"], reverse=True)
    for item in scored:
        del item["_score"]
    return scored[:top_n]


async def build_wotd_response(pick: WordOfTheDay, db: AsyncSession | None = None) -> dict:
    """Build the API response dict from a WordOfTheDay record."""
    data = pick.cached_data or {}
    word_info = data.get("word_info", {})

    # Extract main reading (text has bracket furigana notation like 御[ご]座[ざ]る)
    main_reading = word_info.get("mainReading") or {}
    main_text = main_reading.get("text", "") if isinstance(main_reading, dict) else ""

    # Extract definitions
    definitions = []
    for defn in word_info.get("definitions", []):
        definitions.append({
            "meanings": defn.get("meanings", []),
            "pos": defn.get("pos", []),
            "misc": defn.get("misc", []),
            "field": defn.get("field", []),
        })

    # Extract alternative readings with frequency percentages
    alt_readings = []
    for i, alt in enumerate(word_info.get("alternativeReadings", [])):
        if isinstance(alt, dict):
            alt_readings.append({
                "text": alt.get("text", ""),
                "frequency_percentage": alt.get("frequencyPercentage"),
                "used_in_media": alt.get("usedInMediaAmount"),
                "reading_index": alt.get("readingIndex", i),
            })

    # Enrich example sentences with source info and resolve VN IDs
    raw_sentences = data.get("example_sentences", [])

    # Collect all VNDB IDs from sentence sourceDeck._vndb_id (resolved during fetch)
    vndb_ids: set[str] = set()
    for s in raw_sentences:
        if isinstance(s, dict):
            deck = s.get("sourceDeck") or {}
            if isinstance(deck, dict) and deck.get("_vndb_id"):
                vndb_ids.add(deck["_vndb_id"])

    # Batch resolve VNDB IDs to our local VN data
    vn_data_map: dict[str, dict] = {}
    if vndb_ids and db:
        result = await db.execute(
            select(VisualNovel.id, VisualNovel.title, VisualNovel.title_jp, VisualNovel.title_romaji)
            .where(VisualNovel.id.in_([f"v{vid}" for vid in vndb_ids]))
        )
        for row in result.all():
            vid = row.id.replace("v", "")
            vn_data_map[vid] = {
                "title": row.title,
                "title_jp": row.title_jp,
                "title_romaji": row.title_romaji,
            }

    media_type_names = {
        1: "Anime", 2: "Drama", 3: "Movie", 4: "Novel",
        5: "Non-Fiction", 6: "Video Game", 7: "Visual Novel",
        8: "Web Novel", 9: "Manga", 10: "Audio",
    }

    sentences = []
    for s in raw_sentences:
        if not isinstance(s, dict):
            continue
        entry = {
            "text": s.get("text", ""),
            "wordPosition": s.get("wordPosition"),
            "wordLength": s.get("wordLength"),
        }
        deck = s.get("sourceDeck") or {}
        if isinstance(deck, dict):
            # Use parent title for subdecks (e.g. "Momoyo's Route" -> "真剣で私に恋しなさい！")
            parent_title = deck.get("_parent_title")
            entry["source_title"] = parent_title or deck.get("originalTitle") or deck.get("englishTitle") or ""
            entry["source_english"] = deck.get("englishTitle") or ""
            entry["source_type"] = media_type_names.get(deck.get("mediaType"), "")

            # Use VNDB ID resolved via deck detail endpoint (follows parent chain)
            vndb_id = deck.get("_vndb_id")
            if vndb_id:
                entry["vn_id"] = vndb_id
                vn_info = vn_data_map.get(vndb_id)
                if vn_info:
                    entry["vn_title"] = vn_info["title"]
                    entry["vn_title_jp"] = vn_info["title_jp"]
                    entry["vn_title_romaji"] = vn_info["title_romaji"]
        sentences.append(entry)

    # Build featured VN from jiten's top VN data (highest occurrence count)
    featured_vn = None
    top_vn = data.get("top_vn")
    if top_vn and isinstance(top_vn, dict):
        vndb_id = top_vn.get("vndb_id")
        featured_vn = {
            "title": top_vn.get("title", ""),
            "title_jp": top_vn.get("title_jp") or top_vn.get("title", ""),
            "title_romaji": None,
            "image_url": None,
            "image_sexual": 0,
            "vn_id": None,
            "occurrences": top_vn.get("occurrences"),
        }
        # Try to resolve from our DB for cover image and local link
        if vndb_id and db:
            result = await db.execute(
                select(
                    VisualNovel.id, VisualNovel.title, VisualNovel.title_jp,
                    VisualNovel.title_romaji, VisualNovel.image_url, VisualNovel.image_sexual,
                )
                .where(VisualNovel.id == f"v{vndb_id}")
            )
            row = result.one_or_none()
            if row:
                featured_vn["vn_id"] = vndb_id
                featured_vn["title"] = row.title
                featured_vn["title_jp"] = row.title_jp
                featured_vn["title_romaji"] = row.title_romaji
                featured_vn["image_url"] = row.image_url
                featured_vn["image_sexual"] = row.image_sexual
            else:
                # Not in our DB, use jiten cover
                featured_vn["image_url"] = top_vn.get("cover_url")
                featured_vn["vn_id"] = vndb_id

    # Compute related VNDB tags from local DB
    related_tags: list[dict] = []
    if db:
        related_tags = await compute_related_tags(db, data.get("vn_decks", []))

    return {
        "word_id": pick.word_id,
        "reading_index": pick.reading_index,
        "date": pick.date.isoformat(),
        "is_override": pick.is_override or False,
        "main_reading": {
            "text": main_text,
        },
        "alternative_readings": alt_readings,
        "parts_of_speech": word_info.get("partsOfSpeech", []),
        "definitions": definitions,
        "example_sentences": sentences,
        "kanji_info": data.get("kanji_info", []),
        "frequency_rank": main_reading.get("frequencyRank") if isinstance(main_reading, dict) else None,
        "frequency_percentage": main_reading.get("frequencyPercentage") if isinstance(main_reading, dict) else None,
        "used_in_media": main_reading.get("usedInMediaAmount") if isinstance(main_reading, dict) else None,
        "used_in_vns": data.get("media_frequency", {}).get("7"),  # mediaType 7 = Visual Novel
        "pitch_accents": word_info.get("pitchAccents", []),
        "occurrences": word_info.get("occurrences"),
        "jisho": data.get("jisho", {}),
        "tatoeba_sentences": data.get("tatoeba_sentences", []),
        "featured_vn": featured_vn,
        "related_tags": related_tags,
    }


# ============ Scheduled Task ============


async def run_word_of_the_day_selection():
    """Scheduled task: select today's word and invalidate cache."""
    from app.db.database import async_session_maker
    from app.core.cache import get_cache

    logger.info("Running Word of the Day selection...")

    try:
        async with async_session_maker() as db:
            pick = await get_or_select(db)
            if not pick:
                logger.warning("No eligible word found for Word of the Day")
                return

            word_info = (pick.cached_data or {}).get("word_info", {})
            main_reading = word_info.get("mainReading", {})
            text = main_reading.get("text", "?") if isinstance(main_reading, dict) else "?"
            logger.info(f"Word of the Day selected: {pick.word_id} - {text} for {pick.date}")

            cache = get_cache()
            await cache.delete("word_of_the_day:current")

    except Exception as e:
        logger.error(f"Word of the Day selection failed: {e}", exc_info=True)
