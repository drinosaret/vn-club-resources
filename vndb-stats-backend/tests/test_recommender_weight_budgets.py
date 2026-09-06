"""A weight has to decide what is fetched, not only how what was fetched is ordered.

Nine signals are weighted per request and each candidate source serves one of them, but a
source spending a fixed share of the pool whatever the request asked for leaves a slider
able to reorder a pool it had no part in choosing. Where the source serving a signal is
small, that is the difference between a control and a decoration: a studio a reader has
read repeatedly stays out of the pool however far its slider is pushed.

The tests here pin the split. The default vector must reproduce the fixed shares exactly,
since an unweighted request is the control every measured run is compared against; a
signal turned up must take budget from the rest; a signal at zero must cost no query at
all; and the broad draw, which serves no single signal, must not be able to displace a
source the reader asked for.
"""

import asyncio

import pytest

# These need SQLAlchemy to compile clauses; the minimal unit venv omits it.
pytest.importorskip("sqlalchemy")

from sqlalchemy.dialects import postgresql

from app.services import hybrid_recommender as engine
from app.services.hybrid_recommender import (
    HybridRecommender,
    retrieval_budgets,
    switch_settings,
)


class _Result:
    def __init__(self, rows):
        self._rows = list(rows)

    def all(self):
        return list(self._rows)


class _Session:
    """Records every statement it is handed and answers all of them empty."""

    def __init__(self):
        self.statements = []

    async def execute(self, statement):
        self.statements.append(statement)
        return _Result([])


def sql(statement) -> str:
    return str(statement.compile(dialect=postgresql.dialect()))


def run(coroutine):
    return asyncio.run(coroutine)


def _baseline(limit: int = 125) -> dict[str, int]:
    """The fixed shares, restated here so a drift in either copy is visible."""
    return {
        "similar": int(limit * 0.8),
        "exploration": max(50, int(limit * 0.2)) * 3,
        "elite_tag": 50,
        "description": max(0, int(limit * engine.DESC_RETRIEVAL_SHARE)),
        "cooccurrence": 100,
        "developer": engine.DEVELOPER_RETRIEVAL_LIMIT,
        "staff": engine.STAFF_RETRIEVAL_LIMIT,
        "seiyuu": engine.SEIYUU_RETRIEVAL_LIMIT,
        "trait": engine.TRAIT_RETRIEVAL_LIMIT,
    }


def _weights(**overrides) -> dict[str, float]:
    weights = dict(engine.SIGNAL_WEIGHTS)
    weights.update(overrides)
    return weights


# ---------------------------------------------------------------------------
# The default request is the control and must not move.
# ---------------------------------------------------------------------------


def test_the_default_vector_reproduces_the_fixed_shares_exactly():
    baseline = _baseline()

    assert retrieval_budgets(baseline, _weights()) == baseline


def test_a_request_naming_no_weights_reproduces_the_fixed_shares():
    baseline = _baseline()

    assert retrieval_budgets(baseline, None) == baseline


def test_the_switch_off_reproduces_the_fixed_shares(monkeypatch):
    monkeypatch.setattr(engine, "RETRIEVAL_WEIGHT_BUDGETS", False)
    baseline = _baseline()

    assert retrieval_budgets(baseline, _weights(developer=10.0)) == baseline


def test_a_vector_missing_a_signal_keeps_the_fixed_shares():
    """A partial vector describes a split of something other than this budget."""
    baseline = _baseline()
    partial = _weights()
    partial.pop("seiyuu")

    assert retrieval_budgets(baseline, partial) == baseline


# ---------------------------------------------------------------------------
# The whole budget is divided, never enlarged.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "weights",
    [
        {},
        {"developer": 10.0},
        {"developer": 0.0},
        {"description": 10.0, "tag": 0.0},
        {name: 0.1 for name in engine.SIGNAL_WEIGHTS} | {"developer": 10.0},
    ],
)
def test_the_split_spends_the_same_total_whatever_the_request(weights):
    baseline = _baseline()

    budgets = retrieval_budgets(baseline, _weights(**weights))

    assert sum(budgets.values()) == sum(baseline.values())
    assert set(budgets) == set(baseline)


