"""Import management view with status and history."""

from datetime import datetime, timezone
from typing import Any

import discord
from discord import ui
from sqlalchemy import select, desc

from app.db.database import async_session_maker
from app.db.models import ImportRun, ImportLog
from discord_bot.views.base import BaseView, PaginatedView, ConfirmView
from discord_bot.utils.embeds import create_embed, create_progress_embed, Colors, format_relative_time


class ImportsView(BaseView):
    """Main view for import management."""

    def __init__(self, user_id: int, timeout: float = 300):
        super().__init__(user_id, timeout)
        self.current_run: ImportRun | None = None
        self.last_run: ImportRun | None = None

    async def load_data(self) -> None:
        """Load current and last import run data."""
        async with async_session_maker() as db:
            # Current running import
            result = await db.execute(
                select(ImportRun).where(ImportRun.status == "running").limit(1)
            )
            self.current_run = result.scalar_one_or_none()

            # Also check pending
            if not self.current_run:
                result = await db.execute(
                    select(ImportRun).where(ImportRun.status == "pending").limit(1)
                )
                self.current_run = result.scalar_one_or_none()

            # Last completed import
            result = await db.execute(
                select(ImportRun)
                .where(ImportRun.status.in_(["completed", "failed", "cancelled"]))
                .order_by(desc(ImportRun.ended_at))
                .limit(1)
            )
            self.last_run = result.scalar_one_or_none()

        self._update_buttons()

    def _update_buttons(self) -> None:
        """Update button states based on current import status."""
        has_running = self.current_run is not None
        self.start_button.disabled = has_running
        self.cancel_button.disabled = not has_running

    def get_embed(self) -> discord.Embed:
        """Generate the import status embed."""
        embed = create_embed("Import Management", color=Colors.PRIMARY)

        if self.current_run:
            duration = ""
            if self.current_run.started_at:
                elapsed = (datetime.now(timezone.utc) - self.current_run.started_at).total_seconds()
                duration = f" ({int(elapsed // 60)}m {int(elapsed % 60)}s)"

            progress = self.current_run.progress_percent or 0
            filled = int(progress / 5)
            bar = "\u2588" * filled + "\u2591" * (20 - filled)

            status_emoji = "\u23f3" if self.current_run.status == "running" else "\u23f8\ufe0f"
            embed.add_field(
                name=f"{status_emoji} Current Import - Run #{self.current_run.id}",
                value=(
                    f"**Status:** {self.current_run.status}\n"
                    f"**Phase:** {self.current_run.phase or 'Starting...'}\n"
                    f"**Progress:** `[{bar}]` {progress:.1f}%\n"
                    f"**Step:** {self.current_run.current_step or 0}/{self.current_run.total_steps or 21}{duration}"
                ),
                inline=False,
            )
        else:
            embed.add_field(
                name="Current Import",
                value="No import running.\n\nClick **Start Import** to begin.",
                inline=False,
            )

        if self.last_run:
            status_emoji = {
                "completed": "\u2705",
                "failed": "\u274c",
                "cancelled": "\u26d4",
            }.get(self.last_run.status, "\u2753")

            duration = ""
            if self.last_run.started_at and self.last_run.ended_at:
                elapsed = (self.last_run.ended_at - self.last_run.started_at).total_seconds()
                duration = f" ({int(elapsed // 60)}m {int(elapsed % 60)}s)"

            ended_text = ""
            if self.last_run.ended_at:
                ended_text = f"\n**Ended:** {format_relative_time(self.last_run.ended_at)}"

            embed.add_field(
                name=f"{status_emoji} Last Import - Run #{self.last_run.id}",
                value=f"**Status:** {self.last_run.status}{duration}{ended_text}",
                inline=False,
            )

        return embed

    @ui.button(label="Start Import", style=discord.ButtonStyle.success, emoji="\u25b6\ufe0f", row=0)
    async def start_button(
        self, interaction: discord.Interaction, button: ui.Button
    ) -> None:
        """Start a new import."""
        # Confirm first
        confirm_view = ConfirmView(
            user_id=interaction.user.id,
            confirm_label="Start Import",
            confirm_style=discord.ButtonStyle.success,
            timeout=30,
        )
        await interaction.response.edit_message(
            content="**Start a new VNDB data import?**\n\nThis process takes approximately 10-15 minutes.",
            embed=None,
            view=confirm_view,
        )
        await confirm_view.wait()

        if confirm_view.value:
            async with async_session_maker() as db:
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

            # Start import in background
            from app.ingestion.importer import run_import_with_tracking

            async def _run():
                try:
                    await run_import_with_tracking(run_id, False)
                except Exception as e:
                    import logging
                    logging.getLogger(__name__).error(f"Import failed: {e}")

            interaction.client.loop.create_task(_run())

            await self.load_data()
            embed = self.get_embed()
            await interaction.edit_original_response(
                content=f"\u2705 Import **#{run_id}** started",
                embed=embed,
                view=self,
            )
        else:
            await self.load_data()
            embed = self.get_embed()
            await interaction.edit_original_response(
                content=None,
                embed=embed,
                view=self,
            )

    @ui.button(label="Force Import", style=discord.ButtonStyle.secondary, emoji="\U0001f504", row=0)
    async def force_button(
        self, interaction: discord.Interaction, button: ui.Button
    ) -> None:
        """Start import with force re-download."""
        if self.current_run:
            await interaction.response.send_message(
                "An import is already in progress.", ephemeral=True
            )
            return

        # Confirm first
        confirm_view = ConfirmView(
            user_id=interaction.user.id,
            confirm_label="Force Import",
            confirm_style=discord.ButtonStyle.primary,
            timeout=30,
        )
        await interaction.response.edit_message(
            content="**Start import with forced re-download?**\n\nThis will re-download all VNDB dumps even if recent versions exist.",
            embed=None,
            view=confirm_view,
        )
        await confirm_view.wait()

        if confirm_view.value:
            async with async_session_maker() as db:
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

            # Start import in background with force=True
            from app.ingestion.importer import run_import_with_tracking

            async def _run():
                try:
                    await run_import_with_tracking(run_id, True)
                except Exception as e:
                    import logging
                    logging.getLogger(__name__).error(f"Import failed: {e}")

            interaction.client.loop.create_task(_run())

            await self.load_data()
            embed = self.get_embed()
            await interaction.edit_original_response(
                content=f"\u2705 Force import **#{run_id}** started",
                embed=embed,
                view=self,
            )
        else:
            await self.load_data()
            embed = self.get_embed()
            await interaction.edit_original_response(
                content=None,
                embed=embed,
                view=self,
            )

    @ui.button(label="Cancel", style=discord.ButtonStyle.danger, emoji="\u23f9\ufe0f", row=0)
    async def cancel_button(
        self, interaction: discord.Interaction, button: ui.Button
    ) -> None:
        """Cancel running import."""
        if not self.current_run:
            await interaction.response.send_message(
                "No import running to cancel.", ephemeral=True
            )
            return

        async with async_session_maker() as db:
            result = await db.execute(
                select(ImportRun).where(ImportRun.id == self.current_run.id)
            )
            run = result.scalar_one_or_none()
            if run:
                run.status = "cancelled"
                run.ended_at = datetime.now(timezone.utc)
                await db.commit()

        await self.load_data()
        embed = self.get_embed()
        await interaction.response.edit_message(
            content=f"\u26d4 Import **#{self.current_run.id}** cancelled",
            embed=embed,
            view=self,
        )

    @ui.button(label="Refresh", style=discord.ButtonStyle.secondary, emoji="\U0001f504", row=1)
    async def refresh_button(
        self, interaction: discord.Interaction, button: ui.Button
    ) -> None:
        """Refresh status display."""
        await self.load_data()
        embed = self.get_embed()
        await interaction.response.edit_message(embed=embed, view=self)

    @ui.button(label="View History", style=discord.ButtonStyle.secondary, emoji="\U0001f4dc", row=1)
    async def history_button(
        self, interaction: discord.Interaction, button: ui.Button
    ) -> None:
        """Show import history."""
        async with async_session_maker() as db:
            result = await db.execute(
                select(ImportRun).order_by(desc(ImportRun.started_at)).limit(50)
            )
            runs = list(result.scalars().all())

        history_view = ImportHistoryView(
            user_id=interaction.user.id,
            runs=runs,
            parent_view=self,
        )
        embed = await history_view.format_page()
        await interaction.response.edit_message(embed=embed, view=history_view)


