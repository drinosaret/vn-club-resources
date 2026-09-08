"""New decks on jiten.moe, the difficulty and vocabulary index the site already reads."""

from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta
from typing import Any

import aiohttp
from dateutil import parser as date_parser

from app.services.news.drafts import NewsDraft
from app.services.news.sources import JITEN_UPDATE_LOG_URL

logger = logging.getLogger(__name__)

VN_MEDIA_TYPE = 7
DECK_URL = "https://jiten.moe/decks/media/{id}"
COVER_URL = "https://cdn.jiten.moe/{id}/cover.jpg"
MAX_AGE = timedelta(days=7)
MAX_ITEMS = 15
REQUEST_TIMEOUT = aiohttp.ClientTimeout(total=30)
_VNDB_LINK = re.compile(r"vndb\.org/(v\d+)")


def _vn_id(deck: dict[str, Any]) -> str | None:
    for link in deck.get("links") or []:
        url = link.get("url") if isinstance(link, dict) else link
        m = _VNDB_LINK.search(str(url or ""))
        if m:
            return m.group(1)
    return None


def parse_log(payload: dict[str, Any], now: datetime) -> list[NewsDraft]:
    drafts: list[NewsDraft] = []
    for deck in payload.get("data") or []:
        if deck.get("mediaType") != VN_MEDIA_TYPE or deck.get("parentDeckId"):
            continue
        try:
            created = date_parser.parse(deck["creationDate"])
        except (KeyError, ValueError, TypeError):
            continue
        if now - created > MAX_AGE:
            continue
        deck_id = deck.get("deckId")
        title = deck.get("originalTitle") or deck.get("romajiTitle") or deck.get("englishTitle")
        if not deck_id or not title:
            continue
        parts = [p for p in (deck.get("romajiTitle"), deck.get("englishTitle")) if p and p != title]
        difficulty = deck.get("difficulty")
        chars = deck.get("characterCount")
        if difficulty:
            parts.append(f"difficulty {difficulty:g}")
        if chars:
            parts.append(f"{chars:,} characters")
        has_cover = deck.get("coverName") and deck.get("coverName") != "nocover.jpg"
        drafts.append(
            NewsDraft(
                source="jiten",
                source_label="jiten.moe",
                key=str(deck_id),
                title=str(title)[:500],
                summary=" · ".join(parts) or None,
                url=DECK_URL.format(id=deck_id),
                image_url=COVER_URL.format(id=deck_id) if has_cover else None,
                published_at=created,
                tags=["deck"],
                vn_id=_vn_id(deck),
                extra={
                    "deck_id": deck_id,
                    "difficulty": difficulty,
                    "character_count": chars,
                    "title_romaji": deck.get("romajiTitle"),
                    "alttitle": deck.get("originalTitle"),
                },
            )
        )
    drafts.sort(key=lambda d: d.published_at, reverse=True)
    return drafts[:MAX_ITEMS]


async def fetch_new_decks(session: aiohttp.ClientSession, now: datetime) -> list[NewsDraft]:
    async with session.get(JITEN_UPDATE_LOG_URL, timeout=REQUEST_TIMEOUT) as resp:
        if resp.status != 200:
            logger.warning("jiten update log returned %s", resp.status)
            return []
        payload = await resp.json(content_type=None)
    return parse_log(payload, now)
