from datetime import date, timedelta

import pytest
import pytest_asyncio
from sqlalchemy import text

from app.db.database import async_session_maker, engine
from app.leaderboards.compute import load_community_days, load_community_pulse


@pytest_asyncio.fixture(autouse=True)
async def _fresh_pool(live_database):
    """Pooled connections belong to the loop that opened them, and each test gets its own."""
    yield
    await engine.dispose()


@pytest.mark.asyncio
async def test_pulse_windows_end_on_the_latest_vote_day():
    async with async_session_maker() as db:
        latest = await db.scalar(text("SELECT max(date) FROM global_votes"))
        if latest is None:
            pytest.skip("no vote record loaded")
        pulse = await load_community_pulse(db, 4)
    assert 1 <= len(pulse) <= 4
    starts = [date.fromisoformat(p["week"]) for p in pulse]
    # The newest window reaches the last complete day the dump covers (the dump is cut
    # part-way through its final day), and the windows tile back from it seven days
    # apart, so none of them is a partial one.
    assert starts[-1] == latest - timedelta(days=7)
    assert all(b - a == timedelta(days=7) for a, b in zip(starts, starts[1:]))
    for p in pulse:
        assert p["votes"] >= p["readers"] >= p["new_readers"] >= 0


@pytest.mark.asyncio
async def test_daily_series_covers_the_week_the_figures_describe():
    async with async_session_maker() as db:
        latest = await db.scalar(text("SELECT max(date) FROM global_votes"))
        if latest is None:
            pytest.skip("no vote record loaded")
        days = await load_community_days(db, 7)
        week = await load_community_pulse(db, 1)
    assert 1 <= len(days) <= 7
    stamps = [date.fromisoformat(d["day"]) for d in days]
    # The series ends on the last complete day the dump covers and starts inside the
    # newest weekly window, so the chart and the figures beside it describe one week.
    assert stamps[-1] == latest - timedelta(days=1)
    assert stamps[0] >= latest - timedelta(days=7)
    assert stamps == sorted(stamps)
    for d in days:
        assert d["votes"] >= d["readers"] >= d["new_readers"] >= 0
    # Summed, the days are the week.
    assert sum(d["votes"] for d in days) == week[-1]["votes"]
