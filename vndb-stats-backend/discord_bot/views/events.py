"""Custom events management view (mirrors the announcements view).

Scoped to event_type == "custom" so admins never clobber bot-synced rows
(VN of the month/season, movie night).
"""

import discord
from discord import ui
from sqlalchemy import select

from app.db.database import async_session_maker
from app.db.models import Event
from app.services import events_service
from discord_bot.views.base import BaseView, ConfirmView
from discord_bot.modals.event import EventModal
from discord_bot.utils.embeds import create_embed, Colors


def _when(ev: Event) -> str:
    if ev.all_day:
        if ev.end_at and ev.end_at.date() != ev.start_at.date():
            return f"{ev.start_at:%Y-%m-%d} – {ev.end_at:%Y-%m-%d}"
        return f"{ev.start_at:%Y-%m-%d}"
    return f"{ev.start_at:%Y-%m-%d %H:%M} UTC"


async def _load_events(include_inactive: bool) -> list[Event]:
    async with async_session_maker() as db:
        query = select(Event).where(Event.event_type == "custom")
        if not include_inactive:
            query = query.where(Event.is_active == True)  # noqa: E712
        query = query.order_by(Event.start_at.desc()).limit(25)
        result = await db.execute(query)
        return list(result.scalars().all())


class EventManageView(BaseView):
    """List custom events with inline create/edit/toggle/delete."""

    def __init__(
        self,
        user_id: int,
        events: list[Event],
        include_inactive: bool = False,
        timeout: float = 300,
    ):
        super().__init__(user_id, timeout)
        self.events = events
        self.include_inactive = include_inactive
        self._build_action_select()

    def _build_action_select(self) -> None:
        if not self.events:
            return
        options = []
        for ev in self.events[:25]:  # Discord limit
            status = "✅" if ev.is_active else "❌"
            title = ev.title[:80]
            options.append(
                discord.SelectOption(
                    label=f"{status} {title}"[:100],
                    value=str(ev.id),
                    description=_when(ev)[:100],
                )
            )
        if options:
            self.add_item(EventSelect(options, self))

    def get_embed(self) -> discord.Embed:
        if not self.events:
            return create_embed(
                "Custom Events",
                description="No custom events found.\n\nClick **Create New** to add one.",
                color=Colors.PRIMARY,
            )
        lines = []
        for ev in self.events:
            status = "✅" if ev.is_active else "❌"
            lines.append(f"{status} **#{ev.id}** {ev.title} ({_when(ev)})")
        filter_text = " (including inactive)" if self.include_inactive else ""
        return create_embed(
            f"Custom Events{filter_text}",
            description="\n".join(lines),
            footer_text="Select an event to edit, toggle, or delete",
            color=Colors.PRIMARY,
        )

    async def refresh_data(self) -> None:
        self.events = await _load_events(self.include_inactive)
        for item in list(self.children):
            if isinstance(item, EventSelect):
                self.remove_item(item)
        self._build_action_select()

    @ui.button(label="Create New", style=discord.ButtonStyle.success, emoji="➕", row=2)
    async def create_button(self, interaction: discord.Interaction, button: ui.Button) -> None:
        modal = EventModal()
        await interaction.response.send_modal(modal)
        await modal.wait()
        if not modal.result:
            return

        async with async_session_maker() as db:
            ev = await events_service.create_event(
                db,
                event_type="custom",
                title=modal.result["title"],
                start_at=modal.result["start_at"],
                description=modal.result["description"],
                end_at=modal.result["end_at"],
                all_day=modal.result["all_day"],
                image_url=modal.result["image_url"],
                created_by=interaction.user.display_name,
            )
        await events_service.invalidate_events_cache()

        await self.refresh_data()
        await interaction.edit_original_response(
            content=f"✅ Created event **#{ev.id}**", embed=self.get_embed(), view=self
        )

    @ui.button(label="Show All", style=discord.ButtonStyle.secondary, row=2)
    async def toggle_inactive_button(self, interaction: discord.Interaction, button: ui.Button) -> None:
        self.include_inactive = not self.include_inactive
        button.label = "Hide Inactive" if self.include_inactive else "Show All"
        await self.refresh_data()
        await interaction.response.edit_message(embed=self.get_embed(), view=self)


