"""VNDB text normalization shared by the bot cogs and the services.

Dependency-free (stdlib re only) so it can be unit-tested and imported from
either side without pulling in discord.py or the DB layer.
"""

import re


def clean_vndb_description(text: str, limit: int = 300) -> str:
    """Convert VNDB BBCode to Discord markdown/plain text for an embed.

    VNDB descriptions use BBCode ([url=...], [spoiler], [b], ...) which Discord
    renders raw. Convert the common tags, drop the rest (without touching literal
    brackets like "[From ...]"), then truncate on a word boundary.
    """
    text = text.replace("\\n", "\n")
    text = re.sub(r"\[url=[^\]]+\](.*?)\[/url\]", r"\1", text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r"\[url\](.*?)\[/url\]", r"\1", text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r"\[spoiler\](.*?)\[/spoiler\]", r"||\1||", text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r"\[b\](.*?)\[/b\]", r"**\1**", text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r"\[i\](.*?)\[/i\]", r"*\1*", text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r"\[u\](.*?)\[/u\]", r"__\1__", text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r"\[s\](.*?)\[/s\]", r"~~\1~~", text, flags=re.DOTALL | re.IGNORECASE)
    # Drop any leftover (unmatched/nested) known tags; leaves literal brackets alone.
    text = re.sub(r"\[/?(?:url(?:=[^\]]*)?|spoiler|b|i|u|s|quote|code|raw)\]", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\n{2,}", "\n\n", text).strip()
    if len(text) > limit:
        text = text[:limit].rsplit(" ", 1)[0].rstrip()
        if text.count("||") % 2:  # don't leak a half-open spoiler
            text = text[: text.rfind("||")].rstrip()
        text += "..."
    return text
