"""Parameter-safe IN / NOT IN helpers for large id sets.

asyncpg caps a single statement at 32767 bind parameters, and SQLAlchemy's
``Column.in_([...])`` / ``.notin_([...])`` emit one bind parameter per element.
A large set (for example a user's entire VNDB blacklist, which can run to tens
of thousands of ids) overflows that limit and the query raises InterfaceError.

These helpers pass the id collection as a single PostgreSQL array parameter
(``col = ANY(:arr)`` / ``col <> ALL(:arr)``), so the bound-parameter count stays
at one regardless of how large the set is.
"""
from collections.abc import Collection

from sqlalchemy import ColumnElement, String, all_, any_, false, literal, true
from sqlalchemy.dialects.postgresql import ARRAY


def not_in_ids(column, ids: Collection[str]) -> ColumnElement[bool]:
    """``column NOT IN ids``, safe for arbitrarily large id sets.

    Returns a tautology when ``ids`` is empty (matching ``~col.in_([])``).
    """
    ids = list(ids)
    if not ids:
        return true()
    return column != all_(literal(ids, type_=ARRAY(String)))


def in_ids(column, ids: Collection[str]) -> ColumnElement[bool]:
    """``column IN ids``, safe for arbitrarily large id sets.

    Returns a contradiction when ``ids`` is empty (matching ``col.in_([])``).
    """
    ids = list(ids)
    if not ids:
        return false()
    return column == any_(literal(ids, type_=ARRAY(String)))
