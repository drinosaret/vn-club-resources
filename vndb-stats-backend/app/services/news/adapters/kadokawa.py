"""Two press sites on one Next.js stack; the category page's embedded data is the list.

Neither outlet publishes a feed for its PC-game category. The page ships the same list
it renders as JSON, so the data is read from there rather than from the markup.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import aiohttp

from app.services.news.drafts import NewsDraft
from app.services.news.sources import OTHER_GENRES, VN_TERMS
from app.services.news.text import clean_html, matches_keywords

logger = logging.getLogger(__name__)

MAX_AGE = timedelta(days=7)
REQUEST_TIMEOUT = aiohttp.ClientTimeout(total=30)
JST = timezone(timedelta(hours=9))
_NEXT_DATA = re.compile(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', re.S)
_ARTICLE_ID = re.compile(r"/article/\d{6}/(\d+)")


@dataclass(frozen=True)
class Outlet:
    name: str
    slug: str
    url: str
    # The list under `props.pageProps`.
    list_key: str
    # Article pages sit under the month of publication; `ym` is YYYYMM.
    article_url: str

    @property
    def article_prefix(self) -> str:
        return self.article_url.split("{ym}", 1)[0]


OUTLETS = (
    Outlet(
        "ファミ通.com",
        "famitsu",
        "https://www.famitsu.com/category/pc-game/page/1",
        "categoryArticleDataForPc",
        "https://www.famitsu.com/article/{ym}/{id}",
    ),
    Outlet(
        "電撃オンライン",
        "dengeki",
        "https://dengekionline.com/category/pc-game/page/1",
        "articleListData",
        "https://dengekionline.com/article/{ym}/{id}",
    ),
)


def _published(raw) -> datetime | None:
    if not raw or not isinstance(raw, str):
        return None
    try:
        dt = datetime.fromisoformat(raw)
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=JST)


def _article(outlet: Outlet, item: dict, published: datetime) -> tuple[str, str]:
    """The page to link and the id to key on.

    A row may be an alias that redirects to another article on the same host; keying on
    the target keeps the alias and the target from becoming two rows.
    """
    redirect = item.get("redirectUrl") or ""
    if isinstance(redirect, str) and redirect.startswith(outlet.article_prefix):
        m = _ARTICLE_ID.search(redirect)
        if m:
            return redirect, m.group(1)
    article_id = str(item["id"])
    return outlet.article_url.format(ym=published.astimezone(JST).strftime("%Y%m"), id=article_id), article_id


def parse_page(page: str, outlet: Outlet, now: datetime) -> list[NewsDraft]:
    m = _NEXT_DATA.search(page)
    if not m:
        logger.warning("%s page carries no embedded data", outlet.name)
        return []
    try:
        items = json.loads(m.group(1))["props"]["pageProps"][outlet.list_key]
    except (ValueError, KeyError, TypeError) as e:
        logger.warning("%s embedded data unreadable: %s", outlet.name, e)
        return []
    drafts: list[NewsDraft] = []
    for item in items:
        if not isinstance(item, dict) or item.get("isPr"):
            continue
        # Promotional slots share the list and have no date or article id of their own.
        published = _published(item.get("publishedAt"))
        if not published or not item.get("id"):
            continue
        if now - published > MAX_AGE:
            continue
        title = clean_html(item.get("title"))
        description = clean_html(item.get("description"))
        if not title or not matches_keywords(f"{title} {description}", VN_TERMS, OTHER_GENRES):
            continue
        url, article_id = _article(outlet, item, published)
        drafts.append(
            NewsDraft(
                source="rss",
                source_label=outlet.name,
                key=f"{outlet.slug}-{article_id}",
                title=title[:500],
                summary=description[:500] or None,
                url=url,
                image_url=item.get("thumbnailUrl") or None,
                published_at=published,
                tags=["news"],
                extra={"feed_name": outlet.name, "lang": "ja", "original_id": str(item["id"])},
            )
        )
    drafts.sort(key=lambda d: d.published_at, reverse=True)
    return drafts


async def fetch_outlet(session: aiohttp.ClientSession, outlet: Outlet, now: datetime) -> list[NewsDraft]:
    async with session.get(outlet.url, timeout=REQUEST_TIMEOUT) as resp:
        if resp.status != 200:
            logger.warning("%s returned %s", outlet.name, resp.status)
            return []
        page = await resp.text()
    return parse_page(page, outlet, now)


async def fetch_all(session: aiohttp.ClientSession, now: datetime) -> list[NewsDraft]:
    results = await asyncio.gather(*[fetch_outlet(session, o, now) for o in OUTLETS], return_exceptions=True)
    drafts: list[NewsDraft] = []
    for outlet, result in zip(OUTLETS, results):
        if isinstance(result, BaseException):
            logger.error("%s failed: %s", outlet.name, result)
            continue
        drafts.extend(result)
    return drafts
