#!/usr/bin/env python
"""
Background worker for imports and scheduled tasks.

This runs as a separate container from the API to avoid blocking
API queries during database-intensive import operations.

IMPORTANT: Data persists in Docker volumes across restarts!
- You do NOT need to reimport after code changes
- You do NOT need to reimport after container restarts
- Only reimport if database is truly empty (first time setup)

See DEVELOPMENT.md for the full development workflow guide.
"""

import asyncio
import logging
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional

# Add app to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy import select, func, text

from app.config import get_settings
from app.db.database import init_db, async_session_maker
from app.db.models import SystemMetadata, VisualNovel, VNSimilarity, VNCoOccurrence
from app.logging import ScriptDBLogHandler

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

# Will be initialized after DB is ready
_db_log_handler: Optional[ScriptDBLogHandler] = None


def setup_db_logging():
    """Initialize database logging after DB connection is ready."""
    global _db_log_handler

    _db_log_handler = ScriptDBLogHandler(
        source="worker",
        batch_size=50,
        flush_interval=5.0,
    )
    _db_log_handler.setFormatter(logging.Formatter("%(message)s"))
    _db_log_handler.start()
    logging.getLogger().addHandler(_db_log_handler)
    logger.info("Database logging enabled for worker")


def shutdown_db_logging():
    """Gracefully shutdown database logging."""
    global _db_log_handler
    if _db_log_handler:
        logger.info("Flushing worker database logs...")
        _db_log_handler.stop()
        _db_log_handler = None


async def get_database_status() -> dict:
    """Get comprehensive database status for logging."""
    try:
        async with async_session_maker() as session:
            # Get VN count
            result = await session.execute(
                select(func.count()).select_from(VisualNovel)
            )
            vn_count = result.scalar_one_or_none() or 0

            # Get similarity table counts
            result = await session.execute(
                select(func.count()).select_from(VNSimilarity)
            )
            similarity_count = result.scalar_one_or_none() or 0

            result = await session.execute(
                select(func.count()).select_from(VNCoOccurrence)
            )
            cooccurrence_count = result.scalar_one_or_none() or 0

            # Get last import time
            result = await session.execute(
                select(SystemMetadata).where(SystemMetadata.key == "last_import")
            )
            metadata = result.scalar_one_or_none()
            last_import = metadata.value if metadata else None

            # Calculate age
            hours_since = None
            if last_import:
                try:
                    last_import_dt = datetime.fromisoformat(last_import.replace('Z', '+00:00'))
                    hours_since = (datetime.utcnow() - last_import_dt.replace(tzinfo=None)).total_seconds() / 3600
                except Exception:
                    pass

            has_similarities = similarity_count > 0 and cooccurrence_count > 0

            return {
                "vn_count": vn_count,
                "similarity_count": similarity_count,
                "cooccurrence_count": cooccurrence_count,
                "has_similarities": has_similarities,
                "last_import": last_import,
                "hours_since_import": hours_since,
                "has_data": vn_count > 0,
                "needs_import": vn_count == 0,
            }
    except Exception as e:
        logger.error(f"Failed to get database status: {e}")
        return {
            "vn_count": 0,
            "last_import": None,
            "hours_since_import": None,
            "has_data": False,
            "needs_import": True,
            "error": str(e),
        }


