#!/usr/bin/env python
"""Run Alembic migrations automatically on container startup."""

import logging
import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from alembic.config import Config
from alembic import command

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)


def run_migrations():
    """Run all pending Alembic migrations to bring database to latest schema."""
    try:
        logger.info("=" * 60)
        logger.info("RUNNING DATABASE MIGRATIONS")
        logger.info("=" * 60)

        # Load Alembic configuration
        alembic_cfg = Config("alembic.ini")

        # Run upgrade to head (latest migration)
        command.upgrade(alembic_cfg, "head")

        logger.info("=" * 60)
        logger.info("✓ MIGRATIONS COMPLETE - Database schema is up to date")
        logger.info("=" * 60)

        return True

    except Exception as e:
        logger.error(f"❌ Migration failed: {e}", exc_info=True)
        logger.error("=" * 60)
        logger.error("Fix the migration error above and restart the container")
        logger.error("=" * 60)
        return False


if __name__ == "__main__":
    success = run_migrations()
    sys.exit(0 if success else 1)
