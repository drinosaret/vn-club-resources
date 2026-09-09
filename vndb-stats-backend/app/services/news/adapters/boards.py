"""Thread lists of the text boards. A new thread is the news; posts are never read.

The list is one line per thread, `<id>.dat<>title (count)`, in the boards' legacy
encoding; the id is the thread's creation time, which is all the dating there is.
"""

from __future__ import annotations

import html
import logging
import re
from datetime import datetime, timedelta, timezone

import aiohttp

from app.services.news.drafts import NewsDraft
from app.services.news.sources import Board

logger = logging.getLogger(__name__)

SUBJECT_URL = "https://{host}/{board}/subject.txt"
THREAD_URL = "https://{host}/test/read.cgi/{board}/{id}/"
MAX_AGE = timedelta(days=7)
REQUEST_TIMEOUT = aiohttp.ClientTimeout(total=30)

_LINE = re.compile(r"^(\d{9,10})\.dat<>(.*?)\s*\((\d+)\)\s*$")
# Pinned notices carry ids that are not timestamps and sort far in the future.
_MAX_ID = 2_000_000_000


def parse_subjects(payload: bytes, board: Board, now: datetime) -> list[NewsDraft]:
    text = payload.decode("cp932", errors="replace")
    drafts: list[NewsDraft] = []
    for line in text.splitlines():
        m = _LINE.match(line.strip())
        if not m:
            continue
        thread_id, title, count = int(m.group(1)), html.unescape(m.group(2)).strip(), int(m.group(3))
        if thread_id > _MAX_ID:
            continue
        created = datetime.fromtimestamp(thread_id, tz=timezone.utc)
        if now - created > MAX_AGE or not title:
            continue
        drafts.append(
            NewsDraft(
                source="board",
                source_label=board.name,
                key=f"{board.board}-{thread_id}",
                title=title[:500],
                summary=f"{count}レス",
                url=THREAD_URL.format(host=board.host, board=board.board, id=thread_id),
                published_at=created,
                tags=["thread"],
                extra={"board": board.board, "replies": count, "lang": board.lang},
            )
        )
    drafts.sort(key=lambda d: d.published_at, reverse=True)
    return drafts


async def fetch_board(session: aiohttp.ClientSession, board: Board, now: datetime) -> list[NewsDraft]:
    url = SUBJECT_URL.format(host=board.host, board=board.board)
    async with session.get(url, timeout=REQUEST_TIMEOUT, headers=board.headers) as resp:
        if resp.status != 200:
            logger.info("Board %s returned %s", board.board, resp.status)
            return []
        payload = await resp.read()
    return parse_subjects(payload, board, now)
