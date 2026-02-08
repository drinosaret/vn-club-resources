"""Permission checks for Discord bot commands."""

import discord
from discord import app_commands

from discord_bot.config import get_bot_settings


def is_admin():
    """Check if the invoking user is an authorized admin.

    Checks (in order):
    1. User ID is in DISCORD_ADMIN_USER_IDS
    2. User has a role in DISCORD_ADMIN_ROLE_IDS
    3. User has Discord server administrator permission
    """

    async def predicate(interaction: discord.Interaction) -> bool:
        settings = get_bot_settings()

        # Check user ID allowlist
        if interaction.user.id in settings.admin_user_ids:
            return True

        # Check role allowlist
        if isinstance(interaction.user, discord.Member) and settings.admin_role_ids:
            user_role_ids = {role.id for role in interaction.user.roles}
            if user_role_ids & set(settings.admin_role_ids):
                return True

        # Fallback: Discord server administrator
        if isinstance(interaction.user, discord.Member):
            return interaction.user.guild_permissions.administrator

        return False

    return app_commands.check(predicate)
