"""Automated daily channel posts — VN of the Day and News Summary."""

import logging
import re
from datetime import date, datetime, time, timezone

import discord
from discord import app_commands
from discord.ext import commands, tasks
from sqlalchemy import select, func, and_, cast, Date

from app.core.cache import get_cache
from app.db.database import async_session_maker
from app.db.models import BotConfig, NewsItem
from app.services.vn_of_the_day_service import (
    get_current,
    get_vn_tags,
    get_vn_developers,
    MAX_IMAGE_SEXUAL,
)
from discord_bot.config import get_bot_settings

logger = logging.getLogger(__name__)

# Bot config keys
CONFIG_DAILY_CHANNEL = "daily_channel_id"

# Redis key patterns for duplicate prevention (48-hour TTL)
REDIS_KEY_VOTD = "daily_post:votd:{date}"
REDIS_KEY_NEWS = "daily_post:news:{date}"
REDIS_TTL = 48 * 3600

# Source display labels
SOURCE_LABELS = {
    "vndb": "VNDB New VNs",
    "vndb_release": "VNDB Releases",
    "rss": "RSS Feeds",
    "twitter": "Twitter",
    "announcement": "Announcements",
}

# Source emoji for news embed
SOURCE_EMOJI = {
    "vndb": "\U0001f4d6",         # open book
    "vndb_release": "\U0001f3ae",  # video game
    "rss": "\U0001f4f0",           # newspaper
    "twitter": "\U0001f426",       # bird
    "announcement": "\U0001f4e2",  # loudspeaker
}


