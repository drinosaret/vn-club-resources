"""Public author feeds from the AppView. No login, no key."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any

import aiohttp
from dateutil import parser as date_parser

from app.services.news.drafts import NewsDraft
from app.services.news.sources import BlueskyAccount
from app.services.news.linked import fill_from_link
from app.services.news.text import matches_keywords, post_title

logger = logging.getLogger(__name__)

FEED_URL = (
    "https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed"
    "?actor={handle}&limit=30&filter=posts_no_replies"
)
MAX_AGE = timedelta(days=7)
TITLE_LIMIT = 100
# Self-applied content labels; a search hit carrying one is adult promotion, not discussion.
_ADULT_LABELS = {"porn", "sexual", "nudity", "graphic-media"}


def _thumbnail(embed: dict[str, Any] | None) -> str | None:
    if not embed:
        return None
    kind = embed.get("$type", "")
    if kind == "app.bsky.embed.images#view":
        images = embed.get("images") or []
        return images[0].get("thumb") if images else None
    if kind == "app.bsky.embed.external#view":
        return (embed.get("external") or {}).get("thumb")
    if kind == "app.bsky.embed.recordWithMedia#view":
        return _thumbnail(embed.get("media"))
    return None


def _facet_links(record: dict[str, Any]) -> list[str]:
    links = []
    for facet in record.get("facets") or []:
        for feature in facet.get("features") or []:
            if feature.get("$type") == "app.bsky.richtext.facet#link" and feature.get("uri"):
                links.append(feature["uri"])
    return links


def draft_from_post(
    post: dict[str, Any],
    *,
    source: str,
    label: str,
    lang: str,
    now: datetime,
    include: list[str] | None = None,
    exclude: list[str] | None = None,
    links_only: bool = False,
    min_chars: int = 0,
    keep_avatar: bool = True,
    skip_labelled: bool = False,
) -> NewsDraft | None:
    """One post view as a row, or None when it is a reply or falls outside the filters."""
    record = post.get("record") or {}
    if record.get("reply"):
        return None
    if skip_labelled and any(l.get("val") in _ADULT_LABELS for l in post.get("labels") or []):
        return None
    text = (record.get("text") or "").strip()
    if not text or len(text) < min_chars or not matches_keywords(text, include, exclude):
        return None
    links = _facet_links(record)
    if links_only and not links:
        return None
    uri = post.get("uri") or ""
    rkey = uri.rsplit("/", 1)[-1]
    if not rkey:
        return None
    try:
        created = date_parser.parse(record.get("createdAt"))
    except (TypeError, ValueError):
        created = now
    if now - created > MAX_AGE:
        return None
    author = post.get("author") or {}
    handle = author.get("handle") or ""
    extra: dict[str, Any] = {
        "handle": handle,
        "uri": uri,
        "expanded_urls": links,
        "lang": lang,
    }
    if keep_avatar:
        extra["avatar_url"] = author.get("avatar")
    return NewsDraft(
        source=source,
        source_label=label,
        key=rkey,
        title=post_title(text, TITLE_LIMIT),
        summary=text[:500],
        url=f"https://bsky.app/profile/{handle}/post/{rkey}",
        image_url=_thumbnail(post.get("embed")),
        published_at=created,
        tags=["bluesky"],
        extra=extra,
    )


def parse_author_feed(
    payload: dict[str, Any], account: BlueskyAccount, now: datetime
) -> list[NewsDraft]:
    drafts: list[NewsDraft] = []
    for item in payload.get("feed") or []:
        if item.get("reason"):
            continue
        post = item.get("post") or {}
        if not (post.get("author") or {}).get("handle"):
            post = {**post, "author": {**(post.get("author") or {}), "handle": account.handle}}
        draft = draft_from_post(
            post,
            source=account.source,
            label=account.name,
            lang=account.lang,
            now=now,
            include=account.include,
            exclude=account.exclude,
            links_only=account.links_only,
        )
        if draft is not None:
            drafts.append(draft)
    return drafts


async def fetch_author_feed(
    session: aiohttp.ClientSession, account: BlueskyAccount, now: datetime
) -> list[NewsDraft]:
    url = FEED_URL.format(handle=account.handle)
    async with session.get(url, timeout=aiohttp.ClientTimeout(total=20)) as resp:
        if resp.status != 200:
            logger.warning("Bluesky %s returned %s", account.handle, resp.status)
            return []
        drafts = parse_author_feed(await resp.json(), account, now)
    for draft in drafts:
        links = [u for u in draft.extra.get("expanded_urls") or [] if "bsky.app" not in u]
        if links:
            await fill_from_link(session, draft, links[0])
    return drafts
