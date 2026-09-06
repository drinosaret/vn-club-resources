"""Hold the shared VN filter module to the search endpoint it was extracted from.

The filters used to be written inline in the search endpoint. Moving them out is only safe
if every combination still compiles to the same SQL, so this module keeps a verbatim copy
of the original inline logic and compares the two, clause for clause, across a matrix of
filter combinations. A divergence here means the browse page changed behaviour, which is
never the intent of a refactor.

The copy below is a reference, not a second implementation to keep in step: when a filter
genuinely changes, the copy changes with it and the comparison keeps testing that both
callers of the shared module agree.
"""

import pytest

# These tests need SQLAlchemy to compile clauses; the minimal unit venv omits
# it, so skip there. The full suite (Docker/CI) runs them.
pytest.importorskip("sqlalchemy")

from sqlalchemy import func, or_, select
from sqlalchemy.dialects import postgresql

from app.db.models import (
    ReleasePlatform,
    ReleaseProducer,
    ReleaseVN,
    VisualNovel,
    VNDifficulty,
    VNSeiyuu,
    VNStaff,
)
from app.db.vn_filters import (
    FilterListTooLong,
    MAX_FILTER_IDS,
    parse_vn_filters,
    vn_filter_predicates,
)


def sql(expression) -> str:
    """The SQL an expression compiles to, with bound values inlined so they can be read."""
    return str(
        expression.compile(
            dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}
        )
    )


def _base_query():
    return select(func.count(VisualNovel.id))


# ---------------------------------------------------------------------------
# Verbatim copy of the filter logic as it stood inline in the search endpoint.
# ---------------------------------------------------------------------------


