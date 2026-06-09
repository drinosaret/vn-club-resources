"""Custom event creation/editing modal."""

from datetime import datetime, timezone
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
        return parsed.scheme in ("http", "https") and bool(parsed.netloc)
    except Exception:
        return False


def _parse_dt(value: str, *, end: bool) -> tuple[datetime, bool]:
    """Parse 'YYYY-MM-DD' or 'YYYY-MM-DD HH:MM' (UTC) -> (datetime, all_day).

    Raises ValueError on an unparseable string. An all-day end is pinned to
    end-of-day so the range covers the whole final date.
    """
    value = value.strip()
    for fmt in ("%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M"):
        try:
            return datetime.strptime(value, fmt).replace(tzinfo=timezone.utc), False
        except ValueError:
            pass
    dt = datetime.strptime(value, "%Y-%m-%d")  # raises if invalid
    if end:
        dt = dt.replace(hour=23, minute=59)
    return dt.replace(tzinfo=timezone.utc), True


def _fmt_for_input(dt: datetime | None, all_day: bool) -> str | None:
    if dt is None:
        return None
    return dt.strftime("%Y-%m-%d") if all_day else dt.strftime("%Y-%m-%d %H:%M")


class EventModal(ui.Modal):
    """Modal for creating or editing a custom calendar event."""

    def __init__(self, event: Any | None = None):
        super().__init__(title="Edit Event" if event else "Create Event")
        self.event = event
        self.result: dict | None = None

        self.title_input = ui.TextInput(
            label="Title",
            placeholder="Event name",
            max_length=200,
            required=True,
            default=event.title if event else None,
        )
        self.add_item(self.title_input)

        self.description_input = ui.TextInput(
            label="Description",
            placeholder="What's happening (optional)",
            style=discord.TextStyle.paragraph,
            max_length=2000,
            required=False,
            default=event.description if event else None,
        )
        self.add_item(self.description_input)

        self.start_input = ui.TextInput(
            label="Start (UTC)",
            placeholder="YYYY-MM-DD or YYYY-MM-DD HH:MM",
            required=True,
            default=_fmt_for_input(event.start_at, event.all_day) if event else None,
        )
        self.add_item(self.start_input)

        self.end_input = ui.TextInput(
            label="End (UTC, optional)",
            placeholder="YYYY-MM-DD or YYYY-MM-DD HH:MM",
            required=False,
            default=_fmt_for_input(event.end_at, event.all_day) if event and event.end_at else None,
        )
        self.add_item(self.end_input)

        self.image_input = ui.TextInput(
            label="Image URL (optional)",
            placeholder="https://example.com/image.png",
            required=False,
            max_length=500,  # matches Event.image_url VARCHAR(500); rejects over-long URLs at submit
            default=event.image_url if event else None,
        )
        self.add_item(self.image_input)

    async def on_submit(self, interaction: discord.Interaction) -> None:
        image_url = self.image_input.value or None
        if image_url and not _is_valid_http_url(image_url):
            await interaction.response.send_message(
                "Invalid image URL: must start with http:// or https://", ephemeral=True
            )
            return

        try:
            start_at, all_day = _parse_dt(self.start_input.value, end=False)
        except ValueError:
            await interaction.response.send_message(
                "Invalid start: use YYYY-MM-DD or YYYY-MM-DD HH:MM (UTC).", ephemeral=True
            )
            return

        end_at = None
        if self.end_input.value and self.end_input.value.strip():
            try:
                # A date-only end always means end-of-day, independent of whether
                # the start was timed; otherwise the event ends a full day early.
                end_at, end_all_day = _parse_dt(self.end_input.value, end=True)
            except ValueError:
                await interaction.response.send_message(
                    "Invalid end: use YYYY-MM-DD or YYYY-MM-DD HH:MM (UTC).", ephemeral=True
                )
                return
            if end_at < start_at:
                await interaction.response.send_message(
                    "End must be on or after start.", ephemeral=True
                )
                return
            # A timed start with a date-only end (or vice versa) -> treat as timed.
            all_day = all_day and end_all_day

        self.result = {
            "title": self.title_input.value,
            "description": self.description_input.value or None,
            "start_at": start_at,
            "end_at": end_at,
            "all_day": all_day,
            "image_url": image_url,
        }
        await interaction.response.defer()
