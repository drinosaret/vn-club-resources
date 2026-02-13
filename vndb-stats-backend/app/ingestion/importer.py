"""
Import VNDB dump data into PostgreSQL.

============================================================================
THIS IS THE PRIMARY DATA SOURCE FOR THE ENTIRE APPLICATION
============================================================================
This module imports VNDB's official daily database dumps into our local
PostgreSQL database. This data is the AUTHORITATIVE source for:
- Visual novel metadata (titles, descriptions, ratings, images, etc.)
- Tags and tag relationships
- Traits and character data
- Staff, producers, and seiyuu information
- Release information
- User votes (for statistics and recommendations)

The import runs daily via the scheduler (see scheduler.py) and populates
40k+ visual novels with complete metadata.

>>> ALWAYS USE THIS LOCAL DATA instead of querying the VNDB API <<<

The only exceptions where VNDB API should be used:
- Fetching a user's current VN list (real-time data)
- Looking up a username to get their UID

For everything else, query the local PostgreSQL database via:
- app/db/models.py (SQLAlchemy ORM models)
- app/services/ (service layer with business logic)

Data flow: VNDB Dumps (dl.vndb.org) → This Importer → PostgreSQL → App
============================================================================
"""

import asyncio
import csv
import logging
import os
from datetime import datetime, date
from io import StringIO
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.dialects.postgresql import insert

from app.db.database import async_session, async_session_maker, engine
from app.db.models import (
    VisualNovel, Tag, VNTag, GlobalVote,
    Producer, Staff, VNStaff, VNSeiyuu, VNRelation,
    Trait, Character, CharacterVN, CharacterTrait,
    Release, ReleaseVN, ReleaseProducer,
    ReleasePlatform, ReleaseMedia, ReleaseExtlink,
    SystemMetadata, ImportRun, ImportLog,
    UlistVN, UlistLabel,  # User list data from dumps
    TagParent, TraitParent,  # Multi-parent junction tables
)
from app.ingestion.dump_downloader import (
    load_gzipped_json,
    iter_gzipped_lines,
    decompress_zstd_tar,
)

logger = logging.getLogger(__name__)


def sanitize_text(text: str | None) -> str:
    """Sanitize text for PostgreSQL by removing null bytes and other problematic chars."""
    if not text:
        return ""
    # Remove null bytes which cause PostgreSQL errors
    return text.replace("\x00", "")


def get_first_romaji_alias(alias_field: str | None) -> str | None:
    """Extract the first romanized (Latin-script) alias from a newline-separated alias field.

    The VNDB alias field contains multiple aliases separated by newlines.
    We only want to use aliases that are romanized (mostly Latin characters).
    """
    if not alias_field:
        return None

    import re

    for alias in alias_field.split("\n"):
        alias = alias.strip()
        if not alias:
            continue
        # Check if the alias is mostly Latin characters (romanized)
        # Allow some punctuation and numbers, but majority should be Latin letters
        latin_chars = len(re.findall(r'[a-zA-Z]', alias))
        total_letters = len(re.findall(r'\w', alias))
        if total_letters > 0 and latin_chars / total_letters > 0.5:
            return alias

    return None


async def copy_bulk_data(table_name: str, columns: list[str], rows: list[tuple]):
    """Use PostgreSQL COPY for fast bulk loading.

    COPY is 10-100x faster than INSERT for large datasets and has no parameter limits.
    Includes timeout protection to prevent silent hangs.

    Args:
        table_name: Target table name
        columns: List of column names
        rows: List of tuples, each tuple is a row of values
    """
    if not rows:
        return 0

    # Build tab-separated data in memory as bytes (asyncpg requires bytes)
    lines = []
    for row in rows:
        escaped = []
        for val in row:
            if val is None:
                escaped.append("\\N")
            elif isinstance(val, bool):
                escaped.append("t" if val else "f")
            elif isinstance(val, (date, datetime)):
                escaped.append(str(val))
            else:
                # Escape special characters for COPY format
                s = str(val).replace("\\", "\\\\").replace("\t", " ").replace("\n", " ").replace("\r", " ")
                escaped.append(s)
        lines.append("\t".join(escaped))

    data = "\n".join(lines) + "\n"
    data_bytes = data.encode("utf-8")

    # Use raw asyncpg connection for COPY with timeout protection
    try:
        async with asyncio.timeout(300):  # 5 minute timeout for COPY operations
            async with engine.begin() as conn:
                raw_conn = await conn.get_raw_connection()
                # Get the actual asyncpg connection from SQLAlchemy's adapter
                asyncpg_conn = raw_conn.driver_connection
                # asyncpg's copy_to_table expects bytes
                from io import BytesIO
                await asyncpg_conn.copy_to_table(
                    table_name,
                    source=BytesIO(data_bytes),
                    columns=columns,
                    format="text",
                )
    except asyncio.TimeoutError:
        logger.error(f"Timeout during COPY to {table_name} ({len(rows)} rows)")
        raise
    except Exception as e:
        logger.error(f"Error during COPY to {table_name}: {e}")
        raise

    return len(rows)


async def set_import_progress(table_name: str, processed: int):
    """Save progress for resumable imports."""
    async with async_session() as db:
        await db.execute(
            text("INSERT INTO system_metadata (key, value) VALUES (:k, :v) "
                 "ON CONFLICT (key) DO UPDATE SET value = :v"),
            {"k": f"import_progress:{table_name}", "v": str(processed)}
        )
        await db.commit()


async def get_import_progress(table_name: str) -> int:
    """Get last processed count for resume."""
    async with async_session() as db:
        result = await db.execute(
            text("SELECT value FROM system_metadata WHERE key = :k"),
            {"k": f"import_progress:{table_name}"}
        )
        row = result.one_or_none()
        return int(row[0]) if row else 0


async def clear_import_progress(table_name: str):
    """Clear progress tracking for a table."""
    async with async_session() as db:
        await db.execute(
            text("DELETE FROM system_metadata WHERE key = :k"),
            {"k": f"import_progress:{table_name}"}
        )
        await db.commit()


def _find_staff_alias_file(extract_dir: str) -> str | None:
    """Find the staff_alias file in extracted directory."""
    for root, dirs, files in os.walk(extract_dir):
        for f in files:
            if f == "staff_alias":
                return os.path.join(root, f)
    return None


def _load_staff_name_aliases(staff_alias_file: str | None) -> dict[str, tuple[str, str | None]]:
    """Load staff aliases for name resolution.

    Returns dict mapping staff_id -> (name, original) for staff name resolution.
    Used by import_staff() to get the primary name for each staff member.
    """
    aliases = {}
    if not staff_alias_file:
        return aliases

    alias_header_file = staff_alias_file + ".header"
    try:
        with open(alias_header_file, "r", encoding="utf-8") as f:
            alias_fieldnames = f.read().strip().split("\t")
        logger.info(f"Staff alias fields: {alias_fieldnames}")

        with open(staff_alias_file, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f, delimiter="\t", fieldnames=alias_fieldnames, quoting=csv.QUOTE_NONE)
            for row in reader:
                staff_id = row.get("id", "")
                if not staff_id.startswith("s"):
                    staff_id = f"s{staff_id}"

                aid = row.get("aid", "0")
                name = sanitize_text(row.get("name", ""))
                original = sanitize_text(row.get("latin")) if row.get("latin") != "\\N" else None

                # Store alias, prefer aid=0 (primary alias)
                if staff_id not in aliases or aid == "0":
                    aliases[staff_id] = (name, original)

    except FileNotFoundError:
        logger.warning(f"Staff alias header not found: {alias_header_file}")

    logger.info(f"Loaded {len(aliases)} staff name aliases")
    return aliases


def _load_aid_to_staff_mapping(staff_alias_file: str | None) -> dict[str, str]:
    """Load aid -> staff_id mapping from staff_alias table.

    Returns dict mapping aid (alias ID) -> staff_id.
    Used by import_vn_staff() and import_seiyuu() to resolve alias IDs.
    """
    aid_to_staff_id = {}
    if not staff_alias_file:
        return aid_to_staff_id

    alias_header_file = staff_alias_file + ".header"
    try:
        with open(alias_header_file, "r", encoding="utf-8") as f:
            alias_fieldnames = f.read().strip().split("\t")
        logger.info(f"Staff alias fields: {alias_fieldnames}")

        with open(staff_alias_file, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f, delimiter="\t", fieldnames=alias_fieldnames, quoting=csv.QUOTE_NONE)
            for row in reader:
                staff_id = row.get("id", "")
                if not staff_id.startswith("s"):
                    staff_id = f"s{staff_id}"
                aid = row.get("aid", "")
                if aid and aid != "\\N":
                    aid_to_staff_id[aid] = staff_id
        logger.info(f"Loaded {len(aid_to_staff_id)} aid->staff_id mappings")
    except FileNotFoundError:
        logger.warning(f"Staff alias file not found: {alias_header_file}")

    return aid_to_staff_id


async def _get_last_import_mtime(table_name: str) -> float | None:
    """Get the source file mtime from the last import of a table."""
    async with async_session() as db:
        result = await db.execute(
            text("SELECT value FROM system_metadata WHERE key = :key"),
            {"key": f"import_mtime:{table_name}"}
        )
        row = result.one_or_none()
        if row and row[0]:
            try:
                return float(row[0])
            except ValueError:
                return None
        return None


async def _set_last_import_mtime(table_name: str, mtime: float):
    """Store the source file mtime after a successful import."""
    async with async_session() as db:
        stmt = insert(SystemMetadata).values(
            key=f"import_mtime:{table_name}",
            value=str(mtime)
        )
        stmt = stmt.on_conflict_do_update(
            index_elements=["key"],
            set_={"value": str(mtime)}
        )
        await db.execute(stmt)
        await db.commit()


async def should_import(source_path: str, table_name: str, force: bool = False) -> bool:
    """Check if an import should proceed based on file modification time.

    Returns True if:
    - force=True
    - Source file doesn't exist (error case, handled by caller)
    - No previous import recorded
    - Source file is newer than last import
    - Target table is empty (import failed previously or was truncated)
    - Source file is OLDER than last import (file was replaced with different version)

    Returns False if source file hasn't changed since last import AND table has data.
    """
    if force:
        logger.info(f"Forced import for {table_name}")
        return True

    if not os.path.exists(source_path):
        return True  # Let the import function handle the missing file

    current_mtime = os.path.getmtime(source_path)
    last_mtime = await _get_last_import_mtime(table_name)

    if last_mtime is None:
        logger.info(f"No previous import recorded for {table_name}, proceeding")
        return True

    if current_mtime > last_mtime:
        logger.info(f"Source file for {table_name} has changed, proceeding with import")
        return True

    # File mtime unchanged or older - check if table actually has data
    # This handles cases where import failed, was incomplete, or dumps were re-downloaded
    if table_name in IMPORT_TABLES:
        try:
            async with async_session() as db:
                result = await db.execute(text(f"SELECT COUNT(*) FROM {table_name}"))
                count = result.scalar() or 0
                if count == 0:
                    logger.warning(
                        f"Table {table_name} is empty despite import being marked complete - "
                        f"proceeding with import (file may have been replaced)"
                    )
                    return True
        except Exception as e:
            logger.debug(f"Could not check table count for {table_name}: {e}")

    logger.info(f"Skipping {table_name} import - source file unchanged (mtime: {current_mtime})")
    return False


async def mark_import_complete(source_path: str, table_name: str):
    """Mark an import as complete by storing the source file mtime."""
    if os.path.exists(source_path):
        mtime = os.path.getmtime(source_path)
        await _set_last_import_mtime(table_name, mtime)
        logger.info(f"Marked {table_name} import complete (mtime: {mtime})")


# ============ Index Management for Fast Imports ============

# Tables that are imported from VNDB dumps (not caches or computed tables)
IMPORT_TABLES = [
    'visual_novels', 'tags', 'vn_tags', 'global_votes',
    'producers', 'staff', 'vn_staff', 'vn_seiyuu', 'vn_relations',
    'traits', 'characters', 'character_vn', 'character_traits',
    'releases', 'release_vn', 'release_producers',
    'release_platforms', 'release_media', 'release_extlinks',
]


async def get_import_table_indexes() -> dict[str, list[tuple[str, str]]]:
    """Get all non-primary-key indexes for import tables.

    Returns dict mapping table_name -> [(index_name, create_statement), ...]
    Used to drop indexes before import and recreate them after.
    """
    async with async_session() as db:
        # Query pg_indexes for non-PK indexes on import tables
        result = await db.execute(text("""
            SELECT tablename, indexname, indexdef
            FROM pg_indexes
            WHERE schemaname = 'public'
              AND tablename = ANY(:tables)
              AND indexname NOT LIKE '%_pkey'
            ORDER BY tablename, indexname
        """), {"tables": IMPORT_TABLES})

        indexes: dict[str, list[tuple[str, str]]] = {}
        for row in result:
            table = row[0]
            if table not in indexes:
                indexes[table] = []
            indexes[table].append((row[1], row[2]))

        total_count = sum(len(idx_list) for idx_list in indexes.values())
        logger.info(f"Found {total_count} non-PK indexes across {len(indexes)} tables")
        return indexes


async def drop_import_indexes() -> dict[str, list[str]]:
    """Drop all non-PK indexes on import tables for faster bulk loading.

    Returns dict mapping table_name -> [create_statement, ...] for recreation.
    Indexes are dropped to avoid update overhead during import.
    """
    indexes = await get_import_table_indexes()
    dropped: dict[str, list[str]] = {}

    async with engine.begin() as conn:
        for table, index_list in indexes.items():
            dropped[table] = []
            for index_name, create_stmt in index_list:
                await conn.execute(text(f"DROP INDEX IF EXISTS {index_name}"))
                dropped[table].append(create_stmt)
                logger.info(f"Dropped index: {index_name}")

    total_dropped = sum(len(stmts) for stmts in dropped.values())
    logger.info(f"Dropped {total_dropped} indexes total")
    return dropped


async def recreate_import_indexes(dropped_indexes: dict[str, list[str]]):
    """Recreate all dropped indexes with optimized settings.

    Uses increased maintenance_work_mem for faster index creation.
    Should be called after all imports are complete.
    """
    total_count = sum(len(stmts) for stmts in dropped_indexes.values())
    logger.info(f"Recreating {total_count} indexes...")

    async with engine.begin() as conn:
        # Increase maintenance_work_mem for faster index creation
        await conn.execute(text("SET maintenance_work_mem = '512MB'"))

        created = 0
        for table, create_stmts in dropped_indexes.items():
            for create_stmt in create_stmts:
                # Extract index name for logging (CREATE INDEX idx_name ON ...)
                idx_name = create_stmt.split()[2] if len(create_stmt.split()) > 2 else "unknown"
                logger.info(f"Creating index ({created + 1}/{total_count}): {idx_name}")
                await conn.execute(text(create_stmt))
                created += 1

        # Reset to default
        await conn.execute(text("RESET maintenance_work_mem"))

    logger.info(f"Recreated {created} indexes")


async def analyze_import_tables():
    """Run ANALYZE on all import tables to update query planner statistics.

    Should be called after import and index recreation to ensure
    PostgreSQL has accurate statistics for query optimization.
    """
    logger.info(f"Running ANALYZE on {len(IMPORT_TABLES)} tables...")

    async with engine.begin() as conn:
        for table in IMPORT_TABLES:
            logger.info(f"Analyzing {table}...")
            await conn.execute(text(f"ANALYZE {table}"))

    logger.info("ANALYZE complete on all import tables")


async def import_tags(tags_path: str, force: bool = False):
    """Import tags from vndb-tags-latest.json.gz.

    Uses two-pass import to handle self-referential parent_id foreign key:
    1. First pass: insert all tags without parent_id
    2. Second pass: update parent_id references

    Args:
        tags_path: Path to the tags JSON file
        force: If True, import regardless of file modification time
    """
    # Check if import is needed
    if not await should_import(tags_path, "tags", force):
        return

    logger.info(f"Importing tags from {tags_path}")

    tags_data = load_gzipped_json(tags_path)

    # Store parent relationships for second pass
    parent_map = {}  # tag_id -> primary parent_id (first parent)
    all_parent_pairs = []  # (tag_id, parent_id) for junction table

    async with async_session() as db:
        # First pass: insert tags without parent_id
        batch = []
        for tag in tags_data:
            parents = tag.get("parents", [])
            primary_parent = parents[0] if parents else None
            if primary_parent:
                parent_map[tag["id"]] = primary_parent

            # Collect ALL parent relationships for junction table
            for pid in parents:
                all_parent_pairs.append({"tag_id": tag["id"], "parent_id": pid})

            batch.append({
                "id": tag["id"],
                "name": sanitize_text(tag["name"]),
                "description": sanitize_text(tag.get("description", "")),
                "category": tag.get("cat"),
                "aliases": tag.get("aliases", []),
                "parent_id": None,  # Set to None initially
                "searchable": tag.get("searchable", True),
                "applicable": tag.get("applicable", True),
                "vn_count": tag.get("vns", 0),
            })

            if len(batch) >= 100:
                await _upsert_tags(db, batch)
                batch = []

        if batch:
            await _upsert_tags(db, batch)

        await db.commit()
        logger.info(f"Inserted {len(tags_data)} tags, updating parent relationships...")

        # Second pass: update parent_id relationships (primary parent)
        for tag_id, parent_id in parent_map.items():
            await db.execute(
                text("UPDATE tags SET parent_id = :parent_id WHERE id = :id"),
                {"id": tag_id, "parent_id": parent_id}
            )

        await db.commit()

        # Third pass: populate tag_parents junction table (all parents)
        await db.execute(text("DELETE FROM tag_parents"))
        if all_parent_pairs:
            for i in range(0, len(all_parent_pairs), 1000):
                chunk = all_parent_pairs[i:i + 1000]
                stmt = insert(TagParent).values(chunk)
                stmt = stmt.on_conflict_do_nothing()
                await db.execute(stmt)
            await db.commit()

    logger.info(
        f"Imported {len(tags_data)} tags with {len(parent_map)} primary parents "
        f"and {len(all_parent_pairs)} total parent relationships"
    )

    # Mark import as complete
    await mark_import_complete(tags_path, "tags")


async def _upsert_tags(db: AsyncSession, batch: list[dict]):
    """Upsert a batch of tags."""
    stmt = insert(Tag).values(batch)
    stmt = stmt.on_conflict_do_update(
        index_elements=["id"],
        set_={
            "name": stmt.excluded.name,
            "description": stmt.excluded.description,
            "category": stmt.excluded.category,
            "aliases": stmt.excluded.aliases,
            "parent_id": stmt.excluded.parent_id,
            "searchable": stmt.excluded.searchable,
            "applicable": stmt.excluded.applicable,
            "vn_count": stmt.excluded.vn_count,
        }
    )
    await db.execute(stmt)


