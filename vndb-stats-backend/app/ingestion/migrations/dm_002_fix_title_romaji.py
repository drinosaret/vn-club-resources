"""
Data Migration 002: Fix title_romaji column - remove garbage alias data.

The title_romaji column was populated from the raw 'alias' field which contains
newline-separated aliases including Japanese text. This migration:
1. Clears title_romaji values that contain Japanese characters (garbage)
2. Extracts the first clean romanized alias if available

This fixes VNs showing garbage like "Mojika\nモジカ\nThe Ugly Duckling\n醜小鴨"
"""

import logging
import re

from sqlalchemy import text

from app.db.database import async_session
from app.ingestion.data_migrations import data_migration

logger = logging.getLogger(__name__)


def has_japanese(text: str) -> bool:
    """Check if text contains Japanese characters."""
    if not text:
        return False
    return bool(re.search(r'[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf]', text))


def get_first_romaji_part(text: str) -> str | None:
    """Extract the first romanized part from a potentially garbage string.

    If the string contains newlines or mixed scripts, try to extract
    just the first clean romanized portion.
    """
    if not text:
        return None

    # Split on common separators (newlines, literal \n)
    parts = re.split(r'\\n|\n|\r', text)

    for part in parts:
        part = part.strip()
        if not part:
            continue

        # Check if this part is mostly Latin characters (romanized)
        if has_japanese(part):
            continue

        latin_chars = len(re.findall(r'[a-zA-Z]', part))
        total_chars = len(re.findall(r'\w', part))

        if total_chars > 0 and latin_chars / total_chars > 0.5:
            return part

    return None


@data_migration('002', 'Fix title_romaji - remove garbage alias data')
async def fix_title_romaji():
    """Clean up title_romaji column by removing garbage data."""

    async with async_session() as db:
        # Find all VNs where title_romaji contains Japanese characters (garbage)
        result = await db.execute(
            text("""
                SELECT id, title_romaji
                FROM visual_novels
                WHERE title_romaji IS NOT NULL
                AND title_romaji != ''
            """)
        )
        rows = result.fetchall()

        logger.info(f"Checking {len(rows)} VNs with title_romaji")

        cleared = 0
        fixed = 0

        for vn_id, title_romaji in rows:
            if has_japanese(title_romaji):
                # Try to extract a clean romanized part
                clean_romaji = get_first_romaji_part(title_romaji)

                if clean_romaji:
                    # Update with clean value
                    await db.execute(
                        text("UPDATE visual_novels SET title_romaji = :val WHERE id = :id"),
                        {'id': vn_id, 'val': clean_romaji}
                    )
                    fixed += 1
                else:
                    # No clean romaji found, clear the field
                    await db.execute(
                        text("UPDATE visual_novels SET title_romaji = NULL WHERE id = :id"),
                        {'id': vn_id}
                    )
                    cleared += 1

        await db.commit()

        logger.info(f"Completed: Fixed {fixed} title_romaji values, cleared {cleared} garbage values")
