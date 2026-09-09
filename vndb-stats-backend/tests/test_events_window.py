"""Tests for the calendar window the Discord mirror reads.

get_upcoming_merged deliberately caps its weekly placeholders so the site
sidebar is not filled with repeats, which makes it unusable for a horizon of
weeks. get_window_merged walks the months instead; these guard that it covers
the range without doubling anything up.
"""

from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio

from app.services import event_mirror as em
from app.services import events_service as es


@pytest_asyncio.fixture
async def fresh_pool(live_database):
    """Pooled connections belong to the loop that opened them, and each test gets
    its own."""
    from app.db.database import engine

    yield
    await engine.dispose()


def test_a_window_inside_one_month_spans_that_month():
    start = datetime(2026, 9, 7, tzinfo=timezone.utc)
    assert es._months_spanned(start, start + timedelta(days=10)) == [(2026, 9)]


def test_a_window_crossing_a_month_spans_both():
    start = datetime(2026, 9, 20, tzinfo=timezone.utc)
    assert es._months_spanned(start, start + timedelta(days=30)) == [(2026, 9), (2026, 10)]


def test_a_window_crossing_a_year_rolls_over():
    start = datetime(2026, 12, 20, tzinfo=timezone.utc)
    assert es._months_spanned(start, start + timedelta(days=20)) == [(2026, 12), (2027, 1)]


def test_an_item_is_in_the_window_while_it_has_not_ended():
    start = datetime(2026, 9, 7, tzinfo=timezone.utc)
    end = start + timedelta(days=30)
    running = {"start_at": "2026-09-01T00:00:00+00:00", "end_at": "2026-09-30T23:59:00+00:00"}
    finished = {"start_at": "2026-08-01T00:00:00+00:00", "end_at": "2026-08-31T23:59:00+00:00"}
    later = {"start_at": "2026-11-01T00:00:00+00:00", "end_at": None}
    assert es._overlaps(running, start, end)
    assert not es._overlaps(finished, start, end)
    assert not es._overlaps(later, start, end)


def test_an_unreadable_timestamp_is_not_placed_in_the_window():
    start = datetime(2026, 9, 7, tzinfo=timezone.utc)
    assert not es._overlaps({"start_at": "not a date"}, start, start + timedelta(days=30))


@pytest.mark.asyncio
async def test_the_window_covers_every_weekly_slot_in_range(fresh_pool):
    """The reason this exists: the upcoming feed shows two movie nights and one
    roudoku however far ahead it is asked to look."""
    from app.db.database import async_session_maker

    now = datetime.now(timezone.utc)
    async with async_session_maker() as db:
        window = await es.get_window_merged(db, now, now + em.HORIZON)
        upcoming = await es.get_upcoming_merged(db, now)

    def weekly(items):
        return sum(1 for i in items if i["event_type"] in ("movie_night", "roudoku"))

    assert weekly(window) > weekly(upcoming)
    assert weekly(window) >= 6


@pytest.mark.asyncio
async def test_no_two_items_in_the_window_claim_one_identity(fresh_pool):
    """A repeated sync key would mean two calendar items fighting over one
    Discord event, rewriting it against each other every tick."""
    from app.db.database import async_session_maker

    now = datetime.now(timezone.utc)
    async with async_session_maker() as db:
        window = await es.get_window_merged(db, now, now + em.HORIZON)

    keys = [em.sync_key(i) for i in window if i["event_type"] in em.STYLES]
    assert None not in keys
    assert len(keys) == len(set(keys))


@pytest.mark.asyncio
async def test_the_plan_stays_inside_the_horizon(fresh_pool):
    from app.db.database import async_session_maker

    now = datetime.now(timezone.utc)
    async with async_session_maker() as db:
        window = await es.get_window_merged(db, now, now + em.HORIZON)

    for entry in em.plan(window, em.MirrorConfig(), now):
        assert entry.start_at < now + em.HORIZON
        assert entry.end_at > now


def test_an_open_ended_item_stays_in_the_window_past_its_midnight_start():
    """A weekly slot is an all-day row at midnight with no end; the session it
    stands for is hours later, and it must still be read that morning."""
    now = datetime(2026, 9, 13, 10, 0, tzinfo=timezone.utc)
    slot = {"start_at": "2026-09-13T00:00:00+00:00", "end_at": None}
    assert es._overlaps(slot, now, now + timedelta(days=30))
