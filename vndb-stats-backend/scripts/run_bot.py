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

    settings = get_bot_settings()

    if not settings.token:
        logger.error("DISCORD_BOT_TOKEN is not set. Cannot start bot.")
        sys.exit(1)

    bot = VNClubBot()
    await bot.start(settings.token)


if __name__ == "__main__":
    asyncio.run(main())
