import pytest

# These tests need SQLAlchemy to compile clauses; the minimal unit venv omits
# it, so skip there. The full suite (Docker/CI) runs them.
pytest.importorskip("sqlalchemy")

from sqlalchemy import Column, String
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import declarative_base

from app.db.query_utils import in_ids, not_in_ids

Base = declarative_base()


class _Row(Base):
    __tablename__ = "_row"
    id = Column(String, primary_key=True)


def _params(clause) -> dict:
    return clause.compile(dialect=postgresql.dialect()).params


def test_not_in_ids_binds_large_set_as_single_param():
    # The whole id set must bind as ONE array parameter, never one-per-id,
    # otherwise asyncpg's 32767-parameter limit is exceeded and the query 500s.
    ids = [f"v{i}" for i in range(50000)]
    clause = not_in_ids(_Row.id, ids)
    assert len(_params(clause)) == 1
    assert "ALL" in str(clause.compile(dialect=postgresql.dialect()))


def test_in_ids_binds_large_set_as_single_param():
    ids = [f"v{i}" for i in range(50000)]
    clause = in_ids(_Row.id, ids)
    assert len(_params(clause)) == 1
    assert "ANY" in str(clause.compile(dialect=postgresql.dialect()))


def test_not_in_ids_empty_is_tautology():
    assert len(_params(not_in_ids(_Row.id, []))) == 0


def test_in_ids_empty_is_contradiction():
    assert len(_params(in_ids(_Row.id, []))) == 0
