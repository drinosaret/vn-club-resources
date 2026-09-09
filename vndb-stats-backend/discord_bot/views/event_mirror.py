"""Admin panel for the calendar to Events tab mirror.

Channels are picked here rather than set in the environment because the mirror
follows whatever channel it is given: a voice or stage channel becomes a voice
event with a join button, and a text channel becomes an external one that names
the channel, since Discord will not attach an event to a text channel. Each type
has its own channel, with one fallback for any left unset.
"""

import discord
from discord import ui
from sqlalchemy import func, select

from app.db.database import async_session_maker
from app.db.models import DiscordScheduledEvent
from app.services import event_mirror as em
from discord_bot.views.base import BaseView, ConfirmView

COLOR = 0x5865F2
FALLBACK_LABEL = "Anything left unset"

PICKABLE = [
    discord.ChannelType.text,
    discord.ChannelType.news,
    discord.ChannelType.voice,
    discord.ChannelType.stage_voice,
]


async def _mirrored_count(guild_id: int) -> int:
    async with async_session_maker() as db:
        total = await db.scalar(
            select(func.count())
            .select_from(DiscordScheduledEvent)
            .where(DiscordScheduledEvent.guild_id == guild_id)
        )
    return int(total or 0)


class EventMirrorView(BaseView):
    """Master switch, per-type channels, and a manual run."""

    def __init__(self, user_id: int, cog):
        super().__init__(user_id, timeout=300)
        self.cog = cog
        self.mirrored = 0
        self._sync_toggle()

    def _sync_toggle(self) -> None:
        on = self.cog.enabled
        self.toggle_button.label = "Turn off" if on else "Turn on"
        self.toggle_button.style = discord.ButtonStyle.danger if on else discord.ButtonStyle.success

    def _channel_display(self, raw: str | None) -> str:
        if not raw:
            return "Not set"
        try:
            channel = self.cog.bot.get_channel(int(raw))
        except (TypeError, ValueError):
            return f"Unreadable ({raw})"
        if channel is None:
            return f"Unknown ({raw})"
        kind = "voice" if isinstance(channel, (discord.VoiceChannel, discord.StageChannel)) else "text"
        return f"{channel.mention} ({kind})"

    def _channel_lines(self) -> str:
        config = self.cog.config
        fallback = config.get(em.CONFIG_CHANNEL_DEFAULT)
        lines = []
        for event_type, label in em.CHANNEL_TYPES:
            own = config.get(em.channel_key(event_type))
            if own:
                shown = self._channel_display(own)
            elif fallback:
                shown = f"{self._channel_display(fallback)} via fallback"
            else:
                shown = "Not set"
            lines.append(f"**{label}:** {shown}")
        lines.append(f"**{FALLBACK_LABEL}:** {self._channel_display(fallback)}")
        markers = ", ".join(em.STYLES[t].idle_name for t in em.NO_CHANNEL_TYPES)
        lines.append(f"*{markers}: reminders only, no channel*")
        return "\n".join(lines)

    def build_embed(self) -> discord.Embed:
        state = "On" if self.cog.enabled else "Off"
        embed = discord.Embed(
            title="\U0001f5d3\ufe0f Calendar to Discord Events",
            description=(
                f"**{state}.** Upcoming club events are published to this server as native "
                f"scheduled events and kept in step with the calendar, "
                f"{em.HORIZON.days} days ahead."
            ),
            color=COLOR,
        )
        embed.add_field(name="Where each one happens", value=self._channel_lines(), inline=False)
        embed.add_field(name="Currently mirrored", value=f"{self.mirrored} event(s)", inline=True)
        embed.add_field(name="Last run", value=self.cog.last_status[:1000], inline=False)
        embed.set_footer(text="A voice channel gives members a join button; a text channel is named instead.")
        return embed

    async def refresh(self) -> None:
        await self.cog.load_config()
        guild_id = self._guild_id()
        self.mirrored = await _mirrored_count(guild_id) if guild_id else 0
        self._sync_toggle()

    def _guild_id(self) -> int:
        from discord_bot.config import get_bot_settings

        return get_bot_settings().guild_id

    @ui.button(label="Turn on", style=discord.ButtonStyle.success, row=0)
    async def toggle_button(self, interaction: discord.Interaction, button: ui.Button) -> None:
        await interaction.response.defer()
        await self.cog.save_setting(em.CONFIG_ENABLED, "false" if self.cog.enabled else "true")
        await self.refresh()
        if self.cog.enabled:
            await self.cog.sync()
        await interaction.edit_original_response(embed=self.build_embed(), view=self)

    @ui.button(label="Sync now", style=discord.ButtonStyle.primary, emoji="\U0001f504", row=0)
    async def sync_button(self, interaction: discord.Interaction, button: ui.Button) -> None:
        await interaction.response.defer()
        await self.cog.sync()
        await self.refresh()
        await interaction.edit_original_response(embed=self.build_embed(), view=self)

    @ui.button(label="Set a channel", style=discord.ButtonStyle.secondary, emoji="\U0001f4cd", row=1)
    async def set_channel_button(self, interaction: discord.Interaction, button: ui.Button) -> None:
        await interaction.response.edit_message(
            embed=discord.Embed(
                title="Which one?",
                description="Pick what you are placing, then the channel it happens in.",
                color=COLOR,
            ),
            view=TypeSelectView(self.user_id, parent=self),
        )

    @ui.button(label="Remove published", style=discord.ButtonStyle.danger, row=2)
    async def remove_button(self, interaction: discord.Interaction, button: ui.Button) -> None:
        confirm = ConfirmView(self.user_id, confirm_label="Remove them", timeout=60)
        await interaction.response.edit_message(
            embed=discord.Embed(
                title="Remove the published events?",
                description=(
                    "Every mirrored event that has not started is deleted from the Events tab. "
                    "The calendar itself is untouched, and a later sync publishes them again."
                ),
                color=COLOR,
            ),
            view=confirm,
        )
        await confirm.wait()
        if confirm.value:
            await self.cog.remove_published()
        await self.refresh()
        await interaction.edit_original_response(embed=self.build_embed(), view=self)


