"""Cover blacklist management commands."""

import logging
from datetime import datetime, timezone

import aiohttp
import discord
from discord import app_commands
from discord.ext import commands
from sqlalchemy import select, func, delete, and_, or_
from sqlalchemy.orm import aliased

from app.db.database import async_session_maker
from app.db.models import (
    CoverBlacklist, CoverBlacklistConfig, Tag, VisualNovel
)
from discord_bot.permissions import is_admin
from discord_bot.config import get_bot_settings

logger = logging.getLogger(__name__)


AGE_LABELS = {"any_18plus": "any 18+", "only_18plus": "only 18+"}


async def notify_frontend_cache_refresh() -> bool:
    """
    Call frontend API to refresh blacklist cache.

    Returns True if successful, False otherwise.
    """
    settings = get_bot_settings()
    if not settings.frontend_url or not settings.blacklist_refresh_secret:
        logger.warning("Frontend cache refresh not configured (missing FRONTEND_URL or BLACKLIST_REFRESH_SECRET)")
        return False

    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{settings.frontend_url}/api/blacklist/refresh",
                headers={"x-refresh-token": settings.blacklist_refresh_secret},
                timeout=aiohttp.ClientTimeout(total=10),
            ) as response:
                if response.status == 200:
                    data = await response.json()
                    logger.info(f"Frontend cache refreshed: {data.get('count', 0)} VNs blacklisted")
                    return True
                else:
                    logger.error(f"Frontend cache refresh failed: {response.status}")
                    return False
    except Exception as e:
        logger.error(f"Failed to notify frontend cache refresh: {e}")
        return False


# ==================== Autocomplete Functions ====================


async def tag_autocomplete(
    interaction: discord.Interaction,
    current: str,
) -> list[app_commands.Choice[int]]:
    """Autocomplete for tag search (rule-add)."""
    async with async_session_maker() as db:
        query = select(Tag).where(Tag.searchable == True)
        if current:
            query = query.where(Tag.name.ilike(f"%{current}%"))
        query = query.order_by(Tag.vn_count.desc()).limit(25)
        result = await db.execute(query)
        tags = result.scalars().all()

    return [
        app_commands.Choice(
            name=f"{tag.name} ({tag.category or 'tag'})"[:100],
            value=tag.id,
        )
        for tag in tags
    ]


async def rule_autocomplete(
    interaction: discord.Interaction,
    current: str,
) -> list[app_commands.Choice[int]]:
    """Autocomplete for existing rules (rule-update, rule-remove)."""
    async with async_session_maker() as db:
        Tag1 = aliased(Tag, name="tag1")
        query = (
            select(CoverBlacklistConfig, Tag1)
            .outerjoin(Tag1, CoverBlacklistConfig.tag_id == Tag1.id)
            .order_by(CoverBlacklistConfig.id)
        )
        if current:
            query = query.where(
                or_(
                    Tag1.name.ilike(f"%{current}%"),
                    CoverBlacklistConfig.age_condition.ilike(f"%{current}%"),
                )
            )
        result = await db.execute(query)
        rows = result.all()

    choices = []
    for config, tag in rows[:25]:
        status = "\u2713" if config.is_active else "\u2717"
        parts = []
        if tag:
            parts.append(tag.name)
        if config.tag_id_2 or config.tag_id_3:
            parts.append("+...")
        if config.age_condition:
            parts.append(AGE_LABELS.get(config.age_condition, config.age_condition))
        condition = " ".join(parts) or "no condition"
        label = f"{status} #{config.id} {condition} (votes<{config.votecount_threshold})"
        choices.append(app_commands.Choice(name=label[:100], value=config.id))

    return choices


async def vn_autocomplete(
    interaction: discord.Interaction,
    current: str,
) -> list[app_commands.Choice[str]]:
    """Autocomplete for VN search (add)."""
    if not current or len(current) < 2:
        return []  # Require at least 2 chars to search

    async with async_session_maker() as db:
        query = (
            select(VisualNovel)
            .where(VisualNovel.title.ilike(f"%{current}%"))
            .order_by(VisualNovel.votecount.desc())
            .limit(25)
        )
        result = await db.execute(query)
        vns = result.scalars().all()

    return [
        app_commands.Choice(
            name=f"{vn.title[:70]} ({vn.id})"[:100],
            value=vn.id,
        )
        for vn in vns
    ]


