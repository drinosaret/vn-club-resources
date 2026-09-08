"""Public timelines through the FxTwitter API, which needs no account or key.

A third-party service without a guarantee: any error means no new posts this run, and the
section fills from the other sources.
"""

from __future__ import annotations

import html
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlparse

import aiohttp

from app.services.news.drafts import NewsDraft
from app.services.news.sources import CREATOR_EXCLUDE, XAccount
from app.services.news.linked import fill_from_link
from app.services.news.text import extract_og_image, matches_keywords, post_title

logger = logging.getLogger(__name__)

STATUSES_URL = "https://api.fxtwitter.com/2/profile/{handle}/statuses?count=20"
# Links back into the network need a login to render, so they carry no usable page image.
_NETWORK_HOSTS = ("x.com", "twitter.com", "t.co", "bsky.app")
MAX_AGE = timedelta(days=7)
TITLE_LIMIT = 100
_TCO = re.compile(r"https?://t\.co/\S+")
# A creator's timeline is mostly daily life. A post with nothing to open and nothing to
# say is not news, so one is kept only when it carries a link, a picture, or words of its
# own; a tag or a name addressed to someone is not words of its own.
CREATOR_MIN_CHARS = 40
_TAG_OR_MENTION = re.compile(r"[@#＠＃][^\s#＃@＠]+")
USER_AGENT = "VN-Club-Resources/1.0 (news aggregator; +https://vnclub.org)"


def _expanded_text(status: dict[str, Any]) -> tuple[str, list[str]]:
    """Post text with each shortened link replaced by its target, and the targets.

    The service delivers the text with its markup characters escaped. Rows hold plain
    text, and the page escapes again when it renders, so the escaping is undone here.
    """
    raw = status.get("raw_text") or {}
    text = raw.get("text") or status.get("text") or ""
    urls: list[str] = []
    for facet in raw.get("facets") or []:
        if facet.get("type") == "url" and facet.get("original") and facet.get("replacement"):
            text = text.replace(facet["original"], facet["replacement"])
            urls.append(facet["replacement"])
    text = _TCO.sub("", text)
    text = html.unescape(text)
    return re.sub(r"[ \t]+\n", "\n", text).strip(), urls


def has_substance(text: str, urls: list[str], image: str | None) -> bool:
    """Whether a post carries something to open or something to say."""
    if urls or image:
        return True
    return len(_TAG_OR_MENTION.sub("", text).strip()) >= CREATOR_MIN_CHARS


def parse_statuses(payload: dict[str, Any], account: XAccount, now: datetime) -> list[NewsDraft]:
    drafts: list[NewsDraft] = []
    for status in payload.get("results") or []:
        if status.get("reposted_by") or status.get("replying_to"):
            continue
        text, urls = _expanded_text(status)
        if not text:
            continue
        if not matches_keywords(f"{text} {' '.join(urls)}", account.include, account.exclude):
            continue
        if account.links_only and not urls:
            continue
        ts = status.get("created_timestamp")
        created = datetime.fromtimestamp(ts, tz=timezone.utc) if ts else now
        if now - created > MAX_AGE:
            continue
        author = status.get("author") or {}
        handle = author.get("screen_name") or account.handle
        status_id = str(status.get("id") or "")
        if not status_id:
            continue
        image = None
        if not account.exclude_images:
            media = (status.get("media") or {}).get("all") or []
            photos = [m.get("url") for m in media if m.get("type") == "photo" and m.get("url")]
            image = photos[0] if photos else None
        if account.source == "creator":
            if not matches_keywords(text, None, CREATOR_EXCLUDE):
                continue
            if not has_substance(text, urls, image):
                continue
        drafts.append(
            NewsDraft(
                source=account.source,
                source_label=f"@{handle}",
                key=status_id,
                title=post_title(text, TITLE_LIMIT),
                summary=text[:500],
                url=status.get("url") or f"https://x.com/{handle}/status/{status_id}",
                image_url=image,
                image_is_nsfw=account.nsfw_images,
                published_at=created,
                tags=["twitter"],
                extra={
                    "tweet_id": status_id,
                    "username": handle,
                    "expanded_urls": urls,
                    # The account's mark stands in for a post that brought no picture.
                    "avatar_url": author.get("avatar_url"),
                    "lang": account.lang,
                },
            )
        )
    return drafts


def page_link(urls: list[str]) -> str | None:
    """The first link that points at a page of its own rather than back into a network."""
    for url in urls:
        host = urlparse(url).hostname or ""
        if host.startswith("www."):
            host = host[4:]
        if host and host not in _NETWORK_HOSTS:
            return url
    return None


async def fetch_statuses(
    session: aiohttp.ClientSession, account: XAccount, now: datetime
) -> list[NewsDraft]:
    url = STATUSES_URL.format(handle=account.handle)
    headers = {"User-Agent": USER_AGENT}
    async with session.get(url, headers=headers, timeout=aiohttp.ClientTimeout(total=20)) as resp:
        if resp.status == 204:
            return []
        if resp.status != 200:
            logger.warning("FxTwitter %s returned %s", account.handle, resp.status)
            return []
        drafts = parse_statuses(await resp.json(content_type=None), account, now)
    for draft in drafts:
        link = page_link(draft.extra.get("expanded_urls") or [])
        if not link:
            continue
        # A post that is only its link takes its words from the page.
        await fill_from_link(session, draft, link)
        if account.link_images and not draft.image_url:
            draft.image_url = await extract_og_image(session, link)
    return drafts
