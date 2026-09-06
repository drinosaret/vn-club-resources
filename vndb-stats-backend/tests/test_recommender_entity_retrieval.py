"""A weighted signal has to be able to send retrieval looking.

Developer, staff, seiyuu and character-trait affinity are scored and each carries a weight
a reader can move, but a candidate is only scored once some source has put it in the pool.
Where no source fetches by those entities, the weight reorders what the other sources found
and nothing more: a studio a reader has rated repeatedly is in the pool by accident or not
at all. The tests here pin the four arms that fetch by them.

What is asserted is the shape a source has to hold to be usable on this request path:
one statement per arm, a bound limit, the exclusion set and the reader's filters inside the
query rather than applied to its results, and the reader's own strongest affinities driving
it. The arms are also asserted silent when switched off and when the reader has no
affinities of that kind, since an unprofiled request must collect exactly what it did
before they existed.
"""

import asyncio

import pytest

# These need SQLAlchemy to compile clauses; the minimal unit venv omits it.
pytest.importorskip("sqlalchemy")

from sqlalchemy.dialects import postgresql

from app.db.models import VisualNovel
from app.services import hybrid_recommender as engine
from app.services.hybrid_recommender import HybridRecommender, switch_settings


class _Row:
    def __init__(self, **columns):
        self.__dict__.update(columns)


class _Result:
    def __init__(self, rows):
        self._rows = list(rows)

    def all(self):
        return list(self._rows)

    def scalar_one_or_none(self):
        return self._rows[0] if self._rows else None


class _Session:
    """Answers by the table a statement reads, and keeps every statement it saw.

    Dispatching on the table rather than on call order keeps a test that exercises one arm
    from depending on how many queries the rest of the profile happens to issue.
    """

    def __init__(self, rows_by_table=None):
        self.rows_by_table = dict(rows_by_table or {})
        self.statements = []

    async def execute(self, statement):
        self.statements.append(statement)
        text = sql(statement)
        for table, rows in self.rows_by_table.items():
            if f"FROM {table}" in text:
                return _Result(rows)
        return _Result([])


def sql(statement) -> str:
    return str(statement.compile(dialect=postgresql.dialect()))


def asked_entities(statement) -> list:
    """The entity ids one arm's statement asks about.

    Read off the bound parameters rather than the text: the affinity mapping is rendered
    into both the selected columns and the ordering, so the same entity appears in the
    statement more than once.
    """
    params = statement.compile(dialect=postgresql.dialect()).params
    for key, value in params.items():
        if isinstance(value, (list, tuple)) and not key.startswith("param"):
            return list(value)
    return []


def run(coroutine):
    return asyncio.run(coroutine)


FILTERS = [VisualNovel.rating >= 7.0]


def _developer_arm(session, weights, **kwargs):
    return run(
        HybridRecommender(session)._get_developer_candidates(
            weights=weights,
            exclude_vn_ids=kwargs.pop("exclude_vn_ids", {"v1"}),
            limit=kwargs.pop("limit", 60),
            filters=kwargs.pop("filters", None),
            seed="seed",
            **kwargs,
        )
    )


# ---------------------------------------------------------------------------
# Each arm is one query against the table that holds its entity.
# ---------------------------------------------------------------------------


def test_developer_arm_reads_the_release_chain_once():
    session = _Session()
    _developer_arm(session, {"p1": 2.0, "p2": 1.0})

    assert len(session.statements) == 1
    text = sql(session.statements[0])
    assert "FROM release_producers JOIN release_vn" in text
    # A studio that only published a title said nothing about how it reads.
    assert "release_producers.developer = true" in text
    assert "GROUP BY release_vn.vn_id" in text
    assert "LIMIT" in text


def test_staff_arm_reads_vn_staff_once():
    session = _Session()
    run(
        HybridRecommender(session)._get_staff_candidates(
            weights={"s1": 2.0},
            exclude_vn_ids=set(),
            limit=40,
            filters=None,
            seed="seed",
        )
    )

    assert len(session.statements) == 1
    assert "FROM vn_staff" in sql(session.statements[0])


def test_seiyuu_arm_reads_vn_seiyuu_once():
    session = _Session()
    run(
        HybridRecommender(session)._get_seiyuu_candidates(
            weights={"s1": 2.0},
            exclude_vn_ids=set(),
            limit=30,
            filters=None,
            seed="seed",
        )
    )

    assert len(session.statements) == 1
    assert "FROM vn_seiyuu" in sql(session.statements[0])


def test_trait_arm_reads_the_character_chain():
    session = _Session({"traits": [_Row(id=10), _Row(id=20)]})
    run(
        HybridRecommender(session)._get_trait_candidates(
            weights={10: 2.0, 20: 1.0},
            exclude_vn_ids=set(),
            limit=30,
            spoiler_level=0,
            filters=None,
            seed="seed",
        )
    )

    # The character-count read is a primary-key lookup over the ids already chosen; the
    # arm itself is the single statement over the trait table.
    assert len(session.statements) == 2
    assert "FROM traits" in sql(session.statements[0])
    text = sql(session.statements[1])
    assert "FROM character_traits JOIN character_vn" in text
    assert "character_traits.spoiler_level <=" in text


