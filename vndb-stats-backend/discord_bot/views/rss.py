"""RSS feed management view."""

from typing import Any

import discord
from discord import ui
from sqlalchemy import select

from app.db.database import async_session_maker
from app.db.models import RSSFeedConfig
from discord_bot.views.base import BaseView, ConfirmView
from discord_bot.modals.rss import RSSFeedModal
from discord_bot.utils.embeds import create_embed, Colors
from discord_bot.utils.cache import rss_feeds_cache


class RSSFeedView(BaseView):
    """View for managing RSS feeds with inline actions."""

    def __init__(
        self,
        user_id: int,
        feeds: list[RSSFeedConfig],
        timeout: float = 300,
    ):
        super().__init__(user_id, timeout)
        self.feeds = feeds
        self._build_feed_select()

    def _build_feed_select(self) -> None:
        """Build the feed selection dropdown."""
        if not self.feeds:
            return

        options = []
        for feed in self.feeds[:25]:
            status = "\u2705" if feed.is_active else "\u274c"
            options.append(
                discord.SelectOption(
                    label=f"{status} {feed.name}"[:100],
                    value=str(feed.id),
                    description=feed.url[:100] if feed.url else "No URL",
                )
            )

        if options:
            select = RSSFeedSelect(options, self)
            self.add_item(select)

    def get_embed(self) -> discord.Embed:
        """Generate the RSS feeds list embed."""
        if not self.feeds:
            return create_embed(
                "RSS Feeds",
                description="No RSS feeds configured.\n\nClick **Add Feed** to add one.",
                color=Colors.PRIMARY,
            )

        lines = []
        for feed in self.feeds:
            status = "\u2705" if feed.is_active else "\u274c"
            lines.append(f"{status} **#{feed.id}** {feed.name}")
            lines.append(f"  {feed.url}")

        return create_embed(
            "RSS Feeds",
            description="\n".join(lines),
            footer_text="Select a feed to edit, toggle, or delete",
            color=Colors.PRIMARY,
        )

    async def refresh_data(self) -> None:
        """Refresh feed data from database."""
        async with async_session_maker() as db:
            result = await db.execute(
                select(RSSFeedConfig).order_by(RSSFeedConfig.name)
            )
            self.feeds = list(result.scalars().all())

        # Invalidate cache
        rss_feeds_cache.invalidate()

        # Rebuild select menu
        for item in list(self.children):
            if isinstance(item, RSSFeedSelect):
                self.remove_item(item)
        self._build_feed_select()

    @ui.button(label="Add Feed", style=discord.ButtonStyle.success, emoji="\u2795", row=2)
    async def add_button(
        self, interaction: discord.Interaction, button: ui.Button
    ) -> None:
        """Open modal to add new RSS feed."""
        modal = RSSFeedModal()
        await interaction.response.send_modal(modal)
        await modal.wait()

        if modal.result:
            async with async_session_maker() as db:
                config = RSSFeedConfig(
                    name=modal.result["name"],
                    url=modal.result["url"],
                    keywords=modal.result["keywords"],
                    exclude_keywords=modal.result["exclude_keywords"],
                    is_active=True,
                )
                db.add(config)
                await db.commit()
                await db.refresh(config)

            await self.refresh_data()
            embed = self.get_embed()
            await interaction.edit_original_response(
                content=f"\u2705 Added RSS feed **#{config.id}** ({config.name})",
                embed=embed,
                view=self,
            )


class RSSFeedSelect(ui.Select):
    """Dropdown for selecting an RSS feed to act on."""

    def __init__(self, options: list[discord.SelectOption], parent_view: RSSFeedView):
        super().__init__(
            placeholder="Select feed to manage...",
            options=options,
            row=1,
        )
        self.parent_view = parent_view

    async def callback(self, interaction: discord.Interaction) -> None:
        """Show action buttons for selected feed."""
        feed_id = int(self.values[0])

        async with async_session_maker() as db:
            result = await db.execute(
                select(RSSFeedConfig).where(RSSFeedConfig.id == feed_id)
            )
            feed = result.scalar_one_or_none()

        if not feed:
            await interaction.response.send_message(
                f"Feed #{feed_id} not found.", ephemeral=True
            )
            return

        # Show action view for this feed
        action_view = RSSFeedActionView(
            user_id=interaction.user.id,
            feed=feed,
            parent_view=self.parent_view,
        )
        embed = action_view.get_detail_embed()
        await interaction.response.edit_message(embed=embed, view=action_view)


