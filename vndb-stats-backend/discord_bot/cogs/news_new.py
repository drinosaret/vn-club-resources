"""News command - manage news feed items."""

import logging

import discord
from discord import app_commands
from discord.ext import commands
from sqlalchemy import select, desc

from app.db.database import async_session_maker
from app.db.models import NewsItem
from discord_bot.permissions import is_admin
from discord_bot.views.news import NewsView

logger = logging.getLogger(__name__)


class NewsNewCog(commands.Cog):
    """Manage news feed with pagination and inline hide/unhide."""

    def __init__(self, bot: commands.Bot):
        self.bot = bot

    @app_commands.command(
        name="news",
        description="Manage news feed - refresh, hide/unhide items, filter by source",
    )
    @app_commands.default_permissions(administrator=True)
    @is_admin()
    async def news(self, interaction: discord.Interaction):
        """Display news management view."""
        async with async_session_maker() as db:
            result = await db.execute(
                select(NewsItem).order_by(desc(NewsItem.published_at)).limit(100)
            )
            items = list(result.scalars().all())

        view = NewsView(
            user_id=interaction.user.id,
            items=items,
        )
        embed = await view.format_page()

        await interaction.response.send_message(embed=embed, view=view)
        view.message = await interaction.original_response()


async def setup(bot: commands.Bot):
    await bot.add_cog(NewsNewCog(bot))