# ---------------------------------------------------------------------------
# What an arm asks about.
# ---------------------------------------------------------------------------


def test_entities_the_reader_argues_against_are_not_asked_about():
    """An affinity is a delta from the reader's own average, so it separates the disliked
    from the rest but not the much-read from the merely encountered: a creator whose work a
    reader returns to averages out near their own mean. Only a clearly negative affinity is
    excluded; one sitting around zero is a creator to ask about, not one to skip."""
    entities = HybridRecommender._top_entities(
        {"a": 2.0, "b": -1.0, "c": 0.0, "d": 0.5}, 10
    )

    assert "b" not in entities, "a creator the reader's own marks argue against"
    assert set(entities) == {"a", "c", "d"}


def test_a_creator_read_often_outranks_one_met_once_and_enjoyed():
    """The arm exists to fetch more of what a reader returns to, and on the mean alone the
    creator they returned to loses their place to a single good experience."""
    entities = HybridRecommender._top_entities(
        {"often": 0.02, "once": 0.60},
        1,
        {"often": 25, "once": 1},
    )

    assert list(entities) == ["often"]


def test_entities_are_capped_and_ordered_strongest_first():
    weights = {f"e{index}": float(index) for index in range(1, 30)}

    entities = HybridRecommender._top_entities(weights, 3)  # equal support throughout

    assert list(entities) == ["e29", "e28", "e27"]


def test_ties_are_settled_by_the_entity_id():
    """The same profile has to ask about the same entities, so a repeat request returns
    the same titles rather than whichever of the tied entities came out of the dict."""
    first = HybridRecommender._top_entities({"b": 1.0, "a": 1.0, "c": 1.0}, 2)
    second = HybridRecommender._top_entities({"c": 1.0, "a": 1.0, "b": 1.0}, 2)

    assert list(first) == list(second) == ["a", "b"]


def test_an_arm_asks_about_no_more_than_the_configured_entities(monkeypatch):
    monkeypatch.setattr(engine, "ENTITY_RETRIEVAL_ENTITIES", 2)
    session = _Session()

    _developer_arm(session, {"p1": 3.0, "p2": 2.0, "p3": 1.0})

    assert asked_entities(session.statements[0]) == ["p1", "p2"]


def test_a_trait_carried_by_too_much_of_the_catalogue_is_dropped():
    """A trait held by a large share of the catalogue's characters names most of it, so it
    separates nothing while the arm pays its whole scan for it."""
    session = _Session({"traits": [_Row(id=10)]})

    run(
        HybridRecommender(session)._get_trait_candidates(
            weights={10: 2.0, 20: 1.9},
            exclude_vn_ids=set(),
            limit=30,
            spoiler_level=0,
            filters=None,
            seed="seed",
        )
    )

    assert asked_entities(session.statements[1]) == [10]


def test_an_arm_with_no_selective_entity_left_issues_no_second_query():
    session = _Session({"traits": []})

    found = run(
        HybridRecommender(session)._get_trait_candidates(
            weights={10: 2.0},
            exclude_vn_ids=set(),
            limit=30,
            spoiler_level=0,
            filters=None,
            seed="seed",
        )
    )

    assert found == []
    assert len(session.statements) == 1


def test_an_arm_without_affinities_issues_no_query():
    session = _Session()

    assert _developer_arm(session, {}) == []
    assert _developer_arm(session, None) == []
    assert _developer_arm(session, {"p1": -1.0}) == []
    assert session.statements == []


def test_a_zero_budget_issues_no_query():
    """A budget of nothing is a request for nothing, not a query whose rows are discarded."""
    session = _Session()

    assert _developer_arm(session, {"p1": 1.0}, limit=0) == []
    assert session.statements == []


# ---------------------------------------------------------------------------
# The exclusion set and the reader's filters.
# ---------------------------------------------------------------------------


def test_the_exclusion_set_is_inside_the_query():
    session = _Session()

    _developer_arm(session, {"p1": 1.0}, exclude_vn_ids={"v1", "v2"})

    assert "release_vn.vn_id != ALL" in sql(session.statements[0])


@pytest.mark.parametrize(
    "arm, weights, table, rows",
    [
        ("_get_developer_candidates", {"p1": 1.0}, "release_vn", {}),
        ("_get_staff_candidates", {"s1": 1.0}, "vn_staff", {}),
        ("_get_seiyuu_candidates", {"s1": 1.0}, "vn_seiyuu", {}),
        ("_get_trait_candidates", {10: 1.0}, "character_vn", {"traits": [_Row(id=10)]}),
    ],
)
def test_filters_are_pushed_into_every_arm(arm, weights, table, rows):
    """Each arm truncates with a LIMIT, so a filter applied to what it returns can only
    subtract from an already-chosen slice."""
    session = _Session(rows)

    run(
        getattr(HybridRecommender(session), arm)(
            weights=weights,
            exclude_vn_ids=set(),
            limit=10,
            spoiler_level=0,
            filters=FILTERS,
            seed="seed",
        )
    )

    text = sql(session.statements[-1])
    assert "JOIN visual_novels" in text
    assert "visual_novels.rating >=" in text


