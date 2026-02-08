#!/usr/bin/env python3
"""
Force update VN minage values from releases table using MAX logic.
"""
import asyncio
import csv
import logging
import sys
from pathlib import Path

# Add app to path
sys.path.insert(0, "/app")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def update_minage():
    from app.db.database import async_session
    from sqlalchemy import text

    data_dir = Path("/app/data/extracted/db")
    releases_file = str(data_dir / "releases")
    releases_vn_file = str(data_dir / "releases_vn")

    # Step 1: Build release_id -> vn_ids mapping
    release_to_vns: dict[str, list[str]] = {}
    with open(releases_vn_file + ".header", "r") as f:
        fieldnames = f.read().strip().split("\t")
    with open(releases_vn_file, "r") as f:
        reader = csv.DictReader(f, delimiter="\t", fieldnames=fieldnames)
        for row in reader:
            release_id = row.get("id", "")
            vn_id = row.get("vid", "")
            if not vn_id.startswith("v"):
                vn_id = f"v{vn_id}"
            if release_id not in release_to_vns:
                release_to_vns[release_id] = []
            release_to_vns[release_id].append(vn_id)

    logger.info(f"Loaded {len(release_to_vns)} release->VN mappings")

    # Step 2: Read releases and compute MAX minage per VN
    vn_minages: dict[str, int] = {}
    with open(releases_file + ".header", "r") as f:
        fieldnames = f.read().strip().split("\t")
    with open(releases_file, "r") as f:
        reader = csv.DictReader(f, delimiter="\t", fieldnames=fieldnames)
        for row in reader:
            release_id = row.get("id", "")
            minage_raw = row.get("minage", "")

            vn_ids = release_to_vns.get(release_id, [])
            if not vn_ids:
                continue

            if minage_raw and minage_raw != "\\N":
                try:
                    minage = int(minage_raw)
                    for vn_id in vn_ids:
                        if vn_id not in vn_minages:
                            vn_minages[vn_id] = minage
                        else:
                            # Use MAX to get strictest age rating
                            vn_minages[vn_id] = max(vn_minages[vn_id], minage)
                except (ValueError, TypeError):
                    pass

    logger.info(f"Computed MAX minage for {len(vn_minages)} VNs")

    # Show some examples
    if "v2002" in vn_minages:
        logger.info(f"Steins;Gate (v2002) max minage: {vn_minages['v2002']}")

    # Step 3: Update all VNs with computed minage
    async with async_session() as db:
        count = 0
        for vn_id, minage in vn_minages.items():
            await db.execute(
                text("UPDATE visual_novels SET minage = :minage WHERE id = :id"),
                {"id": vn_id, "minage": minage},
            )
            count += 1
            if count % 10000 == 0:
                logger.info(f"Updated {count} VNs...")
        await db.commit()
        logger.info(f"Updated {count} VNs total with MAX minage values")

        # Verify Steins;Gate
        result = await db.execute(
            text("SELECT id, minage FROM visual_novels WHERE id = 'v2002'")
        )
        row = result.fetchone()
        if row:
            logger.info(f"After update: Steins;Gate (v2002) minage = {row[1]}")


if __name__ == "__main__":
    asyncio.run(update_minage())
