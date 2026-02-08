"""Log cleanup utilities."""

import logging
from datetime import datetime, timezone, timedelta

from sqlalchemy import delete

from app.db.database import async_session
from app.db.models import AppLog

logger = logging.getLogger(__name__)


async def cleanup_old_logs(retention_days: int = 30):
    """
    Delete logs older than retention period.

    Args:
        retention_days: Number of days to retain logs (default 30)
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)

    try:
        async with async_session() as db:
            result = await db.execute(
                delete(AppLog).where(AppLog.timestamp < cutoff)
            )
            await db.commit()

            deleted_count = result.rowcount
            if deleted_count > 0:
                logger.info(f"Log cleanup: deleted {deleted_count} entries older than {retention_days} days")
            else:
                logger.debug(f"Log cleanup: no entries older than {retention_days} days")

            return deleted_count

    except Exception as e:
        logger.error(f"Log cleanup failed: {e}")
        raise
