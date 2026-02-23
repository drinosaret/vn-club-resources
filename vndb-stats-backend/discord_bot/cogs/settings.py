"""Bot settings management via /settings command."""

import logging

import discord
from discord import app_commands
from discord.ext import commands

from discord_bot.permissions import is_admin
from discord_bot.views.settings import SettingsView

logger = logging.getLogger(__name__)


class SettingsCog(commands.Cog):
    """Manage bot settings via an interactive panel."""

    def __init__(self, bot: commands.Bot):
        self.bot = bot

    @app_commands.command(name="settings", description="Manage bot settings")
    @app_commands.default_permissions(administrator=True)
    @is_admin()
    async def settings(self, interaction):
        view = SettingsView(interaction.user.id, self.bot)
        await view.load_settings()
        embed = view.build_embed()
        await interaction.response.send_message(embed=embed, view=view, ephemeral=True)
        view.message = await interaction.original_response()

    @app_commands.command(name="testdaily", description="Force-send daily posts (bypasses dedup)")
    @app_commands.describe(post="Which post to test")
    @app_commands.choices(post=[
        app_commands.Choice(name="Both", value="both"),
        app_commands.Choice(name="VOTD only", value="votd"),
        app_commands.Choice(name="News only", value="news"),
    ])
    @app_commands.default_permissions(administrator=True)
    @is_admin()
    async def testdaily(self, interaction: discord.Interaction, post: str = "both"):
        await interaction.response.defer(ephemeral=True)

        cog = self.bot.get_cog("DailyPostsCog")
        if not cog:
            await interaction.followup.send("Daily posts cog not loaded", ephemeral=True)
            return

        results = []
        if post in ("both", "votd"):
            results.append(await cog._check_and_post_votd(force=True))
        if post in ("both", "news"):
            results.append(await cog._check_and_post_news(force=True))

        await interaction.followup.send("\n".join(results), ephemeral=True)


async def setup(bot: commands.Bot):
    await bot.add_cog(SettingsCog(bot))