async def run_daily_update():
    """Run the full import pipeline with timeout protection.

    The entire pipeline has a 4-hour timeout to prevent indefinite hangs.
    """
    import time
    from app.ingestion.importer import run_full_import
    from app.ingestion.model_trainer import (
        compute_tag_vectors,
        train_collaborative_filter,
        compute_vn_similarities,
        compute_item_item_similarity,
    )

    settings = get_settings()
    start_time = time.time()

    # Use config value or default to 4 hours
    max_duration = getattr(settings, 'full_import_timeout', 14400)

    logger.info("=" * 60)
    logger.info("STARTING DAILY VNDB DATA UPDATE (WORKER)")
    logger.info(f"Maximum duration: {max_duration // 3600} hours")
    logger.info("=" * 60)

    try:
        async with asyncio.timeout(max_duration):
            # Phase 1: Import data
            logger.info("\n>>> PHASE 1/3: DATA IMPORT <<<")
            await run_full_import(settings.dump_storage_path, max_age_hours=24, force=True)

            # Phase 2: Compute models
            logger.info("\n>>> PHASE 2/3: COMPUTING MODELS <<<")
            await compute_tag_vectors()
            await train_collaborative_filter()

            # Phase 3: Compute similarity tables
            logger.info("\n>>> PHASE 3/3: COMPUTING SIMILARITY TABLES <<<")
            await compute_vn_similarities()
            await compute_item_item_similarity()

            # Flush stale user caches so fresh data is served immediately
            from app.core.cache import get_cache
            cache = get_cache()
            flushed_lists = await cache.flush_pattern("user:list:*")
            flushed_stats = await cache.flush_pattern("user:stats:*")
            logger.info(f"Flushed {flushed_lists} user list caches and {flushed_stats} user stats caches")

            # Update last import time
            async with async_session_maker() as session:
                result = await session.execute(
                    select(SystemMetadata).where(SystemMetadata.key == "last_import")
                )
                metadata = result.scalar_one_or_none()
                now = datetime.utcnow().isoformat()
                if metadata:
                    metadata.value = now
                else:
                    metadata = SystemMetadata(key="last_import", value=now)
                    session.add(metadata)
                await session.commit()

            elapsed = time.time() - start_time
            logger.info("=" * 60)
            logger.info(f"DAILY UPDATE COMPLETE - Total time: {int(elapsed // 60)}m {int(elapsed % 60)}s")
            logger.info("=" * 60)

    except asyncio.TimeoutError:
        elapsed = time.time() - start_time
        logger.error("=" * 60)
        logger.error(f"DAILY UPDATE TIMED OUT after {int(elapsed // 3600)}h {int((elapsed % 3600) // 60)}m")
        logger.error(f"Maximum allowed duration: {max_duration // 3600} hours")
        logger.error("=" * 60)
        # Mark the import as failed in the database
        try:
            async with async_session_maker() as session:
                await session.execute(
                    text("""
                        UPDATE import_runs
                        SET status = 'failed',
                            error_message = 'Timed out after maximum duration',
                            ended_at = NOW()
                        WHERE status = 'running'
                    """)
                )
                await session.commit()
        except Exception as db_error:
            logger.error(f"Failed to mark import as failed: {db_error}")
        raise

    except Exception as e:
        logger.error(f"Daily update failed: {e}", exc_info=True)
        raise


async def recompute_models_only():
    """Recompute recommendation models and similarity tables without re-importing data.

    Used when data exists but similarity tables are empty (e.g., initial import
    crashed during Phase 3, or model_trainer was added after initial import).

    Has a 2-hour timeout to prevent indefinite hangs.
    """
    import time
    from app.ingestion.model_trainer import (
        compute_tag_vectors,
        train_collaborative_filter,
        compute_vn_similarities,
        compute_item_item_similarity,
    )

    start_time = time.time()
    max_duration = 7200  # 2 hours

    logger.info("=" * 60)
    logger.info("RECOMPUTING MODELS (data already present)")
    logger.info(f"Maximum duration: {max_duration // 3600} hours")
    logger.info("=" * 60)

    try:
        async with asyncio.timeout(max_duration):
            logger.info("\n>>> PHASE 2: COMPUTING MODELS <<<")
            await compute_tag_vectors()
            await train_collaborative_filter()

            logger.info("\n>>> PHASE 3: COMPUTING SIMILARITY TABLES <<<")
            await compute_vn_similarities()
            await compute_item_item_similarity()

            elapsed = time.time() - start_time
            logger.info("=" * 60)
            logger.info(f"MODEL RECOMPUTE COMPLETE - Total time: {int(elapsed // 60)}m {int(elapsed % 60)}s")
            logger.info("=" * 60)

    except asyncio.TimeoutError:
        elapsed = time.time() - start_time
        logger.error("=" * 60)
        logger.error(f"MODEL RECOMPUTE TIMED OUT after {int(elapsed // 60)}m")
        logger.error("=" * 60)
        raise

    except Exception as e:
        logger.error(f"Model recompute failed: {e}", exc_info=True)
        raise


