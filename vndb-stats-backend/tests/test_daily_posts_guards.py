"""The daily post loops must outlive one bad day.

Source inspection, guarded on the bot module: the API image ships discord but
does not mount discord_bot/, and an unguarded import there fails collection.
"""

import inspect

import pytest

daily = pytest.importorskip("discord_bot.cogs.daily_posts")


def test_building_the_votd_post_cannot_end_the_loop():
    """A discord.ext.tasks loop stops for good on an unhandled exception, so the
    build has to sit inside the same handler as the send."""
    src = inspect.getsource(daily.DailyPostsCog._check_and_post_votd)
    build = src.index("self._build_votd_embed(")
    guard = src.index("try:")
    assert guard < build, "the embed build must be inside the try block"


def test_developer_credits_go_through_the_shared_labeller():
    src = inspect.getsource(daily.DailyPostsCog._build_votd_embed)
    assert "developer_labels(" in src
    assert 'join(developers' not in src
