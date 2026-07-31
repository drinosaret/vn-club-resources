"""Bring the database schema up to date, serialized across containers.

api, discord-bot and worker share docker-entrypoint.sh and boot in parallel, so
all three reach this at the same time. A session-level advisory lock gives the
work to one of them while the others wait and then find nothing pending. Both
branches are inside it: a fresh database (create_all + stamp) needs the same
serialization as an existing one taking pending migrations.

The lock has its own connection, so the work below keeps its normal
transactions, and Postgres releases it if a container stops while holding it.
"""

import asyncio
import sys
from pathlib import Path

# Ensure the project root is on the path (run as `python scripts/schema_setup.py`,
# which puts scripts/ on sys.path rather than the root).
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

from app.config import get_settings
from app.db.database import Base
import app.db.models  # registers every model on Base.metadata

# Follows the pg_advisory_lock(hashtext(...)) convention the importer uses. Must
# stay distinct from the other lock names in this database ('vndb_import').
SCHEMA_LOCK_NAME = "schema_setup"


async def _alembic(*args: str) -> None:
    """Run the alembic CLI, failing loudly so the entrypoint's `set -e` aborts."""
    proc = await asyncio.create_subprocess_exec("alembic", *args)
    if await proc.wait() != 0:
        raise SystemExit(f"alembic {' '.join(args)} failed")


async def _has_alembic_version(conn) -> bool:
    result = await conn.execute(
        text(
            "SELECT EXISTS (SELECT FROM information_schema.tables"
            " WHERE table_name = 'alembic_version')"
        )
    )
    return bool(result.scalar())


async def main() -> None:
    url = get_settings().database_url
    # NullPool + AUTOCOMMIT: this connection exists only to hold the lock, and
    # the lock has to outlive any implicit transaction around it.
    lock_engine = create_async_engine(url, poolclass=NullPool, isolation_level="AUTOCOMMIT")
    engine = create_async_engine(url, poolclass=NullPool)
    try:
        async with lock_engine.connect() as lock_conn:
            await lock_conn.execute(
                text("SELECT pg_advisory_lock(hashtext(:name))"), {"name": SCHEMA_LOCK_NAME}
            )

            # Base tables (visual_novels, tags, ...) live only in the ORM models,
            # never in a migration, and the migrations reference them by foreign
            # key. So a fresh database is built by the ORM and then stamped,
            # while an existing one just takes the pending migrations.
            async with engine.connect() as conn:
                existing = await _has_alembic_version(conn)

            if existing:
                print("Existing database detected, skipping table creation")
                print("Running schema migrations...")
                await _alembic("upgrade", "head")
                print("✓ Schema migrations complete")
            else:
                print("Fresh database detected, creating all tables...")
                async with engine.begin() as conn:
                    await conn.run_sync(Base.metadata.create_all)
                print("✓ All tables created")
                print("Stamping Alembic migration history...")
                await _alembic("stamp", "head")
                print("✓ Migration history stamped")
    finally:
        await engine.dispose()
        await lock_engine.dispose()


if __name__ == "__main__":
    # SystemExit from _alembic propagates out of asyncio.run: Python prints its
    # message and exits non-zero on its own, which is what `set -e` needs.
    asyncio.run(main())
