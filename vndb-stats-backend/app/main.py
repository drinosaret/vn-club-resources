"""VNDB Stats API - FastAPI Application."""

import logging
from contextlib import asynccontextmanager

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

task_manager = TaskManager.get_instance()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler for startup/shutdown."""
    from app.logging import AsyncDBLogHandler, DiscordWebhookLogHandler

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

    # Note: All scheduled jobs (daily imports, news aggregation, VN of the Day,
    # log cleanup) are handled by the worker container (scripts/worker.py).
    # The API only handles HTTP requests.

    yield

    # Shutdown
    logger.info("Shutting down application...")
    await task_manager.cancel_all(timeout=10.0)
    if discord_log_handler:
        discord_log_handler.stop()
    db_log_handler.stop()
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

        # Next update is always 4:00 AM UTC (scheduled in worker container)
        from datetime import datetime, timezone, timedelta
        now_utc = datetime.now(timezone.utc)
        next_4am = now_utc.replace(hour=4, minute=0, second=0, microsecond=0)
        if next_4am <= now_utc:
            next_4am += timedelta(days=1)
        next_update = next_4am.isoformat()

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
