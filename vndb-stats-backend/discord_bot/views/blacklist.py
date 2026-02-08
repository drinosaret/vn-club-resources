"""Blacklist management view with entries and rules."""

from datetime import datetime, timezone
from typing import Any

import aiohttp
import discord
from discord import ui
from sqlalchemy import select, func, and_, or_
from sqlalchemy.orm import aliased

from app.db.database import async_session_maker
from app.db.models import CoverBlacklist, CoverBlacklistConfig, Tag, VisualNovel
from discord_bot.views.base import BaseView, PaginatedView, ConfirmView
from discord_bot.modals.blacklist import BlacklistRuleModal, BlacklistAddModal
from discord_bot.utils.embeds import create_embed, create_success_embed, Colors
from discord_bot.utils.cache import blacklist_rules_cache
from discord_bot.config import get_bot_settings


# ==================== Helpers ====================

AGE_LABELS = {"any_18plus": "any 18+", "only_18plus": "only 18+"}


def format_rule_label(config: CoverBlacklistConfig, tags: list[Tag | None]) -> str:
    """Format a rule's conditions for display.

    Args:
        config: CoverBlacklistConfig instance
        tags: list of Tag objects (may contain None for unset tag slots)
    """
    parts = []
    tag_names = [t.name for t in tags if t is not None]
    if tag_names:
        parts.append(" + ".join(tag_names))
    if config.age_condition:
        parts.append(AGE_LABELS.get(config.age_condition, config.age_condition))
    return " | ".join(parts) or "no condition"


async def _query_rules(db):
    """Query all rules with their tags using aliased outer joins."""
    Tag1 = aliased(Tag, name="tag1")
    Tag2 = aliased(Tag, name="tag2")
    Tag3 = aliased(Tag, name="tag3")
    result = await db.execute(
        select(CoverBlacklistConfig, Tag1, Tag2, Tag3)
        .outerjoin(Tag1, CoverBlacklistConfig.tag_id == Tag1.id)
        .outerjoin(Tag2, CoverBlacklistConfig.tag_id_2 == Tag2.id)
        .outerjoin(Tag3, CoverBlacklistConfig.tag_id_3 == Tag3.id)
        .order_by(CoverBlacklistConfig.id)
    )
    return list(result.all())


async def notify_frontend_cache_refresh() -> bool:
    """Call frontend API to refresh blacklist cache."""
    settings = get_bot_settings()
    if not settings.frontend_url or not settings.blacklist_refresh_secret:
        return False

    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{settings.frontend_url}/api/blacklist/refresh",
                headers={"x-refresh-token": settings.blacklist_refresh_secret},
                timeout=aiohttp.ClientTimeout(total=10),
            ) as response:
                return response.status == 200
    except Exception:
        return False


