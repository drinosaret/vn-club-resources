"""Mirror jiten.moe's reading-difficulty analysis into Postgres.

Difficulty comes from a third party rather than the VNDB dump, so holding it locally is what
lets browse filter and sort by it. The upstream is small: the whole visual novel catalogue is
a few dozen pages at the endpoint's own cap, so a full sweep can run with every import.

Two rules this module exists to enforce:

- **Upsert, never truncate.** A sweep that fails halfway must leave the previous rows in
  place. Replacing the table wholesale would turn an upstream outage into a filter that
  silently matches nothing, which reads to a visitor as "no such titles" rather than "no
  data".
- **Report coverage every run.** Nothing else measures whether the mirror is still working,
  and a sweep that quietly returns two rows looks exactly like a sweep that returned two
  thousand once the numbers are out of sight.
"""

from __future__ import annotations

import asyncio
import logging
import re

import httpx
from sqlalchemy import func, select, text
from sqlalchemy.dialects.postgresql import insert

from app.db.database import async_session
from app.db.models import VNDifficulty, VisualNovel

logger = logging.getLogger(__name__)

JITEN_API = "https://api.jiten.moe/api/media-deck/get-media-decks"

#: jiten's media type for visual novels.
MEDIA_TYPE_VN = 7

#: The endpoint's own page cap. Asking for more silently returns this many.
PAGE_SIZE = 50

#: Attempts per page. Outbound calls to this host fail intermittently, so a single failure
#: is expected rather than exceptional; only a page that fails every attempt is skipped.
MAX_ATTEMPTS = 4

REQUEST_TIMEOUT = 20.0

#: Pause between attempts, growing with each one.
RETRY_BACKOFF = 1.5

#: Link type carrying the VNDB url in a deck's links array.
LINK_TYPE_VNDB = 2

_VNDB_ID = re.compile(r"vndb\.org/(v\d+)")

#: Below this share of the expected catalogue, treat the sweep as failed and write nothing.
#: A handful of pages failing is normal and worth keeping; most of them failing is an outage,
#: and letting it through would age out the mirror one bad night at a time.
MIN_COVERAGE_RATIO = 0.5


def extract_vn_id(deck: dict) -> str | None:
    """The VNDB id a deck is linked to, or None when it is not linked to one."""
    for link in deck.get("links") or ():
        if link.get("linkType") != LINK_TYPE_VNDB:
            continue
        match = _VNDB_ID.search(link.get("url") or "")
        if match:
            return match.group(1)
    return None


def deck_to_row(deck: dict) -> dict | None:
    """Flatten one deck into a row, or None when it cannot be attributed to a title."""
    vn_id = extract_vn_id(deck)
    deck_id = deck.get("deckId")
    if not vn_id or deck_id is None:
        return None

    return {
        "vn_id": vn_id,
        "jiten_deck_id": deck_id,
        "difficulty": deck.get("difficulty"),
        "difficulty_raw": deck.get("difficultyRaw"),
        "character_count": deck.get("characterCount"),
        "word_count": deck.get("wordCount"),
        "unique_word_count": deck.get("uniqueWordCount"),
        "unique_kanji_count": deck.get("uniqueKanjiCount"),
        "sentence_count": deck.get("sentenceCount"),
        "average_sentence_length": deck.get("averageSentenceLength"),
        "dialogue_percentage": deck.get("dialoguePercentage"),
    }


async def fetch_page(client: httpx.AsyncClient, offset: int) -> tuple[list[dict], int | None]:
    """One page of decks, and the catalogue total the response reports.

    Returns an empty page rather than raising when every attempt fails: one unreachable page
    should cost its own rows, not the whole sweep.
    """
    params = {
        "offset": offset,
        "limit": PAGE_SIZE,
        "mediaType": MEDIA_TYPE_VN,
        "sortBy": "difficulty",
        "sortOrder": 0,
    }

    for attempt in range(MAX_ATTEMPTS):
        try:
            response = await client.get(JITEN_API, params=params, timeout=REQUEST_TIMEOUT)
            response.raise_for_status()
            body = response.json()
            return body.get("data") or [], body.get("totalItems")
        except Exception as exc:
            if attempt == MAX_ATTEMPTS - 1:
                logger.warning(f"jiten page at offset {offset} failed: {exc}")
            else:
                await asyncio.sleep(RETRY_BACKOFF * (attempt + 1))

    return [], None


