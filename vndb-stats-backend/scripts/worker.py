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
from app.db.models import SystemMetadata, VisualNovel, VNSimilarity, VNCoOccurrence, ImportRun
from app.logging import ScriptDBLogHandler, DiscordWebhookLogHandler

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
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


_discord_log_handler: Optional[DiscordWebhookLogHandler] = None


def setup_discord_logging():
    """Initialize Discord webhook logging if configured."""
    global _discord_log_handler
    settings = get_settings()

    if not settings.discord_log_webhook_url:
        return

    _discord_log_handler = DiscordWebhookLogHandler(
        webhook_url=settings.discord_log_webhook_url,
        flush_interval=5.0,
    )
    _discord_log_handler.setFormatter(
        logging.Formatter("%(asctime)s %(levelname)-7s %(message)s", datefmt="%H:%M:%S")
    )
    _discord_log_handler.start()
    logging.getLogger().addHandler(_discord_log_handler)
    logger.info("Discord webhook logging enabled for worker")


def shutdown_discord_logging():
    """Gracefully shutdown Discord webhook logging."""
    global _discord_log_handler
    if _discord_log_handler:
        logger.info("Flushing worker Discord logs...")
        _discord_log_handler.stop()
        _discord_log_handler = None


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
    from datetime import timezone
    from app.ingestion.importer import run_import_with_tracking
    from app.ingestion.model_trainer import (
        compute_tag_vectors,
        train_collaborative_filter,
        compute_vn_similarities,
        compute_item_item_similarity,
        swap_similarity_tables,
    )

    settings = get_settings()
    start_time = time.time()

    # Use config value or default to 4 hours
    max_duration = getattr(settings, 'full_import_timeout', 14400)

    logger.info("=" * 60)
    logger.info("STARTING DAILY VNDB DATA UPDATE (WORKER)")
    logger.info(f"Maximum duration: {max_duration // 3600} hours")
    logger.info("=" * 60)

    # Create ImportRun record so Discord bot can track progress
    run_id = None
    try:
        async with async_session_maker() as db:
            run = ImportRun(
                status="pending",
                triggered_by="scheduled",
                started_at=datetime.now(timezone.utc),
                current_step=0,
                total_steps=27,
                progress_percent=0.0,
            )
            db.add(run)
            await db.commit()
            await db.refresh(run)
            run_id = run.id
        logger.info(f"Created import run #{run_id}")
    except Exception as e:
        logger.error(f"Failed to create ImportRun record: {e}")
        # Continue without tracking; import still works

    # Stages that are allowed to fail without aborting the run record themselves
    # here, so the run can report itself as degraded instead of reporting success.
    degraded: list[str] = []

    try:
        async with asyncio.timeout(max_duration):
            # Phase 1: Import data
            logger.info("\n>>> PHASE 1/4: DATA IMPORT <<<")
            if run_id:
                await run_import_with_tracking(run_id, force_download=True)
            else:
                # Fallback if ImportRun creation failed
                from app.ingestion.importer import run_full_import
                await run_full_import(settings.dump_storage_path, max_age_hours=24, force=True)

            # Phases 2 and 3 rebuild the recommendation model from the imported
            # data. Failing here leaves the previous similarity tables live and
            # must not stop the cache flush, leaderboards and difficulty refresh
            # below, none of which depend on the model. Grouping the stages in one
            # block also keeps the swap from running on a partial rebuild.
            try:
                # Phase 2: Compute models
                logger.info("\n>>> PHASE 2/4: COMPUTING MODELS <<<")
                await compute_tag_vectors()
                await train_collaborative_filter()

                # Phase 3: Compute similarity tables
                logger.info("\n>>> PHASE 3/4: COMPUTING SIMILARITY TABLES <<<")
                await compute_vn_similarities()
                await compute_item_item_similarity()
                await swap_similarity_tables()
            except Exception as e:
                degraded.append("model rebuild")
                logger.error(f"Model rebuild failed: {e}", exc_info=True)

            # Flush stale caches so fresh data is served immediately. Entity, VN and
            # global caches are included: they have their own TTLs, but leaving them to
            # expire means serving pre-import numbers for up to an hour afterwards.
            #
            # Everything the leaderboard rebuild owns is deliberately absent from this
            # list. The rebuild overwrites each of its keys, so clearing them first buys
            # nothing, and it is what would leave the site with no boards at all if the
            # rebuild then failed. Their own TTL is what retires a key no longer written.
            from app.core.cache import get_cache
            cache = get_cache()
            flushed = {
                pattern: await cache.flush_pattern(pattern)
                for pattern in (
                    "user:list:*", "user:stats:*", "browse:*",
                    "tag_stats:*", "trait_stats:*", "producer_stats:*",
                    "staff_stats:*", "seiyuu_stats:*", "similar_tags:*",
                    "similar_traits:*", "tag_traits:*", "trait_tags:*",
                    "vn:*", "global_stats:*",
                    # The reader profiles and signal pages are built against the catalogue
                    # the import has just replaced.
                    "rec:profile:*", "rec:list:*",
                )
            }
            logger.info(
                "Flushed caches: "
                + ", ".join(f"{n} {p}" for p, n in flushed.items() if n)
            )

            # Phase 4: Rebuild the leaderboards from the freshly imported data.
            logger.info("\n>>> PHASE 4/4: BUILDING LEADERBOARDS <<<")
            try:
                from app.leaderboards.compute import refresh_leaderboards
                board_stats = await refresh_leaderboards()
                logger.info(f"Leaderboards: {board_stats}")
            except Exception as e:
                # A failed rebuild leaves yesterday's boards in place until their TTL
                # expires, which is preferable to failing the whole import over them.
                degraded.append("leaderboards")
                logger.error(f"Leaderboard refresh failed: {e}", exc_info=True)

            # Reading difficulty comes from a third party rather than the dump, so it is
            # refreshed alongside rather than as part of the import, and its failure is
            # never allowed to fail the run: the mirror keeps the previous rows.
            try:
                from app.ingestion.jiten_difficulty import import_jiten_difficulty
                logger.info(f"Difficulty: {await import_jiten_difficulty()}")
            except Exception as e:
                degraded.append("difficulty")
                logger.error(f"Difficulty refresh failed: {e}", exc_info=True)

            # last_import marks the data load. last_full_update only advances when
            # every stage succeeded, so a degraded run stays visibly behind it.
            # The Discord-triggered import path stamps the same key in timezone-aware
            # form; readers of this value normalise both shapes rather than assuming one.
            now = datetime.utcnow().isoformat()
            stamps = {"last_import": now}
            if not degraded:
                stamps["last_full_update"] = now

            async with async_session_maker() as session:
                for key, value in stamps.items():
                    result = await session.execute(
                        select(SystemMetadata).where(SystemMetadata.key == key)
                    )
                    metadata = result.scalar_one_or_none()
                    if metadata:
                        metadata.value = value
                    else:
                        session.add(SystemMetadata(key=key, value=value))
                await session.commit()

            if degraded:
                logger.error(
                    "Daily update finished with failed stages: " + ", ".join(degraded)
                )

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
            if run_id:
                async with async_session_maker() as session:
                    await session.execute(
                        text("""
                            UPDATE import_runs
                            SET status = 'failed',
                                error_message = 'Timed out after maximum duration',
                                ended_at = NOW()
                            WHERE id = :run_id AND status = 'running'
                        """),
                        {"run_id": run_id}
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
        swap_similarity_tables,
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
            await swap_similarity_tables()

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


async def run_board_health_check():
    """Report how much of the board set is still readable.

    The boards are written once a night and then only read, at whatever rate each one
    attracts. A payload can therefore stop being resident hours after the run that stored
    it reported success, and a board that is not resident answers every request with the
    same regenerating response it gives during a genuine rebuild. Nothing on the serving
    path can tell those apart, so the shortfall is only visible by counting the set.
    """
    from app.leaderboards.compute import board_census

    census = await board_census()
    if not census["catalogue"]:
        logger.error("Board catalogue is not in the cache; every ranking is unavailable")
        return census

    missing = census["missing"]
    if missing:
        logger.error(
            f"{len(missing)} of {census['expected']} board payloads are not in the cache: "
            f"{', '.join(missing[:5])}"
        )
    else:
        logger.info(f"All {census['expected']} board payloads are in the cache")
    return census


async def run_description_embedding_update():
    """Top up description vectors for entries the import added or reworded.

    Scheduled well clear of the import rather than chained onto it. The import's atomic
    swaps rename the tag, staff, relation and release tables; this job reads only
    visual_novels and writes only its own table, so it cannot hold a lock either of them
    waits on, and its session sets a short lock timeout besides.

    Failure is logged and swallowed. Recommendations degrade to a day-old matrix, which
    is a far smaller problem than a worker that crash-loops out of its other schedules.
    """
    from app.ingestion.description_embeddings import run_nightly

    try:
        async with asyncio.timeout(5400):
            stats = await run_nightly(async_session_maker)
        logger.info(f"Description embeddings updated: {stats}")
    except asyncio.TimeoutError:
        logger.error(
            "Description embedding update timed out; committed work is kept and the "
            "next run resumes from it"
        )
    except Exception as e:
        logger.error(f"Description embedding update failed: {e}", exc_info=True)


async def run_user_recs_precompute():
    """Rewrite the cached recommendation page of readers who already hold one.

    The read path treats a page older than its TTL as absent, while retention keeps rows
    for weeks, so a reader returning the day after their last visit pays for a full
    scoring run against rows still sitting in the table. Refreshing on a schedule is what
    closes that gap.

    Scheduled clear of both the import and the embedding top-up: it scores against the
    models those two produce, and reading them half-rebuilt would cache pages nothing
    would reproduce.

    The audience is capped, and the cap matters on a disk-constrained host: a page
    rewritten nightly is never old enough for the retention sweep, so the readers covered
    are a floor under the table rather than a tenancy that expires.

    Failure is logged and swallowed. The request path still computes and caches a page on
    demand, so the worst outcome is the cold read this job exists to avoid.
    """
    from app.ingestion.precompute_user_recs import (
        get_cached_readers,
        precompute_user_recommendations,
    )

    settings = get_settings()
    cap = settings.precompute_max_users

    try:
        async with asyncio.timeout(settings.precompute_timeout):
            readers = await get_cached_readers(limit=cap)
            if not readers:
                logger.info("Recommendation precompute: no cached readers, nothing to refresh")
                return
            if len(readers) == cap:
                logger.warning(
                    f"Recommendation precompute capped at {cap} readers; the oldest pages "
                    f"are refreshed first and the rest wait for the next run"
                )
            stats = await precompute_user_recommendations(user_ids=readers)
        logger.info(f"Recommendation precompute complete: {stats}")
    except asyncio.TimeoutError:
        logger.error(
            "Recommendation precompute timed out; pages already written are kept and the "
            "next run starts from the oldest"
        )
    except Exception as e:
        logger.error(f"Recommendation precompute failed: {e}", exc_info=True)


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
    setup_discord_logging()

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
        logger.error("Worker will continue running; the daily scheduled job will retry.")

    # Set up scheduler for all periodic jobs
    from datetime import timezone
    from app.ingestion.news_aggregator import (
        run_vndb_news_check,
        run_community_check,
        run_reviews_check,
        run_vndb_releases_check,
        run_headlines_check,
        run_trailers_check,
        run_storefront_check,
        run_news_reconcile,
        run_news_cleanup,
        run_news_catch_up,
    )
    from app.services.vn_of_the_day_service import run_vn_of_the_day_selection
    from app.services.word_of_the_day_service import run_word_of_the_day_selection
    from app.services.hikaru_import import run_import as run_hikaru_import, is_enabled as hikaru_import_enabled
    from app.logging.cleanup import cleanup_old_logs
    from app.services.recommendation_cache import cleanup_stale_cache

    scheduler = AsyncIOScheduler(
        timezone=timezone.utc,
        job_defaults={
            "misfire_grace_time": 3600,
            "coalesce": True,
            "max_instances": 1,
        },
    )

    if not settings.dev_mode:
        # Daily VNDB data import - 04:00 UTC
        scheduler.add_job(
            run_daily_update,
            CronTrigger(hour=4, minute=0),
            id="daily_vndb_update",
            replace_existing=True,
        )

        # News aggregation jobs
        scheduler.add_job(
            run_vndb_news_check,
            CronTrigger(hour=10, minute=0),
            id="vndb_news_check",
            replace_existing=True,
        )
        scheduler.add_job(
            run_vndb_releases_check,
            CronTrigger(hour=16, minute=0),
            id="vndb_releases_check",
            replace_existing=True,
        )
        scheduler.add_job(
            run_headlines_check,
            CronTrigger(hour="*/2", minute=5),
            id="news_headlines",
            replace_existing=True,
        )
        # Ahead of the community job, so a post reaching both is filed as a review.
        scheduler.add_job(
            run_reviews_check,
            CronTrigger(minute=20),
            id="news_reviews",
            replace_existing=True,
        )
        scheduler.add_job(
            run_community_check,
            CronTrigger(hour="*/3", minute=35),
            id="news_community",
            replace_existing=True,
        )
        scheduler.add_job(
            run_trailers_check,
            CronTrigger(hour="*/6", minute=20),
            id="news_trailers",
            replace_existing=True,
        )
        # After the 04:00 dump import, so storefront ids resolve against today's catalogue.
        scheduler.add_job(
            run_storefront_check,
            CronTrigger(hour=12, minute=0),
            id="news_storefronts",
            replace_existing=True,
        )
        scheduler.add_job(
            run_news_reconcile,
            CronTrigger(hour=5, minute=30),
            id="news_reconcile",
            replace_existing=True,
        )
        scheduler.add_job(
            run_news_cleanup,
            CronTrigger(hour=0, minute=0),
            id="news_cleanup",
            replace_existing=True,
        )
        scheduler.add_job(
            run_news_catch_up,
            CronTrigger(hour="10,12,14,16,18,20,22", minute=30),
            id="news_catch_up",
            replace_existing=True,
        )

        # VN of the Day - 00:05 UTC daily
        scheduler.add_job(
            run_vn_of_the_day_selection,
            CronTrigger(hour=0, minute=5),
            id="vn_of_the_day",
            replace_existing=True,
        )

        # Word of the Day - 00:10 UTC daily
        scheduler.add_job(
            run_word_of_the_day_selection,
            CronTrigger(hour=0, minute=10),
            id="word_of_the_day",
            replace_existing=True,
        )

        # App logs cleanup - 03:00 UTC daily (30 day retention)
        scheduler.add_job(
            cleanup_old_logs,
            CronTrigger(hour=3, minute=0),
            id="app_logs_cleanup",
            replace_existing=True,
        )

        # Recommendation cache cleanup - 02:30 UTC daily. The read path applies its TTL as a
        # filter and the request path writes a row on every miss, so nothing else bounds the
        # table. Scheduled clear of the import so a long sweep cannot overlap it.
        scheduler.add_job(
            cleanup_stale_cache,
            CronTrigger(hour=2, minute=30),
            id="recommendation_cache_cleanup",
            replace_existing=True,
        )

        logger.info("Scheduler started - daily update at 4:00 AM UTC")
        logger.info("News aggregation jobs scheduled: VNDB (10:00, 16:00), headlines (every 2h), trailers (every 6h), storefronts (12:00), reconcile (05:30)")
        logger.info("VN of the Day scheduled: 00:05 UTC daily")
        logger.info("Word of the Day scheduled: 00:10 UTC daily")
        logger.info("News catch-up job scheduled: every 2 hours from 10:30 to 22:30 UTC")
        logger.info("App logs cleanup scheduled: 03:00 UTC daily (30 day retention)")
        # Description embedding top-up - 09:30 UTC daily. The import starts at 04:00 and
        # is bounded by its own 4 hour timeout, so this cannot begin while it is running.
        scheduler.add_job(
            run_description_embedding_update,
            CronTrigger(hour=9, minute=30),
            id="description_embeddings",
            replace_existing=True,
        )

        # Cached recommendation page refresh - 11:30 UTC daily. Last in the chain the
        # import starts: the embedding top-up begins at 09:30 under a 90 minute timeout,
        # and the pages written here are scored against what it leaves behind.
        scheduler.add_job(
            run_user_recs_precompute,
            CronTrigger(hour=11, minute=30),
            id="user_recs_precompute",
            replace_existing=True,
        )

        # Board census - 16:00 UTC daily. Placed well after the 04:00 import rather than
        # beside it: a board is stored successfully and then stops being resident later in
        # the day, so a check that runs with the rebuild would always find the set whole.
        scheduler.add_job(
            run_board_health_check,
            CronTrigger(hour=16, minute=0),
            id="board_health_check",
            replace_existing=True,
        )

        logger.info("Board census scheduled: 16:00 UTC daily")
        logger.info("Recommendation cache cleanup scheduled: 02:30 UTC daily")
        logger.info("Description embedding top-up scheduled: 09:30 UTC daily")
        logger.info("Recommendation page refresh scheduled: 11:30 UTC daily")
    else:
        logger.info("Scheduler not started (DEV_MODE=true)")

    # Hikaru -> calendar import. Not gated by DEV_MODE (we want it in dev too);
    # only active when HIKARU_DB_PATH + VNCR_GUILD_ID are configured.
    if hikaru_import_enabled():
        scheduler.add_job(
            run_hikaru_import,
            CronTrigger(minute=15),
            id="hikaru_calendar_import",
            replace_existing=True,
        )
        logger.info("Hikaru calendar import scheduled: hourly at :15 UTC")
    else:
        logger.info(
            "Hikaru calendar import disabled (mount hikaru data via HIKARU_DATA_DIR; "
            "source guild from DISCORD_GUILD_ID or VNCR_GUILD_ID override)"
        )

    scheduler.start()

    # Run catch-up tasks on startup (with delay to let DB warm up)
    await asyncio.sleep(30)

    # The rankings and everything drawn from them live in Redis with a TTL, so an empty
    # cache is the normal state after a deploy, a Redis restart, or a missed night. The
    # rebuild reads the dump already in Postgres and takes a few minutes; leaving it to
    # the nightly cron leaves every board unavailable until then. Not gated on the mode:
    # the nightly cron is, so this is the only thing that ever builds boards in dev, and
    # the catalogue check below makes it a no-op once they exist.
    try:
        from app.core.cache import get_cache
        from app.leaderboards.spec import CATALOGUE_CACHE_KEY

        if await get_cache().get(CATALOGUE_CACHE_KEY) is None:
            logger.info("No leaderboards in cache; building them now")
            from app.leaderboards.compute import refresh_leaderboards

            logger.info(f"Leaderboards: {await refresh_leaderboards()}")
    except Exception as e:
        logger.error(f"Startup leaderboard build failed: {e}", exc_info=True)

    if not settings.dev_mode:
        # The difficulty mirror lives in Postgres rather than the cache, so it survives a
        # restart, but it is empty on a database that has never imported it and several
        # surfaces read it directly.
        try:
            from sqlalchemy import text as _text

            from app.db.database import async_session

            async with async_session() as db:
                measured = await db.execute(_text("SELECT count(*) FROM vn_difficulty"))
                held = measured.scalar() or 0
            if not held:
                logger.info("Difficulty mirror is empty; importing it now")
                from app.ingestion.jiten_difficulty import import_jiten_difficulty

                logger.info(f"Difficulty: {await import_jiten_difficulty()}")
        except Exception as e:
            logger.error(f"Startup difficulty import failed: {e}", exc_info=True)

        try:
            await run_news_catch_up()
        except Exception as e:
            logger.warning(f"Startup news catch-up failed: {e}")
        try:
            await run_vn_of_the_day_selection()
        except Exception as e:
            logger.warning(f"Startup VN of the Day check failed: {e}")
        try:
            await run_word_of_the_day_selection()
        except Exception as e:
            logger.warning(f"Startup Word of the Day check failed: {e}")

    # Startup hikaru import (runs in dev + prod when configured)
    if hikaru_import_enabled():
        try:
            await run_hikaru_import()
        except Exception as e:
            logger.warning(f"Startup hikaru import failed: {e}")

    # Keep running forever
    try:
        while True:
            await asyncio.sleep(3600)
    except (KeyboardInterrupt, SystemExit):
        logger.info("Worker shutting down...")
        shutdown_discord_logging()
        shutdown_db_logging()
        scheduler.shutdown()


if __name__ == "__main__":
    asyncio.run(main())
