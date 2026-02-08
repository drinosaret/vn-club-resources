"""News management view with pagination."""

from datetime import datetime, timezone
from typing import Any

import discord
from discord import ui
from sqlalchemy import select, desc

from app.db.database import async_session_maker
from app.db.models import NewsItem
from discord_bot.views.base import PaginatedView
from discord_bot.utils.embeds import create_embed, Colors


class NewsView(PaginatedView):
    """Paginated view for managing news items."""

    def __init__(
        self,
        user_id: int,
        items: list[NewsItem],
        source_filter: str | None = None,
        per_page: int = 8,
        timeout: float = 300,
    ):
        super().__init__(user_id, items, per_page, timeout)
        self.source_filter = source_filter
        self.show_hidden = False
        self._build_source_select()

    def _build_source_select(self) -> None:
        """Build source filter dropdown from available sources."""
        # Get unique sources
        sources = set(item.source for item in self.items if item.source)
        options = [discord.SelectOption(label="All Sources", value="all", default=True)]
        for source in sorted(sources):
            label = source.upper() if len(source) <= 10 else source.title()
            options.append(discord.SelectOption(label=label, value=source))

        if len(options) > 1:
            select = NewsSourceSelect(options, self)
            self.add_item(select)

    async def format_page(self) -> discord.Embed:
        """Format the current page of news items."""
        if not self.items:
            filter_text = f" (source: {self.source_filter})" if self.source_filter else ""
            return create_embed(
                "News Feed",
                description=f"No news items found{filter_text}.",
                color=Colors.PRIMARY,
            )

        # Filter items based on current settings
        filtered_items = self.items
        if self.source_filter:
            filtered_items = [i for i in self.items if i.source == self.source_filter]
        if not self.show_hidden:
            filtered_items = [i for i in filtered_items if not i.is_hidden]

        # Paginate
        start = self.current_page * self.per_page
        end = start + self.per_page
        page_items = filtered_items[start:end]

        lines = []
        for item in page_items:
            source = (item.source_label or item.source or "").upper()
            date_str = item.published_at.strftime("%b %d") if item.published_at else ""
            hidden_tag = " **[HIDDEN]**" if item.is_hidden else ""

            title = item.title[:60] + "..." if len(item.title or "") > 60 else (item.title or "No title")
            lines.append(f"[{source}] **{title}**{hidden_tag}")
            lines.append(f"  {date_str} | ID: `{item.id[:8]}...`")

        total_pages = max(1, (len(filtered_items) + self.per_page - 1) // self.per_page)
        filter_text = f" | Source: {self.source_filter}" if self.source_filter else ""
        hidden_text = " (showing hidden)" if self.show_hidden else ""

        return create_embed(
            f"News Feed{filter_text}{hidden_text}",
            description="\n".join(lines) if lines else "No items on this page.",
            footer_text=f"Page {self.current_page + 1}/{total_pages} | {len(filtered_items)} items",
            color=Colors.PRIMARY,
        )

    async def refresh_data(self) -> None:
        """Refresh news data from database."""
        async with async_session_maker() as db:
            query = select(NewsItem).order_by(desc(NewsItem.published_at)).limit(100)
            result = await db.execute(query)
            self.items = list(result.scalars().all())

    @ui.button(label="Refresh Sources", style=discord.ButtonStyle.primary, emoji="\U0001f504", row=2)
    async def refresh_button(
        self, interaction: discord.Interaction, button: ui.Button
    ) -> None:
        """Trigger news refresh from all sources."""
        await interaction.response.defer()

        from app.ingestion.news_aggregator import run_all_news_checks

        await run_all_news_checks()
        await self.refresh_data()
        embed = await self.format_page()

        await interaction.followup.edit_message(
            message_id=interaction.message.id,
            content="\u2705 News refresh completed",
            embed=embed,
            view=self,
        )

    @ui.button(label="Show Hidden", style=discord.ButtonStyle.secondary, row=2)
    async def toggle_hidden_button(
        self, interaction: discord.Interaction, button: ui.Button
    ) -> None:
        """Toggle showing hidden news items."""
        self.show_hidden = not self.show_hidden
        button.label = "Hide Hidden" if self.show_hidden else "Show Hidden"
        self.current_page = 0  # Reset to first page
        embed = await self.format_page()
        await interaction.response.edit_message(embed=embed, view=self)

    @ui.button(label="Manage Item", style=discord.ButtonStyle.secondary, emoji="\u270f\ufe0f", row=2)
    async def manage_button(
        self, interaction: discord.Interaction, button: ui.Button
    ) -> None:
        """Show item management modal."""
        # Get current page items for selection
        filtered_items = self.items
        if self.source_filter:
            filtered_items = [i for i in self.items if i.source == self.source_filter]
        if not self.show_hidden:
            filtered_items = [i for i in filtered_items if not i.is_hidden]

        start = self.current_page * self.per_page
        end = start + self.per_page
        page_items = filtered_items[start:end]

        if not page_items:
            await interaction.response.send_message("No items on this page to manage.", ephemeral=True)
            return

        # Create select for items on current page
        options = []
        for item in page_items:
            source = (item.source_label or item.source or "").upper()
            title = item.title[:50] if len(item.title or "") > 50 else (item.title or "No title")
            status = "\U0001f441\ufe0f" if not item.is_hidden else "\U0001f6ab"
            options.append(
                discord.SelectOption(
                    label=f"{status} {title}"[:100],
                    value=item.id,
                    description=f"[{source}] Click to hide/unhide",
                )
            )

        select_view = NewsItemSelectView(
            user_id=interaction.user.id,
            options=options,
            parent_view=self,
        )
        await interaction.response.edit_message(
            content="Select a news item to hide/unhide:",
            view=select_view,
        )


class NewsSourceSelect(ui.Select):
    """Dropdown for filtering news by source."""

    def __init__(self, options: list[discord.SelectOption], parent_view: NewsView):
        super().__init__(
            placeholder="Filter by source...",
            options=options,
            row=3,
        )
        self.parent_view = parent_view

    async def callback(self, interaction: discord.Interaction) -> None:
        value = self.values[0]
        self.parent_view.source_filter = None if value == "all" else value
        self.parent_view.current_page = 0

        embed = await self.parent_view.format_page()
        await interaction.response.edit_message(embed=embed, view=self.parent_view)


class NewsItemSelectView(discord.ui.View):
    """View for selecting a news item to hide/unhide."""

    def __init__(
        self,
        user_id: int,
        options: list[discord.SelectOption],
        parent_view: NewsView,
        timeout: float = 60,
    ):
        super().__init__(timeout=timeout)
        self.user_id = user_id
        self.parent_view = parent_view

        select = ui.Select(
            placeholder="Select item...",
            options=options,
        )
        select.callback = self.select_callback
        self.add_item(select)

    async def interaction_check(self, interaction: discord.Interaction) -> bool:
        return interaction.user.id == self.user_id

    async def select_callback(self, interaction: discord.Interaction) -> None:
        item_id = interaction.data["values"][0]

        async with async_session_maker() as db:
            result = await db.execute(
                select(NewsItem).where(NewsItem.id == item_id)
            )
            item = result.scalar_one_or_none()

            if item:
                item.is_hidden = not item.is_hidden
                await db.commit()
                action = "hidden" if item.is_hidden else "unhidden"

        await self.parent_view.refresh_data()
        embed = await self.parent_view.format_page()
        await interaction.response.edit_message(
            content=f"\u2705 News item {action}",
            embed=embed,
            view=self.parent_view,
        )

    @ui.button(label="Cancel", style=discord.ButtonStyle.secondary, row=1)
    async def cancel_button(
        self, interaction: discord.Interaction, button: ui.Button
    ) -> None:
        embed = await self.parent_view.format_page()
        await interaction.response.edit_message(
            content=None,
            embed=embed,
            view=self.parent_view,
        )
