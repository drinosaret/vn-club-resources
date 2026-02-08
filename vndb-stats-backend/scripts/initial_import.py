#!/usr/bin/env python
"""
Initial data import script.

Run this once after setting up the database to download and import
all VNDB data dumps.

Usage:
    python scripts/initial_import.py
    python scripts/initial_import.py --skip-download  # Use existing dumps
    python scripts/initial_import.py --max-age 48     # Re-download if older than 48h
    python scripts/initial_import.py --no-db-logging  # Disable database logging
"""

import argparse
import asyncio
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

# Add app to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import select
from app.config import get_settings
from app.db.database import init_db, async_session_maker
from app.db.models import SystemMetadata
from app.ingestion.importer import run_full_import
from app.ingestion.model_trainer import (
    compute_tag_vectors,
    train_collaborative_filter,
    compute_vn_similarities,
    compute_item_item_similarity,
)
from app.logging import ScriptDBLogHandler


def setup_logging(log_to_file: bool = True, use_db_logging: bool = True):
    """Configure logging with optional file and database output.

    Configures the root logger to ensure ALL loggers (including importer.py)
    output to console, file, and optionally database.

    Returns:
        Tuple of (logger, db_handler or None)
    """
    # Get the root logger to capture all child loggers
    root_logger = logging.getLogger()
    root_logger.setLevel(logging.INFO)

    # Clear any existing handlers to avoid duplicates
    root_logger.handlers.clear()

    # Console handler
    console_handler = logging.StreamHandler()
    console_handler.setLevel(logging.INFO)
    console_handler.setFormatter(logging.Formatter(
        "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
    ))
    root_logger.addHandler(console_handler)

    if log_to_file:
        # Create logs directory
        log_dir = Path(__file__).parent.parent / "logs"
        log_dir.mkdir(exist_ok=True)

        # Add file handler with timestamp
        log_file = log_dir / f"import_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"
        file_handler = logging.FileHandler(log_file, encoding="utf-8")
        file_handler.setLevel(logging.INFO)
        file_handler.setFormatter(logging.Formatter(
            "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
        ))
        root_logger.addHandler(file_handler)
        print(f"Logging to: {log_file}")

    # Database handler (will be started after init_db)
    db_handler: Optional[ScriptDBLogHandler] = None
    if use_db_logging:
        db_handler = ScriptDBLogHandler(
            source="import",
            batch_size=100,
            flush_interval=10.0,
        )
        db_handler.setFormatter(logging.Formatter("%(message)s"))
        # Don't add to root logger yet - need to wait for DB init

    return logging.getLogger(__name__), db_handler


async def update_last_import_time():
    """Update the last import timestamp in system metadata."""
    async with async_session_maker() as session:
        result = await session.execute(
            select(SystemMetadata).where(SystemMetadata.key == "last_import")
        )
        metadata = result.scalar_one_or_none()

        now = datetime.now(timezone.utc).isoformat()
        if metadata:
            metadata.value = now
        else:
            metadata = SystemMetadata(key="last_import", value=now)
            session.add(metadata)

        await session.commit()
        logging.getLogger(__name__).info(f"Updated last import time: {now}")


async def main(args):
    """Run initial data import."""
    logger, db_handler = setup_logging(
        log_to_file=not args.no_log_file,
        use_db_logging=not args.no_db_logging,
    )
    settings = get_settings()

    logger.info("=" * 60)
    logger.info("VNDB Data Import")
    logger.info(f"  Skip download: {args.skip_download}")
    logger.info(f"  Max age: {args.max_age} hours")
    logger.info(f"  Dump storage: {settings.dump_storage_path}")
    logger.info(f"  DB logging: {'enabled' if db_handler else 'disabled'}")
    logger.info("=" * 60)

    logger.info("Initializing database...")
    await init_db()

    # Now start database logging (after DB is ready)
    if db_handler:
        db_handler.start()
        logging.getLogger().addHandler(db_handler)
        logger.info("Database logging enabled for import script")

    try:
        logger.info("Starting data import...")

        # Run full import with options
        await run_full_import(
            settings.dump_storage_path,
            skip_download=args.skip_download,
            max_age_hours=args.max_age,
        )

        # Phase 2: Compute recommendation models
        logger.info("\n>>> PHASE 2/3: COMPUTING MODELS <<<")
        logger.info("Computing tag vectors...")
        await compute_tag_vectors()

        logger.info("Training collaborative filtering model...")
        await train_collaborative_filter()

        # Phase 3: Compute similarity tables
        logger.info("\n>>> PHASE 3/3: COMPUTING SIMILARITY TABLES <<<")
        logger.info("Computing VN similarities (content-based)...")
        await compute_vn_similarities()

        logger.info("Computing item-item similarity (collaborative)...")
        await compute_item_item_similarity()

        # Record import time
        await update_last_import_time()

        logger.info("=" * 60)
        logger.info("Initial import complete!")
        logger.info("=" * 60)
    except Exception as e:
        logger.exception(f"Import failed with error: {e}")
        raise
    finally:
        # Always stop DB handler to flush remaining logs
        if db_handler:
            logger.info("Flushing database logs...")
            db_handler.stop()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Import VNDB database dumps into PostgreSQL"
    )
    parser.add_argument(
        "--skip-download",
        action="store_true",
        help="Skip downloading dumps, use existing files in data directory"
    )
    parser.add_argument(
        "--max-age",
        type=int,
        default=168,
        help="Max dump age in hours before re-download (default: 168 = 1 week)"
    )
    parser.add_argument(
        "--no-log-file",
        action="store_true",
        help="Disable file logging (console only)"
    )
    parser.add_argument(
        "--no-db-logging",
        action="store_true",
        help="Disable database logging (useful if DB not ready)"
    )

    args = parser.parse_args()
    asyncio.run(main(args))
