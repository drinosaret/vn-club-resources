"""Tests for the computed (recurring) calendar events.

recurring_events.py is pure, deterministic date logic (no DB, no network) that
feeds the public /events calendar, so a regression here would silently corrupt it.
"""

from app.services import recurring_events as r


def test_saturdays_in_month():
    # June 2026: Saturdays fall on the 6th, 13th, 20th, 27th.
    assert [d.day for d in r._saturdays_in_month(2026, 6)] == [6, 13, 20, 27]


def test_december_vn_month_voting_rolls_to_january():
    # December's calendar shows next January's VN-of-the-Month voting window, so the
    # title + key must roll the year over.
    vm = [e for e in r.for_month(2026, 12) if e["event_type"] == "vn_month_voting"]
    assert len(vm) == 1
    assert "January" in vm[0]["title"]
    assert vm[0]["external_key"] == "auto:vn_month_voting:2027-01"


def test_equinox_days_2026():
    assert r._spring_equinox_day(2026) == 20
    assert r._autumn_equinox_day(2026) == 23


def test_synthetic_ids_negative_and_unique():
    # Synthetic ids must be negative (never collide with positive DB rows) and unique.
    ids = [e["id"] for e in r.for_month(2026, 1)]
    assert ids
    assert all(i < 0 for i in ids)
    assert len(ids) == len(set(ids))


def test_skip_movie_dates_suppresses_placeholder():
    # A Saturday that already has a stored Movie Night row drops its synthetic placeholder.
    base = [e for e in r.for_month(2026, 6) if e["event_type"] == "movie_night"]
    assert base
    skip = base[0]["start_at"][:10]  # YYYY-MM-DD
    after = r.for_month(2026, 6, skip_movie_dates={skip})
    remaining = [e["start_at"][:10] for e in after if e["event_type"] == "movie_night"]
    assert skip not in remaining
    assert len(remaining) == len(base) - 1