class BlacklistView(BaseView):
    """Main blacklist management view with stats and navigation."""

    def __init__(self, user_id: int, timeout: float = 300):
        super().__init__(user_id, timeout)
        self.stats: dict[str, int] = {}

    async def load_stats(self) -> None:
        """Load blacklist statistics."""
        async with async_session_maker() as db:
            total = (await db.execute(
                select(func.count()).select_from(CoverBlacklist)
            )).scalar_one_or_none() or 0

            manual = (await db.execute(
                select(func.count()).select_from(CoverBlacklist)
                .where(CoverBlacklist.reason == "manual")
            )).scalar_one_or_none() or 0

            rules_total = (await db.execute(
                select(func.count()).select_from(CoverBlacklistConfig)
            )).scalar_one_or_none() or 0

            rules_active = (await db.execute(
                select(func.count()).select_from(CoverBlacklistConfig)
                .where(CoverBlacklistConfig.is_active == True)
            )).scalar_one_or_none() or 0

        self.stats = {
            "total": total,
            "manual": manual,
            "auto": total - manual,
            "rules_total": rules_total,
            "rules_active": rules_active,
        }

    def get_embed(self) -> discord.Embed:
        """Generate the main blacklist embed with stats."""
        embed = create_embed(
            "Cover Blacklist Management",
            color=Colors.PRIMARY,
        )
        embed.add_field(name="Total Blacklisted", value=str(self.stats.get("total", 0)))
        embed.add_field(name="Manual", value=str(self.stats.get("manual", 0)))
        embed.add_field(name="Automatic", value=str(self.stats.get("auto", 0)))
        embed.add_field(
            name="Rules",
            value=f"{self.stats.get('rules_active', 0)} active / {self.stats.get('rules_total', 0)} total",
        )
        embed.set_footer(text="Use the buttons below to manage blacklist entries and rules")
        return embed

    @ui.button(label="Add VN", style=discord.ButtonStyle.success, emoji="\u2795", row=0)
    async def add_button(
        self, interaction: discord.Interaction, button: ui.Button
    ) -> None:
        """Show VN search to add to blacklist."""
        # Show search view
        search_view = BlacklistAddView(
            user_id=interaction.user.id,
            parent_view=self,
        )
        await interaction.response.edit_message(
            content="Enter a VN ID or search for a VN title below:",
            embed=None,
            view=search_view,
        )

    @ui.button(label="Browse Entries", style=discord.ButtonStyle.primary, emoji="\U0001f4cb", row=0)
    async def browse_button(
        self, interaction: discord.Interaction, button: ui.Button
    ) -> None:
        """Show paginated blacklist entries."""
        async with async_session_maker() as db:
            result = await db.execute(
                select(CoverBlacklist, VisualNovel)
                .join(VisualNovel, CoverBlacklist.vn_id == VisualNovel.id)
                .order_by(CoverBlacklist.added_at.desc())
                .limit(100)
            )
            entries = result.all()

        entries_view = BlacklistEntriesView(
            user_id=interaction.user.id,
            entries=entries,
            parent_view=self,
        )
        embed = await entries_view.format_page()
        await interaction.response.edit_message(embed=embed, view=entries_view)

    @ui.button(label="Run Auto", style=discord.ButtonStyle.secondary, emoji="\u2699\ufe0f", row=0)
    async def run_auto_button(
        self, interaction: discord.Interaction, button: ui.Button
    ) -> None:
        """Run auto-blacklist evaluation."""
        await interaction.response.defer()

        from app.services.blacklist_service import evaluate_auto_blacklist

        async with async_session_maker() as db:
            stats = await evaluate_auto_blacklist(db)

        cache_refreshed = await notify_frontend_cache_refresh()

        await self.load_stats()
        embed = self.get_embed()

        result_text = (
            f"\u2705 Auto-blacklist complete\n"
            f"Added: {stats['added']} | Removed: {stats['removed']}\n"
            f"Cache: {'Refreshed' if cache_refreshed else 'Pending'}"
        )
        await interaction.followup.edit_message(
            message_id=interaction.message.id,
            content=result_text,
            embed=embed,
            view=self,
        )

    @ui.button(label="View Rules", style=discord.ButtonStyle.secondary, emoji="\U0001f4d6", row=0)
    async def rules_button(
        self, interaction: discord.Interaction, button: ui.Button
    ) -> None:
        """Show blacklist rules management."""
        async with async_session_maker() as db:
            rules = await _query_rules(db)

        rules_view = BlacklistRulesView(
            user_id=interaction.user.id,
            rules=rules,
            parent_view=self,
        )
        embed = rules_view.get_embed()
        await interaction.response.edit_message(embed=embed, view=rules_view)


class BlacklistAddView(BaseView):
    """View for adding a VN to blacklist via ID input."""

    def __init__(
        self,
        user_id: int,
        parent_view: BlacklistView,
        timeout: float = 120,
    ):
        super().__init__(user_id, timeout)
        self.parent_view = parent_view

    @ui.button(label="Enter VN ID", style=discord.ButtonStyle.primary, row=0)
    async def enter_id_button(
        self, interaction: discord.Interaction, button: ui.Button
    ) -> None:
        """Open modal to enter VN ID."""
        modal = VNIDInputModal()
        await interaction.response.send_modal(modal)
        await modal.wait()

        if modal.result:
            vn_id = modal.result["vn_id"]

            async with async_session_maker() as db:
                # Verify VN exists
                result = await db.execute(
                    select(VisualNovel).where(VisualNovel.id == vn_id)
                )
                vn = result.scalar_one_or_none()

                if not vn:
                    await interaction.edit_original_response(
                        content=f"\u274c VN `{vn_id}` not found in database.",
                        view=self,
                    )
                    return

                # Check if already blacklisted
                result = await db.execute(
                    select(CoverBlacklist).where(CoverBlacklist.vn_id == vn_id)
                )
                if result.scalar_one_or_none():
                    await interaction.edit_original_response(
                        content=f"\u26a0\ufe0f VN `{vn_id}` ({vn.title}) is already blacklisted.",
                        view=self,
                    )
                    return

                # Add to blacklist
                entry = CoverBlacklist(
                    vn_id=vn_id,
                    reason="manual",
                    added_at=datetime.now(timezone.utc),
                    added_by=interaction.user.display_name,
                    notes=modal.result.get("notes"),
                )
                db.add(entry)
                await db.commit()

            cache_refreshed = await notify_frontend_cache_refresh()

            await self.parent_view.load_stats()
            embed = self.parent_view.get_embed()
            cache_text = " (cache refreshed)" if cache_refreshed else ""
            await interaction.edit_original_response(
                content=f"\u2705 VN `{vn_id}` ({vn.title}) blacklisted{cache_text}",
                embed=embed,
                view=self.parent_view,
            )

    @ui.button(label="Back", style=discord.ButtonStyle.secondary, emoji="\u2b05\ufe0f", row=1)
    async def back_button(
        self, interaction: discord.Interaction, button: ui.Button
    ) -> None:
        """Return to main blacklist view."""
        await self.parent_view.load_stats()
        embed = self.parent_view.get_embed()
        await interaction.response.edit_message(content=None, embed=embed, view=self.parent_view)