class ImportHistoryView(PaginatedView):
    """Paginated view of import history."""

    def __init__(
        self,
        user_id: int,
        runs: list[ImportRun],
        parent_view: ImportsView,
        per_page: int = 10,
        timeout: float = 300,
    ):
        super().__init__(user_id, runs, per_page, timeout)
        self.parent_view = parent_view
        self._build_run_select()

    def _build_run_select(self) -> None:
        """Build run selection dropdown for viewing logs."""
        if not self.items:
            return

        options = []
        for run in self.items[:25]:
            status_emoji = {
                "completed": "\u2705",
                "failed": "\u274c",
                "cancelled": "\u26d4",
                "running": "\u23f3",
                "pending": "\u23f8\ufe0f",
            }.get(run.status, "\u2753")

            duration = ""
            if run.started_at and run.ended_at:
                elapsed = (run.ended_at - run.started_at).total_seconds()
                duration = f" ({int(elapsed // 60)}m)"

            options.append(
                discord.SelectOption(
                    label=f"{status_emoji} #{run.id} {run.status}{duration}"[:100],
                    value=str(run.id),
                    description=f"Triggered by: {run.triggered_by or 'scheduled'}",
                )
            )

        if options:
            select = ImportRunSelect(options, self)
            self.add_item(select)

    async def format_page(self) -> discord.Embed:
        """Format the current page of import history."""
        if not self.items:
            return create_embed(
                "Import History",
                description="No import runs found.",
                color=Colors.PRIMARY,
            )

        lines = []
        for run in self.current_items:
            status_emoji = {
                "completed": "\u2705",
                "failed": "\u274c",
                "cancelled": "\u26d4",
                "running": "\u23f3",
                "pending": "\u23f8\ufe0f",
            }.get(run.status, "\u2753")

            duration = ""
            if run.started_at and run.ended_at:
                elapsed = (run.ended_at - run.started_at).total_seconds()
                duration = f" ({int(elapsed // 60)}m {int(elapsed % 60)}s)"

            triggered = run.triggered_by or "scheduled"
            lines.append(f"{status_emoji} **#{run.id}** {run.status}{duration} - {triggered}")

        return create_embed(
            "Import History",
            description="\n".join(lines),
            footer_text=f"Page {self.current_page + 1}/{self.total_pages} | Select a run to view logs",
            color=Colors.PRIMARY,
        )

    @ui.button(label="Back", style=discord.ButtonStyle.secondary, emoji="\u2b05\ufe0f", row=3)
    async def back_button(
        self, interaction: discord.Interaction, button: ui.Button
    ) -> None:
        """Return to main imports view."""
        await self.parent_view.load_data()
        embed = self.parent_view.get_embed()
        await interaction.response.edit_message(embed=embed, view=self.parent_view)


