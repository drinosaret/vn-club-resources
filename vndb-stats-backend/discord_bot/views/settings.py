"""Interactive settings management view."""

from datetime import datetime, timezone

import discord
from discord import ui
from sqlalchemy import select

from app.db.database import async_session_maker
from app.db.models import BotConfig
from discord_bot.views.base import BaseView

# Bot config keys (shared with daily_posts cog)
CONFIG_DAILY_CHANNEL = "daily_channel_id"


class SettingsView(BaseView):
    """View for managing bot settings with interactive controls."""

    def __init__(self, user_id: int, bot: discord.Client):
        super().__init__(user_id, timeout=300)
        self.bot = bot
        self._settings: dict[str, str] = {}

    async def load_settings(self) -> None:
        """Load all settings from the database."""
        async with async_session_maker() as db:
            result = await db.execute(select(BotConfig))
            rows = result.scalars().all()
            self._settings = {row.key: row.value for row in rows}

    def build_embed(self) -> discord.Embed:
        """Build the settings overview embed."""
        embed = discord.Embed(
            title="\u2699\ufe0f Bot Settings",
            color=0x5865F2,
        )

        # Daily channel
        channel_id = self._settings.get(CONFIG_DAILY_CHANNEL)
        if channel_id:
            channel = self.bot.get_channel(int(channel_id))
            channel_display = channel.mention if channel else f"Unknown ({channel_id})"
        else:
            channel_display = "Not set"
        embed.add_field(
            name="Daily Post Channel",
            value=channel_display,
            inline=False,
        )

        embed.set_footer(text="Use the buttons below to change settings")
        return embed

    @ui.button(label="Set Daily Channel", style=discord.ButtonStyle.primary, emoji="\U0001f4e2")
    async def set_daily_channel(self, interaction: discord.Interaction, button: ui.Button):
        """Open a channel select to set the daily post channel."""
        select_view = ChannelSelectView(self.user_id, parent=self)
        await interaction.response.edit_message(
            embed=discord.Embed(
                title="\U0001f4e2 Select Daily Post Channel",
                description="Choose the channel where VOTD and news summaries will be posted.",
                color=0x5865F2,
            ),
            view=select_view,
        )

    async def _save_setting(self, key: str, value: str) -> None:
        """Save a setting to the database."""
        async with async_session_maker() as db:
            existing = await db.execute(
                select(BotConfig).where(BotConfig.key == key)
            )
            config = existing.scalar_one_or_none()
            if config:
                config.value = value
                config.updated_at = datetime.now(timezone.utc)
            else:
                db.add(BotConfig(key=key, value=value))
            await db.commit()
        self._settings[key] = value

    async def _notify_daily_posts_cog(self, channel_id: int) -> None:
        """Update the daily posts cog's cached channel ID."""
        from discord.ext import commands
        bot = self.bot
        if isinstance(bot, commands.Bot):
            cog = bot.get_cog("DailyPostsCog")
            if cog:
                cog._channel_id = channel_id


class ChannelSelectView(BaseView):
    """Ephemeral view with a channel select menu."""

    def __init__(self, user_id: int, parent: SettingsView):
        super().__init__(user_id, timeout=60)
        self.parent = parent

    @ui.select(
        cls=ui.ChannelSelect,
        channel_types=[discord.ChannelType.text],
        placeholder="Select a channel...",
    )
    async def channel_select(self, interaction: discord.Interaction, select: ui.ChannelSelect):
        """Handle channel selection."""
        channel = select.values[0]
        await self.parent._save_setting(CONFIG_DAILY_CHANNEL, str(channel.id))
        await self.parent._notify_daily_posts_cog(channel.id)
        await self.parent.load_settings()

        await interaction.response.edit_message(
            embed=self.parent.build_embed(),
            view=self.parent,
        )

    @ui.button(label="Cancel", style=discord.ButtonStyle.secondary)
    async def cancel(self, interaction: discord.Interaction, button: ui.Button):
        """Go back to the main settings view."""
        await interaction.response.edit_message(
            embed=self.parent.build_embed(),
            view=self.parent,
        )
