"""Guards on the rankings computed per request over a caller-supplied slice.

Everything here is asserted structurally rather than by querying: the suite has no database,
and the failures being guarded against are an edit to one definition and not the other, a
question that stops disclosing what it did, and an axis that quietly stops narrowing
anything. All three are visible in the source.
"""

from __future__ import annotations

import inspect

import pytest

from app.leaderboards import custom, facets
from app.leaderboards.compute import load_tag_memberships
from app.leaderboards.spec import Facet, Metric
from app.leaderboards.thresholds import MIN_LIBRARY_FOR_SHARE

WH_WORDS = ("Whose", "Which", "What", "How", "Who", "Where", "When", "Why")

ALL_QUESTIONS = [entry[0] for entry in custom.TITLE_QUESTIONS.values()] + list(
    custom.READER_QUESTIONS.values()
)


def test_titles_are_statements_not_questions():
    """Titles read as statements, so a ranking cannot reintroduce a question."""
    for question in ALL_QUESTIONS:
        first = question.title.split()[0]
        assert first not in WH_WORDS, f"{question.key} titles as a question: {question.title}"


def test_every_title_names_the_slice():
    """A ranking over a slice has to say which slice, or two of them read identically."""
    for question in ALL_QUESTIONS:
        assert "{slice}" in question.title, f"{question.key} drops the slice from its title"


def test_the_year_question_names_the_year():
    question = custom.TITLE_QUESTIONS["as-of"][0]
    assert question.needs_year
    assert "{year}" in question.title


def test_question_keys_match_their_mapping():
    for key, entry in custom.TITLE_QUESTIONS.items():
        assert entry[0].key == key
    for key, question in custom.READER_QUESTIONS.items():
        assert question.key == key


def test_reader_questions_ask_different_things():
    """A count and a share are different claims, and must not collapse onto one metric."""
    metrics = {question.metric for question in custom.READER_QUESTIONS.values()}
    assert len(metrics) == len(custom.READER_QUESTIONS)
    assert custom.READER_QUESTIONS["read-most"].metric is Metric.VOTES
    assert custom.READER_QUESTIONS["share"].metric is Metric.LIBRARY_SHARE


@pytest.mark.parametrize("key", ["characters", "difficulty"])
def test_measured_reader_questions_declare_their_coverage(key):
    """Anything reading the difficulty mirror says so, since it covers a fraction of titles."""
    question = custom.READER_QUESTIONS[key]
    assert question.needs_difficulty
    assert "jiten" in question.blurb


@pytest.mark.parametrize("key", ["hardest", "easiest"])
def test_measured_title_questions_declare_their_coverage(key):
    question = custom.TITLE_QUESTIONS[key][0]
    assert question.needs_difficulty
    assert "jiten" in question.blurb


def test_every_question_reaches_a_disclosure():
    """A ranking with no disclosure is a number with no provenance, which is the thing to avoid."""
    for key, entry in custom.TITLE_QUESTIONS.items():
        disclosure = custom._title_disclosure(entry[0], "the 12 visual novels", entry[3], 2015)
        assert disclosure.floor and disclosure.population and disclosure.score
    for key, question in custom.READER_QUESTIONS.items():
        disclosure = custom._reader_disclosure(question, "the 12 visual novels")
        assert disclosure.floor and disclosure.population and disclosure.score


def test_share_disclosure_quotes_the_floor_it_applies():
    """The floor in the text is the constant the query enforces, not a number typed twice."""
    disclosure = custom._reader_disclosure(custom.READER_QUESTIONS["share"], "the database")
    assert str(MIN_LIBRARY_FOR_SHARE) in disclosure.floor


def test_measured_disclosures_name_what_is_missing():
    for key in ("characters", "difficulty"):
        disclosure = custom._reader_disclosure(custom.READER_QUESTIONS[key], "the database")
        assert "jiten" in disclosure.excluded


