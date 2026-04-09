"""Async HTTP client for the jiten.moe vocabulary API."""

import asyncio
import logging
import os
import re

import httpx

logger = logging.getLogger(__name__)

BASE_URL = os.getenv("JITEN_API_URL", "https://api.jiten.moe")
TIMEOUT = 15.0


class JitenAPIError(Exception):
    """Raised when the jiten.moe API returns an error or is unreachable."""


async def _get(path: str) -> dict | list:
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=TIMEOUT) as client:
        resp = await client.get(path)
        resp.raise_for_status()
        return resp.json()


async def _post(path: str, json_body: list | dict | None = None) -> dict | list:
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=TIMEOUT) as client:
        resp = await client.post(path, json=json_body or [])
        resp.raise_for_status()
        return resp.json()


async def get_vocabulary_ids_in_range(min_freq: int, max_freq: int) -> list[int]:
    """Get word IDs within a frequency rank range."""
    try:
        data = await _get(f"/api/vocabulary/vocabulary-list-frequency/{min_freq}/{max_freq}")
        return data if isinstance(data, list) else []
    except Exception as e:
        raise JitenAPIError(f"Failed to fetch vocabulary range: {e}") from e


async def get_word_info(word_id: int, reading_index: int = 0) -> dict:
    """Get cached word info (no auth required)."""
    try:
        data = await _get(f"/api/vocabulary/{word_id}/{reading_index}/info")
        return data
    except Exception as e:
        raise JitenAPIError(f"Failed to fetch word {word_id}: {e}") from e


async def get_example_sentences(
    word_id: int, reading_index: int = 0, media_type: int = 7
) -> list[dict]:
    """Get random example sentences. media_type 7 = visual novels."""
    try:
        data = await _post(
            f"/api/vocabulary/{word_id}/{reading_index}/random-example-sentences/{media_type}",
            json_body=[],
        )
        return data if isinstance(data, list) else []
    except Exception:
        return []


async def get_kanji_info(character: str) -> dict | None:
    """Get info for a single kanji character."""
    try:
        return await _get(f"/api/kanji/{character}")
    except Exception:
        return None


async def get_kanjiapi_info(character: str) -> dict | None:
    """Get detailed kanji info from kanjiapi.dev (meanings, readings, Heisig, grade)."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"https://kanjiapi.dev/v1/kanji/{character}")
            resp.raise_for_status()
            return resp.json()
    except Exception:
        return None


def _variant_tier(v: dict) -> int:
    """Rank a variant by priority: 0=ichi1, 1=news1/spec1, 2=other priority, 3=none."""
    prios = set(v.get("priorities", []))
    if "ichi1" in prios:
        return 0
    if prios & {"news1", "spec1"}:
        return 1
    if prios:
        return 2
    return 3


async def get_kanjiapi_words(character: str, limit: int = 8) -> list[dict]:
    """Get common compound words for a kanji from kanjiapi.dev."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"https://kanjiapi.dev/v1/words/{character}")
            resp.raise_for_status()
            words = resp.json()
            if not isinstance(words, list):
                return []

            candidates = []
            for w in words:
                # Find the best variant: prefer ichi1, then news1, short 2-char words
                best_variant = None
                best_tier = 4
                for v in w.get("variants", []):
                    written = v.get("written", "")
                    if not written or not (2 <= len(written) <= 4):
                        continue
                    tier = _variant_tier(v)
                    if tier >= 3:
                        continue  # Skip variants with no priority
                    if tier < best_tier or (tier == best_tier and best_variant and len(written) < len(best_variant.get("written", ""))):
                        best_tier = tier
                        best_variant = v
                if best_variant:
                    candidates.append((best_tier, len(best_variant.get("written", "")), w, best_variant))

            # Sort: highest priority first, then shorter words
            candidates.sort(key=lambda x: (x[0], x[1]))

            seen = set()
            result = []
            for _, _, w, variant in candidates:
                written = variant.get("written", "")
                if written in seen:
                    continue
                seen.add(written)
                glosses = w["meanings"][0]["glosses"][:3] if w.get("meanings") else []
                result.append({
                    "written": written,
                    "reading": variant.get("pronounced", ""),
                    "meanings": glosses,
                })
                if len(result) >= limit:
                    break
            return result
    except Exception:
        return []


