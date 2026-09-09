"""A general games press site with no feed; its news search, newest first, is the list."""

from __future__ import annotations

import html
import logging
import re
from datetime import datetime, timedelta, timezone
from urllib.parse import quote, urljoin

import aiohttp

from app.services.news.drafts import NewsDraft
from app.services.news.text import clean_html, extract_og_image

logger = logging.getLogger(__name__)

LABEL = "Gamer"
SITE = "https://www.gamer.ne.jp/"
SEARCH_URL = SITE + "news/?word={word}"
# The search runs over article bodies, so one query per genre name in common use.
SEARCH_TERMS = ("美少女ゲーム", "ビジュアルノベル", "ノベルゲーム")
MAX_AGE = timedelta(days=7)
REQUEST_TIMEOUT = aiohttp.ClientTimeout(total=30)
JST = timezone(timedelta(hours=9))
# Page fetches for a social image are bounded; the list normally carries its own thumbnails.
OG_IMAGE_LIMIT = 5

_ITEM_START = re.compile(r'<div class="c-news-list__item')
_TITLE = re.compile(r'<h3 class="c-news-list__title">\s*<a href="([^"]+)"[^>]*>(.*?)</a>', re.S)
_TIME = re.compile(r"<time>\s*(\d{4})\.(\d{2})\.(\d{2}) (\d{2}):(\d{2})\s*</time>")
_CATEGORY = re.compile(r'class="c-news-cat[^"]*"[^>]*>(.*?)</a>', re.S)
_IMAGE = re.compile(r'<div class="c-news-list__image">.*?<img src="([^"]+)"', re.S)
_NEWS_ID = re.compile(r"/news/(\d+)/?$")


def parse_search(page: str, now: datetime) -> list[NewsDraft]:
    drafts: list[NewsDraft] = []
    for chunk in _ITEM_START.split(page)[1:]:
        title_m = _TITLE.search(chunk)
        time_m = _TIME.search(chunk)
        if not title_m or not time_m:
            continue
        href, raw_title = title_m.groups()
        url = urljoin(SITE, html.unescape(href))
        id_m = _NEWS_ID.search(url)
        if not id_m:
            continue
        y, mo, d, h, mi = (int(x) for x in time_m.groups())
        published = datetime(y, mo, d, h, mi, tzinfo=JST)
        if now - published > MAX_AGE:
            continue
        title = clean_html(raw_title)
        if not title:
            continue
        cat_m = _CATEGORY.search(chunk)
        img_m = _IMAGE.search(chunk)
        drafts.append(
            NewsDraft(
                source="rss",
                source_label=LABEL,
                key=f"gamer-{id_m.group(1)}",
                title=title[:500],
                url=url,
                image_url=html.unescape(img_m.group(1)) if img_m else None,
                published_at=published,
                tags=["news"],
                extra={
                    "feed_name": LABEL,
                    "lang": "ja",
                    "original_id": id_m.group(1),
                    **({"category": clean_html(cat_m.group(1))} if cat_m else {}),
                },
            )
        )
    return drafts


async def fetch_search(session: aiohttp.ClientSession, word: str, now: datetime) -> list[NewsDraft]:
    url = SEARCH_URL.format(word=quote(word))
    async with session.get(url, timeout=REQUEST_TIMEOUT) as resp:
        if resp.status != 200:
            logger.info("%s search %s returned %s", LABEL, word, resp.status)
            return []
        page = await resp.text()
    return parse_search(page, now)


async def fetch_all(session: aiohttp.ClientSession, now: datetime) -> list[NewsDraft]:
    # One host, one request at a time; the searches overlap, so the URL is the dedupe key.
    by_url: dict[str, NewsDraft] = {}
    for word in SEARCH_TERMS:
        try:
            batch = await fetch_search(session, word, now)
        except Exception as e:  # noqa: BLE001
            logger.error("%s search %s failed: %s", LABEL, word, e)
            continue
        for draft in batch:
            by_url.setdefault(draft.url, draft)
    drafts = sorted(by_url.values(), key=lambda d: d.published_at, reverse=True)
    looked_up = 0
    for draft in drafts:
        if draft.image_url or looked_up >= OG_IMAGE_LIMIT:
            continue
        draft.image_url = await extract_og_image(session, draft.url)
        looked_up += 1
    return drafts
