"""Plain text out of the markup VNDB descriptions carry.

Mirrors the frontend stripper step for step and in the same order, so a description reduced
here and one reduced there do not differ. A change to either belongs in both.

Descriptions are reduced on this side because the layout that shows them asks for a page of
them at once and renders a few lines of each. Sending whole blobs so the browser can throw
most of each away spends bandwidth on text nobody reads.
"""

import re

# How much of a description is read out of the database. Bounds what a page of them costs
# before any of it reaches the application, which matters more than the saving on any one row.
BLURB_SOURCE_CHARS = 1200

# How much survives, chosen to fill the few lines the layout clamps to.
BLURB_CHARS = 300

_SPOILER = re.compile(r"\[spoiler\][\s\S]*?\[/?spoiler\]", re.IGNORECASE)
_OPEN_SPOILER = re.compile(r"\[spoiler\][\s\S]*$", re.IGNORECASE)
_URL = re.compile(r"\[url=[^\]]+\]([^\[]*)\[/url\]", re.IGNORECASE)
_TAG = re.compile(r"\[/?[a-zA-Z]+(?:=[^\]]+)?\]")
_BLANK_RUN = re.compile(r"\n{3,}")
_WHITESPACE = re.compile(r"\s+")

# Punctuation a cut can land on, which reads as a typo rather than as an ellipsis.
_TRAILING = " \t\n,;:.-–—"


def strip_bbcode(text: str) -> str:
    """Markup removed, leaving the words."""
    result = text.replace("\\n", "\n")
    result = _SPOILER.sub("", result)
    # A description is cut before it is stripped, so a spoiler block can lose its closing tag
    # on the way here. The paired pattern needs both and would leave the remainder standing.
    result = _OPEN_SPOILER.sub("", result)
    result = _URL.sub(r"\1", result)
    result = _TAG.sub("", result)
    result = _BLANK_RUN.sub("\n\n", result)
    return result.strip()


def plain_summary(text: str | None, limit: int = BLURB_CHARS) -> str | None:
    """One run of plain text, no longer than `limit`, cut on a word boundary.

    Returns None for a description that is empty once the markup is gone, which a caller
    renders as a title without one rather than as an empty line.
    """
    if not text:
        return None

    stripped = _WHITESPACE.sub(" ", strip_bbcode(text)).strip()
    if not stripped:
        return None
    if len(stripped) <= limit:
        return stripped

    cut = stripped[:limit]
    boundary = cut.rfind(" ")
    if boundary > 0:
        cut = cut[:boundary]
    return cut.rstrip(_TRAILING) + "…"
