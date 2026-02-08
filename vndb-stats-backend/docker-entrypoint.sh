#!/bin/bash
set -e

echo "=========================================="
echo "VNDB Stats Backend Container Starting"
echo "=========================================="

# Wait for database to be ready
echo "Waiting for PostgreSQL to be ready..."
until pg_isready -h db -U vndb -d vndb_stats > /dev/null 2>&1; do
  sleep 1
done
echo "✓ PostgreSQL is ready"

# Validate critical secrets in production
if [ "${DEBUG}" != "true" ] && [ "${DEV_MODE}" != "true" ]; then
  if [ -z "${DATABASE_URL}" ]; then
    echo "ERROR: DATABASE_URL must be set in production"
    exit 1
  fi
  if echo "${DATABASE_URL}" | grep -qi "changeme\|vndb_dev_password\|CHANGE_ME\|password123"; then
    echo "ERROR: DATABASE_URL contains a default/weak password. Set a strong password for production!"
    exit 1
  fi
fi

# Database initialization strategy:
# - Base tables (visual_novels, tags, etc.) are defined only in ORM models,
#   not in any Alembic migration file.
# - Alembic migrations reference these base tables via foreign keys.
# - On a fresh DB: create all tables via ORM, then stamp Alembic to head.
# - On an existing DB: just run Alembic migrations normally.
echo "Running database initialization..."
python -c "
import asyncio
from app.db.database import Base, engine
import app.db.models  # Register all models with Base.metadata

async def init():
    async with engine.connect() as conn:
        # Check if alembic_version table exists (= existing database)
        result = await conn.execute(
            __import__('sqlalchemy').text(
                \"SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'alembic_version')\"
            )
        )
        has_alembic = result.scalar()

    if has_alembic:
        print('Existing database detected, skipping table creation')
    else:
        print('Fresh database detected, creating all tables...')
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        print('✓ All tables created')

    await engine.dispose()
    return has_alembic

has_alembic = asyncio.run(init())

# Write result so bash can read it
with open('/tmp/db_state', 'w') as f:
    f.write('existing' if has_alembic else 'fresh')
"

DB_STATE=$(cat /tmp/db_state)

if [ "$DB_STATE" = "fresh" ]; then
  # Fresh DB: tables already created by ORM, just stamp migration history
  echo "Stamping Alembic migration history..."
  alembic stamp head
  echo "✓ Migration history stamped"
else
  # Existing DB: run pending migrations normally
  echo "Running schema migrations..."
  alembic upgrade head
  echo "✓ Schema migrations complete"
fi

# Run data migrations (populate new columns from dump files)
echo "Running data migrations..."
python -c "
import asyncio
import logging
logging.basicConfig(level=logging.INFO)
try:
    from app.ingestion.data_migrations import run_pending_migrations, load_migrations
    load_migrations()
    asyncio.run(run_pending_migrations())
except Exception as e:
    print(f'Data migration warning: {e}')
    print('Data migrations can be run manually later with: npm run api:data-migrate')
"
echo "✓ Data migrations complete"

echo "=========================================="
echo "Starting application..."
echo "=========================================="

# Execute the main command (passed as arguments)
exec "$@"
