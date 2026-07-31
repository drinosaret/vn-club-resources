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

# Schema setup: fresh-vs-existing detection, table creation, and migrations.
# In scripts/schema_setup.py so the whole block runs under a single advisory
# lock, since api, discord-bot and worker all reach this line concurrently.
echo "Running database initialization..."
python scripts/schema_setup.py

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
