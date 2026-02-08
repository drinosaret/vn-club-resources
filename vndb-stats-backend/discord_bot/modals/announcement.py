"""Announcement creation/editing modal."""

from typing import Any

import discord
from discord import ui


class AnnouncementModal(ui.Modal):
    """Modal for creating or editing announcements."""

    def __init__(self, announcement: Any | None = None):
        """Initialize the modal.

        Args:
            announcement: Existing announcement to edit, or None to create new.
        """
        super().__init__(
            title="Edit Announcement" if announcement else "Create Announcement"
        )
        self.announcement = announcement
        self.result: dict | None = None

        # Title input
        self.title_input = ui.TextInput(
            label="Title",
            placeholder="Announcement headline",
            max_length=500,
            required=True,
            default=announcement.title if announcement else None,
        )
        self.add_item(self.title_input)

        # Content input (multiline)
        self.content_input = ui.TextInput(
            label="Content",
            placeholder="Full announcement text (optional)",
            style=discord.TextStyle.paragraph,
            max_length=2000,
            required=False,
            default=announcement.content if announcement else None,
        )
        self.add_item(self.content_input)

        # URL input
        self.url_input = ui.TextInput(
            label="URL (optional)",
            placeholder="https://example.com",
            required=False,
            default=announcement.url if announcement else None,
        )
        self.add_item(self.url_input)

        # Image URL input
        self.image_input = ui.TextInput(
            label="Image URL (optional)",
            placeholder="https://example.com/image.png",
            required=False,
            default=announcement.image_url if announcement else None,
        )
        self.add_item(self.image_input)

    async def on_submit(self, interaction: discord.Interaction) -> None:
        """Store the result and defer response."""
        self.result = {
            "title": self.title_input.value,
            "content": self.content_input.value or None,
            "url": self.url_input.value or None,
            "image_url": self.image_input.value or None,
        }
        await interaction.response.defer()
