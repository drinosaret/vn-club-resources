"""
Data Migration 001: Populate title_jp column from VNDB dump.

Reads official Japanese titles from vn_titles dump file and updates
title_jp for all VNs where it's currently NULL or empty.

The vn_titles dump file contains titles in multiple languages. We extract
titles where lang='ja' and official=true, which represents the original
Japanese title (kanji/kana).
"""

import csv
import logging
from pathlib import Path

from sqlalchemy import text

from app.db.database import async_session
from app.ingestion.data_migrations import data_migration

logger = logging.getLogger(__name__)


def _load_jp_titles(titles_file: str) -> dict[str, str]:
    """Load Japanese titles from vn_titles dump file.

    Returns dict mapping vn_id -> japanese_title.
    Only includes official Japanese titles.
    """
    jp_titles: dict[str, str] = {}

    header_file = titles_file + ".header"

    try:
        with open(header_file, "r", encoding="utf-8") as f:
            fieldnames = f.read().strip().split("\t")
        logger.info(f"VN titles fields: {fieldnames}")
    except FileNotFoundError:
        logger.error(f"Titles header file not found: {header_file}")
        return {}

    with open(titles_file, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter="\t", fieldnames=fieldnames)

        for row in reader:
            vn_id = row.get("id", "")
            if not vn_id.startswith("v"):
                vn_id = f"v{vn_id}"

            lang = row.get("lang", "")
            title = row.get("title", "")
            is_official = row.get("official", "f") == "t"

            # Only track official Japanese titles
            if lang == "ja" and is_official and title:
                # Sanitize: remove null bytes
                title = title.replace("\x00", "")
                jp_titles[vn_id] = title

    return jp_titles


@data_migration('001', 'Populate title_jp from vn_titles dump (official Japanese titles)')
async def populate_title_jp():
    """Update title_jp column from VNDB vn_titles dump file."""
    # The vn_titles file is extracted from the db dump tarball
    # Check both possible locations (extracted/ subdirectory and direct db/ path)
    possible_paths = [
        Path('/app/data/extracted/db/vn_titles'),  # Current extraction path
        Path('/app/data/db/vn_titles'),             # Legacy path
    ]

    titles_file = None
    for path in possible_paths:
        if path.exists():
            titles_file = path
            break

    if titles_file is None:
        # Don't silently skip - raise error so migration doesn't mark as complete
        raise FileNotFoundError(
            "VN titles dump file not found. "
            "Checked paths: " + ", ".join(str(p) for p in possible_paths) + ". "
            "Run 'npm run api:import' first to download and extract VNDB dumps."
        )

    # Load Japanese titles from dump
    logger.info(f"Reading Japanese titles from {titles_file}")
    jp_titles = _load_jp_titles(str(titles_file))
    logger.info(f"Found {len(jp_titles)} VNs with official Japanese titles in dump")

    if not jp_titles:
        logger.warning("No Japanese titles found to update")
        return

    # Batch update in chunks
    async with async_session() as db:
        batch_size = 1000
        items = list(jp_titles.items())
        updated = 0

        for i in range(0, len(items), batch_size):
            batch = items[i:i + batch_size]

            for vn_id, title_jp in batch:
                result = await db.execute(
                    text("""
                        UPDATE visual_novels
                        SET title_jp = :title_jp
                        WHERE id = :id AND (title_jp IS NULL OR title_jp = '')
                    """),
                    {'id': vn_id, 'title_jp': title_jp}
                )
                updated += result.rowcount

            await db.commit()

            if (i + batch_size) % 10000 == 0 or (i + batch_size) >= len(items):
                logger.info(f"Processed {min(i + batch_size, len(items))}/{len(items)} VNs, updated {updated} rows")

    logger.info(f"Completed: Updated title_jp for {updated} VNs")
