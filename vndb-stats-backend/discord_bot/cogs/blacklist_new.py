"""Blacklist command - manage cover image blacklisting."""

import logging

import discord
from discord import app_commands
from discord.ext import commands

from discord_bot.permissions import is_admin
from discord_bot.views.blacklist import BlacklistView

logger = logging.getLogger(__name__)


class BlacklistNewCog(commands.Cog):
    """Manage cover blacklist with interactive views."""

    def __init__(self, bot: commands.Bot):
        self.bot = bot

    @app_commands.command(
        name="blacklist",
        description="Manage cover blacklist - add entries, browse, configure rules",
    )
    @app_commands.default_permissions(administrator=True)
    @is_admin()
    async def blacklist(self, interaction: discord.Interaction):
        """Display blacklist management view."""
        view = BlacklistView(user_id=interaction.user.id)
        await view.load_stats()
        embed = view.get_embed()

        await interaction.response.send_message(embed=embed, view=view)
        view.message = await interaction.original_response()


async def setup(bot: commands.Bot):
    await bot.add_cog(BlacklistNewCog(bot))
