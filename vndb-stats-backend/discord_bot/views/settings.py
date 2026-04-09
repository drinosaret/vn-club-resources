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
CONFIG_WOTD_CHANNEL = "wotd_channel_id"
CONFIG_BACKUP_CHANNEL = "backup_channel_id"


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

        # WotD channel
        wotd_id = self._settings.get(CONFIG_WOTD_CHANNEL)
        if wotd_id:
            wotd_ch = self.bot.get_channel(int(wotd_id))
            wotd_display = wotd_ch.mention if wotd_ch else f"Unknown ({wotd_id})"
        else:
            wotd_display = "Not set (uses Daily channel)"
        embed.add_field(
            name="Word of the Day Channel",
            value=wotd_display,
            inline=False,
        )

        # Backup channel
        backup_id = self._settings.get(CONFIG_BACKUP_CHANNEL)
        if backup_id:
            backup_ch = self.bot.get_channel(int(backup_id))
            backup_display = backup_ch.mention if backup_ch else f"Unknown ({backup_id})"
        else:
            backup_display = "Not set"
        embed.add_field(
            name="Backup Channel",
            value=backup_display,
            inline=False,
        )

        embed.set_footer(text="Use the buttons below to change settings")
        return embed

    @ui.button(label="Set Daily Channel", style=discord.ButtonStyle.primary, emoji="\U0001f4e2")
    async def set_daily_channel(self, interaction: discord.Interaction, button: ui.Button):
        """Open a channel select to set the daily post channel."""
        select_view = ChannelSelectView(self.user_id, parent=self, config_key=CONFIG_DAILY_CHANNEL)
        await interaction.response.edit_message(
            embed=discord.Embed(
                title="\U0001f4e2 Select Daily Post Channel",
                description="Choose the channel where VOTD and news summaries will be posted.",
                color=0x5865F2,
            ),
            view=select_view,
        )

    @ui.button(label="Set WotD Channel", style=discord.ButtonStyle.primary, emoji="\U0001f4d6")
    async def set_wotd_channel(self, interaction: discord.Interaction, button: ui.Button):
        """Open a channel select to set the Word of the Day channel."""
        select_view = ChannelSelectView(self.user_id, parent=self, config_key=CONFIG_WOTD_CHANNEL)
        await interaction.response.edit_message(
            embed=discord.Embed(
                title="\U0001f4d6 Select Word of the Day Channel",
                description="Choose the channel where the daily Word of the Day will be posted. Leave unset to use the Daily Post channel.",
                color=0x5865F2,
            ),
            view=select_view,
        )

    @ui.button(label="Set Backup Channel", style=discord.ButtonStyle.secondary, emoji="\U0001f4be")
    async def set_backup_channel(self, interaction: discord.Interaction, button: ui.Button):
        """Open a channel select to set the backup channel."""
        select_view = ChannelSelectView(self.user_id, parent=self, config_key=CONFIG_BACKUP_CHANNEL)
        await interaction.response.edit_message(
            embed=discord.Embed(
                title="\U0001f4be Select Backup Channel",
                description="Choose the channel where daily database backups will be uploaded.",
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

    async def _notify_daily_posts_cog(self, config_key: str, channel_id: int) -> None:
        """Update the daily posts cog's cached channel ID."""
        from discord.ext import commands
        bot = self.bot
        if isinstance(bot, commands.Bot):
            cog = bot.get_cog("DailyPostsCog")
            if cog:
                if config_key == CONFIG_DAILY_CHANNEL:
                    cog._channel_id = channel_id
                elif config_key == CONFIG_WOTD_CHANNEL:
                    cog._wotd_channel_id = channel_id
                elif config_key == CONFIG_BACKUP_CHANNEL:
                    cog._backup_channel_id = channel_id


class ChannelSelectView(BaseView):
    """Ephemeral view with a channel select menu."""

    def __init__(self, user_id: int, parent: SettingsView, config_key: str = CONFIG_DAILY_CHANNEL):
        super().__init__(user_id, timeout=60)
        self.parent = parent
        self.config_key = config_key

    @ui.select(
        cls=ui.ChannelSelect,
        channel_types=[discord.ChannelType.text, discord.ChannelType.news],
        placeholder="Select a channel...",
    )
    async def channel_select(self, interaction: discord.Interaction, select: ui.ChannelSelect):
        """Handle channel selection."""
        channel = select.values[0]
        await self.parent._save_setting(self.config_key, str(channel.id))
        await self.parent._notify_daily_posts_cog(self.config_key, channel.id)
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