def _legacy_query(
    year_min=None,
    year_max=None,
    min_rating=None,
    max_rating=None,
    min_votecount=None,
    max_votecount=None,
    min_difficulty=None,
    max_difficulty=None,
    length=None,
    minage=None,
    devstatus="0",
    olang=None,
    platform=None,
    exclude_length=None,
    exclude_minage=None,
    exclude_devstatus=None,
    exclude_olang=None,
    exclude_platform=None,
    staff=None,
    seiyuu=None,
    developer=None,
    publisher=None,
    producer=None,
    nsfw=False,
):
    query = _base_query()

    if year_min:
        query = query.where(func.extract("year", VisualNovel.released) >= year_min)
    if year_max:
        query = query.where(func.extract("year", VisualNovel.released) <= year_max)

    if min_rating is not None:
        query = query.where(VisualNovel.rating >= min_rating)
    if max_rating is not None:
        query = query.where(VisualNovel.rating < max_rating)

    if min_votecount is not None:
        query = query.where(VisualNovel.votecount >= min_votecount)
    if max_votecount is not None:
        query = query.where(VisualNovel.votecount <= max_votecount)

    if min_difficulty is not None or max_difficulty is not None:
        measured = select(VNDifficulty.vn_id)
        if min_difficulty is not None:
            measured = measured.where(VNDifficulty.difficulty >= min_difficulty)
        if max_difficulty is not None:
            measured = measured.where(VNDifficulty.difficulty <= max_difficulty)
        query = query.where(VisualNovel.id.in_(measured))

    def get_length_filter(length_key: str):
        length_ranges = {
            "very_short": (None, 120),
            "short": (120, 600),
            "medium": (600, 1800),
            "long": (1800, 3000),
            "very_long": (3000, None),
        }
        length_values = {"very_short": 1, "short": 2, "medium": 3, "long": 4, "very_long": 5}
        if length_key not in length_ranges:
            return None
        min_len, max_len = length_ranges[length_key]
        conditions = []
        if min_len is not None and max_len is not None:
            conditions.append((VisualNovel.length_minutes > 0) & (VisualNovel.length_minutes >= min_len) & (VisualNovel.length_minutes < max_len))
        elif min_len is not None:
            conditions.append((VisualNovel.length_minutes > 0) & (VisualNovel.length_minutes >= min_len))
        elif max_len is not None:
            conditions.append((VisualNovel.length_minutes > 0) & (VisualNovel.length_minutes < max_len))
        conditions.append(
            or_(VisualNovel.length_minutes.is_(None), VisualNovel.length_minutes <= 0) &
            (VisualNovel.length == length_values[length_key])
        )
        return or_(*conditions)

    if length:
        length_values = [v.strip() for v in length.split(",") if v.strip()]
        if length_values:
            length_conditions = [get_length_filter(lv) for lv in length_values if get_length_filter(lv) is not None]
            if length_conditions:
                query = query.where(or_(*length_conditions))

    if exclude_length:
        exclude_length_values = [v.strip() for v in exclude_length.split(",") if v.strip()]
        if exclude_length_values:
            exclude_conditions = [get_length_filter(lv) for lv in exclude_length_values if get_length_filter(lv) is not None]
            if exclude_conditions:
                query = query.where(~or_(*exclude_conditions))

    def get_age_filter(age_key: str):
        if age_key == "all_ages":
            return VisualNovel.minage <= 12
        elif age_key == "teen":
            return (VisualNovel.minage > 12) & (VisualNovel.minage <= 17)
        elif age_key == "adult":
            return VisualNovel.minage >= 18
        return None

    if minage:
        minage_values = [v.strip() for v in minage.split(",") if v.strip()]
        if minage_values:
            age_conditions = [get_age_filter(av) for av in minage_values if get_age_filter(av) is not None]
            if age_conditions:
                query = query.where(or_(*age_conditions))

    if exclude_minage:
        exclude_minage_values = [v.strip() for v in exclude_minage.split(",") if v.strip()]
        if exclude_minage_values:
            exclude_age_conditions = [get_age_filter(av) for av in exclude_minage_values if get_age_filter(av) is not None]
            if exclude_age_conditions:
                query = query.where(~or_(*exclude_age_conditions))

    if devstatus and devstatus != "-1":
        devstatus_values = [int(v.strip()) for v in devstatus.split(",") if v.strip().lstrip('-').isdigit() and int(v.strip()) >= 0]
        if devstatus_values:
            if len(devstatus_values) == 1:
                query = query.where(VisualNovel.devstatus == devstatus_values[0])
            else:
                query = query.where(VisualNovel.devstatus.in_(devstatus_values))

    if exclude_devstatus:
        exclude_devstatus_values = [int(v.strip()) for v in exclude_devstatus.split(",") if v.strip().lstrip('-').isdigit() and int(v.strip()) >= 0]
        if exclude_devstatus_values:
            query = query.where(~VisualNovel.devstatus.in_(exclude_devstatus_values))

    if olang:
        olang_values = [v.strip() for v in olang.split(",") if v.strip()]
        if olang_values:
            if len(olang_values) == 1:
                query = query.where(VisualNovel.olang == olang_values[0])
            else:
                query = query.where(VisualNovel.olang.in_(olang_values))

    if exclude_olang:
        exclude_olang_values = [v.strip() for v in exclude_olang.split(",") if v.strip()]
        if exclude_olang_values:
            query = query.where(~VisualNovel.olang.in_(exclude_olang_values))

    if platform:
        platform_values = [v.strip() for v in platform.split(",") if v.strip()]
        if platform_values:
            platform_subquery = (
                select(ReleaseVN.vn_id)
                .join(ReleasePlatform, ReleaseVN.release_id == ReleasePlatform.release_id)
                .where(ReleasePlatform.platform.in_(platform_values))
                .where(ReleaseVN.rtype == 'complete')
                .distinct()
            )
            query = query.where(VisualNovel.id.in_(platform_subquery))

    if exclude_platform:
        exclude_platform_values = [v.strip() for v in exclude_platform.split(",") if v.strip()]
        if exclude_platform_values:
            exclude_platform_subquery = (
                select(ReleaseVN.vn_id)
                .join(ReleasePlatform, ReleaseVN.release_id == ReleasePlatform.release_id)
                .where(ReleasePlatform.platform.in_(exclude_platform_values))
                .where(ReleaseVN.rtype == 'complete')
                .distinct()
            )
            query = query.where(~VisualNovel.id.in_(exclude_platform_subquery))

    if not nsfw:
        query = query.where(or_(VisualNovel.minage < 18, VisualNovel.minage.is_(None)))

    def parse_str_list(value):
        return [s.strip() for s in value.split(",") if s.strip()]

    if staff:
        staff_ids = parse_str_list(staff)
        if staff_ids:
            staff_sub = select(VNStaff.vn_id).where(VNStaff.staff_id.in_(staff_ids)).distinct()
            query = query.where(VisualNovel.id.in_(staff_sub))

    if seiyuu:
        seiyuu_ids = parse_str_list(seiyuu)
        if seiyuu_ids:
            seiyuu_sub = select(VNSeiyuu.vn_id).where(VNSeiyuu.staff_id.in_(seiyuu_ids)).distinct()
            query = query.where(VisualNovel.id.in_(seiyuu_sub))

    if developer:
        dev_ids = parse_str_list(developer)
        if dev_ids:
            dev_sub = (
                select(ReleaseVN.vn_id)
                .join(ReleaseProducer, ReleaseVN.release_id == ReleaseProducer.release_id)
                .where(ReleaseProducer.producer_id.in_(dev_ids))
                .where(ReleaseProducer.developer == True)
                .distinct()
            )
            query = query.where(VisualNovel.id.in_(dev_sub))

    if publisher:
        pub_ids = parse_str_list(publisher)
        if pub_ids:
            pub_sub = (
                select(ReleaseVN.vn_id)
                .join(ReleaseProducer, ReleaseVN.release_id == ReleaseProducer.release_id)
                .where(ReleaseProducer.producer_id.in_(pub_ids))
                .where(ReleaseProducer.publisher == True)
                .distinct()
            )
            query = query.where(VisualNovel.id.in_(pub_sub))

    if producer:
        prod_ids = parse_str_list(producer)
        if prod_ids:
            prod_sub = (
                select(ReleaseVN.vn_id)
                .join(ReleaseProducer, ReleaseVN.release_id == ReleaseProducer.release_id)
                .where(ReleaseProducer.producer_id.in_(prod_ids))
                .where(or_(ReleaseProducer.developer == True, ReleaseProducer.publisher == True))
                .distinct()
            )
            query = query.where(VisualNovel.id.in_(prod_sub))

    return query


