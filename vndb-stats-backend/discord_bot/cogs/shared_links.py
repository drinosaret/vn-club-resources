"""Shared links management command."""

import logging

import discord
from discord import app_commands
from discord.ext import commands

from discord_bot.config import get_bot_settings
from discord_bot.permissions import is_admin
from discord_bot.views.shared_links import SharedLinksView

logger = logging.getLogger(__name__)


class SharedLinksCog(commands.Cog):
    """Manage shared 3x3 and tierlist links."""

    def __init__(self, bot: commands.Bot):
        self.bot = bot

    @app_commands.command(name="links", description="View and manage shared 3x3/tierlist links")
    @app_commands.default_permissions(administrator=True)
    @is_admin()
    async def links(self, interaction: discord.Interaction):
        """Display the shared links manager."""
        settings = get_bot_settings()
        view = SharedLinksView(
            user_id=interaction.user.id,
            frontend_url=settings.frontend_url,
        )
        await view.fetch_page()
        view._update_nav_buttons()
        embed = await view.build_embed()

        await interaction.response.send_message(embed=embed, view=view)
        view.message = await interaction.original_response()


async def setup(bot: commands.Bot):
    await bot.add_cog(SharedLinksCog(bot))
