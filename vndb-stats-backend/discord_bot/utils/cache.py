"""Simple TTL cache for reducing database queries."""

from datetime import datetime, timedelta
from typing import Any, TypeVar, Generic

T = TypeVar("T")


class TTLCache(Generic[T]):
    """Simple in-memory cache with time-to-live expiration.

    Usage:
        cache = TTLCache[list[Rule]](ttl_seconds=300)

        # Get or compute
        rules = cache.get("all_rules")
        if rules is None:
            rules = await fetch_rules_from_db()
            cache.set("all_rules", rules)

        # Invalidate when data changes
        cache.invalidate("all_rules")
    """

    def __init__(self, ttl_seconds: int = 300):
        self.ttl = timedelta(seconds=ttl_seconds)
        self._cache: dict[str, tuple[datetime, T]] = {}

    def get(self, key: str) -> T | None:
        """Get a value from cache, returning None if expired or missing."""
        if key not in self._cache:
            return None

        timestamp, value = self._cache[key]
        if datetime.now() - timestamp > self.ttl:
            del self._cache[key]
            return None

        return value

    def set(self, key: str, value: T) -> None:
        """Store a value in cache."""
        self._cache[key] = (datetime.now(), value)

    def invalidate(self, key: str | None = None) -> None:
        """Invalidate a specific key or all keys if key is None."""
        if key is None:
            self._cache.clear()
        else:
            self._cache.pop(key, None)

    def has(self, key: str) -> bool:
        """Check if a non-expired key exists."""
        return self.get(key) is not None

    async def get_or_fetch(
        self,
        key: str,
        fetch_func,
    ) -> T:
        """Get from cache or fetch using the provided async function."""
        value = self.get(key)
        if value is not None:
            return value

        value = await fetch_func()
        self.set(key, value)
        return value


# Global caches for commonly accessed data
blacklist_rules_cache: TTLCache[list] = TTLCache(ttl_seconds=300)
rss_feeds_cache: TTLCache[list] = TTLCache(ttl_seconds=300)
table_stats_cache: TTLCache[dict] = TTLCache(ttl_seconds=60)
