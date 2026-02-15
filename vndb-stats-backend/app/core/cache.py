"""Redis caching layer."""

import json
import logging
from typing import Any

import redis.asyncio as redis

from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


class CacheService:
    """Async Redis cache service."""

    def __init__(self):
        self._redis: redis.Redis | None = None

    async def _get_redis(self) -> redis.Redis:
        """Get or create Redis connection."""
        if self._redis is None:
            self._redis = redis.from_url(
                settings.redis_url,
                encoding="utf-8",
                decode_responses=True,
            )
        return self._redis

    async def close(self):
        """Close Redis connection."""
        if self._redis:
            await self._redis.close()

    async def get(self, key: str) -> Any | None:
        """Get value from cache."""
        try:
            client = await self._get_redis()
            value = await client.get(key)
            if value:
                return json.loads(value)
            return None
        except Exception as e:
            logger.warning(f"Cache get error for {key}: {e}")
            return None

    async def set(
        self,
        key: str,
        value: Any,
        ttl: int | None = None,
    ) -> bool:
        """Set value in cache with optional TTL."""
        try:
            client = await self._get_redis()
            serialized = json.dumps(value)
            if ttl:
                await client.setex(key, ttl, serialized)
            else:
                await client.set(key, serialized)
            return True
        except Exception as e:
            logger.warning(f"Cache set error for {key}: {e}")
            return False

    async def delete(self, key: str) -> bool:
        """Delete key from cache."""
        try:
            client = await self._get_redis()
            await client.delete(key)
            return True
        except Exception as e:
            logger.warning(f"Cache delete error for {key}: {e}")
            return False

    async def exists(self, key: str) -> bool:
        """Check if key exists in cache."""
        try:
            client = await self._get_redis()
            return await client.exists(key) > 0
        except Exception as e:
            logger.warning(f"Cache exists error for {key}: {e}")
            return False

    async def flush_pattern(self, pattern: str) -> int:
        """Delete all keys matching a pattern. Returns count of deleted keys."""
        try:
            client = await self._get_redis()
            deleted = 0
            async for key in client.scan_iter(match=pattern, count=500):
                await client.delete(key)
                deleted += 1
            return deleted
        except Exception as e:
            logger.warning(f"Cache flush_pattern error for {pattern}: {e}")
            return 0

    # Key patterns for different data types
    @staticmethod
    def user_list_key(uid: str) -> str:
        return f"user:list:{uid}"

    @staticmethod
    def user_stats_key(uid: str) -> str:
        # v2: includes developers/publishers/staff/seiyuu breakdowns
        return f"user:stats:v2:{uid}"

    @staticmethod
    def vn_details_key(vn_id: str) -> str:
        return f"vn:details:{vn_id}"

    @staticmethod
    def recommendations_key(uid: str, method: str) -> str:
        return f"recs:{method}:{uid}"


# Singleton cache instance
_cache: CacheService | None = None


def get_cache() -> CacheService:
    """Get the singleton cache service."""
    global _cache
    if _cache is None:
        _cache = CacheService()
    return _cache
