"""Events commands.

- /events        (public)  - list upcoming VN Club events with calendar links
- /manage_events (admin)   - create/edit/toggle/delete custom calendar events
"""

import logging
from datetime import datetime, timezone

import discord
from discord import app_commands
from discord.ext import commands

from app.db.database import async_session_maker
from app.services import events_service
from discord_bot.config import get_bot_settings
from discord_bot.permissions import is_admin
from discord_bot.views.events import EventManageView, _load_events

logger = logging.getLogger(__name__)

_EMOJI = {
    "vn_of_month": "✨",
    "vn_of_season": "🍃",
    "movie_night": "🎬",
    "vn_month_voting": "🗳️",
    "vn_season_voting": "🗳️",
    "custom": "📌",
}
UPCOMING_LIMIT = 8


def _noon_ts(dt: datetime) -> int:
    """Unix ts at 12:00 UTC of dt's date. All-day events are calendar dates, but
    Discord <t:..:D> renders in the viewer's tz; anchoring at noon keeps the date
    the same worldwide instead of slipping a day for viewers behind UTC."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return int(dt.replace(hour=12, minute=0, second=0, microsecond=0).timestamp())


def _when(e: dict) -> str:
    """Discord timestamp(s) so each viewer sees the date/time in their own tz."""
    start = datetime.fromisoformat(e["start_at"])
    if e["all_day"]:
        su = _noon_ts(start)
        if e["end_at"]:
            end = datetime.fromisoformat(e["end_at"])
            if end.date() != start.date():
                return f"<t:{su}:D> – <t:{_noon_ts(end)}:D>"
        return f"<t:{su}:D>"
    return f"<t:{int(start.timestamp())}:f>"


class EventsCog(commands.Cog):
    """Public upcoming-events list and admin custom-event management."""

    def __init__(self, bot: commands.Bot):
        self.bot = bot

    @app_commands.command(name="events", description="See upcoming VN Club events")
    async def events(self, interaction: discord.Interaction):
        """Public: list the next several events with links into the calendar."""
        await interaction.response.defer()
        async with async_session_maker() as db:
            items = (await events_service.get_upcoming_merged(db, datetime.now(timezone.utc)))[:UPCOMING_LIMIT]

        site = get_bot_settings().frontend_url.rstrip("/")
        if items:
            lines = []
            for e in items:
                emoji = _EMOJI.get(e["event_type"], "📌")
                link = f"{site}/events?date={e['start_at'][:10]}"
                lines.append(f"{emoji} {_when(e)} · [{e['title']}]({link})")
            desc = "\n".join(lines)
        else:
            desc = "No upcoming events right now."

        embed = discord.Embed(
            title="📅 Upcoming VN Club Events",
            description=desc,
            color=0x5865F2,
        )
        embed.set_footer(text="VN Club")

        view = discord.ui.View()
        view.add_item(
            discord.ui.Button(
                label="Open full calendar",
                url=f"{site}/events/",
                style=discord.ButtonStyle.link,
            )
        )
        await interaction.followup.send(embed=embed, view=view)

    @app_commands.command(
        name="manage_events",
        description="[ADMIN] Manage custom calendar events - create, edit, toggle, delete",
    )
    @app_commands.default_permissions(administrator=True)
    @is_admin()
    async def manageevents(self, interaction: discord.Interaction):
        """Admin: open the custom-events management view."""
        rows = await _load_events(include_inactive=False)
        view = EventManageView(user_id=interaction.user.id, events=rows, include_inactive=False)
        await interaction.response.send_message(embed=view.get_embed(), view=view)
        view.message = await interaction.original_response()


async def setup(bot: commands.Bot):
    await bot.add_cog(EventsCog(bot))
