"""Dashboard command - unified system status view."""

import logging

import discord
from discord import app_commands
from discord.ext import commands

from discord_bot.permissions import is_admin
from discord_bot.views.dashboard import DashboardView

logger = logging.getLogger(__name__)


class DashboardCog(commands.Cog):
    """Unified dashboard for system status, database stats, imports, and logs."""

    def __init__(self, bot: commands.Bot):
        self.bot = bot

    @app_commands.command(name="dashboard", description="View system dashboard with status, stats, imports, and logs")
    @app_commands.default_permissions(administrator=True)
    @is_admin()
    async def dashboard(self, interaction: discord.Interaction):
        """Display the unified dashboard."""
        view = DashboardView(user_id=interaction.user.id)
        embed = await view.get_tab_content()

        await interaction.response.send_message(embed=embed, view=view)

        # Store message reference for timeout handling
        view.message = await interaction.original_response()


async def setup(bot: commands.Bot):
    await bot.add_cog(DashboardCog(bot))
