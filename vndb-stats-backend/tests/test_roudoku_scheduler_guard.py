"""The scheduler must stay inert until Weekly Roudoku is actually set up.

Weekly Roudoku ships with a default weekday (Movie Night does not), so without
an explicit guard a single member nomination on a fresh install would arm a
session and let the deadline auto-pick publish a VN to the PUBLIC vnclub.org
calendar with no channel, no announcement and no admin involvement.
"""

import inspect
import re

import pytest

# Skip on the module this actually needs, not just on discord: the API image
# ships discord but does not mount discord_bot/, so guarding on "discord" alone
# turns into a collection error there (which fails CI and blocks the deploy).
roudoku = pytest.importorskip("discord_bot.cogs.roudoku")


def _tick_source() -> str:
    return inspect.getsource(roudoku.RoudokuCog._tick)


def test_tick_returns_early_when_nothing_is_configured():
    src = _tick_source()
    assert "if not (self._channel_id or cycle.channel_id):" in src, (
        "the not-in-use guard is missing; a fresh install would self-arm"
    )


def test_guard_runs_before_the_session_is_armed():
    """Order matters: arming happens further down, so the guard has to precede it."""
    src = _tick_source()
    guard = src.index("if not (self._channel_id or cycle.channel_id):")
    arm = src.index("await self.set_session(None)")
    pick = src.index("await self._do_pick(")
    assert guard < arm, "guard must come before the session is auto-armed"
    assert guard < pick, "guard must come before the deadline auto-pick"


def test_default_weekday_is_sunday():
    assert roudoku.DEFAULT_SHOW_WEEKDAY == 6


def test_publishing_still_requires_a_session_date():
    """pick_winner only publishes when a session is set; keep that coupling."""
    from app.services import roudoku_service as rd

    src = inspect.getsource(rd.pick_winner)
    assert "if cycle.scheduled_for:" in src


def test_vote_lead_is_a_positive_timedelta():
    assert roudoku.VOTE_LEAD.total_seconds() > 0
    # A lead longer than the weekly cadence would clamp every single round.
    assert roudoku.VOTE_LEAD.days < 7


def test_auto_reset_is_after_the_session_not_before():
    assert roudoku.AUTO_RESET_AFTER.total_seconds() > 0


def test_notify_grace_bounds_a_late_catch_up():
    assert 0 < roudoku.NOTIFY_GRACE.total_seconds() <= 3600


def test_config_keys_are_namespaced():
    """A stray key without the roudoku_ prefix would collide with Movie Night."""
    src = inspect.getsource(roudoku)
    for key in re.findall(r'CONFIG_ROUDOKU_[A-Z_]+ = "([a-z_]+)"', src):
        assert key.startswith("roudoku_"), key
