"""The character search breaks ties between equal name matches by the best-known title.

A short given name is shared by dozens of characters, and the ranking cannot tell them
apart by name. The one being typed is far more often the heroine of a title with
thousands of votes than a bit part in one with a handful, so that is the tie-break.
"""

import asyncio
import inspect

from fastapi import params


class _Rows:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return self

    def all(self):
        return list(self._rows)


class _RecordingSession:
    """Keeps every statement for inspection.

    The title lookups run first and their ids are bound into the search, so they answer
    with a row rather than nothing: an empty set compiles away and the branch under test
    would disappear from the statement.
    """

    def __init__(self, words=1, title_ids=("c1",)):
        self.statements = []
        self._words = words
        self._title_ids = list(title_ids)

    async def execute(self, statement):
        self.statements.append(statement)
        # The per-word title lookups come first and hand back ids; the ranked search that
        # follows answers with nothing, so no row has to stand in for a character.
        if len(self.statements) <= self._words:
            return _Rows(self._title_ids)
        return _Rows([])


def _search_statement(session):
    """The ranked search, which the per-word title lookups precede."""
    return session.statements[-1]


def _order_by_sql(statement) -> str:
    from sqlalchemy.dialects import postgresql

    compiled = str(statement.compile(dialect=postgresql.dialect()))
    return compiled.split("ORDER BY", 1)[1]


def test_equal_name_matches_are_ordered_by_their_best_known_title(monkeypatch):
    import app.api.v1.characters as api

    class _NoCache:
        async def get(self, key):
            return None

        async def set(self, key, value, ttl=None):
            return None

    monkeypatch.setattr(api, "get_cache", lambda: _NoCache())

    raw = inspect.unwrap(api.search_characters)
    defaults = {
        name: parameter.default.default
        for name, parameter in inspect.signature(raw).parameters.items()
        if isinstance(parameter.default, params.Query)
    }
    session = _RecordingSession(words=1)
    asyncio.run(raw(db=session, **{**defaults, "q": "marie"}))

    order = _order_by_sql(_search_statement(session))
    votes = order.index("max(visual_novels.votecount)")
    titles = order.index("count(DISTINCT character_vn.vn_id)")
    name = order.index("characters.name ASC")
    # Relevance leads, then the best title's votes, then how many titles, then the name.
    assert votes < titles < name


def test_every_word_must_match_a_name_or_a_title(monkeypatch):
    # "marie oppai": the first word is the name, the second is only in the title, and a
    # namesake from another title has to fail on the second word.
    import app.api.v1.characters as api

    class _NoCache:
        async def get(self, key):
            return None

        async def set(self, key, value, ttl=None):
            return None

    monkeypatch.setattr(api, "get_cache", lambda: _NoCache())

    raw = inspect.unwrap(api.search_characters)
    defaults = {
        name: parameter.default.default
        for name, parameter in inspect.signature(raw).parameters.items()
        if isinstance(parameter.default, params.Query)
    }
    session = _RecordingSession(words=2)
    asyncio.run(raw(db=session, **{**defaults, "q": "marie oppai"}))

    from sqlalchemy.dialects import postgresql

    # One title lookup per word, then the ranked search over what they matched.
    assert len(session.statements) == 3
    titles = " ".join(
        str(st.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))
        for st in session.statements[:2]
    )
    assert "%marie%" in titles and "%oppai%" in titles, "each word is looked up in the titles"

    compiled = _search_statement(session).compile(
        dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}
    )
    where = str(compiled).split("WHERE", 1)[1].split("ORDER BY", 1)[0]
    # Each word matches the name in either script or the ids its titles matched, and the
    # words are required together rather than offered as alternatives.
    assert where.count("%marie%") == 2 and where.count("%oppai%") == 2
    assert where.count("characters.id = ANY") == 2, "one id branch per word, bound as one array"
    assert " AND " in where
