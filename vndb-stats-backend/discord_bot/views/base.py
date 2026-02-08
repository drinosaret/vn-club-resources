"""Base view classes for reusable Discord UI components."""

from abc import ABC, abstractmethod
from typing import Any, Callable, Coroutine

import discord
from discord import ui


class BaseView(ui.View):
    """Base view with owner validation and timeout handling."""

    def __init__(self, user_id: int, timeout: float = 300):
        super().__init__(timeout=timeout)
        self.user_id = user_id
        self.message: discord.Message | None = None

    async def interaction_check(self, interaction: discord.Interaction) -> bool:
        """Only allow the original user to interact."""
        if interaction.user.id != self.user_id:
            await interaction.response.send_message(
                "This menu is not for you.", ephemeral=True
            )
            return False
        return True

    async def on_timeout(self) -> None:
        """Disable all buttons when the view times out."""
        for item in self.children:
            if isinstance(item, (ui.Button, ui.Select)):
                item.disabled = True
        if self.message:
            try:
                await self.message.edit(view=self)
            except discord.NotFound:
                pass


class PaginatedView(BaseView, ABC):
    """Base class for paginated list views."""

    def __init__(
        self,
        user_id: int,
        items: list[Any],
        per_page: int = 10,
        timeout: float = 300,
    ):
        super().__init__(user_id, timeout)
        self.items = items
        self.per_page = per_page
        self.current_page = 0
        self._update_buttons()

    @property
    def total_pages(self) -> int:
        """Calculate total number of pages."""
        return max(1, (len(self.items) + self.per_page - 1) // self.per_page)

    @property
    def current_items(self) -> list[Any]:
        """Get items for the current page."""
        start = self.current_page * self.per_page
        end = start + self.per_page
        return self.items[start:end]

    def _update_buttons(self) -> None:
        """Update button states based on current page."""
        self.prev_button.disabled = self.current_page <= 0
        self.next_button.disabled = self.current_page >= self.total_pages - 1

    @abstractmethod
    async def format_page(self) -> discord.Embed:
        """Format the current page as an embed. Must be implemented by subclasses."""
        pass

    async def update_message(self, interaction: discord.Interaction) -> None:
        """Update the message with the current page."""
        self._update_buttons()
        embed = await self.format_page()
        await interaction.response.edit_message(embed=embed, view=self)

    @ui.button(label="<", style=discord.ButtonStyle.secondary, row=4)
    async def prev_button(
        self, interaction: discord.Interaction, button: ui.Button
    ) -> None:
        """Go to the previous page."""
        if self.current_page > 0:
            self.current_page -= 1
            await self.update_message(interaction)
        else:
            await interaction.response.defer()

    @ui.button(label=">", style=discord.ButtonStyle.secondary, row=4)
    async def next_button(
        self, interaction: discord.Interaction, button: ui.Button
    ) -> None:
        """Go to the next page."""
        if self.current_page < self.total_pages - 1:
            self.current_page += 1
            await self.update_message(interaction)
        else:
            await interaction.response.defer()


class ConfirmView(BaseView):
    """Generic confirmation dialog with confirm/cancel buttons."""

    def __init__(
        self,
        user_id: int,
        confirm_label: str = "Confirm",
        cancel_label: str = "Cancel",
        confirm_style: discord.ButtonStyle = discord.ButtonStyle.danger,
        timeout: float = 60,
    ):
        super().__init__(user_id, timeout)
        self.value: bool | None = None

        # Update button labels and styles
        self.confirm_button.label = confirm_label
        self.confirm_button.style = confirm_style
        self.cancel_button.label = cancel_label

    @ui.button(label="Confirm", style=discord.ButtonStyle.danger)
    async def confirm_button(
        self, interaction: discord.Interaction, button: ui.Button
    ) -> None:
        """Confirm the action."""
        self.value = True
        self.stop()
        await interaction.response.defer()

    @ui.button(label="Cancel", style=discord.ButtonStyle.secondary)
    async def cancel_button(
        self, interaction: discord.Interaction, button: ui.Button
    ) -> None:
        """Cancel the action."""
        self.value = False
        self.stop()
        await interaction.response.defer()


class TabbedView(BaseView):
    """View with tab-like buttons for switching between content sections."""

    def __init__(
        self,
        user_id: int,
        tabs: list[str],
        timeout: float = 300,
    ):
        super().__init__(user_id, timeout)
        self.tabs = tabs
        self.active_tab = 0
        self._tab_buttons: list[ui.Button] = []
        self._create_tab_buttons()

    def _create_tab_buttons(self) -> None:
        """Create buttons for each tab."""
        for i, tab_name in enumerate(self.tabs):
            button = ui.Button(
                label=tab_name,
                style=discord.ButtonStyle.primary if i == 0 else discord.ButtonStyle.secondary,
                custom_id=f"tab_{i}",
                row=0,
            )
            button.callback = self._make_tab_callback(i)
            self._tab_buttons.append(button)
            self.add_item(button)

    def _make_tab_callback(
        self, index: int
    ) -> Callable[[discord.Interaction], Coroutine[Any, Any, None]]:
        """Create a callback for a tab button."""
        async def callback(interaction: discord.Interaction) -> None:
            if self.active_tab == index:
                await interaction.response.defer()
                return

            self.active_tab = index
            self._update_tab_styles()
            embed = await self.get_tab_content(index)
            await interaction.response.edit_message(embed=embed, view=self)

        return callback

    def _update_tab_styles(self) -> None:
        """Update button styles to reflect active tab."""
        for i, button in enumerate(self._tab_buttons):
            button.style = (
                discord.ButtonStyle.primary
                if i == self.active_tab
                else discord.ButtonStyle.secondary
            )

    async def get_tab_content(self, tab_index: int) -> discord.Embed:
        """Get the embed content for a tab. Override in subclasses."""
        return discord.Embed(
            title=self.tabs[tab_index],
            description="No content defined for this tab.",
        )


class ActionRowView(BaseView):
    """View with customizable action buttons."""

    def __init__(self, user_id: int, timeout: float = 300):
        super().__init__(user_id, timeout)

    def add_button(
        self,
        label: str,
        callback: Callable[[discord.Interaction], Coroutine[Any, Any, None]],
        style: discord.ButtonStyle = discord.ButtonStyle.secondary,
        emoji: str | None = None,
        disabled: bool = False,
        row: int = 0,
    ) -> ui.Button:
        """Add a button with a custom callback."""
        button = ui.Button(
            label=label,
            style=style,
            emoji=emoji,
            disabled=disabled,
            row=row,
        )
        button.callback = callback
        self.add_item(button)
        return button
