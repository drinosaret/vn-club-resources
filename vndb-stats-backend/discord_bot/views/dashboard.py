"""Dashboard view with tabbed interface."""

import asyncio
from datetime import datetime, timezone, timedelta
from typing import Callable, Coroutine, Any

import discord
from discord import ui
from sqlalchemy import select, func, desc

from app.db.database import async_session_maker
from app.db.models import (
    VisualNovel, Tag, VNTag, GlobalVote, Producer, Staff,
    Character, Release, Trait, SystemMetadata, ImportRun, AppLog,
)
from discord_bot.views.base import BaseView
from discord_bot.utils.embeds import create_embed, Colors, format_relative_time
from discord_bot.utils.cache import table_stats_cache


class DashboardView(BaseView):
    """Tabbed dashboard view combining system, database, imports, and logs."""

    TABS = ["System", "Database", "Imports", "Logs"]

    def __init__(self, user_id: int, timeout: float = 300):
        super().__init__(user_id, timeout)
        self.active_tab = 0
        self.log_level_filter: str | None = None
        self._tab_buttons: list[ui.Button] = []
        self._create_tab_buttons()

    def _create_tab_buttons(self) -> None:
        """Create buttons for each tab."""
        for i, tab_name in enumerate(self.TABS):
            button = ui.Button(
                label=tab_name,
                style=discord.ButtonStyle.primary if i == 0 else discord.ButtonStyle.secondary,
                custom_id=f"tab_{i}",
                row=0,
            )
            button.callback = self._make_tab_callback(i)
            self._tab_buttons.append(button)
            self.add_item(button)

    def _make_tab_callback(
        self, index: int
    ) -> Callable[[discord.Interaction], Coroutine[Any, Any, None]]:
        """Create a callback for a tab button."""
        async def callback(interaction: discord.Interaction) -> None:
            if self.active_tab == index:
                await interaction.response.defer()
                return

            self.active_tab = index
            self._update_tab_styles()
            self._update_action_buttons()
            embed = await self.get_tab_content()
            await interaction.response.edit_message(embed=embed, view=self)

        return callback

    def _update_tab_styles(self) -> None:
        """Update button styles to reflect active tab."""
        for i, button in enumerate(self._tab_buttons):
            button.style = (
                discord.ButtonStyle.primary
                if i == self.active_tab
                else discord.ButtonStyle.secondary
            )

    def _update_action_buttons(self) -> None:
        """Update visibility of action buttons based on active tab."""
        # Show/hide log level select based on tab
        for item in self.children:
            if isinstance(item, LogLevelSelect):
                # Only show on Logs tab
                pass  # Select is always visible but only matters on logs tab

    async def get_tab_content(self) -> discord.Embed:
        """Get the embed content for the active tab."""
        if self.active_tab == 0:
            return await self._get_system_content()
        elif self.active_tab == 1:
            return await self._get_database_content()
        elif self.active_tab == 2:
            return await self._get_imports_content()
        elif self.active_tab == 3:
            return await self._get_logs_content()
        return create_embed("Unknown Tab", color=Colors.ERROR)

    async def _get_system_content(self) -> discord.Embed:
        """Get system health content."""
        async with async_session_maker() as db:
            try:
                vn_count = (await db.execute(
                    select(func.count()).select_from(VisualNovel)
                )).scalar_one_or_none() or 0
                db_status = "\u2705 Healthy"
            except Exception as e:
                vn_count = 0
                db_status = f"\u274c Error: {e}"

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

        embed = create_embed(
            "System Health",
            color=Colors.SUCCESS if "\u2705" in db_status else Colors.ERROR,
        )
        embed.add_field(name="Database", value=db_status, inline=False)
        embed.add_field(name="Visual Novels", value=f"{vn_count:,}")
        embed.add_field(name="Last Import", value=last_import)
        embed.add_field(name="Total Imports", value=str(total_imports))
        return embed

    async def _get_database_content(self) -> discord.Embed:
        """Get database statistics with parallel queries."""
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

        # Check cache first
        cached = table_stats_cache.get("all_counts")
        if cached:
            counts = cached
        else:
            # Run all count queries in parallel
            async def count_table(model) -> int:
                async with async_session_maker() as db:
                    try:
                        result = await db.execute(
                            select(func.count()).select_from(model)
                        )
                        return result.scalar_one_or_none() or 0
                    except Exception:
                        return -1

            results = await asyncio.gather(*[count_table(model) for _, model in tables])
            counts = dict(zip([name for name, _ in tables], results))
            table_stats_cache.set("all_counts", counts)

        lines = []
        for name, _ in tables:
            count = counts.get(name, -1)
            if count < 0:
                lines.append(f"**{name}:** error")
            else:
                lines.append(f"**{name}:** {count:,}")

        return create_embed(
            "Database Statistics",
            description="\n".join(lines),
            color=Colors.PRIMARY,
        )

    async def _get_imports_content(self) -> discord.Embed:
        """Get import status content."""
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

        embed = create_embed("Import Status", color=Colors.PRIMARY)

        if current:
            duration = ""
            if current.started_at:
                elapsed = (datetime.now(timezone.utc) - current.started_at).total_seconds()
                duration = f" ({int(elapsed // 60)}m {int(elapsed % 60)}s)"

            progress = current.progress_percent or 0
            filled = int(progress / 5)
            bar = "\u2588" * filled + "\u2591" * (20 - filled)

            embed.add_field(
                name="\u23f3 Current Import",
                value=(
                    f"**Run #{current.id}**\n"
                    f"Phase: {current.phase or 'starting'}\n"
                    f"`[{bar}]` {progress:.1f}%\n"
                    f"Step {current.current_step or 0}/{current.total_steps or 21}{duration}"
                ),
                inline=False,
            )
        else:
            embed.add_field(
                name="Current Import",
                value="No import running",
                inline=False,
            )

        if last:
            status_emoji = {
                "completed": "\u2705",
                "failed": "\u274c",
                "cancelled": "\u26d4",
            }.get(last.status, "\u2753")

            duration = ""
            if last.started_at and last.ended_at:
                elapsed = (last.ended_at - last.started_at).total_seconds()
                duration = f" ({int(elapsed // 60)}m {int(elapsed % 60)}s)"

            ended_text = ""
            if last.ended_at:
                ended_text = f"\nEnded: {format_relative_time(last.ended_at)}"

            embed.add_field(
                name=f"{status_emoji} Last Import",
                value=f"**Run #{last.id}** - {last.status}{duration}{ended_text}",
                inline=False,
            )

        return embed

    async def _get_logs_content(self) -> discord.Embed:
        """Get recent logs content."""
        cutoff = datetime.now(timezone.utc) - timedelta(hours=24)

        async with async_session_maker() as db:
            query = select(AppLog).where(AppLog.timestamp >= cutoff)

            if self.log_level_filter:
                query = query.where(AppLog.level == self.log_level_filter)

            query = query.order_by(desc(AppLog.timestamp)).limit(15)
            result = await db.execute(query)
            logs = result.scalars().all()

            # Get log stats
            stats_result = await db.execute(
                select(AppLog.level, func.count(AppLog.id))
                .where(AppLog.timestamp >= cutoff)
                .group_by(AppLog.level)
            )
            counts = {row[0]: row[1] for row in stats_result.all()}

        # Stats line
        stats_line = f"\u274c {counts.get('ERROR', 0)} | \u26a0\ufe0f {counts.get('WARNING', 0)} | \u2139\ufe0f {counts.get('INFO', 0)}"

        if not logs:
            filter_text = f" (filter: {self.log_level_filter})" if self.log_level_filter else ""
            return create_embed(
                "Application Logs (24h)",
                description=f"{stats_line}\n\nNo logs found{filter_text}.",
                color=Colors.PRIMARY,
            )

        lines = [stats_line, ""]
        for log in reversed(logs):
            ts = log.timestamp.strftime("%m/%d %H:%M") if log.timestamp else "???"
            emoji = {"ERROR": "\u274c", "WARNING": "\u26a0\ufe0f", "INFO": "\u2139\ufe0f"}.get(log.level, "\u2753")
            msg = (log.message[:60] + "...") if len(log.message or "") > 60 else (log.message or "")
            lines.append(f"`{ts}` {emoji} [{log.source}] {msg}")

        description = "\n".join(lines)
        if len(description) > 4000:
            description = description[:4000] + "\n..."

        filter_text = f" | Filter: {self.log_level_filter}" if self.log_level_filter else ""
        return create_embed(
            f"Application Logs (24h){filter_text}",
            description=description,
            color=Colors.PRIMARY,
        )

    @ui.select(
        placeholder="Filter logs by level",
        options=[
            discord.SelectOption(label="All Levels", value="all", default=True),
            discord.SelectOption(label="Errors Only", value="ERROR", emoji="\u274c"),
            discord.SelectOption(label="Warnings Only", value="WARNING", emoji="\u26a0\ufe0f"),
            discord.SelectOption(label="Info Only", value="INFO", emoji="\u2139\ufe0f"),
        ],
        row=1,
    )
    async def log_level_select(
        self, interaction: discord.Interaction, select: ui.Select
    ) -> None:
        """Handle log level filter selection."""
        value = select.values[0]
        self.log_level_filter = None if value == "all" else value

        # Only update if we're on the logs tab
        if self.active_tab == 3:
            embed = await self._get_logs_content()
            await interaction.response.edit_message(embed=embed, view=self)
        else:
            await interaction.response.defer()


class LogLevelSelect(ui.Select):
    """Dropdown for filtering log levels."""

    def __init__(self, view: DashboardView):
        self.dashboard_view = view
        options = [
            discord.SelectOption(label="All Levels", value="all", default=True),
            discord.SelectOption(label="Errors Only", value="ERROR", emoji="\u274c"),
            discord.SelectOption(label="Warnings Only", value="WARNING", emoji="\u26a0\ufe0f"),
            discord.SelectOption(label="Info Only", value="INFO", emoji="\u2139\ufe0f"),
        ]
        super().__init__(placeholder="Filter logs by level", options=options, row=1)

    async def callback(self, interaction: discord.Interaction) -> None:
        value = self.values[0]
        self.dashboard_view.log_level_filter = None if value == "all" else value

        if self.dashboard_view.active_tab == 3:
            embed = await self.dashboard_view._get_logs_content()
            await interaction.response.edit_message(embed=embed, view=self.dashboard_view)
        else:
            await interaction.response.defer()
