"""Shared filter vocabulary for visual novel queries.

The browse search endpoint defines what a filter over a visual novel means on this site.
Any other surface offering the same filters has to agree with it exactly, or the same
control produces different sets on two pages. This module holds those predicates once so
both sides compose the identical SQL.

The rating bound is the one predicate whose column is surface-specific. A bound has to be
measured against the figure the surface puts on a card, or a result can hold titles whose
printed rating falls outside the band that admitted them, and the surfaces do not all print
the same figure. The column is therefore chosen by the caller through ``rating_column``,
defaulting to the rating the browse page shows and sorts by.

Two shapes of predicate live here, and the difference matters to a caller building a query
that already joins the tables involved:

Plain column comparisons on ``visual_novels``
    year range, rating range, vote count range, length, age rating, dev status, original
    language, and the adult-content toggle. These reference only ``VisualNovel`` and can be
    dropped into any query whose FROM includes it.

Correlated subqueries on related tables
    reading difficulty (``vn_difficulty``), platform (``release_vn`` joined to
    ``release_platforms``), staff (``vn_staff``), seiyuu (``vn_seiyuu``), and the
    developer / publisher / producer roles (``release_vn`` joined to
    ``release_producers``). Each is expressed as ``VisualNovel.id IN (SELECT ...)`` with its
    own FROM, so it neither needs nor conflicts with joins the outer query already has, and
    it cannot multiply outer rows the way a join to a many-side table would.

Reading difficulty is measured for only a fraction of the database, so asking for a
difficulty at all restricts the result to measured titles. That is why it is a presence
subquery rather than an outer join, which would admit unmeasured titles as though their
difficulty were known.

Tags and traits are deliberately absent. Their include/exclude semantics carry a matching
mode, an optional expansion down the tag tree, and a spoiler ceiling, and a recommender
applies them at a different stage of query building than a search does. They stay with
their callers until those two needs are reconciled.

Every id list a spec can hold is capped at ``MAX_FILTER_IDS`` while parsing, so plain
``IN`` is safe here: the bound-parameter count per request stays small. A caller passing an
uncapped set of ids (a whole user list, for instance) must use
``app.db.query_utils.in_ids`` / ``not_in_ids`` instead, which bind the set as a single
array parameter.
"""

from dataclasses import dataclass

from sqlalchemy import ColumnElement, func, or_, select

from app.db.models import (
    ReleasePlatform,
    ReleaseProducer,
    ReleaseVN,
    VisualNovel,
    VNDifficulty,
    VNSeiyuu,
    VNStaff,
)

# Ceiling on the ids accepted in one comma-separated filter. Each id can add a subquery, so
# the cost of one request grows with the length of the list.
MAX_FILTER_IDS = 30

# Minute ranges per length key. The upper bound is exclusive.
_LENGTH_RANGES = {
    "very_short": (None, 120),
    "short": (120, 600),
    "medium": (600, 1800),
    "long": (1800, 3000),
    "very_long": (3000, None),
}

# The legacy 1-5 length column, used when the minute count is missing.
_LENGTH_VALUES = {"very_short": 1, "short": 2, "medium": 3, "long": 4, "very_long": 5}


class FilterListTooLong(ValueError):
    """A comma-separated filter carried more ids than the request cap allows."""

    def __init__(self, max_items: int = MAX_FILTER_IDS):
        self.max_items = max_items
        super().__init__(f"Too many filter IDs (max {max_items})")


@dataclass(frozen=True)
class VNFilterSpec:
    """A parsed set of visual novel filters.

    Every field is optional. ``None`` on a scalar and an empty tuple on a collection both
    mean the filter is unset and contributes no predicate. ``nsfw`` is the exception: it is
    a toggle rather than a range, and its off state is itself a predicate that excludes
    adult titles.
    """

    year_min: int | None = None
    year_max: int | None = None
    min_rating: float | None = None
    max_rating: float | None = None
    min_votecount: int | None = None
    max_votecount: int | None = None
    min_difficulty: float | None = None
    max_difficulty: float | None = None
    length: tuple[str, ...] = ()
    exclude_length: tuple[str, ...] = ()
    minage: tuple[str, ...] = ()
    exclude_minage: tuple[str, ...] = ()
    devstatus: tuple[int, ...] = ()
    exclude_devstatus: tuple[int, ...] = ()
    olang: tuple[str, ...] = ()
    exclude_olang: tuple[str, ...] = ()
    platform: tuple[str, ...] = ()
    exclude_platform: tuple[str, ...] = ()
    staff: tuple[str, ...] = ()
    seiyuu: tuple[str, ...] = ()
    developer: tuple[str, ...] = ()
    publisher: tuple[str, ...] = ()
    producer: tuple[str, ...] = ()
    nsfw: bool = False


