"""User recommendation cache service.

Pre-caches combined recommendation scores for active users to enable
fast retrieval without running all recommenders on every request.
"""

import logging
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import select, delete, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.dialects.postgresql import insert

from app.db.models import UserRecommendationCache, VisualNovel

logger = logging.getLogger(__name__)

# Cache freshness threshold (24 hours)
CACHE_TTL_HOURS = 24


class UserCacheService:
    """Manages user recommendation cache."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_cached_recommendations(
        self,
        user_id: str,
        exclude_vns: set[str],
        limit: int = 20,
        min_rating: float = 0,
        length_filter: Optional[str] = None,
    ) -> Optional[list[dict]]:
        """
        Retrieve cached recommendations for a user if fresh.

        Returns None if cache is stale or doesn't exist.
        """
        # Check cache freshness
        freshness_threshold = datetime.utcnow() - timedelta(hours=CACHE_TTL_HOURS)

        # Query cached recommendations
        query = (
            select(
                UserRecommendationCache.vn_id,
                UserRecommendationCache.combined_score,
                UserRecommendationCache.tag_score,
                UserRecommendationCache.cf_score,
                UserRecommendationCache.hgat_score,
            )
            .where(UserRecommendationCache.user_id == user_id)
            .where(UserRecommendationCache.updated_at >= freshness_threshold)
            .where(~UserRecommendationCache.vn_id.in_(exclude_vns) if exclude_vns else True)
            .order_by(UserRecommendationCache.combined_score.desc())
            .limit(limit * 2)  # Get extra for filtering
        )

        result = await self.db.execute(query)
        cached = result.all()

        if not cached:
            return None

        logger.info(f"Cache hit for user {user_id}: {len(cached)} cached recommendations")

        # Filter by VN attributes
        vn_ids = [c[0] for c in cached]
        vn_query = select(VisualNovel).where(VisualNovel.id.in_(vn_ids))

        if min_rating > 0:
            vn_query = vn_query.where(VisualNovel.rating >= min_rating)

        if length_filter:
            length_map = {"very_short": 1, "short": 2, "medium": 3, "long": 4, "very_long": 5}
            if length_filter in length_map:
                vn_query = vn_query.where(VisualNovel.length == length_map[length_filter])

        vn_result = await self.db.execute(vn_query)
        valid_vns = {vn.id for vn in vn_result.scalars().all()}

        # Build results
        results = []
        for vn_id, combined, tag, cf, hgat in cached:
            if vn_id not in valid_vns:
                continue

            results.append({
                "vn_id": vn_id,
                "score": combined,
                "tag_score": tag,
                "cf_score": cf,
                "hgat_score": hgat,
                "from_cache": True,
            })

            if len(results) >= limit:
                break

        return results if results else None

    async def store_recommendations(
        self,
        user_id: str,
        recommendations: list[dict],
    ):
        """
        Store computed recommendations in cache.

        Args:
            user_id: VNDB user ID
            recommendations: List of recommendation dicts with scores
        """
        if not recommendations:
            return

        now = datetime.utcnow()
        records = []

        for rec in recommendations[:200]:  # Store top 200
            records.append({
                "user_id": user_id,
                "vn_id": rec["vn_id"],
                "combined_score": rec.get("score", 0),
                "tag_score": rec.get("tag_score"),
                "cf_score": rec.get("cf_score"),
                "hgat_score": rec.get("hgat_score"),
                "updated_at": now,
            })

        # Upsert records
        stmt = insert(UserRecommendationCache).values(records)
        stmt = stmt.on_conflict_do_update(
            index_elements=["user_id", "vn_id"],
            set_={
                "combined_score": stmt.excluded.combined_score,
                "tag_score": stmt.excluded.tag_score,
                "cf_score": stmt.excluded.cf_score,
                "hgat_score": stmt.excluded.hgat_score,
                "updated_at": stmt.excluded.updated_at,
            }
        )
        await self.db.execute(stmt)
        await self.db.commit()

        logger.info(f"Cached {len(records)} recommendations for user {user_id}")

    async def invalidate_user_cache(self, user_id: str):
        """Clear cache for a specific user."""
        await self.db.execute(
            delete(UserRecommendationCache).where(UserRecommendationCache.user_id == user_id)
        )
        await self.db.commit()
        logger.info(f"Invalidated cache for user {user_id}")

    async def is_cache_fresh(self, user_id: str) -> bool:
        """Check if user has fresh cached recommendations."""
        freshness_threshold = datetime.utcnow() - timedelta(hours=CACHE_TTL_HOURS)

        result = await self.db.execute(
            select(func.count(UserRecommendationCache.vn_id))
            .where(UserRecommendationCache.user_id == user_id)
            .where(UserRecommendationCache.updated_at >= freshness_threshold)
        )
        count = result.scalar_one_or_none() or 0

        return count > 0

    async def get_cache_stats(self) -> dict:
        """Get cache statistics."""
        freshness_threshold = datetime.utcnow() - timedelta(hours=CACHE_TTL_HOURS)

        # Total cached users
        total_result = await self.db.execute(
            select(func.count(func.distinct(UserRecommendationCache.user_id)))
        )
        total_users = total_result.scalar_one_or_none() or 0

        # Fresh cached users
        fresh_result = await self.db.execute(
            select(func.count(func.distinct(UserRecommendationCache.user_id)))
            .where(UserRecommendationCache.updated_at >= freshness_threshold)
        )
        fresh_users = fresh_result.scalar_one_or_none() or 0

        # Total cached recommendations
        recs_result = await self.db.execute(
            select(func.count(UserRecommendationCache.vn_id))
        )
        total_recs = recs_result.scalar_one_or_none() or 0

        return {
            "total_cached_users": total_users,
            "fresh_cached_users": fresh_users,
            "total_cached_recommendations": total_recs,
            "cache_ttl_hours": CACHE_TTL_HOURS,
        }