class VNIDInputModal(ui.Modal):
    """Modal for entering VN ID to blacklist."""

    def __init__(self):
        super().__init__(title="Add VN to Blacklist")
        self.result: dict | None = None

        self.vn_id_input = ui.TextInput(
            label="VN ID",
            placeholder="v12345 or 12345",
            max_length=20,
            required=True,
        )
        self.add_item(self.vn_id_input)

        self.notes_input = ui.TextInput(
            label="Notes (optional)",
            placeholder="Reason for blacklisting",
            style=discord.TextStyle.paragraph,
            max_length=500,
            required=False,
        )
        self.add_item(self.notes_input)

    async def on_submit(self, interaction: discord.Interaction) -> None:
        vn_id = self.vn_id_input.value.strip()
        # Normalize ID format
        if not vn_id.startswith("v"):
            vn_id = f"v{vn_id}"

        self.result = {
            "vn_id": vn_id,
            "notes": self.notes_input.value or None,
        }
        await interaction.response.defer()


class BlacklistEntriesView(PaginatedView):
    """Paginated view of blacklisted entries."""

    def __init__(
        self,
        user_id: int,
        entries: list[tuple[CoverBlacklist, VisualNovel]],
        parent_view: BlacklistView,
        per_page: int = 8,
        timeout: float = 300,
    ):
        super().__init__(user_id, entries, per_page, timeout)
        self.parent_view = parent_view
        self.filter_type: str | None = None
        self._build_entry_select()

    def _build_entry_select(self) -> None:
        """Build entry selection dropdown for current page."""
        # Remove existing select if any
        for item in list(self.children):
            if isinstance(item, BlacklistEntrySelect):
                self.remove_item(item)

        if not self.current_items:
            return

        options = []
        for entry, vn in self.current_items[:25]:
            reason = "manual" if entry.reason == "manual" else "auto"
            title = vn.title[:60] if len(vn.title) > 60 else vn.title
            options.append(
                discord.SelectOption(
                    label=f"{title}"[:100],
                    value=entry.vn_id,
                    description=f"ID: {entry.vn_id} | {reason}",
                )
            )

        if options:
            select = BlacklistEntrySelect(options, self)
            self.add_item(select)

    async def format_page(self) -> discord.Embed:
        """Format the current page of entries."""
        # Apply filter
        filtered = self.items
        if self.filter_type == "manual":
            filtered = [(e, v) for e, v in self.items if e.reason == "manual"]
        elif self.filter_type == "auto":
            filtered = [(e, v) for e, v in self.items if e.reason != "manual"]

        if not filtered:
            filter_text = f" ({self.filter_type})" if self.filter_type else ""
            return create_embed(
                f"Blacklisted VNs{filter_text}",
                description="No entries found.",
                color=Colors.PRIMARY,
            )

        # Paginate filtered items
        start = self.current_page * self.per_page
        end = start + self.per_page
        page_items = filtered[start:end]

        lines = []
        for entry, vn in page_items:
            reason = "manual" if entry.reason == "manual" else "auto"
            title = vn.title[:50] if len(vn.title) > 50 else vn.title
            lines.append(f"**{title}** ({entry.vn_id})")
            lines.append(f"  \u2022 {reason} | {entry.added_by or 'system'}")

        total_pages = max(1, (len(filtered) + self.per_page - 1) // self.per_page)
        filter_text = f" | Filter: {self.filter_type}" if self.filter_type else ""

        self._build_entry_select()

        return create_embed(
            f"Blacklisted VNs{filter_text}",
            description="\n".join(lines),
            footer_text=f"Page {self.current_page + 1}/{total_pages} | Select entry to remove",
            color=Colors.PRIMARY,
        )

    @ui.select(
        placeholder="Filter by type...",
        options=[
            discord.SelectOption(label="All", value="all", default=True),
            discord.SelectOption(label="Manual only", value="manual"),
            discord.SelectOption(label="Auto only", value="auto"),
        ],
        row=2,
    )
    async def filter_select(
        self, interaction: discord.Interaction, select: ui.Select
    ) -> None:
        """Handle filter selection."""
        value = select.values[0]
        self.filter_type = None if value == "all" else value
        self.current_page = 0
        embed = await self.format_page()
        await interaction.response.edit_message(embed=embed, view=self)

    @ui.button(label="Back", style=discord.ButtonStyle.secondary, emoji="\u2b05\ufe0f", row=3)
    async def back_button(
        self, interaction: discord.Interaction, button: ui.Button
    ) -> None:
        """Return to main blacklist view."""
        await self.parent_view.load_stats()
        embed = self.parent_view.get_embed()
        await interaction.response.edit_message(embed=embed, view=self.parent_view)


class BlacklistEntrySelect(ui.Select):
    """Dropdown for selecting a blacklist entry to remove."""

    def __init__(self, options: list[discord.SelectOption], parent_view: BlacklistEntriesView):
        super().__init__(
            placeholder="Select entry to remove...",
            options=options,
            row=1,
        )
        self.parent_view = parent_view

    async def callback(self, interaction: discord.Interaction) -> None:
        vn_id = self.values[0]

        # Confirm removal
        confirm_view = ConfirmView(
            user_id=interaction.user.id,
            confirm_label="Remove",
            timeout=30,
        )
        await interaction.response.edit_message(
            content=f"**Remove `{vn_id}` from blacklist?**",
            embed=None,
            view=confirm_view,
        )
        await confirm_view.wait()

        if confirm_view.value:
            async with async_session_maker() as db:
                result = await db.execute(
                    select(CoverBlacklist).where(CoverBlacklist.vn_id == vn_id)
                )
                entry = result.scalar_one_or_none()
                if entry:
                    await db.delete(entry)
                    await db.commit()

            cache_refreshed = await notify_frontend_cache_refresh()

            # Refresh entries
            async with async_session_maker() as db:
                result = await db.execute(
                    select(CoverBlacklist, VisualNovel)
                    .join(VisualNovel, CoverBlacklist.vn_id == VisualNovel.id)
                    .order_by(CoverBlacklist.added_at.desc())
                    .limit(100)
                )
                self.parent_view.items = list(result.all())

            embed = await self.parent_view.format_page()
            cache_text = " (cache refreshed)" if cache_refreshed else ""
            await interaction.edit_original_response(
                content=f"\u2705 `{vn_id}` removed from blacklist{cache_text}",
                embed=embed,
                view=self.parent_view,
            )
        else:
            embed = await self.parent_view.format_page()
            await interaction.edit_original_response(
                content=None,
                embed=embed,
                view=self.parent_view,
            )


class BlacklistRulesView(BaseView):
    """View for managing blacklist rules."""

    def __init__(
        self,
        user_id: int,
        rules: list[tuple[CoverBlacklistConfig, Tag | None, Tag | None, Tag | None]],
        parent_view: BlacklistView,
        timeout: float = 300,
    ):
        super().__init__(user_id, timeout)
        self.rules = rules
        self.parent_view = parent_view
        self._build_rule_select()

    def _build_rule_select(self) -> None:
        """Build rule selection dropdown."""
        if not self.rules:
            return

        options = []
        for config, tag1, tag2, tag3 in self.rules[:25]:
            status = "\u2705" if config.is_active else "\u274c"
            label = format_rule_label(config, [tag1, tag2, tag3])
            options.append(
                discord.SelectOption(
                    label=f"{status} {label}"[:100],
                    value=str(config.id),
                    description=f"Threshold: <{config.votecount_threshold} votes, score>{config.min_tag_score}",
                )
            )

        if options:
            select = BlacklistRuleSelect(options, self)
            self.add_item(select)

    def get_embed(self) -> discord.Embed:
        """Generate the rules list embed."""
        if not self.rules:
            return create_embed(
                "Blacklist Rules",
                description="No auto-blacklist rules configured.\n\nClick **Add Rule** to create one.",
                color=Colors.PRIMARY,
            )

        lines = []
        for config, tag1, tag2, tag3 in self.rules:
            status = "\u2705" if config.is_active else "\u274c"
            label = format_rule_label(config, [tag1, tag2, tag3])
            lines.append(
                f"{status} **#{config.id}** {label}\n"
                f"  \u2022 Threshold: <{config.votecount_threshold} votes, score>{config.min_tag_score}"
            )

        return create_embed(
            "Blacklist Rules",
            description="\n".join(lines),
            footer_text="Select a rule to edit or toggle",
            color=Colors.PRIMARY,
        )

    async def refresh_rules(self) -> None:
        """Refresh rules from database."""
        async with async_session_maker() as db:
            self.rules = await _query_rules(db)

        blacklist_rules_cache.invalidate()

        # Rebuild select
        for item in list(self.children):
            if isinstance(item, BlacklistRuleSelect):
                self.remove_item(item)
        self._build_rule_select()

    @ui.button(label="Add Rule", style=discord.ButtonStyle.success, emoji="\u2795", row=2)
    async def add_rule_button(
        self, interaction: discord.Interaction, button: ui.Button
    ) -> None:
        """Show the rule setup view for creating a new rule."""
        setup_view = RuleSetupView(
            user_id=interaction.user.id,
            parent_view=self,
        )
        embed = setup_view.get_embed()
        await interaction.response.edit_message(content=None, embed=embed, view=setup_view)

    @ui.button(label="Back", style=discord.ButtonStyle.secondary, emoji="\u2b05\ufe0f", row=2)
    async def back_button(
        self, interaction: discord.Interaction, button: ui.Button
    ) -> None:
        """Return to main blacklist view."""
        await self.parent_view.load_stats()
        embed = self.parent_view.get_embed()
        await interaction.response.edit_message(content=None, embed=embed, view=self.parent_view)


class RuleSetupView(BaseView):
    """Intermediate view for selecting age condition before entering tag/threshold details.

    Discord modals have a max of 5 TextInput fields, so age condition
    is handled via a Select dropdown in this view before opening the modal.
    """

    def __init__(
        self,
        user_id: int,
        parent_view: BlacklistRulesView,
        timeout: float = 120,
    ):
        super().__init__(user_id, timeout)
        self.parent_view = parent_view
        self.age_condition: str | None = None

    def get_embed(self) -> discord.Embed:
        """Generate the setup embed."""
        embed = create_embed(
            "Add Blacklist Rule",
            description=(
                "**Step 1:** Select an age condition (optional)\n"
                "**Step 2:** Click **Configure** to enter tags and thresholds\n\n"
                "Age conditions:\n"
                "\u2022 **None** \u2014 No age filtering\n"
                "\u2022 **Any 18+** \u2014 VN has at least one 18+ release\n"
                "\u2022 **Only 18+** \u2014 All known releases are 18+ (unknown ratings ignored)"
            ),
            color=Colors.PRIMARY,
        )
        current = AGE_LABELS.get(self.age_condition, "none") if self.age_condition else "none"
        embed.set_footer(text=f"Selected age condition: {current}")
        return embed

    @ui.select(
        placeholder="Age condition (optional)...",
        options=[
            discord.SelectOption(label="None", value="none", default=True,
                                 description="No age filtering"),
            discord.SelectOption(label="Any 18+ release", value="any_18plus",
                                 description="VN has at least one 18+ release"),
            discord.SelectOption(label="Only 18+ releases", value="only_18plus",
                                 description="All known releases are 18+"),
        ],
        row=0,
    )
    async def age_select(
        self, interaction: discord.Interaction, select: ui.Select
    ) -> None:
        """Handle age condition selection."""
        self.age_condition = select.values[0] if select.values[0] != "none" else None
        embed = self.get_embed()
        await interaction.response.edit_message(embed=embed, view=self)

    @ui.button(label="Configure Tags & Thresholds", style=discord.ButtonStyle.primary, row=1)
    async def configure_button(
        self, interaction: discord.Interaction, button: ui.Button
    ) -> None:
        """Open modal for tag names and threshold configuration."""
        modal = EnhancedTagInputModal()
        await interaction.response.send_modal(modal)
        await modal.wait()

        if not modal.result:
            return

        tag_names = modal.result["tag_names"]
        threshold = modal.result["threshold"]
        min_score = modal.result["min_score"]
        age_condition = self.age_condition

        # Validate: at least one condition
        has_tags = any(name is not None for name in tag_names)
        if not has_tags and not age_condition:
            await interaction.edit_original_response(
                content="\u274c Rule must have at least one condition (tag or age).",
            )
            return

        async with async_session_maker() as db:
            # Resolve tag names to IDs
            tag_ids = [None, None, None]
            resolved_names = []
            for i, name in enumerate(tag_names):
                if name is None:
                    continue
                result = await db.execute(
                    select(Tag).where(Tag.name.ilike(f"%{name}%"))
                    .order_by(Tag.vn_count.desc())
                    .limit(1)
                )
                tag = result.scalar_one_or_none()
                if not tag:
                    await interaction.edit_original_response(
                        content=f"\u274c Tag containing `{name}` not found.",
                    )
                    return
                tag_ids[i] = tag.id
                resolved_names.append(tag.name)

            # Validate: no secondary tags without primary
            if tag_ids[0] is None and (tag_ids[1] is not None or tag_ids[2] is not None):
                await interaction.edit_original_response(
                    content="\u274c Cannot set secondary tags without a primary tag.",
                )
                return

            # Create rule
            config = CoverBlacklistConfig(
                tag_id=tag_ids[0],
                tag_id_2=tag_ids[1],
                tag_id_3=tag_ids[2],
                age_condition=age_condition,
                votecount_threshold=threshold,
                min_tag_score=min_score,
                is_active=True,
                created_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc),
            )
            db.add(config)
            await db.commit()

            # Run auto-evaluation
            from app.services.blacklist_service import evaluate_auto_blacklist
            stats = await evaluate_auto_blacklist(db)

        await notify_frontend_cache_refresh()
        await self.parent_view.refresh_rules()
        embed = self.parent_view.get_embed()

        parts = []
        if resolved_names:
            parts.append(" + ".join(resolved_names))
        if age_condition:
            parts.append(AGE_LABELS.get(age_condition, age_condition))
        condition_text = " | ".join(parts) or "rule"

        await interaction.edit_original_response(
            content=f"\u2705 Rule created for `{condition_text}`. {stats['added']} VNs added.",
            embed=embed,
            view=self.parent_view,
        )

    @ui.button(label="Back", style=discord.ButtonStyle.secondary, emoji="\u2b05\ufe0f", row=1)
    async def back_button(
        self, interaction: discord.Interaction, button: ui.Button
    ) -> None:
        """Return to rules list."""
        embed = self.parent_view.get_embed()
        await interaction.response.edit_message(content=None, embed=embed, view=self.parent_view)


