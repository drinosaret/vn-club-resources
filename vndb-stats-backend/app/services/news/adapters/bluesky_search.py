"""Post search on the network, for what readers say rather than what accounts announce.

Hits are strangers' posts: the row keeps the handle and the text, never the avatar.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any
from urllib.parse import quote

import aiohttp

from app.services.news.adapters.bluesky import draft_from_post
from app.services.news.drafts import NewsDraft
from app.services.news.sources import BlueskySearch

logger = logging.getLogger(__name__)

# The unauthenticated AppView host answers this method; the public mirror refuses it.
SEARCH_URL = "https://api.bsky.app/xrpc/app.bsky.feed.searchPosts?q={q}&sort=latest&limit=25"
_LANGS = ("ja", "en")


def parse_search(payload: dict[str, Any], search: BlueskySearch, now: datetime) -> list[NewsDraft]:
    drafts: list[NewsDraft] = []
    for post in payload.get("posts") or []:
        langs = (post.get("record") or {}).get("langs") or []
        lang = langs[0] if langs and langs[0] in _LANGS else search.lang
        draft = draft_from_post(
            post,
            source=search.source,
            label=search.name,
            lang=lang,
            now=now,
            exclude=search.exclude,
            min_chars=search.min_chars,
            keep_avatar=False,
            skip_labelled=True,
        )
        if draft is None:
            continue
        links = draft.extra.get("expanded_urls") or []
        if any(host in link for link in links for host in search.exclude_hosts):
            continue
        draft.extra["query"] = search.query
        drafts.append(draft)
        if len(drafts) >= search.max_items:
            break
    return drafts


async def fetch_search(session: aiohttp.ClientSession, search: BlueskySearch, now: datetime) -> list[NewsDraft]:
    url = SEARCH_URL.format(q=quote(search.query))
    async with session.get(url, timeout=aiohttp.ClientTimeout(total=20)) as resp:
        if resp.status != 200:
            logger.warning("Bluesky search %r returned %s", search.query, resp.status)
            return []
        payload = await resp.json(content_type=None)
    return parse_search(payload, search, now)
