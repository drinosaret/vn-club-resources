"""Blacklist rule creation/editing modal."""

from typing import Any

import discord
from discord import ui


class BlacklistRuleModal(ui.Modal):
    """Modal for editing blacklist rule parameters.

    Note: Tag selection is handled before opening this modal.
    This modal collects threshold, score, and age condition.
    """

    def __init__(self, rule: Any | None = None, tag_name: str | None = None):
        """Initialize the modal.

        Args:
            rule: Existing rule to edit, or None to create new.
            tag_name: Name of the tag (for display in title).
        """
        title = "Edit Blacklist Rule"
        if tag_name:
            title = f"Rule: {tag_name[:30]}"
        elif rule is None:
            title = "Configure Rule"

        super().__init__(title=title)
        self.rule = rule
        self.result: dict | None = None

        # Vote threshold input
        self.threshold_input = ui.TextInput(
            label="Vote Threshold",
            placeholder="100",
            max_length=10,
            required=True,
            default=str(rule.votecount_threshold) if rule else "100",
        )
        self.add_item(self.threshold_input)

        # Minimum tag score input
        self.score_input = ui.TextInput(
            label="Minimum Tag Score",
            placeholder="1.5",
            max_length=10,
            required=True,
            default=str(rule.min_tag_score) if rule else "1.5",
        )
        self.add_item(self.score_input)

        # Age condition input
        self.age_input = ui.TextInput(
            label="Age Condition",
            placeholder="none / any_18plus / only_18plus",
            max_length=20,
            required=False,
            default=rule.age_condition or "none" if rule else "none",
        )
        self.add_item(self.age_input)

    async def on_submit(self, interaction: discord.Interaction) -> None:
        """Validate and store the result."""
        try:
            threshold = int(self.threshold_input.value)
            if threshold < 0:
                raise ValueError("Threshold must be non-negative")
        except ValueError:
            await interaction.response.send_message(
                "Invalid vote threshold. Please enter a positive integer.",
                ephemeral=True,
            )
            return

        try:
            score = float(self.score_input.value)
            if score < 0 or score > 3:
                raise ValueError("Score must be between 0 and 3")
        except ValueError:
            await interaction.response.send_message(
                "Invalid tag score. Please enter a number between 0 and 3.",
                ephemeral=True,
            )
            return

        age = self.age_input.value.strip().lower() if self.age_input.value else None
        if age and age not in ("none", "any_18plus", "only_18plus"):
            await interaction.response.send_message(
                "Invalid age condition. Use: none, any_18plus, or only_18plus",
                ephemeral=True,
            )
            return
        if age == "none":
            age = None

        self.result = {
            "votecount_threshold": threshold,
            "min_tag_score": score,
            "age_condition": age,
        }
        await interaction.response.defer()


class BlacklistAddModal(ui.Modal):
    """Modal for adding a VN to the blacklist with optional notes.

    Note: VN selection is handled via autocomplete before opening this modal.
    """

    def __init__(self, vn_title: str | None = None):
        """Initialize the modal.

        Args:
            vn_title: Title of the VN being blacklisted (for display).
        """
        title = f"Blacklist: {vn_title[:40]}" if vn_title else "Blacklist VN"
        super().__init__(title=title)
        self.result: dict | None = None

        # Notes input
        self.notes_input = ui.TextInput(
            label="Notes (optional)",
            placeholder="Reason for blacklisting this cover",
            style=discord.TextStyle.paragraph,
            max_length=500,
            required=False,
        )
        self.add_item(self.notes_input)

    async def on_submit(self, interaction: discord.Interaction) -> None:
        """Store the result and defer response."""
        self.result = {
            "notes": self.notes_input.value or None,
        }
        await interaction.response.defer()
