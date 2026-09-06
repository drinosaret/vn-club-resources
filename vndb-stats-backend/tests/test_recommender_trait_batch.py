"""Character traits for a pool of candidates, counted once per title.

The count is how many characters in a title carry a trait, and a title that repeats a
trait the reader favours scores above one that touches it once, so collapsing repeats
would silently flatten the signal. The pairs behind that tally run to hundreds of
thousands for a full pool, which is why they are collected per title in the database
rather than returned one pair at a time.
"""

import asyncio

import pytest

# These need SQLAlchemy to compile clauses; the minimal unit venv omits it.
pytest.importorskip("sqlalchemy")

from sqlalchemy.dialects import postgresql

from app.services.hybrid_recommender import HybridRecommender


class _Row:
    def __init__(self, **columns):
        self.__dict__.update(columns)


class _Result:
    def __init__(self, rows):
        self._rows = list(rows)

    def all(self):
        return list(self._rows)


class _Session:
    def __init__(self, rows):
        self.rows = rows
        self.statements = []

    async def execute(self, statement):
        self.statements.append(statement)
        return _Result(self.rows)


def load(rows, **kwargs):
    session = _Session(rows)
    traits = asyncio.run(
        HybridRecommender(session)._batch_get_vn_traits(["v1", "v2"], **kwargs)
    )
    return traits, session


def sql(statement) -> str:
    return str(statement.compile(dialect=postgresql.dialect()))


def test_repeats_within_a_title_become_the_count():
    traits, _ = load(
        [
            _Row(vn_id="v1", trait_ids=[10, 10, 10, 22]),
            _Row(vn_id="v2", trait_ids=[22]),
        ]
    )

    assert traits == {"v1": {10: 3, 22: 1}, "v2": {22: 1}}


def test_a_title_the_query_did_not_return_is_absent_rather_than_empty():
    traits, _ = load([_Row(vn_id="v1", trait_ids=[10])])

    assert "v2" not in traits


def test_the_pairs_are_collected_per_title_in_the_database():
    _, session = load([_Row(vn_id="v1", trait_ids=[10])])

    text = sql(session.statements[0])
    assert "array_agg" in text
    assert "GROUP BY" in text


def test_the_spoiler_level_asked_for_bounds_the_query():
    _, session = load([_Row(vn_id="v1", trait_ids=[10])], spoiler_level=2)

    assert session.statements[0].compile(dialect=postgresql.dialect()).params[
        "spoiler_level_1"
    ] == 2


def test_nothing_is_asked_for_an_empty_pool():
    session = _Session([])
    traits = asyncio.run(HybridRecommender(session)._batch_get_vn_traits([]))

    assert traits == {}
    assert session.statements == []
