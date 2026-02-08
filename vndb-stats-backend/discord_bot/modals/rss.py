"""RSS feed creation/editing modal."""

from typing import Any

import discord
from discord import ui


class RSSFeedModal(ui.Modal):
    """Modal for creating or editing RSS feeds."""

    def __init__(self, feed: Any | None = None):
        """Initialize the modal.

        Args:
            feed: Existing feed config to edit, or None to create new.
        """
        super().__init__(title="Edit RSS Feed" if feed else "Add RSS Feed")
        self.feed = feed
        self.result: dict | None = None

        # Name input
        self.name_input = ui.TextInput(
            label="Name",
            placeholder="Display name for this feed",
            max_length=100,
            required=True,
            default=feed.name if feed else None,
        )
        self.add_item(self.name_input)

        # URL input
        self.url_input = ui.TextInput(
            label="Feed URL",
            placeholder="https://example.com/feed.xml",
            required=True,
            default=feed.url if feed else None,
        )
        self.add_item(self.url_input)

        # Keywords input
        self.keywords_input = ui.TextInput(
            label="Include Keywords (optional)",
            placeholder="visual novel, vn, eroge (comma-separated)",
            style=discord.TextStyle.paragraph,
            required=False,
            default=feed.keywords if feed else None,
        )
        self.add_item(self.keywords_input)

        # Exclude keywords input
        self.exclude_input = ui.TextInput(
            label="Exclude Keywords (optional)",
            placeholder="mobile, gacha (comma-separated)",
            style=discord.TextStyle.paragraph,
            required=False,
            default=feed.exclude_keywords if feed else None,
        )
        self.add_item(self.exclude_input)

    async def on_submit(self, interaction: discord.Interaction) -> None:
        """Store the result and defer response."""
        self.result = {
            "name": self.name_input.value,
            "url": self.url_input.value,
            "keywords": self.keywords_input.value or None,
            "exclude_keywords": self.exclude_input.value or None,
        }
        await interaction.response.defer()
