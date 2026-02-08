"""RSS feed command - manage RSS feed sources."""

import logging

import discord
from discord import app_commands
from discord.ext import commands
from sqlalchemy import select

from app.db.database import async_session_maker
from app.db.models import RSSFeedConfig
from discord_bot.permissions import is_admin
from discord_bot.views.rss import RSSFeedView

logger = logging.getLogger(__name__)


class RSSCog(commands.Cog):
    """Manage RSS feed sources with modal-based create/edit."""

    def __init__(self, bot: commands.Bot):
        self.bot = bot

    @app_commands.command(
        name="rss",
        description="Manage RSS feed sources - add, edit, toggle, delete",
    )
    @app_commands.default_permissions(administrator=True)
    @is_admin()
    async def rss(self, interaction: discord.Interaction):
        """Display RSS feed management view."""
        async with async_session_maker() as db:
            result = await db.execute(
                select(RSSFeedConfig).order_by(RSSFeedConfig.name)
            )
            feeds = list(result.scalars().all())

        view = RSSFeedView(
            user_id=interaction.user.id,
            feeds=feeds,
        )
        embed = view.get_embed()

        await interaction.response.send_message(embed=embed, view=view)
        view.message = await interaction.original_response()


async def setup(bot: commands.Bot):
    await bot.add_cog(RSSCog(bot))
