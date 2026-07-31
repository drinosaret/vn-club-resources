"""Tests for the computed (recurring) calendar events.

recurring_events.py is pure, deterministic date logic (no DB, no network) that
feeds the public /events calendar, so a regression here would silently corrupt it.
"""

from datetime import datetime, timezone

from app.services import recurring_events as r


def test_saturdays_in_month():
    # June 2026: Saturdays fall on the 6th, 13th, 20th, 27th.
    assert [d.day for d in r._saturdays_in_month(2026, 6)] == [6, 13, 20, 27]


def test_sundays_in_month():
    # June 2026: Sundays fall on the 7th, 14th, 21st, 28th.
    assert [d.day for d in r._weekdays_in_month(2026, 6, r.ROUDOKU_WEEKDAY)] == [7, 14, 21, 28]


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
    # January carries every rule at once: both voting windows, movie nights,
    # roudoku, a season start, holidays and an anniversary, so this is the
    # regression test for a new _TYPE_ code colliding with an existing one.
    events = r.for_month(2026, 1)
    types = {e["event_type"] for e in events}
    assert {"movie_night", "roudoku", "season_start", "holiday"} <= types
    ids = [e["id"] for e in events]
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


def test_roudoku_placeholder_on_every_sunday():
    events = [e for e in r.for_month(2026, 6) if e["event_type"] == "roudoku"]
    assert [e["start_at"][:10] for e in events] == [
        "2026-06-07",
        "2026-06-14",
        "2026-06-21",
        "2026-06-28",
    ]
    assert all(e["all_day"] and e["created_by"] == "auto" for e in events)


def test_skip_roudoku_dates_suppresses_placeholder():
    after = r.for_month(2026, 6, skip_roudoku_dates={"2026-06-14"})
    remaining = [e["start_at"][:10] for e in after if e["event_type"] == "roudoku"]
    assert remaining == ["2026-06-07", "2026-06-21", "2026-06-28"]


def test_skip_sets_do_not_cross_contaminate():
    # A stored movie night must not hide a roudoku slot, or vice versa. The two
    # weekdays differ today, but the skip sets are date-keyed, so a shared date
    # (a one-off session moved onto a Saturday) has to stay independent.
    shared = "2026-06-13"
    out = r.for_month(2026, 6, skip_movie_dates={shared}, skip_roudoku_dates=set())
    assert shared not in [e["start_at"][:10] for e in out if e["event_type"] == "movie_night"]
    assert len([e for e in out if e["event_type"] == "roudoku"]) == 4

    out = r.for_month(2026, 6, skip_movie_dates=set(), skip_roudoku_dates={"2026-06-07"})
    assert len([e for e in out if e["event_type"] == "movie_night"]) == 4


def test_moved_movie_night_suppresses_its_weeks_placeholder():
    # A session shifted off its usual weekday (Sat 2026-07-25 held on Sun the 26th)
    # still belongs to that week, so the Saturday placeholder must go and no other
    # Saturday may be affected.
    out = r.for_month(2026, 7, skip_movie_dates={"2026-07-26"})
    assert [e["start_at"][:10] for e in out if e["event_type"] == "movie_night"] == [
        "2026-07-04",
        "2026-07-11",
        "2026-07-18",
    ]


def test_moved_session_claims_only_the_nearest_slot():
    # Every date is within SLOT_MATCH_DAYS of exactly one Saturday, so a move in
    # either direction drops one placeholder, never two and never the wrong week.
    for moved, gone in (
        ("2026-07-15", "2026-07-18"),  # Wed, 3 days early
        ("2026-07-17", "2026-07-18"),  # Fri, 1 day early
        ("2026-07-21", "2026-07-18"),  # Tue, 3 days late
        ("2026-07-22", "2026-07-25"),  # Wed, 4 days late -> the next Saturday
    ):
        remaining = [
            e["start_at"][:10]
            for e in r.for_month(2026, 7, skip_movie_dates={moved})
            if e["event_type"] == "movie_night"
        ]
        assert gone not in remaining
        assert len(remaining) == 3


def test_moved_roudoku_suppresses_its_weeks_placeholder():
    # Same rule on the Sunday anchor: a roudoku held on the Saturday instead.
    out = r.for_month(2026, 6, skip_roudoku_dates={"2026-06-13"})
    assert [e["start_at"][:10] for e in out if e["event_type"] == "roudoku"] == [
        "2026-06-07",
        "2026-06-21",
        "2026-06-28",
    ]


def test_upcoming_respects_a_moved_session():
    now = datetime(2026, 7, 20, 12, 0, tzinfo=timezone.utc)  # a Monday
    assert [e["start_at"][:10] for e in r.upcoming(now) if e["event_type"] == "movie_night"] == [
        "2026-07-25",
        "2026-08-01",
    ]
    moved = r.upcoming(now, skip_movie_dates={"2026-07-26"})
    assert [e["start_at"][:10] for e in moved if e["event_type"] == "movie_night"] == ["2026-08-01"]


def test_upcoming_includes_roudoku_and_respects_the_skip():
    now = datetime(2026, 6, 10, 12, 0, tzinfo=timezone.utc)  # a Wednesday
    upcoming = r.upcoming(now)
    dates = [e["start_at"][:10] for e in upcoming if e["event_type"] == "roudoku"]
    assert dates == ["2026-06-14"]  # ROUDOKU_UPCOMING_COUNT == 1

    skipped = r.upcoming(now, skip_roudoku_dates={"2026-06-14"})
    assert not [e for e in skipped if e["event_type"] == "roudoku"]
