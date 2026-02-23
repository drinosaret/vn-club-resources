"""VNDB Stats API - FastAPI Application."""

import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import timezone

from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

# Configure logging - cleaner output for development
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)

# Suppress noisy loggers - SQLAlchemy is especially chatty
logging.getLogger("sqlalchemy").setLevel(logging.WARNING)
logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)
logging.getLogger("sqlalchemy.engine.Engine").setLevel(logging.WARNING)
logging.getLogger("sqlalchemy.pool").setLevel(logging.WARNING)
logging.getLogger("sqlalchemy.dialects").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("asyncio").setLevel(logging.WARNING)
logging.getLogger("watchfiles").setLevel(logging.WARNING)

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.api.v1.router import api_router
from app.db.database import init_db, get_db
from app.db.models import VisualNovel, SystemMetadata
from app.core.tasks import TaskManager

logger = logging.getLogger(__name__)
settings = get_settings()

# Rate limiter - 100 requests per minute per IP for general endpoints
# Heavy endpoints like recommendations have stricter limits applied via decorators
limiter = Limiter(key_func=get_remote_address, default_limits=["100/minute"])

scheduler = AsyncIOScheduler(
    timezone=timezone.utc,
    job_defaults={
        # If the host sleeps / containers restart near trigger time, run the job
        # when we come back instead of skipping it.
        "misfire_grace_time": 60 * 60,  # 1 hour
        # If multiple runs were missed, do a single catch-up run.
        "coalesce": True,
        # Avoid overlapping runs if a job takes longer than its interval.
        "max_instances": 1,
    },
)
task_manager = TaskManager.get_instance()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler for startup/shutdown."""
    # Import news aggregator jobs
    from app.ingestion.news_aggregator import (
        run_vndb_news_check,
        run_vndb_releases_check,
        run_rss_check,
        run_twitter_check,
        run_news_cleanup,
        run_news_catch_up,
    )
    from app.services.vn_of_the_day_service import run_vn_of_the_day_selection
    from app.logging import AsyncDBLogHandler, DiscordWebhookLogHandler
    from app.logging.cleanup import cleanup_old_logs

    # Startup
    await init_db()

    # Initialize database logging handler
    db_log_handler = AsyncDBLogHandler(
        batch_size=50,
        flush_interval=5.0,
        min_level=logging.INFO,
    )
    db_log_handler.setFormatter(logging.Formatter("%(message)s"))
    db_log_handler.start()
    logging.getLogger().addHandler(db_log_handler)
    logger.info("Database logging handler initialized")

    # Initialize Discord webhook logging (optional)
    discord_log_handler = None
    settings = get_settings()
    if settings.discord_log_webhook_url:
        discord_log_handler = DiscordWebhookLogHandler(
            webhook_url=settings.discord_log_webhook_url,
            flush_interval=5.0,
        )
        discord_log_handler.setFormatter(
            logging.Formatter("%(asctime)s %(levelname)-7s %(message)s", datefmt="%H:%M:%S")
        )
        discord_log_handler.start()
        logging.getLogger().addHandler(discord_log_handler)
        logger.info("Discord webhook logging enabled for API")

    # Note: Daily VNDB imports are handled by the worker container
    # to avoid blocking API queries during database-intensive operations.
    # See scripts/worker.py for the scheduled import job.
    # Do NOT run check_and_update_if_stale() here — it triggers heavy
    # computation (model training, similarity matrices) that starves API requests.

    # News aggregation jobs (matching Discord bot schedule)
    # VNDB New VNs - 10:00 UTC daily
    scheduler.add_job(
        run_vndb_news_check,
        CronTrigger(hour=10, minute=0),
        id="vndb_news_check",
        replace_existing=True,
    )

    # VNDB Releases - 16:00 UTC daily
    scheduler.add_job(
        run_vndb_releases_check,
        CronTrigger(hour=16, minute=0),
        id="vndb_releases_check",
        replace_existing=True,
    )

    # RSS Feeds - 06:00, 18:00 UTC
    scheduler.add_job(
        run_rss_check,
        CronTrigger(hour="6,18", minute=0),
        id="rss_check",
        replace_existing=True,
    )

    # Twitter - 01:00, 07:00, 13:00, 19:00 UTC
    scheduler.add_job(
        run_twitter_check,
        CronTrigger(hour="1,7,13,19", minute=0),
        id="twitter_check",
        replace_existing=True,
    )

    # News cleanup - 00:00 UTC daily
    scheduler.add_job(
        run_news_cleanup,
        CronTrigger(hour=0, minute=0),
        id="news_cleanup",
        replace_existing=True,
    )

    # App logs cleanup - 03:00 UTC daily (30 day retention)
    scheduler.add_job(
        cleanup_old_logs,
        CronTrigger(hour=3, minute=0),
        id="app_logs_cleanup",
        replace_existing=True,
    )

    # VN of the Day - 00:05 UTC daily (after cleanup, before news)
    scheduler.add_job(
        run_vn_of_the_day_selection,
        CronTrigger(hour=0, minute=5),
        id="vn_of_the_day",
        replace_existing=True,
    )

    # News catch-up - every 2 hours from 10:30 to 22:30 UTC
    # Checks if today's news was fetched, catches up if missing
    scheduler.add_job(
        run_news_catch_up,
        CronTrigger(hour="10,12,14,16,18,20,22", minute=30),
        id="news_catch_up",
        replace_existing=True,
    )

    scheduler.start()
    logger.info("Scheduler started - daily updates at 4:00 AM UTC")
    logger.info("News aggregation jobs scheduled: VNDB (10:00, 16:00), RSS (06:00, 18:00), Twitter (01:00, 07:00, 13:00, 19:00)")
    logger.info("VN of the Day scheduled: 00:05 UTC daily")
    logger.info("News catch-up job scheduled: every 2 hours from 10:30 to 22:30 UTC")
    logger.info("App logs cleanup scheduled: 03:00 UTC daily (30 day retention)")

    # Run catch-up on startup (with delay to let DB warm up)
    async def delayed_catch_up():
        await asyncio.sleep(30)  # Wait 30 seconds after startup
        await run_news_catch_up()

    async def delayed_votd_check():
        await asyncio.sleep(35)  # After news catch-up
        await run_vn_of_the_day_selection()

    task_manager.create_task(delayed_catch_up(), name="startup_news_catch_up")
    task_manager.create_task(delayed_votd_check(), name="startup_votd_check")

    yield

    # Shutdown
    logger.info("Shutting down application...")
    await task_manager.cancel_all(timeout=10.0)
    if discord_log_handler:
        discord_log_handler.stop()
    db_log_handler.stop()
    scheduler.shutdown()
    logger.info("Shutdown complete")


_show_docs = settings.debug or settings.enable_api_docs
app = FastAPI(
    title=settings.app_name,
    description=(
        "Public API for VNDB visual novel statistics, personalized recommendations, "
        "and browsing data. Powered by daily VNDB database dumps.\n\n"
        # Actual limits configured in rate_limit_default (line ~48) and per-endpoint @limiter decorators
        "**Rate limits:** Most endpoints allow 100 requests/minute per IP. "
        "User stats and recommendations are limited to 10/minute."
    ),
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs" if _show_docs else None,
    redoc_url="/redoc" if _show_docs else None,
)

# Rate limiting
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS middleware - restricted methods and headers for security
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Correlation-ID"],
    expose_headers=["X-Correlation-ID"],  # Allow frontend to read correlation ID
)

# Correlation ID middleware for request tracing
from app.middleware import CorrelationIDMiddleware
app.add_middleware(CorrelationIDMiddleware)

# Include API routes
app.include_router(api_router, prefix="/api/v1")


@app.get("/health", include_in_schema=False)
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "service": settings.app_name}


@app.get("/health/db", include_in_schema=False)
async def db_status(db: AsyncSession = Depends(get_db)):
    """Check database status and data availability."""
    try:
        # Get VN count
        result = await db.execute(select(func.count()).select_from(VisualNovel))
        vn_count = result.scalar_one_or_none() or 0

        # Get count with released date
        result = await db.execute(
            select(func.count()).select_from(VisualNovel).where(VisualNovel.released.isnot(None))
        )
        with_released = result.scalar_one_or_none() or 0

        # Get count with minage
        result = await db.execute(
            select(func.count()).select_from(VisualNovel).where(VisualNovel.minage.isnot(None))
        )
        with_minage = result.scalar_one_or_none() or 0

        # Get count with length
        result = await db.execute(
            select(func.count()).select_from(VisualNovel).where(VisualNovel.length.isnot(None))
        )
        with_length = result.scalar_one_or_none() or 0

        # Get last import time
        result = await db.execute(
            select(SystemMetadata).where(SystemMetadata.key == "last_import")
        )
        metadata = result.scalar_one_or_none()
        last_import = metadata.value if metadata else None

        # Get next scheduled update
        job = scheduler.get_job("daily_vndb_update")
        next_update = job.next_run_time.isoformat() if job and job.next_run_time else None

        return {
            "status": "healthy",
            "has_data": vn_count > 0,
            "vn_count": vn_count,
            "with_released": with_released,
            "with_minage": with_minage,
            "with_length": with_length,
            "last_import": last_import,
            "next_update": next_update,
        }
    except Exception as e:
        logging.getLogger(__name__).error(f"Health check DB error: {e}")
        return {
            "status": "error",
            "has_data": False,
            "vn_count": 0,
            "error": "Database health check failed",
        }


@app.get("/", include_in_schema=False)
async def root():
    """Root endpoint with API info."""
    info = {
        "name": settings.app_name,
        "version": "1.0.0",
        "health": "/health",
    }
    if _show_docs:
        info["docs"] = "/docs"
    return info
