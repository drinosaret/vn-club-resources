"""Import management commands."""

import logging
from datetime import datetime, timezone

import discord
from discord import app_commands
from discord.ext import commands
from sqlalchemy import select, desc

from app.db.database import async_session_maker
from app.db.models import ImportRun, ImportLog
from discord_bot.permissions import is_admin

logger = logging.getLogger(__name__)


class ImportsCog(commands.Cog):
    """Manage VNDB data imports."""

    group = app_commands.Group(name="import", description="VNDB import management")

    def __init__(self, bot: commands.Bot):
        self.bot = bot

    @group.command(name="trigger", description="Start a VNDB data import")
    @app_commands.describe(force="Re-download dumps even if recent")
    @is_admin()
    async def trigger_import(self, interaction: discord.Interaction, force: bool = False):
        await interaction.response.defer()

        async with async_session_maker() as db:
            # Check if import already running
            result = await db.execute(
                select(ImportRun).where(ImportRun.status.in_(["pending", "running"])).limit(1)
            )
            if result.scalar_one_or_none():
                await interaction.followup.send("An import is already in progress. Cancel it first or wait for completion.")
                return

            # Create new run record
            run = ImportRun(
                status="pending",
                triggered_by="discord",
                started_at=datetime.now(timezone.utc),
                current_step=0,
                total_steps=21,
                progress_percent=0.0,
            )
            db.add(run)
            await db.commit()
            await db.refresh(run)
            run_id = run.id

        # Start import in background task
        from app.ingestion.importer import run_import_with_tracking

        async def _run():
            try:
                await run_import_with_tracking(run_id, force)
            except Exception as e:
                logger.error(f"Import failed: {e}")

        self.bot.loop.create_task(_run())

        embed = discord.Embed(
            title="Import Started",
            description=f"Import run **#{run_id}** has been started.",
            color=discord.Color.green(),
        )
        embed.add_field(name="Force", value=str(force))
        embed.add_field(name="Triggered by", value=interaction.user.display_name)
        await interaction.followup.send(embed=embed)

    @group.command(name="status", description="Show current import status")
    @is_admin()
    async def import_status(self, interaction: discord.Interaction):
        async with async_session_maker() as db:
            # Current running import
            result = await db.execute(
                select(ImportRun).where(ImportRun.status == "running").limit(1)
            )
            current = result.scalar_one_or_none()

            # Last completed import
            result = await db.execute(
                select(ImportRun)
                .where(ImportRun.status.in_(["completed", "failed", "cancelled"]))
                .order_by(desc(ImportRun.ended_at))
                .limit(1)
            )
            last = result.scalar_one_or_none()

        embed = discord.Embed(title="Import Status", color=discord.Color.blue())

        if current:
            duration = ""
            if current.started_at:
                elapsed = (datetime.now(timezone.utc) - current.started_at).total_seconds()
                duration = f" ({int(elapsed // 60)}m {int(elapsed % 60)}s)"

            embed.add_field(
                name="Current Import",
                value=(
                    f"**Run #{current.id}**\n"
                    f"Status: {current.status}\n"
                    f"Phase: {current.phase or 'starting'}\n"
                    f"Progress: {current.progress_percent or 0:.1f}% "
                    f"(step {current.current_step or 0}/{current.total_steps or 21}){duration}"
                ),
                inline=False,
            )
        else:
            embed.add_field(name="Current Import", value="No import running", inline=False)

        if last:
            duration = ""
            if last.started_at and last.ended_at:
                elapsed = (last.ended_at - last.started_at).total_seconds()
                duration = f" ({int(elapsed // 60)}m {int(elapsed % 60)}s)"

            embed.add_field(
                name="Last Import",
                value=(
                    f"**Run #{last.id}** - {last.status}{duration}\n"
                    f"Ended: <t:{int(last.ended_at.timestamp())}:R>"
                    if last.ended_at
                    else f"**Run #{last.id}** - {last.status}"
                ),
                inline=False,
            )

        await interaction.response.send_message(embed=embed)

    @group.command(name="history", description="Show recent import runs")
    @app_commands.describe(limit="Number of runs to show (max 25)")
    @is_admin()
    async def import_history(self, interaction: discord.Interaction, limit: int = 10):
        limit = min(limit, 25)

        async with async_session_maker() as db:
            result = await db.execute(
                select(ImportRun).order_by(desc(ImportRun.started_at)).limit(limit)
            )
            runs = result.scalars().all()

        if not runs:
            await interaction.response.send_message("No import history found.")
            return

        lines = []
        for run in runs:
            status_emoji = {"completed": "\u2705", "failed": "\u274c", "cancelled": "\u26d4", "running": "\u23f3"}.get(run.status, "\u2753")
            duration = ""
            if run.started_at and run.ended_at:
                elapsed = (run.ended_at - run.started_at).total_seconds()
                duration = f" ({int(elapsed // 60)}m {int(elapsed % 60)}s)"
            lines.append(f"{status_emoji} **#{run.id}** {run.status}{duration} - {run.triggered_by or 'scheduled'}")

        embed = discord.Embed(
            title=f"Import History (last {len(runs)})",
            description="\n".join(lines),
            color=discord.Color.blue(),
        )
        await interaction.response.send_message(embed=embed)

    @group.command(name="cancel", description="Cancel a running import")
    @is_admin()
    async def cancel_import(self, interaction: discord.Interaction):
        async with async_session_maker() as db:
            result = await db.execute(
                select(ImportRun).where(ImportRun.status.in_(["pending", "running"])).limit(1)
            )
            run = result.scalar_one_or_none()

            if not run:
                await interaction.response.send_message("No running import to cancel.")
                return

            run.status = "cancelled"
            run.ended_at = datetime.now(timezone.utc)
            await db.commit()

            await interaction.response.send_message(f"Import run **#{run.id}** has been cancelled.")

    @group.command(name="logs", description="View logs for an import run")
    @app_commands.describe(
        run_id="Import run number",
        level="Filter by log level (INFO, WARNING, ERROR)",
        limit="Number of log entries to show (max 50)",
    )
    @is_admin()
    async def import_logs(
        self,
        interaction: discord.Interaction,
        run_id: int,
        level: str | None = None,
        limit: int = 20,
    ):
        limit = min(limit, 50)

        async with async_session_maker() as db:
            query = select(ImportLog).where(ImportLog.run_id == run_id)
            if level:
                query = query.where(ImportLog.level == level.upper())
            query = query.order_by(desc(ImportLog.timestamp)).limit(limit)

            result = await db.execute(query)
            logs = result.scalars().all()

        if not logs:
            await interaction.response.send_message(f"No logs found for run #{run_id}.")
            return

        lines = []
        for log in reversed(logs):  # Show chronological order
            ts = log.timestamp.strftime("%H:%M:%S") if log.timestamp else "??:??:??"
            lines.append(f"`{ts}` **{log.level}** {log.message[:100]}")

        embed = discord.Embed(
            title=f"Import Logs - Run #{run_id}",
            description="\n".join(lines),
            color=discord.Color.blue(),
        )
        await interaction.response.send_message(embed=embed)


async def setup(bot: commands.Bot):
    await bot.add_cog(ImportsCog(bot))
