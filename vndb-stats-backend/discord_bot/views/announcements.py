"""Announcements management view."""

from datetime import datetime, timezone
from typing import Any

import discord
from discord import ui
from sqlalchemy import select

from app.db.database import async_session_maker
from app.db.models import Announcement
from discord_bot.views.base import BaseView, ConfirmView
from discord_bot.modals.announcement import AnnouncementModal
from discord_bot.utils.embeds import create_embed, create_success_embed, create_error_embed, Colors


class AnnouncementView(BaseView):
    """View for managing announcements with inline actions."""

    def __init__(
        self,
        user_id: int,
        announcements: list[Announcement],
        include_inactive: bool = False,
        timeout: float = 300,
    ):
        super().__init__(user_id, timeout)
        self.announcements = announcements
        self.include_inactive = include_inactive
        self._build_action_select()

    def _build_action_select(self) -> None:
        """Build the announcement action dropdown."""
        if not self.announcements:
            return

        options = []
        for ann in self.announcements[:25]:  # Discord limit
            status = "\u2705" if ann.is_active else "\u274c"
            title = ann.title[:80] if len(ann.title) > 80 else ann.title
            options.append(
                discord.SelectOption(
                    label=f"{status} {title}"[:100],
                    value=str(ann.id),
                    description=f"ID: {ann.id} | Created by: {ann.created_by or 'Unknown'}"[:100],
                )
            )

        if options:
            select = AnnouncementSelect(options, self)
            self.add_item(select)

    def get_embed(self) -> discord.Embed:
        """Generate the announcements list embed."""
        if not self.announcements:
            return create_embed(
                "Announcements",
                description="No announcements found.\n\nClick **Create New** to add one.",
                color=Colors.PRIMARY,
            )

        lines = []
        for ann in self.announcements:
            status = "\u2705" if ann.is_active else "\u274c"
            date_str = ann.published_at.strftime("%b %d") if ann.published_at else ""
            lines.append(f"{status} **#{ann.id}** {ann.title}")
            if date_str:
                lines[-1] += f" ({date_str})"

        filter_text = " (including inactive)" if self.include_inactive else ""
        return create_embed(
            f"Announcements{filter_text}",
            description="\n".join(lines),
            footer_text="Select an announcement to edit, toggle, or delete",
            color=Colors.PRIMARY,
        )

    async def refresh_data(self) -> None:
        """Refresh announcement data from database."""
        async with async_session_maker() as db:
            query = select(Announcement)
            if not self.include_inactive:
                query = query.where(Announcement.is_active == True)
            query = query.order_by(Announcement.published_at.desc()).limit(25)

            result = await db.execute(query)
            self.announcements = list(result.scalars().all())

        # Rebuild select menu
        for item in list(self.children):
            if isinstance(item, AnnouncementSelect):
                self.remove_item(item)
        self._build_action_select()

    @ui.button(label="Create New", style=discord.ButtonStyle.success, emoji="\u2795", row=2)
    async def create_button(
        self, interaction: discord.Interaction, button: ui.Button
    ) -> None:
        """Open modal to create new announcement."""
        modal = AnnouncementModal()
        await interaction.response.send_modal(modal)
        await modal.wait()

        if modal.result:
            async with async_session_maker() as db:
                announcement = Announcement(
                    title=modal.result["title"],
                    content=modal.result["content"],
                    url=modal.result["url"],
                    image_url=modal.result["image_url"],
                    published_at=datetime.now(timezone.utc),
                    is_active=True,
                    created_by=interaction.user.display_name,
                )
                db.add(announcement)
                await db.commit()
                await db.refresh(announcement)

            await self.refresh_data()
            embed = self.get_embed()
            await interaction.edit_original_response(
                content=f"\u2705 Created announcement **#{announcement.id}**",
                embed=embed,
                view=self,
            )

    @ui.button(label="Show All", style=discord.ButtonStyle.secondary, row=2)
    async def toggle_inactive_button(
        self, interaction: discord.Interaction, button: ui.Button
    ) -> None:
        """Toggle showing inactive announcements."""
        self.include_inactive = not self.include_inactive
        button.label = "Hide Inactive" if self.include_inactive else "Show All"

        await self.refresh_data()
        embed = self.get_embed()
        await interaction.response.edit_message(embed=embed, view=self)


class AnnouncementSelect(ui.Select):
    """Dropdown for selecting an announcement to act on."""

    def __init__(self, options: list[discord.SelectOption], parent_view: AnnouncementView):
        super().__init__(
            placeholder="Select announcement to manage...",
            options=options,
            row=1,
        )
        self.parent_view = parent_view

    async def callback(self, interaction: discord.Interaction) -> None:
        """Show action buttons for selected announcement."""
        ann_id = int(self.values[0])

        async with async_session_maker() as db:
            result = await db.execute(
                select(Announcement).where(Announcement.id == ann_id)
            )
            announcement = result.scalar_one_or_none()

        if not announcement:
            await interaction.response.send_message(
                f"Announcement #{ann_id} not found.", ephemeral=True
            )
            return

        # Show action view for this announcement
        action_view = AnnouncementActionView(
            user_id=interaction.user.id,
            announcement=announcement,
            parent_view=self.parent_view,
        )
        embed = action_view.get_detail_embed()
        await interaction.response.edit_message(embed=embed, view=action_view)