async def check_and_update_if_stale():
    """Check if data is stale (>24h) or models are missing, and trigger updates.

    Checks:
    1. If database is empty → trigger full import (production only)
    2. If data exists but similarity tables are empty → recompute models
    3. If data is older than 24h → trigger full update (production only)

    In DEV_MODE, this function only logs status without triggering updates.
    This prevents unnecessary reimports during development.
    """
    settings = get_settings()
    status = await get_database_status()

    logger.info("-" * 60)
    logger.info("DATABASE STATUS CHECK")
    logger.info("-" * 60)

    if status.get("error"):
        logger.error(f"Could not check database: {status['error']}")
        return

    if status["has_data"]:
        logger.info(f"  VN Count: {status['vn_count']:,} visual novels")
        logger.info(f"  Similarities: {status['similarity_count']:,} rows")
        logger.info(f"  Co-occurrences: {status['cooccurrence_count']:,} rows")
        if status["hours_since_import"] is not None:
            logger.info(f"  Last Import: {status['hours_since_import']:.1f} hours ago")
        else:
            logger.info(f"  Last Import: {status['last_import'] or 'Unknown'}")

        if status["has_similarities"]:
            logger.info(f"  Status: Data and models are present and available")
        else:
            logger.warning(f"  Status: Data present but SIMILARITY TABLES ARE EMPTY")
    else:
        logger.warning("  VN Count: 0 (database is empty)")
        logger.warning("  Status: NEEDS INITIAL IMPORT")

    logger.info("-" * 60)

    # In DEV_MODE, never auto-trigger imports but still warn about missing models
    if settings.dev_mode:
        logger.info("DEV_MODE=true - Automatic imports disabled")
        if not status["has_data"]:
            logger.info("")
            logger.info("To import data, run: npm run api:import")
            logger.info("")
        elif not status["has_similarities"]:
            logger.warning("")
            logger.warning("Similarity tables are empty! Related Games and Users Also Read will not work.")
            logger.warning("To fix, run: npm run api:import (or wait for daily update in production)")
            logger.warning("")
        return

    # Production mode - check staleness and trigger if needed
    if not status["has_data"]:
        logger.info("No data found - triggering initial import")
        logger.info("(To disable auto-import, set DEV_MODE=true)")
        await run_daily_update()
        return

    # Data exists but similarity tables are empty - recompute models only (no reimport needed)
    if not status["has_similarities"]:
        logger.warning("Similarity tables are empty - recomputing models...")
        await recompute_models_only()
        return

    if status["hours_since_import"] is not None and status["hours_since_import"] > 23:
        logger.info(f"Data is {status['hours_since_import']:.1f} hours old - triggering update")
        await run_daily_update()
    else:
        logger.info("Data is fresh - no update needed")


async def main():
    """Main worker loop."""
    settings = get_settings()

    logger.info("=" * 60)
    logger.info("VNDB WORKER STARTING")
    logger.info("=" * 60)
    logger.info("")
    logger.info("  Data persists in Docker volumes across restarts.")
    logger.info("  You do NOT need to reimport after code changes.")
    logger.info("  See DEVELOPMENT.md for the full workflow guide.")
    logger.info("")

    if settings.dev_mode:
        logger.info("  Mode: DEVELOPMENT (DEV_MODE=true)")
        logger.info("  Auto-imports are DISABLED")
    else:
        logger.info("  Mode: PRODUCTION")
        logger.info("  Auto-imports are ENABLED (daily at 4:00 AM UTC)")

    logger.info("")
    logger.info("=" * 60)

    # Initialize database connection
    await init_db()

    # Enable database logging now that DB is ready
    setup_db_logging()

    # Run any pending data migrations
    # Data migrations populate columns without requiring full reimport
    try:
        from app.ingestion.data_migrations import run_pending_migrations, load_migrations
        logger.info("Checking for pending data migrations...")
        load_migrations()
        await run_pending_migrations()
    except Exception as e:
        logger.error(f"Data migration error: {e}")
        # Don't fail startup - migrations can be run manually later

    # Check database status (and maybe update if production mode).
    # If model computation fails (e.g. OOM), continue to scheduler setup
    # so the daily job can retry later instead of crash-looping.
    try:
        await check_and_update_if_stale()
    except Exception as e:
        logger.error(f"Startup check/update failed: {e}")
        logger.error("Worker will continue running — the daily scheduled job will retry.")

    # Set up scheduler for daily updates at 4 AM UTC
    scheduler = AsyncIOScheduler()

    if not settings.dev_mode:
        scheduler.add_job(
            run_daily_update,
            CronTrigger(hour=4, minute=0),
            id="daily_vndb_update",
            replace_existing=True,
            misfire_grace_time=3600,  # Allow job to run up to 1 hour late
            coalesce=True,  # If multiple runs missed, only run once
        )
        logger.info("Scheduler started - daily update scheduled for 4:00 AM UTC")
    else:
        logger.info("Scheduler not started (DEV_MODE=true)")

    scheduler.start()

    # Keep running forever
    try:
        while True:
            await asyncio.sleep(3600)
    except (KeyboardInterrupt, SystemExit):
        logger.info("Worker shutting down...")
        shutdown_db_logging()
        scheduler.shutdown()


if __name__ == "__main__":
    asyncio.run(main())
