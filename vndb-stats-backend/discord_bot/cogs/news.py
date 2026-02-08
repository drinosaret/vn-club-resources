"""News, announcement, and RSS feed management commands."""

import logging
from datetime import datetime, timezone

import discord
from discord import app_commands
from discord.ext import commands
from sqlalchemy import select, func

from app.db.database import async_session_maker
from app.db.models import NewsItem, Announcement, RSSFeedConfig
from discord_bot.permissions import is_admin

logger = logging.getLogger(__name__)


# ==================== Autocomplete Functions ====================


async def news_item_autocomplete(
    interaction: discord.Interaction,
    current: str,
) -> list[app_commands.Choice[str]]:
    """Autocomplete for news item IDs."""
    async with async_session_maker() as db:
        query = select(NewsItem).order_by(NewsItem.published_at.desc()).limit(25)
        if current:
            query = query.where(NewsItem.title.ilike(f"%{current}%"))
        result = await db.execute(query)
        items = result.scalars().all()

    choices = []
    for item in items:
        # Format: [SOURCE] Title (Mon DD)
        source = item.source_label or item.source.upper()
        date_str = item.published_at.strftime("%b %d") if item.published_at else ""
        # Discord limits choice names to 100 chars
        max_title_len = 100 - len(f"[{source}]  ({date_str})")
        title = item.title[:max_title_len] + "..." if len(item.title) > max_title_len else item.title
        label = f"[{source}] {title} ({date_str})"
        choices.append(app_commands.Choice(name=label[:100], value=item.id))

    return choices


async def announcement_autocomplete(
    interaction: discord.Interaction,
    current: str,
) -> list[app_commands.Choice[int]]:
    """Autocomplete for announcement IDs."""
    async with async_session_maker() as db:
        query = select(Announcement).order_by(Announcement.published_at.desc()).limit(25)
        if current:
            query = query.where(Announcement.title.ilike(f"%{current}%"))
        result = await db.execute(query)
        announcements = result.scalars().all()

    choices = []
    for ann in announcements:
        # Format: ✓/✗ #ID Title (Mon DD)
        status = "✓" if ann.is_active else "✗"
        date_str = ann.published_at.strftime("%b %d") if ann.published_at else ""
        max_title_len = 100 - len(f"{status} #{ann.id}  ({date_str})")
        title = ann.title[:max_title_len] + "..." if len(ann.title) > max_title_len else ann.title
        label = f"{status} #{ann.id} {title} ({date_str})"
        choices.append(app_commands.Choice(name=label[:100], value=ann.id))

    return choices


async def rss_feed_autocomplete(
    interaction: discord.Interaction,
    current: str,
) -> list[app_commands.Choice[int]]:
    """Autocomplete for RSS feed IDs."""
    async with async_session_maker() as db:
        query = select(RSSFeedConfig).order_by(RSSFeedConfig.name).limit(25)
        if current:
            query = query.where(RSSFeedConfig.name.ilike(f"%{current}%"))
        result = await db.execute(query)
        configs = result.scalars().all()

    choices = []
    for config in configs:
        # Format: ✓/✗ #ID Name
        status = "✓" if config.is_active else "✗"
        max_name_len = 100 - len(f"{status} #{config.id} ")
        name = config.name[:max_name_len] + "..." if len(config.name) > max_name_len else config.name
        label = f"{status} #{config.id} {name}"
        choices.append(app_commands.Choice(name=label[:100], value=config.id))

    return choices


