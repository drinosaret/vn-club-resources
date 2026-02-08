#!/usr/bin/env python
"""
Import only missing/empty tables.

This script is faster than running the full import because it:
1. Checks which tables are empty or need data
2. Only imports those specific tables
3. Uses the already-downloaded dumps (no re-download)

Usage:
    python scripts/import_missing.py
    python scripts/import_missing.py --force  # Force reimport even if tables have data
"""

import asyncio
import argparse
import logging
import os
import sys
from pathlib import Path

# Add app to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import text
from app.config import get_settings
from app.db.database import init_db, async_session
from app.ingestion.dump_downloader import download_dumps
from app.ingestion.importer import (
    import_characters,
    import_character_vns,
    import_character_traits,
    import_seiyuu,
    import_releases,
    import_release_vns,
    import_release_producers,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


# Tables that can be imported independently (with their import functions)
IMPORTABLE_TABLES = {
    "characters": {
        "function": import_characters,
        "dependencies": [],
        "description": "Character data from VNDB",
    },
    "character_vn": {
        "function": import_character_vns,
        "dependencies": ["characters"],
        "description": "Character-VN relationships",
    },
    "character_traits": {
        "function": import_character_traits,
        "dependencies": ["characters"],
        "description": "Character-Trait relationships",
    },
    "vn_seiyuu": {
        "function": import_seiyuu,
        "dependencies": [],
        "description": "VN voice actor credits",
    },
    "releases": {
        "function": import_releases,
        "dependencies": [],
        "description": "Release data from VNDB",
    },
    "release_vn": {
        "function": import_release_vns,
        "dependencies": ["releases"],
        "description": "Release-VN relationships",
    },
    "release_producers": {
        "function": import_release_producers,
        "dependencies": ["releases"],
        "description": "Release-Producer relationships (publishers)",
    },
}


async def get_table_counts() -> dict[str, int]:
    """Get current row counts for all importable tables."""
    counts = {}
    async with async_session() as db:
        for table_name in IMPORTABLE_TABLES:
            result = await db.execute(text(f"SELECT COUNT(*) FROM {table_name}"))
            counts[table_name] = result.scalar() or 0
    return counts


async def import_table(table_name: str, extract_dir: str, force: bool = False):
    """Import a specific table."""
    table_info = IMPORTABLE_TABLES.get(table_name)
    if not table_info:
        logger.error(f"Unknown table: {table_name}")
        return False

    logger.info(f"Importing {table_name}: {table_info['description']}")
    try:
        await table_info["function"](extract_dir, force=force)
        return True
    except Exception as e:
        logger.error(f"Failed to import {table_name}: {e}")
        return False


async def main():
    parser = argparse.ArgumentParser(description="Import missing/empty tables")
    parser.add_argument(
        "--force",
        action="store_true",
        help="Force reimport even if tables have data",
    )
    parser.add_argument(
        "--tables",
        nargs="+",
        choices=list(IMPORTABLE_TABLES.keys()),
        help="Specific tables to import (default: all empty tables)",
    )
    args = parser.parse_args()

    settings = get_settings()

    logger.info("Initializing database...")
    await init_db()

    # Get current table counts
    logger.info("Checking table counts...")
    counts = await get_table_counts()

    # Print current status
    logger.info("Current table status:")
    for table_name, count in counts.items():
        status = "✓" if count > 0 else "✗ EMPTY"
        logger.info(f"  {table_name}: {count:,} rows {status}")

    # Determine which tables to import
    if args.tables:
        tables_to_import = args.tables
    elif args.force:
        tables_to_import = list(IMPORTABLE_TABLES.keys())
    else:
        tables_to_import = [t for t, c in counts.items() if c == 0]

    if not tables_to_import:
        logger.info("All tables have data. Use --force to reimport.")
        return

    logger.info(f"Tables to import: {', '.join(tables_to_import)}")

    # Download dumps (uses cache if already downloaded)
    logger.info(f"Checking dumps in {settings.dump_storage_path}...")
    paths = await download_dumps(settings.dump_storage_path)

    if "db" not in paths:
        logger.error("Database dump not found!")
        return

    extract_dir = os.path.join(settings.dump_storage_path, "extracted")

    # Sort tables by dependencies
    import_order = []
    remaining = set(tables_to_import)

    while remaining:
        # Find tables with no unmet dependencies
        ready = []
        for table in remaining:
            deps = IMPORTABLE_TABLES[table]["dependencies"]
            # A dependency is met if it's already imported OR has data OR is in import_order
            unmet = [
                d for d in deps
                if d in remaining and d not in import_order
            ]
            if not unmet:
                ready.append(table)

        if not ready:
            # Circular dependency or missing dependency
            logger.warning(f"Could not resolve dependencies for: {remaining}")
            ready = list(remaining)

        import_order.extend(sorted(ready))
        remaining -= set(ready)

    logger.info(f"Import order: {' -> '.join(import_order)}")

    # Import tables in order
    success_count = 0
    for table_name in import_order:
        logger.info(f"\n{'='*60}")
        logger.info(f"Importing: {table_name}")
        logger.info(f"{'='*60}")

        success = await import_table(table_name, extract_dir, force=args.force)
        if success:
            success_count += 1

    # Print final status
    logger.info("\n" + "="*60)
    logger.info("Import complete!")
    logger.info(f"Successfully imported: {success_count}/{len(import_order)} tables")

    # Get updated counts
    final_counts = await get_table_counts()
    logger.info("\nFinal table status:")
    for table_name, count in final_counts.items():
        prev_count = counts.get(table_name, 0)
        diff = count - prev_count
        diff_str = f" (+{diff:,})" if diff > 0 else ""
        status = "✓" if count > 0 else "✗ EMPTY"
        logger.info(f"  {table_name}: {count:,} rows{diff_str} {status}")


if __name__ == "__main__":
    asyncio.run(main())
