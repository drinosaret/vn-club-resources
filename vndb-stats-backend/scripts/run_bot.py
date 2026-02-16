"""Entry point for the VN Club Discord admin bot."""

import asyncio
import logging
import sys
from pathlib import Path

# Ensure the project root is on the path
sys.path.insert(0, str(Path(__file__).parent.parent))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)

# Suppress noisy loggers
logging.getLogger("sqlalchemy").setLevel(logging.WARNING)
logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)
logging.getLogger("discord").setLevel(logging.INFO)
logging.getLogger("discord.gateway").setLevel(logging.WARNING)

logger = logging.getLogger(__name__)


async def main():
    from discord_bot.bot import VNClubBot
    from discord_bot.config import get_bot_settings
    from app.config import get_settings
    from app.logging import DiscordWebhookLogHandler

    settings = get_bot_settings()

    if not settings.token:
        logger.error("DISCORD_BOT_TOKEN is not set. Cannot start bot.")
        sys.exit(1)

    # Initialize Discord webhook logging (optional)
    discord_log_handler = None
    app_settings = get_settings()
    if app_settings.discord_log_webhook_url:
        discord_log_handler = DiscordWebhookLogHandler(
            webhook_url=app_settings.discord_log_webhook_url,
            flush_interval=5.0,
        )
        discord_log_handler.setFormatter(
            logging.Formatter("%(asctime)s %(levelname)-7s %(message)s", datefmt="%H:%M:%S")
        )
        discord_log_handler.start()
        logging.getLogger().addHandler(discord_log_handler)
        logger.info("Discord webhook logging enabled for bot")

    bot = VNClubBot()
    try:
        await bot.start(settings.token)
    finally:
        if discord_log_handler:
            discord_log_handler.stop()


if __name__ == "__main__":
    asyncio.run(main())
