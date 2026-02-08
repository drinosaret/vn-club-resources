"""Application log viewing commands."""

import logging
from datetime import datetime, timezone, timedelta

import discord
from discord import app_commands
from discord.ext import commands
from sqlalchemy import select, func, desc

from app.db.database import async_session_maker
from app.db.models import AppLog
from discord_bot.permissions import is_admin

logger = logging.getLogger(__name__)


class LogsCog(commands.Cog):
    """View application logs."""

    group = app_commands.Group(name="logs", description="Application log viewing")

    def __init__(self, bot: commands.Bot):
        self.bot = bot

    @group.command(name="recent", description="View recent application logs")
    @app_commands.describe(
        source="Filter by source (e.g., 'api', 'worker')",
        level="Filter by log level (INFO, WARNING, ERROR)",
        hours="How far back to look (default 24)",
        limit="Number of entries to show (max 50)",
    )
    @is_admin()
    async def recent_logs(
        self,
        interaction: discord.Interaction,
        source: str | None = None,
        level: str | None = None,
        hours: int = 24,
        limit: int = 20,
    ):
        limit = min(limit, 50)
        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)

        async with async_session_maker() as db:
            query = select(AppLog).where(AppLog.timestamp >= cutoff)

            if source:
                query = query.where(AppLog.source == source)
            if level:
                query = query.where(AppLog.level == level.upper())

            query = query.order_by(desc(AppLog.timestamp)).limit(limit)
            result = await db.execute(query)
            logs = result.scalars().all()

        if not logs:
            await interaction.response.send_message(f"No logs found in the last {hours} hours.")
            return

        lines = []
        for log in reversed(logs):
            ts = log.timestamp.strftime("%m/%d %H:%M:%S") if log.timestamp else "???"
            msg = log.message[:80] if log.message else ""
            lines.append(f"`{ts}` **{log.level}** [{log.source}] {msg}")

        # Discord embeds have a 4096 char limit for description
        description = "\n".join(lines)
        if len(description) > 4000:
            description = description[:4000] + "\n..."

        embed = discord.Embed(
            title=f"Recent Logs (last {hours}h)",
            description=description,
            color=discord.Color.blue(),
        )
        await interaction.response.send_message(embed=embed)

    @group.command(name="stats", description="Show log level counts")
    @app_commands.describe(hours="Time period to count (default 24)")
    @is_admin()
    async def log_stats(self, interaction: discord.Interaction, hours: int = 24):
        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)

        async with async_session_maker() as db:
            result = await db.execute(
                select(AppLog.level, func.count(AppLog.id))
                .where(AppLog.timestamp >= cutoff)
                .group_by(AppLog.level)
            )
            counts = {row[0]: row[1] for row in result.all()}

        embed = discord.Embed(
            title=f"Log Statistics (last {hours}h)",
            color=discord.Color.blue(),
        )
        embed.add_field(name="ERROR", value=str(counts.get("ERROR", 0)))
        embed.add_field(name="WARNING", value=str(counts.get("WARNING", 0)))
        embed.add_field(name="INFO", value=str(counts.get("INFO", 0)))
        await interaction.response.send_message(embed=embed)


async def setup(bot: commands.Bot):
    await bot.add_cog(LogsCog(bot))
