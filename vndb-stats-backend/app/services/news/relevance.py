"""Whether a post from a loose source is about this medium at all.

Boards, community feeds and broad-scope accounts carry the scene's conversation and a
good deal beside it. A post files when something in it ties it to the medium: a term for
the medium, a work or producer the catalogue records, or a link to a place that only
sells or catalogues these works. Nothing else places a post, so one that offers none of
the three is left out.
"""

from __future__ import annotations

import logging
import re
from urllib.parse import urlparse

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.news.sources import VN_TERMS_EN, VN_TERMS_JA
from app.services.news.text import matches_keywords

logger = logging.getLogger(__name__)

VN_TERMS = list(VN_TERMS_EN) + list(VN_TERMS_JA)

# A title written in Japanese script is distinctive at a shorter length than a Latin one,
# and sits in running text without spaces around it, so no word edge is asserted for it.
MIN_JA_TITLE_LENGTH = 5
MIN_LATIN_TITLE_LENGTH = 10
# Enough Latin candidates to judge; a text matching more than this names plenty already.
LATIN_CANDIDATES = 10

_JA_SCRIPT = re.compile(r"[぀-ヿ一-鿿]")
# The same class as a Postgres bracket expression, for the query that asks for it.
_JA_SQL_CLASS = "[぀-ヿ一-鿿]"

# Places that carry only these works, so a link to one places the post that carries it.
VN_HOSTS = (
    "vndb.org",
    "dlsite.com",
    "getchu.com",
    "erogamescape",
    "store.steampowered.com",
    "digiket.com",
    "melonbooks.co.jp",
    "booth.pm",
    "freem.ne.jp",
)

_TITLE_FAMILIES = (
    "SELECT vn.title AS candidate FROM visual_novels vn"
    " WHERE vn.olang = 'ja' AND {cond}",
    "SELECT vn.title_romaji AS candidate FROM visual_novels vn"
    " WHERE vn.olang = 'ja' AND {cond}",
    "SELECT alias AS candidate FROM visual_novels vn, unnest(vn.aliases) AS alias"
    " WHERE vn.olang = 'ja' AND {cond}",
    "SELECT p.name AS candidate FROM producers p WHERE {cond}",
    "SELECT p.original AS candidate FROM producers p WHERE {cond}",
)
_COLUMNS = ("vn.title", "vn.title_romaji", "alias", "p.name", "p.original")

_JA_COND = (
    "{col} IS NOT NULL AND length({col}) >= :min_length"
    " AND {col} ~ :ja_class AND position(lower({col}) in lower(:body)) > 0"
)
_LATIN_COND = (
    "{col} IS NOT NULL AND length({col}) >= :min_length"
    " AND position(' ' in {col}) > 0 AND {col} !~ :ja_class"
    " AND position(lower({col}) in lower(:body)) > 0"
)


def _union(cond: str, limit: int) -> str:
    parts = [
        family.format(cond=cond.format(col=col))
        for family, col in zip(_TITLE_FAMILIES, _COLUMNS)
    ]
    return " UNION ALL ".join(parts) + f" LIMIT {limit}"


_JA_QUERY = _union(_JA_COND, 1)
_LATIN_QUERY = _union(_LATIN_COND, LATIN_CANDIDATES)


def has_japanese(value: str) -> bool:
    return bool(_JA_SCRIPT.search(value or ""))


def names_vn_term(body: str) -> bool:
    """Whether a term for the medium appears, short Latin ones as whole words."""
    return matches_keywords(body, VN_TERMS, None)


def links_vn_host(links) -> bool:
    for link in links or []:
        if not isinstance(link, str):
            continue
        host = (urlparse(link).hostname or "").lower()
        if not host:
            continue
        if any(h in host for h in VN_HOSTS):
            return True
    return False


def _stands_alone(candidate: str, body: str) -> bool:
    left = r"\b" if candidate[:1].isalnum() else ""
    right = r"\b" if candidate[-1:].isalnum() else ""
    return re.search(left + re.escape(candidate) + right, body, re.I) is not None


async def names_catalogue_entry(db: AsyncSession, body: str) -> bool:
    """Whether the text names a Japanese-original work or a producer the catalogue holds."""
    if not body or len(body) < MIN_JA_TITLE_LENGTH:
        return False
    if has_japanese(body):
        row = (
            await db.execute(
                text(_JA_QUERY),
                {"body": body, "min_length": MIN_JA_TITLE_LENGTH, "ja_class": _JA_SQL_CLASS},
            )
        ).first()
        if row is not None:
            return True
    rows = (
        await db.execute(
            text(_LATIN_QUERY),
            {"body": body, "min_length": MIN_LATIN_TITLE_LENGTH, "ja_class": _JA_SQL_CLASS},
        )
    ).all()
    return any(r.candidate and _stands_alone(r.candidate, body) for r in rows)


async def is_vn_related(db: AsyncSession, body: str, *, links: list[str] = ()) -> bool:
    """Whether a post from a loose source belongs in the feed.

    The two cheap tests run first; the catalogue is asked only when neither placed it.
    """
    if not body and not links:
        return False
    if names_vn_term(body or ""):
        return True
    if links_vn_host(links):
        return True
    return await names_catalogue_entry(db, body or "")
