"""Discord bot configuration."""

import os
from functools import lru_cache


class BotSettings:
    """Bot settings loaded from environment variables."""

    def __init__(self):
        self.token: str = os.environ.get("DISCORD_BOT_TOKEN", "")
        guild_id_str = os.environ.get("DISCORD_GUILD_ID", "").strip()
        self.guild_id: int = int(guild_id_str) if guild_id_str else 0

        # Parse comma-separated ID lists
        role_ids = os.environ.get("DISCORD_ADMIN_ROLE_IDS", "")
        self.admin_role_ids: list[int] = [
            int(x.strip()) for x in role_ids.split(",") if x.strip()
        ]

        user_ids = os.environ.get("DISCORD_ADMIN_USER_IDS", "")
        self.admin_user_ids: list[int] = [
            int(x.strip()) for x in user_ids.split(",") if x.strip()
        ]

        # Frontend cache refresh settings
        self.frontend_url: str = os.environ.get("FRONTEND_URL", "")
        self.blacklist_refresh_secret: str = os.environ.get("BLACKLIST_REFRESH_SECRET", "")


@lru_cache()
def get_bot_settings() -> BotSettings:
    return BotSettings()
