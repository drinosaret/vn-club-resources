"""Everything the aggregator reads, as a list a reader can see.

Built from the registries rather than kept by hand, so the list on the page is the list
of what is actually polled.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

from app.services.news.adapters.brandsites import BRAND_SITES
from app.services.news.adapters.gamer import SITE as GAMER_SITE
from app.services.news.adapters.kadokawa import OUTLETS
from app.services.news.sections import section_for_source
from app.services.news.sources import (
    BLUESKY_ACCOUNTS,
    BLUESKY_SEARCHES,
    BOARDS,
    CREATOR_ACCOUNTS,
    FOURCHAN_BOARD,
    RSS_FEEDS,
    X_ACCOUNTS,
    YOUTUBE_CHANNELS,
    JA,
    EN,
)

# Sources read through an API or a listing rather than a feed, with the page a reader
# would visit. Language is neither: their rows show under both sides of the switch.
FIXED_SOURCES: list[dict[str, Any]] = [
    {"name": "VNDB", "kind": "api", "url": "https://vndb.org/", "section": "recently-added"},
    {"name": "VNDB releases", "kind": "api", "url": "https://vndb.org/r", "section": "releases"},
    {"name": "VNDB reviews", "kind": "site", "url": "https://vndb.org/w", "section": "reviews"},
    {"name": "jiten.moe", "kind": "api", "url": "https://jiten.moe/", "section": "recently-added"},
    {"name": "Steam", "kind": "store", "url": "https://store.steampowered.com/", "section": "releases"},
    {"name": "Getchu", "kind": "store", "url": "https://www.getchu.com/", "section": "releases"},
    {"name": "DLsite", "kind": "store", "url": "https://www.dlsite.com/", "section": "releases"},
    {"name": "DiGiket", "kind": "store", "url": "https://www.digiket.com/", "section": "releases"},
    {"name": "BOOTH", "kind": "store", "url": "https://booth.pm/", "section": "releases"},
    {"name": "Melonbooks", "kind": "store", "url": "https://www.melonbooks.co.jp/", "section": "releases"},
    {"name": "ふりーむ！", "kind": "store", "url": "https://www.freem.ne.jp/", "section": "releases"},
    {
        "name": "萌えゲーアワード",
        "kind": "site",
        "url": "https://www.moe-gameaward.com/",
        "section": "headlines",
        "lang": JA,
    },
    {
        "name": "Gamer",
        "kind": "site",
        "url": GAMER_SITE,
        "section": "headlines",
        "lang": JA,
    },
    {
        "name": f"4chan /{FOURCHAN_BOARD}/",
        "kind": "board",
        "url": f"https://boards.4chan.org/{FOURCHAN_BOARD}/",
        "section": "community",
        "lang": EN,
    },
]


def _feed_site(url: str) -> str:
    """The page behind a feed address, for a reader who wants the outlet rather than XML."""
    for marker in ("/feed/", "/feed", "/rss/", "/rss", "/index.xml", "/atom.xml", "/index.rdf"):
        if url.endswith(marker):
            return url[: -len(marker)] + "/"
    return url


def list_sources() -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()

    def add(name: str, kind: str, url: str, section: str | None, lang: str | None) -> None:
        key = (kind, name)
        if key in seen or section is None:
            return
        seen.add(key)
        entries.append({"name": name, "kind": kind, "url": url, "section": section, "lang": lang})

    for feed in RSS_FEEDS:
        url = feed.url if feed.label_from_entry else _feed_site(feed.url)
        add(feed.name, "feed", url, section_for_source(feed.source), feed.lang)
    for outlet in OUTLETS:
        add(outlet.name, "site", outlet.url, "headlines", JA)
    for site in BRAND_SITES:
        add(site.name, "site", site.url.replace("{year}", ""), "headlines", site.lang)
    for channel in YOUTUBE_CHANNELS:
        add(channel.name, "youtube", f"https://www.youtube.com/channel/{channel.channel_id}", section_for_source(channel.source), channel.lang)
    for account in BLUESKY_ACCOUNTS:
        add(account.name, "bluesky", f"https://bsky.app/profile/{account.handle}", section_for_source(account.source), account.lang)
    for account in X_ACCOUNTS + CREATOR_ACCOUNTS:
        add(f"@{account.handle}", "x", f"https://x.com/{account.handle}", section_for_source(account.source), account.lang)
    for search in BLUESKY_SEARCHES:
        add(search.name, "bluesky", f"https://bsky.app/search?q={quote(search.query)}", section_for_source(search.source), search.lang)
    for board in BOARDS:
        add(board.name, "board", f"https://{board.host}/{board.board}/", "community", board.lang)
    for fixed in FIXED_SOURCES:
        add(fixed["name"], fixed["kind"], fixed["url"], fixed["section"], fixed.get("lang"))
    return entries
