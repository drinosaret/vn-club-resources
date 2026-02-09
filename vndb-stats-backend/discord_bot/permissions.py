"""Permission checks for Ichijou (Discord bot) commands."""

from discord import app_commands

from discord_bot.config import get_bot_settings


def is_admin():
    """Check if the invoking user is an authorized Ichijou admin.

    Only users whose ID is in DISCORD_ADMIN_USER_IDS can execute commands.
    Commands are still hidden from non-admins via @default_permissions(administrator=True),
    but visibility alone does not grant execution access.
    """

    async def predicate(interaction: app_commands.Interaction) -> bool:
        settings = get_bot_settings()
        return interaction.user.id in settings.admin_user_ids

    return app_commands.check(predicate)