def _split_values(value: str | None) -> tuple[str, ...]:
    """Comma-separated values, trimmed, with empties dropped."""
    if not value:
        return ()
    return tuple(v.strip() for v in value.split(",") if v.strip())


def _split_ids(value: str | None, max_items: int) -> tuple[str, ...]:
    """Comma-separated entity ids, capped."""
    items = _split_values(value)
    if len(items) > max_items:
        raise FilterListTooLong(max_items)
    return items


def _split_devstatus(value: str | None) -> tuple[int, ...]:
    """Comma-separated dev status codes. Non-numeric and negative entries are dropped."""
    return tuple(
        int(v)
        for v in _split_values(value)
        if v.lstrip("-").isdigit() and int(v) >= 0
    )


def parse_vn_filters(
    *,
    year_min: int | None = None,
    year_max: int | None = None,
    min_rating: float | None = None,
    max_rating: float | None = None,
    min_votecount: int | None = None,
    max_votecount: int | None = None,
    min_difficulty: float | None = None,
    max_difficulty: float | None = None,
    length: str | None = None,
    minage: str | None = None,
    devstatus: str | None = "0",
    olang: str | None = None,
    platform: str | None = None,
    exclude_length: str | None = None,
    exclude_minage: str | None = None,
    exclude_devstatus: str | None = None,
    exclude_olang: str | None = None,
    exclude_platform: str | None = None,
    staff: str | None = None,
    seiyuu: str | None = None,
    developer: str | None = None,
    publisher: str | None = None,
    producer: str | None = None,
    nsfw: bool = False,
    max_filter_ids: int = MAX_FILTER_IDS,
) -> VNFilterSpec:
    """Build a spec from raw query-string values.

    ``devstatus`` defaults to finished titles only, so a caller that never mentions dev
    status still gets the site-wide default. Passing ``"-1"`` asks for every status and is
    the only way to lift it.

    Unrecognised length keys, age keys and dev status codes are dropped rather than
    rejected, so a stale bookmark degrades to a wider result rather than an error. Only the
    entity id lists are capped, and exceeding the cap raises ``FilterListTooLong``.

    A year of zero is treated as unset: the field carries a calendar year, and no title
    predates the range worth filtering on.
    """
    return VNFilterSpec(
        year_min=year_min or None,
        year_max=year_max or None,
        min_rating=min_rating,
        max_rating=max_rating,
        min_votecount=min_votecount,
        max_votecount=max_votecount,
        min_difficulty=min_difficulty,
        max_difficulty=max_difficulty,
        length=_split_values(length),
        exclude_length=_split_values(exclude_length),
        minage=_split_values(minage),
        exclude_minage=_split_values(exclude_minage),
        # "-1" is the explicit "any status" value, distinct from an absent filter.
        devstatus=() if devstatus == "-1" else _split_devstatus(devstatus),
        exclude_devstatus=_split_devstatus(exclude_devstatus),
        olang=_split_values(olang),
        exclude_olang=_split_values(exclude_olang),
        platform=_split_values(platform),
        exclude_platform=_split_values(exclude_platform),
        staff=_split_ids(staff, max_filter_ids),
        seiyuu=_split_ids(seiyuu, max_filter_ids),
        developer=_split_ids(developer, max_filter_ids),
        publisher=_split_ids(publisher, max_filter_ids),
        producer=_split_ids(producer, max_filter_ids),
        nsfw=nsfw,
    )