class RSSFeedActionView(BaseView):
    """View showing actions for a specific RSS feed."""

    def __init__(
        self,
        user_id: int,
        feed: RSSFeedConfig,
        parent_view: RSSFeedView,
        timeout: float = 120,
    ):
        super().__init__(user_id, timeout)
        self.feed = feed
        self.parent_view = parent_view
        self._update_toggle_button()

    def _update_toggle_button(self) -> None:
        """Update toggle button label based on current state."""
        self.toggle_button.label = "Disable" if self.feed.is_active else "Enable"
        self.toggle_button.style = (
            discord.ButtonStyle.secondary
            if self.feed.is_active
            else discord.ButtonStyle.success
        )

    def get_detail_embed(self) -> discord.Embed:
        """Generate detail embed for the feed."""
        status = "\u2705 Active" if self.feed.is_active else "\u274c Inactive"
        embed = create_embed(
            f"RSS Feed #{self.feed.id}",
            description=f"**{self.feed.name}**",
            color=Colors.SUCCESS if self.feed.is_active else Colors.WARNING,
        )
        embed.add_field(name="Status", value=status, inline=True)
        embed.add_field(name="URL", value=self.feed.url or "Not set", inline=False)

        if self.feed.keywords:
            embed.add_field(name="Include Keywords", value=self.feed.keywords, inline=False)
        if self.feed.exclude_keywords:
            embed.add_field(name="Exclude Keywords", value=self.feed.exclude_keywords, inline=False)

        return embed

    @ui.button(label="Edit", style=discord.ButtonStyle.primary, emoji="\u270f\ufe0f", row=0)
    async def edit_button(
        self, interaction: discord.Interaction, button: ui.Button
    ) -> None:
        """Open modal to edit feed."""
        modal = RSSFeedModal(feed=self.feed)
        await interaction.response.send_modal(modal)
        await modal.wait()

        if modal.result:
            async with async_session_maker() as db:
                result = await db.execute(
                    select(RSSFeedConfig).where(RSSFeedConfig.id == self.feed.id)
                )
                feed = result.scalar_one_or_none()
                if feed:
                    feed.name = modal.result["name"]
                    feed.url = modal.result["url"]
                    feed.keywords = modal.result["keywords"]
                    feed.exclude_keywords = modal.result["exclude_keywords"]
                    await db.commit()
                    await db.refresh(feed)
                    self.feed = feed

            # Invalidate cache
            rss_feeds_cache.invalidate()

            embed = self.get_detail_embed()
            await interaction.edit_original_response(
                content="\u2705 Feed updated",
                embed=embed,
                view=self,
            )

    @ui.button(label="Toggle", style=discord.ButtonStyle.secondary, row=0)
    async def toggle_button(
        self, interaction: discord.Interaction, button: ui.Button
    ) -> None:
        """Toggle feed active status."""
        async with async_session_maker() as db:
            result = await db.execute(
                select(RSSFeedConfig).where(RSSFeedConfig.id == self.feed.id)
            )
            feed = result.scalar_one_or_none()
            if feed:
                feed.is_active = not feed.is_active
                await db.commit()
                await db.refresh(feed)
                self.feed = feed

        # Invalidate cache
        rss_feeds_cache.invalidate()

        self._update_toggle_button()
        status = "enabled" if self.feed.is_active else "disabled"
        embed = self.get_detail_embed()
        await interaction.response.edit_message(
            content=f"\u2705 Feed {status}",
            embed=embed,
            view=self,
        )

    @ui.button(label="Delete", style=discord.ButtonStyle.danger, emoji="\U0001f5d1\ufe0f", row=0)
    async def delete_button(
        self, interaction: discord.Interaction, button: ui.Button
    ) -> None:
        """Delete feed with confirmation."""
        confirm_view = ConfirmView(
            user_id=interaction.user.id,
            confirm_label="Delete",
            timeout=30,
        )
        await interaction.response.edit_message(
            content=f"**Are you sure you want to delete RSS feed #{self.feed.id}?**\n"
                    f"Name: {self.feed.name}\nURL: {self.feed.url}",
            embed=None,
            view=confirm_view,
        )
        await confirm_view.wait()

        if confirm_view.value:
            async with async_session_maker() as db:
                result = await db.execute(
                    select(RSSFeedConfig).where(RSSFeedConfig.id == self.feed.id)
                )
                feed = result.scalar_one_or_none()
                if feed:
                    await db.delete(feed)
                    await db.commit()

            # Invalidate cache
            rss_feeds_cache.invalidate()

            # Return to list view
            await self.parent_view.refresh_data()
            embed = self.parent_view.get_embed()
            await interaction.edit_original_response(
                content=f"\u2705 Feed #{self.feed.id} deleted",
                embed=embed,
                view=self.parent_view,
            )
        else:
            # Cancel - return to detail view
            embed = self.get_detail_embed()
            await interaction.edit_original_response(
                content="Deletion cancelled",
                embed=embed,
                view=self,
            )

    @ui.button(label="Back", style=discord.ButtonStyle.secondary, emoji="\u2b05\ufe0f", row=1)
    async def back_button(
        self, interaction: discord.Interaction, button: ui.Button
    ) -> None:
        """Return to the feeds list."""
        await self.parent_view.refresh_data()
        embed = self.parent_view.get_embed()
        await interaction.response.edit_message(content=None, embed=embed, view=self.parent_view)