async def sweep_decks() -> tuple[list[dict], int | None]:
    """Walk the whole visual novel catalogue, one page at a time.

    Sequential rather than concurrent: the catalogue is small, and a service this size is
    better served by a slow reader than a fast one.
    """
    rows: dict[str, dict] = {}
    total_items: int | None = None
    offset = 0

    async with httpx.AsyncClient(
        headers={"User-Agent": "vnclub.org difficulty mirror"},
        follow_redirects=True,
    ) as client:
        while True:
            decks, reported = await fetch_page(client, offset)
            if reported is not None:
                total_items = reported

            for deck in decks:
                row = deck_to_row(deck)
                if row:
                    # A title with two decks keeps the first, which is the lower difficulty
                    # under this sort order. Nothing downstream can show two.
                    rows.setdefault(row["vn_id"], row)

            offset += PAGE_SIZE
            if total_items is None or offset >= total_items:
                break

    return list(rows.values()), total_items


#: Rows per insert. The driver binds one parameter per column per row against a fixed
#: ceiling, so the whole mirror in one statement would exceed it; batching keeps every
#: statement under the bound whatever the column count becomes.
STORE_BATCH_SIZE = 1_000


async def store_rows(db, rows: list[dict]) -> int:
    """Upsert the swept rows. Nothing is ever deleted here; see the module docstring."""
    if not rows:
        return 0

    # A title absent from the local database would violate the foreign key, and a jiten deck
    # can legitimately point at an id that has not been imported.
    known = await db.execute(
        select(VisualNovel.id).where(VisualNovel.id.in_([r["vn_id"] for r in rows]))
    )
    known_ids = {row[0] for row in known}
    rows = [r for r in rows if r["vn_id"] in known_ids]
    if not rows:
        return 0

    # A deck that moves to a different title collides on the deck-id index rather than on the
    # primary key, which the upsert below does not cover: the row is dropped first so the
    # move lands instead of raising. Nothing else deletes from this table, so without it one
    # relink upstream stops every later sweep, permanently.
    await db.execute(
        text(
            "DELETE FROM vn_difficulty"
            " WHERE jiten_deck_id = ANY(:decks) AND vn_id <> ALL(:titles)"
        ),
        {
            "decks": [r["jiten_deck_id"] for r in rows],
            "titles": [r["vn_id"] for r in rows],
        },
    )

    # Batched because the driver binds one parameter per column per row, and a single
    # statement over the whole mirror stops fitting as upstream grows.
    for start in range(0, len(rows), STORE_BATCH_SIZE):
        batch = rows[start : start + STORE_BATCH_SIZE]
        statement = insert(VNDifficulty).values(batch)
        updates = {
            column: statement.excluded[column]
            for column in batch[0]
            if column != "vn_id"
        }
        updates["updated_at"] = func.now()
        await db.execute(
            statement.on_conflict_do_update(index_elements=["vn_id"], set_=updates)
        )

    await db.commit()
    return len(rows)


async def import_jiten_difficulty() -> dict:
    """Refresh the difficulty mirror. Entry point for the import pipeline."""
    logger.info("Sweeping jiten.moe for visual novel difficulty...")
    rows, total_items = await sweep_decks()

    stats = {
        "decks_reported": total_items,
        "decks_with_vndb_id": len(rows),
        "stored": 0,
        "aborted": False,
    }

    if total_items and len(rows) < total_items * MIN_COVERAGE_RATIO:
        # Keeping yesterday's rows beats replacing them with a fraction of themselves.
        stats["aborted"] = True
        logger.error(
            f"jiten sweep returned {len(rows)} of about {total_items} decks; "
            "keeping the existing rows rather than storing a partial sweep"
        )
        return stats

    async with async_session() as db:
        stats["stored"] = await store_rows(db, rows)
        held = await db.execute(text("SELECT count(*) FROM vn_difficulty"))
        stats["rows_held"] = held.scalar_one()

    logger.info(
        f"Difficulty mirror: {stats['stored']:,} rows written, "
        f"{stats['rows_held']:,} held, upstream reports {total_items}"
    )
    return stats