def length_predicate(length_key: str) -> ColumnElement[bool] | None:
    """Match one length bucket, or None for an unrecognised key.

    The minute count is authoritative where it is present and positive. Where it is absent
    or non-positive the legacy 1-5 category stands in, which is the same precedence the
    category-derivation helper applies.
    """
    if length_key not in _LENGTH_RANGES:
        return None
    min_len, max_len = _LENGTH_RANGES[length_key]
    conditions = []
    if min_len is not None and max_len is not None:
        conditions.append(
            (VisualNovel.length_minutes > 0)
            & (VisualNovel.length_minutes >= min_len)
            & (VisualNovel.length_minutes < max_len)
        )
    elif min_len is not None:
        conditions.append(
            (VisualNovel.length_minutes > 0) & (VisualNovel.length_minutes >= min_len)
        )
    elif max_len is not None:
        conditions.append(
            (VisualNovel.length_minutes > 0) & (VisualNovel.length_minutes < max_len)
        )
    conditions.append(
        or_(VisualNovel.length_minutes.is_(None), VisualNovel.length_minutes <= 0)
        & (VisualNovel.length == _LENGTH_VALUES[length_key])
    )
    return or_(*conditions)


def age_predicate(age_key: str) -> ColumnElement[bool] | None:
    """Match one age bracket, or None for an unrecognised key."""
    if age_key == "all_ages":
        return VisualNovel.minage <= 12
    if age_key == "teen":
        return (VisualNovel.minage > 12) & (VisualNovel.minage <= 17)
    if age_key == "adult":
        return VisualNovel.minage >= 18
    return None


def _any_of(keys: tuple[str, ...], build) -> ColumnElement[bool] | None:
    """OR the predicates the recognised keys produce, or None if none are recognised."""
    conditions = [c for c in (build(k) for k in keys) if c is not None]
    if not conditions:
        return None
    return or_(*conditions)


def _platform_subquery(codes: tuple[str, ...]):
    """VN ids with a complete release on any of these platforms.

    Only complete releases count: a partial or trial release does not make a title
    available on a platform in the sense the filter is asking about.
    """
    return (
        select(ReleaseVN.vn_id)
        .join(ReleasePlatform, ReleaseVN.release_id == ReleasePlatform.release_id)
        .where(ReleasePlatform.platform.in_(codes))
        .where(ReleaseVN.rtype == "complete")
        .distinct()
    )


def _producer_subquery(producer_ids: tuple[str, ...], role):
    """VN ids released by any of these producers in the given role."""
    return (
        select(ReleaseVN.vn_id)
        .join(ReleaseProducer, ReleaseVN.release_id == ReleaseProducer.release_id)
        .where(ReleaseProducer.producer_id.in_(producer_ids))
        .where(role)
        .distinct()
    )


# The two rating columns a surface can print. Browse states a title's rating as the damped
# site figure and orders by it. The recommender states the plain average of the votes cast,
# falling back to the damped figure where no average has been recorded.
DAMPED_RATING = VisualNovel.rating
AVERAGE_RATING = func.coalesce(VisualNovel.average_rating, VisualNovel.rating)