class ImportRunSelect(ui.Select):
    """Dropdown for selecting an import run to view logs."""

    def __init__(self, options: list[discord.SelectOption], parent_view: ImportHistoryView):
        super().__init__(
            placeholder="Select run to view logs...",
            options=options,
            row=2,
        )
        self.parent_view = parent_view

    async def callback(self, interaction: discord.Interaction) -> None:
        run_id = int(self.values[0])

        async with async_session_maker() as db:
            result = await db.execute(
                select(ImportLog)
                .where(ImportLog.run_id == run_id)
                .order_by(desc(ImportLog.timestamp))
                .limit(50)
            )
            logs = list(result.scalars().all())

        if not logs:
            await interaction.response.send_message(
                f"No logs found for run #{run_id}.", ephemeral=True
            )
            return

        # Show logs view
        logs_view = ImportLogsView(
            user_id=interaction.user.id,
            run_id=run_id,
            logs=logs,
            parent_view=self.parent_view,
        )
        embed = await logs_view.format_page()
        await interaction.response.edit_message(embed=embed, view=logs_view)


class ImportLogsView(PaginatedView):
    """Paginated view of import logs for a specific run."""

    def __init__(
        self,
        user_id: int,
        run_id: int,
        logs: list[ImportLog],
        parent_view: ImportHistoryView,
        per_page: int = 15,
        timeout: float = 300,
    ):
        # Reverse to show chronological order
        super().__init__(user_id, list(reversed(logs)), per_page, timeout)
        self.run_id = run_id
        self.parent_view = parent_view

    async def format_page(self) -> discord.Embed:
        """Format the current page of logs."""
        if not self.items:
            return create_embed(
                f"Import Logs - Run #{self.run_id}",
                description="No logs found.",
                color=Colors.PRIMARY,
            )

        lines = []
        for log in self.current_items:
            ts = log.timestamp.strftime("%H:%M:%S") if log.timestamp else "??:??:??"
            emoji = {"ERROR": "\u274c", "WARNING": "\u26a0\ufe0f", "INFO": "\u2139\ufe0f"}.get(log.level, "\u2753")
            msg = (log.message[:70] + "...") if len(log.message or "") > 70 else (log.message or "")
            lines.append(f"`{ts}` {emoji} {msg}")

        return create_embed(
            f"Import Logs - Run #{self.run_id}",
            description="\n".join(lines),
            footer_text=f"Page {self.current_page + 1}/{self.total_pages}",
            color=Colors.PRIMARY,
        )

    @ui.button(label="Back to History", style=discord.ButtonStyle.secondary, emoji="\u2b05\ufe0f", row=3)
    async def back_button(
        self, interaction: discord.Interaction, button: ui.Button
    ) -> None:
        """Return to history view."""
        embed = await self.parent_view.format_page()
        await interaction.response.edit_message(embed=embed, view=self.parent_view)