async def blacklisted_vn_autocomplete(
    interaction: discord.Interaction,
    current: str,
) -> list[app_commands.Choice[str]]:
    """Autocomplete for blacklisted VNs only (remove)."""
    async with async_session_maker() as db:
        query = (
            select(CoverBlacklist, VisualNovel)
            .join(VisualNovel, CoverBlacklist.vn_id == VisualNovel.id)
            .order_by(CoverBlacklist.added_at.desc())
        )
        if current:
            query = query.where(VisualNovel.title.ilike(f"%{current}%"))
        query = query.limit(25)
        result = await db.execute(query)
        rows = result.all()

    choices = []
    for entry, vn in rows:
        reason_short = "manual" if entry.reason == "manual" else "auto"
        label = f"{vn.title[:60]} ({vn.id}) - {reason_short}"
        choices.append(app_commands.Choice(name=label[:100], value=vn.id))

    return choices


class BlacklistCog(commands.Cog):
    """Manage cover image blacklisting."""

    group = app_commands.Group(name="blacklist", description="Cover blacklist management")

    def __init__(self, bot: commands.Bot):
        self.bot = bot

    @group.command(name="stats", description="Show blacklist statistics")
    @is_admin()
    async def blacklist_stats(self, interaction: discord.Interaction):
        async with async_session_maker() as db:
            total = (await db.execute(select(func.count()).select_from(CoverBlacklist))).scalar_one_or_none() or 0
            manual = (await db.execute(
                select(func.count()).select_from(CoverBlacklist).where(CoverBlacklist.reason == "manual")
            )).scalar_one_or_none() or 0
            rules = (await db.execute(select(func.count()).select_from(CoverBlacklistConfig))).scalar_one_or_none() or 0
            active_rules = (await db.execute(
                select(func.count()).select_from(CoverBlacklistConfig).where(CoverBlacklistConfig.is_active == True)
            )).scalar_one_or_none() or 0

        embed = discord.Embed(title="Blacklist Statistics", color=discord.Color.blue())
        embed.add_field(name="Total Blacklisted", value=str(total))
        embed.add_field(name="Manual", value=str(manual))
        embed.add_field(name="Auto", value=str(total - manual))
        embed.add_field(name="Rules", value=f"{active_rules} active / {rules} total")
        await interaction.response.send_message(embed=embed)

    @group.command(name="add", description="Manually blacklist a VN cover")
    @app_commands.describe(
        vn_id="Search for VN by title",
        notes="Optional reason for blacklisting",
    )
    @app_commands.autocomplete(vn_id=vn_autocomplete)
    @is_admin()
    async def add_entry(self, interaction: discord.Interaction, vn_id: str, notes: str | None = None):
        async with async_session_maker() as db:
            # Verify VN exists
            result = await db.execute(select(VisualNovel).where(VisualNovel.id == vn_id))
            vn = result.scalar_one_or_none()
            if not vn:
                await interaction.response.send_message(f"VN `{vn_id}` not found.")
                return

            # Check if already blacklisted
            result = await db.execute(select(CoverBlacklist).where(CoverBlacklist.vn_id == vn_id))
            if result.scalar_one_or_none():
                await interaction.response.send_message(f"VN `{vn_id}` is already blacklisted.")
                return

            entry = CoverBlacklist(
                vn_id=vn_id,
                reason="manual",
                added_at=datetime.now(timezone.utc),
                added_by=interaction.user.display_name,
                notes=notes,
            )
            db.add(entry)
            await db.commit()

        # Notify frontend to refresh cache
        cache_refreshed = await notify_frontend_cache_refresh()
        cache_status = " (cache refreshed)" if cache_refreshed else " (cache refresh pending)"
        await interaction.response.send_message(f"VN `{vn_id}` ({vn.title}) has been blacklisted.{cache_status}")

    @group.command(name="remove", description="Remove a VN from the blacklist")
    @app_commands.describe(vn_id="Select a blacklisted VN to remove")
    @app_commands.autocomplete(vn_id=blacklisted_vn_autocomplete)
    @is_admin()
    async def remove_entry(self, interaction: discord.Interaction, vn_id: str):
        async with async_session_maker() as db:
            result = await db.execute(select(CoverBlacklist).where(CoverBlacklist.vn_id == vn_id))
            entry = result.scalar_one_or_none()

            if not entry:
                await interaction.response.send_message(f"VN `{vn_id}` is not blacklisted.")
                return

            await db.delete(entry)
            await db.commit()

        # Notify frontend to refresh cache
        cache_refreshed = await notify_frontend_cache_refresh()
        cache_status = " (cache refreshed)" if cache_refreshed else " (cache refresh pending)"
        await interaction.response.send_message(f"VN `{vn_id}` removed from blacklist.{cache_status}")

    @group.command(name="run-auto", description="Run auto-blacklist evaluation")
    @is_admin()
    async def run_auto(self, interaction: discord.Interaction):
        await interaction.response.defer()

        from app.services.blacklist_service import evaluate_auto_blacklist

        async with async_session_maker() as db:
            stats = await evaluate_auto_blacklist(db)

        # Notify frontend to refresh cache
        cache_refreshed = await notify_frontend_cache_refresh()

        embed = discord.Embed(title="Auto-Blacklist Complete", color=discord.Color.green())
        embed.add_field(name="Added", value=str(stats["added"]))
        embed.add_field(name="Removed", value=str(stats["removed"]))
        embed.add_field(name="Cache", value="Refreshed" if cache_refreshed else "Pending", inline=False)
        await interaction.followup.send(embed=embed)

    @group.command(name="rule-add", description="Create an auto-blacklist rule")
    @app_commands.describe(
        threshold="Blacklist if VN has fewer votes than this",
        tag_id="Primary tag (optional if age condition set)",
        tag_id_2="Second tag - AND logic (optional)",
        tag_id_3="Third tag - AND logic (optional)",
        min_score="Minimum tag score to trigger (default 1.5)",
        age_condition="Age rating filter (optional)",
    )
    @app_commands.autocomplete(
        tag_id=tag_autocomplete,
        tag_id_2=tag_autocomplete,
        tag_id_3=tag_autocomplete,
    )
    @app_commands.choices(age_condition=[
        app_commands.Choice(name="None", value="none"),
        app_commands.Choice(name="Any 18+ release", value="any_18plus"),
        app_commands.Choice(name="Only 18+ releases", value="only_18plus"),
    ])
    @is_admin()
    async def add_rule(
        self,
        interaction: discord.Interaction,
        threshold: int,
        tag_id: int | None = None,
        tag_id_2: int | None = None,
        tag_id_3: int | None = None,
        min_score: float = 1.5,
        age_condition: str | None = None,
    ):
        await interaction.response.defer()

        # Normalize age_condition
        if age_condition == "none":
            age_condition = None

        # Validation: at least one condition required
        if tag_id is None and age_condition is None:
            await interaction.followup.send("Rule must have at least one condition (tag or age).")
            return

        # Validation: tag_id_2/tag_id_3 only valid if tag_id is set
        if tag_id is None and (tag_id_2 is not None or tag_id_3 is not None):
            await interaction.followup.send("Cannot set secondary tags without a primary tag.")
            return

        from app.services.blacklist_service import evaluate_auto_blacklist

        async with async_session_maker() as db:
            # Verify all specified tags exist
            tag_names = []
            for tid in [tag_id, tag_id_2, tag_id_3]:
                if tid is not None:
                    result = await db.execute(select(Tag).where(Tag.id == tid))
                    tag = result.scalar_one_or_none()
                    if not tag:
                        await interaction.followup.send(f"Tag ID `{tid}` not found.")
                        return
                    tag_names.append(tag.name)

            config = CoverBlacklistConfig(
                tag_id=tag_id,
                tag_id_2=tag_id_2,
                tag_id_3=tag_id_3,
                age_condition=age_condition,
                votecount_threshold=threshold,
                min_tag_score=min_score,
                is_active=True,
                created_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc),
            )
            db.add(config)
            await db.commit()
            await db.refresh(config)

            # Auto-apply rule to existing VNs
            stats = await evaluate_auto_blacklist(db)

        # Notify frontend to refresh cache
        cache_refreshed = await notify_frontend_cache_refresh()

        embed = discord.Embed(title="Rule Created & Applied", color=discord.Color.green())
        embed.add_field(name="ID", value=str(config.id))
        if tag_names:
            embed.add_field(name="Tags", value=" + ".join(tag_names))
        if age_condition:
            embed.add_field(name="Age", value=AGE_LABELS.get(age_condition, age_condition))
        embed.add_field(name="Threshold", value=f"votes < {threshold}")
        embed.add_field(name="Min Score", value=str(min_score))
        embed.add_field(name="VNs Added", value=str(stats["added"]), inline=False)
        embed.add_field(name="Cache", value="Refreshed" if cache_refreshed else "Pending", inline=False)
        await interaction.followup.send(embed=embed)

    @group.command(name="rule-update", description="Update an auto-blacklist rule")
    @app_commands.describe(
        config_id="Select rule to update",
        threshold="New vote threshold (leave empty to keep current)",
        min_score="New minimum tag score (leave empty to keep current)",
        active="Enable or disable this rule",
        age_condition="Change age condition",
    )
    @app_commands.autocomplete(config_id=rule_autocomplete)
    @app_commands.choices(age_condition=[
        app_commands.Choice(name="No change", value="unchanged"),
        app_commands.Choice(name="None", value="none"),
        app_commands.Choice(name="Any 18+ release", value="any_18plus"),
        app_commands.Choice(name="Only 18+ releases", value="only_18plus"),
    ])
    @is_admin()
    async def update_rule(
        self,
        interaction: discord.Interaction,
        config_id: int,
        threshold: int | None = None,
        min_score: float | None = None,
        active: bool | None = None,
        age_condition: str | None = None,
    ):
        await interaction.response.defer()

        from app.services.blacklist_service import evaluate_auto_blacklist

        async with async_session_maker() as db:
            result = await db.execute(
                select(CoverBlacklistConfig).where(CoverBlacklistConfig.id == config_id)
            )
            config = result.scalar_one_or_none()

            if not config:
                await interaction.followup.send(f"Rule #{config_id} not found.")
                return

            if threshold is not None:
                config.votecount_threshold = threshold
            if min_score is not None:
                config.min_tag_score = min_score
            if active is not None:
                config.is_active = active
            if age_condition is not None and age_condition != "unchanged":
                config.age_condition = age_condition if age_condition != "none" else None
            config.updated_at = datetime.now(timezone.utc)

            await db.commit()

            # Re-evaluate all rules to apply changes
            stats = await evaluate_auto_blacklist(db)

        # Notify frontend to refresh cache
        cache_refreshed = await notify_frontend_cache_refresh()

        embed = discord.Embed(title="Rule Updated & Re-evaluated", color=discord.Color.green())
        embed.add_field(name="Rule", value=f"#{config_id}")
        embed.add_field(name="VNs Added", value=str(stats["added"]))
        embed.add_field(name="VNs Removed", value=str(stats["removed"]))
        embed.add_field(name="Cache", value="Refreshed" if cache_refreshed else "Pending", inline=False)
        await interaction.followup.send(embed=embed)

    @group.command(name="rule-remove", description="Remove an auto-blacklist rule")
    @app_commands.describe(config_id="Select rule to delete")
    @app_commands.autocomplete(config_id=rule_autocomplete)
    @is_admin()
    async def remove_rule(self, interaction: discord.Interaction, config_id: int):
        await interaction.response.defer()

        from app.services.blacklist_service import evaluate_auto_blacklist

        async with async_session_maker() as db:
            result = await db.execute(
                select(CoverBlacklistConfig).where(CoverBlacklistConfig.id == config_id)
            )
            config = result.scalar_one_or_none()

            if not config:
                await interaction.followup.send(f"Rule #{config_id} not found.")
                return

            await db.delete(config)
            await db.commit()

            # Re-evaluate handles all cleanup automatically
            stats = await evaluate_auto_blacklist(db)

        # Notify frontend to refresh cache
        cache_refreshed = await notify_frontend_cache_refresh()
        cache_status = " (cache refreshed)" if cache_refreshed else " (cache refresh pending)"

        await interaction.followup.send(
            f"Rule #{config_id} removed. "
            f"Added: {stats['added']}, Removed: {stats['removed']}.{cache_status}"
        )

    @group.command(name="rule-list", description="List all auto-blacklist rules")
    @is_admin()
    async def list_rules(self, interaction: discord.Interaction):
        async with async_session_maker() as db:
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
            rows = result.all()

        if not rows:
            await interaction.response.send_message("No auto-blacklist rules configured.")
            return

        lines = []
        for config, tag1, tag2, tag3 in rows:
            status = "\u2705" if config.is_active else "\u274c"
            parts = []
            tag_names = [t.name for t in [tag1, tag2, tag3] if t is not None]
            if tag_names:
                parts.append(" + ".join(tag_names))
            if config.age_condition:
                parts.append(AGE_LABELS.get(config.age_condition, config.age_condition))
            condition = " | ".join(parts) or "no condition"
            lines.append(
                f"{status} **#{config.id}** {condition} "
                f"(threshold: {config.votecount_threshold}, score: {config.min_tag_score})"
            )

        embed = discord.Embed(
            title="Auto-Blacklist Rules",
            description="\n".join(lines),
            color=discord.Color.blue(),
        )
        await interaction.response.send_message(embed=embed)


async def setup(bot: commands.Bot):
    await bot.add_cog(BlacklistCog(bot))
