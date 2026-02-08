# VNDB Stats Backend - Development Guide

## The #1 Rule: You Rarely Need to Reimport

**Your data persists in Docker volumes.** The ~40,000 visual novels, all stats, and recommendations survive:
- Container restarts
- Container rebuilds
- Code changes
- Configuration changes

You only need to reimport if:
1. **First time setup** (database is completely empty)
2. **You explicitly deleted volumes** (`docker-compose down -v`)
3. **You want fresh VNDB data** (new VNs released since last import)

---

## Quick Reference

### Safe Commands (Keep Your Data)

```bash
# Restart containers (preferred for most changes)
docker-compose restart

# Rebuild containers but keep data
docker-compose up --build

# Stop and start (data persists)
docker-compose down
docker-compose up
```

### Dangerous Command (Deletes Everything)

```bash
# This DELETES your entire database!
docker-compose down -v   # The -v flag removes volumes
```

---

## Common Scenarios

### "I made a code change"

**Do nothing.** Hot reload handles it automatically.

The API container has `--reload` enabled, so Python changes are applied instantly.

### "I modified database models (app/db/models.py)"

**Run a migration, NOT a reimport.**

```bash
# 1. Generate migration from your model changes
alembic revision --autogenerate -m "Add new_column to visual_novels"

# 2. Review the generated file in alembic/versions/
# 3. Apply the migration
alembic upgrade head

# 4. Restart containers (migration runs automatically via entrypoint)
docker-compose restart
```

### "I rebuilt containers and now nothing works"

**Check if data still exists:**

```bash
docker-compose exec db psql -U vndb -d vndb_stats -c "SELECT COUNT(*) FROM visual_novels;"
```

- If count > 0: Data exists! The issue is likely a code/schema problem, not missing data.
- If count = 0: Run `npm run api:import` to import data.

### "API returns empty results"

1. **Check if data exists** (see above)
2. If data exists, debug the query - it's a code bug, not a data problem
3. Check for schema mismatches (missing columns) by looking at error logs

### "I see 'column does not exist' errors"

This means the database schema is out of sync with your code models.

**Fix: Run migrations**
```bash
alembic revision --autogenerate -m "Sync schema"
alembic upgrade head
docker-compose restart
```

**Do NOT reimport** - that wastes 30 minutes when a 5-second migration would fix it.

---

## Development Workflow

### Initial Setup (One Time)

```bash
cd vndb-stats-backend

# Start all services
docker-compose up -d

# Wait for services to be ready, then import data
npm run api:import   # Takes ~20-30 minutes

# Data is now persisted in Docker volumes
```

### Daily Development

```bash
# Just edit your code - hot reload is enabled!
# No need to restart containers for Python changes

# If you need to restart for some reason:
docker-compose restart

# View logs
docker-compose logs -f api
docker-compose logs -f worker
```

### After Database Model Changes

```bash
# 1. Edit app/db/models.py with your changes

# 2. Generate migration
alembic revision --autogenerate -m "Description of change"

# 3. Review the generated migration in alembic/versions/
#    Make sure it looks correct!

# 4. Apply migration
alembic upgrade head

# 5. Restart containers
docker-compose restart
```

### Checking Database Status

```bash
# Quick check via psql
docker-compose exec db psql -U vndb -d vndb_stats -c "SELECT COUNT(*) FROM visual_novels;"

# Check all table counts
docker-compose exec db psql -U vndb -d vndb_stats -c "
  SELECT 'visual_novels' as table, COUNT(*) FROM visual_novels
  UNION ALL SELECT 'tags', COUNT(*) FROM tags
  UNION ALL SELECT 'global_votes', COUNT(*) FROM global_votes;"

# View last import time
docker-compose exec db psql -U vndb -d vndb_stats -c "
  SELECT * FROM system_metadata WHERE key = 'last_import';"
```

---

## Architecture Notes

### Containers

| Container | Purpose | Data Persistence |
|-----------|---------|-----------------|
| `api` | Serves HTTP requests | No data (stateless) |
| `worker` | Scheduled imports | No data (stateless) |
| `db` | PostgreSQL database | **pgdata volume** |
| `redis` | Caching | redisdata volume |

### Volumes

| Volume | Contents | Can Rebuild? |
|--------|----------|--------------|
| `pgdata` | All VN data, stats, recommendations | NO - takes 30 min to reimport |
| `redisdata` | Cache data | Yes - regenerates automatically |
| `dumps` | Downloaded VNDB files | Yes - re-downloads if needed |

### DEV_MODE

The worker container has `DEV_MODE=true` by default, which:
- Prevents automatic imports on startup
- Requires manual `npm run api:import` for first import
- Prevents accidental long-running imports during development

To enable automatic daily updates (production), set `DEV_MODE=false`.

---

## Troubleshooting Database Issues

### Before Reimporting the Database

Check if data actually exists first:

```bash
docker-compose exec db psql -U vndb -d vndb_stats -c "SELECT COUNT(*) FROM visual_novels;"
```

| VN Count | Diagnosis | Fix |
|----------|-----------|-----|
| > 0 | Data exists | Debug code/schema, NOT reimport |
| = 0 | Empty database | `npm run api:import` |

### Common Misdiagnoses to Avoid

| Symptom | Wrong Diagnosis | Correct Diagnosis | Correct Fix |
|---------|-----------------|-------------------|-------------|
| "column does not exist" | "Need reimport" | Schema mismatch | Run migration |
| API returns empty | "Need reimport" | Query bug or filter issue | Debug the code |
| "relation does not exist" | "Need reimport" | Missing table | Run migration |
| App crashes on startup | "Need reimport" | Import/config error | Check logs |

### Schema Change Workflow

```bash
# 1. Modify models in app/db/models.py
# 2. Generate migration
alembic revision --autogenerate -m "Add new_column to visual_novels"

# 3. Review the generated migration file
# 4. Apply migration
alembic upgrade head

# 5. Restart containers (migration auto-runs via entrypoint)
docker-compose restart
```

**Time: 5-10 seconds** vs reimport which takes **20-30 minutes**

### When Reimport IS Needed

Only suggest reimport if:
1. `SELECT COUNT(*) FROM visual_novels` returns 0
2. User explicitly deleted volumes with `docker-compose down -v`
3. User wants fresh VNDB data (new VNs released)

---

## Troubleshooting

### "ImportError: No module named 'xxx'"

This usually means a new dependency was added. Rebuild the container:
```bash
docker-compose up --build
```

### "Connection refused" to database

Wait for PostgreSQL to be ready:
```bash
docker-compose logs db
# Look for "database system is ready to accept connections"
```

### Worker keeps trying to import

Check if `DEV_MODE=true` is set in docker-compose.yml. If it's false and data is >24h old, the worker will auto-update.

### Migrations fail

1. Check the error message
2. Review the generated migration file in `alembic/versions/`
3. You can manually edit migrations if autogenerate got it wrong
4. For complex schema changes, write the migration manually

### "I broke everything"

Nuclear option (loses all data, use only as last resort):
```bash
docker-compose down -v
docker-compose up -d
npm run api:import   # 20-30 minutes
```

---

## Summary

| Scenario | Action | Time |
|----------|--------|------|
| Code change | Nothing (hot reload) | 0 sec |
| Schema change | `alembic` migration | 5-10 sec |
| Container rebuild | `docker-compose up --build` | 30 sec |
| First time setup | `npm run api:import` | 20-30 min |
| Deleted volumes | `npm run api:import` | 20-30 min |

**The data persists. You rarely need to reimport. Use migrations for schema changes.**
