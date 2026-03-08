"""Shared links management view with paginated list and deletion."""

from datetime import datetime, timezone

import discord
from discord import ui
from sqlalchemy import select, func, delete, desc

from app.db.database import async_session_maker
from app.db.models import SharedLayout
from app.core.cache import get_cache
from discord_bot.views.base import BaseView, ConfirmView
from discord_bot.utils.embeds import create_embed, Colors


CACHE_PREFIX = "shared:"
ITEMS_PER_PAGE = 8


class SharedLinksView(BaseView):
    """Paginated view for browsing and managing shared links."""

    def __init__(self, user_id: int, frontend_url: str, timeout: float = 300):
        super().__init__(user_id, timeout)
        self.frontend_url = frontend_url.rstrip("/")
        self.current_page = 0
        self.total_count = 0
        self.type_filter: str | None = None  # None = all, 'grid', 'tierlist'
        self.links: list[dict] = []

    async def fetch_page(self) -> None:
        """Fetch the current page of links from the database."""
        async with async_session_maker() as db:
            # Base query
            base_filter = []
            if self.type_filter:
                base_filter.append(SharedLayout.type == self.type_filter)

            # Total count
            count_q = select(func.count()).select_from(SharedLayout)
            for f in base_filter:
                count_q = count_q.where(f)
            self.total_count = (await db.execute(count_q)).scalar_one()

            # Page data
            q = (
                select(SharedLayout)
                .order_by(desc(SharedLayout.created_at))
                .offset(self.current_page * ITEMS_PER_PAGE)
                .limit(ITEMS_PER_PAGE)
            )
            for f in base_filter:
                q = q.where(f)

            result = await db.execute(q)
            rows = result.scalars().all()

            self.links = []
            for row in rows:
                data = row.data or {}
                # Extract a summary
                if row.type == "grid":
                    mode = data.get("mode", "?")
                    size = data.get("gridSize", "?")
                    cells = data.get("cells", [])
                    filled = sum(1 for c in cells if c is not None)
                    title = data.get("gridTitle", "")
                    summary = f"{size}x{size} {mode} ({filled} items)"
                    if title:
                        summary = f"{title} - {summary}"
                else:
                    mode = data.get("mode", "?")
                    tiers = data.get("tiers", {})
                    item_count = sum(len(v) for v in tiers.values()) if isinstance(tiers, dict) else 0
                    title = data.get("listTitle", "")
                    summary = f"{mode} ({item_count} items)"
                    if title:
                        summary = f"{title} - {summary}"

                self.links.append({
                    "id": row.id,
                    "type": row.type,
                    "created_at": row.created_at,
                    "view_count": row.view_count or 0,
                    "summary": summary,
                })

    @property
    def total_pages(self) -> int:
        return max(1, (self.total_count + ITEMS_PER_PAGE - 1) // ITEMS_PER_PAGE)

    def _build_link_url(self, link: dict) -> str:
        if link["type"] == "grid":
            return f"{self.frontend_url}/3x3-maker/s/{link['id']}/"
        return f"{self.frontend_url}/tierlist/s/{link['id']}/"

    async def build_embed(self) -> discord.Embed:
        """Build the embed for the current page."""
        filter_label = ""
        if self.type_filter == "grid":
            filter_label = " (3x3 only)"
        elif self.type_filter == "tierlist":
            filter_label = " (tierlists only)"

        embed = create_embed(
            f"Shared Links{filter_label}",
            color=Colors.PRIMARY,
            footer_text=f"Page {self.current_page + 1}/{self.total_pages} | {self.total_count} total links",
        )

        if not self.links:
            embed.description = "No shared links found."
            return embed

        lines = []
        for link in self.links:
            type_icon = "\U0001f4d0" if link["type"] == "grid" else "\U0001f3af"  # grid / tierlist
            age = _format_age(link["created_at"])
            views = link["view_count"]
            url = self._build_link_url(link)
            lines.append(
                f"{type_icon} [`{link['id']}`]({url}) - {link['summary']}\n"
                f"  {age} | {views} view{'s' if views != 1 else ''}"
            )

        embed.description = "\n\n".join(lines)
        return embed

    def _update_nav_buttons(self) -> None:
        self.prev_button.disabled = self.current_page <= 0
        self.next_button.disabled = self.current_page >= self.total_pages - 1

    async def refresh(self, interaction: discord.Interaction) -> None:
        """Refresh data and update the message."""
        await self.fetch_page()
        self._update_nav_buttons()
        embed = await self.build_embed()
        await interaction.response.edit_message(embed=embed, view=self)

    # --- Navigation buttons (row 1) ---

    @ui.button(label="<", style=discord.ButtonStyle.secondary, row=1)
    async def prev_button(self, interaction: discord.Interaction, button: ui.Button) -> None:
        if self.current_page > 0:
            self.current_page -= 1
            await self.refresh(interaction)
        else:
            await interaction.response.defer()

    @ui.button(label=">", style=discord.ButtonStyle.secondary, row=1)
    async def next_button(self, interaction: discord.Interaction, button: ui.Button) -> None:
        if self.current_page < self.total_pages - 1:
            self.current_page += 1
            await self.refresh(interaction)
        else:
            await interaction.response.defer()

    @ui.button(label="Refresh", style=discord.ButtonStyle.secondary, emoji="\U0001f504", row=1)
    async def refresh_button(self, interaction: discord.Interaction, button: ui.Button) -> None:
        self.current_page = 0
        await self.refresh(interaction)

    # --- Filter select (row 2) ---

    @ui.select(
        placeholder="Filter by type",
        options=[
            discord.SelectOption(label="All Links", value="all", default=True),
            discord.SelectOption(label="3x3 Grids", value="grid", emoji="\U0001f4d0"),
            discord.SelectOption(label="Tier Lists", value="tierlist", emoji="\U0001f3af"),
        ],
        row=2,
    )
    async def type_filter_select(self, interaction: discord.Interaction, select: ui.Select) -> None:
        value = select.values[0]
        self.type_filter = None if value == "all" else value
        self.current_page = 0
        await self.refresh(interaction)

    # --- Delete button (row 3) ---

    @ui.button(label="Delete Link", style=discord.ButtonStyle.danger, emoji="\U0001f5d1", row=3)
    async def delete_button(self, interaction: discord.Interaction, button: ui.Button) -> None:
        """Open a modal to enter a link ID to delete."""
        modal = DeleteLinkModal(self)
        await interaction.response.send_modal(modal)


class DeleteLinkModal(ui.Modal, title="Delete Shared Link"):
    """Modal for entering a link ID to delete."""

    link_id = ui.TextInput(
        label="Link ID",
        placeholder="e.g. abc123XY",
        min_length=6,
        max_length=12,
        required=True,
    )

    def __init__(self, parent_view: SharedLinksView):
        super().__init__()
        self.parent_view = parent_view

    async def on_submit(self, interaction: discord.Interaction) -> None:
        link_id = self.link_id.value.strip()

        async with async_session_maker() as db:
            # Check it exists
            result = await db.execute(
                select(SharedLayout).where(SharedLayout.id == link_id)
            )
            layout = result.scalar_one_or_none()

            if not layout:
                await interaction.response.send_message(
                    f"Link `{link_id}` not found.", ephemeral=True
                )
                return

            # Build confirm view
            type_icon = "\U0001f4d0" if layout.type == "grid" else "\U0001f3af"
            confirm_view = ConfirmView(
                user_id=interaction.user.id,
                confirm_label="Delete",
                confirm_style=discord.ButtonStyle.danger,
            )
            await interaction.response.send_message(
                f"{type_icon} Delete link `{link_id}` ({layout.type})?\nViews: {layout.view_count or 0} | Created: {_format_age(layout.created_at)}",
                view=confirm_view,
                ephemeral=True,
            )
            confirm_msg = await interaction.original_response()
            await confirm_view.wait()

            if not confirm_view.value:
                await confirm_msg.edit(content="Cancelled.", view=None)
                return

            # Delete from DB
            await db.execute(
                delete(SharedLayout).where(SharedLayout.id == link_id)
            )
            await db.commit()

            # Invalidate cache
            cache = get_cache()
            await cache.delete(f"{CACHE_PREFIX}{link_id}")

            # Confirm deletion in the ephemeral message
            await confirm_msg.edit(
                content=f"\u2705 Deleted link `{link_id}` ({layout.type}).",
                view=None,
            )

            # Update the parent view
            await self.parent_view.fetch_page()
            self.parent_view._update_nav_buttons()
            embed = await self.parent_view.build_embed()
            if self.parent_view.message:
                await self.parent_view.message.edit(embed=embed, view=self.parent_view)


def _format_age(dt: datetime) -> str:
    """Format a datetime as a relative age string."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    now = datetime.now(timezone.utc)
    diff = now - dt
    seconds = int(diff.total_seconds())

    if seconds < 60:
        return "just now"
    elif seconds < 3600:
        m = seconds // 60
        return f"{m}m ago"
    elif seconds < 86400:
        h = seconds // 3600
        return f"{h}h ago"
    else:
        d = seconds // 86400
        return f"{d}d ago"