async def get_media_frequency(word_id: int, reading_index: int = 0) -> dict:
    """Get count of media containing this word, keyed by media type."""
    try:
        data = await _get(f"/api/vocabulary/{word_id}/{reading_index}/media-frequency")
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}



def strip_furigana(text: str) -> str:
    """Strip bracket furigana notation: 御[ご]座[ざ]る -> 御座る"""
    return re.sub(r'\[[^\]]*\]', '', text)


def to_hiragana(text: str) -> str:
    """Convert bracket notation to hiragana: 御[ご]座[ざ]る -> ござる"""
    result = []
    remaining = text
    while remaining:
        bracket_idx = remaining.find('[')
        if bracket_idx == -1:
            result.append(remaining)
            break
        close_idx = remaining.find(']', bracket_idx)
        if close_idx == -1:
            result.append(remaining)
            break
        kanji_start = bracket_idx - 1
        while kanji_start > 0 and '\u4e00' <= remaining[kanji_start - 1] <= '\u9fff':
            kanji_start -= 1
        if kanji_start > 0:
            result.append(remaining[:kanji_start])
        result.append(remaining[bracket_idx + 1:close_idx])
        remaining = remaining[close_idx + 1:]
    return ''.join(result)


async def fetch_jisho_data(word: str) -> dict | None:
    """Fetch word data from Jisho.org API (JLPT level, tags, bilingual info)."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                "https://jisho.org/api/v1/search/words",
                params={"keyword": word},
            )
            resp.raise_for_status()
            data = resp.json()
            results = data.get("data", [])
            if not results:
                return None
            # Find exact match
            for r in results:
                for jp in r.get("japanese", []):
                    if jp.get("word") == word or jp.get("reading") == word:
                        return r
            return results[0]
    except Exception:
        return None


async def get_vn_decks_for_word(word_id: int, reading_index: int = 0) -> list[dict]:
    """Get VN decks containing this word from jiten.moe, sorted by occurrences desc.

    Returns list of dicts with: deck_id, title, english_title, cover_url, vndb_id, occurrences
    """
    try:
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=TIMEOUT) as client:
            resp = await client.get(
                "/api/media-deck/get-media-decks",
                params={
                    "wordId": word_id,
                    "readingIndex": reading_index,
                    "mediaType": 7,  # Visual Novel
                    "sortBy": "occurrences",
                    "sortOrder": 1,  # Descending
                    "offset": 0,
                },
            )
            resp.raise_for_status()
            data = resp.json()
            items = data.get("data", data if isinstance(data, list) else [])
            results = []
            for item in items:
                vndb_id = None
                for link in item.get("links", []):
                    url = link.get("url", "")
                    if "vndb.org/v" in url:
                        vndb_id = url.split("/v")[-1].split("/")[0]
                        break
                results.append({
                    "deck_id": item.get("deckId"),
                    "title": item.get("originalTitle") or item.get("englishTitle") or "",
                    "english_title": item.get("englishTitle") or "",
                    "cover_url": item.get("coverName") or "",
                    "vndb_id": vndb_id,
                    "occurrences": item.get("selectedWordOccurrences"),
                })
            return results
    except Exception:
        return []


async def get_deck_vndb_id(deck_id: int) -> tuple[int, str | None, str | None]:
    """Get the VNDB ID for a jiten deck, following parent chain for subdecks.

    Returns (original_deck_id, vndb_id_or_none, parent_title_or_none).
    """
    try:
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=TIMEOUT) as client:
            resp = await client.get(f"/api/media-deck/{deck_id}/detail")
            resp.raise_for_status()
            data = resp.json()
            detail = data.get("data") or {}
            main_deck = detail.get("mainDeck") or {}

            # Check mainDeck links first
            for link in main_deck.get("links", []):
                url = link.get("url", "")
                if "vndb.org/v" in url:
                    return deck_id, url.split("/v")[-1].split("/")[0], None

            # If this is a subdeck, follow the parent
            parent = detail.get("parentDeck")
            if parent and parent.get("deckId"):
                parent_title = parent.get("originalTitle") or parent.get("englishTitle")
                parent_id = parent["deckId"]

                # Check parent's links from this response first
                for link in parent.get("links", []):
                    url = link.get("url", "")
                    if "vndb.org/v" in url:
                        return deck_id, url.split("/v")[-1].split("/")[0], parent_title

                # Fetch parent detail for its links
                resp2 = await client.get(f"/api/media-deck/{parent_id}/detail")
                resp2.raise_for_status()
                data2 = resp2.json()
                parent_main = (data2.get("data") or {}).get("mainDeck") or {}
                parent_title = parent_main.get("originalTitle") or parent_main.get("englishTitle") or parent_title
                for link in parent_main.get("links", []):
                    url = link.get("url", "")
                    if "vndb.org/v" in url:
                        return deck_id, url.split("/v")[-1].split("/")[0], parent_title
    except Exception:
        pass
    return deck_id, None, None


async def fetch_tatoeba_sentences(word: str, limit: int = 3) -> list[dict]:
    """Fetch bilingual JP/EN example sentences from Tatoeba."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                "https://tatoeba.org/en/api_v0/search",
                params={"from": "jpn", "to": "eng", "query": word, "limit": limit * 3},
            )
            resp.raise_for_status()
            data = resp.json()
            sentences = []
            for r in data.get("results", []):
                jp_text = r.get("text", "")
                en_text = ""
                for t in r.get("translations", [[]])[0]:
                    if t.get("lang") == "eng":
                        en_text = t.get("text", "")
                        break
                if jp_text and en_text and word in jp_text:
                    sentences.append({"japanese": jp_text, "english": en_text})
            return sentences[:limit]
    except Exception:
        return []


