"""Database state inspection utilities.

This module provides functions to check the state of the database,
helping diagnose whether issues are related to missing data or schema problems.

Before reimporting the database, use these functions to check:
1. Does the database actually have data? (vn_count > 0)
2. Is the schema up to date? (check for specific column errors)
3. When was the last import? (last_import timestamp)

If vn_count > 0, the data EXISTS - the problem is likely:
- A schema change that needs a migration (not reimport!)
- A code bug in the query
- A missing computed table (run similarity computation)

Only reimport if vn_count = 0 (database is truly empty).
"""

import logging
from datetime import datetime
from typing import Optional

from sqlalchemy import select, func, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import async_session_maker
from app.db.models import (
    VisualNovel, Tag, VNTag, GlobalVote,
    Producer, Staff, Character, Trait,
    SystemMetadata,
)

logger = logging.getLogger(__name__)

# Tables that should have data after import
IMPORT_TABLES = [
    ("visual_novels", VisualNovel),
    ("tags", Tag),
    ("vn_tags", VNTag),
    ("global_votes", GlobalVote),
    ("producers", Producer),
    ("staff", Staff),
    ("characters", Character),
    ("traits", Trait),
]


async def get_database_status() -> dict:
    """Get comprehensive database status.

    Use this to diagnose data vs schema issues:
    - has_data=True + error = likely schema issue (need migration)
    - has_data=False = need initial import
    - needs_import=True = database is empty

    Returns:
        dict with keys:
        - has_data: bool - True if visual_novels table has rows
        - vn_count: int - Number of visual novels
        - last_import: str - ISO timestamp of last import
        - last_import_age_hours: float - Hours since last import
        - needs_import: bool - True if database is empty
        - table_counts: dict - Row counts for key tables
        - schema_version: str - Current Alembic revision (if available)
    """
    try:
        async with async_session_maker() as session:
            result = {}

            # Get VN count (primary indicator)
            vn_result = await session.execute(
                select(func.count()).select_from(VisualNovel)
            )
            vn_count = vn_result.scalar_one_or_none() or 0
            result["vn_count"] = vn_count
            result["has_data"] = vn_count > 0
            result["needs_import"] = vn_count == 0

            # Get last import timestamp
            meta_result = await session.execute(
                select(SystemMetadata).where(SystemMetadata.key == "last_import")
            )
            metadata = meta_result.scalar_one_or_none()
            last_import = metadata.value if metadata else None
            result["last_import"] = last_import

            # Calculate age
            if last_import:
                try:
                    last_import_dt = datetime.fromisoformat(
                        last_import.replace('Z', '+00:00')
                    )
                    hours_since = (
                        datetime.utcnow() - last_import_dt.replace(tzinfo=None)
                    ).total_seconds() / 3600
                    result["last_import_age_hours"] = round(hours_since, 1)
                except Exception:
                    result["last_import_age_hours"] = None
            else:
                result["last_import_age_hours"] = None

            # Get table counts for key tables
            table_counts = {}
            for table_name, model in IMPORT_TABLES:
                try:
                    count_result = await session.execute(
                        select(func.count()).select_from(model)
                    )
                    table_counts[table_name] = count_result.scalar_one_or_none() or 0
                except Exception as e:
                    table_counts[table_name] = f"error: {e}"
            result["table_counts"] = table_counts

            # Try to get Alembic revision
            try:
                rev_result = await session.execute(
                    text("SELECT version_num FROM alembic_version LIMIT 1")
                )
                row = rev_result.first()
                result["schema_version"] = row[0] if row else "none"
            except Exception:
                result["schema_version"] = "unknown"

            return result

    except Exception as e:
        logger.error(f"Failed to get database status: {e}")
        return {
            "has_data": False,
            "vn_count": 0,
            "last_import": None,
            "last_import_age_hours": None,
            "needs_import": True,
            "table_counts": {},
            "schema_version": "error",
            "error": str(e),
        }


