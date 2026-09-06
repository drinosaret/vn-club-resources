"""Process-level cache for facts about the whole catalogue.

Tag rarity weights, the set of technical tags and the title count change once a day,
with the import, and are the same for every reader. A recommender instance is built per
request, so a cache on the instance is a cache of one request; this holds the value for
the process, refreshed on first use after a day. Every API worker keeps its own copy,
which is a few hundred kilobytes each.
"""

import asyncio
import time
from typing import Awaitable, Callable, Generic, Optional, TypeVar

T = TypeVar("T")

TTL_SECONDS = 24 * 3600


class DailyValue(Generic[T]):
    """One value, rebuilt by `build` when absent or older than a day.

    Concurrent first readers share one build rather than each running it. The lock is
    made on first use rather than at construction, since the instance is created at import
    time and an event loop may not exist yet. A lock is bound to the loop that first waits
    on it, and a process can run more than one loop over its life, so a lock made under
    an earlier loop is replaced whenever the running loop has changed.
    """

    def __init__(self, build: Callable[[], Awaitable[T]]):
        self._build = build
        self._value: Optional[T] = None
        self._built_at: float = 0.0
        self._lock: Optional[asyncio.Lock] = None
        self._lock_loop: Optional[asyncio.AbstractEventLoop] = None

    async def get(self) -> T:
        now = time.monotonic()
        if self._value is not None and now - self._built_at < TTL_SECONDS:
            return self._value

        loop = asyncio.get_running_loop()
        if self._lock is None or self._lock_loop is not loop:
            self._lock = asyncio.Lock()
            self._lock_loop = loop

        async with self._lock:
            now = time.monotonic()
            if self._value is not None and now - self._built_at < TTL_SECONDS:
                return self._value
            value = await self._build()
            self._value = value
            self._built_at = now
            return value