class NewsCog(commands.Cog):
    """Manage news, announcements, and RSS feeds."""

    news_group = app_commands.Group(name="news", description="News management")
    ann_group = app_commands.Group(name="announcement", description="Announcement management")
    rss_group = app_commands.Group(name="rss", description="RSS feed management")

    def __init__(self, bot: commands.Bot):
        self.bot = bot

    # ==================== News Commands ====================

    @news_group.command(name="refresh", description="Trigger news refresh from all sources")
    @is_admin()
    async def refresh_news(self, interaction: discord.Interaction):
        await interaction.response.defer()

        from app.ingestion.news_aggregator import run_all_news_checks

        await run_all_news_checks()

        await interaction.followup.send("News refresh completed from all sources.")

    @news_group.command(name="hide", description="Hide a news item")
    @app_commands.describe(item_id="Select news item to hide")
    @app_commands.autocomplete(item_id=news_item_autocomplete)
    @is_admin()
    async def hide_news(self, interaction: discord.Interaction, item_id: str):
        async with async_session_maker() as db:
            result = await db.execute(select(NewsItem).where(NewsItem.id == item_id))
            item = result.scalar_one_or_none()

            if not item:
                await interaction.response.send_message(f"News item `{item_id}` not found.")
                return

            item.is_hidden = True
            await db.commit()

        await interaction.response.send_message(f"News item `{item_id}` hidden.")

    @news_group.command(name="unhide", description="Unhide a news item")
    @app_commands.describe(item_id="Select news item to unhide")
    @app_commands.autocomplete(item_id=news_item_autocomplete)
    @is_admin()
    async def unhide_news(self, interaction: discord.Interaction, item_id: str):
        async with async_session_maker() as db:
            result = await db.execute(select(NewsItem).where(NewsItem.id == item_id))
            item = result.scalar_one_or_none()

            if not item:
                await interaction.response.send_message(f"News item `{item_id}` not found.")
                return

            item.is_hidden = False
            await db.commit()

        await interaction.response.send_message(f"News item `{item_id}` is now visible.")

    # ==================== Announcement Commands ====================

    @ann_group.command(name="create", description="Create an announcement")
    @app_commands.describe(
        title="Announcement headline",
        content="Full announcement text",
        url="Link to more info (optional)",
        image_url="Banner image URL (optional)",
    )
    @is_admin()
    async def create_announcement(
        self,
        interaction: discord.Interaction,
        title: str,
        content: str,
        url: str | None = None,
        image_url: str | None = None,
    ):
        async with async_session_maker() as db:
            announcement = Announcement(
                title=title,
                content=content,
                url=url,
                image_url=image_url,
                published_at=datetime.now(timezone.utc),
                is_active=True,
                created_by=interaction.user.display_name,
            )
            db.add(announcement)
            await db.commit()
            await db.refresh(announcement)

            embed = discord.Embed(
                title="Announcement Created",
                description=f"**{title}**\n{content}",
                color=discord.Color.green(),
            )
            embed.add_field(name="ID", value=str(announcement.id))
            if url:
                embed.add_field(name="URL", value=url)
            await interaction.response.send_message(embed=embed)

    @ann_group.command(name="update", description="Update an announcement")
    @app_commands.describe(
        id="Select announcement to edit",
        title="New title (leave empty to keep current)",
        content="New content (leave empty to keep current)",
        active="Show or hide the announcement",
    )
    @app_commands.autocomplete(id=announcement_autocomplete)
    @is_admin()
    async def update_announcement(
        self,
        interaction: discord.Interaction,
        id: int,
        title: str | None = None,
        content: str | None = None,
        active: bool | None = None,
    ):
        async with async_session_maker() as db:
            result = await db.execute(select(Announcement).where(Announcement.id == id))
            announcement = result.scalar_one_or_none()

            if not announcement:
                await interaction.response.send_message(f"Announcement #{id} not found.")
                return

            if title is not None:
                announcement.title = title
            if content is not None:
                announcement.content = content
            if active is not None:
                announcement.is_active = active

            await db.commit()

        await interaction.response.send_message(f"Announcement #{id} updated.")

    @ann_group.command(name="delete", description="Delete an announcement")
    @app_commands.describe(id="Select announcement to delete")
    @app_commands.autocomplete(id=announcement_autocomplete)
    @is_admin()
    async def delete_announcement(self, interaction: discord.Interaction, id: int):
        async with async_session_maker() as db:
            result = await db.execute(select(Announcement).where(Announcement.id == id))
            announcement = result.scalar_one_or_none()

            if not announcement:
                await interaction.response.send_message(f"Announcement #{id} not found.")
                return

            await db.delete(announcement)
            await db.commit()

        await interaction.response.send_message(f"Announcement #{id} deleted.")

    @ann_group.command(name="list", description="List announcements")
    @app_commands.describe(include_inactive="Also show hidden announcements")
    @is_admin()
    async def list_announcements(self, interaction: discord.Interaction, include_inactive: bool = False):
        async with async_session_maker() as db:
            query = select(Announcement)
            if not include_inactive:
                query = query.where(Announcement.is_active == True)
            query = query.order_by(Announcement.published_at.desc()).limit(20)

            result = await db.execute(query)
            announcements = result.scalars().all()

        if not announcements:
            await interaction.response.send_message("No announcements found.")
            return

        lines = []
        for ann in announcements:
            status = "\u2705" if ann.is_active else "\u274c"
            lines.append(f"{status} **#{ann.id}** {ann.title}")

        embed = discord.Embed(
            title="Announcements",
            description="\n".join(lines),
            color=discord.Color.blue(),
        )
        await interaction.response.send_message(embed=embed)

    # ==================== RSS Commands ====================

    @rss_group.command(name="add", description="Add an RSS feed")
    @app_commands.describe(
        name="Display name for this feed",
        url="RSS feed URL",
        keywords="Only include items with these words (comma-separated)",
        exclude_keywords="Exclude items with these words (comma-separated)",
    )
    @is_admin()
    async def add_rss(
        self,
        interaction: discord.Interaction,
        name: str,
        url: str,
        keywords: str | None = None,
        exclude_keywords: str | None = None,
    ):
        async with async_session_maker() as db:
            config = RSSFeedConfig(
                name=name,
                url=url,
                keywords=keywords,
                exclude_keywords=exclude_keywords,
                is_active=True,
            )
            db.add(config)
            await db.commit()
            await db.refresh(config)

        embed = discord.Embed(
            title="RSS Feed Added",
            color=discord.Color.green(),
        )
        embed.add_field(name="ID", value=str(config.id))
        embed.add_field(name="Name", value=name)
        embed.add_field(name="URL", value=url)
        await interaction.response.send_message(embed=embed)

    @rss_group.command(name="update", description="Update an RSS feed")
    @app_commands.describe(
        id="Select feed to edit",
        name="New display name",
        url="New feed URL",
        active="Enable or disable this feed",
    )
    @app_commands.autocomplete(id=rss_feed_autocomplete)
    @is_admin()
    async def update_rss(
        self,
        interaction: discord.Interaction,
        id: int,
        name: str | None = None,
        url: str | None = None,
        active: bool | None = None,
    ):
        async with async_session_maker() as db:
            result = await db.execute(select(RSSFeedConfig).where(RSSFeedConfig.id == id))
            config = result.scalar_one_or_none()

            if not config:
                await interaction.response.send_message(f"RSS config #{id} not found.")
                return

            if name is not None:
                config.name = name
            if url is not None:
                config.url = url
            if active is not None:
                config.is_active = active

            await db.commit()

        await interaction.response.send_message(f"RSS config #{id} updated.")

    @rss_group.command(name="remove", description="Remove an RSS feed")
    @app_commands.describe(id="Select feed to delete")
    @app_commands.autocomplete(id=rss_feed_autocomplete)
    @is_admin()
    async def remove_rss(self, interaction: discord.Interaction, id: int):
        async with async_session_maker() as db:
            result = await db.execute(select(RSSFeedConfig).where(RSSFeedConfig.id == id))
            config = result.scalar_one_or_none()

            if not config:
                await interaction.response.send_message(f"RSS config #{id} not found.")
                return

            await db.delete(config)
            await db.commit()

        await interaction.response.send_message(f"RSS config #{id} removed.")

    @rss_group.command(name="list", description="List all RSS feeds")
    @is_admin()
    async def list_rss(self, interaction: discord.Interaction):
        async with async_session_maker() as db:
            result = await db.execute(select(RSSFeedConfig).order_by(RSSFeedConfig.name))
            configs = result.scalars().all()

        if not configs:
            await interaction.response.send_message("No RSS feeds configured.")
            return

        lines = []
        for config in configs:
            status = "\u2705" if config.is_active else "\u274c"
            lines.append(f"{status} **#{config.id}** {config.name}\n  {config.url}")

        embed = discord.Embed(
            title="RSS Feeds",
            description="\n".join(lines),
            color=discord.Color.blue(),
        )
        await interaction.response.send_message(embed=embed)


async def setup(bot: commands.Bot):
    await bot.add_cog(NewsCog(bot))
