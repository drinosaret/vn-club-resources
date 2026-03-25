"""Announcement creation/editing modal."""

from typing import Any
from urllib.parse import urlparse

import discord
from discord import ui


def _is_valid_http_url(url: str | None) -> bool:
    """Validate that a URL uses http or https protocol."""
    if not url:
        return True  # Optional fields are fine when empty
    try:
        parsed = urlparse(url)
        return parsed.scheme in ('http', 'https') and bool(parsed.netloc)
    except Exception:
        return False


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
        url = self.url_input.value or None
        image_url = self.image_input.value or None

        # Validate URLs use http/https protocol
        if url and not _is_valid_http_url(url):
            await interaction.response.send_message(
                "Invalid URL: must start with http:// or https://", ephemeral=True
            )
            return
        if image_url and not _is_valid_http_url(image_url):
            await interaction.response.send_message(
                "Invalid image URL: must start with http:// or https://", ephemeral=True
            )
            return

        self.result = {
            "title": self.title_input.value,
            "content": self.content_input.value or None,
            "url": url,
            "image_url": image_url,
        }
        await interaction.response.defer()
