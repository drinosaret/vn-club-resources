#!/usr/bin/env python3
"""
Fix VN image URLs by using c_image column instead of image column.

The VNDB dump has two image columns:
- image: Original/historical image ID (often outdated)
- c_image: Current/cached image ID (the one actually displayed)

Our importer was incorrectly using 'image', causing 404 errors.
This script updates all VNs to use the correct c_image URLs.
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


async def update_images():
    from app.db.database import async_session
    from sqlalchemy import text

    data_dir = Path("/app/data/extracted/db")
    vn_file = str(data_dir / "vn")

    # Step 1: Read VN dump and build vn_id -> c_image URL mapping
    vn_images: dict[str, str] = {}

    with open(vn_file + ".header", "r") as f:
        fieldnames = f.read().strip().split("\t")

    logger.info(f"VN dump columns: {fieldnames}")

    with open(vn_file, "r") as f:
        reader = csv.DictReader(f, delimiter="\t", fieldnames=fieldnames)
        for row in reader:
            vn_id = row.get("id", "")
            if not vn_id.startswith("v"):
                vn_id = f"v{vn_id}"

            # Use c_image (current/cached image), not image
            # subdir is id % 100 (last 2 digits of image ID)
            image_id = row.get("c_image", "")
            if image_id and image_id != "\\N" and image_id.startswith("cv"):
                try:
                    img_num = int(image_id[2:])
                    subdir = str(img_num % 100).zfill(2)
                    image_url = f"https://t.vndb.org/cv/{subdir}/{img_num}.jpg"
                    vn_images[vn_id] = image_url
                except (ValueError, TypeError):
                    pass

    logger.info(f"Loaded {len(vn_images)} VN image URLs from c_image column")

    # Show some examples
    if "v17" in vn_images:
        logger.info(f"Ever17 (v17) new image: {vn_images['v17']}")
    if "v2002" in vn_images:
        logger.info(f"Steins;Gate (v2002) new image: {vn_images['v2002']}")

    # Step 2: Update all VNs with correct image URLs
    async with async_session() as db:
        count = 0
        for vn_id, image_url in vn_images.items():
            await db.execute(
                text("UPDATE visual_novels SET image_url = :image_url WHERE id = :id"),
                {"id": vn_id, "image_url": image_url},
            )
            count += 1
            if count % 10000 == 0:
                logger.info(f"Updated {count} VNs...")
        await db.commit()
        logger.info(f"Updated {count} VNs total with correct image URLs")

        # Verify some examples
        result = await db.execute(
            text("SELECT id, title, image_url FROM visual_novels WHERE id IN ('v17', 'v2002', 'v7') ORDER BY id")
        )
        rows = result.fetchall()
        for row in rows:
            logger.info(f"After update: {row[0]} ({row[1][:20]}) -> {row[2]}")


if __name__ == "__main__":
    asyncio.run(update_images())
