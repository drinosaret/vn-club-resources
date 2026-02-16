"""Discord webhook logging handler for worker process.

Mirrors worker terminal logs to a Discord channel via webhook.
Best-effort delivery — if Discord is down, logs are silently dropped
(the DB handler already captures everything).
"""

import logging
import sys
import threading
import time
from queue import Queue, Empty
from typing import Optional

import httpx

# Loggers to skip (duplicated from db_handler.py for independence)
SKIP_LOGGERS = frozenset([
    "sqlalchemy", "sqlalchemy.engine", "sqlalchemy.pool",
    "httpx", "httpcore", "asyncio", "asyncpg",
    "uvicorn", "uvicorn.access", "uvicorn.error",
])


class DiscordWebhookLogHandler(logging.Handler):
    """Logging handler that sends batched log messages to Discord via webhook.

    Accumulates formatted log lines in a buffer and flushes to Discord as
    code-block messages when the buffer approaches Discord's 2000-char limit
    or a time interval elapses.
    """

    def __init__(
        self,
        webhook_url: str,
        flush_interval: float = 5.0,
        max_message_length: int = 1800,
        shutdown_timeout: float = 10.0,
        circuit_breaker_threshold: int = 5,
        circuit_breaker_cooldown: float = 60.0,
    ):
        super().__init__(level=logging.INFO)
        self.webhook_url = webhook_url
        self.flush_interval = flush_interval
        self.max_message_length = max_message_length
        self.shutdown_timeout = shutdown_timeout
        self.circuit_breaker_threshold = circuit_breaker_threshold
        self.circuit_breaker_cooldown = circuit_breaker_cooldown

        self._queue: Queue = Queue()
        self._worker_thread: Optional[threading.Thread] = None
        self._running = False

        self._consecutive_failures = 0
        self._circuit_open = False
        self._circuit_open_until: float = 0.0

    def start(self):
        if self._running:
            return
        self._running = True
        self._worker_thread = threading.Thread(
            target=self._worker, daemon=True, name="discord-log-worker"
        )
        self._worker_thread.start()

    def stop(self):
        self._running = False
        if self._worker_thread:
            self._worker_thread.join(timeout=self.shutdown_timeout)
            self._worker_thread = None

    def emit(self, record: logging.LogRecord):
        if any(record.name.startswith(skip) for skip in SKIP_LOGGERS):
            return
        if record.name.startswith("app.logging"):
            return

        try:
            self._queue.put(self.format(record))
        except Exception:
            pass

    def _worker(self):
        client = httpx.Client(timeout=10.0)
        buffer_lines: list[str] = []
        buffer_length = 0
        last_flush = time.monotonic()

        try:
            while self._running or not self._queue.empty():
                try:
                    line = self._queue.get(timeout=1.0)
                    line = line.replace("```", r"\`\`\`")

                    if len(line) > self.max_message_length:
                        line = line[: self.max_message_length - 20] + "... [truncated]"

                    line_len = len(line) + 1
                    if buffer_length + line_len > self.max_message_length and buffer_lines:
                        self._flush(client, buffer_lines)
                        buffer_lines = []
                        buffer_length = 0
                        last_flush = time.monotonic()

                    buffer_lines.append(line)
                    buffer_length += len(line) + 1
                except Empty:
                    pass

                now = time.monotonic()
                if buffer_lines and (
                    buffer_length >= self.max_message_length
                    or (now - last_flush) >= self.flush_interval
                ):
                    self._flush(client, buffer_lines)
                    buffer_lines = []
                    buffer_length = 0
                    last_flush = now

            if buffer_lines:
                self._flush(client, buffer_lines)
        finally:
            client.close()

    def _flush(self, client: httpx.Client, lines: list[str]):
        if not lines:
            return

        if self._circuit_open:
            if time.time() < self._circuit_open_until:
                return
            self._circuit_open = False

        content = "```\n" + "\n".join(lines) + "\n```"

        try:
            response = client.post(
                self.webhook_url,
                json={"content": content},
                headers={"Content-Type": "application/json"},
            )

            if response.status_code == 429:
                retry_after = response.json().get("retry_after", 5)
                time.sleep(retry_after)
                return

            if response.status_code >= 400:
                raise httpx.HTTPStatusError(
                    f"Discord returned {response.status_code}",
                    request=response.request,
                    response=response,
                )

            self._consecutive_failures = 0

        except Exception as e:
            self._consecutive_failures += 1
            print(f"[DISCORD_LOG] Send failed ({self._consecutive_failures}x): {e}", file=sys.stderr)
            if self._consecutive_failures >= self.circuit_breaker_threshold:
                self._circuit_open = True
                self._circuit_open_until = time.time() + self.circuit_breaker_cooldown
                print(
                    f"[DISCORD_LOG] Circuit breaker opened — retrying in {self.circuit_breaker_cooldown}s",
                    file=sys.stderr,
                )