class AnnouncementActionView(BaseView):
    """View showing actions for a specific announcement."""

    def __init__(
        self,
        user_id: int,
        announcement: Announcement,
        parent_view: AnnouncementView,
        timeout: float = 120,
    ):
        super().__init__(user_id, timeout)
        self.announcement = announcement
        self.parent_view = parent_view
        self._update_toggle_button()

    def _update_toggle_button(self) -> None:
        """Update toggle button label based on current state."""
        self.toggle_button.label = "Deactivate" if self.announcement.is_active else "Activate"
        self.toggle_button.style = (
            discord.ButtonStyle.secondary
            if self.announcement.is_active
            else discord.ButtonStyle.success
        )

    def get_detail_embed(self) -> discord.Embed:
        """Generate detail embed for the announcement."""
        status = "\u2705 Active" if self.announcement.is_active else "\u274c Inactive"
        embed = create_embed(
            f"Announcement #{self.announcement.id}",
            description=f"**{self.announcement.title}**\n\n{self.announcement.content or '(no content)'}",
            color=Colors.SUCCESS if self.announcement.is_active else Colors.WARNING,
        )
        embed.add_field(name="Status", value=status, inline=True)
        if self.announcement.url:
            embed.add_field(name="URL", value=self.announcement.url, inline=True)
        if self.announcement.published_at:
            embed.add_field(
                name="Published",
                value=self.announcement.published_at.strftime("%Y-%m-%d %H:%M"),
                inline=True,
            )
        if self.announcement.created_by:
            embed.add_field(name="Created by", value=self.announcement.created_by, inline=True)
        return embed

    @ui.button(label="Edit", style=discord.ButtonStyle.primary, emoji="\u270f\ufe0f", row=0)
    async def edit_button(
        self, interaction: discord.Interaction, button: ui.Button
    ) -> None:
        """Open modal to edit announcement."""
        modal = AnnouncementModal(announcement=self.announcement)
        await interaction.response.send_modal(modal)
        await modal.wait()

        if modal.result:
            async with async_session_maker() as db:
                result = await db.execute(
                    select(Announcement).where(Announcement.id == self.announcement.id)
                )
                ann = result.scalar_one_or_none()
                if ann:
                    ann.title = modal.result["title"]
                    ann.content = modal.result["content"]
                    ann.url = modal.result["url"]
                    ann.image_url = modal.result["image_url"]
                    await db.commit()
                    await db.refresh(ann)
                    self.announcement = ann

            embed = self.get_detail_embed()
            await interaction.edit_original_response(
                content="\u2705 Announcement updated",
                embed=embed,
                view=self,
            )

    @ui.button(label="Toggle", style=discord.ButtonStyle.secondary, row=0)
    async def toggle_button(
        self, interaction: discord.Interaction, button: ui.Button
    ) -> None:
        """Toggle announcement active status."""
        async with async_session_maker() as db:
            result = await db.execute(
                select(Announcement).where(Announcement.id == self.announcement.id)
            )
            ann = result.scalar_one_or_none()
            if ann:
                ann.is_active = not ann.is_active
                await db.commit()
                await db.refresh(ann)
                self.announcement = ann

        self._update_toggle_button()
        status = "activated" if self.announcement.is_active else "deactivated"
        embed = self.get_detail_embed()
        await interaction.response.edit_message(
            content=f"\u2705 Announcement {status}",
            embed=embed,
            view=self,
        )

    @ui.button(label="Delete", style=discord.ButtonStyle.danger, emoji="\U0001f5d1\ufe0f", row=0)
    async def delete_button(
        self, interaction: discord.Interaction, button: ui.Button
    ) -> None:
        """Delete announcement with confirmation."""
        confirm_view = ConfirmView(
            user_id=interaction.user.id,
            confirm_label="Delete",
            timeout=30,
        )
        await interaction.response.edit_message(
            content=f"**Are you sure you want to delete announcement #{self.announcement.id}?**\n"
                    f"Title: {self.announcement.title}",
            embed=None,
            view=confirm_view,
        )
        await confirm_view.wait()

        if confirm_view.value:
            async with async_session_maker() as db:
                result = await db.execute(
                    select(Announcement).where(Announcement.id == self.announcement.id)
                )
                ann = result.scalar_one_or_none()
                if ann:
                    await db.delete(ann)
                    await db.commit()

            # Return to list view
            await self.parent_view.refresh_data()
            embed = self.parent_view.get_embed()
            await interaction.edit_original_response(
                content=f"\u2705 Announcement #{self.announcement.id} deleted",
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
        """Return to the announcements list."""
        await self.parent_view.refresh_data()
        embed = self.parent_view.get_embed()
        await interaction.response.edit_message(content=None, embed=embed, view=self.parent_view)
