"""/help - lists Ichijou's member-facing commands, grouped into sections.

Built dynamically from the loaded cogs so it stays in sync: admin commands
(those with @default_permissions(administrator=True)) are excluded. The VN Club's
reading-club features live on the separate Hikaru bot, which the help points to.
"""

import discord
from discord import app_commands
from discord.ext import commands

# Member commands grouped for readability. Any member command not listed here
# still shows up under "Other", so the help never silently drops a command.
_SECTIONS: list[tuple[str, list[str]]] = [
    ("🎬 Movie Night", ["movie", "movie_nominate", "movie_vote"]),
    ("🗓️ Calendar & daily picks", ["events", "vnotd", "wotd", "news"]),
    ("ℹ️ General", ["help"]),
]


def _is_admin(cmd) -> bool:
    perms = getattr(cmd, "default_permissions", None)
    return bool(perms and perms.administrator)


class HelpCog(commands.Cog):
    """Public command directory."""

    def __init__(self, bot: commands.Bot):
        self.bot = bot

    def _member_commands(self) -> list[tuple[str, str]]:
        out: list[tuple[str, str]] = []
        for cog in self.bot.cogs.values():
            for cmd in cog.get_app_commands():
                if isinstance(cmd, app_commands.Group):
                    if _is_admin(cmd):
                        continue
                    for sub in cmd.walk_commands():
                        if isinstance(sub, app_commands.Command) and not _is_admin(sub):
                            out.append((sub.qualified_name, sub.description))
                elif isinstance(cmd, app_commands.Command) and not _is_admin(cmd):
                    out.append((cmd.qualified_name, cmd.description))
        out.sort(key=lambda c: c[0])
        return out

    @app_commands.command(name="help", description="List the Ichijou commands you can use")
    async def help(self, interaction: discord.Interaction):
        cmds = dict(self._member_commands())  # name -> description
        embed = discord.Embed(
            title="📖 Ichijou Commands",
            description="Ichijou handles **Movie Night**, the **events calendar**, and the site's daily picks.",
            color=0x5865F2,
        )

        used: set[str] = set()
        for title, names in _SECTIONS:
            lines = [f"**/{n}**: {cmds[n]}" for n in names if n in cmds]
            used.update(n for n in names if n in cmds)
            if lines:
                embed.add_field(name=title, value="\n".join(lines), inline=False)

        # Any member command not placed in a section above (keeps help complete).
        leftover = [f"**/{n}**: {d}" for n, d in cmds.items() if n not in used]
        if leftover:
            embed.add_field(name="🔹 Other", value="\n".join(leftover), inline=False)

        # The actual VN Club reading-club lives on the Hikaru bot.
        embed.add_field(
            name="🏆 VN of the Month / Season & reading club",
            value=(
                "Nominating and voting on the club's VNs, reading logs, and leaderboards "
                "are on the **Hikaru** bot; see its **/help**."
            ),
            inline=False,
        )
        embed.set_footer(text="Ichijou · VN Club")
        await interaction.response.send_message(embed=embed)


async def setup(bot: commands.Bot):
    await bot.add_cog(HelpCog(bot))
