"""VN Club admin Discord bot."""

import logging

import discord
from discord.ext import commands

from discord_bot.config import get_bot_settings

logger = logging.getLogger(__name__)

# New consolidated cogs with interactive UI components
COG_EXTENSIONS = [
    "discord_bot.cogs.dashboard",       # /dashboard - combines system + logs
    "discord_bot.cogs.imports_new",     # /imports - import management
    "discord_bot.cogs.blacklist_new",   # /blacklist - cover blacklist management
    "discord_bot.cogs.news_new",        # /news - news feed management
    "discord_bot.cogs.announcements",   # /announcements - announcement management
    "discord_bot.cogs.rss",             # /rss - RSS feed management
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
        # Unused prefix — this bot only uses slash commands
        super().__init__(command_prefix="!", intents=intents)

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

        # Sync commands - to specific guild if configured, otherwise globally
        settings = get_bot_settings()
        if settings.guild_id:
            guild = discord.Object(id=settings.guild_id)
            self.tree.copy_global_to(guild=guild)
            synced = await self.tree.sync(guild=guild)
            logger.info(f"Synced {len(synced)} commands to guild {settings.guild_id}")
        else:
            synced = await self.tree.sync()
            logger.info(f"Synced {len(synced)} commands globally")

    async def on_ready(self):
        logger.info(f"Bot ready: {self.user} (ID: {self.user.id})")