# ---------------------------------------------------------------------------
# A slider that moves has to move retrieval.
# ---------------------------------------------------------------------------


def test_raising_a_signal_raises_its_own_source_and_lowers_the_others():
    baseline = _baseline()

    raised = retrieval_budgets(baseline, _weights(developer=10.0))

    assert raised["developer"] > baseline["developer"]
    for arm in ("similar", "elite_tag", "description", "cooccurrence", "staff"):
        assert raised[arm] < baseline[arm]


def test_the_budget_rises_monotonically_with_the_weight():
    baseline = _baseline()
    served = [
        retrieval_budgets(baseline, _weights(developer=float(step)))["developer"]
        for step in range(1, 11)
    ]

    assert served == sorted(served)
    assert served[-1] > served[0]


def test_a_signal_pushed_to_the_ceiling_takes_the_largest_share():
    baseline = _baseline()

    budgets = retrieval_budgets(baseline, _weights(developer=10.0))

    assert budgets["developer"] == max(budgets.values())


def test_a_reader_asking_only_for_one_signal_gets_a_pool_mostly_from_it():
    baseline = _baseline()
    quiet = _weights(**{name: 0.1 for name in engine.SIGNAL_WEIGHTS})
    quiet["developer"] = 10.0

    budgets = retrieval_budgets(baseline, quiet)

    assert budgets["developer"] > sum(budgets.values()) / 2


# ---------------------------------------------------------------------------
# Floors, so a default request keeps a mixed pool.
# ---------------------------------------------------------------------------


def test_a_lowered_signal_keeps_a_share_rather_than_being_starved():
    baseline = _baseline()

    budgets = retrieval_budgets(baseline, _weights(developer=0.01))

    assert budgets["developer"] > 0


def test_every_source_keeps_a_share_under_the_default_vector():
    baseline = _baseline()

    budgets = retrieval_budgets(baseline, _weights())

    assert all(value > 0 for value in budgets.values())


def test_zero_is_the_only_weight_that_empties_a_source():
    baseline = _baseline()

    assert retrieval_budgets(baseline, _weights(developer=0.0))["developer"] == 0


# ---------------------------------------------------------------------------
# The broad draw serves no signal, so it must not displace one that is asked for.
# ---------------------------------------------------------------------------


def test_the_broad_draw_holds_its_share_when_the_panel_is_left_alone():
    baseline = _baseline()

    budgets = retrieval_budgets(baseline, _weights())

    assert budgets["exploration"] == baseline["exploration"]


def test_the_broad_draw_cannot_outgrow_a_source_the_reader_asked_for():
    baseline = _baseline()

    budgets = retrieval_budgets(baseline, _weights(developer=10.0))

    assert budgets["developer"] > budgets["exploration"]
    # It follows the mean of the vector, so raising one weight moves it by a ninth of what
    # it moves the source that weight belongs to.
    grew = budgets["exploration"] / baseline["exploration"]
    assert grew < budgets["developer"] / baseline["developer"]


def test_one_signal_alone_spends_the_whole_budget_on_its_own_source():
    """A vector naming one signal is a request for that signal's own answer.

    The broad draw follows no signal, so left at its share it would fill the rest of the
    page with titles the named signal never reached. A list that finds forty answers is
    forty answers, not forty answers and sixty others.
    """
    baseline = _baseline()
    only = {name: 0.0 for name in engine.SIGNAL_WEIGHTS}
    only["developer"] = engine.SIGNAL_WEIGHTS["developer"]

    budgets = retrieval_budgets(baseline, only)

    assert budgets["exploration"] == 0
    assert budgets["developer"] == sum(baseline.values())
    assert all(v == 0 for k, v in budgets.items() if k != "developer")


def test_the_broad_draw_survives_a_reader_tilting_the_panel():
    """Reach does not depend on any one slider staying up, only on more than one being up."""
    baseline = _baseline()
    tilted = dict(engine.SIGNAL_WEIGHTS)
    tilted["developer"] = engine.SIGNAL_WEIGHTS["developer"] * 4

    budgets = retrieval_budgets(baseline, tilted)

    assert budgets["exploration"] > 0
    assert budgets["developer"] > baseline["developer"]


