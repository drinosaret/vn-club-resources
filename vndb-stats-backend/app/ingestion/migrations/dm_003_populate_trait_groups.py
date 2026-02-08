"""
Data Migration 003: Populate trait group_name from VNDB parents hierarchy.

The VNDB traits dump uses a hierarchical 'parents' array to indicate trait categories.
This migration traverses the hierarchy to find the root category for each trait
and populates the group_name column for disambiguation.

For example:
- Trait "White" (hair, id=11) → parents: [2] → "Hair Color" → "Hair" (root)
- Trait "White" (eyes, id=117) → parents: [47] → "Eye Color" → "Eyes" (root)

After this migration, the stats page will show badges like "Hair" or "Eyes" next to
trait names to disambiguate them.
"""

import logging
from pathlib import Path

from sqlalchemy import text

from app.db.database import async_session
from app.ingestion.data_migrations import data_migration
from app.ingestion.dump_downloader import load_gzipped_json

logger = logging.getLogger(__name__)


def _get_root_category(trait_id: int, trait_lookup: dict) -> str | None:
    """Traverse parents hierarchy to find the root category name.

    Returns the name of the root trait (one with empty parents array).
    Returns None if trait not found or circular reference detected.
    """
    visited = set()
    current = trait_lookup.get(trait_id)

    while current and current["id"] not in visited:
        visited.add(current["id"])

        # If no parents, this is the root
        if not current.get("parents"):
            return current["name"]

        # Move to first parent
        parent_id = current["parents"][0]
        current = trait_lookup.get(parent_id)

    return None


@data_migration('003', 'Populate trait group_name from VNDB parents hierarchy')
async def populate_trait_groups():
    """Update group_name column for all traits based on their root category."""
    # Check possible paths for traits dump
    possible_paths = [
        Path('/app/data/traits_latest.json.gz'),
        Path('data/traits_latest.json.gz'),
    ]

    traits_path = None
    for path in possible_paths:
        if path.exists():
            traits_path = path
            break

    if traits_path is None:
        raise FileNotFoundError(
            "Traits dump file not found. "
            "Checked paths: " + ", ".join(str(p) for p in possible_paths) + ". "
            "Run 'npm run api:import' first to download VNDB dumps."
        )

    # Load traits dump
    logger.info(f"Loading traits from {traits_path}")
    traits_data = load_gzipped_json(str(traits_path))
    logger.info(f"Loaded {len(traits_data)} traits from dump")

    # Build lookup: id -> trait data
    trait_lookup = {t["id"]: t for t in traits_data}

    # Find root category for each trait
    updates = []
    for trait in traits_data:
        root_name = _get_root_category(trait["id"], trait_lookup)

        # Only set group_name if:
        # 1. We found a root category
        # 2. It's not the trait itself (roots don't need group_name)
        if root_name and root_name != trait["name"]:
            updates.append((trait["id"], root_name))

    logger.info(f"Found {len(updates)} traits to update with group_name")

    if not updates:
        logger.warning("No traits to update")
        return

    # Batch update in chunks
    async with async_session() as db:
        batch_size = 500
        updated = 0

        for i in range(0, len(updates), batch_size):
            batch = updates[i:i + batch_size]

            for trait_id, group_name in batch:
                result = await db.execute(
                    text("""
                        UPDATE traits
                        SET group_name = :group_name
                        WHERE id = :id
                    """),
                    {'id': trait_id, 'group_name': group_name}
                )
                updated += result.rowcount

            await db.commit()

            if (i + batch_size) % 1000 == 0 or (i + batch_size) >= len(updates):
                logger.info(f"Processed {min(i + batch_size, len(updates))}/{len(updates)} traits")

    logger.info(f"Completed: Updated group_name for {updated} traits")
