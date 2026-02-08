"""
Data Migration Framework - Complements Alembic schema migrations.

Schema migrations (Alembic) add/modify columns.
Data migrations populate column data from dump files.

Migrations run once and track completion in system_metadata table.
This allows updating specific columns without full database reimports.

Usage:
    # In a migration file (e.g., migrations/dm_001_populate_title_jp.py):
    from app.ingestion.data_migrations import data_migration

    @data_migration('001', 'Populate title_jp from VNDB dump')
    async def populate_title_jp():
        # Read dump file, update column
        ...

    # To run all pending migrations:
    from app.ingestion.data_migrations import run_pending_migrations, load_migrations
    load_migrations()
    await run_pending_migrations()
"""

import logging
from datetime import datetime
from functools import wraps
from typing import Callable, Dict

from sqlalchemy import text

from app.db.database import async_session

logger = logging.getLogger(__name__)

# Registry of data migrations
_migrations: Dict[str, dict] = {}


def data_migration(version: str, description: str):
    """Decorator to register a data migration.

    Args:
        version: Unique version string (e.g., '001', '002'). Migrations run in sorted order.
        description: Human-readable description of what this migration does.
    """
    def decorator(func: Callable):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            return await func(*args, **kwargs)
        _migrations[version] = {
            'func': wrapper,
            'description': description,
            'version': version
        }
        return wrapper
    return decorator


async def get_completed_migrations() -> set:
    """Get set of completed data migration versions from system_metadata."""
    try:
        async with async_session() as db:
            result = await db.execute(
                text("SELECT key FROM system_metadata WHERE key LIKE 'data_migration:%'")
            )
            return {row[0].replace('data_migration:', '') for row in result.fetchall()}
    except Exception as e:
        logger.warning(f"Could not read completed migrations (table may not exist yet): {e}")
        return set()


async def mark_migration_complete(version: str):
    """Mark a data migration as complete in system_metadata."""
    async with async_session() as db:
        await db.execute(
            text("""
                INSERT INTO system_metadata (key, value)
                VALUES (:key, :value)
                ON CONFLICT (key) DO UPDATE SET value = :value
            """),
            {'key': f'data_migration:{version}', 'value': datetime.utcnow().isoformat()}
        )
        await db.commit()


async def run_pending_migrations():
    """Run all pending data migrations in sorted version order."""
    completed = await get_completed_migrations()
    pending = sorted([v for v in _migrations.keys() if v not in completed])

    if not pending:
        logger.info("No pending data migrations")
        return

    logger.info(f"Running {len(pending)} pending data migration(s): {pending}")

    for version in pending:
        migration = _migrations[version]
        logger.info(f"Running data migration {version}: {migration['description']}")
        try:
            await migration['func']()
            await mark_migration_complete(version)
            logger.info(f"Completed data migration {version}")
        except Exception as e:
            logger.error(f"Failed data migration {version}: {e}")
            raise


def load_migrations():
    """Load all migration modules to register them.

    Import this function and call it before run_pending_migrations()
    to ensure all @data_migration decorators are executed.
    """
    # Import migration modules - this triggers their @data_migration decorators
    try:
        from app.ingestion.migrations import dm_001_populate_title_jp  # noqa: F401
        from app.ingestion.migrations import dm_002_fix_title_romaji  # noqa: F401
        from app.ingestion.migrations import dm_003_populate_trait_groups  # noqa: F401
        from app.ingestion.migrations import dm_004_populate_browse_counts  # noqa: F401
    except ImportError as e:
        logger.warning(f"Could not load data migrations: {e}")


def list_migrations() -> list:
    """List all registered migrations and their status.

    Returns list of dicts with version, description, and completed status.
    """
    import asyncio

    async def _list():
        completed = await get_completed_migrations()
        return [
            {
                'version': v,
                'description': m['description'],
                'completed': v in completed
            }
            for v, m in sorted(_migrations.items())
        ]

    return asyncio.run(_list())