class TypeSelectView(BaseView):
    """Step one of placing a type: which type."""

    def __init__(self, user_id: int, parent: EventMirrorView):
        super().__init__(user_id, timeout=120)
        self.parent = parent
        options = [
            discord.SelectOption(label=label, value=em.channel_key(event_type), emoji=em.STYLES[event_type].emoji)
            for event_type, label in em.CHANNEL_TYPES
        ]
        options.append(discord.SelectOption(label=FALLBACK_LABEL, value=em.CONFIG_CHANNEL_DEFAULT, emoji="\U0001f4cc"))
        self.type_select.options = options

    @ui.select(placeholder="What are you placing?", options=[discord.SelectOption(label="placeholder")])
    async def type_select(self, interaction: discord.Interaction, select: ui.Select) -> None:
        key = select.values[0]
        label = next((l for t, l in em.CHANNEL_TYPES if em.channel_key(t) == key), FALLBACK_LABEL)
        await interaction.response.edit_message(
            embed=discord.Embed(
                title=f"Where does {label} happen?",
                description=(
                    "A voice or stage channel gives members a join button; a text channel is "
                    "named in the event instead."
                ),
                color=COLOR,
            ),
            view=ChannelPickerView(self.user_id, parent=self.parent, config_key=key),
        )

    @ui.button(label="Back", style=discord.ButtonStyle.secondary)
    async def back(self, interaction: discord.Interaction, button: ui.Button) -> None:
        await interaction.response.edit_message(embed=self.parent.build_embed(), view=self.parent)


class ChannelPickerView(BaseView):
    """Step two: one channel select, writing back to a single config key."""

    def __init__(self, user_id: int, parent: EventMirrorView, config_key: str):
        super().__init__(user_id, timeout=120)
        self.parent = parent
        self.config_key = config_key

    @ui.select(cls=ui.ChannelSelect, channel_types=PICKABLE, placeholder="Pick a channel...")
    async def channel_select(self, interaction: discord.Interaction, select: ui.ChannelSelect) -> None:
        await interaction.response.defer()
        await self.parent.cog.save_setting(self.config_key, str(select.values[0].id))
        await self.parent.refresh()
        await interaction.edit_original_response(embed=self.parent.build_embed(), view=self.parent)

    @ui.button(label="Clear", style=discord.ButtonStyle.secondary)
    async def clear(self, interaction: discord.Interaction, button: ui.Button) -> None:
        await interaction.response.defer()
        await self.parent.cog.save_setting(self.config_key, "")
        await self.parent.refresh()
        await interaction.edit_original_response(embed=self.parent.build_embed(), view=self.parent)

    @ui.button(label="Back", style=discord.ButtonStyle.secondary)
    async def back(self, interaction: discord.Interaction, button: ui.Button) -> None:
        await interaction.response.edit_message(embed=self.parent.build_embed(), view=self.parent)
