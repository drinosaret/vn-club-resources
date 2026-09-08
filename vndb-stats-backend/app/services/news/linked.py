"""What a post is about when it is only a link.

Some accounts post a bare address and nothing else: a calendar bot marking a release
anniversary, a brand pointing at a page. The page itself says what it is, so its title
stands in for the missing words, and where the page names a release date that falls on
the day of the post, the row says so and counts the years.
"""

from __future__ import annotations

import html
import logging
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta

import aiohttp

from app.services.news.drafts import NewsDraft
from app.services.news.text import decode_page, read_public_page

logger = logging.getLogger(__name__)

_BARE_LINK = re.compile(r"^\s*https?://\S+\s*$")
_META = {
    "title": re.compile(r'<meta\s+(?:property|name)="og:title"\s+content="([^"]+)"', re.I),
    "description": re.compile(r'<meta\s+(?:property|name)="og:description"\s+content="([^"]+)"', re.I),
}
_META_REV = {
    "title": re.compile(r'<meta\s+content="([^"]+)"\s+(?:property|name)="og:title"', re.I),
    "description": re.compile(r'<meta\s+content="([^"]+)"\s+(?:property|name)="og:description"', re.I),
}
_HTML_TITLE = re.compile(r"<title>([^<]+)</title>", re.I)
# A release date as Japanese sites write it, within a short distance of the word for it.
_RELEASE = re.compile(r"発売日?[^0-9]{0,40}?(\d{4})[年/.-](\d{1,2})[月/.-](\d{1,2})")
# The part of a page title that names the site rather than the page.
_TITLE_SUFFIX = re.compile(r"\s*[|｜–—-]\s*[^|｜–—-]*$")
JST = timedelta(hours=9)


@dataclass
class PageMeta:
    title: str | None = None
    description: str | None = None
    released: date | None = None


def is_bare_link(text: str | None) -> bool:
    return bool(text) and bool(_BARE_LINK.match(text))


def clean_title(raw: str) -> str:
    """The page's own name, with the site's name and section trimmed off the end."""
    title = html.unescape(raw).strip()
    # Trim repeatedly: a title can carry both a section and the site name.
    for _ in range(3):
        trimmed = _TITLE_SUFFIX.sub("", title)
        if trimmed == title or not trimmed:
            break
        title = trimmed
    return title.strip()


def parse_page_meta(page: str) -> PageMeta:
    meta = PageMeta()
    for key in ("title", "description"):
        m = _META[key].search(page) or _META_REV[key].search(page)
        if m:
            setattr(meta, key, html.unescape(m.group(1)).strip())
    if not meta.title:
        m = _HTML_TITLE.search(page)
        if m:
            meta.title = html.unescape(m.group(1)).strip()
    m = _RELEASE.search(page)
    if m:
        try:
            meta.released = date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError:
            pass
    return meta


def describe(meta: PageMeta, posted_at: datetime, site_name: str | None) -> tuple[str | None, str | None, dict]:
    """Title, summary and extra for a post from its page. Returns Nones when the page gave nothing."""
    if not meta.title:
        return None, None, {}
    title = clean_title(meta.title)
    extra: dict = {}
    summary = None
    if meta.released:
        posted_day = (posted_at + JST).date()
        # Anniversary: the page's release date falls on the day of the post, in an earlier year.
        if (meta.released.month, meta.released.day) == (posted_day.month, posted_day.day) and meta.released.year < posted_day.year:
            years = posted_day.year - meta.released.year
            summary = f"{meta.released.year}年{meta.released.month}月{meta.released.day}日発売 · 本日で{years}周年"
            extra = {"kind": "anniversary", "released": meta.released.isoformat(), "years": years}
        else:
            summary = f"{meta.released.year}年{meta.released.month}月{meta.released.day}日発売"
            extra = {"released": meta.released.isoformat()}
    elif meta.description and not (site_name and site_name in meta.description):
        summary = meta.description
    return title, summary, extra


async def fetch_page_meta(session: aiohttp.ClientSession, url: str) -> PageMeta | None:
    try:
        got = await read_public_page(session, url)
    except Exception as e:  # noqa: BLE001
        logger.debug("page meta lookup failed for %s: %s", url, e)
        return None
    if got is None:
        return None
    return parse_page_meta(decode_page(got[0]))


async def fill_from_link(session: aiohttp.ClientSession, draft: NewsDraft, link: str) -> None:
    """Give a bare-link post the words its page carries."""
    if not is_bare_link(draft.title) and not is_bare_link(draft.summary):
        return
    meta = await fetch_page_meta(session, link)
    if meta is None:
        return
    title, summary, extra = describe(meta, draft.published_at, None)
    if not title:
        return
    draft.title = title[:500]
    draft.summary = summary
    draft.extra.update(extra)
    draft.extra["page_url"] = link
