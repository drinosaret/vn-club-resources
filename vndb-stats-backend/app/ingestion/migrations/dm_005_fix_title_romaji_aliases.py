"""
Data Migration 005: Fix title_romaji containing concatenated aliases.

dm_002 only caught title_romaji values with Japanese characters.
Some VNs (e.g. v3112 "999") have ALL-romaji aliases stored as title_romaji,
which dm_002 missed because none contain Japanese.

This migration detects title_romaji values with literal \\n separators
(the VNDB alias separator) and extracts just the first clean part.
"""

import logging
import re

from sqlalchemy import text

from app.db.database import async_session
from app.ingestion.data_migrations import data_migration

logger = logging.getLogger(__name__)


@data_migration('005', 'Fix title_romaji containing concatenated aliases (\\n separators)')
async def fix_title_romaji_aliases():
    """Clean up title_romaji values that contain multiple aliases joined by \\n."""

    async with async_session() as db:
        # Find title_romaji values containing literal \n (alias separator)
        result = await db.execute(
            text(r"""
                SELECT id, title_romaji
                FROM visual_novels
                WHERE title_romaji IS NOT NULL
                AND title_romaji LIKE '%\n%'
            """)
        )
        rows = result.fetchall()

        logger.info(f"Found {len(rows)} VNs with \\n in title_romaji")

        fixed = 0
        cleared = 0

        for vn_id, title_romaji in rows:
            # Split on literal \n and take the first clean romanized part
            parts = re.split(r'\\n|\n', title_romaji)
            clean = None
            for part in parts:
                part = part.strip()
                if not part:
                    continue
                # Skip parts with Japanese characters
                if re.search(r'[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf]', part):
                    continue
                # Must have some Latin characters
                latin_chars = len(re.findall(r'[a-zA-Z]', part))
                if latin_chars > 0:
                    clean = part
                    break

            if clean and clean != title_romaji:
                await db.execute(
                    text("UPDATE visual_novels SET title_romaji = :val WHERE id = :id"),
                    {'id': vn_id, 'val': clean}
                )
                fixed += 1
            elif not clean:
                await db.execute(
                    text("UPDATE visual_novels SET title_romaji = NULL WHERE id = :id"),
                    {'id': vn_id}
                )
                cleared += 1

        await db.commit()

        logger.info(f"Completed: Fixed {fixed} title_romaji values, cleared {cleared}")