def vn_attribute_predicates(
    spec: VNFilterSpec, *, rating_column: ColumnElement | None = None
) -> list[ColumnElement[bool]]:
    """Predicates describing the title itself: ranges, categories, platform, content.

    Ordered so a query built from them reads in the same sequence the filter bar presents.

    ``rating_column`` names the figure the calling surface prints, which the rating bounds
    are measured against. It defaults to ``DAMPED_RATING``.
    """
    predicates: list[ColumnElement[bool]] = []

    if spec.year_min is not None:
        predicates.append(func.extract("year", VisualNovel.released) >= spec.year_min)
    if spec.year_max is not None:
        predicates.append(func.extract("year", VisualNovel.released) <= spec.year_max)

    # The bounds are compared against the figure the calling surface prints, so a result
    # cannot hold a title whose card states a rating outside the band that was asked for.
    # The ceiling is exclusive so adjacent brackets in the UI do not overlap on their
    # shared boundary.
    if spec.min_rating is not None or spec.max_rating is not None:
        shown_rating = DAMPED_RATING if rating_column is None else rating_column
        if spec.min_rating is not None:
            predicates.append(shown_rating >= spec.min_rating)
        if spec.max_rating is not None:
            predicates.append(shown_rating < spec.max_rating)

    if spec.min_votecount is not None:
        predicates.append(VisualNovel.votecount >= spec.min_votecount)
    if spec.max_votecount is not None:
        predicates.append(VisualNovel.votecount <= spec.max_votecount)

    # The bounds name difficulty bands, the same integers a card is badged with, so they are
    # compared against the stored band rather than the continuous value it is derived from.
    # A band's continuous range runs above its own integer, so holding that value to a band
    # number would drop the band the reader asked for.
    if spec.min_difficulty is not None or spec.max_difficulty is not None:
        measured = select(VNDifficulty.vn_id)
        if spec.min_difficulty is not None:
            measured = measured.where(VNDifficulty.difficulty >= spec.min_difficulty)
        if spec.max_difficulty is not None:
            measured = measured.where(VNDifficulty.difficulty <= spec.max_difficulty)
        predicates.append(VisualNovel.id.in_(measured))

    length_filter = _any_of(spec.length, length_predicate)
    if length_filter is not None:
        predicates.append(length_filter)
    exclude_length_filter = _any_of(spec.exclude_length, length_predicate)
    if exclude_length_filter is not None:
        predicates.append(~exclude_length_filter)

    age_filter = _any_of(spec.minage, age_predicate)
    if age_filter is not None:
        predicates.append(age_filter)
    exclude_age_filter = _any_of(spec.exclude_minage, age_predicate)
    if exclude_age_filter is not None:
        predicates.append(~exclude_age_filter)

    if spec.devstatus:
        if len(spec.devstatus) == 1:
            predicates.append(VisualNovel.devstatus == spec.devstatus[0])
        else:
            predicates.append(VisualNovel.devstatus.in_(spec.devstatus))
    if spec.exclude_devstatus:
        predicates.append(~VisualNovel.devstatus.in_(spec.exclude_devstatus))

    if spec.olang:
        if len(spec.olang) == 1:
            predicates.append(VisualNovel.olang == spec.olang[0])
        else:
            predicates.append(VisualNovel.olang.in_(spec.olang))
    if spec.exclude_olang:
        predicates.append(~VisualNovel.olang.in_(spec.exclude_olang))

    if spec.platform:
        predicates.append(VisualNovel.id.in_(_platform_subquery(spec.platform)))
    if spec.exclude_platform:
        predicates.append(~VisualNovel.id.in_(_platform_subquery(spec.exclude_platform)))

    # An unrated title is not adult, so it stays in when adult content is hidden.
    if not spec.nsfw:
        predicates.append(
            or_(VisualNovel.minage < 18, VisualNovel.minage.is_(None))
        )

    return predicates


def vn_entity_predicates(spec: VNFilterSpec) -> list[ColumnElement[bool]]:
    """Predicates tying a title to the people and companies credited on it.

    Kept separate from the attribute predicates because a caller may want the two applied
    at different points, and because these are the only ones whose id lists are capped.
    """
    predicates: list[ColumnElement[bool]] = []

    if spec.staff:
        predicates.append(
            VisualNovel.id.in_(
                select(VNStaff.vn_id).where(VNStaff.staff_id.in_(spec.staff)).distinct()
            )
        )
    if spec.seiyuu:
        predicates.append(
            VisualNovel.id.in_(
                select(VNSeiyuu.vn_id)
                .where(VNSeiyuu.staff_id.in_(spec.seiyuu))
                .distinct()
            )
        )
    if spec.developer:
        predicates.append(
            VisualNovel.id.in_(
                _producer_subquery(spec.developer, ReleaseProducer.developer == True)  # noqa: E712
            )
        )
    if spec.publisher:
        predicates.append(
            VisualNovel.id.in_(
                _producer_subquery(spec.publisher, ReleaseProducer.publisher == True)  # noqa: E712
            )
        )
    if spec.producer:
        # Either credited role counts, which is what a producer page links to.
        predicates.append(
            VisualNovel.id.in_(
                _producer_subquery(
                    spec.producer,
                    or_(
                        ReleaseProducer.developer == True,  # noqa: E712
                        ReleaseProducer.publisher == True,  # noqa: E712
                    ),
                )
            )
        )

    return predicates


def vn_filter_predicates(
    spec: VNFilterSpec, *, rating_column: ColumnElement | None = None
) -> list[ColumnElement[bool]]:
    """Every predicate the spec describes, attributes first, then credits."""
    return vn_attribute_predicates(
        spec, rating_column=rating_column
    ) + vn_entity_predicates(spec)
