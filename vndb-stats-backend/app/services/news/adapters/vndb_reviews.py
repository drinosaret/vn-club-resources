"""Reviews from the catalogue site, read from its listing pages.

The site has no review feed and its API and dumps leave reviews out, so the listing is read
the way a reader would: the newest page once an hour, then one page per review not seen
before, at the spacing the site asks of crawlers. Only reviews of Japanese-original works
are kept; the review's own language is judged from its script.
"""

from __future__ import annotations

import asyncio
import html
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

import aiohttp
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import VisualNovel
from app.services.news import store
from app.services.news.drafts import NewsDraft
from app.services.news.sources import VNDB_CRAWL_DELAY, VNDB_REVIEWS_URL
from app.services.news.text import clean_html, script_lang, strip_spoilers

logger = logging.getLogger(__name__)

SOURCE = "vndb_review"
REVIEW_URL = "https://vndb.org/{id}"
REVIEWER_URL = "https://vndb.org/u{id}"
API_URL = "https://api.vndb.org/kana/vn"
MAX_AGE = timedelta(days=14)
MAX_DETAILS = 20
EXCERPT_LIMIT = 300
NSFW_COVER = 1.5
REQUEST_TIMEOUT = aiohttp.ClientTimeout(total=30)

_ROW = re.compile(r"<tr>(.*?)</tr>", re.S)
_CELL = re.compile(r'<td class="tc(\d)">(.*?)</td>', re.S)
_REVIEW_LINK = re.compile(r'<a href="/(w\d+)"([^>]*)>([^<]*)</a>')
_TITLE_ATTR = re.compile(r'title="([^"]*)"')
_USER_LINK = re.compile(r'<a href="/u(\d+)">([^<]*)</a>')
_SUBJECT = re.compile(r'<td>Subject</td><td><a href="/(v\d+)"')
_VOTE = re.compile(r"Vote:\s*(\d+)")
_BY = re.compile(r'<td>By</td><td>.*?<a href="/u(\d+)">([^<]*)</a> on (\d{4}-\d{2}-\d{2})', re.S)
_BODY = re.compile(r"<td>Review</td><td>(.*?)</td>\s*</tr>", re.S)
_LENGTHS = {"short": "short", "medium": "medium", "long": "long"}


@dataclass(frozen=True)
class ReviewStub:
    id: str
    date: datetime
    user: str
    # The reviewer's catalogue account, when the row links one.
    user_id: str | None
    vote: int | None
    length: str | None
    title_original: str | None
    title_romaji: str
    comments: int


@dataclass(frozen=True)
class ReviewDetail:
    vn_id: str
    vote: int | None
    user: str | None
    user_id: str | None
    date: datetime | None
    body: str
    chars: int