def _shared_query(**kwargs):
    """The same query built through the extracted module."""
    query = _base_query()
    for predicate in vn_filter_predicates(parse_vn_filters(**kwargs)):
        query = query.where(predicate)
    return query


#: Filter combinations the extraction has to reproduce exactly.
CASES = {
    "no_filters": {},
    "platform_only": {"platform": "ps2"},
    "platform_multi": {"platform": "p98,p88,x68,fmt"},
    "exclude_platform_only": {"exclude_platform": "win"},
    "platform_both_ways": {"platform": "ps2,psp", "exclude_platform": "win,swi"},
    "year_range": {"year_min": 2000, "year_max": 2010},
    "year_min_only": {"year_min": 1996},
    "year_max_only": {"year_max": 1999},
    "difficulty_range": {"min_difficulty": 3.0, "max_difficulty": 6.5},
    "difficulty_min_only": {"min_difficulty": 2.5},
    "difficulty_max_only": {"max_difficulty": 7.0},
    "rating_range": {"min_rating": 7.0, "max_rating": 9.0},
    "rating_zero_floor": {"min_rating": 0},
    "votecount_range": {"min_votecount": 50, "max_votecount": 5000},
    "minage_single": {"minage": "all_ages"},
    "minage_multi": {"minage": "all_ages,teen"},
    "exclude_minage": {"exclude_minage": "adult"},
    "minage_unknown_key": {"minage": "all_ages,nonsense"},
    "devstatus_default": {},
    "devstatus_explicit_zero": {"devstatus": "0"},
    "devstatus_multi": {"devstatus": "0,1"},
    "devstatus_all": {"devstatus": "-1"},
    "devstatus_negative_in_list": {"devstatus": "0,-1"},
    "exclude_devstatus": {"exclude_devstatus": "1,2"},
    "olang_single": {"olang": "ja"},
    "olang_multi": {"olang": "ja,zh"},
    "exclude_olang": {"exclude_olang": "en"},
    "nsfw_hidden": {"nsfw": False},
    "nsfw_shown": {"nsfw": True},
    "length_single": {"length": "very_short"},
    "length_multi": {"length": "short,medium,very_long"},
    "exclude_length": {"exclude_length": "very_long"},
    "length_unknown_key": {"length": "medium,huge"},
    "length_blank_entries": {"length": " short , , medium "},
    "staff": {"staff": "s1000,s2000"},
    "seiyuu": {"seiyuu": "s3000"},
    "developer": {"developer": "p100"},
    "publisher": {"publisher": "p200,p300"},
    "producer": {"producer": "p400"},
    "six_at_once": {
        "platform": "ps2",
        "year_min": 2001,
        "year_max": 2008,
        "minage": "adult",
        "olang": "ja",
        "min_rating": 7.5,
        "nsfw": True,
    },
    "everything": {
        "year_min": 1998,
        "year_max": 2020,
        "min_rating": 6.0,
        "max_rating": 9.5,
        "min_votecount": 25,
        "max_votecount": 100000,
        "min_difficulty": 2.0,
        "max_difficulty": 8.0,
        "length": "medium,long",
        "exclude_length": "very_short",
        "minage": "teen,adult",
        "exclude_minage": "all_ages",
        "devstatus": "0,1",
        "exclude_devstatus": "2",
        "olang": "ja,zh",
        "exclude_olang": "en",
        "platform": "win,ps2",
        "exclude_platform": "and,ios",
        "staff": "s1,s2",
        "seiyuu": "s3",
        "developer": "p1",
        "publisher": "p2",
        "producer": "p3",
        "nsfw": True,
    },
}


