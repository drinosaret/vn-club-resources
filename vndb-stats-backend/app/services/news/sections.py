"""How sources group into the pages a reader sees. Derived in code, never stored."""

from datetime import timedelta

# How long a release counts as out now: the page shows this much, and the stores and the
# catalogue are read this far back on every run, so a missed run leaves no gap.
OUT_NOW_WINDOW = timedelta(days=30)

# Insertion order is the reader-facing tab order; the frontend's tab list and the rail's
# Elsewhere panel both follow it.
SECTIONS: dict[str, tuple[str, ...]] = {
    "headlines": ("rss", "twitter", "bluesky", "announcement"),
    "reviews": ("vndb_review", "review"),
    "releases": ("vndb_release", "steam", "dlsite", "getchu", "digiket", "booth", "melonbooks", "freem"),
    "community": ("note", "hatena", "forum", "reddit", "board", "chan", "bsky_search"),
    "creators": ("creator",),
    "recently-added": ("vndb", "jiten"),
    "trailers": ("youtube",),
}

# Store rows that describe one catalogue title and carry its cover.
STORE_SOURCES = ("steam", "dlsite", "getchu", "digiket", "booth", "melonbooks", "freem")

# The rankings snapshot the storefront job writes and the API reads back.
DLSITE_RANKINGS_KEY = "news:dlsite:rankings"
DLSITE_RANKINGS_TTL = 3 * 24 * 3600
GETCHU_RANKINGS_KEY = "news:getchu:rankings"


def section_sources(slug: str) -> tuple[str, ...]:
    return SECTIONS[slug]


def section_for_source(source: str) -> str | None:
    for slug, sources in SECTIONS.items():
        if source in sources:
            return slug
    return None