class EnhancedTagInputModal(ui.Modal):
    """Modal for entering up to 3 tag names + threshold + score for a new rule."""

    def __init__(self):
        super().__init__(title="Add Blacklist Rule")
        self.result: dict | None = None

        self.tag1_input = ui.TextInput(
            label="Tag 1 (optional if age condition set)",
            placeholder="e.g. 'nukige'",
            max_length=100,
            required=False,
        )
        self.add_item(self.tag1_input)

        self.tag2_input = ui.TextInput(
            label="Tag 2 (optional, AND logic)",
            placeholder="e.g. 'netorare'",
            max_length=100,
            required=False,
        )
        self.add_item(self.tag2_input)

        self.tag3_input = ui.TextInput(
            label="Tag 3 (optional, AND logic)",
            placeholder="e.g. 'rape'",
            max_length=100,
            required=False,
        )
        self.add_item(self.tag3_input)

        self.threshold_input = ui.TextInput(
            label="Vote Threshold",
            placeholder="100",
            default="100",
            max_length=10,
            required=True,
        )
        self.add_item(self.threshold_input)

        self.score_input = ui.TextInput(
            label="Minimum Tag Score",
            placeholder="1.5",
            default="1.5",
            max_length=10,
            required=True,
        )
        self.add_item(self.score_input)

    async def on_submit(self, interaction: discord.Interaction) -> None:
        try:
            threshold = int(self.threshold_input.value)
            if threshold < 0:
                raise ValueError()
        except ValueError:
            await interaction.response.send_message(
                "Invalid vote threshold. Please enter a positive integer.",
                ephemeral=True,
            )
            return

        try:
            score = float(self.score_input.value)
            if score < 0 or score > 3:
                raise ValueError()
        except ValueError:
            await interaction.response.send_message(
                "Invalid tag score. Please enter a number between 0 and 3.",
                ephemeral=True,
            )
            return

        self.result = {
            "tag_names": [
                self.tag1_input.value.strip() or None,
                self.tag2_input.value.strip() or None,
                self.tag3_input.value.strip() or None,
            ],
            "threshold": threshold,
            "min_score": score,
        }
        await interaction.response.defer()