async def fetch_full_word_data(word_id: int, reading_index: int = 0) -> dict:
    """Fetch word info from jiten, plus Jisho and Tatoeba data in parallel."""
    word_info = await get_word_info(word_id, reading_index)

    # Extract the plain text word for other API lookups
    main_reading = word_info.get("mainReading") or {}
    main_text = main_reading.get("text", "") if isinstance(main_reading, dict) else ""
    plain_word = strip_furigana(main_text)
    hiragana_word = to_hiragana(main_text)

    # Fetch from multiple sources in parallel
    sentences_task = get_example_sentences(word_id, reading_index, media_type=7)
    jisho_task = fetch_jisho_data(plain_word)
    tatoeba_task = fetch_tatoeba_sentences(plain_word)
    vn_decks_task = get_vn_decks_for_word(word_id, reading_index)
    media_freq_task = get_media_frequency(word_id, reading_index)
    kanji_chars = [ch for ch in main_text if '\u4e00' <= ch <= '\u9fff']
    kanji_jiten_tasks = [get_kanji_info(ch) for ch in kanji_chars]
    kanji_api_tasks = [get_kanjiapi_info(ch) for ch in kanji_chars]
    kanji_words_tasks = [get_kanjiapi_words(ch) for ch in kanji_chars]

    all_kanji_tasks = kanji_jiten_tasks + kanji_api_tasks + kanji_words_tasks
    results = await asyncio.gather(
        sentences_task, jisho_task, tatoeba_task, vn_decks_task, media_freq_task, *all_kanji_tasks,
        return_exceptions=True,
    )

    sentences = results[0] if isinstance(results[0], list) else []
    jisho_data = results[1] if isinstance(results[1], dict) else None
    tatoeba_sentences = results[2] if isinstance(results[2], list) else []
    vn_decks = results[3] if isinstance(results[3], list) else []
    media_freq = results[4] if isinstance(results[4], dict) else {}
    n_kanji = len(kanji_chars)
    # Results layout after index 5: [jiten0..jitenN, api0..apiN, words0..wordsN]
    jiten_kanji_results = results[5:5 + n_kanji]
    api_kanji_results = results[5 + n_kanji:5 + 2 * n_kanji]
    words_kanji_results = results[5 + 2 * n_kanji:5 + 3 * n_kanji]

    # Fallback for VN sentences
    if not sentences:
        for media_type in [6, 1, 9, 4, 8]:  # video games, anime, manga, novels, web novels
            sentences = await get_example_sentences(word_id, reading_index, media_type)
            if sentences:
                break

    # Resolve VNDB IDs for each sentence's sourceDeck via deck detail endpoint
    deck_ids = set()
    for s in sentences:
        if isinstance(s, dict):
            deck = s.get("sourceDeck") or {}
            if isinstance(deck, dict) and deck.get("deckId"):
                deck_ids.add(deck["deckId"])

    deck_vndb_results = await asyncio.gather(
        *[get_deck_vndb_id(did) for did in deck_ids],
        return_exceptions=True,
    )
    deck_vndb_map: dict[int, tuple[str, str | None]] = {}  # deck_id -> (vndb_id, parent_title)
    for r in deck_vndb_results:
        if isinstance(r, tuple) and len(r) >= 3 and r[1]:
            deck_vndb_map[r[0]] = (r[1], r[2])

    # Attach vndb_id and parent title to each sentence's sourceDeck
    for s in sentences:
        if isinstance(s, dict):
            deck = s.get("sourceDeck") or {}
            if isinstance(deck, dict):
                did = deck.get("deckId")
                if did and did in deck_vndb_map:
                    vndb_id, parent_title = deck_vndb_map[did]
                    deck["_vndb_id"] = vndb_id
                    if parent_title:
                        deck["_parent_title"] = parent_title

    # Build kanji info by merging jiten + kanjiapi.dev data
    kanji_info = []
    for i, ch in enumerate(kanji_chars):
        jiten_result = jiten_kanji_results[i] if isinstance(jiten_kanji_results[i], dict) else {}
        api_result = api_kanji_results[i] if isinstance(api_kanji_results[i], dict) else {}
        words_result = words_kanji_results[i] if isinstance(words_kanji_results[i], list) else []

        # Skip if neither source returned data
        if not jiten_result and not api_result:
            continue

        kanji_info.append({
            "character": ch,
            "jlpt_level": jiten_result.get("jlptLevel") or api_result.get("jlpt"),
            "grade": jiten_result.get("grade") or api_result.get("grade"),
            "stroke_count": jiten_result.get("strokeCount") or api_result.get("stroke_count"),
            "frequency": jiten_result.get("frequencyRank") or api_result.get("freq_mainichi_shinbun"),
            "meanings": api_result.get("meanings", []),
            "kun_readings": api_result.get("kun_readings", []),
            "on_readings": api_result.get("on_readings", []),
            "heisig_en": api_result.get("heisig_en"),
            "name_readings": api_result.get("name_readings", []),
            "compounds": words_result,
        })

    # Extract Jisho-specific data
    jisho = {}
    if jisho_data:
        jisho["jlpt"] = jisho_data.get("jlpt", [])
        jisho["is_common"] = jisho_data.get("is_common", False)
        jisho["tags"] = jisho_data.get("tags", [])
        # Extract sense-level notes and see_also
        sense_notes = []
        for s in jisho_data.get("senses", []):
            notes = {
                "tags": s.get("tags", []),
                "info": s.get("info", []),
                "see_also": s.get("see_also", []),
            }
            if any(notes.values()):
                sense_notes.append(notes)
        jisho["sense_notes"] = sense_notes

    return {
        "word_info": word_info,
        "example_sentences": sentences,
        "kanji_info": kanji_info,
        "jisho": jisho,
        "tatoeba_sentences": tatoeba_sentences,
        "vn_decks": vn_decks,
        "top_vn": vn_decks[0] if vn_decks else None,
        "media_frequency": media_freq,
    }