@pytest.mark.parametrize(
    "orm_predicate", ["VNTag.score > 0", "VNTag.spoiler_level == 0", "VNTag.lie.is_(False)"]
)
def test_live_membership_applies_the_same_filters_as_the_nightly_job(orm_predicate):
    """One definition of what carries a tag, expressed twice, checked for drift.

    Both must apply the same three filters, or the same tag would select different titles
    depending on which surface asked.
    """
    assert orm_predicate in inspect.getsource(custom.tagged_vn_ids)
    assert orm_predicate in inspect.getsource(load_tag_memberships)


def test_live_membership_walks_the_tag_tree():
    """Both paths expand children, which is what makes a broad genre mean the whole genre."""
    assert "TagParent" in inspect.getsource(custom.tag_tree_ids)
    assert "tag_parents" in inspect.getsource(load_tag_memberships)


@pytest.mark.parametrize(
    "facet,expected",
    [
        (Facet(year_min=1990, year_max=1999), "from the 1990s"),
        (Facet(year_min=1997, year_max=1997), "from 1997"),
        (Facet(year_min=2015), "from 2015 onwards"),
        (Facet(year_max=1999), "released before 2000"),
    ],
)
def test_year_ranges_read_as_english(facet, expected):
    assert custom._years_phrase(facet) == expected


def test_the_empty_slice_is_the_whole_database():
    """No axis set is not an error and not an empty ranking: it is everything."""
    assert Facet().is_empty
    assert custom.slice_conditions(Facet()) == []
    assert custom.slice_phrase(Facet(), None) == "visual novels"


def test_every_column_axis_narrows_the_slice():
    """Each axis has to reach SQL. An axis silently ignored would widen a ranking in a way
    a reader could not see, since the title would still name it."""
    for facet in (
        Facet(olang="ja"),
        Facet(year_min=2000),
        Facet(year_max=2000),
        Facet(platform="p98"),
        Facet(length=2),
        Facet(minage_max=15),
        Facet(tag=542),
        Facet(difficulty_max=2.0),
        Facet(difficulty_min=3.0),
    ):
        assert custom.slice_conditions(facet), f"{facet.canonical()} narrows nothing"


def test_column_axes_go_through_the_shared_facet_definition():
    """The nightly job and this path must agree on what a facet selects, so this one does
    not build its own column predicates."""
    source = inspect.getsource(custom.slice_conditions)
    assert "facets.predicate" in source
    assert callable(facets.predicate)


def test_the_live_path_bounds_its_own_cost():
    """The slice comes from the caller, so the scans behind it carry a ceiling."""
    source = inspect.getsource(custom.build_custom_ranking)
    assert "bound_statement_cost" in source
    assert custom.STATEMENT_TIMEOUT_MS > 0


def test_tag_id_bound_matches_the_column_it_indexes():
    """The bound is the column's range, not a guess about how many tags exist."""
    assert custom.MAX_TAG_ID == 2**31 - 1


def test_the_endpoint_bounds_every_caller_supplied_number():
    """Caller-supplied values reach SQL, so the handler constrains them rather than trusting
    the query to cope. Read off the handler's own signature, which keeps the check
    independent of where the router happens to be attached."""
    from app.api.v1.leaderboards import get_custom_ranking

    def bounds(name):
        declared = inspect.signature(get_custom_ranking).parameters[name].default
        found = {type(m).__name__: m for m in getattr(declared, "metadata", [])}
        return (
            getattr(found.get("Ge"), "ge", getattr(declared, "ge", None)),
            getattr(found.get("Le"), "le", getattr(declared, "le", None)),
        )

    assert bounds("tag") == (1, custom.MAX_TAG_ID)
    for name in ("year_min", "year_max", "year", "length", "minage_max", "limit"):
        low, high = bounds(name)
        assert low is not None and high is not None, f"{name} is unbounded"


def test_the_rating_floor_is_low_enough_for_a_narrow_slice():
    """A slice is chosen by the reader, so a floor tuned for the whole database would empty
    the narrow ones. The Bayesian pull is what keeps a thin title from topping a ranking."""
    assert custom.MIN_VOTES_FOR_RATING <= 10
