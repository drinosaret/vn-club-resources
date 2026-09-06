"""The relation table is read in two shapes: everything connected to a set of titles, and
the unread direct sequels of the titles a reader liked. Both are pinned on a stub session
so the statement each one issues is what is asserted, not a live database.
"""

import asyncio

import pytest

pytest.importorskip("sqlalchemy")

from sqlalchemy.dialects import postgresql

from app.services import recommendation_relations as relations


class _Row:
    def __init__(self, **columns):
        self.__dict__.update(columns)


class _Result:
    def __init__(self, rows):
        self._rows = list(rows)

    def all(self):
        return list(self._rows)


class _Session:
    """Answers every statement with the rows given, and keeps the statements."""

    def __init__(self, rows_per_call):
        self.rows_per_call = list(rows_per_call)
        self.statements = []

    async def execute(self, statement):
        self.statements.append(statement)
        rows = self.rows_per_call.pop(0) if self.rows_per_call else []
        return _Result(rows)


def _sql(statement) -> str:
    return str(statement.compile(dialect=postgresql.dialect()))


def _params(statement) -> dict:
    return statement.compile(dialect=postgresql.dialect()).params


def _param_values(params: dict) -> set:
    """Flattens every bound scalar and array element into one set, for membership checks."""
    values = set()
    for value in params.values():
        if isinstance(value, (list, tuple, set)):
            values.update(value)
        else:
            values.add(value)
    return values


def test_related_to_is_empty_for_an_empty_set():
    session = _Session([])
    assert asyncio.run(relations.related_to(session, set())) == set()
    assert session.statements == []


def test_related_to_reads_one_direction_and_drops_the_input():
    # The table holds every pair both ways round, so one direction reaches every
    # relation once the input is on either side of it.
    session = _Session([[_Row(related_vn_id="v2"), _Row(related_vn_id="v1"), _Row(related_vn_id="v3")]])
    related = asyncio.run(relations.related_to(session, {"v1"}))
    assert related == {"v2", "v3"}
    sql = _sql(session.statements[0])
    assert "vn_relations" in sql
    assert "related_vn_id" in sql


def test_continuations_orders_by_the_readers_mark_then_rating_and_caps():
    # Rows are (sequel, source): v10 continues v1 which the reader marked 9; v11
    # continues v2 marked 8; v12 also continues v1. v12 outrates v10.
    sequel_rows = [
        _Row(vn_id="v10", related_vn_id="v1", title="Ten", title_jp=None, title_romaji=None,
             image_url=None, image_sexual=0.0, rating=7.0),
        _Row(vn_id="v11", related_vn_id="v2", title="Eleven", title_jp=None, title_romaji=None,
             image_url=None, image_sexual=0.0, rating=9.0),
        _Row(vn_id="v12", related_vn_id="v1", title="Twelve", title_jp=None, title_romaji=None,
             image_url=None, image_sexual=0.0, rating=8.0),
    ]
    source_rows = [
        _Row(id="v1", title="One", title_jp="一", title_romaji="Ichi"),
        _Row(id="v2", title="Two", title_jp=None, title_romaji=None),
    ]
    session = _Session([sequel_rows, source_rows])
    block = asyncio.run(
        relations.continuations(
            session,
            vn_scores={"v1": 9.0, "v2": 8.0, "v3": 5.0},
            threshold=7.0,
            blocked={"v1", "v2", "v3"},
            limit=2,
        )
    )
    assert [entry["vn_id"] for entry in block] == ["v12", "v10"]
    assert block[0]["continues"] == {"vn_id": "v1", "title": "One", "title_jp": "一",
                                     "title_romaji": "Ichi", "score": 9.0}
    params = _params(session.statements[0])
    values = _param_values(params)
    assert {"preq", True, 0, "ja"} <= values
    # The liked source ids drive the IN clause and the blocked ids the NOT IN clause.
    assert {"v1", "v2"} <= values
    assert {"v1", "v2", "v3"} <= values


def test_continuations_omits_the_language_filter_when_not_japanese_only():
    session = _Session([[], []])
    asyncio.run(
        relations.continuations(
            session, vn_scores={"v1": 9.0}, threshold=7.0, blocked=set(), japanese_only=False
        )
    )
    sql = _sql(session.statements[0])
    assert "olang" not in sql


def test_continuations_treats_a_missing_rating_as_lowest():
    # Same source, same reader mark: the rated sequel outranks the one with no rating.
    sequel_rows = [
        _Row(vn_id="v20", related_vn_id="v1", title="Twenty", title_jp=None, title_romaji=None,
             image_url=None, image_sexual=0.0, rating=None),
        _Row(vn_id="v21", related_vn_id="v1", title="Twenty-one", title_jp=None, title_romaji=None,
             image_url=None, image_sexual=0.0, rating=8.0),
    ]
    source_rows = [_Row(id="v1", title="One", title_jp=None, title_romaji=None)]
    session = _Session([sequel_rows, source_rows])
    block = asyncio.run(
        relations.continuations(session, vn_scores={"v1": 9.0}, threshold=7.0, blocked=set())
    )
    assert [entry["vn_id"] for entry in block] == ["v21", "v20"]


def test_continuations_excludes_the_readers_own_titles_even_when_not_blocked():
    # A liked title that is itself the sequel of another liked title stays out of the
    # result, whether or not the caller's own blocklist happens to name it.
    session = _Session([[]])
    asyncio.run(
        relations.continuations(session, vn_scores={"v1": 9.0, "v2": 8.0}, threshold=7.0, blocked=set())
    )
    values = _param_values(_params(session.statements[0]))
    assert {"v1", "v2"} <= values


def test_continuations_needs_a_liked_title():
    session = _Session([])
    assert asyncio.run(relations.continuations(session, vn_scores={"v1": 5.0}, threshold=7.0, blocked=set())) == []
    assert session.statements == []