async def diagnose_issue(error_message: str) -> str:
    """Diagnose a database issue and suggest the correct fix.

    Args:
        error_message: The error message from the application

    Returns:
        A diagnosis string with the recommended fix
    """
    status = await get_database_status()
    error_lower = error_message.lower()

    # Check for schema issues (column/table errors)
    if "column" in error_lower and "does not exist" in error_lower:
        return (
            f"DIAGNOSIS: Schema mismatch\n"
            f"The database has {status['vn_count']:,} VNs but a column is missing.\n"
            f"FIX: Run a migration, NOT a reimport!\n"
            f"Commands:\n"
            f"  alembic revision --autogenerate -m 'Add missing column'\n"
            f"  alembic upgrade head\n"
            f"  docker-compose restart"
        )

    if "relation" in error_lower and "does not exist" in error_lower:
        if status["has_data"]:
            return (
                f"DIAGNOSIS: Missing table but data exists\n"
                f"The database has {status['vn_count']:,} VNs.\n"
                f"FIX: Run migrations to create the missing table.\n"
                f"Commands:\n"
                f"  alembic revision --autogenerate -m 'Add missing table'\n"
                f"  alembic upgrade head"
            )
        else:
            return (
                f"DIAGNOSIS: Empty database\n"
                f"The database is empty (0 VNs).\n"
                f"FIX: Run initial import.\n"
                f"Command: npm run api:import"
            )

    # Check for empty results
    if "no data" in error_lower or "empty" in error_lower or "0 results" in error_lower:
        if status["has_data"]:
            return (
                f"DIAGNOSIS: Query issue, NOT missing data\n"
                f"The database has {status['vn_count']:,} VNs.\n"
                f"FIX: Debug the query logic - data exists!\n"
                f"Check:\n"
                f"  - Query filters (are they too restrictive?)\n"
                f"  - JOIN conditions\n"
                f"  - WHERE clauses"
            )
        else:
            return (
                f"DIAGNOSIS: Empty database\n"
                f"The database is empty (0 VNs).\n"
                f"FIX: Run initial import.\n"
                f"Command: npm run api:import"
            )

    # Default: show status
    if status["has_data"]:
        return (
            f"DIAGNOSIS: Data exists ({status['vn_count']:,} VNs)\n"
            f"Last import: {status['last_import_age_hours']} hours ago\n"
            f"If the app isn't working, it's likely a code bug or schema issue.\n"
            f"Try:\n"
            f"  1. Check error logs for specific column/table errors\n"
            f"  2. Run migrations: alembic upgrade head\n"
            f"  3. Restart containers: docker-compose restart\n"
            f"Do NOT reimport unless vn_count is 0!"
        )
    else:
        return (
            f"DIAGNOSIS: Empty database\n"
            f"The database has no data.\n"
            f"FIX: Run initial import.\n"
            f"Command: npm run api:import"
        )


def print_status_report(status: dict) -> None:
    """Print a formatted status report to console."""
    print("=" * 60)
    print("DATABASE STATUS REPORT")
    print("=" * 60)
    print()

    if status.get("error"):
        print(f"ERROR: {status['error']}")
        return

    print(f"Has Data:       {'Yes' if status['has_data'] else 'NO - EMPTY'}")
    print(f"VN Count:       {status['vn_count']:,}")
    print(f"Last Import:    {status.get('last_import', 'Never')}")

    if status.get("last_import_age_hours") is not None:
        print(f"Import Age:     {status['last_import_age_hours']:.1f} hours ago")

    print(f"Schema Version: {status.get('schema_version', 'Unknown')}")
    print()

    if status.get("table_counts"):
        print("Table Counts:")
        for table, count in status["table_counts"].items():
            if isinstance(count, int):
                print(f"  {table:20} {count:>10,}")
            else:
                print(f"  {table:20} {count}")

    print()
    print("=" * 60)

    if status["needs_import"]:
        print("ACTION NEEDED: Database is empty. Run: npm run api:import")
    else:
        print("STATUS: Database is populated and ready.")

    print("=" * 60)