class DailyPostsCog(commands.Cog):
    """Automated daily posts to a configured channel."""

    def __init__(self, bot: commands.Bot):
        self.bot = bot
        self._channel_id: int = 0  # Loaded from DB on startup

    async def cog_load(self) -> None:
        await self._load_channel_id()
        self.votd_post_loop.start()
        self.news_post_loop.start()

    async def cog_unload(self) -> None:
        self.votd_post_loop.cancel()
        self.news_post_loop.cancel()

    async def _load_channel_id(self) -> None:
        """Load daily channel ID from bot_config table."""
        try:
            async with async_session_maker() as db:
                result = await db.execute(
                    select(BotConfig.value).where(BotConfig.key == CONFIG_DAILY_CHANNEL)
                )
                row = result.scalar_one_or_none()
                self._channel_id = int(row) if row else 0
        except Exception as e:
            logger.warning(f"Failed to load daily channel config: {e}")
            self._channel_id = 0

    def _get_channel(self) -> discord.TextChannel | None:
        if not self._channel_id:
            return None
        channel = self.bot.get_channel(self._channel_id)
        if channel is None:
            logger.warning(
                f"Daily channel {self._channel_id} not found — "
                "bot may lack access or channel doesn't exist"
            )
        return channel

    # ── VN of the Day ──────────────────────────────────────────

    @tasks.loop(time=time(hour=9, minute=0, tzinfo=timezone.utc))
    async def votd_post_loop(self):
        await self._check_and_post_votd()

    @votd_post_loop.before_loop
    async def before_votd_loop(self):
        await self.bot.wait_until_ready()
        now = datetime.now(timezone.utc)
        if now.hour >= 9:
            await self._check_and_post_votd()

    @votd_post_loop.error
    async def votd_post_error(self, error: Exception):
        logger.error(f"VOTD daily post error: {error}", exc_info=True)

    async def _check_and_post_votd(self, force: bool = False) -> str:
        """Post VOTD embed. Returns status message."""
        today = date.today()
        redis_key = REDIS_KEY_VOTD.format(date=today.isoformat())

        cache = get_cache()
        if not force and await cache.exists(redis_key):
            logger.debug(f"VOTD already posted for {today}, skipping")
            return "VOTD already posted today (skipped)"

        channel = self._get_channel()
        if channel is None:
            return "No daily channel configured"

        async with async_session_maker() as db:
            pick = await get_current(db)
            if not pick or not pick.visual_novel:
                logger.info(f"No VOTD pick for {today}, skipping post")
                return "No VOTD pick for today"
            tags = await get_vn_tags(db, pick.visual_novel.id, limit=5)
            devs = await get_vn_developers(db, pick.visual_novel.id)

        embed, view = self._build_votd_embed(pick, tags, devs, is_daily=True)

        try:
            await channel.send(embed=embed, view=view)
            if not force:
                await cache.set(redis_key, True, ttl=REDIS_TTL)
            logger.info(f"Posted VOTD: {pick.visual_novel.title}")
            return f"Posted VOTD: {pick.visual_novel.title}"
        except discord.Forbidden:
            logger.error(f"Missing permissions to send to channel {channel.id}")
            return "Missing permissions to send to channel"
        except Exception as e:
            logger.error(f"Failed to post VOTD: {e}", exc_info=True)
            return f"Failed: {e}"

    def _build_votd_embed(
        self, pick, tags: list[dict], developers: list[str] | None = None,
        is_daily: bool = False,
    ) -> tuple[discord.Embed, discord.ui.View]:
        vn = pick.visual_novel
        numeric_id = re.sub(r"[^0-9]", "", vn.id)
        settings = get_bot_settings()
        vn_url = f"{settings.frontend_url}/vn/{numeric_id}/"
        vndb_url = f"https://vndb.org/{vn.id}"

        title = vn.title_jp or vn.title
        date_str = pick.date.strftime("%b %d, %Y")
        embed = discord.Embed(
            title=f"VN of the Day — {date_str}: {title}",
            color=0x7C3AED,
        )

        # Description — clean VNDB formatting
        if vn.description:
            desc = vn.description.replace("\\n", "\n")
            desc = re.sub(r"\n{2,}", "\n\n", desc).strip()
            if len(desc) > 300:
                desc = desc[:300].rsplit(" ", 1)[0] + "..."
            embed.description = desc

        if vn.rating and vn.votecount:
            embed.add_field(
                name="Rating",
                value=f"\u2b50 {vn.rating:.2f} ({vn.votecount:,} votes)",
                inline=True,
            )

        if developers:
            embed.add_field(
                name="Developer",
                value=", ".join(developers[:3]),
                inline=True,
            )

        if vn.released:
            embed.add_field(name="Released", value=vn.released.isoformat(), inline=True)

        LENGTH_LABELS = {
            1: "Very Short (< 2h)",
            2: "Short (2-10h)",
            3: "Medium (10-30h)",
            4: "Long (30-50h)",
            5: "Very Long (> 50h)",
        }
        if vn.length and vn.length in LENGTH_LABELS:
            embed.add_field(name="Length", value=LENGTH_LABELS[vn.length], inline=True)

        tag_names = ", ".join(t["name"] for t in tags) if tags else "\u2014"
        embed.add_field(name="Tags", value=tag_names, inline=False)

        if vn.image_url and (vn.image_sexual is None or vn.image_sexual < MAX_IMAGE_SEXUAL):
            embed.set_thumbnail(url=vn.image_url)

        embed.set_footer(text="VN Club \u2022 Daily Spotlight" if is_daily else "VN Club")

        # Button links
        view = discord.ui.View()
        view.add_item(discord.ui.Button(
            label="View on VN Club",
            url=vn_url,
            style=discord.ButtonStyle.link,
        ))
        view.add_item(discord.ui.Button(
            label="View on VNDB",
            url=vndb_url,
            style=discord.ButtonStyle.link,
        ))

        return embed, view

    # ── Daily News Summary ─────────────────────────────────────

    @tasks.loop(time=time(hour=21, minute=0, tzinfo=timezone.utc))
    async def news_post_loop(self):
        await self._check_and_post_news()

    @news_post_loop.before_loop
    async def before_news_loop(self):
        await self.bot.wait_until_ready()
        now = datetime.now(timezone.utc)
        if now.hour >= 21:
            await self._check_and_post_news()

    @news_post_loop.error
    async def news_post_error(self, error: Exception):
        logger.error(f"News daily post error: {error}", exc_info=True)

    async def _check_and_post_news(self, force: bool = False) -> str:
        """Post news summary embed. Returns status message."""
        today = date.today()
        redis_key = REDIS_KEY_NEWS.format(date=today.isoformat())

        cache = get_cache()
        if not force and await cache.exists(redis_key):
            logger.debug(f"News already posted for {today}, skipping")
            return "News already posted today (skipped)"

        channel = self._get_channel()
        if channel is None:
            return "No daily channel configured"

        async with async_session_maker() as db:
            result = await db.execute(
                select(NewsItem.source, func.count(NewsItem.id))
                .where(
                    and_(
                        cast(NewsItem.published_at, Date) == today,
                        NewsItem.is_hidden == False,  # noqa: E712
                    )
                )
                .group_by(NewsItem.source)
            )
            source_counts = {row[0]: row[1] for row in result.all()}

        total = sum(source_counts.values())
        if total == 0:
            logger.info(f"No news items for {today}, skipping post")
            return "No news items for today"

        embed, view = self._build_news_embed(today, source_counts, total, is_daily=True)

        try:
            await channel.send(embed=embed, view=view)
            if not force:
                await cache.set(redis_key, True, ttl=REDIS_TTL)
            logger.info(f"Posted news summary: {total} items")
            return f"Posted news summary: {total} items"
        except discord.Forbidden:
            logger.error(f"Missing permissions to send to channel {channel.id}")
            return "Missing permissions to send to channel"
        except Exception as e:
            logger.error(f"Failed to post news summary: {e}", exc_info=True)
            return f"Failed: {e}"

    def _build_news_embed(
        self, today: date, source_counts: dict[str, int], total: int,
        is_daily: bool = False,
    ) -> tuple[discord.Embed, discord.ui.View]:
        settings = get_bot_settings()
        date_str = today.isoformat()
        news_url = f"{settings.frontend_url}/news/all/{date_str}/"
        icon_url = f"{settings.frontend_url}/assets/hikaru-icon2.webp"

        embed = discord.Embed(
            title=f"\U0001f4f0 Daily News Summary — {today.strftime('%b %d, %Y')}",
            description=f"**{total}** news item{'s' if total != 1 else ''} today",
            color=0x3B82F6,
        )

        lines = []
        for source, count in sorted(source_counts.items(), key=lambda x: x[1], reverse=True):
            emoji = SOURCE_EMOJI.get(source, "\U0001f4cc")
            label = SOURCE_LABELS.get(source, source)
            lines.append(f"{emoji} **{label}**: {count}")

        embed.add_field(name="Sources", value="\n".join(lines), inline=False)
        embed.set_thumbnail(url=icon_url)
        embed.set_footer(text="VN Club \u2022 Daily Spotlight" if is_daily else "VN Club")

        # Button link
        view = discord.ui.View()
        view.add_item(discord.ui.Button(
            label="Read Today's News",
            url=news_url,
            style=discord.ButtonStyle.link,
        ))

        return embed, view

    # ── User Commands ─────────────────────────────────────────

    @app_commands.command(name="getvotd", description="See today's VN of the Day")
    async def getvotd_command(self, interaction: discord.Interaction):
        await interaction.response.defer()

        async with async_session_maker() as db:
            pick = await get_current(db)
            if not pick or not pick.visual_novel:
                await interaction.followup.send(
                    "No VN of the Day has been selected yet today."
                )
                return
            tags = await get_vn_tags(db, pick.visual_novel.id, limit=5)
            devs = await get_vn_developers(db, pick.visual_novel.id)

        embed, view = self._build_votd_embed(pick, tags, devs)
        await interaction.followup.send(embed=embed, view=view)

    @app_commands.command(name="getnews", description="See today's news summary")
    async def getnews_command(self, interaction: discord.Interaction):
        await interaction.response.defer()

        today = date.today()
        async with async_session_maker() as db:
            result = await db.execute(
                select(NewsItem.source, func.count(NewsItem.id))
                .where(
                    and_(
                        cast(NewsItem.published_at, Date) == today,
                        NewsItem.is_hidden == False,  # noqa: E712
                    )
                )
                .group_by(NewsItem.source)
            )
            source_counts = {row[0]: row[1] for row in result.all()}

        total = sum(source_counts.values())
        if total == 0:
            await interaction.followup.send("No news items yet today.")
            return

        embed, view = self._build_news_embed(today, source_counts, total)
        await interaction.followup.send(embed=embed, view=view)


async def setup(bot: commands.Bot):
    await bot.add_cog(DailyPostsCog(bot))