class EventSelect(ui.Select):
    """Dropdown for picking a custom event to act on."""

    def __init__(self, options: list[discord.SelectOption], parent_view: EventManageView):
        super().__init__(placeholder="Select event to manage...", options=options, row=1)
        self.parent_view = parent_view

    async def callback(self, interaction: discord.Interaction) -> None:
        event_id = int(self.values[0])
        async with async_session_maker() as db:
            result = await db.execute(select(Event).where(Event.id == event_id))
            ev = result.scalar_one_or_none()
        if not ev:
            await interaction.response.send_message(f"Event #{event_id} not found.", ephemeral=True)
            return

        action_view = EventActionView(
            user_id=interaction.user.id, event=ev, parent_view=self.parent_view
        )
        await interaction.response.edit_message(embed=action_view.get_detail_embed(), view=action_view)


class EventActionView(BaseView):
    """Actions for a single custom event."""

    def __init__(self, user_id: int, event: Event, parent_view: EventManageView, timeout: float = 120):
        super().__init__(user_id, timeout)
        self.event = event
        self.parent_view = parent_view
        self._update_toggle_button()

    def _update_toggle_button(self) -> None:
        self.toggle_button.label = "Deactivate" if self.event.is_active else "Activate"
        self.toggle_button.style = (
            discord.ButtonStyle.secondary if self.event.is_active else discord.ButtonStyle.success
        )

    def get_detail_embed(self) -> discord.Embed:
        status = "✅ Active" if self.event.is_active else "❌ Inactive"
        embed = create_embed(
            f"Event #{self.event.id}",
            description=f"**{self.event.title}**\n\n{self.event.description or '(no description)'}",
            color=Colors.SUCCESS if self.event.is_active else Colors.WARNING,
        )
        embed.add_field(name="When", value=_when(self.event), inline=True)
        embed.add_field(name="Status", value=status, inline=True)
        if self.event.created_by:
            embed.add_field(name="Created by", value=self.event.created_by, inline=True)
        if self.event.image_url:
            embed.set_thumbnail(url=self.event.image_url)
        return embed

    @ui.button(label="Edit", style=discord.ButtonStyle.primary, emoji="✏️", row=0)
    async def edit_button(self, interaction: discord.Interaction, button: ui.Button) -> None:
        modal = EventModal(event=self.event)
        await interaction.response.send_modal(modal)
        await modal.wait()
        if not modal.result:
            return

        async with async_session_maker() as db:
            ev = await events_service.update_event(
                db,
                self.event.id,
                {
                    "title": modal.result["title"],
                    "description": modal.result["description"],
                    "start_at": modal.result["start_at"],
                    "end_at": modal.result["end_at"],
                    "all_day": modal.result["all_day"],
                    "image_url": modal.result["image_url"],
                },
            )
        await events_service.invalidate_events_cache()
        if ev:
            self.event = ev
        await interaction.edit_original_response(
            content="✅ Event updated", embed=self.get_detail_embed(), view=self
        )

    @ui.button(label="Toggle", style=discord.ButtonStyle.secondary, row=0)
    async def toggle_button(self, interaction: discord.Interaction, button: ui.Button) -> None:
        async with async_session_maker() as db:
            ev = await events_service.update_event(
                db, self.event.id, {"is_active": not self.event.is_active}
            )
        await events_service.invalidate_events_cache()
        if ev:
            self.event = ev
        self._update_toggle_button()
        status = "activated" if self.event.is_active else "deactivated"
        await interaction.response.edit_message(
            content=f"✅ Event {status}", embed=self.get_detail_embed(), view=self
        )

    @ui.button(label="Delete", style=discord.ButtonStyle.danger, emoji="\U0001f5d1️", row=0)
    async def delete_button(self, interaction: discord.Interaction, button: ui.Button) -> None:
        confirm_view = ConfirmView(user_id=interaction.user.id, confirm_label="Delete", timeout=30)
        await interaction.response.edit_message(
            content=f"**Delete event #{self.event.id}?**\nTitle: {self.event.title}",
            embed=None,
            view=confirm_view,
        )
        await confirm_view.wait()

        if confirm_view.value:
            async with async_session_maker() as db:
                await events_service.delete_event(db, self.event.id)
            await events_service.invalidate_events_cache()
            await self.parent_view.refresh_data()
            await interaction.edit_original_response(
                content=f"✅ Event #{self.event.id} deleted",
                embed=self.parent_view.get_embed(),
                view=self.parent_view,
            )
        else:
            await interaction.edit_original_response(
                content="Deletion cancelled", embed=self.get_detail_embed(), view=self
            )

    @ui.button(label="Back", style=discord.ButtonStyle.secondary, emoji="⬅️", row=1)
    async def back_button(self, interaction: discord.Interaction, button: ui.Button) -> None:
        await self.parent_view.refresh_data()
        await interaction.response.edit_message(
            content=None, embed=self.parent_view.get_embed(), view=self.parent_view
        )
