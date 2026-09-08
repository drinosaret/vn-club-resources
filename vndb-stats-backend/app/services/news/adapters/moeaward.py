"""The award site's news list. Its feed is stale; the list page is current."""

from __future__ import annotations

import html
import logging
import re
from datetime import datetime, timezone

import aiohttp

from app.services.news.drafts import NewsDraft
from app.services.news.sources import MOEAWARD_NEWS_URL

logger = logging.getLogger(__name__)

LABEL = "萌えゲーアワード"
_ITEM = re.compile(
    r'<a href="(/news/index\.html\?id=(\d+))">\s*<p class="list-date">(\d{4})/(\d{2})/(\d{2})</p>'
    r'\s*<p class="list-text">(.*?)</p>',
    re.S,
)


def parse_news_list(page: str, now: datetime) -> list[NewsDraft]:
    drafts = []
    for path, news_id, y, m, d, text in _ITEM.findall(page):
        drafts.append(
            NewsDraft(
                source="rss",
                source_label=LABEL,
                key=f"moeaward-{news_id}",
                title=html.unescape(re.sub(r"<[^>]+>", "", text)).strip()[:500],
                url="https://www.moe-gameaward.com" + path,
                published_at=datetime(int(y), int(m), int(d), tzinfo=timezone.utc),
                tags=["news"],
                extra={"feed_name": LABEL, "original_id": news_id, "lang": "ja"},
            )
        )
    return drafts


async def fetch_news(session: aiohttp.ClientSession, now: datetime) -> list[NewsDraft]:
    async with session.get(MOEAWARD_NEWS_URL, timeout=aiohttp.ClientTimeout(total=20)) as resp:
        if resp.status != 200:
            logger.warning("moeaward returned %s", resp.status)
            return []
        return parse_news_list(await resp.text(), now)