async def import_votes(votes_path: str, force: bool = False):
    """Import votes from vndb-votes-latest.gz.

    Uses PostgreSQL COPY for fast bulk loading (10-50x faster than INSERT).

    Args:
        votes_path: Path to the votes file
        force: If True, import regardless of file modification time
    """
    # Check if import is needed
    if not await should_import(votes_path, "votes", force):
        return

    logger.info(f"Importing votes from {votes_path}")

    # Get set of valid VN IDs from database
    async with async_session() as db:
        result = await db.execute(text("SELECT id FROM visual_novels"))
        valid_vn_ids = {row[0] for row in result}
    logger.info(f"Found {len(valid_vn_ids)} VNs in database for vote filtering")

    # Clear existing votes (they're replaced daily)
    async with async_session() as db:
        await db.execute(text("TRUNCATE TABLE global_votes"))
        await db.commit()

    count = 0
    skipped = 0
    batch: list[tuple] = []  # Use tuples for COPY
    BATCH_SIZE = 10000  # Much larger batch size for COPY (was 100)

    for line in iter_gzipped_lines(votes_path):
        if not line or line.startswith("#"):
            continue

        parts = line.split()
        if len(parts) < 3:
            continue

        try:
            vn_id = parts[0]
            # Add 'v' prefix if missing
            if not vn_id.startswith("v"):
                vn_id = f"v{vn_id}"

            # Filter out votes for non-existent VNs
            if vn_id not in valid_vn_ids:
                skipped += 1
                continue

            user_hash = parts[1]
            vote = int(parts[2])
            vote_date = parts[3] if len(parts) > 3 else None

            # Handle VNDB's null marker
            if vote_date == "\\N":
                vote_date = None

            # Use tuple for COPY format (vn_id, user_hash, vote, date)
            batch.append((
                vn_id,
                user_hash,
                vote,
                date.fromisoformat(vote_date) if vote_date else None,
            ))
            count += 1

            if len(batch) >= BATCH_SIZE:
                await copy_bulk_data(
                    "global_votes",
                    ["vn_id", "user_hash", "vote", "date"],
                    batch
                )
                batch = []

                if count % 500000 == 0:  # Log less frequently with larger batches
                    logger.info(f"Imported {count} votes (skipped {skipped} for non-existent VNs)...")

        except (ValueError, IndexError) as e:
            logger.debug(f"Skipping invalid vote line: {line}")
            continue

    # Final batch
    if batch:
        await copy_bulk_data(
            "global_votes",
            ["vn_id", "user_hash", "vote", "date"],
            batch
        )

    logger.info(f"Imported {count} votes (skipped {skipped} for non-existent VNs)")

    # Mark import as complete
    await mark_import_complete(votes_path, "votes")


async def import_length_votes(extract_dir: str, force: bool = False):
    """Import length votes from vn_length_votes and compute length_minutes averages.

    The vn_length_votes table contains user-submitted playtime estimates in minutes.
    This function aggregates those votes and stores the average in visual_novels.length_minutes.

    This matches VNDB website behavior where length filtering uses the vote-based
    average (length_minutes) rather than the legacy length category field.

    vn_length_votes fields: vid, uid, date, length (minutes), speed, rid, notes, lang

    Args:
        extract_dir: Directory with extracted dump files
        force: If True, import regardless of file modification time
    """
    length_votes_file = None

    for root, dirs, files in os.walk(extract_dir):
        for f in files:
            if f == "vn_length_votes":
                length_votes_file = os.path.join(root, f)

    if not length_votes_file:
        logger.warning("vn_length_votes file not found in extracted files")
        return

    # Check if import is needed
    if not await should_import(length_votes_file, "length_votes", force):
        return

    logger.info(f"Importing length votes from {length_votes_file}")

    # Read header to get field positions
    header_file = length_votes_file + ".header"
    try:
        with open(header_file, "r", encoding="utf-8") as f:
            fieldnames = f.read().strip().split("\t")
        logger.info(f"Length votes fields: {fieldnames}")
    except FileNotFoundError:
        logger.error(f"Length votes header not found: {header_file}")
        return

    # Get valid VN IDs from database
    async with async_session() as db:
        result = await db.execute(text("SELECT id FROM visual_novels"))
        valid_vn_ids = {row[0] for row in result}
    logger.info(f"Found {len(valid_vn_ids)} VNs in database for length vote filtering")

    # Read all votes and aggregate by VN ID
    vn_lengths: dict[str, list[int]] = {}
    count = 0
    skipped = 0

    with open(length_votes_file, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter="\t", fieldnames=fieldnames, quoting=csv.QUOTE_NONE)

        for row in reader:
            try:
                vid = row.get("vid", "")
                if not vid.startswith("v"):
                    vid = f"v{vid}"

                # Skip votes for non-existent VNs
                if vid not in valid_vn_ids:
                    skipped += 1
                    continue

                # Get length in minutes (field name is "length")
                length_str = row.get("length", "")
                if length_str == "\\N" or not length_str:
                    skipped += 1
                    continue

                length_minutes = int(length_str)
                if length_minutes <= 0:
                    skipped += 1
                    continue

                vn_lengths.setdefault(vid, []).append(length_minutes)
                count += 1

            except (ValueError, KeyError) as e:
                logger.debug(f"Skipping invalid length vote row: {row}")
                skipped += 1
                continue

    logger.info(f"Read {count} length votes for {len(vn_lengths)} VNs (skipped {skipped})")

    # Calculate averages and update VNs in batches
    update_count = 0
    BATCH_SIZE = 1000

    async with async_session() as db:
        batch_updates = []

        for vid, lengths in vn_lengths.items():
            # Calculate average (integer)
            avg_minutes = sum(lengths) // len(lengths)
            batch_updates.append({"vid": vid, "avg": avg_minutes})

            if len(batch_updates) >= BATCH_SIZE:
                # Batch update using executemany pattern
                await db.execute(
                    text("UPDATE visual_novels SET length_minutes = :avg WHERE id = :vid"),
                    batch_updates
                )
                update_count += len(batch_updates)
                batch_updates = []

                if update_count % 10000 == 0:
                    logger.info(f"Updated {update_count} VNs with length_minutes...")

        # Final batch
        if batch_updates:
            await db.execute(
                text("UPDATE visual_novels SET length_minutes = :avg WHERE id = :vid"),
                batch_updates
            )
            update_count += len(batch_updates)

        await db.commit()

    logger.info(f"Updated {update_count} VNs with length_minutes averages")

    # Mark import as complete
    await mark_import_complete(length_votes_file, "length_votes")


async def compute_average_ratings():
    """Fallback: compute average ratings from global_votes for VNs missing c_average.

    The primary source is c_average from the VNDB dump (includes hidden votes).
    This function is a fallback for any VNs where c_average wasn't available,
    computing from the public votes in global_votes table.
    """
    logger.info("Computing fallback average ratings from global_votes...")

    async with async_session_maker() as session:
        # Only update VNs that don't already have average_rating (from c_average)
        # Note: votes are stored as 10-100 in global_votes, we convert to 1.0-10.0 scale
        result = await session.execute(text("""
            UPDATE visual_novels v
            SET average_rating = subq.avg_rating
            FROM (
                SELECT vn_id, AVG(vote) / 10.0 as avg_rating
                FROM global_votes
                GROUP BY vn_id
            ) subq
            WHERE v.id = subq.vn_id
              AND v.average_rating IS NULL
        """))
        await session.commit()

        # Count how many VNs have average_rating now
        count_result = await session.execute(text(
            "SELECT COUNT(*) FROM visual_novels WHERE average_rating IS NOT NULL"
        ))
        total_with_rating = count_result.scalar_one()

        # Count how many were just updated (fallback)
        fallback_result = await session.execute(text("""
            SELECT COUNT(*)
            FROM visual_novels v
            JOIN global_votes g ON v.id = g.vn_id
            WHERE v.average_rating IS NOT NULL
            GROUP BY v.id
            HAVING COUNT(*) > 0
        """))
        # Simpler: just report total
        logger.info(f"Total VNs with average_rating: {total_with_rating}")


async def import_visual_novels(db_dump_path: str, extract_dir: str, force: bool = False):
    """Import VN data from the database dump.

    Args:
        db_dump_path: Path to the database dump file
        extract_dir: Directory to extract files to
        force: If True, import regardless of file modification time
    """
    # Check if import is needed
    if not await should_import(db_dump_path, "visual_novels", force):
        return

    logger.info(f"Importing VNs from {db_dump_path}")

    # Extract the tar.zst file
    extracted = decompress_zstd_tar(db_dump_path, extract_dir)
    logger.info(f"Extracted {len(extracted)} files")

    # Find the table files
    vn_file = None
    vn_titles_file = None
    vn_tags_file = None
    releases_file = None
    releases_vn_file = None
    images_file = None

    for f in extracted:
        # Normalize path separators for cross-platform compatibility
        f_normalized = f.replace("\\", "/")
        if f_normalized.endswith("/db/vn") or f_normalized.endswith("/vn"):
            vn_file = f
            logger.info(f"Found vn file: {f}")
        elif f_normalized.endswith("/db/vn_titles") or f_normalized.endswith("/vn_titles"):
            vn_titles_file = f
            logger.info(f"Found vn_titles file: {f}")
        elif f_normalized.endswith("/db/tags_vn") or f_normalized.endswith("/tags_vn"):
            vn_tags_file = f
            logger.info(f"Found tags_vn file: {f}")
        elif f_normalized.endswith("/db/releases") or os.path.basename(f) == "releases":
            releases_file = f
            logger.info(f"Found releases file: {f}")
        elif f_normalized.endswith("/db/releases_vn") or f_normalized.endswith("/releases_vn"):
            releases_vn_file = f
            logger.info(f"Found releases_vn file: {f}")
        elif f_normalized.endswith("/db/images") or os.path.basename(f) == "images":
            images_file = f
            logger.info(f"Found images file: {f}")

    if not vn_file:
        logger.error("VN file not found in extracted files!")
        logger.info(f"Sample extracted paths: {extracted[:5]}")
        return

    imported_ids = await _import_vn_table(vn_file, vn_titles_file, images_file)

    # Clean up ghost VNs that are no longer in the dump
    # (Upsert-only imports accumulate deleted/hidden VNs over time)
    if imported_ids:
        async with async_session() as db:
            result = await db.execute(text("SELECT id FROM visual_novels"))
            db_ids = {row[0] for row in result.fetchall()}
            ghost_ids = list(db_ids - imported_ids)
            if ghost_ids:
                # Delete from computed tables that lack ON DELETE CASCADE
                for table in ("tag_vn_vectors", "cf_vn_factors", "vn_graph_embeddings"):
                    await db.execute(
                        text(f"DELETE FROM {table} WHERE vn_id = ANY(:ids)"),
                        {"ids": ghost_ids},
                    )
                await db.execute(
                    text("DELETE FROM visual_novels WHERE id = ANY(:ids)"),
                    {"ids": ghost_ids},
                )
                await db.commit()
                logger.info(f"Cleaned up {len(ghost_ids)} ghost VNs no longer in dump: {ghost_ids[:10]}{'...' if len(ghost_ids) > 10 else ''}")
            else:
                logger.info("No ghost VNs found - database is clean")

    # Update minage from releases table
    if releases_file and releases_vn_file:
        await _update_vn_minage_from_releases(releases_file, releases_vn_file)
    else:
        logger.warning(f"Releases files not found! releases_file={releases_file}, releases_vn_file={releases_vn_file}")
        logger.warning("VN minage will not be populated.")

    if vn_tags_file:
        await _import_vn_tags_table(vn_tags_file)

    # Mark import as complete
    await mark_import_complete(db_dump_path, "visual_novels")


def _load_vn_titles(titles_file: str) -> dict[str, tuple[str, str | None, str | None]]:
    """Load VN titles from vn_titles dump file.

    Returns dict mapping vn_id -> (title, latin/romaji title, japanese title).
    Prefers English titles for main title, falls back to original language.
    Japanese titles are stored separately for language preference toggle.
    """
    if not titles_file:
        return {}

    titles: dict[str, tuple[str, str | None, str | None]] = {}
    jp_titles: dict[str, str] = {}  # Separate dict for Japanese titles
    header_file = titles_file + ".header"

    try:
        with open(header_file, "r", encoding="utf-8") as f:
            fieldnames = f.read().strip().split("\t")
        logger.info(f"VN titles fields: {fieldnames}")
    except FileNotFoundError:
        logger.error(f"Titles header file not found: {header_file}")
        return {}

    with open(titles_file, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter="\t", fieldnames=fieldnames, quoting=csv.QUOTE_NONE)

        for row in reader:
            vn_id = row.get("id", "")
            if not vn_id.startswith("v"):
                vn_id = f"v{vn_id}"

            lang = row.get("lang", "")
            title = row.get("title", "")
            latin = row.get("latin") if row.get("latin") != "\\N" else None
            is_official = row.get("official", "f") == "t"

            # Track Japanese titles (original kanji/kana)
            if lang == "ja" and is_official:
                jp_titles[vn_id] = title

            # Priority for main title: English official > any official > first seen
            if vn_id not in titles:
                titles[vn_id] = (title, latin, None)
            elif lang == "en" and is_official:
                titles[vn_id] = (title, latin, titles[vn_id][2])
            elif is_official and titles[vn_id][0] == "":
                titles[vn_id] = (title, latin, titles[vn_id][2])

    # Merge Japanese titles into results
    for vn_id, jp_title in jp_titles.items():
        if vn_id in titles:
            t = titles[vn_id]
            titles[vn_id] = (t[0], t[1], jp_title)

    logger.info(f"Loaded {len(titles)} VN titles ({len(jp_titles)} with Japanese titles)")
    return titles


def _load_image_sexual_ratings(images_file: str | None) -> dict[str, float]:
    """Load image sexual ratings from images dump file.

    Returns dict mapping image_id (e.g., "cv12345") -> sexual rating (0-2).
    """
    if not images_file:
        return {}

    ratings = {}
    try:
        # Read header
        header_file = images_file + ".header"
        try:
            with open(header_file, "r", encoding="utf-8") as f:
                fieldnames = f.read().strip().split("\t")
        except FileNotFoundError:
            logger.warning(f"Images header file not found: {header_file}")
            return {}

        with open(images_file, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f, delimiter="\t", fieldnames=fieldnames, quoting=csv.QUOTE_NONE)
            for row in reader:
                img_id = row.get("id", "")
                # Field is c_sexual_avg in VNDB dump (stored as 0-200, we normalize to 0-2)
                sexual = row.get("c_sexual_avg", "")
                if img_id and sexual and sexual != "\\N":
                    try:
                        # VNDB stores as percentage * 100 (0-200 range), normalize to 0-2
                        ratings[img_id] = float(sexual) / 100.0
                    except ValueError:
                        pass

        logger.info(f"Loaded {len(ratings)} image sexual ratings")
    except Exception as e:
        logger.error(f"Error loading image sexual ratings: {e}")

    return ratings


async def _import_vn_table(vn_file: str, vn_titles_file: str | None = None, images_file: str | None = None) -> set[str]:
    """Import VN records from dump file.

    Returns:
        Set of VN IDs that were imported from the dump.
    """
    logger.info(f"Importing VN table from {vn_file}")

    # Load titles first
    titles = _load_vn_titles(vn_titles_file)

    # Load image sexual ratings
    image_sexual_map = _load_image_sexual_ratings(images_file)

    # Read header from separate .header file
    header_file = vn_file + ".header"
    try:
        with open(header_file, "r", encoding="utf-8") as f:
            fieldnames = f.read().strip().split("\t")
        logger.info(f"VN table fields ({len(fieldnames)} total): {fieldnames}")
        # Note: Release dates are not in the VN table - they come from the releases table
        # and are populated by update_vn_minage_and_released() later in the import process
        logger.info("Note: Release dates will be derived from releases table")
    except FileNotFoundError:
        logger.error(f"Header file not found: {header_file}")
        return

    count = 0
    errors = 0
    skipped_no_title = 0
    imported_ids: set[str] = set()

    async with async_session() as db:
        batch = []

        with open(vn_file, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f, delimiter="\t", fieldnames=fieldnames, quoting=csv.QUOTE_NONE)

            for row in reader:
                try:
                    vn_id = row.get("id", "")
                    if not vn_id.startswith("v"):
                        vn_id = f"v{vn_id}"

                    # Get title from titles lookup
                    title_data = titles.get(vn_id, ("", None, None))
                    title = sanitize_text(title_data[0])
                    title_romaji = sanitize_text(title_data[1]) if title_data[1] else None
                    title_jp = sanitize_text(title_data[2]) if title_data[2] else None

                    # Skip VNs without title
                    if not title:
                        skipped_no_title += 1
                        continue

                    # Helper to safely convert to int/float, handling \N as null
                    def safe_int(val, default=None):
                        if not val or val == "\\N" or val == "0":
                            return default
                        try:
                            return int(val)
                        except (ValueError, TypeError):
                            return default

                    def safe_float(val, default=None):
                        if not val or val == "\\N" or val == "0":
                            return default
                        try:
                            return float(val)
                        except (ValueError, TypeError):
                            return default

                    # Ratings are stored as integer (e.g., 741 = 7.41)
                    # c_rating is Bayesian-adjusted, c_average is raw average
                    rating_raw = safe_float(row.get("c_rating"))
                    rating = rating_raw / 100 if rating_raw else None

                    average_raw = safe_float(row.get("c_average"))
                    average_rating = average_raw / 100 if average_raw else None

                    # Note: release dates are populated from releases table by
                    # update_vn_minage_and_released() later in the import process

                    # Parse platforms array (PostgreSQL array format: {win,lin,mac})
                    platforms = None
                    c_platforms = row.get("c_platforms", "")
                    if c_platforms and c_platforms != "\\N" and c_platforms != "{}":
                        # Remove braces and split
                        platforms_str = c_platforms.strip("{}")
                        if platforms_str:
                            platforms = [p.strip('"') for p in platforms_str.split(",")]

                    # Parse developers array (PostgreSQL vndbid array format: {p1,p42})
                    developers = None
                    c_developers = row.get("c_developers", "")
                    if c_developers and c_developers != "\\N" and c_developers != "{}":
                        developers_str = c_developers.strip("{}")
                        if developers_str:
                            developers = [d.strip('"') for d in developers_str.split(",")]

                    # Parse languages array
                    languages = None
                    c_languages = row.get("c_languages", "")
                    if c_languages and c_languages != "\\N" and c_languages != "{}":
                        languages_str = c_languages.strip("{}")
                        if languages_str:
                            languages = [lang.strip('"') for lang in languages_str.split(",")]

                    # length field contains category 1-5 (Very Short to Very Long)
                    length = safe_int(row.get("length"))

                    # c_length is the pre-computed average playtime in minutes from user votes
                    # This matches VNDB website length filtering behavior
                    length_minutes = safe_int(row.get("c_length"))

                    # Construct image URL from c_image vndbid (e.g., "cv12345")
                    # Note: Use c_image (cached/current image), not image (may be outdated)
                    # VNDB image URLs: https://t.vndb.org/cv/{subdir}/{id}.jpg
                    # where subdir is id % 100, padded to 2 digits (last 2 digits of ID)
                    image_url = None
                    image_sexual = None
                    image_id = row.get("c_image", "")
                    if image_id and image_id != "\\N" and image_id.startswith("cv"):
                        try:
                            img_num = int(image_id[2:])
                            subdir = str(img_num % 100).zfill(2)
                            image_url = f"https://t.vndb.org/cv/{subdir}/{img_num}.jpg"
                            # Look up sexual rating from images table
                            image_sexual = image_sexual_map.get(image_id)
                        except (ValueError, TypeError):
                            pass

                    imported_ids.add(vn_id)
                    batch.append({
                        "id": vn_id,
                        "title": title,
                        "title_romaji": title_romaji or get_first_romaji_alias(row.get("alias")),
                        "title_jp": title_jp,
                        "description": sanitize_text(row.get("description")),
                        "image_url": image_url,
                        "image_sexual": image_sexual,
                        "length": length,
                        "length_minutes": length_minutes,  # Pre-computed from user votes (c_lengthnum)
                        "released": None,  # Populated from releases table later
                        "languages": languages,
                        "platforms": platforms,
                        "developers": developers,
                        "rating": rating,
                        "average_rating": average_rating,  # Raw average from c_average
                        "votecount": safe_int(row.get("c_votecount"), 0),
                        "popularity": None,  # Rank-based, not directly in dump
                        "minage": None,  # Will be updated from releases table
                        "devstatus": safe_int(row.get("devstatus"), 0),
                        "olang": row.get("olang"),
                    })
                    count += 1

                    if len(batch) >= 100:  # Conservative batch size (12 params * 100 = 1200)
                        await _upsert_vns(db, batch)
                        batch = []

                        if count % 5000 == 0:
                            logger.info(f"Imported {count} VNs...")

                except Exception as e:
                    errors += 1
                    if errors <= 10:
                        logger.warning(f"Error processing VN row {row.get('id', '?')}: {e}")
                    continue

        if batch:
            await _upsert_vns(db, batch)

        await db.commit()

    logger.info(f"Imported {count} visual novels ({errors} errors, {skipped_no_title} skipped for no title)")

    # Validation: Check for invalid ratings and fix them
    await _validate_and_fix_ratings()

    return imported_ids