class BlacklistRuleSelect(ui.Select):
    """Dropdown for selecting a blacklist rule to manage."""

    def __init__(self, options: list[discord.SelectOption], parent_view: BlacklistRulesView):
        super().__init__(
            placeholder="Select rule to manage...",
            options=options,
            row=1,
        )
        self.parent_view = parent_view

    async def callback(self, interaction: discord.Interaction) -> None:
        config_id = int(self.values[0])

        # Find the rule
        config = None
        tags: list[Tag | None] = [None, None, None]
        for c, t1, t2, t3 in self.parent_view.rules:
            if c.id == config_id:
                config = c
                tags = [t1, t2, t3]
                break

        if not config:
            await interaction.response.send_message(
                f"Rule #{config_id} not found.", ephemeral=True
            )
            return

        # Show rule action view
        action_view = BlacklistRuleActionView(
            user_id=interaction.user.id,
            config=config,
            tags=tags,
            parent_view=self.parent_view,
        )
        embed = action_view.get_detail_embed()
        await interaction.response.edit_message(embed=embed, view=action_view)


class BlacklistRuleActionView(BaseView):
    """View showing actions for a specific blacklist rule."""

    def __init__(
        self,
        user_id: int,
        config: CoverBlacklistConfig,
        tags: list[Tag | None],
        parent_view: BlacklistRulesView,
        timeout: float = 120,
    ):
        super().__init__(user_id, timeout)
        self.config = config
        self.tags = tags
        self.parent_view = parent_view
        self._update_toggle_button()

    def _update_toggle_button(self) -> None:
        """Update toggle button label."""
        self.toggle_button.label = "Disable" if self.config.is_active else "Enable"
        self.toggle_button.style = (
            discord.ButtonStyle.secondary
            if self.config.is_active
            else discord.ButtonStyle.success
        )

    def get_detail_embed(self) -> discord.Embed:
        """Generate detail embed for the rule."""
        status = "\u2705 Active" if self.config.is_active else "\u274c Inactive"
        label = format_rule_label(self.config, self.tags)
        embed = create_embed(
            f"Rule #{self.config.id}: {label}"[:256],
            color=Colors.SUCCESS if self.config.is_active else Colors.WARNING,
        )
        embed.add_field(name="Status", value=status, inline=True)
        embed.add_field(name="Vote Threshold", value=f"<{self.config.votecount_threshold}", inline=True)
        embed.add_field(name="Min Tag Score", value=f">{self.config.min_tag_score}", inline=True)

        # Tag details
        tag_names = [t.name for t in self.tags if t is not None]
        if tag_names:
            tag_info_parts = []
            for t in self.tags:
                if t is not None:
                    tag_info_parts.append(f"{t.name} (ID: {t.id}, {t.category or 'N/A'})")
            embed.add_field(
                name="Tags (AND logic)" if len(tag_names) > 1 else "Tag",
                value="\n".join(tag_info_parts),
                inline=False,
            )

        # Age condition
        if self.config.age_condition:
            embed.add_field(
                name="Age Condition",
                value=AGE_LABELS.get(self.config.age_condition, self.config.age_condition),
                inline=True,
            )

        return embed

    @ui.button(label="Edit", style=discord.ButtonStyle.primary, emoji="\u270f\ufe0f", row=0)
    async def edit_button(
        self, interaction: discord.Interaction, button: ui.Button
    ) -> None:
        """Open modal to edit rule parameters."""
        tag_names = [t.name for t in self.tags if t is not None]
        display_name = " + ".join(tag_names) if tag_names else "Rule"
        modal = BlacklistRuleModal(rule=self.config, tag_name=display_name)
        await interaction.response.send_modal(modal)
        await modal.wait()

        if modal.result:
            async with async_session_maker() as db:
                result = await db.execute(
                    select(CoverBlacklistConfig).where(CoverBlacklistConfig.id == self.config.id)
                )
                config = result.scalar_one_or_none()
                if config:
                    config.votecount_threshold = modal.result["votecount_threshold"]
                    config.min_tag_score = modal.result["min_tag_score"]
                    if "age_condition" in modal.result:
                        config.age_condition = modal.result["age_condition"]
                    config.updated_at = datetime.now(timezone.utc)
                    await db.commit()
                    await db.refresh(config)
                    self.config = config

                # Re-evaluate
                from app.services.blacklist_service import evaluate_auto_blacklist
                stats = await evaluate_auto_blacklist(db)

            await notify_frontend_cache_refresh()

            embed = self.get_detail_embed()
            await interaction.edit_original_response(
                content=f"\u2705 Rule updated. Added: {stats['added']} | Removed: {stats['removed']}",
                embed=embed,
                view=self,
            )

    @ui.button(label="Toggle", style=discord.ButtonStyle.secondary, row=0)
    async def toggle_button(
        self, interaction: discord.Interaction, button: ui.Button
    ) -> None:
        """Toggle rule active status."""
        async with async_session_maker() as db:
            result = await db.execute(
                select(CoverBlacklistConfig).where(CoverBlacklistConfig.id == self.config.id)
            )
            config = result.scalar_one_or_none()
            if config:
                config.is_active = not config.is_active
                config.updated_at = datetime.now(timezone.utc)
                await db.commit()
                await db.refresh(config)
                self.config = config

            # Re-evaluate
            from app.services.blacklist_service import evaluate_auto_blacklist
            stats = await evaluate_auto_blacklist(db)

        await notify_frontend_cache_refresh()

        self._update_toggle_button()
        status = "enabled" if self.config.is_active else "disabled"
        embed = self.get_detail_embed()
        await interaction.response.edit_message(
            content=f"\u2705 Rule {status}. Added: {stats['added']} | Removed: {stats['removed']}",
            embed=embed,
            view=self,
        )

    @ui.button(label="Delete", style=discord.ButtonStyle.danger, emoji="\U0001f5d1\ufe0f", row=0)
    async def delete_button(
        self, interaction: discord.Interaction, button: ui.Button
    ) -> None:
        """Delete rule with confirmation."""
        label = format_rule_label(self.config, self.tags)
        confirm_view = ConfirmView(
            user_id=interaction.user.id,
            confirm_label="Delete",
            timeout=30,
        )
        await interaction.response.edit_message(
            content=f"**Delete rule #{self.config.id} (`{label}`)?**\n\n"
                    "VNs blacklisted only by this rule will be removed from the blacklist.",
            embed=None,
            view=confirm_view,
        )
        await confirm_view.wait()

        if confirm_view.value:
            async with async_session_maker() as db:
                result = await db.execute(
                    select(CoverBlacklistConfig).where(CoverBlacklistConfig.id == self.config.id)
                )
                config = result.scalar_one_or_none()
                if config:
                    await db.delete(config)
                    await db.commit()

                # Re-evaluate handles all cleanup automatically
                from app.services.blacklist_service import evaluate_auto_blacklist
                stats = await evaluate_auto_blacklist(db)

            await notify_frontend_cache_refresh()

            await self.parent_view.refresh_rules()
            embed = self.parent_view.get_embed()
            await interaction.edit_original_response(
                content=f"\u2705 Rule deleted. Removed: {stats['removed']}",
                embed=embed,
                view=self.parent_view,
            )
        else:
            embed = self.get_detail_embed()
            await interaction.edit_original_response(
                content=None,
                embed=embed,
                view=self,
            )

    @ui.button(label="Back", style=discord.ButtonStyle.secondary, emoji="\u2b05\ufe0f", row=1)
    async def back_button(
        self, interaction: discord.Interaction, button: ui.Button
    ) -> None:
        """Return to rules list."""
        await self.parent_view.refresh_rules()
        embed = self.parent_view.get_embed()
        await interaction.response.edit_message(content=None, embed=embed, view=self.parent_view)