@pytest.mark.parametrize("name", sorted(CASES))
def test_extraction_compiles_to_the_same_sql(name):
    kwargs = CASES[name]
    assert sql(_shared_query(**kwargs)) == sql(_legacy_query(**kwargs))


def test_no_filters_still_carries_the_two_defaults():
    # An empty filter set is not an empty WHERE: finished titles only, adult content out.
    compiled = sql(_shared_query())
    assert "devstatus = 0" in compiled
    assert "minage < 18" in compiled
    assert "IS NULL" in compiled


def test_devstatus_all_lifts_the_default():
    assert "devstatus" not in sql(_shared_query(devstatus="-1"))


def test_difficulty_restricts_to_analysed_titles():
    # Difficulty is measured for a fraction of the database, so the predicate has to be a
    # presence subquery: an outer join would let unmeasured titles through.
    compiled = sql(_shared_query(min_difficulty=4.0))
    assert "vn_difficulty" in compiled
    assert "visual_novels.id IN (SELECT" in compiled


def test_platform_counts_complete_releases_only():
    compiled = sql(_shared_query(platform="ps2"))
    assert "release_platforms" in compiled
    assert "release_vn.rtype = 'complete'" in compiled


def test_exclude_platform_negates_the_same_subquery():
    compiled = sql(_shared_query(exclude_platform="win"))
    assert "(visual_novels.id NOT IN (SELECT" in compiled
    assert "release_vn.rtype = 'complete'" in compiled


def test_zero_year_is_unset():
    spec = parse_vn_filters(year_min=0, year_max=0)
    assert spec.year_min is None and spec.year_max is None
    assert sql(_shared_query(year_min=0)) == sql(_shared_query())


def test_rating_ceiling_is_exclusive():
    # Adjacent brackets in the filter bar share a boundary; only one may claim it.
    # The ceiling tests the figure the cards print, which is the raw average where the
    # catalogue has one and the smoothed rating otherwise.
    # Browse states the damped site figure and its bounds measure that; the recommendation
    # surfaces pass the average they print instead.
    assert "visual_novels.rating < 9.0" in sql(_shared_query(max_rating=9.0))
    assert "visual_novels.rating >= 7.0" in sql(_shared_query(min_rating=7.0))


def test_entity_id_lists_are_capped():
    too_many = ",".join(f"s{i}" for i in range(MAX_FILTER_IDS + 1))
    with pytest.raises(FilterListTooLong) as exc:
        parse_vn_filters(staff=too_many)
    assert str(exc.value) == f"Too many filter IDs (max {MAX_FILTER_IDS})"


def test_entity_id_list_at_the_cap_is_accepted():
    at_cap = ",".join(f"s{i}" for i in range(MAX_FILTER_IDS))
    assert len(parse_vn_filters(staff=at_cap).staff) == MAX_FILTER_IDS


def test_category_lists_are_not_capped():
    # Platform and language vocabularies are short and fixed, so a long list is a stale
    # bookmark rather than an attempt to make one request expensive.
    many = ",".join(f"p{i}" for i in range(MAX_FILTER_IDS + 5))
    assert len(parse_vn_filters(platform=many).platform) == MAX_FILTER_IDS + 5


def test_unset_spec_produces_only_the_default_predicates():
    spec = parse_vn_filters(devstatus="-1", nsfw=True)
    assert vn_filter_predicates(spec) == []
