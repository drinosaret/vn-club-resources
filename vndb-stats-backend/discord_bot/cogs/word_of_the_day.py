"""Word of the Day command - view and manage daily vocabulary spotlight."""

import logging
from datetime import date, timedelta

import discord
from discord import app_commands, ui
from discord.ext import commands

from app.db.database import async_session_maker
from app.db.models import WordOfTheDay
from app.services import word_of_the_day_service as wotd
from app.services.jiten_client import fetch_full_word_data, strip_furigana, to_hiragana
from app.core.cache import get_cache
from discord_bot.permissions import is_admin
from discord_bot.views.base import BaseView

logger = logging.getLogger(__name__)


class OverrideModal(ui.Modal):
    """Modal for overriding the Word of the Day."""

    def __init__(self):
        super().__init__(title="Override Word of the Day")

        self.word_id_input = ui.TextInput(
            label="Jiten Word ID",
            placeholder="e.g. 1358280",
            max_length=15,
            required=True,
        )
        self.add_item(self.word_id_input)

        self.date_input = ui.TextInput(
            label="Date (YYYY-MM-DD, blank = tomorrow)",
            placeholder="2026-04-15",
            required=False,
        )
        self.add_item(self.date_input)

    async def on_submit(self, interaction: discord.Interaction):
        word_id_str = self.word_id_input.value.strip()
        try:
            word_id = int(word_id_str)
        except ValueError:
            await interaction.response.send_message(
                "Invalid word ID. Must be a number.", ephemeral=True
            )
            return

        date_str = self.date_input.value.strip() if self.date_input.value else None
        if date_str:
            try:
                target_date = date.fromisoformat(date_str)
            except ValueError:
                await interaction.response.send_message(
                    "Invalid date format. Use YYYY-MM-DD.", ephemeral=True
                )
                return
        else:
            target_date = date.today() + timedelta(days=1)

        await interaction.response.defer(ephemeral=True)

        async with async_session_maker() as db:
            pick = await wotd.set_override(
                db, word_id, target_date,
                admin_name=str(interaction.user),
            )
            if not pick:
                await interaction.followup.send(
                    f"Failed to fetch word `{word_id}` from jiten.moe.", ephemeral=True
                )
                return

            if target_date == date.today():
                cache = get_cache()
                await cache.delete("word_of_the_day:current")

            word_info = (pick.cached_data or {}).get("word_info", {})
            main_reading = word_info.get("mainReading", {})
            text = strip_furigana(main_reading.get("text", "?"))
            await interaction.followup.send(
                f"Set Word of the Day for **{target_date}** to **{text}** (ID: `{word_id}`)",
                ephemeral=True,
            )