# ---------------------------------------------------------------------------
# Producer name against producer id.
# ---------------------------------------------------------------------------


def test_developers_resolve_to_the_ids_seen_on_the_readers_own_titles():
    """Preferences are keyed by producer name and the release chain is keyed by id, and two
    producers can carry one name. Resolving from the reader's own titles keeps an affinity
    on the producer that earned it."""
    session = _Session(
        {
            "release_vn": [
                _Row(vn_id="v1", producer_id="p1", name="Studio"),
                _Row(vn_id="v2", producer_id="p2", name="Other"),
            ]
        }
    )
    recommender = HybridRecommender(session)

    developers = run(recommender._batch_get_vn_developers(["v1", "v2"]))

    assert developers == {"v1": ["Studio"], "v2": ["Other"]}
    assert recommender._producer_ids_by_name == {"Studio": {"p1"}, "Other": {"p2"}}


def test_a_name_reaching_two_producers_on_the_readers_list_reaches_both():
    session = _Session(
        {
            "release_vn": [
                _Row(vn_id="v1", producer_id="p1", name="Studio"),
                _Row(vn_id="v2", producer_id="p2", name="Studio"),
            ]
        }
    )
    recommender = HybridRecommender(session)

    developers = run(recommender._batch_get_vn_developers(["v1", "v2"]))

    # The name is listed once per title, so the profile counts one developer per title as
    # it did before the ids were recorded alongside.
    assert developers == {"v1": ["Studio"], "v2": ["Studio"]}
    assert recommender._producer_ids_by_name == {"Studio": {"p1", "p2"}}


def test_the_developer_arm_matches_on_producer_id():
    session = _Session()

    _developer_arm(session, {"p1": 1.0})

    text = sql(session.statements[0])
    assert "release_producers.producer_id IN" in text
    assert "producers.name" not in text


# ---------------------------------------------------------------------------
# Reachable off, so the change stays measurable.
# ---------------------------------------------------------------------------


def _collect(session, profile, **overrides):
    recommender = HybridRecommender(session)
    arguments = dict(
        exclude_vn_ids=set(),
        limit=10,
        high_rated_vns=None,
        elite_tag_ids=None,
        japanese_only=False,
        spoiler_level=0,
        predicates=[],
        seed="seed",
        user_profile=profile,
    )
    arguments.update(overrides)
    return run(recommender._collect_candidate_ids(**arguments))


def _profile():
    return {
        "preferred_developer_ids": {"p1": 1.0},
        "preferred_staff": {"s1": 1.0},
        "preferred_seiyuu": {"s2": 1.0},
        "preferred_traits": {10: 1.0},
    }


def _tables(session):
    return [
        table
        for table in (
            "release_producers",
            "vn_staff",
            "vn_seiyuu",
            "character_traits",
        )
        if any(f"FROM {table}" in sql(statement) for statement in session.statements)
    ]


def test_every_arm_runs_by_default():
    session = _Session({"traits": [_Row(id=10)]})

    _collect(session, _profile())

    assert _tables(session) == [
        "release_producers",
        "vn_staff",
        "vn_seiyuu",
        "character_traits",
    ]


@pytest.mark.parametrize(
    "switch, table",
    [
        ("DEVELOPER_RETRIEVAL", "release_producers"),
        ("STAFF_RETRIEVAL", "vn_staff"),
        ("SEIYUU_RETRIEVAL", "vn_seiyuu"),
        ("TRAIT_RETRIEVAL", "character_traits"),
    ],
)
def test_an_arm_switched_off_reads_nothing(monkeypatch, switch, table):
    monkeypatch.setattr(engine, switch, False)
    session = _Session({"traits": [_Row(id=10)]})

    _collect(session, _profile())

    assert table not in _tables(session)


def test_a_request_without_a_profile_collects_what_it_always_did():
    """An unprofiled caller is the control every measured run is compared against."""
    session = _Session()

    _collect(session, None)

    assert _tables(session) == []


def test_every_arm_is_declared_as_a_switch():
    settings = switch_settings()

    for name in (
        "REC_DEVELOPER_RETRIEVAL",
        "REC_STAFF_RETRIEVAL",
        "REC_SEIYUU_RETRIEVAL",
        "REC_TRAIT_RETRIEVAL",
        "REC_ENTITY_RETRIEVAL_ENTITIES",
        "REC_DEVELOPER_RETRIEVAL_LIMIT",
        "REC_STAFF_RETRIEVAL_LIMIT",
        "REC_SEIYUU_RETRIEVAL_LIMIT",
        "REC_TRAIT_RETRIEVAL_LIMIT",
        "REC_TRAIT_RETRIEVAL_MAX_CHARS",
    ):
        assert name in settings


def test_the_arms_ship_on():
    """The point of the arms is that a weighted signal becomes reachable, so an ordinary
    request has to run them."""
    settings = switch_settings()

    assert settings["REC_DEVELOPER_RETRIEVAL"] is True
    assert settings["REC_STAFF_RETRIEVAL"] is True
    assert settings["REC_SEIYUU_RETRIEVAL"] is True
