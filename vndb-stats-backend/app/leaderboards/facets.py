"""Evaluating a facet against a visual novel.

Two evaluators, because facets are applied in two very different places. The nightly job
streams millions of vote rows and needs a cheap in-memory test, so it loads every VN's
facts once and matches against those. Ad-hoc requests filter in the database instead, where
the same facet has to become a SQL predicate.

Both must agree. The in-memory side is pinned by tests; the SQL side is
kept deliberately literal so the correspondence stays readable.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import and_, func

from app.db.models import VisualNovel

from .spec import Facet


@dataclass(frozen=True)
class VNFacts:
    """Everything about a VN that any facet can test, loaded once per nightly run."""

    vn_id: str
    olang: str | None
    languages: frozenset
    platforms: frozenset
    year: int | None
    length: int | None
    minage: int | None
    votecount: int
    has_free_release: bool
    jp_freeware: bool
    #: Day ordinal of the original release, for measuring how long votes took to arrive.
    #: None when the release date is unknown, which excludes the title from that board.
    released_ordinal: int | None = None
    #: Japanese reading difficulty, where jiten has analysed the script. None means not
    #: measured, never easy, so a difficulty facet must exclude it rather than admit it.
    difficulty: float | None = None


def matches(facts: VNFacts, facet: Facet, tagged_vn_ids: frozenset | None = None) -> bool:
    """Test a VN against a facet in memory.

    `tagged_vn_ids` supplies the membership set for a tag facet; the caller loads it once
    per tag rather than querying per VN. A tag facet with no set supplied never matches,
    which fails closed rather than silently widening the board.
    """
    if facet.olang is not None and facts.olang != facet.olang:
        return False

    if facet.lang_only is not None and facts.languages != frozenset({facet.lang_only}):
        return False

    if facet.year_min is not None and (facts.year is None or facts.year < facet.year_min):
        return False

    if facet.year_max is not None and (facts.year is None or facts.year > facet.year_max):
        return False

    if facet.platform is not None and facet.platform not in facts.platforms:
        return False

    if facet.length is not None and facts.length != facet.length:
        return False

    if facet.freeware and not facts.has_free_release:
        return False

    if facet.jp_freeware and not facts.jp_freeware:
        return False

    # An unmeasured title is excluded rather than admitted: absence of a difficulty is not
    # evidence of an easy one.
    if facet.difficulty_max is not None and (
        facts.difficulty is None or facts.difficulty > facet.difficulty_max
    ):
        return False

    if facet.difficulty_min is not None and (
        facts.difficulty is None or facts.difficulty < facet.difficulty_min
    ):
        return False

    if facet.minage_max is not None and (facts.minage is None or facts.minage > facet.minage_max):
        return False

    if facet.votecount_min is not None and facts.votecount < facet.votecount_min:
        return False

    if facet.votecount_max is not None and facts.votecount > facet.votecount_max:
        return False

    if facet.tag is not None:
        if tagged_vn_ids is None or facts.vn_id not in tagged_vn_ids:
            return False

    return True


def predicate(facet: Facet):
    """Build the equivalent SQL filter over visual_novels.

    Returns None for an empty facet so callers can skip the WHERE clause entirely. Tag
    facets are not expressible here, since they need a join; `Facet.needs_tags` gates that
    upstream, and this raises rather than quietly returning an unfiltered board.
    """
    if facet.needs_tags:
        raise ValueError("Tag facets require a join and cannot be expressed as a column predicate")

    clauses = []

    if facet.olang is not None:
        clauses.append(VisualNovel.olang == facet.olang)

    if facet.lang_only is not None:
        # Exactly this language and no other. Both directions are needed: containment
        # alone would admit a VN also released in English.
        clauses.append(VisualNovel.languages == [facet.lang_only])

    if facet.year_min is not None:
        clauses.append(func.extract("year", VisualNovel.released) >= facet.year_min)

    if facet.year_max is not None:
        clauses.append(func.extract("year", VisualNovel.released) <= facet.year_max)

    if facet.platform is not None:
        clauses.append(VisualNovel.platforms.any(facet.platform))

    if facet.length is not None:
        clauses.append(VisualNovel.length == facet.length)

    if facet.freeware:
        clauses.append(VisualNovel.has_free_release.is_(True))

    if facet.jp_freeware:
        clauses.append(VisualNovel.jp_freeware.is_(True))

    if facet.minage_max is not None:
        clauses.append(VisualNovel.minage <= facet.minage_max)

    if facet.votecount_min is not None:
        clauses.append(VisualNovel.votecount >= facet.votecount_min)

    if facet.votecount_max is not None:
        clauses.append(VisualNovel.votecount <= facet.votecount_max)

    if not clauses:
        return None

    return and_(*clauses)


def describe_kind(facet: Facet) -> str:
    """What kind of narrowing a facet applies, for grouping the catalogue.

    The catalogue lists a dozen "best of" boards that differ only in their facet, and reads
    as a wall unless they are split. The split people expect is by era against everything
    else, with attention-based narrowing kept apart because "the best obscure titles" is a
    different question from "the best titles of one decade".

    Derived here rather than by matching the description text: that string is written for a
    reader and is free to change wording without anything depending on it.
    """
    if facet.is_empty:
        return "none"
    if facet.votecount_min is not None or facet.votecount_max is not None:
        return "attention"
    if facet.difficulty_min is not None or facet.difficulty_max is not None:
        return "difficulty"
    if facet.year_min is not None or facet.year_max is not None:
        return "era"
    return "kind"


def describe(facet: Facet) -> str:
    """Human-readable summary, used in board subtitles and empty-state copy."""
    if facet.is_empty:
        return "all visual novels"

    parts = []
    if facet.olang is not None:
        parts.append(f"originally in {facet.olang}")
    if facet.lang_only is not None:
        parts.append(f"released only in {facet.lang_only}")
    if facet.year_min is not None and facet.year_max is not None:
        parts.append(f"released {facet.year_min} to {facet.year_max}")
    elif facet.year_min is not None:
        parts.append(f"released {facet.year_min} or later")
    elif facet.year_max is not None:
        parts.append(f"released before {facet.year_max + 1}")
    if facet.platform is not None:
        parts.append(f"on {facet.platform}")
    if facet.length is not None:
        parts.append(f"length category {facet.length}")
    if facet.freeware:
        parts.append("with no paid release")
    if facet.jp_freeware:
        parts.append("whose Japanese releases are all free")
    if facet.minage_max is not None:
        parts.append(f"rated {facet.minage_max} or under")
    if facet.votecount_max is not None:
        parts.append(f"with {facet.votecount_max} votes or fewer")
    if facet.votecount_min is not None:
        parts.append(f"with at least {facet.votecount_min} votes")
    if facet.difficulty_max is not None:
        parts.append(f"whose Japanese scores {facet.difficulty_max} or below for difficulty")
    if facet.difficulty_min is not None:
        parts.append(f"whose Japanese scores {facet.difficulty_min} or above for difficulty")
    if facet.tag is not None:
        parts.append(f"tagged g{facet.tag}")

    return ", ".join(parts)
