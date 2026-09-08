"""The image board's catalogue, for the generals where the scene gathers.

Only the thread itself is filed (subject, opening lines, picture); replies are not read.
The board is a work-safe one, so its pictures show unblurred.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

import aiohttp

from app.services.news.drafts import NewsDraft
from app.services.news.sources import EN, FOURCHAN_BOARD, FOURCHAN_SUBJECTS
from app.services.news.text import clean_html

logger = logging.getLogger(__name__)

CATALOG_URL = "https://a.4cdn.org/{board}/catalog.json"
THREAD_URL = "https://boards.4chan.org/{board}/thread/{no}"
THUMB_URL = "https://i.4cdn.org/{board}/{tim}s.jpg"
MAX_AGE = timedelta(days=7)
SUMMARY_LIMIT = 300
REQUEST_TIMEOUT = aiohttp.ClientTimeout(total=30)


def _wanted(subject: str) -> bool:
    lowered = subject.lower()
    return any(term in lowered for term in FOURCHAN_SUBJECTS)


def parse_catalog(payload: list[dict[str, Any]], now: datetime, board: str = FOURCHAN_BOARD) -> list[NewsDraft]:
    drafts: list[NewsDraft] = []
    for page in payload:
        for thread in page.get("threads") or []:
            subject = clean_html(thread.get("sub") or "")
            if not subject or not _wanted(subject):
                continue
            created = datetime.fromtimestamp(int(thread.get("time") or 0), tz=timezone.utc)
            if now - created > MAX_AGE:
                continue
            no = thread.get("no")
            tim = thread.get("tim")
            drafts.append(
                NewsDraft(
                    source="chan",
                    source_label=f"/{board}/",
                    key=f"{board}-{no}",
                    title=subject[:500],
                    summary=clean_html(thread.get("com") or "")[:SUMMARY_LIMIT] or None,
                    url=THREAD_URL.format(board=board, no=no),
                    image_url=THUMB_URL.format(board=board, tim=tim) if tim else None,
                    published_at=created,
                    tags=["thread"],
                    extra={"board": board, "replies": thread.get("replies"), "lang": EN},
                )
            )
    drafts.sort(key=lambda d: d.published_at, reverse=True)
    return drafts


async def fetch_catalog(session: aiohttp.ClientSession, now: datetime, board: str = FOURCHAN_BOARD) -> list[NewsDraft]:
    async with session.get(CATALOG_URL.format(board=board), timeout=REQUEST_TIMEOUT) as resp:
        if resp.status != 200:
            logger.warning("Catalog /%s/ returned %s", board, resp.status)
            return []
        payload = await resp.json(content_type=None)
    return parse_catalog(payload, now, board)
