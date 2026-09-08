"""A storefront listing becomes news only when it is a Japanese-original VN the catalogue knows."""

from __future__ import annotations

import re

from dataclasses import dataclass

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import (
    ExtlinksMaster,
    Producer,
    ReleaseExtlink,
    ReleaseProducer,
    ReleaseVN,
    VisualNovel,
)


MAX_DEVELOPERS = 3


@dataclass(frozen=True)
class MatchedVN:
    id: str
    title: str
    title_jp: str | None
    title_romaji: str | None
    image_url: str | None
    image_sexual: float | None
    minage: int | None
    # The same producers in the same order, romanised and as written.
    developers: list[str]
    developers_original: list[str]


# A catalogue title only stands in for a work when it is long enough, and made of enough
# words, that ordinary prose cannot contain it by accident.
MIN_TITLE_LENGTH = 10
# More than one candidate is read per family so a hit that turns out to sit inside a
# longer word does not hide a shorter title that stands on its own.
CANDIDATES_PER_FAMILY = 5

_ORIGIN_CONDITIONS = """
    vn.olang IS NOT NULL
    AND length({col}) >= :min_length
    AND position(' ' in {col}) > 0
    AND position(lower({col}) in lower(:body)) > 0
"""
_ORIGIN_QUERIES = (
    "SELECT vn.title AS candidate, array_agg(DISTINCT vn.olang) AS olangs"
    " FROM visual_novels vn WHERE "
    + _ORIGIN_CONDITIONS.format(col="vn.title")
    + " GROUP BY vn.title ORDER BY length(vn.title) DESC LIMIT :per_family",
    "SELECT vn.title_romaji AS candidate, array_agg(DISTINCT vn.olang) AS olangs"
    " FROM visual_novels vn WHERE "
    + _ORIGIN_CONDITIONS.format(col="vn.title_romaji")
    + " GROUP BY vn.title_romaji ORDER BY length(vn.title_romaji) DESC LIMIT :per_family",
    "SELECT alias AS candidate, array_agg(DISTINCT vn.olang) AS olangs"
    " FROM visual_novels vn, unnest(vn.aliases) AS alias WHERE "
    + _ORIGIN_CONDITIONS.format(col="alias")
    + " GROUP BY alias ORDER BY length(alias) DESC LIMIT :per_family",
)


def _stands_alone(candidate: str, body: str, *, as_written: bool = False) -> bool:
    """Whether the title appears as itself rather than inside a longer word.

    The boundary is asserted only at an end that is a word character; a title that opens
    or closes on punctuation has no word edge to assert there. With `as_written`, a Latin
    title must also keep the capitalisation the catalogue gives it: a short title made of
    everyday words otherwise turns up inside plain prose.
    """
    left = r"\b" if candidate[:1].isalnum() else ""
    right = r"\b" if candidate[-1:].isalnum() else ""
    flags = 0 if as_written and re.search(r"[A-Za-z]", candidate) else re.I
    return re.search(left + re.escape(candidate) + right, body, flags) is not None


async def article_origin(db: AsyncSession, body: str) -> str | None:
    """The original language of the longest catalogue title the text names, if it names one.

    Each title family is asked separately and the longest hit across them wins, so a work
    named by an alias is recognised as readily as one named by its catalogue title. A
    title the catalogue carries under more than one original language names no one work,
    and answers nothing.
    """
    if not body or len(body) < MIN_TITLE_LENGTH:
        return None
    params = {"body": body, "min_length": MIN_TITLE_LENGTH, "per_family": CANDIDATES_PER_FAMILY}
    found: dict[str, set[str]] = {}
    for query in _ORIGIN_QUERIES:
        for row in (await db.execute(text(query), params)).all():
            if not row.candidate or not row.olangs:
                continue
            if not _stands_alone(row.candidate, body, as_written=True):
                continue
            found.setdefault(row.candidate.lower(), set()).update(o for o in row.olangs if o)
    if not found:
        return None
    best = max(found, key=len)
    langs = found[best]
    return next(iter(langs)) if len(langs) == 1 else None


async def developer_names(db: AsyncSession, vn_id: str) -> tuple[list[str], list[str]]:
    """A title's developers, romanised and as written, naming the same producers in order.

    The dump keeps the native name in `name` and the romanised one in `original`, which is
    the reverse of the way the API names the two.
    """
    producers = (
        await db.execute(
            select(Producer.name, Producer.original)
            .join(ReleaseProducer, ReleaseProducer.producer_id == Producer.id)
            .join(ReleaseVN, ReleaseVN.release_id == ReleaseProducer.release_id)
            .where(ReleaseVN.vn_id == vn_id, ReleaseProducer.developer == True)  # noqa: E712
            .distinct()
            .order_by(Producer.name)
            .limit(MAX_DEVELOPERS)
        )
    ).all()
    return [p.original or p.name for p in producers], [p.name for p in producers]


async def resolve_store_vn(db: AsyncSession, site: str, value: str) -> MatchedVN | None:
    """The catalogue entry behind a store id, if its original language is Japanese.

    A store page can belong to several releases and one release to several VNs; the first
    Japanese-original VN wins, which for a store listing is the right one in practice.
    """
    row = (
        await db.execute(
            select(VisualNovel)
            .join(ReleaseVN, ReleaseVN.vn_id == VisualNovel.id)
            .join(ReleaseExtlink, ReleaseExtlink.release_id == ReleaseVN.release_id)
            .join(ExtlinksMaster, ExtlinksMaster.id == ReleaseExtlink.link_id)
            .where(
                ExtlinksMaster.site == site,
                ExtlinksMaster.value == value,
                VisualNovel.olang == "ja",
            )
            .order_by(VisualNovel.id)
            .limit(1)
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    developers, developers_original = await developer_names(db, row.id)
    return MatchedVN(
        id=row.id,
        title=row.title,
        title_jp=row.title_jp,
        title_romaji=row.title_romaji,
        image_url=row.image_url,
        image_sexual=row.image_sexual,
        minage=row.minage,
        developers=developers,
        developers_original=developers_original,
    )
