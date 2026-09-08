"""feedparser-backed adapter for press feeds."""

from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone

import aiohttp
import feedparser
from dateutil import parser as date_parser

from app.services.news.drafts import NewsDraft
from app.services.news.sources import RssFeed, canonical_outlet
from app.services.news.text import clean_html, extract_og_image, matches_keywords

# Some feeds append a rights notice to every description; it is not part of the article.
_FOOTER = re.compile(r"\s*(?:\.\.\.\s*)?Copyright\s*©.*$", re.S)
# A forum's feed numbers each post within its thread at the end of the title.
_POST_NUMBER = re.compile(r"\s*\(#\d+\)\s*$")
# A forum's feed wraps each post in a byline and link trailer that is not the post.
_FORUM_TRAILER = re.compile(r"\s*submitted by\s+/u/\S+.*$", re.S)
# A platform's excerpt ends in its own "read more" link text.
_READ_MORE = re.compile(r"\s*続きをみる\s*$")

logger = logging.getLogger(__name__)

MAX_AGE = timedelta(days=7)
REQUEST_TIMEOUT = aiohttp.ClientTimeout(total=30)
# A search feed also relays video listings, which are not articles.
_SKIP_OUTLETS = {"YouTube", "t.co"}


def entry_time(entry) -> datetime | None:
    raw = entry.get("published") or entry.get("updated")
    if not raw:
        return None
    try:
        dt = date_parser.parse(raw)
    except (ValueError, OverflowError, TypeError):
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _secure(url: str) -> str:
    """The site serves pictures over https only, and feeds still print plain addresses."""
    return "https://" + url[7:] if url.startswith("http://") else url


def _entry_image(entry) -> str | None:
    """A picture the feed itself carries, before any page fetch."""
    for group in (entry.get("media_thumbnail") or [], entry.get("media_content") or []):
        for media in group:
            url = media.get("url")
            if url and (not media.get("medium") or media.get("medium") == "image"):
                return _secure(url)
    for enclosure in entry.get("enclosures") or []:
        if str(enclosure.get("type", "")).startswith("image/") and enclosure.get("href"):
            return _secure(enclosure["href"])
    return None


def _entry_creator(entry) -> str | None:
    """The writer a platform names on each entry, when it names one."""
    for key in ("note_creatorname", "author"):
        value = entry.get(key)
        if isinstance(value, str) and value.strip():
            return clean_html(value)[:100]
    return None


def _entry_label(entry, feed: RssFeed) -> tuple[str, str, str | None]:
    """The label for a row, the title without a trailing outlet name, and the outlet's site."""
    title = clean_html(entry.get("title", ""))
    if not feed.label_from_entry:
        return feed.name, title, None
    source = entry.get("source") or {}
    outlet = clean_html(source.get("title") or "")
    if outlet and title.endswith(f" - {outlet}"):
        title = title[: -len(outlet) - 3].rstrip()
    return canonical_outlet(outlet) if outlet else feed.name, title, source.get("href") or source.get("url") or None


def _matches_category(entry, terms: list[str]) -> bool:
    """Whether any of the entry's categories carries one of the terms."""
    tags = [str(t.get("term") or "").lower() for t in entry.get("tags") or []]
    return any(term.lower() in tag for tag in tags for term in terms)


def _wrong_category(entry, feed: RssFeed) -> bool:
    """Whether the entry's categories put it outside what the feed is read for."""
    if feed.include_categories and not _matches_category(entry, feed.include_categories):
        return True
    return bool(feed.exclude_categories) and _matches_category(entry, feed.exclude_categories)


def parse_feed(payload: str, feed: RssFeed, now: datetime) -> list[NewsDraft]:
    parsed = feedparser.parse(payload)
    key_pattern = re.compile(feed.key_pattern) if feed.key_pattern else None
    title_pattern = re.compile(feed.title_pattern) if feed.title_pattern else None
    title_exclude = re.compile(feed.title_exclude_pattern) if feed.title_exclude_pattern else None
    summary_exclude = (
        re.compile(feed.summary_exclude_pattern) if feed.summary_exclude_pattern else None
    )
    feed_title = clean_html(parsed.feed.get("title") or "")
    drafts: list[NewsDraft] = []
    for entry in parsed.entries:
        key = entry.get("id") or entry.get("link") or entry.get("guid")
        if not key or (key_pattern and not key_pattern.search(key)):
            continue
        label, title, outlet_site = _entry_label(entry, feed)
        if label in _SKIP_OUTLETS:
            continue
        if feed.source == "forum":
            title = _POST_NUMBER.sub("", title)
        # A search feed repeats its own title as a first, linkless entry.
        if not entry.get("link") or (feed_title and title == feed_title):
            continue
        if title_pattern and not title_pattern.search(title):
            continue
        if title_exclude and title_exclude.search(title):
            continue
        if _wrong_category(entry, feed):
            continue
        # A relayed entry's description is its title and outlet again.
        description = "" if feed.label_from_entry else clean_html(entry.get("description") or entry.get("summary") or "")
        description = _READ_MORE.sub("", _FORUM_TRAILER.sub("", _FOOTER.sub("", description)))
        if summary_exclude and summary_exclude.search(description):
            continue
        if not matches_keywords(f"{title} {description}", feed.include, feed.exclude):
            continue
        published = entry_time(entry)
        if published and now - published > MAX_AGE:
            continue
        creator = _entry_creator(entry)
        drafts.append(
            NewsDraft(
                source=feed.source,
                source_label=label,
                key=key,
                title=title[:500],
                summary=description[:500] or None,
                url=entry.get("link") or None,
                image_url=_entry_image(entry),
                # The picture is fetched afterwards; the flag says how to show it when it is.
                image_is_nsfw=feed.nsfw_images,
                published_at=published or now,
                tags=["news"],
                extra={
                    "feed_name": feed.name,
                    "original_id": key,
                    "lang": feed.lang,
                    **({"broad": True} if feed.broad else {}),
                    **({"creator": creator} if creator else {}),
                    # The outlet's own site, so the row can wear its mark; the entry's link
                    # is a redirector on the relay's host.
                    **({"expanded_urls": [outlet_site]} if outlet_site else {}),
                },
            )
        )
    drafts.sort(key=lambda d: d.published_at, reverse=True)
    return drafts[: feed.max_items]


async def fetch_feed(session: aiohttp.ClientSession, feed: RssFeed, now: datetime) -> list[NewsDraft]:
    async with session.get(feed.url, timeout=REQUEST_TIMEOUT, headers=feed.headers) as resp:
        if resp.status != 200:
            logger.warning("RSS %s returned %s", feed.name, resp.status)
            return []
        payload = await resp.text()
    drafts = parse_feed(payload, feed, now)
    for draft in drafts:
        # A search feed's links are redirectors with no page image of their own.
        if draft.url and not draft.image_url and not feed.label_from_entry:
            draft.image_url = await extract_og_image(session, draft.url)
    return drafts
