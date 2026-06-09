"""Entry point for the VN Club Discord admin bot."""

import asyncio
import logging
import logging.handlers
import os
import sys
from pathlib import Path

# Ensure the project root is on the path
sys.path.insert(0, str(Path(__file__).parent.parent))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)

# Mirror the bot's logs to a flat rotating file so the muramasa web console can read
# them the same way it reads hikaru's log. Stdout/webhook logging is unaffected. The
# " - " separated format is what that console's shared log reader parses.
_LOG_FILE = os.environ.get("ICHIJOU_LOG_FILE", "/app/logs/ichijou_bot.log")
try:
    os.makedirs(os.path.dirname(_LOG_FILE), exist_ok=True)
    _file_handler = logging.handlers.RotatingFileHandler(
        _LOG_FILE, maxBytes=5_000_000, backupCount=3, encoding="utf-8"
    )
    _file_handler.setFormatter(
        logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s")
    )
    logging.getLogger().addHandler(_file_handler)
except OSError as _e:
    logging.getLogger(__name__).warning("Could not open log file %s: %s", _LOG_FILE, _e)

# Suppress noisy loggers
logging.getLogger("sqlalchemy").setLevel(logging.WARNING)
logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)
logging.getLogger("discord").setLevel(logging.INFO)
logging.getLogger("discord.gateway").setLevel(logging.WARNING)
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)

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
