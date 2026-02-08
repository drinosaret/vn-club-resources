"""
Scheduled tasks for data ingestion and model training.

============================================================================
DAILY DATA PIPELINE - KEEPS LOCAL DATABASE UP TO DATE
============================================================================
This scheduler runs the daily ingestion pipeline that:

1. Downloads fresh VNDB database dumps (dl.vndb.org/dump/)
2. Imports data into LOCAL PostgreSQL (40k+ VNs, tags, traits, staff, etc.)
3. Recomputes recommendation models (tag vectors, collaborative filtering)
4. Precomputes user recommendations for caching

This ensures our LOCAL DATABASE stays current without hitting VNDB API limits.

The local database is the PRIMARY data source for all features:
- Statistics and analytics
- Recommendations
- VN metadata and search
- Tag/trait/staff information

>>> DO NOT bypass this system by adding direct VNDB API calls <<<
>>> The local database has everything you need for VN data <<<
============================================================================
"""

import asyncio
import logging
from datetime import datetime

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from app.config import get_settings
from app.ingestion.importer import run_full_import
from app.ingestion.model_trainer import (
    train_collaborative_filter,
    compute_tag_vectors,
    compute_vn_similarities,
    compute_item_item_similarity,
    train_hybrid_embeddings,
)
from app.ingestion.precompute_user_recs import precompute_user_recommendations

logger = logging.getLogger(__name__)
settings = get_settings()

scheduler = AsyncIOScheduler()


async def run_daily_ingestion():
    """Full daily ingestion pipeline."""
    logger.info("Starting daily VNDB data ingestion")
    start_time = datetime.now()

    try:
        # 1. Download and import dumps
        await run_full_import(settings.dump_storage_path)

        # 2. Recompute recommendation models
        logger.info("Computing tag vectors...")
        await compute_tag_vectors()

        logger.info("Training collaborative filter...")
        await train_collaborative_filter()

        # 3. Precompute VN-VN similarities (depends on tag vectors)
        logger.info("Computing VN-VN tag similarities...")
        await compute_vn_similarities(top_k=100)

        # 4. Compute item-item CF similarity (depends on global votes)
        logger.info("Computing item-item CF similarities...")
        await compute_item_item_similarity(top_k=50)

        # 5. Train hybrid embeddings (combines CF and tag vectors)
        logger.info("Training hybrid embeddings...")
        await train_hybrid_embeddings(n_components=64, epochs=30)

        # 6. Pre-compute user recommendations (depends on all models)
        logger.info("Pre-computing user recommendations...")
        await precompute_user_recommendations()

        elapsed = (datetime.now() - start_time).total_seconds()
        logger.info(f"Daily ingestion complete in {elapsed:.1f} seconds")

    except Exception as e:
        logger.error(f"Daily ingestion failed: {e}")
        raise


def start_scheduler():
    """Start the background scheduler."""
    # Schedule daily at 9:00 UTC (1 hour after VNDB's 8:00 UTC dump)
    scheduler.add_job(
        run_daily_ingestion,
        CronTrigger(hour=9, minute=0, timezone="UTC"),
        id="daily_ingestion",
        name="Daily VNDB data ingestion",
        replace_existing=True,
    )

    scheduler.start()
    logger.info("Scheduler started - daily ingestion at 09:00 UTC")


def stop_scheduler():
    """Stop the scheduler gracefully."""
    scheduler.shutdown(wait=True)
    logger.info("Scheduler stopped")


if __name__ == "__main__":
    # Run as standalone script for manual ingestion
    logging.basicConfig(level=logging.INFO)

    async def main():
        await run_daily_ingestion()

    asyncio.run(main())