# ---------------------------------------------------------------------------
# What the split does to the statements actually issued.
# ---------------------------------------------------------------------------


def _collect(session, signal_weights, **overrides):
    recommender = HybridRecommender(session)
    arguments = dict(
        exclude_vn_ids=set(),
        limit=125,
        high_rated_vns=["v1", "v2"],
        elite_tag_ids={1, 2},
        japanese_only=False,
        spoiler_level=0,
        predicates=[],
        seed="seed",
        user_profile={"preferred_developer_ids": {"p1": 1.0}},
        signal_weights=signal_weights,
    )
    arguments.update(overrides)
    return run(recommender._collect_candidate_ids(**arguments))


def _tables(session):
    return {
        table
        for table in (
            "vn_similarities",
            "vn_cooccurrence",
            "vn_tags",
            "visual_novels",
            "release_producers",
        )
        if any(f"FROM {table}" in sql(statement) for statement in session.statements)
    }


def test_every_source_is_consulted_under_the_default_vector():
    session = _Session()

    _collect(session, _weights())

    assert _tables(session) == {
        "vn_similarities",
        "vn_cooccurrence",
        "vn_tags",
        "visual_novels",
        "release_producers",
    }


@pytest.mark.parametrize(
    "signal, table",
    [
        ("similar_games", "vn_similarities"),
        ("users_also_read", "vn_cooccurrence"),
        ("developer", "release_producers"),
    ],
)
def test_a_signal_at_no_weight_costs_no_query(signal, table):
    session = _Session()

    _collect(session, _weights(**{signal: 0.0}))

    assert table not in _tables(session)


def test_the_tag_signal_at_no_weight_costs_no_query():
    """Asserted with the similarity source silenced as well.

    The similarity source falls back to live tag matching where the precomputed table is
    thin, so it reads the same table the elite-tag draw does and a test naming only the
    table cannot tell which of them ran.
    """
    session = _Session()

    _collect(session, _weights(tag=0.0, similar_games=0.0))

    assert "vn_tags" not in _tables(session)


def _source_limit(session, table):
    """The LIMIT one source was given, read off the statement it issued."""
    for statement in session.statements:
        if f"FROM {table}" in sql(statement) and statement._limit_clause is not None:
            return statement._limit_clause.value
    raise AssertionError(f"{table} was never read")


def test_the_limit_a_source_is_given_follows_its_weight():
    raised = _Session()
    lowered = _Session()

    _collect(raised, _weights(developer=10.0))
    _collect(lowered, _weights(developer=0.2))

    assert _source_limit(raised, "release_producers") > _source_limit(
        lowered, "release_producers"
    )


def test_widening_deepens_the_split_rather_than_redrawing_it():
    narrow = _Session()
    wide = _Session()

    _collect(narrow, _weights(developer=10.0))
    _collect(wide, _weights(developer=10.0), widen=4)

    assert _source_limit(wide, "release_producers") == (
        _source_limit(narrow, "release_producers") * 4
    )


def test_a_collection_without_a_vector_reads_what_it_always_did():
    """The control path: no vector, fixed shares, every source consulted."""
    with_vector = _Session()
    without = _Session()

    _collect(with_vector, _weights())
    _collect(without, None)

    assert _tables(with_vector) == _tables(without)


def test_the_split_is_declared_as_a_switch():
    settings = switch_settings()

    for name in (
        "REC_RETRIEVAL_WEIGHT_BUDGETS",
        "REC_RETRIEVAL_WEIGHT_GAMMA",
        "REC_RETRIEVAL_ARM_FLOOR",
    ):
        assert name in settings


def test_every_weighted_signal_with_a_source_is_mapped_to_one():
    """A signal whose source is unmapped is one whose slider cannot reach retrieval."""
    mapped = set(engine.RETRIEVAL_ARM_SIGNALS.values())

    # Quality is the exception and is named here rather than left to be noticed: it is a
    # property of a title rather than a relation to the reader, so no source fetches by it.
    assert set(engine.SIGNAL_WEIGHTS) - mapped == {"quality"}
    assert set(engine.RETRIEVAL_ARM_SIGNALS) < set(engine.RETRIEVAL_ARM_ORDER)
