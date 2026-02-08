#!/usr/bin/env python
"""
Re-import staff, seiyuu, and release-producer relationships.

Run this to fix empty vn_staff, vn_seiyuu, and release_producers tables.

Usage:
    python scripts/reimport_staff.py
"""

import asyncio
import logging
import os
import sys
from pathlib import Path

# Add app to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.config import get_settings
from app.db.database import init_db
from app.ingestion.importer import (
    import_vn_staff,
    import_seiyuu,
    import_release_producers,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


def check_required_files(extract_dir: str) -> dict[str, str | None]:
    """Check if required files exist in extract directory."""
    required_files = [
        "vn_staff",
        "vn_staff.header",
        "vn_seiyuu",
        "vn_seiyuu.header",
        "staff_alias",
        "staff_alias.header",
        "releases_producers",
        "releases_producers.header",
    ]

    found = {}
    for root, dirs, files in os.walk(extract_dir):
        for f in files:
            if f in required_files:
                found[f] = os.path.join(root, f)

    return found


async def main():
    """Re-import staff/seiyuu/producer relationships with force flag."""
    settings = get_settings()

    logger.info("Initializing database...")
    await init_db()

    extract_dir = str(Path(settings.dump_storage_path) / "extracted")
    logger.info(f"Extract directory: {extract_dir}")

    # Check if extract directory exists
    if not os.path.exists(extract_dir):
        logger.error(f"Extract directory does not exist: {extract_dir}")
        logger.error("Please run: python scripts/initial_import.py first to download and extract dumps")
        return

    # Check for required files
    logger.info("Checking for required files...")
    found_files = check_required_files(extract_dir)

    required = ["vn_staff", "vn_seiyuu", "staff_alias", "releases_producers"]
    missing = [f for f in required if f not in found_files]

    if missing:
        logger.error(f"Missing required files: {missing}")
        logger.info("Files found in extract directory:")
        for name, path in found_files.items():
            logger.info(f"  - {name}: {path}")
        logger.error("The VNDB dump may need to be re-downloaded and extracted.")
        return

    logger.info("All required files found:")
    for name, path in found_files.items():
        logger.info(f"  - {name}: {path}")

    # Force reimport of vn_staff
    logger.info("=" * 50)
    logger.info("Re-importing VN-Staff relationships (force=True)...")
    logger.info("=" * 50)
    await import_vn_staff(extract_dir, force=True)

    # Force reimport of seiyuu
    logger.info("=" * 50)
    logger.info("Re-importing Seiyuu relationships (force=True)...")
    logger.info("=" * 50)
    await import_seiyuu(extract_dir, force=True)

    # Force reimport of release_producers
    logger.info("=" * 50)
    logger.info("Re-importing Release-Producer relationships (force=True)...")
    logger.info("=" * 50)
    await import_release_producers(extract_dir, force=True)

    # Verify results
    logger.info("=" * 50)
    logger.info("Verifying import results...")
    logger.info("=" * 50)

    from sqlalchemy import text
    from app.db.database import async_session_maker

    async with async_session_maker() as db:
        result = await db.execute(text("""
            SELECT
                (SELECT COUNT(*) FROM vn_staff) as vn_staff_count,
                (SELECT COUNT(*) FROM vn_seiyuu) as vn_seiyuu_count,
                (SELECT COUNT(*) FROM release_producers) as release_producers_count
        """))
        counts = result.one()
        logger.info(f"vn_staff: {counts[0]} records")
        logger.info(f"vn_seiyuu: {counts[1]} records")
        logger.info(f"release_producers: {counts[2]} records")

        if counts[0] == 0 or counts[1] == 0 or counts[2] == 0:
            logger.warning("Some tables still have 0 records - check logs above for errors")
        else:
            logger.info("All tables have data!")

    logger.info("=" * 50)
    logger.info("Re-import complete!")
    logger.info("=" * 50)


if __name__ == "__main__":
    asyncio.run(main())
