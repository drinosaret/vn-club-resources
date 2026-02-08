"""Custom logging handler that writes to PostgreSQL database."""

import asyncio
import json
import logging
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from queue import Queue, Empty
from typing import Optional

# Import correlation ID helper - use late import to avoid circular dependency
def _get_correlation_id() -> str:
    """Get correlation ID from request context, if available."""
    try:
        from app.middleware.correlation import get_correlation_id
        return get_correlation_id()
    except ImportError:
        return ""
    except Exception:
        return ""

# Loggers to skip (too verbose)
SKIP_LOGGERS = frozenset([
    "sqlalchemy",
    "sqlalchemy.engine",
    "sqlalchemy.pool",
    "httpx",
    "httpcore",
    "asyncio",
    "asyncpg",
    "uvicorn",
    "uvicorn.access",
    "uvicorn.error",
    "fastapi",
])


class AsyncDBLogHandler(logging.Handler):
    """
    Asynchronous logging handler that writes to PostgreSQL.

    Features:
    - Async writes via background thread to avoid blocking
    - Batching for performance (flush every N records or T seconds)
    - Configurable minimum level
    - Skips noisy loggers (sqlalchemy, httpx, etc.)
    """

    def __init__(
        self,
        batch_size: int = 50,
        flush_interval: float = 5.0,
        min_level: int = logging.INFO,
        max_retries: int = 3,
        fallback_log_path: Optional[str] = None,
        shutdown_timeout: float = 30.0,
        circuit_breaker_threshold: int = 5,
    ):
        super().__init__()
        self.batch_size = batch_size
        self.flush_interval = flush_interval
        self.min_level = min_level
        self.max_retries = max_retries
        self.shutdown_timeout = shutdown_timeout
        self.circuit_breaker_threshold = circuit_breaker_threshold

        self._queue: Queue = Queue()
        self._retry_queue: Queue = Queue()
        self._worker_thread: Optional[threading.Thread] = None
        self._running = False
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._local_engine = None
        self._local_session = None

        # Fallback logging
        self.fallback_log_path = fallback_log_path or self._get_default_fallback_path()
        self._fallback_file_handler: Optional[logging.FileHandler] = None
        self._consecutive_failures = 0

        # Circuit breaker state
        self._circuit_open = False
        self._circuit_open_until: float = 0.0  # timestamp when to try again

    def _get_default_fallback_path(self) -> str:
        """Get default path for fallback logs."""
        log_dir = Path(__file__).parent.parent.parent / "logs"
        log_dir.mkdir(exist_ok=True)
        return str(log_dir / "fallback.log")

    def _get_fallback_handler(self) -> Optional[logging.FileHandler]:
        """Lazy initialize fallback file handler."""
        if self._fallback_file_handler is None:
            try:
                self._fallback_file_handler = logging.FileHandler(
                    self.fallback_log_path,
                    encoding="utf-8",
                )
                self._fallback_file_handler.setFormatter(
                    logging.Formatter("%(message)s")
                )
            except Exception as e:
                print(
                    f"[CRITICAL] Cannot create fallback log file: {e}",
                    file=sys.stderr,
                )
        return self._fallback_file_handler

    def _write_to_fallback(self, entry: dict):
        """Write failed log entry to fallback file."""
        try:
            handler = self._get_fallback_handler()
            if handler:
                fallback_record = {
                    "timestamp": (
                        entry["timestamp"].isoformat()
                        if hasattr(entry["timestamp"], "isoformat")
                        else str(entry["timestamp"])
                    ),
                    "level": entry["level"],
                    "source": entry["source"],
                    "module": entry["module"],
                    "message": entry["message"],
                    "extra_data": entry.get("extra_data"),
                    "failed_at": datetime.now(timezone.utc).isoformat(),
                    "retry_count": entry.get("_retry_count", 0),
                }
                handler.emit(
                    logging.LogRecord(
                        name="fallback",
                        level=logging.INFO,
                        pathname="",
                        lineno=0,
                        msg=json.dumps(fallback_record),
                        args=(),
                        exc_info=None,
                    )
                )
        except Exception as e:
            print(
                f"[CRITICAL] Fallback file write failed: {e}. "
                f"Original log: {entry.get('message', 'unknown')[:200]}",
                file=sys.stderr,
            )

    def start(self):
        """Start the background worker thread."""
        if self._running:
            return

        self._running = True
        self._worker_thread = threading.Thread(target=self._worker, daemon=True)
        self._worker_thread.start()

    def stop(self):
        """Stop the background worker thread with proper cleanup."""
        self._running = False
        if self._worker_thread:
            self._worker_thread.join(timeout=self.shutdown_timeout)
            if self._worker_thread.is_alive():
                print(
                    f"[DB_LOG_HANDLER] Worker thread did not stop within "
                    f"{self.shutdown_timeout}s timeout - some logs may be lost",
                    file=sys.stderr,
                )
            self._worker_thread = None

    def emit(self, record: logging.LogRecord):
        """Handle a log record - queue it for async writing."""
        # Check level
        if record.levelno < self.min_level:
            return

        # Skip internal/noisy loggers
        if any(record.name.startswith(skip) for skip in SKIP_LOGGERS):
            return

        # Skip our own logging to prevent recursion
        if record.name.startswith("app.logging"):
            return

        try:
            log_entry = {
                "timestamp": datetime.fromtimestamp(record.created, tz=timezone.utc),
                "level": record.levelname,
                "source": "backend",
                "module": record.name,
                "message": self.format(record),
                "extra_data": getattr(record, "extra_data", None),
                "correlation_id": _get_correlation_id() or None,
                "_retry_count": 0,
            }

            self._queue.put(log_entry)
        except Exception as e:
            # Log detailed error context to stderr
            error_detail = {
                "error": str(e),
                "error_type": type(e).__name__,
                "record_name": record.name,
                "record_level": record.levelname,
                "record_msg": str(record.msg)[:500],
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
            print(
                f"[DB_LOG_HANDLER] Failed to queue log: {json.dumps(error_detail)}",
                file=sys.stderr,
            )

    def _worker(self):
        """Background worker that flushes logs to database."""
        # Create a new event loop for this thread
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        self._loop = loop

        batch = []
        last_flush = datetime.now(timezone.utc)

        while self._running or not self._queue.empty() or not self._retry_queue.empty():
            # First, try to get from retry queue (higher priority for retries)
            try:
                item = self._retry_queue.get_nowait()
                batch.append(item)
            except Empty:
                pass

            # Then from main queue
            try:
                item = self._queue.get(timeout=1.0)
                batch.append(item)
            except Empty:
                pass

            # Check if we should flush
            now = datetime.now(timezone.utc)
            should_flush = (
                len(batch) >= self.batch_size
                or (batch and (now - last_flush).total_seconds() >= self.flush_interval)
            )

            if should_flush and batch:
                # Flush batch to database
                loop.run_until_complete(self._flush_batch(batch))
                batch = []
                last_flush = now

        # Flush remaining items on shutdown
        if batch:
            loop.run_until_complete(self._flush_batch(batch))

        # Clean up the local engine
        if self._local_engine:
            loop.run_until_complete(self._local_engine.dispose())
            self._local_engine = None
            self._local_session = None

        # Close fallback handler if open
        if self._fallback_file_handler:
            self._fallback_file_handler.close()
            self._fallback_file_handler = None

        loop.close()

    async def _flush_batch(self, batch: list):
        """Write a batch of log entries to the database with circuit breaker."""
        # Check circuit breaker
        if self._circuit_open:
            if time.time() < self._circuit_open_until:
                # Circuit is open - write to fallback and skip DB
                for entry in batch:
                    self._write_to_fallback(entry)
                return
            # Try to close circuit (half-open state)
            self._circuit_open = False
            print(
                "[DB_LOG_HANDLER] Circuit breaker half-open, attempting DB write",
                file=sys.stderr,
            )

        try:
            # Import here to avoid circular imports
            from app.config import get_settings
            from app.db.models import AppLog
            from sqlalchemy.ext.asyncio import (
                AsyncSession,
                async_sessionmaker,
                create_async_engine,
            )

            # Create a dedicated engine for this thread's event loop
            # This avoids sharing connections with the main app's event loop
            if not hasattr(self, "_local_engine") or self._local_engine is None:
                settings = get_settings()
                self._local_engine = create_async_engine(
                    settings.database_url,
                    pool_size=2,  # Small pool just for logging
                    max_overflow=2,
                    echo=False,
                    pool_pre_ping=True,
                )
                self._local_session = async_sessionmaker(
                    self._local_engine,
                    class_=AsyncSession,
                    expire_on_commit=False,
                )

            async with self._local_session() as db:
                for entry in batch:
                    log = AppLog(
                        timestamp=entry["timestamp"],
                        level=entry["level"],
                        source=entry["source"],
                        module=entry["module"],
                        message=entry["message"][:5000] if entry["message"] else "",
                        extra_data=entry.get("extra_data"),
                        correlation_id=entry.get("correlation_id"),
                    )
                    db.add(log)

                await db.commit()

            # Success - reset failure counter and close circuit
            self._consecutive_failures = 0
            if self._circuit_open:
                print("[DB_LOG_HANDLER] Circuit breaker closed - DB writes resumed", file=sys.stderr)
                self._circuit_open = False

        except Exception as e:
            self._consecutive_failures += 1

            # Detailed error logging
            error_context = {
                "error": str(e),
                "error_type": type(e).__name__,
                "batch_size": len(batch),
                "consecutive_failures": self._consecutive_failures,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
            print(
                f"[DB_LOG_HANDLER] Flush failed: {json.dumps(error_context)}",
                file=sys.stderr,
            )

            # Check if we should open the circuit breaker
            if self._consecutive_failures >= self.circuit_breaker_threshold:
                self._circuit_open = True
                self._circuit_open_until = time.time() + 60  # Open for 1 minute
                print(
                    f"[CRITICAL] DB logging circuit breaker OPENED after "
                    f"{self._consecutive_failures} consecutive failures. "
                    f"Will retry in 60 seconds. Logs redirected to fallback file.",
                    file=sys.stderr,
                )
                # Write all entries to fallback
                for entry in batch:
                    self._write_to_fallback(entry)
                return

            # Retry logic for each entry (only if circuit not open)
            for entry in batch:
                retry_count = entry.get("_retry_count", 0)
                if retry_count < self.max_retries:
                    entry["_retry_count"] = retry_count + 1
                    self._retry_queue.put(entry)
                else:
                    # Max retries exceeded - write to fallback file
                    self._write_to_fallback(entry)


class ScriptDBLogHandler(AsyncDBLogHandler):
    """
    Variant of AsyncDBLogHandler for standalone scripts.

    Differences from base class:
    - Uses a configurable source field instead of "backend"
    - Larger default batch size for import scripts
    - Provides clearer identification in logs

    Usage:
        handler = ScriptDBLogHandler(source="import")
        handler.start()
        logging.getLogger().addHandler(handler)
        try:
            # ... your script code ...
        finally:
            handler.stop()
    """

    def __init__(
        self,
        source: str = "script",
        batch_size: int = 100,
        flush_interval: float = 10.0,
        min_level: int = logging.INFO,
        max_retries: int = 3,
        fallback_log_path: Optional[str] = None,
    ):
        super().__init__(
            batch_size=batch_size,
            flush_interval=flush_interval,
            min_level=min_level,
            max_retries=max_retries,
            fallback_log_path=fallback_log_path,
        )
        self.source = source

    def emit(self, record: logging.LogRecord):
        """Handle a log record with script-specific source."""
        # Check level
        if record.levelno < self.min_level:
            return

        # Skip internal/noisy loggers
        if any(record.name.startswith(skip) for skip in SKIP_LOGGERS):
            return

        # Skip our own logging to prevent recursion
        if record.name.startswith("app.logging"):
            return

        try:
            log_entry = {
                "timestamp": datetime.fromtimestamp(record.created, tz=timezone.utc),
                "level": record.levelname,
                "source": self.source,  # Use configured source
                "module": record.name,
                "message": self.format(record),
                "extra_data": getattr(record, "extra_data", None),
                "_retry_count": 0,
            }

            self._queue.put(log_entry)
        except Exception as e:
            error_detail = {
                "error": str(e),
                "error_type": type(e).__name__,
                "record_name": record.name,
                "record_level": record.levelname,
                "record_msg": str(record.msg)[:500],
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
            print(
                f"[{self.source.upper()}_LOG] Failed to queue: {json.dumps(error_detail)}",
                file=sys.stderr,
            )


# Singleton instance
_handler_instance: Optional[AsyncDBLogHandler] = None


def get_db_handler(
    batch_size: int = 50,
    flush_interval: float = 5.0,
    min_level: int = logging.INFO,
) -> AsyncDBLogHandler:
    """Get or create the singleton DB log handler."""
    global _handler_instance

    if _handler_instance is None:
        _handler_instance = AsyncDBLogHandler(
            batch_size=batch_size,
            flush_interval=flush_interval,
            min_level=min_level,
        )

    return _handler_instance
