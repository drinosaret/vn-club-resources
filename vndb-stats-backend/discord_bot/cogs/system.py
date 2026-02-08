"""System health and status commands."""

import logging

import discord
from discord import app_commands
from discord.ext import commands
from sqlalchemy import select, func

from app.db.database import async_session_maker
from app.db.models import (
    VisualNovel, Tag, VNTag, GlobalVote, Producer, Staff,
    Character, Release, Trait, SystemMetadata, ImportRun,
)
from discord_bot.permissions import is_admin

logger = logging.getLogger(__name__)


class SystemCog(commands.Cog):
    """System health and status monitoring."""

    group = app_commands.Group(name="system", description="System status")

    def __init__(self, bot: commands.Bot):
        self.bot = bot

    @group.command(name="health", description="Check system health")
    @is_admin()
    async def health(self, interaction: discord.Interaction):
        async with async_session_maker() as db:
            try:
                vn_count = (await db.execute(
                    select(func.count()).select_from(VisualNovel)
                )).scalar_one_or_none() or 0
                db_status = "Healthy"
            except Exception as e:
                vn_count = 0
                db_status = f"Error: {e}"

            # Last import time
            result = await db.execute(
                select(SystemMetadata).where(SystemMetadata.key == "last_import")
            )
            metadata = result.scalar_one_or_none()
            last_import = metadata.value if metadata else "Never"

            # Import run count
            total_imports = (await db.execute(
                select(func.count()).select_from(ImportRun)
            )).scalar_one_or_none() or 0

        embed = discord.Embed(title="System Health", color=discord.Color.green())
        embed.add_field(name="Database", value=db_status, inline=False)
        embed.add_field(name="Visual Novels", value=f"{vn_count:,}")
        embed.add_field(name="Last Import", value=last_import)
        embed.add_field(name="Total Imports", value=str(total_imports))
        await interaction.response.send_message(embed=embed)

    @group.command(name="stats", description="Show table row counts")
    @is_admin()
    async def stats(self, interaction: discord.Interaction):
        tables = [
            ("Visual Novels", VisualNovel),
            ("Tags", Tag),
            ("VN Tags", VNTag),
            ("Global Votes", GlobalVote),
            ("Producers", Producer),
            ("Staff", Staff),
            ("Characters", Character),
            ("Releases", Release),
            ("Traits", Trait),
        ]

        lines = []
        async with async_session_maker() as db:
            for name, model in tables:
                try:
                    count = (await db.execute(
                        select(func.count()).select_from(model)
                    )).scalar_one_or_none() or 0
                    lines.append(f"**{name}:** {count:,}")
                except Exception:
                    lines.append(f"**{name}:** error")

        embed = discord.Embed(
            title="Database Statistics",
            description="\n".join(lines),
            color=discord.Color.blue(),
        )
        await interaction.response.send_message(embed=embed)


async def setup(bot: commands.Bot):
    await bot.add_cog(SystemCog(bot))
