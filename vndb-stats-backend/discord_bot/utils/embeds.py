"""Standard embed builders for consistent styling."""

from datetime import datetime

import discord


# Standard colors
class Colors:
    """Standard embed colors."""
    PRIMARY = discord.Color.blue()
    SUCCESS = discord.Color.green()
    ERROR = discord.Color.red()
    WARNING = discord.Color.orange()
    INFO = discord.Color.blurple()


def create_embed(
    title: str,
    description: str | None = None,
    color: discord.Color = Colors.PRIMARY,
    footer_text: str | None = None,
    timestamp: datetime | None = None,
    thumbnail_url: str | None = None,
) -> discord.Embed:
    """Create a consistently styled embed."""
    embed = discord.Embed(
        title=title,
        description=description,
        color=color,
        timestamp=timestamp,
    )
    if footer_text:
        embed.set_footer(text=footer_text)
    if thumbnail_url:
        embed.set_thumbnail(url=thumbnail_url)
    return embed


def create_success_embed(
    title: str,
    description: str | None = None,
) -> discord.Embed:
    """Create a green success embed."""
    return create_embed(
        title=f"\u2705 {title}",
        description=description,
        color=Colors.SUCCESS,
    )


def create_error_embed(
    title: str,
    description: str | None = None,
    suggestion: str | None = None,
) -> discord.Embed:
    """Create a red error embed with optional suggestion."""
    full_description = description or ""
    if suggestion:
        full_description += f"\n\n**Suggestion:** {suggestion}"
    return create_embed(
        title=f"\u274c {title}",
        description=full_description or None,
        color=Colors.ERROR,
    )


def create_warning_embed(
    title: str,
    description: str | None = None,
) -> discord.Embed:
    """Create an orange warning embed."""
    return create_embed(
        title=f"\u26a0\ufe0f {title}",
        description=description,
        color=Colors.WARNING,
    )


def create_progress_embed(
    title: str,
    current: int,
    total: int,
    phase: str | None = None,
    extra_info: str | None = None,
) -> discord.Embed:
    """Create a progress bar embed for long-running operations."""
    percentage = (current / total * 100) if total > 0 else 0
    filled = int(percentage / 5)  # 20 chars total
    bar = "\u2588" * filled + "\u2591" * (20 - filled)

    description_parts = [
        f"**Progress:** `[{bar}]` {percentage:.1f}%",
        f"**Step:** {current}/{total}",
    ]
    if phase:
        description_parts.insert(0, f"**Phase:** {phase}")
    if extra_info:
        description_parts.append(f"\n{extra_info}")

    return create_embed(
        title=f"\u23f3 {title}",
        description="\n".join(description_parts),
        color=Colors.INFO,
    )


def create_stats_embed(
    title: str,
    stats: dict[str, int | str],
    description: str | None = None,
) -> discord.Embed:
    """Create an embed displaying statistics."""
    embed = create_embed(
        title=title,
        description=description,
        color=Colors.PRIMARY,
    )
    for name, value in stats.items():
        embed.add_field(name=name, value=str(value), inline=True)
    return embed


def format_relative_time(dt: datetime) -> str:
    """Format a datetime as relative time (e.g., '2 hours ago')."""
    now = datetime.now(dt.tzinfo)
    diff = now - dt

    seconds = int(diff.total_seconds())
    if seconds < 60:
        return "just now"
    elif seconds < 3600:
        minutes = seconds // 60
        return f"{minutes} minute{'s' if minutes != 1 else ''} ago"
    elif seconds < 86400:
        hours = seconds // 3600
        return f"{hours} hour{'s' if hours != 1 else ''} ago"
    else:
        days = seconds // 86400
        return f"{days} day{'s' if days != 1 else ''} ago"