class WordOfTheDayView(BaseView):
    """Interactive view for Word of the Day management."""

    def __init__(self, user_id: int, pick: WordOfTheDay | None):
        super().__init__(user_id, timeout=300)
        self.pick = pick

    def get_embed(self) -> discord.Embed:
        """Build the embed for the current pick."""
        if not self.pick:
            return discord.Embed(
                title="Word of the Day",
                description="No Word of the Day has been selected yet.",
                color=0x10B981,  # emerald-500
            )

        data = self.pick.cached_data or {}
        word_info = data.get("word_info", {})
        main_reading = word_info.get("mainReading", {})
        text = strip_furigana(main_reading.get("text", "?"))
        hiragana = to_hiragana(main_reading.get("text", ""))

        definitions = word_info.get("definitions", [])
        meanings = definitions[0].get("meanings", [])[:3] if definitions else []
        pos = word_info.get("partsOfSpeech", [])

        embed = discord.Embed(
            title=f"Word of the Day | {self.pick.date}",
            url=f"https://vnclub.org/word-of-the-day?date={self.pick.date.isoformat()}",
            color=0x10B981,
        )

        # Description: word + reading + POS + meaning together
        desc_lines = []
        reading_line = f"## {text}"
        if hiragana and hiragana != text:
            reading_line += f"\u3000*{hiragana}*"
        desc_lines.append(reading_line)
        if pos:
            desc_lines.append(f"`{'` `'.join(pos[:4])}`")
        if meanings:
            desc_lines.append(f"\n{'; '.join(meanings)}")
        embed.description = "\n".join(desc_lines)

        freq = main_reading.get("frequencyRank")
        if freq:
            embed.add_field(name="Frequency", value=f"#{freq:,}", inline=True)

        if self.pick.is_override:
            embed.set_footer(text=f"Override by {self.pick.override_by or 'admin'}")
        else:
            embed.set_footer(text="Auto-selected")

        return embed

    @ui.button(label="Override", style=discord.ButtonStyle.primary, emoji="\U0001f4dd")
    async def override_button(self, interaction: discord.Interaction, button: ui.Button):
        modal = OverrideModal()
        await interaction.response.send_modal(modal)

    @ui.button(label="Reroll Today", style=discord.ButtonStyle.danger, emoji="\U0001f3b2")
    async def reroll_button(self, interaction: discord.Interaction, button: ui.Button):
        await interaction.response.defer()

        async with async_session_maker() as db:
            pick = await wotd.reroll_today(db)

        if not pick:
            await interaction.followup.send("No eligible word found.", ephemeral=True)
            return

        cache = get_cache()
        await cache.delete("word_of_the_day:current")

        self.pick = pick
        embed = self.get_embed()
        await interaction.edit_original_response(embed=embed, view=self)

    @ui.button(label="Post Now", style=discord.ButtonStyle.success, emoji="\U0001f4e8")
    async def post_now_button(self, interaction: discord.Interaction, button: ui.Button):
        """Manually post the current WotD to the configured channel."""
        await interaction.response.defer(ephemeral=True)

        from discord.ext import commands
        bot = interaction.client
        if isinstance(bot, commands.Bot):
            cog = bot.get_cog("DailyPostsCog")
            if cog and hasattr(cog, '_check_and_post_wotd'):
                result = await cog._check_and_post_wotd(force=True)
                await interaction.followup.send(result, ephemeral=True)
                return

        await interaction.followup.send("Daily posts cog not loaded.", ephemeral=True)

    @ui.button(label="History", style=discord.ButtonStyle.secondary, emoji="\U0001f4dc")
    async def history_button(self, interaction: discord.Interaction, button: ui.Button):
        async with async_session_maker() as db:
            picks = await wotd.get_history(db, limit=10)

        if not picks:
            await interaction.response.send_message("No history yet.", ephemeral=True)
            return

        lines = []
        for p in picks:
            word_info = (p.cached_data or {}).get("word_info", {})
            mr = word_info.get("mainReading", {})
            text = strip_furigana(mr.get("text", "?"))
            override = " *(override)*" if p.is_override else ""
            lines.append(f"**{p.date}** | {text} (`{p.word_id}`){override}")

        embed = discord.Embed(
            title="Word of the Day | History",
            description="\n".join(lines),
            color=0x10B981,
        )
        await interaction.response.send_message(embed=embed, ephemeral=True)


class WordOfTheDayCog(commands.Cog):
    """View and manage Word of the Day."""

    def __init__(self, bot: commands.Bot):
        self.bot = bot

    @app_commands.command(
        name="wotd",
        description="View or manage Word of the Day",
    )
    @app_commands.default_permissions(administrator=True)
    @is_admin()
    async def wotd(self, interaction: discord.Interaction):
        """Display Word of the Day management view."""
        async with async_session_maker() as db:
            pick = await wotd.get_or_select(db)

        view = WordOfTheDayView(user_id=interaction.user.id, pick=pick)
        embed = view.get_embed()

        await interaction.response.send_message(embed=embed, view=view)
        view.message = await interaction.original_response()


async def setup(bot: commands.Bot):
    await bot.add_cog(WordOfTheDayCog(bot))
