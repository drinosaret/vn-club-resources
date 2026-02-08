"""Imports command - manage VNDB data imports."""

import logging

import discord
from discord import app_commands
from discord.ext import commands

from discord_bot.permissions import is_admin
from discord_bot.views.imports import ImportsView

logger = logging.getLogger(__name__)


class ImportsNewCog(commands.Cog):
    """Manage VNDB data imports with interactive views."""

    def __init__(self, bot: commands.Bot):
        self.bot = bot

    @app_commands.command(
        name="imports",
        description="Manage VNDB data imports - start, cancel, view history and logs",
    )
    @app_commands.default_permissions(administrator=True)
    @is_admin()
    async def imports(self, interaction: discord.Interaction):
        """Display imports management view."""
        view = ImportsView(user_id=interaction.user.id)
        await view.load_data()
        embed = view.get_embed()

        await interaction.response.send_message(embed=embed, view=view)
        view.message = await interaction.original_response()


async def setup(bot: commands.Bot):
    await bot.add_cog(ImportsNewCog(bot))
