"""Channel upload feeds. One request per channel, no key."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta

import aiohttp
import feedparser

from app.services.news.adapters.rss import entry_time
from app.services.news.drafts import NewsDraft
from app.services.news.sources import YouTubeChannel

logger = logging.getLogger(__name__)

FEED_URL = "https://www.youtube.com/feeds/videos.xml?channel_id={id}"
MAX_AGE = timedelta(days=14)
# The feed carries no duration, so a short is known only by the tag its title wears.
SHORTS_TAG = "#shorts"


def parse_channel_feed(payload: str, channel: YouTubeChannel, now: datetime) -> list[NewsDraft]:
    parsed = feedparser.parse(payload)
    drafts: list[NewsDraft] = []
    for entry in parsed.entries:
        video_id = entry.get("yt_videoid")
        if not video_id:
            continue
        title = entry.get("title") or ""
        if SHORTS_TAG in title.lower():
            continue
        published = entry_time(entry) or now
        if now - published > MAX_AGE:
            continue
        drafts.append(
            NewsDraft(
                source=channel.source,
                source_label=channel.name,
                key=video_id,
                title=title[:500],
                url=f"https://www.youtube.com/watch?v={video_id}",
                # The feed names one of several thumbnail hosts; the canonical one serves
                # them all, and it is the one the image proxy allows.
                image_url=f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
                published_at=published,
                tags=["trailer"] if channel.source == "youtube" else ["review"],
                extra={"channel_id": channel.channel_id, "channel": channel.name, "lang": channel.lang},
            )
        )
    return drafts


async def fetch_channel(
    session: aiohttp.ClientSession, channel: YouTubeChannel, now: datetime
) -> list[NewsDraft]:
    url = FEED_URL.format(id=channel.channel_id)
    async with session.get(url, timeout=aiohttp.ClientTimeout(total=20)) as resp:
        if resp.status != 200:
            logger.warning("YouTube feed %s returned %s", channel.name, resp.status)
            return []
        return parse_channel_feed(await resp.text(), channel, now)
