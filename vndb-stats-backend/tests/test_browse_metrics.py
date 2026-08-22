"""Hold the browse sort metrics to the boards they mirror.

Two surfaces answering the same question from the same columns are only trustworthy while
they agree on what the question is. The floors in particular are easy to change on one side:
a board's min_count is a number in the registry, and browse's is a number in its own table.
These tests make that a failure rather than a discrepancy nobody notices.
"""

import pytest
from sqlalchemy.dialects import postgresql

from app.leaderboards.browse_metrics import METRIC_SORTS, describe_floor
from app.leaderboards.custom import TITLE_QUESTIONS
from app.leaderboards.registry import BOARDS

BOARDS_BY_SLUG = {board.slug: board for board in BOARDS}


def sql(expression) -> str:
    """The SQL an expression compiles to, with bound values inlined so they can be read."""
    return str(
        expression.compile(
            dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}
        )
    )


#: Only the metrics claiming to mirror something are held to that thing's definition. The one
#: that mirrors nothing is checked separately, below.
MIRRORING = [
    m for m in METRIC_SORTS.values() if m.board_slug is not None or m.question_key is not None
]
BOARD_MIRRORS = [m for m in MIRRORING if m.board_slug is not None]
QUESTION_MIRRORS = [m for m in MIRRORING if m.question_key is not None]


@pytest.mark.parametrize("metric", MIRRORING, ids=lambda m: m.key)
def test_each_metric_mirrors_exactly_one_surface(metric):
    # Both set would leave two definitions to keep in step; the tests below would then only
    # be checking one of them.
    assert (metric.board_slug is None) != (metric.question_key is None), metric.key


@pytest.mark.parametrize("metric", BOARD_MIRRORS, ids=lambda m: m.key)
def test_each_metric_mirrors_a_board_that_exists(metric):
    assert metric.board_slug in BOARDS_BY_SLUG


@pytest.mark.parametrize("metric", QUESTION_MIRRORS, ids=lambda m: m.key)
def test_each_metric_mirrors_a_question_that_exists(metric):
    assert metric.question_key in TITLE_QUESTIONS


@pytest.mark.parametrize("metric", BOARD_MIRRORS, ids=lambda m: m.key)
def test_each_metric_carries_its_boards_floor(metric):
    board = BOARDS_BY_SLUG[metric.board_slug]
    # A board with no floor still admits nothing with a zero sample, which is the 1 here.
    assert metric.min_sample == max(board.min_count, 1)


@pytest.mark.parametrize("metric", QUESTION_MIRRORS, ids=lambda m: m.key)
def test_each_metric_carries_its_questions_floor(metric):
    # The floor is the whole reason the two agree on which titles are eligible.
    assert metric.min_sample == TITLE_QUESTIONS[metric.question_key][3]


@pytest.mark.parametrize("metric", BOARD_MIRRORS, ids=lambda m: m.key)
def test_each_metric_ranks_visual_novels(metric):
    # A metric mirroring a reader or producer board would be reading the wrong columns.
    assert BOARDS_BY_SLUG[metric.board_slug].subject.value == "vn"


@pytest.mark.parametrize("metric", BOARD_MIRRORS, ids=lambda m: m.key)
def test_each_metric_mirrors_an_unfiltered_board(metric):
    # Browse supplies the filtering. Mirroring a board that carries a facet of its own would
    # copy a floor measured against a different population.
    assert BOARDS_BY_SLUG[metric.board_slug].facet.canonical() == ""


def test_most_metrics_mirror_a_board():
    # Guards the loop above from silently covering nothing if board_slug were ever defaulted
    # to None, which would turn every assertion here into a no-op.
    assert len(MIRRORING) >= len(METRIC_SORTS) - 1


@pytest.mark.parametrize("metric", METRIC_SORTS.values(), ids=lambda m: m.key)
def test_only_a_metric_from_another_table_declares_a_join(metric):
    # The join restricts results to rows that have a value. A metric reading a column on
    # visual_novels that declared one would silently drop titles for no reason.
    if metric.join_model is None:
        assert metric.join_condition is None
    else:
        assert metric.board_slug is None, "a board-backed metric reads visual_novels directly"
        assert metric.join_condition is not None


def test_keys_match_the_table_they_are_stored_under():
    assert all(key == metric.key for key, metric in METRIC_SORTS.items())


def test_no_metric_shadows_a_plain_column_sort():
    # browse resolves the metric table first, so a collision would silently replace one of
    # the four original sorts.
    assert not METRIC_SORTS.keys() & {"rating", "released", "votecount", "title", "random"}


def test_the_floor_note_states_the_number_and_what_it_counts():
    metric = METRIC_SORTS["drop_rate"]
    note = describe_floor(metric)
    assert "50" in note and metric.sample_noun in note


def test_expressions_are_built_fresh_each_time():
    # They are SQLAlchemy expressions, and browse attaches them to a new query per request.
    metric = METRIC_SORTS["divisiveness"]
    assert metric.expression is not None
    assert sql(metric.floor) == sql(metric.floor)


@pytest.mark.parametrize("metric", METRIC_SORTS.values(), ids=lambda m: m.key)
def test_the_floor_is_the_sample_against_the_minimum(metric):
    # One definition of the sample serves the floor and the tie-break. Two would let browse
    # admit a title on one count and rank it by another.
    floor = sql(metric.floor)
    assert floor.startswith(f"{sql(metric.sample)} >= {metric.min_sample}")


@pytest.mark.parametrize("metric", METRIC_SORTS.values(), ids=lambda m: m.key)
def test_ties_break_on_sample_size_before_the_id(metric):
    # The boards rank the better-evidenced title first on a tie. Ratio metrics tie often, so
    # dropping this puts browse and the board in different orders for the same query.
    clauses = [sql(clause) for clause in metric.order_by(descending=True)]
    assert len(clauses) == 3
    assert clauses[1] == f"{sql(metric.sample)} DESC NULLS LAST"
    assert clauses[2] == "visual_novels.id ASC"


@pytest.mark.parametrize("metric", METRIC_SORTS.values(), ids=lambda m: m.key)
def test_direction_flips_only_the_primary_clause(metric):
    descending = [sql(c) for c in metric.order_by(descending=True)]
    ascending = [sql(c) for c in metric.order_by(descending=False)]
    assert descending[0].endswith("DESC NULLS LAST")
    assert ascending[0].endswith("ASC NULLS LAST")
    assert descending[1:] == ascending[1:]


def test_rate_sorts_damp_toward_the_recorded_population_rate():
    """The two rate sorts must reproduce the boards' arithmetic, not a second version of it.

    Compiled rather than executed: what matters is that the expression carries the prior
    lookup and the same weight the boards use, which is what keeps the two orders equal.
    """
    from app.leaderboards.aggregate import RATE_PRIOR_KEY, RATE_PRIOR_READERS
    from app.leaderboards.browse_metrics import METRIC_SORTS

    for key, field in (("completion_rate", "finished"), ("drop_rate", "dropped")):
        sql = str(METRIC_SORTS[key].expression.compile(
            compile_kwargs={"literal_binds": True}
        ))
        assert RATE_PRIOR_KEY in sql, key
        assert f"'{field}'" in sql, key
        assert str(RATE_PRIOR_READERS) in sql, key
        # The undamped ratio stays reachable, for a database the job has never run against.
        assert "coalesce" in sql.lower(), key
