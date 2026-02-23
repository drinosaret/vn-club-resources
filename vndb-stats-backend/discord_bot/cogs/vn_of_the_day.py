"""VN of the Day command - view and manage daily VN spotlight."""

import logging
import re
from datetime import date, timedelta

import discord
from discord import app_commands, ui
from discord.ext import commands
from sqlalchemy import select

from app.db.database import async_session_maker
from app.db.models import VNOfTheDay, VisualNovel
from app.services import vn_of_the_day_service as votd
from app.core.cache import get_cache
from discord_bot.permissions import is_admin
from discord_bot.views.base import BaseView

logger = logging.getLogger(__name__)


class OverrideModal(ui.Modal):
    """Modal for overriding tomorrow's VN of the Day."""

    def __init__(self):
        super().__init__(title="Override VN of the Day")
        self.result: dict | None = None

        self.vn_id_input = ui.TextInput(
            label="VN ID",
            placeholder="e.g. v17 or 17",
            max_length=10,
            required=True,
        )
        self.add_item(self.vn_id_input)

        self.date_input = ui.TextInput(
            label="Date (YYYY-MM-DD, blank = tomorrow)",
            placeholder="2025-01-15",
            required=False,
        )
        self.add_item(self.date_input)

    async def on_submit(self, interaction: discord.Interaction):
        vn_id = self.vn_id_input.value.strip()
        # Normalize: "17" -> "v17"
        if vn_id.isdigit():
            vn_id = f"v{vn_id}"

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

        async with async_session_maker() as db:
            pick = await votd.set_override(db, vn_id, target_date, admin_name=str(interaction.user))
            if not pick:
                await interaction.response.send_message(
                    f"VN `{vn_id}` not found in database.", ephemeral=True
                )
                return

            # Invalidate cache if overriding today
            if target_date == date.today():
                cache = get_cache()
                await cache.delete("vn_of_the_day:current")

            vn = pick.visual_novel
            await interaction.response.send_message(
                f"Set VN of the Day for **{target_date}** to **{vn.title}** (`{vn.id}`)",
                ephemeral=True,
            )


class VNOfTheDayView(BaseView):
    """Interactive view for VN of the Day management."""

    def __init__(self, user_id: int, pick: VNOfTheDay | None):
        super().__init__(user_id, timeout=300)
        self.pick = pick

    def get_embed(self) -> discord.Embed:
        """Build the embed for the current pick."""
        if not self.pick or not self.pick.visual_novel:
            return discord.Embed(
                title="VN of the Day",
                description="No VN of the Day has been selected yet.",
                color=0x7C3AED,
            )

        vn = self.pick.visual_novel
        numeric_id = re.sub(r"[^0-9]", "", vn.id)

        embed = discord.Embed(
            title=f"VN of the Day — {self.pick.date}",
            url=f"https://vnclub.org/vn/{numeric_id}/",
            color=0x7C3AED,
        )

        embed.add_field(name="Title", value=vn.title, inline=True)
        if vn.title_jp:
            embed.add_field(name="Japanese", value=vn.title_jp, inline=True)
        if vn.rating and vn.votecount:
            embed.add_field(
                name="Rating",
                value=f"⭐ {vn.rating:.2f} ({vn.votecount:,} votes)",
                inline=True,
            )
        if vn.developers:
            embed.add_field(name="Developer", value=", ".join(vn.developers[:3]), inline=True)

        if self.pick.is_override:
            embed.set_footer(text=f"Override by {self.pick.override_by or 'admin'}")
        else:
            embed.set_footer(text="Auto-selected")

        if vn.image_url and (vn.image_sexual is None or vn.image_sexual < 1.5):
            embed.set_thumbnail(url=vn.image_url)

        return embed

    @ui.button(label="Override", style=discord.ButtonStyle.primary, emoji="📝")
    async def override_button(self, interaction: discord.Interaction, button: ui.Button):
        """Open modal to override VN of the Day."""
        modal = OverrideModal()
        await interaction.response.send_modal(modal)

    @ui.button(label="Reroll Today", style=discord.ButtonStyle.danger, emoji="🎲")
    async def reroll_button(self, interaction: discord.Interaction, button: ui.Button):
        """Reroll today's VN of the Day."""
        await interaction.response.defer()

        async with async_session_maker() as db:
            pick = await votd.reroll_today(db)

        if not pick or not pick.visual_novel:
            await interaction.followup.send("No eligible VN found.", ephemeral=True)
            return

        cache = get_cache()
        await cache.delete("vn_of_the_day:current")

        self.pick = pick
        embed = self.get_embed()
        await interaction.edit_original_response(embed=embed, view=self)

    @ui.button(label="History", style=discord.ButtonStyle.secondary, emoji="📜")
    async def history_button(self, interaction: discord.Interaction, button: ui.Button):
        """Show recent VN of the Day history."""
        async with async_session_maker() as db:
            picks = await votd.get_history(db, limit=10)

        if not picks:
            await interaction.response.send_message("No history yet.", ephemeral=True)
            return

        lines = []
        for p in picks:
            vn = p.visual_novel
            if not vn:
                continue
            override = " *(override)*" if p.is_override else ""
            lines.append(f"**{p.date}** — {vn.title} (`{vn.id}`){override}")

        embed = discord.Embed(
            title="VN of the Day — History",
            description="\n".join(lines),
            color=0x7C3AED,
        )
        await interaction.response.send_message(embed=embed, ephemeral=True)


class VNOfTheDayCog(commands.Cog):
    """View and manage VN of the Day."""

    def __init__(self, bot: commands.Bot):
        self.bot = bot

    @app_commands.command(
        name="vnotd",
        description="View or manage VN of the Day",
    )
    @app_commands.default_permissions(administrator=True)
    @is_admin()
    async def vnotd(self, interaction: discord.Interaction):
        """Display VN of the Day management view."""
        async with async_session_maker() as db:
            pick = await votd.get_or_select(db)

        view = VNOfTheDayView(user_id=interaction.user.id, pick=pick)
        embed = view.get_embed()

        await interaction.response.send_message(embed=embed, view=view)
        view.message = await interaction.original_response()


async def setup(bot: commands.Bot):
    await bot.add_cog(VNOfTheDayCog(bot))
