"""Announcements command - manage site announcements."""

import logging

import discord
from discord import app_commands
from discord.ext import commands
from sqlalchemy import select

from app.db.database import async_session_maker
from app.db.models import Announcement
from discord_bot.permissions import is_admin
from discord_bot.views.announcements import AnnouncementView

logger = logging.getLogger(__name__)


class AnnouncementsCog(commands.Cog):
    """Manage site announcements with modal-based create/edit."""

    def __init__(self, bot: commands.Bot):
        self.bot = bot

    @app_commands.command(
        name="announcements",
        description="Manage site announcements - create, edit, toggle, delete",
    )
    @app_commands.default_permissions(administrator=True)
    @is_admin()
    async def announcements(self, interaction: discord.Interaction):
        """Display announcements management view."""
        async with async_session_maker() as db:
            query = (
                select(Announcement)
                .where(Announcement.is_active == True)
                .order_by(Announcement.published_at.desc())
                .limit(25)
            )
            result = await db.execute(query)
            announcements = list(result.scalars().all())

        view = AnnouncementView(
            user_id=interaction.user.id,
            announcements=announcements,
            include_inactive=False,
        )
        embed = view.get_embed()

        await interaction.response.send_message(embed=embed, view=view)
        view.message = await interaction.original_response()


async def setup(bot: commands.Bot):
    await bot.add_cog(AnnouncementsCog(bot))