def _date(text: str) -> datetime | None:
    try:
        return datetime.strptime(text.strip(), "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def parse_review_list(page: str) -> list[ReviewStub]:
    stubs: list[ReviewStub] = []
    for row in _ROW.findall(page):
        cells = {int(n): body for n, body in _CELL.findall(row)}
        link = _REVIEW_LINK.search(cells.get(5, ""))
        date = _date(clean_html(cells.get(1, "")))
        if not link or not date:
            continue
        user = _USER_LINK.search(cells.get(2, ""))
        vote_text = clean_html(cells.get(3, ""))
        title_attr = _TITLE_ATTR.search(link.group(2))
        stubs.append(
            ReviewStub(
                id=link.group(1),
                date=date,
                user=html.unescape(user.group(2)) if user else "",
                user_id=user.group(1) if user else None,
                vote=int(vote_text) if vote_text.isdigit() else None,
                length=_LENGTHS.get(clean_html(cells.get(4, "")).lower()),
                title_original=html.unescape(title_attr.group(1)) if title_attr else None,
                title_romaji=html.unescape(link.group(3)).strip(),
                comments=int(clean_html(cells.get(7, "")) or 0),
            )
        )
    return stubs


def parse_review_page(page: str) -> ReviewDetail | None:
    subject = _SUBJECT.search(page)
    body = _BODY.search(page)
    if not subject or not body:
        return None
    vote = _VOTE.search(page)
    by = _BY.search(page)
    text = clean_html(strip_spoilers(body.group(1).replace("<br>", "\n").replace("<br />", "\n")))
    return ReviewDetail(
        vn_id=subject.group(1),
        vote=int(vote.group(1)) if vote else None,
        user=html.unescape(by.group(2)) if by else None,
        user_id=by.group(1) if by else None,
        date=_date(by.group(3)) if by else None,
        body=text,
        chars=len(text),
    )


def excerpt(body: str, limit: int = EXCERPT_LIMIT) -> str:
    if len(body) <= limit:
        return body
    cut = body[:limit].rsplit(" ", 1)[0] if " " in body[:limit] else body[:limit]
    return cut.rstrip(" ,;:、。") + "…"


def draft_review(stub: ReviewStub, detail: ReviewDetail, vn: Any) -> NewsDraft:
    """A row for a review of a catalogue title, worn as the title with the reviewer's words."""
    sexual = getattr(vn, "image_sexual", None)
    user_id = detail.user_id or stub.user_id
    return NewsDraft(
        source=SOURCE,
        source_label="VNDB",
        key=stub.id,
        title=vn.title,
        summary=excerpt(detail.body),
        url=REVIEW_URL.format(id=stub.id),
        image_url=vn.image_url,
        image_is_nsfw=bool(sexual is not None and sexual >= NSFW_COVER),
        published_at=stub.date,
        tags=["review"],
        vn_id=vn.id,
        extra={
            "vn_id": vn.id,
            "alttitle": vn.title_jp,
            "title_romaji": vn.title_romaji,
            "image_sexual": sexual,
            "reviewer": detail.user or stub.user,
            **({"reviewer_url": REVIEWER_URL.format(id=user_id)} if user_id else {}),
            "vote": detail.vote if detail.vote is not None else stub.vote,
            "length": stub.length,
            "chars": detail.chars,
            "comments": stub.comments,
            "review_id": stub.id,
            "lang": script_lang(detail.body),
        },
    )


@dataclass
class _ApiVN:
    id: str
    title: str
    title_jp: str | None
    title_romaji: str | None
    image_url: str | None
    image_sexual: float | None


async def _vn_from_api(session: aiohttp.ClientSession, vn_id: str) -> _ApiVN | None:
    """A title the dump does not carry yet, straight from the API; None unless Japanese-original."""
    body = {"filters": ["id", "=", vn_id], "fields": "title, alttitle, olang, image.url, image.sexual"}
    async with session.post(API_URL, json=body, timeout=REQUEST_TIMEOUT) as resp:
        if resp.status != 200:
            return None
        data = await resp.json(content_type=None)
    results = data.get("results") or []
    if not results or results[0].get("olang") != "ja":
        return None
    vn = results[0]
    image = vn.get("image") or {}
    return _ApiVN(
        id=vn["id"],
        title=vn.get("title") or vn_id,
        title_jp=vn.get("alttitle"),
        title_romaji=vn.get("title"),
        image_url=image.get("url"),
        image_sexual=image.get("sexual"),
    )


async def _resolve_vn(session: aiohttp.ClientSession, db: AsyncSession, vn_id: str):
    row = (
        await db.execute(select(VisualNovel).where(VisualNovel.id == vn_id, VisualNovel.olang == "ja"))
    ).scalar_one_or_none()
    if row is not None:
        return row
    known = await db.scalar(select(VisualNovel.id).where(VisualNovel.id == vn_id))
    if known:
        return None
    return await _vn_from_api(session, vn_id)


async def _get(session: aiohttp.ClientSession, url: str) -> str | None:
    async with session.get(url, timeout=REQUEST_TIMEOUT) as resp:
        if resp.status != 200:
            logger.warning("VNDB reviews: %s returned %s", url, resp.status)
            return None
        return await resp.text()


async def fetch_new_reviews(
    session: aiohttp.ClientSession,
    db: AsyncSession,
    now: datetime,
    *,
    max_details: int = MAX_DETAILS,
    delay: float = VNDB_CRAWL_DELAY,
) -> list[NewsDraft]:
    page = await _get(session, VNDB_REVIEWS_URL)
    if not page:
        return []
    stubs = [s for s in parse_review_list(page) if now - s.date <= MAX_AGE]
    fresh = await store.unknown_keys(db, SOURCE, [s.id for s in stubs])
    by_id = {s.id: s for s in stubs}
    drafts: list[NewsDraft] = []
    for review_id in fresh[:max_details]:
        await asyncio.sleep(delay)
        detail_page = await _get(session, REVIEW_URL.format(id=review_id))
        detail = parse_review_page(detail_page) if detail_page else None
        if detail is None:
            continue
        vn = await _resolve_vn(session, db, detail.vn_id)
        if vn is None:
            continue
        drafts.append(draft_review(by_id[review_id], detail, vn))
    return drafts