async def _validate_and_fix_ratings():
    """Validate ratings are in expected 1-10 range and fix any anomalies.

    This catches issues like:
    - Ratings > 10 (API data stored without /10 conversion)
    - Ratings < 1 but > 0 (should be None for unrated)
    """
    async with async_session() as db:
        # Check for ratings > 10 (likely API values not divided by 10)
        result = await db.execute(text("""
            SELECT COUNT(*) as count FROM visual_novels WHERE rating > 10
        """))
        high_count = result.scalar_one()

        if high_count > 0:
            logger.warning(f"Found {high_count} VNs with rating > 10, fixing by dividing by 10...")
            await db.execute(text("""
                UPDATE visual_novels SET rating = rating / 10 WHERE rating > 10
            """))
            await db.commit()
            logger.info(f"Fixed {high_count} VNs with invalid high ratings")

        # Check for ratings in (0, 1) range (should probably be None)
        result = await db.execute(text("""
            SELECT COUNT(*) as count FROM visual_novels WHERE rating > 0 AND rating < 1
        """))
        low_count = result.scalar_one()

        if low_count > 0:
            logger.warning(f"Found {low_count} VNs with rating between 0 and 1 (suspicious)")

        logger.info("Rating validation complete")


async def _update_vn_minage_from_releases(releases_file: str, releases_vn_file: str):
    """Update VN minage and release dates from releases table.

    minage is on releases, not VNs directly. We need to:
    1. Read releases_vn to get release_id -> vn_id mapping
    2. Read releases to get minage and released date for each release
    3. For each VN, use maximum minage (strictest age rating)
    4. For release dates, use the earliest non-trial release

    Trial releases are detected by checking release titles for common keywords
    like "体験版", "試作版", "Trial", "Demo", etc.
    """
    logger.info("Updating VN minage and release dates from releases table...")

    # First, load release titles to detect trials
    releases_titles_file = releases_file.replace("/releases", "/releases_titles").replace("\\releases", "\\releases_titles")
    trial_releases: set[str] = set()

    try:
        titles_header_file = releases_titles_file + ".header"
        with open(titles_header_file, "r", encoding="utf-8") as f:
            titles_fieldnames = f.read().strip().split("\t")

        # Trial keywords (Japanese and English)
        trial_keywords = ["体験版", "試作版", "Trial", "Demo", "trial", "demo", "Taikenban", "体験", "試遊"]

        with open(releases_titles_file, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f, delimiter="\t", fieldnames=titles_fieldnames, quoting=csv.QUOTE_NONE)
            for row in reader:
                release_id = row.get("id", "")
                title = row.get("title", "") or ""
                latin = row.get("latin", "") or ""

                # Check if title contains trial keywords
                combined = title + " " + latin
                if any(keyword in combined for keyword in trial_keywords):
                    trial_releases.add(release_id)

        logger.info(f"Identified {len(trial_releases)} trial releases to skip for release dates")
    except FileNotFoundError:
        logger.warning(f"Release titles file not found, cannot filter trials")

    # Step 1: Build release_id -> vn_ids mapping from releases_vn
    release_to_vns: dict[str, list[str]] = {}

    releases_vn_header = releases_vn_file + ".header"
    try:
        with open(releases_vn_header, "r", encoding="utf-8") as f:
            fieldnames = f.read().strip().split("\t")
        logger.info(f"releases_vn fields: {fieldnames}")
    except FileNotFoundError:
        logger.error(f"releases_vn header not found: {releases_vn_header}")
        return

    with open(releases_vn_file, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter="\t", fieldnames=fieldnames, quoting=csv.QUOTE_NONE)
        for row in reader:
            release_id = row.get("id", "")
            vn_id = row.get("vid", "")
            if not vn_id.startswith("v"):
                vn_id = f"v{vn_id}"

            if release_id not in release_to_vns:
                release_to_vns[release_id] = []
            release_to_vns[release_id].append(vn_id)

    logger.info(f"Loaded {len(release_to_vns)} release->VN mappings")

    # Step 2: Read releases and aggregate minage and release dates per VN
    vn_minages: dict[str, int] = {}  # vn_id -> max minage (strictest rating)
    vn_released: dict[str, int] = {}  # vn_id -> earliest non-trial release date (YYYYMMDD)
    vn_released_any: dict[str, int] = {}  # vn_id -> earliest release date (fallback, including trials)

    releases_header = releases_file + ".header"
    try:
        with open(releases_header, "r", encoding="utf-8") as f:
            fieldnames = f.read().strip().split("\t")
        logger.info(f"releases fields: {fieldnames}")
    except FileNotFoundError:
        logger.error(f"releases header not found: {releases_header}")
        return

    with open(releases_file, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter="\t", fieldnames=fieldnames, quoting=csv.QUOTE_NONE)
        for row in reader:
            release_id = row.get("id", "")
            minage_raw = row.get("minage", "")
            released_raw = row.get("released", "")

            # Get VNs for this release
            vn_ids = release_to_vns.get(release_id, [])
            if not vn_ids:
                continue

            is_trial = release_id in trial_releases

            # Process minage (always consider all releases)
            if minage_raw and minage_raw != "\\N":
                try:
                    minage = int(minage_raw)
                    for vn_id in vn_ids:
                        if vn_id not in vn_minages:
                            vn_minages[vn_id] = minage
                        else:
                            vn_minages[vn_id] = max(vn_minages[vn_id], minage)
                except (ValueError, TypeError):
                    pass

            # Process release date
            if released_raw and released_raw != "\\N" and released_raw != "0":
                try:
                    released_int = int(released_raw)
                    if released_int >= 19800000:  # Valid date range
                        for vn_id in vn_ids:
                            # Track earliest non-trial release
                            if not is_trial:
                                if vn_id not in vn_released:
                                    vn_released[vn_id] = released_int
                                else:
                                    vn_released[vn_id] = min(vn_released[vn_id], released_int)

                            # Also track any release as fallback
                            if vn_id not in vn_released_any:
                                vn_released_any[vn_id] = released_int
                            else:
                                vn_released_any[vn_id] = min(vn_released_any[vn_id], released_int)
                except (ValueError, TypeError):
                    pass

    logger.info(f"Computed minage for {len(vn_minages)} VNs")
    logger.info(f"Computed release dates for {len(vn_released)} VNs (non-trial), {len(vn_released_any)} VNs (any)")

    # Step 3: Update VNs with minage and release dates
    async with async_session() as db:
        update_count = 0

        # Get all VN IDs that need updates
        all_vn_ids = set(vn_minages.keys()) | set(vn_released.keys()) | set(vn_released_any.keys())

        for vn_id in all_vn_ids:
            minage = vn_minages.get(vn_id)

            # Use non-trial release date, or fall back to any release
            released_int = vn_released.get(vn_id) or vn_released_any.get(vn_id)

            # Convert YYYYMMDD to date object
            released_date = None
            if released_int:
                try:
                    year = released_int // 10000
                    month = (released_int // 100) % 100
                    day = released_int % 100
                    if month == 0:
                        month = 1
                    if day == 0:
                        day = 1
                    if 1980 <= year <= 2100:
                        released_date = date(year, month, day)
                except (ValueError, TypeError):
                    pass

            # Build update query
            if minage is not None and released_date is not None:
                await db.execute(
                    text("UPDATE visual_novels SET minage = :minage, released = :released WHERE id = :id"),
                    {"id": vn_id, "minage": minage, "released": released_date}
                )
            elif minage is not None:
                await db.execute(
                    text("UPDATE visual_novels SET minage = :minage WHERE id = :id"),
                    {"id": vn_id, "minage": minage}
                )
            elif released_date is not None:
                await db.execute(
                    text("UPDATE visual_novels SET released = :released WHERE id = :id"),
                    {"id": vn_id, "released": released_date}
                )
            else:
                continue

            update_count += 1

            if update_count % 10000 == 0:
                logger.info(f"Updated {update_count} VNs...")

        await db.commit()

    logger.info(f"Updated minage/released for {update_count} VNs")


async def update_vn_platforms_and_languages():
    """Aggregate platforms and languages from release data into the visual_novels table.

    The VNDB dump excludes cached columns (c_platforms, c_languages) from the vn table,
    so we reconstruct them from release_platforms and releases.olang respectively.
    """
    logger.info("Aggregating VN platforms and languages from release data...")

    async with async_session() as db:
        # Update platforms from release_platforms + release_vn
        result = await db.execute(text("""
            UPDATE visual_novels vn
            SET platforms = sub.platforms
            FROM (
                SELECT rv.vn_id, array_agg(DISTINCT rp.platform ORDER BY rp.platform) as platforms
                FROM release_vn rv
                JOIN release_platforms rp ON rv.release_id = rp.release_id
                GROUP BY rv.vn_id
            ) sub
            WHERE vn.id = sub.vn_id
        """))
        platforms_count = result.rowcount
        logger.info(f"Updated platforms for {platforms_count} VNs")

        # Update languages from releases.olang + release_vn
        result = await db.execute(text("""
            UPDATE visual_novels vn
            SET languages = sub.languages
            FROM (
                SELECT rv.vn_id, array_agg(DISTINCT r.olang ORDER BY r.olang) as languages
                FROM release_vn rv
                JOIN releases r ON rv.release_id = r.id
                WHERE r.olang IS NOT NULL
                GROUP BY rv.vn_id
            ) sub
            WHERE vn.id = sub.vn_id
        """))
        languages_count = result.rowcount
        logger.info(f"Updated languages for {languages_count} VNs")

        await db.commit()

    logger.info("Finished aggregating VN platforms and languages")


async def update_browse_precomputed_counts():
    """Compute precomputed browse counts for staff and producers.

    Updates vn_count, roles, seiyuu_vn_count, seiyuu_char_count on staff table
    and vn_count, dev_vn_count, pub_vn_count on producers table.
    These eliminate expensive subquery joins in browse API endpoints.
    """
    logger.info("Computing precomputed browse counts for staff and producers...")

    async with async_session() as db:
        # Reset counts to 0 first (handles staff/producers that lost all credits)
        await db.execute(text("UPDATE staff SET vn_count = 0, roles = NULL, seiyuu_vn_count = 0, seiyuu_char_count = 0"))
        await db.execute(text("UPDATE producers SET vn_count = 0, dev_vn_count = 0, pub_vn_count = 0"))

        # Staff vn_count
        result = await db.execute(text("""
            UPDATE staff SET vn_count = sub.cnt
            FROM (
                SELECT staff_id, COUNT(DISTINCT vn_id) AS cnt
                FROM vn_staff GROUP BY staff_id
            ) sub
            WHERE staff.id = sub.staff_id
        """))
        logger.info(f"Updated vn_count for {result.rowcount} staff")

        # Staff roles array
        result = await db.execute(text("""
            UPDATE staff SET roles = sub.role_list
            FROM (
                SELECT staff_id, ARRAY_AGG(DISTINCT role ORDER BY role) AS role_list
                FROM vn_staff GROUP BY staff_id
            ) sub
            WHERE staff.id = sub.staff_id
        """))
        logger.info(f"Updated roles for {result.rowcount} staff")

        # Staff seiyuu counts
        result = await db.execute(text("""
            UPDATE staff SET seiyuu_vn_count = sub.vn_cnt, seiyuu_char_count = sub.char_cnt
            FROM (
                SELECT staff_id,
                       COUNT(DISTINCT vn_id) AS vn_cnt,
                       COUNT(DISTINCT character_id) AS char_cnt
                FROM vn_seiyuu GROUP BY staff_id
            ) sub
            WHERE staff.id = sub.staff_id
        """))
        logger.info(f"Updated seiyuu counts for {result.rowcount} staff")

        # Producer total vn_count
        result = await db.execute(text("""
            UPDATE producers SET vn_count = sub.cnt
            FROM (
                SELECT rp.producer_id, COUNT(DISTINCT rv.vn_id) AS cnt
                FROM release_producers rp
                JOIN release_vn rv ON rp.release_id = rv.release_id
                GROUP BY rp.producer_id
            ) sub
            WHERE producers.id = sub.producer_id
        """))
        logger.info(f"Updated vn_count for {result.rowcount} producers")

        # Producer dev_vn_count
        result = await db.execute(text("""
            UPDATE producers SET dev_vn_count = sub.cnt
            FROM (
                SELECT rp.producer_id, COUNT(DISTINCT rv.vn_id) AS cnt
                FROM release_producers rp
                JOIN release_vn rv ON rp.release_id = rv.release_id
                WHERE rp.developer = true
                GROUP BY rp.producer_id
            ) sub
            WHERE producers.id = sub.producer_id
        """))
        logger.info(f"Updated dev_vn_count for {result.rowcount} producers")

        # Producer pub_vn_count
        result = await db.execute(text("""
            UPDATE producers SET pub_vn_count = sub.cnt
            FROM (
                SELECT rp.producer_id, COUNT(DISTINCT rv.vn_id) AS cnt
                FROM release_producers rp
                JOIN release_vn rv ON rp.release_id = rv.release_id
                WHERE rp.publisher = true
                GROUP BY rp.producer_id
            ) sub
            WHERE producers.id = sub.producer_id
        """))
        logger.info(f"Updated pub_vn_count for {result.rowcount} producers")

        await db.commit()

    logger.info("Finished computing browse counts")


async def _upsert_vns(db: AsyncSession, batch: list[dict]):
    """Upsert a batch of VNs."""
    stmt = insert(VisualNovel).values(batch)
    stmt = stmt.on_conflict_do_update(
        index_elements=["id"],
        set_={
            "title": stmt.excluded.title,
            "title_romaji": stmt.excluded.title_romaji,
            "title_jp": stmt.excluded.title_jp,
            "description": stmt.excluded.description,
            "image_url": stmt.excluded.image_url,
            "image_sexual": stmt.excluded.image_sexual,
            "length": stmt.excluded.length,
            "length_minutes": stmt.excluded.length_minutes,
            "released": stmt.excluded.released,
            "languages": stmt.excluded.languages,
            "platforms": stmt.excluded.platforms,
            "developers": stmt.excluded.developers,
            "rating": stmt.excluded.rating,
            "average_rating": stmt.excluded.average_rating,
            "votecount": stmt.excluded.votecount,
            "popularity": stmt.excluded.popularity,
            "minage": stmt.excluded.minage,
            "devstatus": stmt.excluded.devstatus,
            "olang": stmt.excluded.olang,
            "updated_at": datetime.utcnow(),
        }
    )
    await db.execute(stmt)


async def _import_vn_tags_table(tags_vn_file: str):
    """Import VN-tag relationships.

    The tags_vn dump contains individual user votes on tags.
    We aggregate them into average scores per (vn_id, tag_id) pair.
    """
    logger.info(f"Importing VN tags from {tags_vn_file}")

    # Read header from separate .header file
    header_file = tags_vn_file + ".header"
    try:
        with open(header_file, "r", encoding="utf-8") as f:
            fieldnames = f.read().strip().split("\t")
        logger.info(f"VN tags table fields: {fieldnames}")
    except FileNotFoundError:
        logger.error(f"Header file not found: {header_file}")
        return

    # Helper to check multiple boolean formats (VNDB dumps may use t, true, 1, etc.)
    def is_truthy(val: str) -> bool:
        return val in ("t", "true", "1", "True")

    # Load users who don't have tag permission (perm_tag = 'f')
    # These users' votes should be excluded from tag score calculations
    blacklisted_taggers: set[str] = set()
    users_file = os.path.join(os.path.dirname(tags_vn_file), "users")
    users_header_file = users_file + ".header"
    try:
        with open(users_header_file, "r", encoding="utf-8") as f:
            users_fields = f.read().strip().split("\t")
        with open(users_file, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f, delimiter="\t", fieldnames=users_fields, quoting=csv.QUOTE_NONE)
            for row in reader:
                # perm_tag = 'f' means user's tag votes don't count
                if row.get("perm_tag") == "f":
                    blacklisted_taggers.add(row.get("id", ""))
        logger.info(f"Loaded {len(blacklisted_taggers)} users with perm_tag=false (blacklisted taggers)")
    except FileNotFoundError:
        logger.warning(f"Users file not found: {users_file}, proceeding without blacklist filter")
    except Exception as e:
        logger.warning(f"Failed to load blacklisted taggers: {e}, proceeding without blacklist filter")

    # First pass: aggregate votes into (vn_id, tag_id) -> {votes: [], spoilers: []}
    logger.info("Aggregating tag votes...")
    aggregated: dict[tuple[str, int], dict] = {}
    ignored_count = 0
    lie_count = 0
    blacklisted_tagger_count = 0

    with open(tags_vn_file, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter="\t", fieldnames=fieldnames, quoting=csv.QUOTE_NONE)

        for row in reader:
            try:
                # Skip rows marked as 'ignore' (moderator override)
                ignore_val = row.get("ignore", "")
                if is_truthy(ignore_val):
                    ignored_count += 1
                    continue

                # Skip votes from users without tag permission (perm_tag=false)
                uid = row.get("uid", "")
                if uid in blacklisted_taggers:
                    blacklisted_tagger_count += 1
                    continue

                vn_id = row.get("vid", "")
                if not vn_id.startswith("v"):
                    vn_id = f"v{vn_id}"

                # Tag ID has 'g' prefix (e.g., 'g2')
                tag_raw = row.get("tag", "")
                if tag_raw.startswith("g"):
                    tag_raw = tag_raw[1:]
                tag_id = int(tag_raw)

                # Handle \N as null
                vote_raw = row.get("vote", "")
                if not vote_raw or vote_raw == "\\N":
                    vote = 2  # Default
                else:
                    vote = float(vote_raw)

                spoiler_raw = row.get("spoiler", "")
                if not spoiler_raw or spoiler_raw == "\\N":
                    spoiler = 0
                else:
                    spoiler = int(spoiler_raw)

                key = (vn_id, tag_id)
                if key not in aggregated:
                    aggregated[key] = {"votes": [], "spoilers": [], "lie_votes": [], "lie_spoilers": []}

                # Track lie votes separately (don't skip them)
                lie_val = row.get("lie", "")
                if is_truthy(lie_val):
                    lie_count += 1
                    aggregated[key]["lie_votes"].append(vote)
                    aggregated[key]["lie_spoilers"].append(spoiler)
                else:
                    aggregated[key]["votes"].append(vote)
                    aggregated[key]["spoilers"].append(spoiler)

            except (ValueError, KeyError) as e:
                continue

    logger.info(f"Aggregated {len(aggregated)} unique VN-tag pairs")
    logger.info(f"Skipped {ignored_count} ignored votes, {lie_count} lie votes, {blacklisted_tagger_count} votes from users without tag permission")

    # Get set of valid VN IDs and tag IDs from database
    async with async_session() as db:
        vn_result = await db.execute(text("SELECT id FROM visual_novels"))
        valid_vn_ids = {row[0] for row in vn_result}
        
        tag_result = await db.execute(text("SELECT id FROM tags"))
        valid_tag_ids = {row[0] for row in tag_result}
    logger.info(f"Found {len(valid_vn_ids)} VNs and {len(valid_tag_ids)} tags in database")

    # Clear existing relationships
    async with async_session() as db:
        await db.execute(text("TRUNCATE TABLE vn_tags"))
        await db.commit()

    # Second pass: compute averages and use COPY for fast bulk loading
    count = 0
    skipped = 0
    errors = 0
    batch: list[tuple] = []  # Use tuples for COPY
    BATCH_SIZE = 10000  # Much larger batch size for COPY (was 100)

    lie_tag_count = 0
    for (vn_id, tag_id), data in aggregated.items():
        # Skip if VN or tag doesn't exist in database
        if vn_id not in valid_vn_ids:
            skipped += 1
            continue
        if tag_id not in valid_tag_ids:
            skipped += 1
            continue
        try:
            votes = data["votes"]  # Non-lie votes only
            spoilers = data["spoilers"]
            lie_votes = data.get("lie_votes", [])
            lie_spoilers = data.get("lie_spoilers", [])

            # Skip if no valid (non-lie) votes exist
            if not votes:
                skipped += 1
                continue

            # Compute average score from non-lie votes only
            avg_score = sum(votes) / len(votes)

            # Spoiler level: use max from all votes (including lie votes for spoiler info)
            all_spoilers = spoilers + lie_spoilers
            max_spoiler = max(all_spoilers) if all_spoilers else 0

            # Calculate aggregate lie flag (matches VNDB behavior):
            # If lie votes >= non-lie votes, mark as lie
            is_lie = len(lie_votes) >= len(votes)
            if is_lie:
                lie_tag_count += 1

            # Use tuple for COPY format (vn_id, tag_id, score, spoiler_level, lie)
            batch.append((vn_id, tag_id, avg_score, max_spoiler, is_lie))
            count += 1

            if len(batch) >= BATCH_SIZE:
                await copy_bulk_data(
                    "vn_tags",
                    ["vn_id", "tag_id", "score", "spoiler_level", "lie"],
                    batch
                )
                batch = []

                if count % 500000 == 0:  # Log less frequently with larger batches
                    logger.info(f"Imported {count} VN-tag relationships...")

        except Exception as e:
            errors += 1
            if errors <= 5:
                logger.warning(f"Error processing VN tag aggregate: {e}")
            continue

    # Final batch
    if batch:
        await copy_bulk_data(
            "vn_tags",
            ["vn_id", "tag_id", "score", "spoiler_level", "lie"],
            batch
        )

    logger.info(f"Imported {count} VN-tag relationships ({skipped} skipped, {errors} errors, {lie_tag_count} marked as lies)")


# ============ Traits Import ============

def _get_trait_root_category(trait_id: int, trait_lookup: dict) -> str | None:
    """Traverse parents hierarchy to find the root category name.

    VNDB traits use a 'parents' array to indicate hierarchy.
    This walks up the tree to find the root trait (one with empty parents).

    Returns the name of the root trait, or None if not found.
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


async def import_traits(traits_path: str, force: bool = False):
    """Import character traits from vndb-traits-latest.json.gz.

    Args:
        traits_path: Path to the traits JSON file
        force: If True, import regardless of file modification time
    """
    # Check if import is needed
    if not await should_import(traits_path, "traits", force):
        return

    logger.info(f"Importing traits from {traits_path}")

    traits_data = load_gzipped_json(traits_path)

    # Build lookup for parent traversal (to compute group_name)
    trait_lookup = {t["id"]: t for t in traits_data}

    all_parent_pairs = []  # (trait_id, parent_id) for junction table

    async with async_session() as db:
        batch = []
        for trait in traits_data:
            # Compute group_name by traversing parents to find root category
            root_name = _get_trait_root_category(trait["id"], trait_lookup)
            # Only set group_name if it's different from the trait itself
            group_name = root_name if root_name and root_name != trait["name"] else None

            # Get group_id from first parent if available
            parents = trait.get("parents", [])
            group_id = parents[0] if parents else None

            # Collect ALL parent relationships for junction table
            for pid in parents:
                all_parent_pairs.append({"trait_id": trait["id"], "parent_id": pid})

            batch.append({
                "id": trait["id"],
                "name": sanitize_text(trait["name"]),
                "description": sanitize_text(trait.get("description", "")),
                "group_id": group_id,
                "group_name": sanitize_text(group_name) if group_name else None,
                "char_count": trait.get("chars", 0),
                "aliases": trait.get("aliases", []),
                "searchable": trait.get("searchable", True),
                "applicable": trait.get("applicable", True),
            })

            if len(batch) >= 100:
                await _upsert_traits(db, batch)
                batch = []

        if batch:
            await _upsert_traits(db, batch)

        await db.commit()

        # Populate trait_parents junction table (all parents)
        await db.execute(text("DELETE FROM trait_parents"))
        if all_parent_pairs:
            for i in range(0, len(all_parent_pairs), 1000):
                chunk = all_parent_pairs[i:i + 1000]
                stmt = insert(TraitParent).values(chunk)
                stmt = stmt.on_conflict_do_nothing()
                await db.execute(stmt)
            await db.commit()

    logger.info(
        f"Imported {len(traits_data)} traits "
        f"with {len(all_parent_pairs)} parent relationships"
    )

    # Mark import as complete
    await mark_import_complete(traits_path, "traits")


async def _upsert_traits(db: AsyncSession, batch: list[dict]):
    """Upsert a batch of traits."""
    stmt = insert(Trait).values(batch)
    stmt = stmt.on_conflict_do_update(
        index_elements=["id"],
        set_={
            "name": stmt.excluded.name,
            "description": stmt.excluded.description,
            "group_id": stmt.excluded.group_id,
            "group_name": stmt.excluded.group_name,
            "char_count": stmt.excluded.char_count,
            "aliases": stmt.excluded.aliases,
            "searchable": stmt.excluded.searchable,
            "applicable": stmt.excluded.applicable,
        }
    )
    await db.execute(stmt)


# ============ Producers Import ============

async def import_producers(extract_dir: str, force: bool = False):
    """Import producers (developers/publishers) from db dump.

    Args:
        extract_dir: Directory with extracted dump files
        force: If True, import regardless of file modification time
    """
    producers_file = None

    # Find the producers file in extracted directory
    for root, dirs, files in os.walk(extract_dir):
        for f in files:
            if f == "producers":
                producers_file = os.path.join(root, f)
                break

    if not producers_file:
        logger.warning("Producers file not found in extracted files")
        return

    # Check if import is needed
    if not await should_import(producers_file, "producers", force):
        return

    logger.info(f"Importing producers from {producers_file}")

    # Read header
    header_file = producers_file + ".header"
    try:
        with open(header_file, "r", encoding="utf-8") as f:
            fieldnames = f.read().strip().split("\t")
        logger.info(f"Producers fields: {fieldnames}")
    except FileNotFoundError:
        logger.error(f"Producers header not found: {header_file}")
        return

    count = 0
    async with async_session() as db:
        batch = []

        with open(producers_file, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f, delimiter="\t", fieldnames=fieldnames, quoting=csv.QUOTE_NONE)

            for row in reader:
                try:
                    producer_id = row.get("id", "")
                    if not producer_id.startswith("p"):
                        producer_id = f"p{producer_id}"

                    # Name might be in different columns
                    name = sanitize_text(row.get("name", ""))
                    if not name:
                        continue

                    batch.append({
                        "id": producer_id,
                        "name": name,
                        "original": sanitize_text(row.get("latin")) if row.get("latin") != "\\N" else None,
                        "type": row.get("type") if row.get("type") != "\\N" else None,
                        "lang": row.get("lang") if row.get("lang") != "\\N" else None,
                        "description": sanitize_text(row.get("description")) if row.get("description") != "\\N" else None,
                    })
                    count += 1

                    if len(batch) >= 100:
                        await _upsert_producers(db, batch)
                        batch = []

                        if count % 5000 == 0:
                            logger.info(f"Imported {count} producers...")

                except Exception as e:
                    logger.debug(f"Error processing producer row: {e}")
                    continue

        if batch:
            await _upsert_producers(db, batch)

        await db.commit()

    logger.info(f"Imported {count} producers")

    # Mark import as complete
    await mark_import_complete(producers_file, "producers")


async def _upsert_producers(db: AsyncSession, batch: list[dict]):
    """Upsert a batch of producers."""
    stmt = insert(Producer).values(batch)
    stmt = stmt.on_conflict_do_update(
        index_elements=["id"],
        set_={
            "name": stmt.excluded.name,
            "original": stmt.excluded.original,
            "type": stmt.excluded.type,
            "lang": stmt.excluded.lang,
            "description": stmt.excluded.description,
        }
    )
    await db.execute(stmt)


# ============ Staff Import ============

async def import_staff(extract_dir: str, force: bool = False):
    """Import staff members from db dump.

    Args:
        extract_dir: Directory with extracted dump files
        force: If True, import regardless of file modification time
    """
    staff_file = None

    # Find the staff file in extracted directory
    for root, dirs, files in os.walk(extract_dir):
        for f in files:
            if f == "staff":
                staff_file = os.path.join(root, f)

    if not staff_file:
        logger.warning("Staff file not found in extracted files")
        return

    # Check if import is needed
    if not await should_import(staff_file, "staff", force):
        return

    logger.info(f"Importing staff from {staff_file}")

    # Load staff aliases for name resolution using shared helper
    staff_alias_file = _find_staff_alias_file(extract_dir)
    aliases = _load_staff_name_aliases(staff_alias_file)

    # Read header
    header_file = staff_file + ".header"
    try:
        with open(header_file, "r", encoding="utf-8") as f:
            fieldnames = f.read().strip().split("\t")
        logger.info(f"Staff fields: {fieldnames}")
    except FileNotFoundError:
        logger.error(f"Staff header not found: {header_file}")
        return

    count = 0
    async with async_session() as db:
        batch = []

        with open(staff_file, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f, delimiter="\t", fieldnames=fieldnames, quoting=csv.QUOTE_NONE)

            for row in reader:
                try:
                    staff_id = row.get("id", "")
                    if not staff_id.startswith("s"):
                        staff_id = f"s{staff_id}"

                    # Get name from aliases, fallback to staff table
                    alias_data = aliases.get(staff_id, (None, None))
                    name = alias_data[0] or sanitize_text(row.get("name", ""))
                    original = alias_data[1]

                    if not name:
                        continue

                    batch.append({
                        "id": staff_id,
                        "name": name,
                        "original": original,
                        "lang": row.get("lang") if row.get("lang") != "\\N" else None,
                        "gender": row.get("gender") if row.get("gender") != "\\N" else None,
                        "description": sanitize_text(row.get("description")) if row.get("description") != "\\N" else None,
                    })
                    count += 1

                    if len(batch) >= 100:
                        await _upsert_staff(db, batch)
                        batch = []

                        if count % 5000 == 0:
                            logger.info(f"Imported {count} staff...")

                except Exception as e:
                    logger.debug(f"Error processing staff row: {e}")
                    continue

        if batch:
            await _upsert_staff(db, batch)

        await db.commit()

    logger.info(f"Imported {count} staff members")

    # Mark import as complete
    await mark_import_complete(staff_file, "staff")


async def _upsert_staff(db: AsyncSession, batch: list[dict]):
    """Upsert a batch of staff."""
    stmt = insert(Staff).values(batch)
    stmt = stmt.on_conflict_do_update(
        index_elements=["id"],
        set_={
            "name": stmt.excluded.name,
            "original": stmt.excluded.original,
            "lang": stmt.excluded.lang,
            "gender": stmt.excluded.gender,
            "description": stmt.excluded.description,
        }
    )
    await db.execute(stmt)


# ============ VN-Staff Import ============

async def import_vn_staff(extract_dir: str, force: bool = False):
    """Import VN-staff relationships from db dump.

    Args:
        extract_dir: Directory with extracted dump files
        force: If True, import regardless of file modification time
    """
    vn_staff_file = None

    for root, dirs, files in os.walk(extract_dir):
        for f in files:
            if f == "vn_staff":
                vn_staff_file = os.path.join(root, f)

    if not vn_staff_file:
        logger.warning("VN staff file not found in extracted files")
        return

    # Check if import is needed
    if not await should_import(vn_staff_file, "vn_staff", force):
        return

    logger.info(f"Importing VN-staff from {vn_staff_file}")

    # Build aid -> staff_id mapping using shared helper
    staff_alias_file = _find_staff_alias_file(extract_dir)
    aid_to_staff_id = _load_aid_to_staff_mapping(staff_alias_file)

    # Read header
    header_file = vn_staff_file + ".header"
    try:
        with open(header_file, "r", encoding="utf-8") as f:
            fieldnames = f.read().strip().split("\t")
        logger.info(f"VN staff fields: {fieldnames}")
    except FileNotFoundError:
        logger.error(f"VN staff header not found: {header_file}")
        return

    # Get valid VN and staff IDs
    async with async_session() as db:
        vn_result = await db.execute(text("SELECT id FROM visual_novels"))
        valid_vn_ids = {row[0] for row in vn_result}
        staff_result = await db.execute(text("SELECT id FROM staff"))
        valid_staff_ids = {row[0] for row in staff_result}
    logger.info(f"Found {len(valid_vn_ids)} VNs and {len(valid_staff_ids)} staff in database")

    count = 0
    skipped = 0
    duplicates = 0

    # Clear existing relationships first
    async with async_session() as db:
        await db.execute(text("TRUNCATE TABLE vn_staff"))
        await db.commit()

    # Use COPY for fast bulk loading (10-100x faster than INSERT)
    batch: list[tuple] = []
    seen_keys: set[tuple] = set()  # Track (vn_id, staff_id, role) to avoid duplicates
    BATCH_SIZE = 10000  # COPY can handle large batches efficiently

    with open(vn_staff_file, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter="\t", fieldnames=fieldnames, quoting=csv.QUOTE_NONE)

        for row in reader:
            try:
                vn_id = row.get("id", "")
                if not vn_id.startswith("v"):
                    vn_id = f"v{vn_id}"

                # vn_staff.aid is the alias ID, map it to staff_id
                aid = row.get("aid", "")
                staff_id = aid_to_staff_id.get(aid)
                if not staff_id:
                    skipped += 1
                    continue

                # Skip if VN or staff doesn't exist
                if vn_id not in valid_vn_ids or staff_id not in valid_staff_ids:
                    skipped += 1
                    continue

                role = row.get("role", "")
                if role == "\\N":
                    role = "unknown"

                # Check for duplicate primary key (vn_id, staff_id, role)
                pk = (vn_id, staff_id, role)
                if pk in seen_keys:
                    duplicates += 1
                    continue
                seen_keys.add(pk)

                aid_int = int(aid) if aid and aid != "\\N" else None
                note_raw = sanitize_text(row.get("note")) if row.get("note") != "\\N" else None
                note = note_raw[:500] if note_raw else None  # Truncate to fit varchar(500)

                # Tuple format for COPY: (vn_id, staff_id, aid, role, note)
                batch.append((vn_id, staff_id, aid_int, role, note))
                count += 1

                if len(batch) >= BATCH_SIZE:
                    try:
                        await copy_bulk_data(
                            "vn_staff",
                            ["vn_id", "staff_id", "aid", "role", "note"],
                            batch
                        )
                        await set_import_progress("vn_staff", count)
                    except Exception as e:
                        logger.error(f"Error in COPY batch at count {count}: {e}")
                        # On error, clear batch and continue (don't accumulate)
                    batch = []

                    if count % 50000 == 0:
                        logger.info(f"Imported {count} VN-staff relationships...")

            except Exception as e:
                logger.debug(f"Error processing VN staff row: {e}")
                continue

    # Final batch
    if batch:
        try:
            await copy_bulk_data(
                "vn_staff",
                ["vn_id", "staff_id", "aid", "role", "note"],
                batch
            )
        except Exception as e:
            logger.error(f"Error in final COPY batch: {e}")

    await clear_import_progress("vn_staff")
    logger.info(f"Imported {count} VN-staff relationships ({skipped} skipped, {duplicates} duplicates)")

    # Mark import as complete
    await mark_import_complete(vn_staff_file, "vn_staff")


# ============ Seiyuu Import ============

async def import_seiyuu(extract_dir: str, force: bool = False):
    """Import VN voice actor (seiyuu) credits from db dump.

    Uses PostgreSQL COPY for fast bulk loading (10-100x faster than INSERT).

    Args:
        extract_dir: Directory with extracted dump files
        force: If True, import regardless of file modification time
    """
    vn_seiyuu_file = None

    for root, dirs, files in os.walk(extract_dir):
        for f in files:
            if f == "vn_seiyuu":
                vn_seiyuu_file = os.path.join(root, f)

    if not vn_seiyuu_file:
        logger.warning("VN seiyuu file not found in extracted files")
        return

    # Check if import is needed
    if not await should_import(vn_seiyuu_file, "vn_seiyuu", force):
        return

    logger.info(f"Importing VN seiyuu from {vn_seiyuu_file}")

    # Build aid -> staff_id mapping using shared helper
    staff_alias_file = _find_staff_alias_file(extract_dir)
    aid_to_staff_id = _load_aid_to_staff_mapping(staff_alias_file)

    # Read header
    header_file = vn_seiyuu_file + ".header"
    try:
        with open(header_file, "r", encoding="utf-8") as f:
            fieldnames = f.read().strip().split("\t")
        logger.info(f"VN seiyuu fields: {fieldnames}")
    except FileNotFoundError:
        logger.error(f"VN seiyuu header not found: {header_file}")
        return

    # Get valid VN and staff IDs
    async with async_session() as db:
        vn_result = await db.execute(text("SELECT id FROM visual_novels"))
        valid_vn_ids = {row[0] for row in vn_result}
        staff_result = await db.execute(text("SELECT id FROM staff"))
        valid_staff_ids = {row[0] for row in staff_result}
    logger.info(f"Found {len(valid_vn_ids)} VNs and {len(valid_staff_ids)} staff in database")

    count = 0
    skipped = 0
    duplicates = 0

    # Clear existing relationships first
    async with async_session() as db:
        await db.execute(text("TRUNCATE TABLE vn_seiyuu"))
        await db.commit()

    # Use COPY for fast bulk loading
    batch: list[tuple] = []
    seen_keys: set[tuple] = set()  # Track (vn_id, staff_id, character_id) to avoid duplicates
    BATCH_SIZE = 10000

    with open(vn_seiyuu_file, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter="\t", fieldnames=fieldnames, quoting=csv.QUOTE_NONE)

        for row in reader:
            try:
                vn_id = row.get("id", "")
                if not vn_id.startswith("v"):
                    vn_id = f"v{vn_id}"

                # vn_seiyuu.aid is the alias ID, map it to staff_id
                aid = row.get("aid", "")
                staff_id = aid_to_staff_id.get(aid)
                if not staff_id:
                    skipped += 1
                    continue

                char_id = row.get("cid", "")
                if char_id and not char_id.startswith("c") and char_id != "\\N":
                    char_id = f"c{char_id}"
                if char_id == "\\N":
                    char_id = ""
                character_id = char_id if char_id else "unknown"

                # Skip if VN or staff doesn't exist
                if vn_id not in valid_vn_ids or staff_id not in valid_staff_ids:
                    skipped += 1
                    continue

                # Check for duplicate primary key (vn_id, staff_id, character_id)
                pk = (vn_id, staff_id, character_id)
                if pk in seen_keys:
                    duplicates += 1
                    continue
                seen_keys.add(pk)

                aid_int = int(aid) if aid and aid != "\\N" else None
                note_raw = sanitize_text(row.get("note")) if row.get("note") != "\\N" else None
                note = note_raw[:500] if note_raw else None  # Truncate to fit varchar(500)

                # Tuple format for COPY: (vn_id, staff_id, aid, character_id, note)
                batch.append((vn_id, staff_id, aid_int, character_id, note))
                count += 1

                if len(batch) >= BATCH_SIZE:
                    try:
                        await copy_bulk_data(
                            "vn_seiyuu",
                            ["vn_id", "staff_id", "aid", "character_id", "note"],
                            batch
                        )
                        await set_import_progress("vn_seiyuu", count)
                    except Exception as e:
                        logger.error(f"Error in COPY batch at count {count}: {e}")
                    batch = []

                    if count % 50000 == 0:
                        logger.info(f"Imported {count} VN-seiyuu relationships...")

            except Exception as e:
                logger.debug(f"Error processing VN seiyuu row: {e}")
                continue

    # Final batch
    if batch:
        try:
            await copy_bulk_data(
                "vn_seiyuu",
                ["vn_id", "staff_id", "aid", "character_id", "note"],
                batch
            )
        except Exception as e:
            logger.error(f"Error in final COPY batch: {e}")

    await clear_import_progress("vn_seiyuu")
    logger.info(f"Imported {count} VN-seiyuu relationships ({skipped} skipped, {duplicates} duplicates)")

    # Only mark complete if data was actually imported
    if count > 0:
        await mark_import_complete(vn_seiyuu_file, "vn_seiyuu")
    else:
        logger.warning("vn_seiyuu import had 0 rows - NOT marking as complete (will retry next run)")


# ============ VN Relations Import ============

async def import_vn_relations(extract_dir: str, force: bool = False):
    """Import VN-to-VN relationships from db dump.

    The vn_relations file contains bidirectional relations:
    - id: source VN ID (numeric, e.g., "50283")
    - vid: related VN ID (numeric, e.g., "48721")
    - relation: type code (seq, preq, set, alt, char, side, par, ser, fan, orig)
    - official: boolean (t/f)

    Uses PostgreSQL COPY for fast bulk loading.

    Args:
        extract_dir: Directory with extracted dump files
        force: If True, import regardless of file modification time
    """
    vn_relations_file = None

    for root, dirs, files in os.walk(extract_dir):
        for f in files:
            if f == "vn_relations":
                vn_relations_file = os.path.join(root, f)

    if not vn_relations_file:
        logger.warning("VN relations file not found in extracted files")
        return

    # Check if import is needed
    if not await should_import(vn_relations_file, "vn_relations", force):
        return

    logger.info(f"Importing VN relations from {vn_relations_file}")

    # Read header
    header_file = vn_relations_file + ".header"
    try:
        with open(header_file, "r", encoding="utf-8") as f:
            fieldnames = f.read().strip().split("\t")
        logger.info(f"VN relations fields: {fieldnames}")
    except FileNotFoundError:
        logger.error(f"VN relations header not found: {header_file}")
        return

    # Get valid VN IDs for FK validation
    async with async_session() as db:
        vn_result = await db.execute(text("SELECT id FROM visual_novels"))
        valid_vn_ids = {row[0] for row in vn_result}
    logger.info(f"Found {len(valid_vn_ids)} VNs in database for FK validation")

    count = 0
    skipped = 0
    duplicates = 0

    # Clear existing relationships first
    async with async_session() as db:
        await db.execute(text("TRUNCATE TABLE vn_relations"))
        await db.commit()

    # Use COPY for fast bulk loading
    batch: list[tuple] = []
    seen_pairs: set[tuple] = set()
    BATCH_SIZE = 10000

    with open(vn_relations_file, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter="\t", fieldnames=fieldnames, quoting=csv.QUOTE_NONE)

        for row in reader:
            try:
                vn_id = row.get("id", "")
                if not vn_id.startswith("v"):
                    vn_id = f"v{vn_id}"

                related_vn_id = row.get("vid", "")
                if not related_vn_id.startswith("v"):
                    related_vn_id = f"v{related_vn_id}"

                # Skip if either VN doesn't exist in database
                if vn_id not in valid_vn_ids or related_vn_id not in valid_vn_ids:
                    skipped += 1
                    continue

                # Skip duplicates
                pair = (vn_id, related_vn_id)
                if pair in seen_pairs:
                    duplicates += 1
                    continue
                seen_pairs.add(pair)

                relation = row.get("relation", "")
                if relation == "\\N":
                    relation = "unknown"

                official_raw = row.get("official", "t")
                official = official_raw == "t"

                batch.append((vn_id, related_vn_id, relation, official))
                count += 1

                if len(batch) >= BATCH_SIZE:
                    try:
                        await copy_bulk_data(
                            "vn_relations",
                            ["vn_id", "related_vn_id", "relation", "official"],
                            batch
                        )
                        await set_import_progress("vn_relations", count)
                    except Exception as e:
                        logger.error(f"Error in COPY batch at count {count}: {e}")
                    batch = []

                    if count % 50000 == 0:
                        logger.info(f"Imported {count} VN relations...")

            except Exception as e:
                logger.debug(f"Error processing VN relation row: {e}")
                continue

    # Final batch
    if batch:
        try:
            await copy_bulk_data(
                "vn_relations",
                ["vn_id", "related_vn_id", "relation", "official"],
                batch
            )
        except Exception as e:
            logger.error(f"Error in final COPY batch: {e}")

    await clear_import_progress("vn_relations")
    logger.info(f"Imported {count} VN relations ({skipped} skipped, {duplicates} duplicates)")

    if count > 0:
        await mark_import_complete(vn_relations_file, "vn_relations")
    else:
        logger.warning("vn_relations import had 0 rows - NOT marking as complete (will retry next run)")


# ============ Characters Import ============

async def import_characters(extract_dir: str, force: bool = False):
    """Import characters from db dump.

    Character names are stored in a separate chars_names file, so we:
    1. Load all names from chars_names first
    2. Load image sexual ratings from images file
    3. Then iterate through chars and look up names + extract metadata

    Args:
        extract_dir: Directory with extracted dump files
        force: If True, import regardless of file modification time
    """
    chars_file = None
    chars_names_file = None
    images_file = None

    for root, dirs, files in os.walk(extract_dir):
        for f in files:
            if f == "chars":
                chars_file = os.path.join(root, f)
            if f == "chars_names":
                chars_names_file = os.path.join(root, f)
            if f == "images":
                images_file = os.path.join(root, f)

    if not chars_file:
        logger.warning("Characters file not found in extracted files")
        return

    if not chars_names_file:
        logger.warning("Character names file not found in extracted files")
        return

    # Check if import is needed
    if not await should_import(chars_file, "characters", force):
        return

    logger.info(f"Importing characters from {chars_file}")

    # Step 1: Load character names from chars_names
    # Format: id, lang, name, latin
    char_names: dict[str, tuple[str, str | None]] = {}  # id -> (name, original)

    names_header_file = chars_names_file + ".header"
    try:
        with open(names_header_file, "r", encoding="utf-8") as f:
            names_fieldnames = f.read().strip().split("\t")
        logger.info(f"Character names fields: {names_fieldnames}")
    except FileNotFoundError:
        logger.error(f"Character names header not found: {names_header_file}")
        return

    with open(chars_names_file, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter="\t", fieldnames=names_fieldnames, quoting=csv.QUOTE_NONE)
        for row in reader:
            char_id = row.get("id", "")
            if not char_id.startswith("c"):
                char_id = f"c{char_id}"

            lang = row.get("lang", "")
            name = sanitize_text(row.get("name", ""))
            latin = sanitize_text(row.get("latin", "")) if row.get("latin") != "\\N" else None

            if not name:
                continue

            # Use Japanese name as primary, latin as original (romanized)
            # If we already have a name for this character, only update if this is Japanese
            if char_id not in char_names:
                char_names[char_id] = (name, latin)
            elif lang == "ja":
                # Japanese takes priority
                char_names[char_id] = (name, latin)

    logger.info(f"Loaded {len(char_names)} character names")

    # Step 2: Load image sexual ratings for character images
    image_sexual_map = _load_image_sexual_ratings(images_file)

    # Step 3: Read chars file header
    header_file = chars_file + ".header"
    try:
        with open(header_file, "r", encoding="utf-8") as f:
            fieldnames = f.read().strip().split("\t")
        logger.info(f"Characters fields: {fieldnames}")
    except FileNotFoundError:
        logger.error(f"Characters header not found: {header_file}")
        return

    # Step 4: Import characters with names and metadata
    count = 0
    skipped = 0
    batch = []

    with open(chars_file, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter="\t", fieldnames=fieldnames, quoting=csv.QUOTE_NONE)

        for row in reader:
            try:
                char_id = row.get("id", "")
                if not char_id.startswith("c"):
                    char_id = f"c{char_id}"

                # Look up name from chars_names
                if char_id not in char_names:
                    skipped += 1
                    continue

                name, original = char_names[char_id]

                # Build character image URL from image ID
                # VNDB character images: https://t.vndb.org/ch/{subdir}/{id}.jpg
                image_url = None
                image_sexual = None
                image_id = row.get("image", "")
                if image_id and image_id != "\\N" and image_id.startswith("ch"):
                    try:
                        img_num = int(image_id[2:])
                        subdir = str(img_num % 100).zfill(2)
                        image_url = f"https://t.vndb.org/ch/{subdir}/{img_num}.jpg"
                        # Look up sexual rating from images table
                        image_sexual = image_sexual_map.get(image_id)
                    except (ValueError, TypeError):
                        pass

                # Parse optional numeric fields
                def parse_int(value: str | None) -> int | None:
                    if not value or value == "\\N":
                        return None
                    try:
                        return int(value)
                    except (ValueError, TypeError):
                        return None

                # Parse birthday (format: MMDD or just MM)
                birthday_month = None
                birthday_day = None
                birthday_raw = row.get("birthday", "")
                if birthday_raw and birthday_raw != "\\N":
                    try:
                        if len(birthday_raw) == 4:
                            birthday_month = int(birthday_raw[:2])
                            birthday_day = int(birthday_raw[2:])
                        elif len(birthday_raw) == 2:
                            birthday_month = int(birthday_raw)
                    except (ValueError, TypeError):
                        pass

                # Parse sex field (m, f, b for both)
                sex = row.get("sex", "")
                if sex == "\\N" or not sex:
                    sex = None

                # Parse blood type (a, b, ab, o)
                blood_type = row.get("bloodt", "")
                if blood_type == "\\N" or not blood_type:
                    blood_type = None

                # Get description
                description = row.get("description", "")
                if description == "\\N":
                    description = None
                else:
                    description = sanitize_text(description) or None

                batch.append({
                    "id": char_id,
                    "name": name,
                    "original": original,
                    "description": description,
                    "image_url": image_url,
                    "image_sexual": image_sexual,
                    "sex": sex,
                    "blood_type": blood_type,
                    "height": parse_int(row.get("height")),
                    "weight": parse_int(row.get("weight")),
                    "bust": parse_int(row.get("bust")),
                    "waist": parse_int(row.get("waist")),
                    "hips": parse_int(row.get("hips")),
                    "cup": row.get("cup") if row.get("cup") != "\\N" else None,
                    "age": parse_int(row.get("age")),
                    "birthday_month": birthday_month,
                    "birthday_day": birthday_day,
                })
                count += 1

                # Batch size of 100 to stay well under PostgreSQL's parameter limit
                # (100 chars × 17 columns = 1700 params, limit is ~32767)
                if len(batch) >= 100:
                    try:
                        async with asyncio.timeout(120):  # 2 minute timeout per batch
                            async with async_session() as db:
                                await _upsert_characters(db, batch)
                                await db.commit()
                    except asyncio.TimeoutError:
                        logger.error(f"Timeout during character batch at count {count}, last char: {char_id}")
                        raise
                    except Exception as e:
                        logger.error(f"Error in character batch at count {count}: {e}")
                        raise
                    batch = []

                    if count % 1000 == 0:  # More frequent logging
                        logger.info(f"Imported {count} characters...")

            except Exception as e:
                logger.debug(f"Error processing character row: {e}")
                continue

    if batch:
        logger.info(f"Processing final batch of {len(batch)} characters...")
        try:
            async with asyncio.timeout(120):  # 2 minute timeout
                async with async_session() as db:
                    await _upsert_characters(db, batch)
                    await db.commit()
        except asyncio.TimeoutError:
            logger.error(f"Timeout during final character batch at count {count}")
            raise
        except Exception as e:
            logger.error(f"Error in final character batch at count {count}: {e}")
            raise

    logger.info(f"Imported {count} characters ({skipped} skipped without names)")

    # Mark import as complete
    await mark_import_complete(chars_file, "characters")


async def _upsert_characters(db: AsyncSession, batch: list[dict]):
    """Upsert a batch of characters."""
    stmt = insert(Character).values(batch)
    stmt = stmt.on_conflict_do_update(
        index_elements=["id"],
        set_={
            "name": stmt.excluded.name,
            "original": stmt.excluded.original,
            "description": stmt.excluded.description,
            "image_url": stmt.excluded.image_url,
            "image_sexual": stmt.excluded.image_sexual,
            "sex": stmt.excluded.sex,
            "blood_type": stmt.excluded.blood_type,
            "height": stmt.excluded.height,
            "weight": stmt.excluded.weight,
            "bust": stmt.excluded.bust,
            "waist": stmt.excluded.waist,
            "hips": stmt.excluded.hips,
            "cup": stmt.excluded.cup,
            "age": stmt.excluded.age,
            "birthday_month": stmt.excluded.birthday_month,
            "birthday_day": stmt.excluded.birthday_day,
        }
    )
    await db.execute(stmt)


# ============ Character-VN Import ============

async def import_character_vns(extract_dir: str, force: bool = False):
    """Import character-VN relationships from db dump.

    Uses PostgreSQL COPY for fast bulk loading (10-100x faster than INSERT).

    Args:
        extract_dir: Directory with extracted dump files
        force: If True, import regardless of file modification time
    """
    chars_vns_file = None

    for root, dirs, files in os.walk(extract_dir):
        for f in files:
            if f == "chars_vns":
                chars_vns_file = os.path.join(root, f)
                break

    if not chars_vns_file:
        logger.warning("Character-VN file not found in extracted files")
        return

    # Check if import is needed
    if not await should_import(chars_vns_file, "character_vns", force):
        return

    logger.info(f"Importing character-VN from {chars_vns_file}")

    # Read header
    header_file = chars_vns_file + ".header"
    try:
        with open(header_file, "r", encoding="utf-8") as f:
            fieldnames = f.read().strip().split("\t")
        logger.info(f"Character-VN fields: {fieldnames}")
    except FileNotFoundError:
        logger.error(f"Character-VN header not found: {header_file}")
        return

    # Get valid character and VN IDs
    async with async_session() as db:
        char_result = await db.execute(text("SELECT id FROM characters"))
        valid_char_ids = {row[0] for row in char_result}
        vn_result = await db.execute(text("SELECT id FROM visual_novels"))
        valid_vn_ids = {row[0] for row in vn_result}
    logger.info(f"Found {len(valid_char_ids)} characters and {len(valid_vn_ids)} VNs in database")

    count = 0
    skipped = 0
    duplicates = 0

    # Clear existing relationships first
    async with async_session() as db:
        await db.execute(text("TRUNCATE TABLE character_vn"))
        await db.commit()

    # Use COPY for fast bulk loading
    batch: list[tuple] = []
    BATCH_SIZE = 10000
    # Track seen pairs to avoid duplicates (PK is character_id + vn_id)
    seen_pairs: set[tuple[str, str]] = set()

    with open(chars_vns_file, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter="\t", fieldnames=fieldnames, quoting=csv.QUOTE_NONE)

        for row in reader:
            try:
                char_id = row.get("id", "")
                if not char_id.startswith("c"):
                    char_id = f"c{char_id}"

                vn_id = row.get("vid", "")
                if not vn_id.startswith("v"):
                    vn_id = f"v{vn_id}"

                # Skip if character or VN doesn't exist
                if char_id not in valid_char_ids or vn_id not in valid_vn_ids:
                    skipped += 1
                    continue

                # Skip duplicates (same character + VN pair)
                pair = (char_id, vn_id)
                if pair in seen_pairs:
                    duplicates += 1
                    continue
                seen_pairs.add(pair)

                role = row.get("role", "")
                if role == "\\N":
                    role = None

                spoiler_level = row.get("spoil", "0")
                if spoiler_level == "\\N" or not spoiler_level:
                    spoiler_level = 0
                else:
                    spoiler_level = int(spoiler_level)

                release_id = row.get("rid", "")
                if release_id == "\\N":
                    release_id = None

                # Tuple format for COPY: (character_id, vn_id, role, spoiler_level, release_id)
                batch.append((char_id, vn_id, role, spoiler_level, release_id))
                count += 1

                if len(batch) >= BATCH_SIZE:
                    try:
                        await copy_bulk_data(
                            "character_vn",
                            ["character_id", "vn_id", "role", "spoiler_level", "release_id"],
                            batch
                        )
                        await set_import_progress("character_vn", count)
                    except Exception as e:
                        logger.error(f"Error in COPY batch at count {count}: {e}")
                    batch = []

                    if count % 50000 == 0:
                        logger.info(f"Imported {count} character-VN relationships...")

            except Exception as e:
                logger.debug(f"Error processing character-VN row: {e}")
                continue

    # Final batch
    if batch:
        try:
            await copy_bulk_data(
                "character_vn",
                ["character_id", "vn_id", "role", "spoiler_level", "release_id"],
                batch
            )
        except Exception as e:
            logger.error(f"Error in final COPY batch: {e}")

    await clear_import_progress("character_vn")
    logger.info(f"Imported {count} character-VN relationships ({skipped} skipped, {duplicates} duplicates)")

    # Mark import as complete
    await mark_import_complete(chars_vns_file, "character_vns")


# ============ Character Traits Import ============

async def import_character_traits(extract_dir: str, force: bool = False):
    """Import character-trait relationships from db dump.

    Uses PostgreSQL COPY for fast bulk loading (10-100x faster than INSERT).

    Args:
        extract_dir: Directory with extracted dump files
        force: If True, import regardless of file modification time
    """
    chars_traits_file = None

    for root, dirs, files in os.walk(extract_dir):
        for f in files:
            if f == "chars_traits":
                chars_traits_file = os.path.join(root, f)
                break

    if not chars_traits_file:
        logger.warning("Character traits file not found in extracted files")
        return

    # Check if import is needed
    if not await should_import(chars_traits_file, "character_traits", force):
        return

    logger.info(f"Importing character traits from {chars_traits_file}")

    # Read header
    header_file = chars_traits_file + ".header"
    try:
        with open(header_file, "r", encoding="utf-8") as f:
            fieldnames = f.read().strip().split("\t")
        logger.info(f"Character traits fields: {fieldnames}")
    except FileNotFoundError:
        logger.error(f"Character traits header not found: {header_file}")
        return

    # Get valid character and trait IDs
    async with async_session() as db:
        char_result = await db.execute(text("SELECT id FROM characters"))
        valid_char_ids = {row[0] for row in char_result}
        trait_result = await db.execute(text("SELECT id FROM traits"))
        valid_trait_ids = {row[0] for row in trait_result}
    logger.info(f"Found {len(valid_char_ids)} characters and {len(valid_trait_ids)} traits in database")

    count = 0
    skipped = 0

    # Clear existing relationships first
    async with async_session() as db:
        await db.execute(text("TRUNCATE TABLE character_traits"))
        await db.commit()

    # Use COPY for fast bulk loading
    batch: list[tuple] = []
    BATCH_SIZE = 10000

    with open(chars_traits_file, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter="\t", fieldnames=fieldnames, quoting=csv.QUOTE_NONE)

        for row in reader:
            try:
                char_id = row.get("id", "")
                if not char_id.startswith("c"):
                    char_id = f"c{char_id}"

                # Trait ID has 'i' prefix in dump (e.g., 'i1')
                trait_raw = row.get("tid", "")
                if trait_raw.startswith("i"):
                    trait_raw = trait_raw[1:]
                trait_id = int(trait_raw)

                # Skip if character or trait doesn't exist
                if char_id not in valid_char_ids or trait_id not in valid_trait_ids:
                    skipped += 1
                    continue

                spoiler_raw = row.get("spoil", "0")
                spoiler = int(spoiler_raw) if spoiler_raw and spoiler_raw != "\\N" else 0

                # Tuple format for COPY: (character_id, trait_id, spoiler_level)
                batch.append((char_id, trait_id, spoiler))
                count += 1

                if len(batch) >= BATCH_SIZE:
                    try:
                        await copy_bulk_data(
                            "character_traits",
                            ["character_id", "trait_id", "spoiler_level"],
                            batch
                        )
                        await set_import_progress("character_traits", count)
                    except Exception as e:
                        logger.error(f"Error in COPY batch at count {count}: {e}")
                    batch = []

                    if count % 100000 == 0:
                        logger.info(f"Imported {count} character-trait relationships...")

            except Exception as e:
                logger.debug(f"Error processing character trait row: {e}")
                continue

    # Final batch
    if batch:
        try:
            await copy_bulk_data(
                "character_traits",
                ["character_id", "trait_id", "spoiler_level"],
                batch
            )
        except Exception as e:
            logger.error(f"Error in final COPY batch: {e}")

    await clear_import_progress("character_traits")
    logger.info(f"Imported {count} character-trait relationships ({skipped} skipped)")

    # Mark import as complete
    await mark_import_complete(chars_traits_file, "character_traits")


# ============ Release Import (for Publishers) ============

async def import_releases(extract_dir: str, force: bool = False):
    """Import releases from db dump.

    Release titles are stored in a separate releases_titles file, so we:
    1. Load all titles from releases_titles first
    2. Then iterate through releases and look up titles

    Args:
        extract_dir: Directory with extracted dump files
        force: If True, import regardless of file modification time
    """
    releases_file = None
    releases_titles_file = None

    for root, dirs, files in os.walk(extract_dir):
        for f in files:
            if f == "releases":
                releases_file = os.path.join(root, f)
            if f == "releases_titles":
                releases_titles_file = os.path.join(root, f)

    if not releases_file:
        logger.warning("Releases file not found in extracted files")
        return

    if not releases_titles_file:
        logger.warning("Release titles file not found in extracted files")
        return

    # Check if import is needed
    if not await should_import(releases_file, "releases", force):
        return

    logger.info(f"Importing releases from {releases_file}")

    # Step 1: Load release titles from releases_titles
    # Format: id, lang, mtl, title, latin
    release_titles: dict[str, str] = {}  # id -> title

    titles_header_file = releases_titles_file + ".header"
    try:
        with open(titles_header_file, "r", encoding="utf-8") as f:
            titles_fieldnames = f.read().strip().split("\t")
        logger.info(f"Release titles fields: {titles_fieldnames}")
    except FileNotFoundError:
        logger.error(f"Release titles header not found: {titles_header_file}")
        return

    with open(releases_titles_file, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter="\t", fieldnames=titles_fieldnames, quoting=csv.QUOTE_NONE)
        for row in reader:
            release_id = row.get("id", "")
            if not release_id.startswith("r"):
                release_id = f"r{release_id}"

            lang = row.get("lang", "")
            title = sanitize_text(row.get("title", ""))

            if not title:
                continue

            # Prefer Japanese title, then English, then whatever is available
            if release_id not in release_titles:
                release_titles[release_id] = title
            elif lang == "ja":
                release_titles[release_id] = title
            elif lang == "en" and release_id in release_titles:
                # Only use English if no Japanese
                pass  # Keep existing

    logger.info(f"Loaded {len(release_titles)} release titles")

    # Step 2: Read releases header
    header_file = releases_file + ".header"
    try:
        with open(header_file, "r", encoding="utf-8") as f:
            fieldnames = f.read().strip().split("\t")
        logger.info(f"Releases fields: {fieldnames}")
    except FileNotFoundError:
        logger.error(f"Releases header not found: {header_file}")
        return

    # Step 3: Import releases with titles
    count = 0
    batch = []

    with open(releases_file, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter="\t", fieldnames=fieldnames, quoting=csv.QUOTE_NONE)

        for row in reader:
            try:
                release_id = row.get("id", "")
                if not release_id.startswith("r"):
                    release_id = f"r{release_id}"

                # Look up title from releases_titles
                title = release_titles.get(release_id, "")

                # Parse release date
                released_date = None
                released_raw = row.get("released", "")
                if released_raw and released_raw != "\\N" and released_raw != "0":
                    try:
                        released_int = int(released_raw)
                        if released_int >= 19800000:
                            year = released_int // 10000
                            month = (released_int // 100) % 100
                            day = released_int % 100
                            if month == 0:
                                month = 1
                            if day == 0:
                                day = 1
                            if 1980 <= year <= 2100:
                                released_date = date(year, month, day)
                    except (ValueError, TypeError):
                        pass

                # Parse minage
                minage = None
                minage_raw = row.get("minage", "")
                if minage_raw and minage_raw != "\\N":
                    try:
                        minage = int(minage_raw)
                    except (ValueError, TypeError):
                        pass

                # Parse new extended fields
                gtin = None
                gtin_raw = row.get("gtin", "")
                if gtin_raw and gtin_raw != "\\N":
                    try:
                        gtin = int(gtin_raw)
                    except (ValueError, TypeError):
                        pass

                olang = row.get("olang", "")
                if olang == "\\N":
                    olang = None

                voiced = None
                voiced_raw = row.get("voiced", "")
                if voiced_raw and voiced_raw != "\\N":
                    try:
                        voiced = int(voiced_raw)
                    except (ValueError, TypeError):
                        pass

                reso_x = None
                reso_x_raw = row.get("reso_x", "")
                if reso_x_raw and reso_x_raw != "\\N":
                    try:
                        reso_x = int(reso_x_raw)
                    except (ValueError, TypeError):
                        pass

                reso_y = None
                reso_y_raw = row.get("reso_y", "")
                if reso_y_raw and reso_y_raw != "\\N":
                    try:
                        reso_y = int(reso_y_raw)
                    except (ValueError, TypeError):
                        pass

                # Boolean fields - PostgreSQL uses 't'/'f'
                has_ero = row.get("has_ero", "f") == "t"
                patch = row.get("patch", "f") == "t"
                freeware = row.get("freeware", "f") == "t"
                doujin = row.get("doujin", "f") == "t"
                uncensored = row.get("uncensored", "f") == "t"
                official = row.get("official", "t") == "t"  # Default true

                catalog = sanitize_text(row.get("catalog", "")) or None
                if catalog == "\\N":
                    catalog = None

                notes = sanitize_text(row.get("notes", "")) or None
                if notes == "\\N":
                    notes = None

                engine = sanitize_text(row.get("engine", "")) or None
                if engine == "\\N":
                    engine = None

                batch.append({
                    "id": release_id,
                    "title": title,
                    "released": released_date,
                    "minage": minage,
                    "gtin": gtin,
                    "olang": olang,
                    "voiced": voiced,
                    "reso_x": reso_x,
                    "reso_y": reso_y,
                    "has_ero": has_ero,
                    "patch": patch,
                    "freeware": freeware,
                    "doujin": doujin,
                    "uncensored": uncensored,
                    "official": official,
                    "catalog": catalog,
                    "notes": notes,
                    "engine": engine,
                })
                count += 1

                if len(batch) >= 500:
                    async with async_session() as db:
                        await _upsert_releases(db, batch)
                        await db.commit()
                    batch = []

                    if count % 10000 == 0:
                        logger.info(f"Imported {count} releases...")

            except Exception as e:
                logger.debug(f"Error processing release row: {e}")
                continue

    if batch:
        async with async_session() as db:
            await _upsert_releases(db, batch)
            await db.commit()

    logger.info(f"Imported {count} releases")

    # Mark import as complete
    await mark_import_complete(releases_file, "releases")


async def _upsert_releases(db: AsyncSession, batch: list[dict]):
    """Upsert a batch of releases with all extended fields."""
    stmt = insert(Release).values(batch)
    stmt = stmt.on_conflict_do_update(
        index_elements=["id"],
        set_={
            "title": stmt.excluded.title,
            "released": stmt.excluded.released,
            "minage": stmt.excluded.minage,
            "gtin": stmt.excluded.gtin,
            "olang": stmt.excluded.olang,
            "voiced": stmt.excluded.voiced,
            "reso_x": stmt.excluded.reso_x,
            "reso_y": stmt.excluded.reso_y,
            "has_ero": stmt.excluded.has_ero,
            "patch": stmt.excluded.patch,
            "freeware": stmt.excluded.freeware,
            "doujin": stmt.excluded.doujin,
            "uncensored": stmt.excluded.uncensored,
            "official": stmt.excluded.official,
            "catalog": stmt.excluded.catalog,
            "notes": stmt.excluded.notes,
            "engine": stmt.excluded.engine,
        }
    )
    await db.execute(stmt)


async def import_release_vns(extract_dir: str, force: bool = False):
    """Import release-VN relationships from db dump with release type.

    Uses PostgreSQL COPY for fast bulk loading (10-100x faster than INSERT).

    The rtype field is critical for filtering trial/partial releases from stats.
    Values: "complete", "partial", "trial"

    Args:
        extract_dir: Directory with extracted dump files
        force: If True, import regardless of file modification time
    """
    release_vn_file = None

    for root, dirs, files in os.walk(extract_dir):
        for f in files:
            if f == "releases_vn":
                release_vn_file = os.path.join(root, f)
                break

    if not release_vn_file:
        logger.warning("Release-VN file not found in extracted files")
        return

    # Check if import is needed
    if not await should_import(release_vn_file, "release_vn", force):
        return

    logger.info(f"Importing release-VN from {release_vn_file}")

    # Read header
    header_file = release_vn_file + ".header"
    try:
        with open(header_file, "r", encoding="utf-8") as f:
            fieldnames = f.read().strip().split("\t")
        logger.info(f"Release-VN fields: {fieldnames}")
    except FileNotFoundError:
        logger.error(f"Release-VN header not found: {header_file}")
        return

    # Get valid release and VN IDs
    async with async_session() as db:
        release_result = await db.execute(text("SELECT id FROM releases"))
        valid_release_ids = {row[0] for row in release_result}
        vn_result = await db.execute(text("SELECT id FROM visual_novels"))
        valid_vn_ids = {row[0] for row in vn_result}
    logger.info(f"Found {len(valid_release_ids)} releases and {len(valid_vn_ids)} VNs in database")

    count = 0
    skipped = 0

    # Clear existing relationships first
    async with async_session() as db:
        await db.execute(text("TRUNCATE TABLE release_vn"))
        await db.commit()

    # Use COPY for fast bulk loading
    batch: list[tuple] = []
    BATCH_SIZE = 10000

    with open(release_vn_file, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter="\t", fieldnames=fieldnames, quoting=csv.QUOTE_NONE)

        for row in reader:
            try:
                release_id = row.get("id", "")
                if not release_id.startswith("r"):
                    release_id = f"r{release_id}"

                vn_id = row.get("vid", "")
                if not vn_id.startswith("v"):
                    vn_id = f"v{vn_id}"

                # Skip if release or VN doesn't exist
                if release_id not in valid_release_ids or vn_id not in valid_vn_ids:
                    skipped += 1
                    continue

                # Parse release type - critical for filtering trials from stats
                rtype = row.get("rtype", "")
                if rtype == "\\N" or not rtype:
                    rtype = None  # Default to None if not specified

                # Tuple format for COPY: (release_id, vn_id, rtype)
                batch.append((release_id, vn_id, rtype))
                count += 1

                if len(batch) >= BATCH_SIZE:
                    try:
                        await copy_bulk_data(
                            "release_vn",
                            ["release_id", "vn_id", "rtype"],
                            batch
                        )
                        await set_import_progress("release_vn", count)
                    except Exception as e:
                        logger.error(f"Error in COPY batch at count {count}: {e}")
                    batch = []

                    if count % 50000 == 0:
                        logger.info(f"Imported {count} release-VN relationships...")

            except Exception as e:
                logger.debug(f"Error processing release-VN row: {e}")
                continue

    # Final batch
    if batch:
        try:
            await copy_bulk_data(
                "release_vn",
                ["release_id", "vn_id", "rtype"],
                batch
            )
        except Exception as e:
            logger.error(f"Error in final COPY batch: {e}")

    await clear_import_progress("release_vn")
    logger.info(f"Imported {count} release-VN relationships ({skipped} skipped)")

    # Mark import as complete
    await mark_import_complete(release_vn_file, "release_vn")


async def import_release_producers(extract_dir: str, force: bool = False):
    """Import release-producer relationships from db dump.

    Uses PostgreSQL COPY for fast bulk loading (10-100x faster than INSERT).

    Args:
        extract_dir: Directory with extracted dump files
        force: If True, import regardless of file modification time
    """
    release_prod_file = None

    for root, dirs, files in os.walk(extract_dir):
        for f in files:
            if f == "releases_producers":
                release_prod_file = os.path.join(root, f)
                break

    if not release_prod_file:
        logger.warning("Release-producers file not found in extracted files")
        return

    # Check if import is needed
    if not await should_import(release_prod_file, "release_producers", force):
        return

    logger.info(f"Importing release-producers from {release_prod_file}")

    # Read header
    header_file = release_prod_file + ".header"
    try:
        with open(header_file, "r", encoding="utf-8") as f:
            fieldnames = f.read().strip().split("\t")
        logger.info(f"Release-producers fields: {fieldnames}")
    except FileNotFoundError:
        logger.error(f"Release-producers header not found: {header_file}")
        return

    # Get valid release and producer IDs
    async with async_session() as db:
        release_result = await db.execute(text("SELECT id FROM releases"))
        valid_release_ids = {row[0] for row in release_result}
        producer_result = await db.execute(text("SELECT id FROM producers"))
        valid_producer_ids = {row[0] for row in producer_result}
    logger.info(f"Found {len(valid_release_ids)} releases and {len(valid_producer_ids)} producers in database")

    count = 0
    skipped = 0

    # Clear existing relationships first
    async with async_session() as db:
        await db.execute(text("TRUNCATE TABLE release_producers"))
        await db.commit()

    # Use COPY for fast bulk loading
    batch: list[tuple] = []
    BATCH_SIZE = 10000

    with open(release_prod_file, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter="\t", fieldnames=fieldnames, quoting=csv.QUOTE_NONE)

        for row in reader:
            try:
                release_id = row.get("id", "")
                if not release_id.startswith("r"):
                    release_id = f"r{release_id}"

                producer_id = row.get("pid", "")
                if not producer_id.startswith("p"):
                    producer_id = f"p{producer_id}"

                # Skip if release or producer doesn't exist
                if release_id not in valid_release_ids or producer_id not in valid_producer_ids:
                    skipped += 1
                    continue

                # Parse developer/publisher flags
                developer = row.get("developer", "f") == "t"
                publisher = row.get("publisher", "f") == "t"

                # Tuple format for COPY: (release_id, producer_id, developer, publisher)
                batch.append((release_id, producer_id, developer, publisher))
                count += 1

                if len(batch) >= BATCH_SIZE:
                    try:
                        await copy_bulk_data(
                            "release_producers",
                            ["release_id", "producer_id", "developer", "publisher"],
                            batch
                        )
                        await set_import_progress("release_producers", count)
                    except Exception as e:
                        logger.error(f"Error in COPY batch at count {count}: {e}")
                    batch = []

                    if count % 50000 == 0:
                        logger.info(f"Imported {count} release-producer relationships...")

            except Exception as e:
                logger.debug(f"Error processing release-producer row: {e}")
                continue

    # Final batch
    if batch:
        try:
            await copy_bulk_data(
                "release_producers",
                ["release_id", "producer_id", "developer", "publisher"],
                batch
            )
        except Exception as e:
            logger.error(f"Error in final COPY batch: {e}")

    await clear_import_progress("release_producers")
    logger.info(f"Imported {count} release-producer relationships ({skipped} skipped)")

    # Only mark complete if data was actually imported
    if count > 0:
        await mark_import_complete(release_prod_file, "release_producers")
    else:
        logger.warning("release_producers import had 0 rows - NOT marking as complete (will retry next run)")


async def import_release_platforms(extract_dir: str, force: bool = False):
    """Import release platform data from db dump.

    Uses PostgreSQL COPY for fast bulk loading.

    Args:
        extract_dir: Directory with extracted dump files
        force: If True, import regardless of file modification time
    """
    platforms_file = None

    for root, dirs, files in os.walk(extract_dir):
        for f in files:
            if f == "releases_platforms":
                platforms_file = os.path.join(root, f)
                break

    if not platforms_file:
        logger.warning("Release platforms file not found in extracted files")
        return

    # Check if import is needed
    if not await should_import(platforms_file, "release_platforms", force):
        return

    logger.info(f"Importing release platforms from {platforms_file}")

    # Read header
    header_file = platforms_file + ".header"
    try:
        with open(header_file, "r", encoding="utf-8") as f:
            fieldnames = f.read().strip().split("\t")
        logger.info(f"Release platforms fields: {fieldnames}")
    except FileNotFoundError:
        logger.error(f"Release platforms header not found: {header_file}")
        return

    # Get valid release IDs
    async with async_session() as db:
        release_result = await db.execute(text("SELECT id FROM releases"))
        valid_release_ids = {row[0] for row in release_result}
    logger.info(f"Found {len(valid_release_ids)} releases in database")

    count = 0
    skipped = 0

    # Clear existing data first
    async with async_session() as db:
        await db.execute(text("TRUNCATE TABLE release_platforms"))
        await db.commit()

    # Use COPY for fast bulk loading
    batch: list[tuple] = []
    BATCH_SIZE = 10000

    with open(platforms_file, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter="\t", fieldnames=fieldnames, quoting=csv.QUOTE_NONE)

        for row in reader:
            try:
                release_id = row.get("id", "")
                if not release_id.startswith("r"):
                    release_id = f"r{release_id}"

                # Skip if release doesn't exist
                if release_id not in valid_release_ids:
                    skipped += 1
                    continue

                platform = row.get("platform", "")
                if platform == "\\N" or not platform:
                    continue

                batch.append((release_id, platform))
                count += 1

                if len(batch) >= BATCH_SIZE:
                    try:
                        await copy_bulk_data(
                            "release_platforms",
                            ["release_id", "platform"],
                            batch
                        )
                    except Exception as e:
                        logger.error(f"Error in COPY batch at count {count}: {e}")
                    batch = []

                    if count % 50000 == 0:
                        logger.info(f"Imported {count} release platforms...")

            except Exception as e:
                logger.debug(f"Error processing release platform row: {e}")
                continue

    # Final batch
    if batch:
        try:
            await copy_bulk_data(
                "release_platforms",
                ["release_id", "platform"],
                batch
            )
        except Exception as e:
            logger.error(f"Error in final COPY batch: {e}")

    logger.info(f"Imported {count} release platforms ({skipped} skipped)")
    await mark_import_complete(platforms_file, "release_platforms")


async def import_release_media(extract_dir: str, force: bool = False):
    """Import release media data from db dump.

    Uses PostgreSQL COPY for fast bulk loading.

    Args:
        extract_dir: Directory with extracted dump files
        force: If True, import regardless of file modification time
    """
    media_file = None

    for root, dirs, files in os.walk(extract_dir):
        for f in files:
            if f == "releases_media":
                media_file = os.path.join(root, f)
                break

    if not media_file:
        logger.warning("Release media file not found in extracted files")
        return

    # Check if import is needed
    if not await should_import(media_file, "release_media", force):
        return

    logger.info(f"Importing release media from {media_file}")

    # Read header
    header_file = media_file + ".header"
    try:
        with open(header_file, "r", encoding="utf-8") as f:
            fieldnames = f.read().strip().split("\t")
        logger.info(f"Release media fields: {fieldnames}")
    except FileNotFoundError:
        logger.error(f"Release media header not found: {header_file}")
        return

    # Get valid release IDs
    async with async_session() as db:
        release_result = await db.execute(text("SELECT id FROM releases"))
        valid_release_ids = {row[0] for row in release_result}
    logger.info(f"Found {len(valid_release_ids)} releases in database")

    count = 0
    skipped = 0

    # Clear existing data first
    async with async_session() as db:
        await db.execute(text("TRUNCATE TABLE release_media"))
        await db.commit()

    # Use COPY for fast bulk loading
    batch: list[tuple] = []
    BATCH_SIZE = 10000

    with open(media_file, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter="\t", fieldnames=fieldnames, quoting=csv.QUOTE_NONE)

        for row in reader:
            try:
                release_id = row.get("id", "")
                if not release_id.startswith("r"):
                    release_id = f"r{release_id}"

                # Skip if release doesn't exist
                if release_id not in valid_release_ids:
                    skipped += 1
                    continue

                medium = row.get("medium", "")
                if medium == "\\N" or not medium:
                    continue

                qty_raw = row.get("qty", "1")
                try:
                    quantity = int(qty_raw) if qty_raw and qty_raw != "\\N" else 1
                except ValueError:
                    quantity = 1

                batch.append((release_id, medium, quantity))
                count += 1

                if len(batch) >= BATCH_SIZE:
                    try:
                        await copy_bulk_data(
                            "release_media",
                            ["release_id", "medium", "quantity"],
                            batch
                        )
                    except Exception as e:
                        logger.error(f"Error in COPY batch at count {count}: {e}")
                    batch = []

                    if count % 50000 == 0:
                        logger.info(f"Imported {count} release media entries...")

            except Exception as e:
                logger.debug(f"Error processing release media row: {e}")
                continue

    # Final batch
    if batch:
        try:
            await copy_bulk_data(
                "release_media",
                ["release_id", "medium", "quantity"],
                batch
            )
        except Exception as e:
            logger.error(f"Error in final COPY batch: {e}")

    logger.info(f"Imported {count} release media entries ({skipped} skipped)")
    await mark_import_complete(media_file, "release_media")


async def import_release_extlinks(extract_dir: str, force: bool = False):
    """Import release external links from db dump.

    Uses PostgreSQL COPY for fast bulk loading.

    Args:
        extract_dir: Directory with extracted dump files
        force: If True, import regardless of file modification time
    """
    extlinks_file = None

    for root, dirs, files in os.walk(extract_dir):
        for f in files:
            if f == "releases_extlinks":
                extlinks_file = os.path.join(root, f)
                break

    if not extlinks_file:
        logger.warning("Release extlinks file not found in extracted files")
        return

    # Check if import is needed
    if not await should_import(extlinks_file, "release_extlinks", force):
        return

    logger.info(f"Importing release extlinks from {extlinks_file}")

    # Read header
    header_file = extlinks_file + ".header"
    try:
        with open(header_file, "r", encoding="utf-8") as f:
            fieldnames = f.read().strip().split("\t")
        logger.info(f"Release extlinks fields: {fieldnames}")
    except FileNotFoundError:
        logger.error(f"Release extlinks header not found: {header_file}")
        return

    # Get valid release IDs
    async with async_session() as db:
        release_result = await db.execute(text("SELECT id FROM releases"))
        valid_release_ids = {row[0] for row in release_result}
    logger.info(f"Found {len(valid_release_ids)} releases in database")

    count = 0
    skipped = 0

    # Clear existing data first
    async with async_session() as db:
        await db.execute(text("TRUNCATE TABLE release_extlinks"))
        await db.commit()

    # Use COPY for fast bulk loading
    batch: list[tuple] = []
    BATCH_SIZE = 10000

    with open(extlinks_file, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter="\t", fieldnames=fieldnames, quoting=csv.QUOTE_NONE)

        for row in reader:
            try:
                release_id = row.get("id", "")
                if not release_id.startswith("r"):
                    release_id = f"r{release_id}"

                # Skip if release doesn't exist
                if release_id not in valid_release_ids:
                    skipped += 1
                    continue

                # Site/link type - map numeric ID to string if needed
                site = row.get("site", "") or row.get("link", "")
                if site == "\\N" or not site:
                    continue

                # URL - may need to be constructed from site + value
                url = sanitize_text(row.get("url", "")) or sanitize_text(row.get("val", ""))
                if url == "\\N":
                    url = None

                batch.append((release_id, str(site), url))
                count += 1

                if len(batch) >= BATCH_SIZE:
                    try:
                        await copy_bulk_data(
                            "release_extlinks",
                            ["release_id", "site", "url"],
                            batch
                        )
                    except Exception as e:
                        logger.error(f"Error in COPY batch at count {count}: {e}")
                    batch = []

                    if count % 50000 == 0:
                        logger.info(f"Imported {count} release extlinks...")

            except Exception as e:
                logger.debug(f"Error processing release extlink row: {e}")
                continue

    # Final batch
    if batch:
        try:
            await copy_bulk_data(
                "release_extlinks",
                ["release_id", "site", "url"],
                batch
            )
        except Exception as e:
            logger.error(f"Error in final COPY batch: {e}")

    logger.info(f"Imported {count} release extlinks ({skipped} skipped)")
    await mark_import_complete(extlinks_file, "release_extlinks")


# ==================== User List Tables ====================


def _parse_date_to_timestamp(date_str: str | None) -> int | None:
    """Convert ISO date string to Unix timestamp."""
    if not date_str or date_str == "\\N":
        return None
    try:
        d = date.fromisoformat(date_str)
        # Convert to Unix timestamp (midnight UTC)
        return int(datetime.combine(d, datetime.min.time()).timestamp())
    except (ValueError, TypeError):
        return None


def _parse_labels_array(labels_str: str | None) -> list[int]:
    """Parse PostgreSQL array string like '{4,7}' into list of ints."""
    if not labels_str or labels_str == "\\N" or labels_str == "{}":
        return []
    try:
        # Remove braces and split
        inner = labels_str.strip("{}")
        if not inner:
            return []
        return [int(x) for x in inner.split(",") if x]
    except (ValueError, TypeError):
        return []


async def import_ulist_vns(extract_dir: str, force: bool = False):
    """Import user VN list entries from ulist_vns file.

    This table contains user VN lists - what VNs each user has added to their list,
    their votes, and dates for starting/finishing. This is the PRIMARY source of
    user list data, replacing VNDB API calls.

    File format (tab-separated):
    uid, vid, added, lastmod, vote_date, started, finished, vote, notes, labels

    The 'labels' column contains embedded label IDs like {2,7} which we also
    insert into the ulist_labels table.

    Args:
        extract_dir: Directory with extracted dump files
        force: If True, import regardless of file modification time
    """
    ulist_file = None

    for root, dirs, files in os.walk(extract_dir):
        for f in files:
            if f == "ulist_vns":
                ulist_file = os.path.join(root, f)

    if not ulist_file:
        logger.warning("ulist_vns file not found in extracted files")
        return

    # Check if import is needed
    if not await should_import(ulist_file, "ulist_vns", force):
        return

    logger.info(f"Importing user VN lists from {ulist_file}")

    # Read header to get field positions
    header_file = ulist_file + ".header"
    try:
        with open(header_file, "r", encoding="utf-8") as f:
            fieldnames = f.read().strip().split("\t")
        logger.info(f"ulist_vns fields: {fieldnames}")
    except FileNotFoundError:
        logger.error(f"ulist_vns header not found: {header_file}")
        return

    # Get valid VN IDs from database for validation
    async with async_session() as db:
        result = await db.execute(text("SELECT id FROM visual_novels"))
        valid_vn_ids = {row[0] for row in result}
    logger.info(f"Found {len(valid_vn_ids)} VNs in database for ulist filtering")

    # Clear existing user list data (they're replaced on each import)
    async with async_session() as db:
        await db.execute(text("TRUNCATE TABLE ulist_vns"))
        await db.execute(text("TRUNCATE TABLE ulist_labels"))
        await db.commit()

    count = 0
    labels_count = 0
    skipped = 0
    vn_batch: list[tuple] = []
    label_batch: list[tuple] = []
    seen_labels: set[tuple[str, str, int]] = set()  # Track unique (uid, vid, label) to avoid duplicates
    BATCH_SIZE = 10000

    with open(ulist_file, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter="\t", fieldnames=fieldnames, quoting=csv.QUOTE_NONE)

        for row in reader:
            try:
                uid = row.get("uid", "")
                vid = row.get("vid", "")

                if not uid or not vid:
                    skipped += 1
                    continue

                # Add prefixes if missing
                if not uid.startswith("u"):
                    uid = f"u{uid}"
                if not vid.startswith("v"):
                    vid = f"v{vid}"

                # Skip entries for non-existent VNs
                if vid not in valid_vn_ids:
                    skipped += 1
                    continue

                # Parse dates to Unix timestamps
                added = _parse_date_to_timestamp(row.get("added", ""))
                lastmod = _parse_date_to_timestamp(row.get("lastmod", ""))
                vote_date = _parse_date_to_timestamp(row.get("vote_date", ""))

                # Parse vote (10-100 scale)
                vote_str = row.get("vote", "")
                vote = int(vote_str) if vote_str and vote_str != "\\N" else None

                # Parse dates for started/finished
                started_str = row.get("started", "")
                started = date.fromisoformat(started_str) if started_str and started_str != "\\N" else None

                finished_str = row.get("finished", "")
                finished = date.fromisoformat(finished_str) if finished_str and finished_str != "\\N" else None

                # Notes (sanitize for null bytes)
                notes = row.get("notes", "")
                notes = sanitize_text(notes) if notes and notes != "\\N" else None

                # Parse labels array like {2,7}
                labels = _parse_labels_array(row.get("labels", ""))

                # Add VN entry
                vn_batch.append((
                    uid,
                    vid,
                    added,
                    lastmod,
                    vote_date,
                    vote,
                    started,
                    finished,
                    notes,
                ))
                count += 1

                # Add label entries (deduplicated)
                for label_id in labels:
                    label_key = (uid, vid, label_id)
                    if label_key not in seen_labels:
                        seen_labels.add(label_key)
                        label_batch.append((uid, vid, label_id))
                        labels_count += 1

                if len(vn_batch) >= BATCH_SIZE:
                    await copy_bulk_data(
                        "ulist_vns",
                        ["uid", "vid", "added", "lastmod", "vote_date", "vote", "started", "finished", "notes"],
                        vn_batch
                    )
                    vn_batch = []

                if len(label_batch) >= BATCH_SIZE:
                    await copy_bulk_data(
                        "ulist_labels",
                        ["uid", "vid", "label"],
                        label_batch
                    )
                    label_batch = []

                if count % 500000 == 0:
                    logger.info(f"Imported {count} user list entries, {labels_count} labels (skipped {skipped})...")

            except (ValueError, KeyError) as e:
                logger.debug(f"Skipping invalid ulist row: {row} - {e}")
                skipped += 1
                continue

    # Final batches
    if vn_batch:
        await copy_bulk_data(
            "ulist_vns",
            ["uid", "vid", "added", "lastmod", "vote_date", "vote", "started", "finished", "notes"],
            vn_batch
        )

    if label_batch:
        await copy_bulk_data(
            "ulist_labels",
            ["uid", "vid", "label"],
            label_batch
        )

    logger.info(f"Imported {count} user VN list entries, {labels_count} labels (skipped {skipped} for non-existent VNs)")
    await mark_import_complete(ulist_file, "ulist_vns")


async def import_vndb_users(extract_dir: str, force: bool = False):
    """Import VNDB user accounts (uid → username mapping) from the users dump file.

    Args:
        extract_dir: Directory with extracted dump files
        force: If True, import regardless of file modification time
    """
    users_file = None
    for root, dirs, files in os.walk(extract_dir):
        for f in files:
            if f == "users":
                users_file = os.path.join(root, f)

    if not users_file:
        logger.warning("users file not found in extracted files")
        return

    if not await should_import(users_file, "vndb_users", force):
        return

    logger.info(f"Importing VNDB users from {users_file}")

    header_file = users_file + ".header"
    try:
        with open(header_file, "r", encoding="utf-8") as f:
            fieldnames = f.read().strip().split("\t")
        logger.info(f"users fields: {fieldnames}")
    except FileNotFoundError:
        logger.error(f"users header not found: {header_file}")
        return

    # Truncate and re-import
    async with async_session() as db:
        await db.execute(text("TRUNCATE TABLE vndb_users"))
        await db.commit()

    count = 0
    batch: list[tuple] = []
    BATCH_SIZE = 10000

    with open(users_file, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter="\t", fieldnames=fieldnames, quoting=csv.QUOTE_NONE)
        for row in reader:
            uid = row.get("id", "")
            username = row.get("username", "")
            if not uid or not username or username == "\\N":
                continue
            if not uid.startswith("u"):
                uid = f"u{uid}"

            batch.append((uid, username))
            count += 1

            if len(batch) >= BATCH_SIZE:
                async with async_session() as db:
                    await db.execute(
                        text("INSERT INTO vndb_users (uid, username) VALUES (:uid, :username) ON CONFLICT (uid) DO UPDATE SET username = EXCLUDED.username"),
                        [{"uid": u, "username": n} for u, n in batch],
                    )
                    await db.commit()
                batch = []

    # Flush remaining
    if batch:
        async with async_session() as db:
            await db.execute(
                text("INSERT INTO vndb_users (uid, username) VALUES (:uid, :username) ON CONFLICT (uid) DO UPDATE SET username = EXCLUDED.username"),
                [{"uid": u, "username": n} for u, n in batch],
            )
            await db.commit()

    logger.info(f"Imported {count} VNDB users")
    await mark_import_complete(users_file, "vndb_users")


async def import_ulist_labels(extract_dir: str, force: bool = False):
    """Import user VN list labels - NO-OP, labels are imported from ulist_vns.

    The VNDB dump's ulist_labels file contains label DEFINITIONS (e.g., "label 1 = Playing"),
    NOT per-VN label assignments. The actual per-VN labels are embedded in the ulist_vns
    file's 'labels' column as arrays like {2,7}.

    import_ulist_vns() now handles populating the ulist_labels table from those arrays.
    This function is kept for backwards compatibility but does nothing.
    """
    logger.info("import_ulist_labels: No-op - labels are imported from ulist_vns 'labels' column")
    return


async def _import_ulist_labels_old(extract_dir: str, force: bool = False):
    """OLD implementation - kept for reference but not used."""
    labels_file = None

    for root, dirs, files in os.walk(extract_dir):
        for f in files:
            if f == "ulist_labels":
                labels_file = os.path.join(root, f)

    if not labels_file:
        logger.warning("ulist_labels file not found in extracted files")
        return

    # Check if import is needed
    if not await should_import(labels_file, "ulist_labels", force):
        return

    logger.info(f"Importing user VN list labels from {labels_file}")

    # Read header to get field positions
    header_file = labels_file + ".header"
    try:
        with open(header_file, "r", encoding="utf-8") as f:
            fieldnames = f.read().strip().split("\t")
        logger.info(f"ulist_labels fields: {fieldnames}")
    except FileNotFoundError:
        logger.error(f"ulist_labels header not found: {header_file}")
        return

    # Clear existing labels data (they're replaced on each import)
    async with async_session() as db:
        await db.execute(text("TRUNCATE TABLE ulist_labels"))
        await db.commit()

    count = 0
    skipped = 0
    batch: list[tuple] = []
    BATCH_SIZE = 10000

    with open(labels_file, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter="\t", fieldnames=fieldnames, quoting=csv.QUOTE_NONE)

        for row in reader:
            try:
                uid = row.get("uid", "")
                vid = row.get("vid", "")
                label_str = row.get("label", "")

                if not uid or not vid or not label_str:
                    skipped += 1
                    continue

                # Add prefixes if missing
                if not uid.startswith("u"):
                    uid = f"u{uid}"
                if not vid.startswith("v"):
                    vid = f"v{vid}"

                label = int(label_str)

                # Use tuple for COPY format
                batch.append((uid, vid, label))
                count += 1

                if len(batch) >= BATCH_SIZE:
                    await copy_bulk_data(
                        "ulist_labels",
                        ["uid", "vid", "label"],
                        batch
                    )
                    batch = []

                    if count % 1000000 == 0:
                        logger.info(f"Imported {count} user list labels...")

            except (ValueError, KeyError) as e:
                logger.debug(f"Skipping invalid ulist_labels row: {row} - {e}")
                skipped += 1
                continue

    # Final batch
    if batch:
        await copy_bulk_data(
            "ulist_labels",
            ["uid", "vid", "label"],
            batch
        )

    logger.info(f"Imported {count} user VN list labels (skipped {skipped})")
    await mark_import_complete(labels_file, "ulist_labels")


async def run_full_import(
    dump_dir: str,
    skip_download: bool = False,
    max_age_hours: int = 168,  # 1 week default
    force: bool = False,
):
    """Run a full import of all dump files.

    Optimized for performance:
    - Drops indexes before import, recreates after (30-50% faster)
    - Uses COPY for large tables (10-50x faster than INSERT)
    - Runs ANALYZE after import for optimal query planning

    Args:
        dump_dir: Directory to store/read dump files
        skip_download: If True, use existing dumps without downloading
        max_age_hours: Re-download if dumps are older than this (default: 168 = 1 week)
        force: If True, bypass mtime checks and re-import all tables
    """
    import time
    from app.ingestion.dump_downloader import download_dumps

    start_time = time.time()

    def log_step(step: int, total: int, name: str, status: str = "starting"):
        elapsed = time.time() - start_time
        elapsed_str = f"{int(elapsed // 60)}m {int(elapsed % 60)}s"
        progress = f"[{step}/{total}]"
        logger.info(f"{'=' * 50}")
        logger.info(f"{progress} {name.upper()} - {status} (elapsed: {elapsed_str})")
        logger.info(f"{'=' * 50}")

    total_steps = 29  # Including download, index drop/recreate, length votes, users, ulist, average ratings, browse counts, and analyze

    # Step 1: Download dumps (or skip if using existing)
    if skip_download:
        log_step(1, total_steps, "Using existing VNDB dumps", "skipping download")
        # Find existing dump files
        from app.ingestion.dump_downloader import DUMP_URLS
        paths = {}
        for name in DUMP_URLS.keys():
            # Check for existing files
            for ext in [".tar.zst", ".json.gz", ".gz"]:
                path = os.path.join(dump_dir, f"{name}_latest{ext}")
                if os.path.exists(path):
                    paths[name] = path
                    logger.info(f"Using existing dump: {path}")
                    break
        if not paths:
            logger.error("No existing dump files found! Run without --skip-download first.")
            return
    else:
        log_step(1, total_steps, "Downloading VNDB dumps")
        paths = await download_dumps(dump_dir, max_age_hours=max_age_hours)
    logger.info("Downloads complete")

    extract_dir = os.path.join(dump_dir, "extracted")

    # Step 2: Drop indexes for faster import
    log_step(2, total_steps, "Dropping indexes", "speeds up bulk loading")
    dropped_indexes = await drop_import_indexes()

    # Import in order (respecting foreign key dependencies)

    # Step 3: Tags
    if "tags" in paths:
        log_step(3, total_steps, "Importing tags")
        await import_tags(paths["tags"], force=force)

    # Step 4: Traits
    if "traits" in paths:
        log_step(4, total_steps, "Importing traits")
        await import_traits(paths["traits"], force=force)

    # Step 5: Producers
    if "db" in paths:
        log_step(5, total_steps, "Importing producers")
        await import_producers(extract_dir, force=force)

    # Step 6: Staff
    if "db" in paths:
        log_step(6, total_steps, "Importing staff")
        await import_staff(extract_dir, force=force)

    # Step 7: Visual Novels (main data - takes longest)
    if "db" in paths:
        log_step(7, total_steps, "Importing visual novels", "this is the largest table")
        await import_visual_novels(paths["db"], extract_dir, force=force)

    # Step 8: VN-Staff relationships
    if "db" in paths:
        log_step(8, total_steps, "Importing VN-Staff relationships")
        await import_vn_staff(extract_dir, force=force)

    # Step 9: Seiyuu relationships
    if "db" in paths:
        log_step(9, total_steps, "Importing seiyuu data")
        await import_seiyuu(extract_dir, force=force)

    # Step 10: VN relations (sequel, prequel, shares characters, etc.)
    if "db" in paths:
        log_step(10, total_steps, "Importing VN relations")
        await import_vn_relations(extract_dir, force=force)

    # Step 11: Characters
    if "db" in paths:
        log_step(11, total_steps, "Importing characters")
        await import_characters(extract_dir, force=force)

    # Step 12: Character-VN relationships
    if "db" in paths:
        log_step(12, total_steps, "Importing character-VN relationships")
        await import_character_vns(extract_dir, force=force)

    # Step 13: Character-Traits
    if "db" in paths:
        log_step(13, total_steps, "Importing character traits")
        await import_character_traits(extract_dir, force=force)

    # Step 14: Releases
    if "db" in paths:
        log_step(14, total_steps, "Importing releases")
        await import_releases(extract_dir, force=force)

    # Step 15: Release-VN relationships
    if "db" in paths:
        log_step(15, total_steps, "Importing release-VN relationships")
        await import_release_vns(extract_dir, force=force)

    # Step 16: Release-Producer relationships
    if "db" in paths:
        log_step(16, total_steps, "Importing release-producer relationships")
        await import_release_producers(extract_dir, force=force)

    # Step 17: Release platforms
    if "db" in paths:
        log_step(17, total_steps, "Importing release platforms")
        await import_release_platforms(extract_dir, force=force)

    # Step 18: Release media
    if "db" in paths:
        log_step(18, total_steps, "Importing release media")
        await import_release_media(extract_dir, force=force)

    # Step 19: Release external links
    if "db" in paths:
        log_step(19, total_steps, "Importing release links")
        await import_release_extlinks(extract_dir, force=force)

    # Step 20: Votes (uses COPY for fast bulk loading)
    if "votes" in paths:
        log_step(20, total_steps, "Importing votes", "uses COPY for fast bulk loading")
        await import_votes(paths["votes"], force=force)

    # Step 21: Length votes (user-submitted playtime data)
    if "db" in paths:
        log_step(21, total_steps, "Importing length votes", "user playtime averages for length_minutes")
        await import_length_votes(extract_dir, force=force)

    # Step 22: VNDB users (uid → username mapping)
    if "db" in paths:
        log_step(22, total_steps, "Importing VNDB users", "uid to username mapping")
        await import_vndb_users(extract_dir, force=force)

    # Step 23: User VN lists (for user stats - replaces VNDB API calls)
    if "db" in paths:
        log_step(23, total_steps, "Importing user VN lists", "used for user stats page")
        await import_ulist_vns(extract_dir, force=force)

    # Step 24: User VN list labels (Playing, Finished, etc.)
    if "db" in paths:
        log_step(24, total_steps, "Importing user list labels", "Playing/Finished/Stalled/etc. categories")
        await import_ulist_labels(extract_dir, force=force)

    # Step 25: Compute average ratings from votes
    log_step(25, total_steps, "Computing average ratings", "raw averages for quality signal")
    await compute_average_ratings()

    # Step 26: Aggregate platforms and languages from release data
    log_step(26, total_steps, "Aggregating VN platforms and languages", "from release data")
    await update_vn_platforms_and_languages()

    # Step 27: Compute precomputed browse counts for staff and producers
    log_step(27, total_steps, "Computing browse counts", "staff/producer vn_count, roles")
    await update_browse_precomputed_counts()

    # Step 28: Recreate indexes
    log_step(28, total_steps, "Recreating indexes", "may take a few minutes")
    await recreate_import_indexes(dropped_indexes)

    # Step 29: Analyze tables
    log_step(29, total_steps, "Analyzing tables", "updating query planner statistics")
    await analyze_import_tables()

    total_time = time.time() - start_time
    logger.info(f"{'=' * 50}")
    logger.info(f"IMPORT COMPLETE - Total time: {int(total_time // 60)}m {int(total_time % 60)}s")
    logger.info(f"{'=' * 50}")


# ==================== Progress Tracking for Admin UI ====================

async def update_import_progress(
    run_id: int,
    step: int,
    phase: str,
    status: str = "running",
    error_message: str | None = None,
    stats: dict | None = None,
):
    """Update import progress in database for admin UI tracking.

    Args:
        run_id: The ImportRun ID to update
        step: Current step number (1-27)
        phase: Description of current phase
        status: running, completed, failed, cancelled
        error_message: Error message if failed
        stats: Optional stats dict to store
    """
    from datetime import datetime, timezone
    from sqlalchemy import update
    from sqlalchemy.dialects.postgresql import insert as pg_insert

    total_steps = 28
    progress = (step / total_steps) * 100 if total_steps > 0 else 0

    async with async_session() as db:
        # Update the run record
        update_data = {
            "status": status,
            "phase": phase,
            "current_step": step,
            "total_steps": total_steps,
            "progress_percent": progress,
        }

        if status in ("completed", "failed", "cancelled"):
            update_data["ended_at"] = datetime.now(timezone.utc)

        if error_message:
            update_data["error_message"] = error_message

        if stats:
            update_data["stats_json"] = stats

        await db.execute(
            update(ImportRun).where(ImportRun.id == run_id).values(**update_data)
        )
        await db.commit()


async def log_import_message(
    run_id: int,
    level: str,
    message: str,
    phase: str | None = None,
):
    """Log a message for an import run.

    Args:
        run_id: The ImportRun ID
        level: INFO, WARNING, ERROR
        message: Log message text
        phase: Optional current phase name
    """
    from datetime import datetime, timezone

    async with async_session() as db:
        log_entry = ImportLog(
            run_id=run_id,
            timestamp=datetime.now(timezone.utc),
            level=level.upper(),
            message=message,
            phase=phase,
        )
        db.add(log_entry)
        await db.commit()


async def check_import_cancelled(run_id: int) -> bool:
    """Check if an import has been cancelled."""
    from sqlalchemy import select

    async with async_session() as db:
        result = await db.execute(
            select(ImportRun.status).where(ImportRun.id == run_id)
        )
        status = result.scalar_one_or_none()
        return status == "cancelled"


async def run_import_with_tracking(run_id: int, force_download: bool = False):
    """Run full import with progress tracking for admin UI.

    This wraps run_full_import and provides real-time progress updates
    that the admin UI can display.

    Args:
        run_id: The ImportRun ID to track progress against
        force_download: Force re-download even if dumps are fresh
    """
    import time
    import traceback
    from datetime import datetime, timezone
    from app.ingestion.dump_downloader import download_dumps
    from app.config import get_settings

    settings = get_settings()
    dump_dir = settings.dump_storage_path

    start_time = time.time()
    stats = {"tables": {}}

    async def log_and_track(step: int, phase: str, message: str, level: str = "INFO"):
        """Helper to log and update progress simultaneously."""
        elapsed = time.time() - start_time
        elapsed_str = f"{int(elapsed // 60)}m {int(elapsed % 60)}s"
        full_message = f"[{step}/27] {message} (elapsed: {elapsed_str})"

        logger.info(full_message)
        await update_import_progress(run_id, step, phase)
        await log_import_message(run_id, level, full_message, phase)

        # Check for cancellation
        if await check_import_cancelled(run_id):
            raise Exception("Import cancelled by user")

    try:
        # Mark as running
        async with async_session() as db:
            await db.execute(
                text("UPDATE import_runs SET status = 'running', started_at = :now WHERE id = :id"),
                {"id": run_id, "now": datetime.now(timezone.utc)}
            )
            await db.commit()

        # Step 1: Download dumps
        await log_and_track(1, "download", "Downloading VNDB dumps...")
        paths = await download_dumps(
            dump_dir,
            force_download=force_download,
            max_age_hours=24
        )
        await log_import_message(run_id, "INFO", f"Downloaded dumps: {list(paths.keys())}", "download")

        extract_dir = os.path.join(dump_dir, "extracted")

        # Step 2: Drop indexes
        await log_and_track(2, "indexes", "Dropping indexes for faster bulk loading...")
        dropped_indexes = await drop_import_indexes()
        await log_import_message(run_id, "INFO", f"Dropped {len(dropped_indexes)} indexes", "indexes")

        # Step 3: Tags
        if "tags" in paths:
            await log_and_track(3, "tags", "Importing tags...")
            await import_tags(paths["tags"])

        # Step 4: Traits
        if "traits" in paths:
            await log_and_track(4, "traits", "Importing traits...")
            await import_traits(paths["traits"])

        # Step 5: Producers
        if "db" in paths:
            await log_and_track(5, "producers", "Importing producers...")
            await import_producers(extract_dir)

        # Step 6: Staff
        if "db" in paths:
            await log_and_track(6, "staff", "Importing staff...")
            await import_staff(extract_dir)

        # Step 7: Visual Novels (largest table)
        if "db" in paths:
            await log_and_track(7, "visual_novels", "Importing visual novels (largest table)...")
            await import_visual_novels(paths["db"], extract_dir)

        # Step 8: VN-Staff relationships
        if "db" in paths:
            await log_and_track(8, "vn_staff", "Importing VN-Staff relationships...")
            await import_vn_staff(extract_dir)

        # Step 9: Seiyuu
        if "db" in paths:
            await log_and_track(9, "seiyuu", "Importing seiyuu data...")
            await import_seiyuu(extract_dir)

        # Step 10: Characters
        if "db" in paths:
            await log_and_track(10, "characters", "Importing characters...")
            await import_characters(extract_dir)

        # Step 11: Character-VN relationships
        if "db" in paths:
            await log_and_track(11, "character_vns", "Importing character-VN relationships...")
            await import_character_vns(extract_dir)

        # Step 12: Character traits
        if "db" in paths:
            await log_and_track(12, "character_traits", "Importing character traits...")
            await import_character_traits(extract_dir)

        # Step 13: Releases
        if "db" in paths:
            await log_and_track(13, "releases", "Importing releases...")
            await import_releases(extract_dir)

        # Step 14: Release-VN relationships
        if "db" in paths:
            await log_and_track(14, "release_vns", "Importing release-VN relationships...")
            await import_release_vns(extract_dir)

        # Step 15: Release-Producer relationships
        if "db" in paths:
            await log_and_track(15, "release_producers", "Importing release-producer relationships...")
            await import_release_producers(extract_dir)

        # Step 16: Release platforms
        if "db" in paths:
            await log_and_track(16, "release_platforms", "Importing release platforms...")
            await import_release_platforms(extract_dir)

        # Step 17: Release media
        if "db" in paths:
            await log_and_track(17, "release_media", "Importing release media...")
            await import_release_media(extract_dir)

        # Step 18: Release external links
        if "db" in paths:
            await log_and_track(18, "release_extlinks", "Importing release links...")
            await import_release_extlinks(extract_dir)

        # Step 19: Votes (uses COPY)
        if "votes" in paths:
            await log_and_track(19, "votes", "Importing votes (COPY bulk load)...")
            await import_votes(paths["votes"])

        # Step 20: Length votes (user playtime data)
        if "db" in paths:
            await log_and_track(20, "length_votes", "Importing length votes (user playtime averages)...")
            await import_length_votes(extract_dir)

        # Step 21: VNDB users (uid → username mapping)
        if "db" in paths:
            await log_and_track(21, "vndb_users", "Importing VNDB users (uid → username)...")
            await import_vndb_users(extract_dir)

        # Step 22: User VN lists (for user stats - replaces VNDB API calls)
        if "db" in paths:
            await log_and_track(22, "ulist_vns", "Importing user VN lists...")
            await import_ulist_vns(extract_dir)

        # Step 23: User VN list labels (Playing, Finished, etc.)
        if "db" in paths:
            await log_and_track(23, "ulist_labels", "Importing user list labels (Playing/Finished/etc.)...")
            await import_ulist_labels(extract_dir)

        # Step 24: Aggregate platforms and languages from release data
        await log_and_track(24, "vn_platforms_languages", "Aggregating VN platforms and languages from release data...")
        await update_vn_platforms_and_languages()

        # Step 25: Compute precomputed browse counts for staff and producers
        await log_and_track(25, "browse_counts", "Computing browse counts (staff/producer vn_count, roles)...")
        await update_browse_precomputed_counts()

        # Step 26: Recreate indexes
        await log_and_track(26, "indexes", "Recreating indexes...")
        await recreate_import_indexes(dropped_indexes)
        await log_import_message(run_id, "INFO", f"Recreated {len(dropped_indexes)} indexes", "indexes")

        # Step 27: Analyze tables
        await log_and_track(27, "analyze", "Analyzing tables for query planner...")
        await analyze_import_tables()

        # Step 28: Evaluate auto-blacklist rules
        await log_and_track(28, "blacklist", "Evaluating cover blacklist rules...")
        from app.services.blacklist_service import evaluate_auto_blacklist
        async with async_session() as db:
            blacklist_stats = await evaluate_auto_blacklist(db)
            await log_import_message(
                run_id, "INFO",
                f"Blacklist evaluation: {blacklist_stats['added']} added, {blacklist_stats['removed']} removed, {blacklist_stats['total']} total",
                "blacklist"
            )

        # Calculate final stats
        total_time = time.time() - start_time
        stats["duration_seconds"] = total_time
        stats["duration_formatted"] = f"{int(total_time // 60)}m {int(total_time % 60)}s"

        # Mark as completed
        await update_import_progress(
            run_id, 27, "completed",
            status="completed",
            stats=stats
        )
        await log_import_message(
            run_id, "INFO",
            f"Import completed successfully in {stats['duration_formatted']}",
            "completed"
        )

        # Update system metadata
        async with async_session() as db:
            await db.execute(
                text("INSERT INTO system_metadata (key, value) VALUES ('last_import', :v) "
                     "ON CONFLICT (key) DO UPDATE SET value = :v"),
                {"v": datetime.now(timezone.utc).isoformat()}
            )
            await db.commit()

        logger.info(f"Import tracking complete - run_id={run_id}")

    except Exception as e:
        error_msg = str(e)
        tb = traceback.format_exc()
        logger.error(f"Import failed: {error_msg}\n{tb}")

        # Mark as failed (unless cancelled)
        is_cancelled = "cancelled" in error_msg.lower()
        status = "cancelled" if is_cancelled else "failed"

        await update_import_progress(
            run_id, 0, "failed",
            status=status,
            error_message=error_msg if not is_cancelled else None,
        )
        await log_import_message(
            run_id, "ERROR" if not is_cancelled else "WARNING",
            f"Import {status}: {error_msg}",
            "error"
        )
