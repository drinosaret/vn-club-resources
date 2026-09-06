"""Which readers the nightly recommendation refresh covers, and in what order.

The audience is the whole risk in this job. Scoring the wrong set writes pages nobody
reads onto a host with a disk budget, and a page rewritten on a schedule outlives the
retention sweep, so a run's audience is a floor under the cache table rather than a
tenancy that expires.
"""

import asyncio

from sqlalchemy.dialects import postgresql

from app.ingestion import precompute_user_recs as mod


def _sql(statement) -> str:
    return str(statement.compile(dialect=postgresql.dialect()))


def test_readers_are_taken_from_the_cache_table():
    # The cache table is the only record of who has asked this site for recommendations.
    # The votes dump answers a different question: who is voting on VNDB at all.
    sql = _sql(mod.cached_reader_query())
    assert "user_recommendation_cache" in sql
    assert "global_votes" not in sql


def test_one_row_per_reader():
    # A reader holds a page, not a row, so an ungrouped select would name each of them
    # once per cached title and score them that many times.
    sql = _sql(mod.cached_reader_query())
    assert "GROUP BY user_recommendation_cache.user_id" in sql


def test_the_oldest_page_is_refreshed_first():
    # Decides who a capped run covers: a reader the cap excluded is older on the next
    # run and moves to the front. Ordering the other way would starve them permanently.
    sql = _sql(mod.cached_reader_query())
    assert "ORDER BY min(user_recommendation_cache.updated_at) ASC" in sql


def test_the_cap_reaches_the_query():
    # Applying it after the rows arrive would still read every reader on the host.
    assert "LIMIT" not in _sql(mod.cached_reader_query())
    assert "LIMIT" in _sql(mod.cached_reader_query(limit=5))


def _run_over(monkeypatch, audience, max_users=None):
    """Run the entry point with the scoring and sweep stubbed, recording who was scored."""
    scored: list[str] = []

    async def _refuse_active_users(*args, **kwargs):
        raise AssertionError("a named audience must not fall back to the votes dump")

    async def _score(user_id: str) -> int:
        scored.append(user_id)
        return 1

    async def _no_sweep(*args, **kwargs) -> int:
        return 0

    monkeypatch.setattr(mod, "get_active_users", _refuse_active_users)
    monkeypatch.setattr(mod, "process_single_user", _score)
    monkeypatch.setattr(mod, "cleanup_stale_cache", _no_sweep)

    stats = asyncio.run(
        mod.precompute_user_recommendations(max_users=max_users, user_ids=audience)
    )
    return scored, stats


def test_a_named_audience_is_scored_as_given(monkeypatch):
    scored, stats = _run_over(monkeypatch, ["u1", "u2", "u3"])
    assert scored == ["u1", "u2", "u3"]
    assert stats["users_processed"] == 3


def test_max_users_truncates_a_named_audience(monkeypatch):
    scored, _ = _run_over(monkeypatch, ["u1", "u2", "u3"], max_users=2)
    assert scored == ["u1", "u2"]


def test_an_empty_audience_scores_nobody(monkeypatch):
    # Distinct from naming none at all, which is what selects every active VNDB account.
    scored, stats = _run_over(monkeypatch, [])
    assert scored == []
    assert stats["users_processed"] == 0
