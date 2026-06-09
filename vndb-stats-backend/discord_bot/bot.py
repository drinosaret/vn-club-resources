"""VN Club admin Discord bot."""

import logging

import discord
from discord.ext import commands

from discord_bot.config import get_bot_settings

logger = logging.getLogger(__name__)

# New consolidated cogs with interactive UI components
COG_EXTENSIONS = [
    "discord_bot.cogs.dashboard",       # /manage_dashboard - system + logs
    "discord_bot.cogs.imports_new",     # /manage_imports - import management
    "discord_bot.cogs.blacklist_new",   # /manage_blacklist - cover blacklist management
    "discord_bot.cogs.news_new",        # /manage_news - news feed management
    "discord_bot.cogs.announcements",   # /manage_announcements - announcement management
    "discord_bot.cogs.events",          # /events (public), /manage_events (admin)
    "discord_bot.cogs.movie_night",     # /movie (public), /manage_movie_night (admin)
    "discord_bot.cogs.vn_of_the_day",  # /manage_vnotd - VN of the Day management
    "discord_bot.cogs.word_of_the_day",  # /manage_wotd - Word of the Day management
    "discord_bot.cogs.settings",       # /manage_settings, /manage_backup, /manage_test_daily
    "discord_bot.cogs.daily_posts",    # Automated daily VOTD + news posts
    "discord_bot.cogs.shared_links",   # /manage_links - shared 3x3/tierlist link management
    "discord_bot.cogs.help",           # /help - public command directory
]

# Legacy cogs (kept for reference, can be removed once new cogs are verified)
# "discord_bot.cogs.imports",
# "discord_bot.cogs.news",
# "discord_bot.cogs.blacklist",
# "discord_bot.cogs.logs",
# "discord_bot.cogs.system",


class VNClubBot(commands.Bot):
    """Discord bot for VN Club admin operations."""

    def __init__(self):
        intents = discord.Intents.default()
        # Slash-command-only bot. when_mentioned (vs a string prefix) silences discord.py's
        # "message content intent missing" warning without enabling that privileged intent.
        super().__init__(command_prefix=commands.when_mentioned, intents=intents)

    async def setup_hook(self):
        """Load cogs and sync commands on startup."""
        from app.db.database import init_db

        await init_db()
        logger.info("Database initialized")

        for ext in COG_EXTENSIONS:
            try:
                await self.load_extension(ext)
                logger.info(f"Loaded cog: {ext}")
            except Exception as e:
                logger.error(f"Failed to load cog {ext}: {e}")

        # Re-attach persistent Movie Night vote views so votes survive restarts
        from discord_bot.views.movie_vote import register_persistent_movie_views

        await register_persistent_movie_views(self)

        # Sync commands - to specific guild if configured, otherwise globally. Wrapped so
        # a transient Discord error during sync doesn't abort setup_hook (the bot keeps the
        # previously-synced command set and a later restart re-syncs).
        settings = get_bot_settings()
        try:
            if settings.guild_id:
                guild = discord.Object(id=settings.guild_id)
                self.tree.copy_global_to(guild=guild)
                synced = await self.tree.sync(guild=guild)
                # Clear any globally-registered commands so they don't appear twice
                # (once global, once guild-scoped) in the configured guild.
                self.tree.clear_commands(guild=None)
                await self.tree.sync()
                logger.info(f"Synced {len(synced)} commands to guild {settings.guild_id} (cleared global)")
            else:
                synced = await self.tree.sync()
                logger.info(f"Synced {len(synced)} commands globally")
        except discord.HTTPException as e:
            logger.error(f"Command sync failed (keeping the existing set; restart to retry): {e}")

    async def on_ready(self):
        logger.info(f"Bot ready: {self.user} (ID: {self.user.id})")
