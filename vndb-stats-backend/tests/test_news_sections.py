from app.services.news.sections import SECTIONS, section_for_source, section_sources
from app.services.news.sources import (
    BLUESKY_ACCOUNTS,
    BOARDS,
    COMMUNITY_SOURCES,
    CREATOR_ACCOUNTS,
    RSS_FEEDS,
    X_ACCOUNTS,
    YOUTUBE_CHANNELS,
)


def test_every_source_belongs_to_exactly_one_section():
    seen = {}
    for slug in SECTIONS:
        for src in section_sources(slug):
            assert src not in seen, f"{src} in both {seen[src]} and {slug}"
            seen[src] = slug
    for src in (
        "vndb", "vndb_release", "rss", "twitter", "bluesky", "youtube", "steam", "dlsite",
        "announcement", "getchu", "digiket", "booth", "melonbooks", "freem", "creator",
        "note", "hatena", "forum", "reddit", "board", "chan", "jiten", "vndb_review", "review",
        "bsky_search",
    ):
        assert section_for_source(src) in SECTIONS


def test_registry_sources_all_have_a_section():
    for feed in RSS_FEEDS:
        assert section_for_source(feed.source), feed.name
    for acct in X_ACCOUNTS + CREATOR_ACCOUNTS:
        assert section_for_source(acct.source), acct.handle
    assert section_for_source("board") == "community"
    assert section_for_source("dlsite") == "releases" == section_for_source("booth")
    assert section_for_source("creator") == "creators"
    assert section_for_source("review") == "reviews" == section_for_source("vndb_review")
    assert all(src in section_sources("community") for src in COMMUNITY_SOURCES)


def test_registry_entries_are_well_formed():
    assert all(f.url.startswith(("https://", "http://")) for f in RSS_FEEDS)
    assert len({a.handle.lower() for a in X_ACCOUNTS + CREATOR_ACCOUNTS}) == len(X_ACCOUNTS + CREATOR_ACCOUNTS)
    assert len({c.channel_id for c in YOUTUBE_CHANNELS}) == len(YOUTUBE_CHANNELS)
    assert all(b.host and b.board and b.name for b in BOARDS)
    assert all(not a.handle.startswith("@") and a.source == "creator" for a in CREATOR_ACCOUNTS)
    assert all(c.channel_id.startswith("UC") and len(c.channel_id) == 24 for c in YOUTUBE_CHANNELS)
    assert all("." in a.handle for a in BLUESKY_ACCOUNTS)
    assert all(not a.handle.startswith("@") for a in X_ACCOUNTS)
