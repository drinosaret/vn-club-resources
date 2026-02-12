"""Statistics calculation service."""

import asyncio
import logging
import math
from collections import defaultdict
from datetime import datetime, timedelta
from statistics import mean, stdev

import numpy as np
from sqlalchemy import select, func, case, literal_column, text, or_, distinct
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.cache import get_cache
from app.core.vndb_client import get_vndb_client

# Module-level semaphore to limit concurrent heavy stats calculations
# Prevents resource exhaustion when multiple users request large profiles
_stats_semaphore: asyncio.Semaphore | None = None


def _get_stats_semaphore() -> asyncio.Semaphore:
    """Get or create the stats calculation semaphore (lazy initialization)."""
    global _stats_semaphore
    if _stats_semaphore is None:
        settings = get_settings()
        _stats_semaphore = asyncio.Semaphore(settings.max_concurrent_user_stats)
    return _stats_semaphore
from app.db.models import (
    VisualNovel, Tag, VNTag, GlobalVote,
    Producer, Staff, VNStaff, VNSeiyuu,
    Trait, Character, CharacterVN, CharacterTrait,
    Release, ReleaseVN, ReleaseProducer,
    UlistVN, UlistLabel, VndbUser,
)
from app.db.schemas import (
    UserStatsResponse, UserInfo, StatsSummary,
    TagAnalyticsResponse, TagStats, TagPreference,
    UserComparisonResponse, SharedVNScore, CategoryStats, YearWithRating,
    GlobalStatsResponse, TagStatsResponse, TagDetailResponse,
    TraitStatsResponse, TraitDetailResponse,
    ProducerBreakdown, StaffBreakdown, SeiyuuBreakdown, TraitBreakdown,
    ProducerStatsResponse, ProducerDetailResponse, ProducerVNsResponse,
    SimilarProducerResponse, VNSummary, SimilarUserResponse,
    StaffDetailResponse, StaffStatsResponse, StaffVNsResponse,
    SeiyuuStatsResponse, SeiyuuVNsResponse,
    SeiyuuCharactersResponse, SeiyuuVoicedCharacter, SeiyuuCharacterVNInfo,
)

logger = logging.getLogger(__name__)

# Maximum number of items to return in breakdown sections
# Prevents memory issues and slow responses for users with large libraries
MAX_BREAKDOWN_RESULTS = 99999

# Timeout for individual database queries (seconds)
# Prevents runaway queries from blocking the connection pool
DB_QUERY_TIMEOUT = 15.0


def length_to_category(length: int | None) -> str | None:
    """Convert VNDB length value to category name (returns single category).

    DEPRECATED: Use length_to_categories() for accurate counts that match VNDB.
    This function is kept for backwards compatibility.
    """
    categories = length_to_categories(length)
    return categories[0] if categories else None


def length_to_categories(length: int | None, length_minutes: int | None = None) -> list[str]:
    """Convert VNDB length value to category name(s).

    Priority: length_minutes (vote-based average) > length (database field)
    This matches VNDB website behavior where length filtering uses the
    user-submitted playtime vote averages.

    VNDB uses two formats in the database:
    - Old format: 1-5 representing categories directly
    - New format: Minutes (values > 5)

    VNDB categories (strictly less-than boundaries):
    - 1 / Very Short: < 2 hours (< 120 minutes)
    - 2 / Short: 2-10 hours (120 to < 600 minutes)
    - 3 / Medium: 10-30 hours (600 to < 1800 minutes)
    - 4 / Long: 30-50 hours (1800 to < 3000 minutes)
    - 5 / Very Long: >= 50 hours (>= 3000 minutes)

    Args:
        length: Legacy length field (1-5 category or raw minutes)
        length_minutes: User-submitted playtime vote average (preferred when available)

    Returns:
        List of category names (usually 1, but 2 for boundary values)
    """
    # Prefer length_minutes (vote-based average) when available.
    # In the VNDB dumps, this field can be present but non-positive (0/None) for
    # unknown/insufficient data. In that case, fall back to the legacy `length`
    # field so we don't incorrectly drop VNs from length distributions.
    use_vote_minutes = length_minutes is not None and length_minutes > 0
    effective_length = length_minutes if use_vote_minutes else length

    if effective_length is None or effective_length <= 0:
        return []

    # Old category format (1-5) - only used when length_minutes is not available
    # and the length field contains a category value
    if not use_vote_minutes and 1 <= effective_length <= 5:
        category_map = {
            1: "very_short",
            2: "short",
            3: "medium",
            4: "long",
            5: "very_long",
        }
        cat = category_map.get(effective_length)
        return [cat] if cat else []

    # Minutes format (length_minutes OR length > 5)
    # Use exclusive upper bounds so each VN appears in exactly one category
    # (matches browse page filter logic for consistent chart clickthrough)
    if effective_length < 120:
        return ["very_short"]
    if effective_length < 600:
        return ["short"]
    if effective_length < 1800:
        return ["medium"]
    if effective_length < 3000:
        return ["long"]
    return ["very_long"]


class StatsService:
    """Service for calculating user statistics."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.cache = get_cache()
        self.vndb = get_vndb_client()

    async def _execute_with_timeout(self, query, timeout: float = DB_QUERY_TIMEOUT):
        """Execute a database query with timeout protection.

        Prevents runaway queries from blocking the connection pool.
        """
        try:
            async with asyncio.timeout(timeout):
                return await self.db.execute(query)
        except asyncio.TimeoutError:
            logger.error(f"Database query timed out after {timeout}s")
            raise

    async def calculate_user_stats(
        self,
        vndb_uid: str,
        user_data: dict,
    ) -> UserStatsResponse:
        """Calculate comprehensive statistics for a user.

        Uses a semaphore to limit concurrent heavy calculations and prevent
        resource exhaustion when multiple users request large profiles simultaneously.
        """
        # Check cache first (before acquiring semaphore)
        cache_key = self.cache.user_stats_key(vndb_uid)
        cached = await self.cache.get(cache_key)
        if cached:
            return UserStatsResponse(**cached)

        # Acquire semaphore to limit concurrent heavy calculations
        semaphore = _get_stats_semaphore()
        async with semaphore:
            # Double-check cache after acquiring semaphore (another request may have filled it)
            cached = await self.cache.get(cache_key)
            if cached:
                return UserStatsResponse(**cached)

            return await self._calculate_user_stats_impl(vndb_uid, user_data)

    async def _calculate_user_stats_impl(
        self,
        vndb_uid: str,
        user_data: dict,
    ) -> UserStatsResponse:
        """Internal implementation of user stats calculation (called under semaphore)."""
        cache_key = self.cache.user_stats_key(vndb_uid)

        labels = user_data.get("labels", {})
        # Only analyze completed VNs (label 2)
        completed_vn_ids = labels.get("2", [])

        # Debug logging for data verification
        all_votes = user_data.get("votes", [])
        total_list = user_data.get("total", len(user_data.get("vn_ids", [])))
        label_counts = {k: len(v) for k, v in labels.items()}
        logger.info(
            f"[{vndb_uid}] Stats calculation: total_list={total_list}, "
            f"votes={len(all_votes)}, completed_vn_ids={len(completed_vn_ids)}, "
            f"label_counts={label_counts}"
        )

        # Warn if data looks incomplete (has votes but no labels - possible API issue)
        if all_votes and not completed_vn_ids:
            logger.warning(
                f"[{vndb_uid}] DATA INCOMPLETE: User has {len(all_votes)} votes but 0 completed VNs. "
                f"Labels may not have been fetched correctly. Consider force refreshing."
            )

        # Early return for users with 0 completed VNs
        if not completed_vn_ids:
            # Still calculate score stats from all votes (even without completed VNs)
            all_scores = [v["score"] / 10 for v in all_votes]
            avg = round(mean(all_scores), 2) if all_scores else 0
            std = round(stdev(all_scores), 2) if len(all_scores) > 1 else 0

            # Build score distribution from all votes
            score_dist = {str(i): 0 for i in range(1, 11)}
            for s in all_scores:
                bucket = str(max(1, min(10, int(round(s)))))
                score_dist[bucket] = score_dist.get(bucket, 0) + 1

            return UserStatsResponse(
                user=UserInfo(uid=vndb_uid, username=user_data.get("username", vndb_uid)),
                summary=StatsSummary(
                    total_vns=0,
                    completed=0,
                    playing=len(labels.get("1", [])),
                    dropped=len(labels.get("4", [])),
                    wishlist=len(labels.get("5", [])),
                    total_votes=len(all_votes),
                    average_score=avg,
                    score_stddev=std,
                    estimated_hours=0,
                ),
                score_distribution=score_dist,
                release_year_distribution={},
                monthly_activity=[],
                length_distribution={"very_short": 0, "short": 0, "medium": 0, "long": 0, "very_long": 0},
                platform_breakdown={},
                last_updated=datetime.now(),
            )

        completed_vn_set = set(completed_vn_ids)
        vn_ids = completed_vn_ids  # Use only completed VNs for all analysis
        all_votes_list = user_data.get("votes", [])

        # Filter votes to only include completed VNs
        votes_list = [v for v in all_votes_list if v["vn_id"] in completed_vn_set]

        # Create votes dict for easy lookup (only completed VNs)
        votes_dict = {v["vn_id"]: v["score"] / 10 for v in votes_list}

        # Get VN metadata from database
        vn_metadata = await self._get_vn_metadata(vn_ids)

        # Check for VNs not found in database (new/obscure VNs not in daily dump)
        missing_vn_ids = [vid for vid in vn_ids if vid not in vn_metadata]
        if missing_vn_ids:
            logger.warning(
                f"[{vndb_uid}] {len(missing_vn_ids)} VNs not found in database "
                f"(requested {len(vn_ids)}, found {len(vn_metadata)}). "
                f"Missing IDs: {missing_vn_ids[:10]}{'...' if len(missing_vn_ids) > 10 else ''}"
            )

        # Get global average for comparison
        global_avg = await self._get_global_average_score()

        # Calculate summary stats
        summary = self._calculate_summary(user_data, vn_metadata, global_avg, votes_list, all_votes_list)

        # Calculate distributions
        score_dist = self._calculate_score_distribution(votes_list)
        release_dist = self._calculate_release_distribution(vn_ids, vn_metadata)
        activity = self._calculate_monthly_activity(user_data, vn_metadata)
        length_dist = self._calculate_length_distribution(vn_ids, vn_metadata)
        platform_dist = self._calculate_platform_distribution(vn_ids, vn_metadata)

        # Calculate extended distributions with ratings (new vnstat.net-style)
        length_dist_detailed = self._calculate_length_distribution_detailed(
            vn_ids, vn_metadata, votes_dict
        )
        age_dist = self._calculate_age_rating_distribution(vn_ids, vn_metadata, votes_dict)
        release_with_ratings = self._calculate_release_year_with_ratings(
            vn_ids, vn_metadata, votes_dict
        )

        # Calculate detailed breakdowns for tabs (parallel for performance)
        (
            developers_breakdown,
            publishers_breakdown,
            staff_breakdown,
            seiyuu_breakdown,
            traits_breakdown,
        ) = await asyncio.gather(
            self._calculate_developers_breakdown(vn_ids, vn_metadata, votes_dict),
            self._calculate_publishers_breakdown(vn_ids, votes_dict),
            self._calculate_staff_breakdown(vn_ids, votes_dict),
            self._calculate_seiyuu_breakdown(vn_ids, votes_dict),
            self._calculate_traits_breakdown(vn_ids, votes_dict),
        )

        response = UserStatsResponse(
            user=UserInfo(uid=vndb_uid, username=user_data.get("username", vndb_uid)),
            summary=summary,
            score_distribution=score_dist,
            release_year_distribution=release_dist,
            monthly_activity=activity,
            length_distribution=length_dist,
            platform_breakdown=platform_dist,
            # New extended stats
            length_distribution_detailed=length_dist_detailed,
            age_rating_distribution=age_dist,
            release_year_with_ratings=release_with_ratings,
            # Detailed breakdowns for tabs
            developers_breakdown=developers_breakdown,
            publishers_breakdown=publishers_breakdown,
            staff_breakdown=staff_breakdown,
            seiyuu_breakdown=seiyuu_breakdown,
            traits_breakdown=traits_breakdown,
            last_updated=datetime.now(),
        )

        # Cache result - 30 min for user stats (expensive to compute)
        await self.cache.set(cache_key, response.model_dump(mode='json'), ttl=1800)

        return response

    async def _get_vn_metadata(self, vn_ids: list[str]) -> dict[str, dict]:
        """Get VN metadata from database."""
        if not vn_ids:
            return {}

        result = await self._execute_with_timeout(
            select(VisualNovel).where(VisualNovel.id.in_(vn_ids))
        )
        vns = result.scalars().all()

        metadata = {
            vn.id: {
                "title": vn.title,
                "released": vn.released,
                "length": vn.length,
                "length_minutes": vn.length_minutes,  # Vote-based average (preferred)
                "platforms": vn.platforms or [],
                "rating": vn.rating,
                "minage": vn.minage,
                "developers": vn.developers or [],
            }
            for vn in vns
        }

        # Fetch max release minage per VN to use the strictest age requirement
        release_minage_rows = await self.db.execute(
            select(ReleaseVN.vn_id, func.max(Release.minage))
            .join(Release, ReleaseVN.release_id == Release.id)
            .where(ReleaseVN.vn_id.in_(vn_ids))
            .group_by(ReleaseVN.vn_id)
        )
        for vn_id, max_minage in release_minage_rows.all():
            if max_minage is not None:
                if vn_id not in metadata:
                    metadata[vn_id] = {}
                metadata[vn_id]["max_minage"] = max_minage

        # Debug logging
        found_count = len(metadata)
        with_released = sum(1 for m in metadata.values() if m.get("released"))
        with_minage = sum(1 for m in metadata.values() if m.get("minage") is not None)
        with_max_minage = sum(1 for m in metadata.values() if m.get("max_minage") is not None)
        with_length = sum(1 for m in metadata.values() if m.get("length"))
        logger.info(
            f"VN metadata: requested={len(vn_ids)}, found={found_count}, "
            f"with_released={with_released}, with_minage={with_minage}, "
            f"with_max_minage={with_max_minage}, with_length={with_length}"
        )
        if vn_ids and not metadata:
            logger.warning(f"No VNs found! Sample IDs requested: {vn_ids[:5]}")

        # Warn if no minage data at all (indicates Release/ReleaseVN tables may not be populated)
        if found_count > 0 and with_minage == 0 and with_max_minage == 0:
            logger.warning(
                f"No minage data for any of {found_count} VNs! "
                "This usually means Release/ReleaseVN tables aren't populated. "
                "Run the full database import including releases to fix this."
            )

        return metadata

    async def _get_global_average_score(self) -> float:
        """Calculate global average score from all votes."""
        cache_key = "global_average_score"
        cached = await self.cache.get(cache_key)
        if cached is not None:
            return cached

        result = await self.db.execute(
            select(func.avg(GlobalVote.vote / 10.0))
        )
        global_avg = result.scalar_one_or_none() or 7.0  # Default to 7.0 if no data

        await self.cache.set(cache_key, float(global_avg), ttl=3600)  # Cache for 1 hour
        return float(global_avg)

    async def _get_per_tag_global_averages(self) -> dict[int, float]:
        """Get average VNDB rating for all VNs per tag.

        Returns a dict mapping tag_id -> average rating (1-10 scale).
        Cached for 24 hours since this is computed from dump data.
        """
        cache_key = "per_tag_global_averages"
        cached = await self.cache.get(cache_key)
        if cached is not None:
            return {int(k): v for k, v in cached.items()}

        # Query: JOIN tags → vn_tags → visual_novels, GROUP BY tag, AVG(rating)
        # Filter: spoiler_level = 0, rating IS NOT NULL
        result = await self.db.execute(
            select(
                Tag.id,
                func.avg(VisualNovel.rating).label('avg_rating'),
            )
            .join(VNTag, Tag.id == VNTag.tag_id)
            .join(VisualNovel, VNTag.vn_id == VisualNovel.id)
            .where(VNTag.spoiler_level == 0)
            .where(VisualNovel.rating.isnot(None))
            .group_by(Tag.id)
        )

        tag_averages = {row.id: float(row.avg_rating) for row in result.all()}

        # Cache for 24 hours (86400 seconds)
        await self.cache.set(cache_key, tag_averages, ttl=86400)
        logger.info(f"Computed per-tag global averages for {len(tag_averages)} tags")

        return tag_averages

    async def _get_per_trait_global_averages(self, trait_ids: list[int]) -> dict[int, float]:
        """Get global average VN rating for each trait.

        For each trait, calculates the average rating of all VNs that have
        characters with that trait.

        Args:
            trait_ids: List of trait IDs to get averages for

        Returns:
            Dict mapping trait_id -> average VN rating (1-10 scale)
        """
        if not trait_ids:
            return {}

        # Query: Trait -> CharacterTrait -> CharacterVN -> VisualNovel (with rating)
        result = await self.db.execute(
            select(
                CharacterTrait.trait_id,
                func.avg(VisualNovel.rating).label('avg_rating'),
            )
            .join(CharacterVN, CharacterTrait.character_id == CharacterVN.character_id)
            .join(VisualNovel, CharacterVN.vn_id == VisualNovel.id)
            .where(CharacterTrait.trait_id.in_(trait_ids))
            .where(CharacterTrait.spoiler_level == 0)
            .where(VisualNovel.rating.isnot(None))
            .group_by(CharacterTrait.trait_id)
        )

        return {row.trait_id: float(row.avg_rating) for row in result.all()}

    async def _get_per_producer_global_averages(self, producer_ids: list[str], is_developer: bool = True) -> dict[str, float]:
        """Get global average VN rating for each producer.

        Args:
            producer_ids: List of producer IDs to get averages for
            is_developer: If True, filter by developer role; if False, filter by publisher role

        Returns:
            Dict mapping producer_id -> average VN rating (1-10 scale)
        """
        if not producer_ids:
            return {}

        role_filter = ReleaseProducer.developer if is_developer else ReleaseProducer.publisher

        # Query: Producer -> ReleaseProducer -> ReleaseVN -> VisualNovel (with rating)
        result = await self.db.execute(
            select(
                ReleaseProducer.producer_id,
                func.avg(VisualNovel.rating).label('avg_rating'),
            )
            .join(ReleaseVN, ReleaseProducer.release_id == ReleaseVN.release_id)
            .join(VisualNovel, ReleaseVN.vn_id == VisualNovel.id)
            .where(ReleaseProducer.producer_id.in_(producer_ids))
            .where(role_filter == True)
            .where(VisualNovel.rating.isnot(None))
            .group_by(ReleaseProducer.producer_id)
        )

        return {row.producer_id: float(row.avg_rating) for row in result.all()}

    async def _get_per_staff_global_averages(self, staff_role_pairs: list[tuple[str, str]]) -> dict[tuple[str, str], float]:
        """Get global average VN rating for each staff member + role combination.

        Args:
            staff_role_pairs: List of (staff_id, role) tuples to get averages for

        Returns:
            Dict mapping (staff_id, role) -> average VN rating (1-10 scale)
        """
        if not staff_role_pairs:
            return {}

        staff_ids = list(set(sid for sid, _ in staff_role_pairs))

        # Query: Staff -> VNStaff -> VisualNovel (with rating)
        result = await self.db.execute(
            select(
                VNStaff.staff_id,
                VNStaff.role,
                func.avg(VisualNovel.rating).label('avg_rating'),
            )
            .join(VisualNovel, VNStaff.vn_id == VisualNovel.id)
            .where(VNStaff.staff_id.in_(staff_ids))
            .where(VisualNovel.rating.isnot(None))
            .group_by(VNStaff.staff_id, VNStaff.role)
        )

        return {(row.staff_id, row.role): float(row.avg_rating) for row in result.all()}

    async def _get_per_seiyuu_global_averages(self, staff_ids: list[str]) -> dict[str, float]:
        """Get global average VN rating for each voice actor.

        Args:
            staff_ids: List of staff IDs (seiyuu) to get averages for

        Returns:
            Dict mapping staff_id -> average VN rating (1-10 scale)
        """
        if not staff_ids:
            return {}

        # Query: Staff -> VNSeiyuu -> VisualNovel (with rating)
        result = await self.db.execute(
            select(
                VNSeiyuu.staff_id,
                func.avg(VisualNovel.rating).label('avg_rating'),
            )
            .join(VisualNovel, VNSeiyuu.vn_id == VisualNovel.id)
            .where(VNSeiyuu.staff_id.in_(staff_ids))
            .where(VisualNovel.rating.isnot(None))
            .group_by(VNSeiyuu.staff_id)
        )

        return {row.staff_id: float(row.avg_rating) for row in result.all()}

    async def _get_per_staff_global_averages_combined(self, staff_ids: list[str]) -> dict[str, float]:
        """Get global average VN rating for each staff member (all roles combined).

        Unlike _get_per_staff_global_averages which groups by (staff_id, role),
        this method returns a single average per staff member across all their work.

        Args:
            staff_ids: List of staff IDs to get averages for

        Returns:
            Dict mapping staff_id -> average VN rating (1-10 scale)
        """
        if not staff_ids:
            return {}

        # Query: Staff -> VNStaff -> VisualNovel (with rating), grouped by staff only
        result = await self.db.execute(
            select(
                VNStaff.staff_id,
                func.avg(VisualNovel.rating).label('avg_rating'),
            )
            .join(VisualNovel, VNStaff.vn_id == VisualNovel.id)
            .where(VNStaff.staff_id.in_(staff_ids))
            .where(VisualNovel.rating.isnot(None))
            .group_by(VNStaff.staff_id)
        )

        return {row.staff_id: float(row.avg_rating) for row in result.all()}

    def _calculate_bayesian_score(
        self,
        user_avg: float,
        count: int,
        global_avg: float,
        prior_weight: int = 3,
    ) -> float:
        """Calculate Bayesian (damped mean) score for tag ranking.

        Formula: (count × user_avg + prior_weight × global_avg) / (count + prior_weight)

        This pulls tags with few VNs toward the global average, while tags with
        many VNs approach the user's raw average. A lower prior_weight gives more
        influence to the user's own ratings.

        Args:
            user_avg: User's average rating for VNs with this tag
            count: Number of user's completed VNs with this tag
            global_avg: VNDB's global average rating for VNs with this tag
            prior_weight: Smoothing factor (default 3, lower = more user influence)

        Returns:
            Bayesian score (1-10 scale)
        """
        return (count * user_avg + prior_weight * global_avg) / (count + prior_weight)

    def _calculate_weighted_score(
        self,
        bayesian_score: float,
        count: int,
        min_confidence_count: int = 5,
    ) -> float:
        """Calculate confidence-weighted score for tag ranking.

        Formula: bayesian_score * min(1, count / min_confidence_count)

        This penalizes tags with few instances (unreliable data) while leaving
        tags with sufficient instances at their Bayesian score.

        Args:
            bayesian_score: The Bayesian damped mean score
            count: Number of user's completed VNs with this tag
            min_confidence_count: Count at which confidence reaches 100%

        Returns:
            Weighted score (higher = better ranking)
        """
        confidence = min(1.0, count / min_confidence_count)
        return bayesian_score * confidence

    def _calculate_summary(
        self,
        user_data: dict,
        vn_metadata: dict,
        global_average: float = 7.0,
        filtered_votes: list[dict] | None = None,
        all_votes: list[dict] | None = None,
    ) -> StatsSummary:
        """Calculate summary statistics.

        Args:
            user_data: Full user data from VNDB API
            vn_metadata: Metadata dict for VNs (keyed by vn_id)
            global_average: Global average score for comparison
            filtered_votes: Pre-filtered votes list (completed VNs only). If None, uses all votes.
            all_votes: Unfiltered votes list for total_votes count. If None, uses user_data votes.
        """
        # Use filtered votes for score calculations (completed VNs only)
        votes = filtered_votes if filtered_votes is not None else user_data.get("votes", [])
        # Use all votes for the total count (matches VNDB's displayed vote count)
        total_votes_list = all_votes if all_votes is not None else user_data.get("votes", [])
        labels = user_data.get("labels", {})

        # Count by label (common VNDB labels)
        # 1=Playing, 2=Finished, 3=Stalled, 4=Dropped, 5=Wishlist
        playing = len(labels.get("1", []))
        completed = len(labels.get("2", []))
        dropped = len(labels.get("4", []))
        wishlist = len(labels.get("5", []))

        # Calculate score stats
        scores = [v["score"] / 10 for v in votes]  # Convert to 1-10 scale
        avg_score = mean(scores) if scores else 0
        score_std = stdev(scores) if len(scores) > 1 else 0
        score_min = min(scores) if scores else None
        score_max = max(scores) if scores else None

        # Estimate total hours (rough estimate based on VN length)
        # Uses length_to_categories() to handle both old 1-5 format and minute-based format
        # Category midpoint estimates:
        # Midpoint estimates per VNDB length category:
        # - very_short (<2h): ~1h
        # - short (2-10h): ~6h (midpoint)
        # - medium (10-30h): ~20h (midpoint)
        # - long (30-50h): ~40h (midpoint)
        # - very_long (>50h): ~60h
        category_hours = {"very_short": 1, "short": 6, "medium": 20, "long": 40, "very_long": 60}
        finished_vns = labels.get("2", [])

        # Only count VNs that have length data
        vns_with_length = 0
        total_hours = 0
        for vid in finished_vns:
            meta = vn_metadata.get(vid, {})
            length = meta.get("length")
            length_minutes = meta.get("length_minutes")
            # Use length_to_categories() which prefers length_minutes when available
            categories = length_to_categories(length, length_minutes)
            if categories:
                # Use first category for hour estimate (avoid double-counting boundary values)
                total_hours += category_hours.get(categories[0], 0)
                vns_with_length += 1

        # Calculate average hours per VN (only for VNs with length data)
        avg_hours = total_hours / vns_with_length if vns_with_length > 0 else None

        # Calculate difference from global average
        user_vs_global = round(avg_score - global_average, 2) if scores else None

        return StatsSummary(
            total_vns=completed,  # Only count completed VNs for analysis
            completed=completed,
            playing=playing,
            dropped=dropped,
            wishlist=wishlist,
            total_votes=len(total_votes_list),
            average_score=round(avg_score, 2),
            score_stddev=round(score_std, 2),
            estimated_hours=total_hours,
            global_average=round(global_average, 2),
            user_vs_global_diff=user_vs_global,
            score_min=round(score_min, 1) if score_min else None,
            score_max=round(score_max, 1) if score_max else None,
            average_hours_per_vn=round(avg_hours, 1) if avg_hours else None,
            vns_with_length_data=vns_with_length,
        )

    def _calculate_score_distribution(self, votes: list[dict]) -> dict[str, int]:
        """Calculate distribution of scores 1-10."""
        dist = {str(i): 0 for i in range(1, 11)}

        for vote in votes:
            score = vote["score"] // 10  # Convert 10-100 to 1-10
            if 1 <= score <= 10:
                dist[str(score)] += 1

        return dist

    def _calculate_release_distribution(
        self,
        vn_ids: list[str],
        vn_metadata: dict,
    ) -> dict[str, int]:
        """Calculate distribution by release year."""
        dist: dict[str, int] = defaultdict(int)

        for vn_id in vn_ids:
            meta = vn_metadata.get(vn_id, {})
            released = meta.get("released")
            if released:
                year = str(released.year)
                dist[year] += 1

        # Sort by year
        return dict(sorted(dist.items()))

    def _calculate_monthly_activity(self, user_data: dict, vn_metadata: dict) -> list[dict]:
        """Calculate monthly reading activity from user list data.

        Returns data for trends charts:
        - completed: VNs finished this month
        - added: VNs added to list this month
        - hours: Estimated hours for VNs finished
        - avg_score: Average user score for VNs finished
        """
        from datetime import datetime as dt
        from app.services.length_utils import length_to_categories

        month_data: dict[str, dict] = {}
        items = user_data.get("items", [])

        # Hour estimates by length category (same as _calculate_summary)
        category_hours = {"very_short": 1, "short": 6, "medium": 20, "long": 40, "very_long": 60}

        for item in items:
            vn_id = item.get("vn_id")
            vote = item.get("vote")  # 10-100 scale or None

            # Check if completed (label 2)
            item_labels = item.get("labels", [])
            is_completed = any(
                l.get("id") == 2 or l.get("id") == "2"
                for l in item_labels
            )

            # Get VN metadata for hour estimation
            meta = vn_metadata.get(vn_id, {}) if vn_id else {}
            vn_length = meta.get("length")
            categories = length_to_categories(vn_length)
            hours = category_hours.get(categories[0], 0) if categories else 0

            # Track by finished date (for completed VNs)
            # Use voted timestamp as fallback if finished date is not set
            finished = item.get("finished")  # ISO date string "YYYY-MM-DD"
            voted = item.get("voted")  # Unix timestamp (when user voted)

            if is_completed:
                month_key = None
                try:
                    if finished:
                        # Prefer explicit finished date
                        month_key = finished[:7]  # "YYYY-MM"
                    elif voted:
                        # Fall back to vote date
                        voted_dt = dt.utcfromtimestamp(voted)
                        month_key = voted_dt.strftime("%Y-%m")

                    if month_key:
                        if month_key not in month_data:
                            month_data[month_key] = {
                                "completed": 0,
                                "added": 0,
                                "hours": 0,
                                "scores": [],
                            }
                        month_data[month_key]["completed"] += 1
                        month_data[month_key]["hours"] += hours
                        if vote:
                            month_data[month_key]["scores"].append(vote / 10)
                except (ValueError, TypeError, OSError):
                    pass

            # Track by added date (Unix timestamp)
            added = item.get("added")  # Unix timestamp
            if added:
                try:
                    added_dt = dt.utcfromtimestamp(added)
                    month_key = added_dt.strftime("%Y-%m")
                    if month_key not in month_data:
                        month_data[month_key] = {
                            "completed": 0,
                            "added": 0,
                            "hours": 0,
                            "scores": [],
                        }
                    month_data[month_key]["added"] += 1
                except (ValueError, TypeError, OSError):
                    pass

        # Convert to list sorted by month
        result = []
        for month_key in sorted(month_data.keys()):
            data = month_data[month_key]
            scores = data["scores"]
            avg_score = sum(scores) / len(scores) if scores else None
            result.append({
                "month": month_key,
                "completed": data["completed"],
                "added": data["added"],
                "hours": data["hours"],
                "avg_score": round(avg_score, 2) if avg_score else None,
            })

        return result

    def _calculate_length_distribution(
        self,
        vn_ids: list[str],
        vn_metadata: dict,
    ) -> dict[str, int]:
        """Calculate distribution by VN length.

        Uses length_to_categories() to handle both old 1-5 format
        and modern minute-based format from VNDB.
        Prefers length_minutes (vote-based average) when available.
        """
        dist = {"very_short": 0, "short": 0, "medium": 0, "long": 0, "very_long": 0}

        for vn_id in vn_ids:
            meta = vn_metadata.get(vn_id, {})
            length = meta.get("length")
            length_minutes = meta.get("length_minutes")
            # Use length_to_categories() which prefers length_minutes when available
            for category in length_to_categories(length, length_minutes):
                dist[category] += 1

        return dist

    def _calculate_platform_distribution(
        self,
        vn_ids: list[str],
        vn_metadata: dict,
    ) -> dict[str, int]:
        """Calculate distribution by platform."""
        dist: dict[str, int] = defaultdict(int)

        for vn_id in vn_ids:
            meta = vn_metadata.get(vn_id, {})
            platforms = meta.get("platforms", [])
            for platform in platforms:
                dist[platform] += 1

        # Return top 10 platforms
        sorted_platforms = sorted(dist.items(), key=lambda x: x[1], reverse=True)
        return dict(sorted_platforms[:10])

    def _calculate_length_distribution_detailed(
        self,
        vn_ids: list[str],
        vn_metadata: dict,
        votes: dict[str, float],
    ) -> dict[str, CategoryStats]:
        """Calculate length distribution with average user ratings per category.

        Uses length_to_categories() to handle both old 1-5 format
        and modern minute-based format from VNDB.
        Prefers length_minutes (vote-based average) when available.
        """
        # Collect data per category
        category_data: dict[str, dict] = {
            name: {"count": 0, "scores": []}
            for name in ["very_short", "short", "medium", "long", "very_long"]
        }

        for vn_id in vn_ids:
            meta = vn_metadata.get(vn_id, {})
            length = meta.get("length")
            length_minutes = meta.get("length_minutes")
            # Use length_to_categories() which prefers length_minutes when available
            for category in length_to_categories(length, length_minutes):
                category_data[category]["count"] += 1
                if vn_id in votes:
                    category_data[category]["scores"].append(votes[vn_id])

        # Convert to CategoryStats
        result = {}
        for name, data in category_data.items():
            avg_rating = mean(data["scores"]) if data["scores"] else 0
            result[name] = CategoryStats(
                count=data["count"],
                avg_rating=round(avg_rating, 2),
            )

        return result

    def _calculate_age_rating_distribution(
        self,
        vn_ids: list[str],
        vn_metadata: dict,
        votes: dict[str, float],
    ) -> dict[str, CategoryStats]:
        """Calculate age rating distribution with average user ratings per category."""
        # Map age values to categories (use strictest available: max release minage if present).
        # 0, 6, 12 -> all_ages; 15, 16, 17 -> teen; 18 -> adult
        def get_category(minage: int | None) -> str:
            if minage is None:
                return "unknown"
            if minage <= 12:
                return "all_ages"
            if minage <= 17:
                return "teen"
            return "adult"

        # Include "unknown" category to prevent silent data loss
        category_data: dict[str, dict] = {
            "all_ages": {"count": 0, "scores": []},
            "teen": {"count": 0, "scores": []},
            "adult": {"count": 0, "scores": []},
            "unknown": {"count": 0, "scores": []},
        }

        for vn_id in vn_ids:
            meta = vn_metadata.get(vn_id, {})
            # Use the highest age requirement across releases when available to avoid overlaps.
            minage = meta.get("max_minage", meta.get("minage"))
            category = get_category(minage)

            category_data[category]["count"] += 1
            if vn_id in votes:
                category_data[category]["scores"].append(votes[vn_id])

        # Log if many VNs lack age rating data
        unknown_count = category_data["unknown"]["count"]
        known_count = sum(d["count"] for k, d in category_data.items() if k != "unknown")
        if unknown_count > 0:
            logger.info(
                f"Age rating distribution: {known_count} with rating, {unknown_count} unknown "
                f"({unknown_count * 100 // max(unknown_count + known_count, 1)}% missing)"
            )

        # Convert to CategoryStats - only include known categories in result
        # (frontend expects all_ages, teen, adult but not unknown)
        result = {}
        for name, data in category_data.items():
            if name == "unknown":
                continue  # Don't include unknown in response, but we logged it
            avg_rating = mean(data["scores"]) if data["scores"] else 0
            result[name] = CategoryStats(
                count=data["count"],
                avg_rating=round(avg_rating, 2),
            )

        return result

    def _calculate_release_year_with_ratings(
        self,
        vn_ids: list[str],
        vn_metadata: dict,
        votes: dict[str, float],
    ) -> list[YearWithRating]:
        """Calculate release year distribution with average user ratings per year."""
        year_data: dict[int, dict] = defaultdict(lambda: {"count": 0, "scores": []})

        for vn_id in vn_ids:
            meta = vn_metadata.get(vn_id, {})
            released = meta.get("released")
            if released:
                year = released.year
                year_data[year]["count"] += 1
                if vn_id in votes:
                    year_data[year]["scores"].append(votes[vn_id])

        # Convert to list of YearWithRating, sorted by year
        result = []
        for year in sorted(year_data.keys()):
            data = year_data[year]
            avg_rating = mean(data["scores"]) if data["scores"] else 0
            result.append(YearWithRating(
                year=year,
                count=data["count"],
                avg_rating=round(avg_rating, 2),
            ))

        return result

    async def _calculate_developers_breakdown(
        self,
        vn_ids: list[str],
        vn_metadata: dict,
        votes_dict: dict[str, float],
    ) -> list[ProducerBreakdown]:
        """Calculate developer breakdown with Bayesian scoring.

        Developers are producers marked with developer=True in release_producers table.
        Uses user's personal ratings with Bayesian damping for fair ranking.
        """
        if not vn_ids:
            return []

        # Query: VN -> ReleaseVN -> ReleaseProducer (developer=True) -> Producer
        result = await self.db.execute(
            select(
                ReleaseVN.vn_id,
                ReleaseProducer.producer_id,
                Producer.name,
                Producer.original,
                Producer.type,
            )
            .join(ReleaseProducer, ReleaseVN.release_id == ReleaseProducer.release_id)
            .join(Producer, ReleaseProducer.producer_id == Producer.id)
            .where(ReleaseVN.vn_id.in_(vn_ids))
            .where(ReleaseProducer.developer == True)
        )
        rows = result.all()

        if not rows:
            return []

        # Aggregate by developer
        developer_data: dict[str, dict] = defaultdict(
            lambda: {"name": "", "original": None, "type": None, "vn_ids": set()}
        )

        for vn_id, producer_id, name, original, prod_type in rows:
            developer_data[producer_id]["name"] = name
            developer_data[producer_id]["original"] = original
            developer_data[producer_id]["type"] = prod_type
            developer_data[producer_id]["vn_ids"].add(vn_id)

        # Calculate user's overall average for Empirical Bayes
        all_user_ratings = list(votes_dict.values())
        user_overall_avg = mean(all_user_ratings) if all_user_ratings else 7.0

        # Get per-producer global averages for taste analysis
        producer_ids = list(developer_data.keys())
        per_producer_globals = await self._get_per_producer_global_averages(producer_ids, is_developer=True)
        overall_global_avg = await self._get_global_average_score()

        # Build breakdown with Bayesian scoring (using user's own average as prior)
        breakdown = []
        for producer_id, data in developer_data.items():
            vn_list = data["vn_ids"]
            count = len(vn_list)
            ratings = [votes_dict[vn_id] for vn_id in vn_list if vn_id in votes_dict]
            avg_rating = mean(ratings) if ratings else 0.0

            # Get global average for this producer (for taste analysis comparison)
            producer_global_avg = per_producer_globals.get(producer_id, overall_global_avg)

            # Calculate Bayesian weighted score using user's overall average as prior
            weighted_score = None
            if ratings:
                bayesian = self._calculate_bayesian_score(
                    user_avg=avg_rating,
                    count=count,
                    global_avg=user_overall_avg,
                )
                weighted_score = self._calculate_weighted_score(
                    bayesian_score=bayesian,
                    count=count,
                )

            breakdown.append(ProducerBreakdown(
                id=producer_id,
                name=data["name"],
                original=data["original"],
                type=data["type"],
                count=count,
                avg_rating=round(avg_rating, 2),
                global_avg_rating=round(producer_global_avg, 2),  # True VNDB global avg for taste analysis
                weighted_score=round(weighted_score, 2) if weighted_score else None,
            ))

        # Sort by weighted_score descending, with count as tiebreaker
        breakdown.sort(key=lambda x: (x.weighted_score or 0, x.count), reverse=True)
        return breakdown[:MAX_BREAKDOWN_RESULTS]

    async def _calculate_publishers_breakdown(
        self,
        vn_ids: list[str],
        votes_dict: dict[str, float],
    ) -> list[ProducerBreakdown]:
        """Calculate publisher breakdown with Bayesian scoring.

        Publishers are producers marked with publisher=True in release_producers table.
        Uses user's personal ratings with Bayesian damping for fair ranking.
        """
        if not vn_ids:
            return []

        # Query: VN -> ReleaseVN -> ReleaseProducer (publisher=True) -> Producer
        result = await self.db.execute(
            select(
                ReleaseVN.vn_id,
                ReleaseProducer.producer_id,
                Producer.name,
                Producer.original,
                Producer.type,
            )
            .join(ReleaseProducer, ReleaseVN.release_id == ReleaseProducer.release_id)
            .join(Producer, ReleaseProducer.producer_id == Producer.id)
            .where(ReleaseVN.vn_id.in_(vn_ids))
            .where(ReleaseProducer.publisher == True)
        )
        rows = result.all()

        if not rows:
            return []

        # Aggregate by publisher
        publisher_data: dict[str, dict] = defaultdict(
            lambda: {"name": "", "original": None, "type": None, "vn_ids": set()}
        )

        for vn_id, producer_id, name, original, prod_type in rows:
            publisher_data[producer_id]["name"] = name
            publisher_data[producer_id]["original"] = original
            publisher_data[producer_id]["type"] = prod_type
            publisher_data[producer_id]["vn_ids"].add(vn_id)

        # Calculate user's overall average for Empirical Bayes
        all_user_ratings = list(votes_dict.values())
        user_overall_avg = mean(all_user_ratings) if all_user_ratings else 7.0

        # Get per-publisher global averages for taste analysis
        producer_ids = list(publisher_data.keys())
        per_publisher_globals = await self._get_per_producer_global_averages(producer_ids, is_developer=False)
        overall_global_avg = await self._get_global_average_score()

        # Build breakdown with Bayesian scoring (using user's own average as prior)
        breakdown = []
        for producer_id, data in publisher_data.items():
            vn_list = data["vn_ids"]
            count = len(vn_list)
            ratings = [votes_dict[vn_id] for vn_id in vn_list if vn_id in votes_dict]
            avg_rating = mean(ratings) if ratings else 0.0

            # Get global average for this publisher (for taste analysis comparison)
            publisher_global_avg = per_publisher_globals.get(producer_id, overall_global_avg)

            # Calculate Bayesian weighted score using user's overall average as prior
            weighted_score = None
            if ratings:
                bayesian = self._calculate_bayesian_score(
                    user_avg=avg_rating,
                    count=count,
                    global_avg=user_overall_avg,
                )
                weighted_score = self._calculate_weighted_score(
                    bayesian_score=bayesian,
                    count=count,
                )

            breakdown.append(ProducerBreakdown(
                id=producer_id,
                name=data["name"],
                original=data["original"],
                type=data["type"],
                count=count,
                avg_rating=round(avg_rating, 2),
                global_avg_rating=round(publisher_global_avg, 2),  # True VNDB global avg for taste analysis
                weighted_score=round(weighted_score, 2) if weighted_score else None,
            ))

        # Sort by weighted_score descending, with count as tiebreaker
        breakdown.sort(key=lambda x: (x.weighted_score or 0, x.count), reverse=True)
        return breakdown[:MAX_BREAKDOWN_RESULTS]

    async def _calculate_staff_breakdown(
        self,
        vn_ids: list[str],
        votes_dict: dict[str, float],
    ) -> list[StaffBreakdown]:
        """Calculate staff breakdown with Bayesian scoring.

        Groups by staff_id only (combines all roles) to match recommendations page.
        Uses user's personal ratings with Bayesian damping for fair ranking.
        """
        if not vn_ids:
            return []

        # Get all staff for user's VNs (use outerjoin to match hybrid_recommender behavior)
        result = await self.db.execute(
            select(VNStaff.vn_id, VNStaff.staff_id, VNStaff.role, Staff.name, Staff.original)
            .outerjoin(Staff, VNStaff.staff_id == Staff.id)
            .where(VNStaff.vn_id.in_(vn_ids))
        )
        rows = result.all()

        # Aggregate by staff_id only (combine all roles for consistency with recommendations)
        # Include ALL staff in calculation (even without names) to match hybrid_recommender max calculation
        staff_data: dict[str, dict] = defaultdict(
            lambda: {"name": None, "original": None, "vn_ids": set(), "roles": set()}
        )

        for vn_id, staff_id, role, name, original in rows:
            if name:  # Only update name if we have one
                staff_data[staff_id]["name"] = name
            if original:
                staff_data[staff_id]["original"] = original
            staff_data[staff_id]["vn_ids"].add(vn_id)
            staff_data[staff_id]["roles"].add(role)

        # Calculate user's overall average for Empirical Bayes
        all_user_ratings = list(votes_dict.values())
        user_overall_avg = mean(all_user_ratings) if all_user_ratings else 7.0

        # Get per-staff global averages for taste analysis
        staff_ids = list(staff_data.keys())
        per_staff_globals = await self._get_per_staff_global_averages_combined(staff_ids)
        overall_global_avg = await self._get_global_average_score()

        # Build breakdown with Bayesian scoring (using user's own average as prior)
        # First pass: compute raw weighted scores (matching hybrid_recommender exactly)
        raw_scores: list[tuple[str, dict, float, float, float | None]] = []
        for staff_id, data in staff_data.items():
            vn_list = [v for v in data["vn_ids"] if v in votes_dict]
            count = len(vn_list)
            if count == 0:
                raw_scores.append((staff_id, data, 0.0, 0, None))
                continue

            # Match hybrid_recommender: sum(scores) / count
            staff_avg = sum(votes_dict[vn_id] for vn_id in vn_list) / count

            # Calculate Bayesian weighted score using user's overall average as prior
            bayesian = self._calculate_bayesian_score(
                user_avg=staff_avg,
                count=count,
                global_avg=user_overall_avg,
            )
            weighted_score = self._calculate_weighted_score(
                bayesian_score=bayesian,
                count=count,
            )

            raw_scores.append((staff_id, data, staff_avg, count, weighted_score))

        # Find max for normalization (to match recommendations page)
        max_weighted = max((s[4] for s in raw_scores if s[4] is not None), default=1.0)
        if max_weighted <= 0:
            max_weighted = 1.0

        # Second pass: build breakdown with normalized scores
        # Only include staff with names in output, but max was calculated from ALL staff
        breakdown = []
        for staff_id, data, staff_avg, count, weighted_score in raw_scores:
            # Skip staff without names (but they were included in max calculation above)
            if not data["name"]:
                continue

            # Combine roles into a comma-separated string, sorted alphabetically
            combined_roles = ", ".join(sorted(data["roles"]))

            # Normalize to 0-100 scale (same as recommendations page)
            normalized_score = None
            if weighted_score is not None:
                normalized_score = (weighted_score / max_weighted) * 100

            # Get global average for this staff member (for taste analysis comparison)
            staff_global_avg = per_staff_globals.get(staff_id, overall_global_avg)

            breakdown.append(StaffBreakdown(
                id=staff_id,
                name=data["name"],
                original=data["original"],
                role=combined_roles,
                count=count,
                avg_rating=round(staff_avg, 2),
                global_avg_rating=round(staff_global_avg, 2),  # True VNDB global avg for taste analysis
                weighted_score=round(normalized_score, 1) if normalized_score else None,
            ))

        # Sort by weighted_score descending, with count as tiebreaker
        breakdown.sort(key=lambda x: (x.weighted_score or 0, x.count), reverse=True)
        return breakdown[:MAX_BREAKDOWN_RESULTS]

    async def _calculate_seiyuu_breakdown(
        self,
        vn_ids: list[str],
        votes_dict: dict[str, float],
    ) -> list[SeiyuuBreakdown]:
        """Calculate voice actor breakdown with Bayesian scoring.

        Uses user's personal ratings with Bayesian damping for fair ranking.
        """
        if not vn_ids:
            return []

        # Get all seiyuu for user's VNs
        result = await self.db.execute(
            select(VNSeiyuu.vn_id, VNSeiyuu.staff_id, Staff.name, Staff.original)
            .join(Staff, VNSeiyuu.staff_id == Staff.id)
            .where(VNSeiyuu.vn_id.in_(vn_ids))
        )
        rows = result.all()

        # Aggregate by seiyuu
        seiyuu_data: dict[str, dict] = defaultdict(
            lambda: {"name": "", "original": None, "vn_ids": set()}
        )

        for vn_id, staff_id, name, original in rows:
            seiyuu_data[staff_id]["name"] = name
            seiyuu_data[staff_id]["original"] = original
            seiyuu_data[staff_id]["vn_ids"].add(vn_id)

        # Calculate user's overall average for Empirical Bayes
        all_user_ratings = list(votes_dict.values())
        user_overall_avg = mean(all_user_ratings) if all_user_ratings else 7.0

        # Get per-seiyuu global averages for taste analysis
        staff_ids = list(seiyuu_data.keys())
        per_seiyuu_globals = await self._get_per_seiyuu_global_averages(staff_ids)
        overall_global_avg = await self._get_global_average_score()

        # Build breakdown with Bayesian scoring (using user's own average as prior)
        breakdown = []
        for staff_id, data in seiyuu_data.items():
            vn_list = data["vn_ids"]
            count = len(vn_list)
            ratings = [votes_dict[vn_id] for vn_id in vn_list if vn_id in votes_dict]
            avg_rating = mean(ratings) if ratings else 0.0

            # Get global average for this seiyuu (for taste analysis comparison)
            seiyuu_global_avg = per_seiyuu_globals.get(staff_id, overall_global_avg)

            # Calculate Bayesian weighted score using user's overall average as prior
            weighted_score = None
            if ratings:
                bayesian = self._calculate_bayesian_score(
                    user_avg=avg_rating,
                    count=count,
                    global_avg=user_overall_avg,
                )
                weighted_score = self._calculate_weighted_score(
                    bayesian_score=bayesian,
                    count=count,
                )

            breakdown.append(SeiyuuBreakdown(
                id=staff_id,
                name=data["name"],
                original=data["original"],
                count=count,
                avg_rating=round(avg_rating, 2),
                global_avg_rating=round(seiyuu_global_avg, 2),  # True VNDB global avg for taste analysis
                weighted_score=round(weighted_score, 2) if weighted_score else None,
            ))

        # Sort by weighted_score descending, with count as tiebreaker
        breakdown.sort(key=lambda x: (x.weighted_score or 0, x.count), reverse=True)
        return breakdown[:MAX_BREAKDOWN_RESULTS]

    async def _calculate_traits_breakdown(
        self,
        vn_ids: list[str],
        votes_dict: dict[str, float],
    ) -> list[TraitBreakdown]:
        """Calculate character trait breakdown with Bayesian scoring.

        Uses the user's personal ratings for VNs containing each trait,
        with Bayesian damping against global averages for fair ranking.
        """
        if not vn_ids:
            return []

        total_vns = len(vn_ids)

        # Get characters in user's VNs
        char_result = await self.db.execute(
            select(CharacterVN.character_id, CharacterVN.vn_id)
            .where(CharacterVN.vn_id.in_(vn_ids))
        )
        char_vn_rows = char_result.all()

        if not char_vn_rows:
            return []

        # Build character -> VNs mapping
        char_to_vns: dict[str, set[str]] = defaultdict(set)
        for char_id, vn_id in char_vn_rows:
            char_to_vns[char_id].add(vn_id)

        character_ids = list(char_to_vns.keys())

        # Get traits for these characters
        trait_result = await self.db.execute(
            select(
                CharacterTrait.character_id,
                CharacterTrait.trait_id,
                Trait.name,
                Trait.group_name,
            )
            .join(Trait, CharacterTrait.trait_id == Trait.id)
            .where(CharacterTrait.character_id.in_(character_ids))
            .where(CharacterTrait.spoiler_level == 0)  # Non-spoiler only
        )
        trait_rows = trait_result.all()

        # Aggregate traits
        trait_data: dict[int, dict] = defaultdict(
            lambda: {"name": "", "group_name": None, "char_count": 0, "vn_ids": set()}
        )

        for char_id, trait_id, name, group_name in trait_rows:
            trait_data[trait_id]["name"] = name
            trait_data[trait_id]["group_name"] = group_name
            trait_data[trait_id]["char_count"] += 1
            trait_data[trait_id]["vn_ids"].update(char_to_vns[char_id])

        # Calculate user's overall average for Empirical Bayes
        all_user_ratings = list(votes_dict.values())
        user_overall_avg = mean(all_user_ratings) if all_user_ratings else 7.0

        # Get per-trait global averages for taste analysis
        trait_ids = list(trait_data.keys())
        per_trait_globals = await self._get_per_trait_global_averages(trait_ids)
        overall_global_avg = await self._get_global_average_score()

        # Build breakdown with Bayesian scoring (using user's own average as prior)
        breakdown = []
        for trait_id, data in trait_data.items():
            vn_list = data["vn_ids"]
            vn_count = len(vn_list)
            frequency = (vn_count / total_vns) * 100 if total_vns > 0 else 0

            # Calculate user's average rating for VNs with this trait
            ratings = [votes_dict[vn_id] for vn_id in vn_list if vn_id in votes_dict]
            avg_rating = mean(ratings) if ratings else None

            # Get global average for this trait (for taste analysis comparison)
            trait_global_avg = per_trait_globals.get(trait_id, overall_global_avg)

            # Calculate Bayesian weighted score using user's overall average as prior
            weighted_score = None
            if avg_rating is not None:
                bayesian = self._calculate_bayesian_score(
                    user_avg=avg_rating,
                    count=vn_count,
                    global_avg=user_overall_avg,
                )
                weighted_score = self._calculate_weighted_score(
                    bayesian_score=bayesian,
                    count=vn_count,
                )

            breakdown.append(TraitBreakdown(
                id=trait_id,
                name=data["name"],
                group_name=data["group_name"],
                count=data["char_count"],
                vn_count=vn_count,
                frequency=round(frequency, 1),
                avg_rating=round(avg_rating, 2) if avg_rating else None,
                global_avg_rating=round(trait_global_avg, 2),  # True VNDB global avg for taste analysis
                weighted_score=round(weighted_score, 2) if weighted_score else None,
            ))

        # Sort by weighted_score descending (user's preference), with vn_count as tiebreaker
        breakdown.sort(key=lambda x: (x.weighted_score or 0, x.vn_count), reverse=True)
        return breakdown[:MAX_BREAKDOWN_RESULTS]

    async def calculate_tag_analytics(
        self,
        vndb_uid: str,
        user_data: dict,
    ) -> TagAnalyticsResponse:
        """Calculate tag analytics for a user based on completed VNs only.

        Uses Bayesian (damped mean) scoring to rank tags, balancing frequency
        with user ratings using per-tag global averages as the prior.
        """
        # Only use completed VNs (label "2" = Finished)
        labels = user_data.get("labels", {})
        vn_ids = labels.get("2", [])
        votes = {v["vn_id"]: v["score"] / 10 for v in user_data.get("votes", [])}

        if not vn_ids:
            return TagAnalyticsResponse(
                top_tags=[],
                tag_preferences={"loved": [], "avoided": []},
                tag_trends=[],
                tag_comparison_to_global={"more_than_average": [], "less_than_average": []},
            )

        # Get per-tag global averages for preference comparison (loved/avoided)
        per_tag_globals = await self._get_per_tag_global_averages()
        overall_global_avg = await self._get_global_average_score()

        # Get tags for user's VNs (exclude 0.0 scores which are unapplied/removed)
        result = await self.db.execute(
            select(Tag.id, Tag.name, VNTag.vn_id, VNTag.score)
            .join(VNTag, Tag.id == VNTag.tag_id)
            .where(VNTag.vn_id.in_(vn_ids))
            .where(VNTag.spoiler_level == 0)  # No spoilers
            .where(VNTag.score > 0)
            .where(VNTag.lie == False)  # exclude disputed/incorrect tags
        )
        rows = result.all()

        # Debug logging: check if we found any tag data
        if not rows:
            # Check if the VNs exist in VNTag at all
            vntag_check = await self.db.execute(
                select(func.count(VNTag.vn_id.distinct()))
                .where(VNTag.vn_id.in_(vn_ids))
            )
            vntag_count = vntag_check.scalar() or 0
            logger.warning(
                f"[{vndb_uid}] Tag analytics: 0 tag rows found! "
                f"Requested {len(vn_ids)} VNs, {vntag_count} have VNTag entries in database."
            )
        else:
            unique_vns = len(set(row[2] for row in rows))  # row[2] is vn_id
            logger.info(
                f"[{vndb_uid}] Tag analytics: {len(rows)} tag rows for {unique_vns}/{len(vn_ids)} VNs"
            )

        # Aggregate tag data
        tag_data: dict[int, dict] = {}
        for tag_id, tag_name, vn_id, tag_score in rows:
            if tag_id not in tag_data:
                tag_data[tag_id] = {
                    "name": tag_name,
                    "vn_ids": [],
                    "user_scores": [],
                }
            tag_data[tag_id]["vn_ids"].append(vn_id)
            if vn_id in votes:
                tag_data[tag_id]["user_scores"].append(votes[vn_id])

        # Calculate user's overall average for Empirical Bayes
        all_user_ratings = list(votes.values())
        user_overall_avg = mean(all_user_ratings) if all_user_ratings else 7.0

        # Calculate top tags with Bayesian scores (using user's own average as prior)
        top_tags = []
        for tag_id, data in tag_data.items():
            count = len(data["vn_ids"])
            user_avg = mean(data["user_scores"]) if data["user_scores"] else 0

            # Get global average for this tag (used for preference comparison)
            global_avg = per_tag_globals.get(tag_id, overall_global_avg)

            # Calculate Bayesian score using user's overall average as prior
            bayesian = self._calculate_bayesian_score(
                user_avg=user_avg,
                count=count,
                global_avg=user_overall_avg,
            ) if user_avg > 0 else None

            # Calculate weighted score
            weighted = self._calculate_weighted_score(
                bayesian_score=bayesian,
                count=count,
            ) if bayesian else None

            top_tags.append(TagStats(
                tag_id=tag_id,
                name=data["name"],
                count=count,
                avg_score=round(user_avg, 2),
                bayesian_score=round(bayesian, 2) if bayesian else None,
                weighted_score=round(weighted, 2) if weighted else None,
                global_avg_score=round(global_avg, 2),  # Keep for preference comparison
            ))

        # Sort by weighted score (descending), with count as tiebreaker
        top_tags.sort(key=lambda x: (x.weighted_score or 0, x.count), reverse=True)

        # Calculate tag preferences using global averages
        loved = []
        avoided = []
        for tag in top_tags:
            if tag.avg_score > 0 and tag.global_avg_score:
                diff = tag.avg_score - tag.global_avg_score
                pref = TagPreference(
                    tag_id=tag.tag_id,
                    name=tag.name,
                    user_avg=tag.avg_score,
                    global_avg=tag.global_avg_score,
                )
                if diff > 0.5 and tag.count >= 3:  # User rates higher than global
                    loved.append(pref)
                elif diff < -0.5 and tag.count >= 3:  # User rates lower than global
                    avoided.append(pref)

        # Sort preferences by difference magnitude
        loved.sort(key=lambda x: x.user_avg - x.global_avg, reverse=True)
        avoided.sort(key=lambda x: x.global_avg - x.user_avg, reverse=True)

        tag_preferences = {
            "loved": loved[:10],
            "avoided": avoided[:10],
        }

        return TagAnalyticsResponse(
            top_tags=top_tags,
            tag_preferences=tag_preferences,
            tag_trends=[],
            tag_comparison_to_global={
                "more_than_average": [t.name for t in loved[:5]],
                "less_than_average": [t.name for t in avoided[:5]],
            },
        )

    def _cosine_similarity(self, ratings1: dict[str, float], ratings2: dict[str, float]) -> float:
        """Calculate cosine similarity between two rating vectors.

        More robust than Pearson for sparse data - treats missing ratings as 0.
        Returns value in range [0, 1] (shifted from [-1, 1] for ratings).
        """
        if not ratings1 or not ratings2:
            return 0.0

        all_items = set(ratings1.keys()) | set(ratings2.keys())
        vec1 = np.array([ratings1.get(item, 0) for item in all_items])
        vec2 = np.array([ratings2.get(item, 0) for item in all_items])

        dot_product = np.dot(vec1, vec2)
        norm1 = np.linalg.norm(vec1)
        norm2 = np.linalg.norm(vec2)

        if norm1 == 0 or norm2 == 0:
            return 0.0

        # Cosine similarity ranges from -1 to 1, normalize to 0-1
        similarity = dot_product / (norm1 * norm2)
        return (similarity + 1) / 2

    def _tag_taste_similarity(
        self,
        tags1: list[dict],
        tags2: list[dict],
    ) -> float:
        """Calculate similarity between two users based on their tag preferences.

        Uses mean-centered scores to capture relative preferences rather than
        absolute scores. This prevents the metric from being artificially high
        just because both users rate in similar ranges (e.g., both rate 6-8).

        Args:
            tags1: List of {tag_id, name, count, avg_score} from user 1's tag analytics
            tags2: List of {tag_id, name, count, avg_score} from user 2's tag analytics

        Returns:
            Similarity score from 0 to 1
        """
        if not tags1 or not tags2:
            return 0.0

        # Calculate average score for each user to center their preferences
        scores1 = [tag.get("avg_score", 0) for tag in tags1 if tag.get("avg_score")]
        scores2 = [tag.get("avg_score", 0) for tag in tags2 if tag.get("avg_score")]

        if not scores1 or not scores2:
            return 0.0

        avg1 = sum(scores1) / len(scores1)
        avg2 = sum(scores2) / len(scores2)

        # Build mean-centered preference vectors
        # Positive = likes more than their average, negative = likes less
        prefs1 = {}
        for tag in tags1:
            tag_id = tag.get("tag_id") or tag.get("id")
            score = tag.get("avg_score", 0)
            count = tag.get("count", 1)
            if tag_id and score:
                # Center score around user's average, weight by log(count + 1)
                centered = (score - avg1) * math.log(count + 1)
                prefs1[tag_id] = centered

        prefs2 = {}
        for tag in tags2:
            tag_id = tag.get("tag_id") or tag.get("id")
            score = tag.get("avg_score", 0)
            count = tag.get("count", 1)
            if tag_id and score:
                centered = (score - avg2) * math.log(count + 1)
                prefs2[tag_id] = centered

        return self._cosine_similarity(prefs1, prefs2)

    def _analyze_tag_preferences(
        self,
        tags1: list[dict],
        tags2: list[dict],
    ) -> tuple[list[str], dict[str, list[str]]]:
        """Analyze tag preferences to find common tags and differing tastes.

        Args:
            tags1: User 1's tag stats
            tags2: User 2's tag stats

        Returns:
            (common_tags, differing_tastes)
            - common_tags: Tags both users rate highly (avg >= 7)
            - differing_tastes: {"user1_prefers": [...], "user2_prefers": [...]}
        """
        # Build lookup by tag_id
        map1 = {}
        for tag in tags1:
            tag_id = tag.get("tag_id") or tag.get("id")
            if tag_id:
                map1[tag_id] = {"name": tag.get("name", ""), "score": tag.get("avg_score", 0)}

        map2 = {}
        for tag in tags2:
            tag_id = tag.get("tag_id") or tag.get("id")
            if tag_id:
                map2[tag_id] = {"name": tag.get("name", ""), "score": tag.get("avg_score", 0)}

        # Find common tags (both users rated highly)
        common_tags = []
        shared_tag_ids = set(map1.keys()) & set(map2.keys())

        for tag_id in shared_tag_ids:
            score1 = map1[tag_id]["score"]
            score2 = map2[tag_id]["score"]
            # Both users rate this tag's VNs highly (avg >= 7/10 = 70/100)
            if score1 >= 70 and score2 >= 70:
                common_tags.append(map1[tag_id]["name"])

        # Sort by combined score
        common_tags_with_scores = [
            (map1[tid]["name"], map1[tid]["score"] + map2[tid]["score"])
            for tid in shared_tag_ids
            if map1[tid]["score"] >= 70 and map2[tid]["score"] >= 70
        ]
        common_tags_with_scores.sort(key=lambda x: x[1], reverse=True)
        common_tags = [name for name, _ in common_tags_with_scores[:10]]

        # Find differing tastes (big score differences on shared tags)
        user1_prefers = []
        user2_prefers = []

        for tag_id in shared_tag_ids:
            score1 = map1[tag_id]["score"]
            score2 = map2[tag_id]["score"]
            diff = score1 - score2

            # Significant difference (2+ points on 10-point scale = 20 on 100-point)
            if diff >= 20:
                user1_prefers.append((map1[tag_id]["name"], diff))
            elif diff <= -20:
                user2_prefers.append((map2[tag_id]["name"], -diff))

        # Sort by difference magnitude and take top 5
        user1_prefers.sort(key=lambda x: x[1], reverse=True)
        user2_prefers.sort(key=lambda x: x[1], reverse=True)

        differing_tastes = {
            "user1_prefers": [name for name, _ in user1_prefers[:5]],
            "user2_prefers": [name for name, _ in user2_prefers[:5]],
        }

        return common_tags, differing_tastes

    async def compare_users(
        self,
        uid1: str,
        data1: dict,
        uid2: str,
        data2: dict,
    ) -> UserComparisonResponse:
        """Compare two users' statistics."""
        vn_ids1 = set(data1.get("vn_ids", []))
        vn_ids2 = set(data2.get("vn_ids", []))

        votes1 = {v["vn_id"]: v["score"] for v in data1.get("votes", [])}
        votes2 = {v["vn_id"]: v["score"] for v in data2.get("votes", [])}

        # Find shared VNs
        shared = vn_ids1 & vn_ids2
        shared_voted = set(votes1.keys()) & set(votes2.keys())

        # Calculate score correlation for shared voted VNs
        if len(shared_voted) >= 2:
            scores1 = [votes1[vid] for vid in shared_voted]
            scores2 = [votes2[vid] for vid in shared_voted]
            correlation = float(np.corrcoef(scores1, scores2)[0, 1])
        else:
            correlation = 0.0

        # Rating agreement: how closely users rate shared VNs (MAE-based)
        if shared_voted and len(shared_voted) >= 2:
            diffs = [abs(votes1[vid] - votes2[vid]) for vid in shared_voted]
            mae = sum(diffs) / len(diffs)
            # 50 on 0-100 scale = 5 points on 10-point scale → 0% agreement
            rating_agreement = max(0.0, 1.0 - mae / 50.0)
        else:
            rating_agreement = 0.0

        # Find biggest disagreements (3+ point difference)
        disagreement_ids = []
        for vid in shared_voted:
            diff = abs(votes1[vid] - votes2[vid])
            if diff >= 30:  # 3+ points (scores are 0-100)
                disagreement_ids.append((vid, diff))
        disagreement_ids.sort(key=lambda x: x[1], reverse=True)
        disagreement_ids = [vid for vid, _ in disagreement_ids[:5]]

        # Find shared favorites (both rated 8+)
        favorite_ids = [
            vid for vid in shared_voted
            if votes1[vid] >= 80 and votes2[vid] >= 80
        ][:10]

        # Fetch VN details from database for all needed VNs
        all_vn_ids = list(set(disagreement_ids + favorite_ids))
        vn_details = {}
        if all_vn_ids:
            result = await self.db.execute(
                select(VisualNovel.id, VisualNovel.title, VisualNovel.image_url)
                .where(VisualNovel.id.in_(all_vn_ids))
            )
            for row in result.all():
                vn_details[row.id] = {"title": row.title, "image_url": row.image_url}

        # Build SharedVNScore objects for favorites
        shared_favorites = [
            SharedVNScore(
                vn_id=vid,
                title=vn_details.get(vid, {}).get("title", vid),
                image_url=vn_details.get(vid, {}).get("image_url"),
                user1_score=votes1[vid] / 10,
                user2_score=votes2[vid] / 10,
            )
            for vid in favorite_ids
        ]

        # Build SharedVNScore objects for disagreements
        biggest_disagreements = [
            SharedVNScore(
                vn_id=vid,
                title=vn_details.get(vid, {}).get("title", vid),
                image_url=vn_details.get(vid, {}).get("image_url"),
                user1_score=votes1[vid] / 10,
                user2_score=votes2[vid] / 10,
            )
            for vid in disagreement_ids
        ]

        # === Enhanced similarity calculations ===

        # Jaccard similarity (list overlap) - raw and nonlinearly scaled
        if vn_ids1 or vn_ids2:
            raw_jaccard = len(shared) / len(vn_ids1 | vn_ids2) if (vn_ids1 | vn_ids2) else 0.0
        else:
            raw_jaccard = 0.0
        scaled_jaccard = min(1.0, raw_jaccard * 5)  # 20%+ raw overlap → full credit

        # Cosine similarity on ratings (more robust for sparse data)
        cosine_sim = self._cosine_similarity(votes1, votes2)

        # Confidence based on number of shared rated VNs (caps at 20)
        confidence = min(len(shared_voted) / 20, 1.0) if shared_voted else 0.0

        # Get tag stats if available (passed from API layer)
        tags1 = data1.get("tag_stats", [])
        tags2 = data2.get("tag_stats", [])

        # Tag-based taste similarity
        tag_sim = 0.0
        common_tags = []
        differing_tastes = {"user1_prefers": [], "user2_prefers": []}

        if tags1 and tags2:
            tag_sim = self._tag_taste_similarity(tags1, tags2)
            common_tags, differing_tastes = self._analyze_tag_preferences(tags1, tags2)

        # Normalize correlation to 0-1 range
        normalized_correlation = max(0, (correlation + 1) / 2) if not math.isnan(correlation) else 0.0

        # Adaptive compatibility formula: weights depend on available shared data
        # Rating agreement and tag similarity are the strongest signals
        if len(shared_voted) >= 5:
            # Good data: trust rating comparison heavily
            compatibility = (
                0.40 * rating_agreement +
                0.20 * normalized_correlation +
                0.25 * tag_sim +
                0.15 * scaled_jaccard
            )
        elif len(shared_voted) >= 2:
            # Some shared rated VNs
            compatibility = (
                0.30 * rating_agreement +
                0.15 * normalized_correlation +
                0.30 * tag_sim +
                0.25 * scaled_jaccard
            )
        else:
            # No shared ratings - fallback to tag + overlap
            if tag_sim > 0:
                compatibility = 0.50 * tag_sim + 0.50 * scaled_jaccard
            else:
                compatibility = scaled_jaccard

        return UserComparisonResponse(
            user1=UserInfo(uid=uid1, username=data1.get("username", uid1)),
            user2=UserInfo(uid=uid2, username=data2.get("username", uid2)),
            compatibility_score=round(compatibility, 2),
            shared_vns=len(shared_voted),
            score_correlation=round(correlation, 2) if not math.isnan(correlation) else 0.0,
            shared_favorites=shared_favorites,
            biggest_disagreements=biggest_disagreements,
            common_tags=common_tags,
            differing_tastes=differing_tastes,
            # Enhanced metrics
            tag_similarity=round(tag_sim, 2) if tags1 and tags2 else None,
            confidence=round(confidence, 2),
            jaccard_similarity=round(raw_jaccard, 2),
            cosine_similarity=round(cosine_sim, 2),
            rating_agreement=round(rating_agreement, 2) if len(shared_voted) >= 2 else None,
        )

    async def find_similar_users(
        self,
        vndb_uid: str,
        user_data: dict,
        limit: int = 10,
    ) -> list[SimilarUserResponse]:
        """Find users most similar to the given user.

        Uses the ulist_vns dump table directly. Two-phase approach:
        1. SQL: find candidate users who share rated VNs with the target
        2. Python: compute full similarity scores for candidates

        Args:
            vndb_uid: The target user's VNDB UID
            user_data: The target user's data (vn_ids, votes from get_user_list)
            limit: Maximum number of similar users to return

        Returns:
            List of similar users sorted by compatibility (descending)
        """
        MIN_SHARED = 3       # Minimum shared rated VNs to be a candidate
        MAX_CANDIDATES = 200  # Cap candidates for performance

        # Extract target user's VN list and votes
        target_vn_ids = set(user_data.get("vn_ids", []))
        target_votes = {v["vn_id"]: v["score"] for v in user_data.get("votes", [])}
        target_voted_vids = set(target_votes.keys())

        if not target_voted_vids:
            return []

        # Phase 1: Find candidate users who share rated VNs with the target.
        # Uses idx_ulist_vns_vid index for fast lookup.
        candidate_query = (
            select(UlistVN.uid, func.count().label("shared_count"))
            .where(UlistVN.vid.in_(target_voted_vids))
            .where(UlistVN.vote.isnot(None))
            .where(UlistVN.uid != vndb_uid)
            .group_by(UlistVN.uid)
            .having(func.count() >= MIN_SHARED)
            .order_by(func.count().desc())
            .limit(MAX_CANDIDATES)
        )
        result = await self.db.execute(candidate_query)
        candidates = result.all()  # list of (uid, shared_count)

        if not candidates:
            return []

        candidate_uids = [row[0] for row in candidates]

        # Phase 2: Batch-fetch all vote data for candidates
        votes_result = await self.db.execute(
            select(UlistVN.uid, UlistVN.vid, UlistVN.vote)
            .where(UlistVN.uid.in_(candidate_uids))
            .where(UlistVN.vote.isnot(None))
        )
        # Build per-user vote dicts: {uid: {vid: vote, ...}}
        user_votes: dict[str, dict[str, int]] = defaultdict(dict)
        for uid, vid, vote in votes_result.all():
            user_votes[uid][vid] = vote

        # Batch-fetch finished counts (label=2) for candidates
        finished_result = await self.db.execute(
            select(UlistLabel.uid, func.count(distinct(UlistLabel.vid)))
            .where(UlistLabel.uid.in_(candidate_uids))
            .where(UlistLabel.label == 2)
            .group_by(UlistLabel.uid)
        )
        finished_counts: dict[str, int] = {
            uid: count for uid, count in finished_result.all()
        }

        # Phase 3: Compute similarity for each candidate
        similarities = []
        for candidate_uid in candidate_uids:
            try:
                other_votes = user_votes.get(candidate_uid, {})
                if not other_votes:
                    continue

                other_vn_ids = set(other_votes.keys())

                # Jaccard similarity (list overlap) - raw and scaled
                shared = target_vn_ids & other_vn_ids
                union = target_vn_ids | other_vn_ids
                raw_jaccard = len(shared) / len(union) if union else 0.0
                scaled_jaccard = min(1.0, raw_jaccard * 5)  # 20%+ raw → full credit

                # Pearson correlation for shared voted VNs
                shared_voted = target_voted_vids & set(other_votes.keys())
                if len(shared_voted) >= 2:
                    scores1 = [target_votes[vid] for vid in shared_voted]
                    scores2 = [other_votes[vid] for vid in shared_voted]
                    correlation = float(np.corrcoef(scores1, scores2)[0, 1])
                    if math.isnan(correlation):
                        correlation = 0.0
                else:
                    correlation = 0.0

                normalized_correlation = max(0, (correlation + 1) / 2)

                # Rating agreement (MAE-based)
                if len(shared_voted) >= 2:
                    diffs = [abs(target_votes[vid] - other_votes[vid]) for vid in shared_voted]
                    mae = sum(diffs) / len(diffs)
                    rating_agreement = max(0.0, 1.0 - mae / 50.0)
                else:
                    rating_agreement = 0.0

                # Adaptive compatibility formula
                if len(shared_voted) >= 5:
                    compatibility = (
                        0.50 * rating_agreement +
                        0.25 * normalized_correlation +
                        0.25 * scaled_jaccard
                    )
                elif len(shared_voted) >= 2:
                    compatibility = (
                        0.35 * rating_agreement +
                        0.20 * normalized_correlation +
                        0.45 * scaled_jaccard
                    )
                else:
                    compatibility = scaled_jaccard

                # Stats for display
                finished = finished_counts.get(candidate_uid, 0)
                total_vns = finished if finished > 0 else len(other_votes)
                avg_score = None
                if other_votes:
                    vote_values = list(other_votes.values())
                    avg_score = sum(vote_values) / len(vote_values) / 10  # Convert to 1-10 scale

                similarities.append({
                    "uid": candidate_uid,
                    "username": candidate_uid,  # Dump data has no usernames
                    "compatibility": compatibility,
                    "shared_vns": len(shared_voted),
                    "tag_similarity": None,
                    "total_vns": total_vns,
                    "avg_score": round(avg_score, 2) if avg_score else None,
                })
            except Exception as e:
                logger.warning(f"Error calculating similarity for user {candidate_uid}: {e}")
                continue

        # Sort by compatibility (descending) and return top N
        similarities.sort(key=lambda x: x["compatibility"], reverse=True)
        top_similar = similarities[:limit]

        # Resolve usernames from the vndb_users table (imported from dumps)
        top_uids = [s["uid"] for s in top_similar]
        if top_uids:
            username_result = await self.db.execute(
                select(VndbUser.uid, VndbUser.username)
                .where(VndbUser.uid.in_(top_uids))
            )
            uid_to_name = {uid: name for uid, name in username_result.all()}
            for s in top_similar:
                s["username"] = uid_to_name.get(s["uid"], s["uid"])

        return [SimilarUserResponse(**s) for s in top_similar]

    async def get_global_stats(self, force_refresh: bool = False) -> GlobalStatsResponse:
        """Calculate global database statistics."""
        # Check cache first
        cache_key = "global_stats:v2"  # v2: added last_updated
        if not force_refresh:
            cached = await self.cache.get(cache_key)
            if cached:
                # Reconstruct response from cached dict
                return GlobalStatsResponse(**cached)

        # Get total counts
        result = await self.db.execute(
            select(func.count()).select_from(VisualNovel)
        )
        total_vns = result.scalar_one_or_none() or 0

        result = await self.db.execute(
            select(func.count()).select_from(VisualNovel)
            .where(VisualNovel.rating.isnot(None))
        )
        total_with_ratings = result.scalar_one_or_none() or 0

        # Get average rating
        result = await self.db.execute(
            select(func.avg(VisualNovel.rating))
            .where(VisualNovel.rating.isnot(None))
        )
        average_rating = result.scalar_one_or_none() or 0

        # Score distribution (1-10)
        score_dist = {str(i): 0 for i in range(1, 11)}
        result = await self.db.execute(
            select(
                func.floor(VisualNovel.rating).label('score'),
                func.count().label('count')
            )
            .where(VisualNovel.rating.isnot(None))
            .where(VisualNovel.rating >= 1)
            .group_by(func.floor(VisualNovel.rating))
        )
        for row in result.all():
            score = int(row.score)
            if 1 <= score <= 10:
                score_dist[str(score)] = row.count

        # Release year distribution
        result = await self.db.execute(
            select(
                func.extract('year', VisualNovel.released).label('year'),
                func.count().label('count')
            )
            .where(VisualNovel.released.isnot(None))
            .group_by(func.extract('year', VisualNovel.released))
            .order_by(func.extract('year', VisualNovel.released))
        )
        release_year_dist = {}
        for row in result.all():
            if row.year:
                release_year_dist[str(int(row.year))] = row.count

        # Release year with ratings
        result = await self.db.execute(
            select(
                func.extract('year', VisualNovel.released).label('year'),
                func.count().label('count'),
                func.avg(VisualNovel.rating).label('avg_rating')
            )
            .where(VisualNovel.released.isnot(None))
            .where(VisualNovel.rating.isnot(None))
            .group_by(func.extract('year', VisualNovel.released))
            .order_by(func.extract('year', VisualNovel.released))
        )
        release_year_with_ratings = []
        for row in result.all():
            if row.year:
                release_year_with_ratings.append(YearWithRating(
                    year=int(row.year),
                    count=row.count,
                    avg_rating=round(float(row.avg_rating), 2) if row.avg_rating else 0
                ))

        # Length distribution (handles both old 1-5 format and new minutes format)
        length_dist = {
            "very_short": CategoryStats(count=0, avg_rating=0),
            "short": CategoryStats(count=0, avg_rating=0),
            "medium": CategoryStats(count=0, avg_rating=0),
            "long": CategoryStats(count=0, avg_rating=0),
            "very_long": CategoryStats(count=0, avg_rating=0),
        }

        # VNDB uses two formats: old (1-5 categories) and new (minutes)
        length_category = case(
            # Old format: 1-5 are category IDs
            (VisualNovel.length == 1, "very_short"),
            (VisualNovel.length == 2, "short"),
            (VisualNovel.length == 3, "medium"),
            (VisualNovel.length == 4, "long"),
            (VisualNovel.length == 5, "very_long"),
            # New format: minutes (values > 5)
            (VisualNovel.length < 120, "very_short"),      # < 2 hours
            (VisualNovel.length < 600, "short"),           # 2-10 hours
            (VisualNovel.length < 1800, "medium"),         # 10-30 hours
            (VisualNovel.length < 3000, "long"),           # 30-50 hours
            else_="very_long"                              # > 50 hours
        ).label("length_category")

        result = await self.db.execute(
            select(
                length_category,
                func.count().label('count'),
                func.avg(VisualNovel.rating).label('avg_rating')
            )
            .where(VisualNovel.length.isnot(None))
            .where(VisualNovel.length > 0)
            .group_by(length_category)
        )
        for row in result.all():
            category, count, avg_rating = row
            if category in length_dist:
                length_dist[category] = CategoryStats(
                    count=count or 0,
                    avg_rating=round(float(avg_rating), 2) if avg_rating else 0
                )

        # Age rating distribution
        # Map minage values to categories using single query with CASE expression
        age_dist = {
            "all_ages": CategoryStats(count=0, avg_rating=0),
            "teen": CategoryStats(count=0, avg_rating=0),
            "adult": CategoryStats(count=0, avg_rating=0),
        }

        # Single query with CASE to categorize age ratings
        age_category = case(
            (VisualNovel.minage <= 12, "all_ages"),
            (VisualNovel.minage <= 17, "teen"),
            else_="adult"
        ).label("age_category")

        result = await self.db.execute(
            select(
                age_category,
                func.count(),
                func.avg(VisualNovel.rating)
            )
            .where(VisualNovel.minage.isnot(None))
            .group_by(age_category)
        )

        for row in result.all():
            category, count, avg_rating = row
            if category in age_dist:
                age_dist[category] = CategoryStats(
                    count=count or 0,
                    avg_rating=round(float(avg_rating), 2) if avg_rating else 0
                )

        # Get most recent update time from VNs (reflects when data actually changed)
        max_updated = await self.db.scalar(
            select(func.max(VisualNovel.updated_at))
        )

        response = GlobalStatsResponse(
            total_vns=total_vns,
            total_with_ratings=total_with_ratings,
            average_rating=round(float(average_rating), 2),
            score_distribution=score_dist,
            release_year_distribution=release_year_dist,
            release_year_with_ratings=release_year_with_ratings,
            length_distribution=length_dist,
            age_rating_distribution=age_dist,
            # When force_refresh, show current time to indicate data was just refreshed
            last_updated=datetime.now() if force_refresh else (max_updated or datetime.now()),
        )

        # Cache for 1 hour
        await self.cache.set(cache_key, response.model_dump(mode='json'), ttl=3600)

        return response

    async def get_tag_stats(self, tag_id: int, force_refresh: bool = False) -> TagStatsResponse | None:
        """Calculate statistics for ALL VNs with a specific tag.

        This uses the full database to provide accurate aggregate statistics,
        unlike the frontend fallback which only samples 100 VNs.
        """
        # Check cache first
        # Bump cache version to invalidate older computations after logic changes
        cache_key = f"tag_stats:v16:{tag_id}"  # v16: include NULL/0 score taggings to match VNDB counts
        if not force_refresh:
            cached = await self.cache.get(cache_key)
            if cached:
                return TagStatsResponse(**cached)

        # Get tag info
        result = await self.db.execute(
            select(Tag).where(Tag.id == tag_id)
        )
        tag = result.scalar_one_or_none()
        if not tag:
            return None

        # Get all descendant tag IDs (including the tag itself) using recursive CTE
        # This matches VNDB behavior where tag pages include VNs from child tags
        # Uses tag_parents junction table for multi-parent support
        descendant_result = await self.db.execute(
            text("""
                WITH RECURSIVE tag_tree AS (
                    SELECT id FROM tags WHERE id = :tag_id
                    UNION ALL
                    SELECT tp.tag_id AS id FROM tag_parents tp JOIN tag_tree tt ON tp.parent_id = tt.id
                )
                SELECT DISTINCT id FROM tag_tree
            """),
            {"tag_id": tag_id}
        )
        descendant_tag_ids = [row[0] for row in descendant_result.fetchall()]

        # Get ALL VNs with this tag or any descendant tags (using JOIN for efficiency)
        # Include all spoiler levels - we want complete statistics for the tag
        # Include all VNs regardless of devstatus to match VNDB counts exactly
        # Use DISTINCT to avoid counting VNs that have multiple matching tags
        result = await self.db.execute(
            select(
                VisualNovel.id,
                VisualNovel.rating,
                VisualNovel.votecount,
                VisualNovel.released,
                VisualNovel.length,
                VisualNovel.length_minutes,
                VisualNovel.minage,
                VisualNovel.olang,  # Original language for JP counts
            )
            .distinct()
            .join(VNTag, VisualNovel.id == VNTag.vn_id)
            .where(
                VNTag.tag_id.in_(descendant_tag_ids),
                # Exclude tags with negative scores (users voted that tag doesn't apply)
                # and "lie" tags (disputed/incorrect tags)
                VNTag.score >= 0,
                VNTag.lie == False,
            )
            # No spoiler filter - include all VNs for accurate aggregate statistics
        )
        vns = result.all()

        if not vns:
            return None

        # Initialize distributions
        score_dist = {str(i): 0 for i in range(1, 11)}
        score_dist_jp = {str(i): 0 for i in range(1, 11)}  # JP-original VN counts per score
        release_year_dist: dict[str, int] = {}
        year_ratings: dict[int, dict] = {}  # year -> {count, total_rating, rated_count, jp_count}
        length_categories = ["very_short", "short", "medium", "long", "very_long"]
        length_data = {cat: {"count": 0, "total_rating": 0, "rated_count": 0, "jp_count": 0} for cat in length_categories}
        age_data = {
            "all_ages": {"count": 0, "total_rating": 0, "rated_count": 0, "jp_count": 0},
            "teen": {"count": 0, "total_rating": 0, "rated_count": 0, "jp_count": 0},
            "adult": {"count": 0, "total_rating": 0, "rated_count": 0, "jp_count": 0},
        }

        total_votes = 0
        total_rating = 0.0
        rated_count = 0

        for vn in vns:
            # Track if this is a Japanese-original VN
            is_jp = vn.olang == 'ja'

            # Score distribution
            if vn.rating is not None:
                score = int(min(10, max(1, math.floor(vn.rating))))
                score_dist[str(score)] += 1
                if is_jp:
                    score_dist_jp[str(score)] += 1
                total_rating += vn.rating
                rated_count += 1

            # Vote count
            if vn.votecount:
                total_votes += vn.votecount

            # Release year distribution - use VN's primary released date
            release_year = vn.released.year if vn.released else None

            if release_year:
                year_str = str(release_year)
                release_year_dist[year_str] = release_year_dist.get(year_str, 0) + 1

                if release_year not in year_ratings:
                    year_ratings[release_year] = {"count": 0, "total_rating": 0, "rated_count": 0, "jp_count": 0}
                year_ratings[release_year]["count"] += 1
                if is_jp:
                    year_ratings[release_year]["jp_count"] += 1
                if vn.rating is not None:
                    year_ratings[release_year]["total_rating"] += vn.rating
                    year_ratings[release_year]["rated_count"] += 1

            # Length distribution (handles both old 1-5 format and new minutes format)
            # Use length_to_categories() to match VNDB behavior where boundary
            # values (e.g., 50 hours) count in BOTH adjacent categories
            # Prefer length_minutes (vote average) when available to match VNDB website
            for length_cat in length_to_categories(vn.length, vn.length_minutes):
                length_data[length_cat]["count"] += 1
                if is_jp:
                    length_data[length_cat]["jp_count"] += 1
                if vn.rating is not None:
                    length_data[length_cat]["total_rating"] += vn.rating
                    length_data[length_cat]["rated_count"] += 1

            # Age rating distribution
            if vn.minage is not None:
                if vn.minage <= 12:
                    age_key = "all_ages"
                elif vn.minage <= 17:
                    age_key = "teen"
                else:
                    age_key = "adult"
                age_data[age_key]["count"] += 1
                if is_jp:
                    age_data[age_key]["jp_count"] += 1
                if vn.rating is not None:
                    age_data[age_key]["total_rating"] += vn.rating
                    age_data[age_key]["rated_count"] += 1

        # Build response
        avg_rating = total_rating / rated_count if rated_count > 0 else 0

        # Convert length data to CategoryStats (includes jp_count)
        length_dist = {}
        for name, data in length_data.items():
            avg = data["total_rating"] / data["rated_count"] if data["rated_count"] > 0 else 0
            length_dist[name] = CategoryStats(count=data["count"], avg_rating=round(avg, 2), jp_count=data["jp_count"])

        # Convert age data to CategoryStats (includes jp_count)
        age_dist = {}
        for name, data in age_data.items():
            avg = data["total_rating"] / data["rated_count"] if data["rated_count"] > 0 else 0
            age_dist[name] = CategoryStats(count=data["count"], avg_rating=round(avg, 2), jp_count=data["jp_count"])

        # Build release year with ratings
        release_year_with_ratings = []
        for year in sorted(year_ratings.keys()):
            data = year_ratings[year]
            avg = data["total_rating"] / data["rated_count"] if data["rated_count"] > 0 else 0
            release_year_with_ratings.append(YearWithRating(
                year=year,
                count=data["count"],
                avg_rating=round(avg, 2),
                jp_count=data["jp_count"],
            ))

        # Sort release year distribution
        release_year_dist = dict(sorted(release_year_dist.items()))

        # Get most recent update time from VNs with this tag (reflects when data actually changed)
        max_updated = await self.db.scalar(
            select(func.max(VisualNovel.updated_at))
            .join(VNTag, VNTag.vn_id == VisualNovel.id)
            .where(VNTag.tag_id == tag_id)
        )

        response = TagStatsResponse(
            tag=TagDetailResponse(
                id=f"g{tag.id}",
                name=tag.name,
                description=tag.description,
                category=tag.category,
                vn_count=tag.vn_count if tag.vn_count is not None else len(vns),
                aliases=tag.aliases,
            ),
            average_rating=round(avg_rating, 2),
            total_votes=total_votes,
            total_vns=rated_count,
            score_distribution=score_dist,
            score_distribution_jp=score_dist_jp,
            release_year_distribution=release_year_dist,
            release_year_with_ratings=release_year_with_ratings,
            length_distribution=length_dist,
            age_rating_distribution=age_dist,
            # When force_refresh, show current time to indicate data was just refreshed
            last_updated=datetime.now() if force_refresh else (max_updated or datetime.now()),
        )

        # Cache for 1 hour
        await self.cache.set(cache_key, response.model_dump(mode='json'), ttl=3600)

        return response

    async def debug_tag_length_vns(
        self,
        tag_id: int,
        category: str,
        *,
        limit: int = 5000,
        offset: int = 0,
    ) -> dict:
        """Return VN IDs included in a computed length bucket for a tag.

        Uses the same tag→VN selection rules as `get_tag_stats()` (including
        descendant tags, excluding disputed/incorrect taggings) and the same
        bucketing logic as the length distribution.
        """
        # Get all descendant tag IDs (including the tag itself)
        # Uses tag_parents junction table for multi-parent support
        descendant_result = await self.db.execute(
            text(
                """
                WITH RECURSIVE tag_tree AS (
                    SELECT id FROM tags WHERE id = :tag_id
                    UNION ALL
                    SELECT tp.tag_id AS id FROM tag_parents tp JOIN tag_tree tt ON tp.parent_id = tt.id
                )
                SELECT DISTINCT id FROM tag_tree
                """
            ),
            {"tag_id": tag_id},
        )
        descendant_tag_ids = [row[0] for row in descendant_result.fetchall()]

        result = await self.db.execute(
            select(
                VisualNovel.id,
                VisualNovel.length,
                VisualNovel.length_minutes,
            )
            .distinct()
            .join(VNTag, VisualNovel.id == VNTag.vn_id)
            .where(
                VNTag.tag_id.in_(descendant_tag_ids),
                VNTag.score >= 0,  # Match stats endpoint - exclude negative scores
                VNTag.lie == False,
            )
        )
        rows = result.all()

        matches: list[dict] = []
        for row in rows:
            cats = length_to_categories(row.length, row.length_minutes)
            if category not in cats:
                continue

            use_vote_minutes = row.length_minutes is not None and row.length_minutes > 0
            effective_length = row.length_minutes if use_vote_minutes else row.length

            matches.append(
                {
                    "id": row.id,
                    "length": row.length,
                    "length_minutes": row.length_minutes,
                    "effective_length": effective_length,
                    "effective_source": "length_minutes" if use_vote_minutes else "length",
                }
            )

        matches.sort(key=lambda x: (x["effective_length"] is None, x["effective_length"], x["id"]))

        total = len(matches)
        start = min(offset, total)
        end = min(offset + limit, total)

        return {
            "tag_id": tag_id,
            "category": category,
            "total": total,
            "limit": limit,
            "offset": offset,
            "vns": matches[start:end],
        }

    async def get_trait_stats(self, trait_id: int, force_refresh: bool = False) -> TraitStatsResponse | None:
        """Calculate statistics for ALL VNs with characters having a specific trait.

        This uses the full database to provide accurate aggregate statistics,
        unlike the frontend fallback which only samples 100 VNs.
        """
        # Check cache first
        cache_key = f"trait_stats:v4:{trait_id}"  # v4: added last_updated
        if not force_refresh:
            cached = await self.cache.get(cache_key)
            if cached:
                return TraitStatsResponse(**cached)

        # Get trait info
        result = await self.db.execute(
            select(Trait).where(Trait.id == trait_id)
        )
        trait = result.scalar_one_or_none()
        if not trait:
            return None

        # Get ALL VNs with characters having this trait
        # Uses: CharacterTrait -> CharacterVN -> VisualNovel
        # DISTINCT to avoid counting a VN multiple times if it has multiple characters with same trait
        # Include all VNs regardless of devstatus to match VNDB counts exactly
        result = await self.db.execute(
            select(
                VisualNovel.id,
                VisualNovel.rating,
                VisualNovel.votecount,
                VisualNovel.released,
                VisualNovel.length,
                VisualNovel.length_minutes,
                VisualNovel.minage,
                VisualNovel.olang,  # Original language for JP counts
            )
            .join(CharacterVN, VisualNovel.id == CharacterVN.vn_id)
            .join(CharacterTrait, CharacterVN.character_id == CharacterTrait.character_id)
            .where(
                CharacterTrait.trait_id == trait_id,
            )
            # No spoiler filter - include all VNs for accurate aggregate statistics
            .distinct()
        )
        vns = result.all()

        if not vns:
            return None

        # Initialize distributions
        score_dist = {str(i): 0 for i in range(1, 11)}
        score_dist_jp = {str(i): 0 for i in range(1, 11)}  # JP-original VN counts per score
        release_year_dist: dict[str, int] = {}
        year_ratings: dict[int, dict] = {}  # year -> {count, total_rating, rated_count, jp_count}
        length_categories = ["very_short", "short", "medium", "long", "very_long"]
        length_data = {cat: {"count": 0, "total_rating": 0, "rated_count": 0, "jp_count": 0} for cat in length_categories}
        age_data = {
            "all_ages": {"count": 0, "total_rating": 0, "rated_count": 0, "jp_count": 0},
            "teen": {"count": 0, "total_rating": 0, "rated_count": 0, "jp_count": 0},
            "adult": {"count": 0, "total_rating": 0, "rated_count": 0, "jp_count": 0},
        }

        total_votes = 0
        total_rating = 0.0
        rated_count = 0

        for vn in vns:
            # Track if this is a Japanese-original VN
            is_jp = vn.olang == 'ja'

            # Score distribution
            if vn.rating is not None:
                score = int(min(10, max(1, math.floor(vn.rating))))
                score_dist[str(score)] += 1
                if is_jp:
                    score_dist_jp[str(score)] += 1
                total_rating += vn.rating
                rated_count += 1

            # Vote count
            if vn.votecount:
                total_votes += vn.votecount

            # Release year distribution - use VN's primary released date
            release_year = vn.released.year if vn.released else None

            if release_year:
                year_str = str(release_year)
                release_year_dist[year_str] = release_year_dist.get(year_str, 0) + 1

                if release_year not in year_ratings:
                    year_ratings[release_year] = {"count": 0, "total_rating": 0, "rated_count": 0, "jp_count": 0}
                year_ratings[release_year]["count"] += 1
                if is_jp:
                    year_ratings[release_year]["jp_count"] += 1
                if vn.rating is not None:
                    year_ratings[release_year]["total_rating"] += vn.rating
                    year_ratings[release_year]["rated_count"] += 1

            # Length distribution (handles both old 1-5 format and new minutes format)
            # Use length_to_categories() to match VNDB behavior where boundary
            # values (e.g., 50 hours) count in BOTH adjacent categories
            # Prefer length_minutes (vote average) when available to match VNDB website
            for length_cat in length_to_categories(vn.length, vn.length_minutes):
                length_data[length_cat]["count"] += 1
                if is_jp:
                    length_data[length_cat]["jp_count"] += 1
                if vn.rating is not None:
                    length_data[length_cat]["total_rating"] += vn.rating
                    length_data[length_cat]["rated_count"] += 1

            # Age rating distribution
            if vn.minage is not None:
                if vn.minage <= 12:
                    age_key = "all_ages"
                elif vn.minage <= 17:
                    age_key = "teen"
                else:
                    age_key = "adult"
                age_data[age_key]["count"] += 1
                if is_jp:
                    age_data[age_key]["jp_count"] += 1
                if vn.rating is not None:
                    age_data[age_key]["total_rating"] += vn.rating
                    age_data[age_key]["rated_count"] += 1

        # Build response
        avg_rating = total_rating / rated_count if rated_count > 0 else 0

        # Convert length data to CategoryStats (includes jp_count)
        length_dist = {}
        for name, data in length_data.items():
            avg = data["total_rating"] / data["rated_count"] if data["rated_count"] > 0 else 0
            length_dist[name] = CategoryStats(count=data["count"], avg_rating=round(avg, 2), jp_count=data["jp_count"])

        # Convert age data to CategoryStats (includes jp_count)
        age_dist = {}
        for name, data in age_data.items():
            avg = data["total_rating"] / data["rated_count"] if data["rated_count"] > 0 else 0
            age_dist[name] = CategoryStats(count=data["count"], avg_rating=round(avg, 2), jp_count=data["jp_count"])

        # Build release year with ratings
        release_year_with_ratings = []
        for year in sorted(year_ratings.keys()):
            data = year_ratings[year]
            avg = data["total_rating"] / data["rated_count"] if data["rated_count"] > 0 else 0
            release_year_with_ratings.append(YearWithRating(
                year=year,
                count=data["count"],
                avg_rating=round(avg, 2),
                jp_count=data["jp_count"],
            ))

        # Sort release year distribution
        release_year_dist = dict(sorted(release_year_dist.items()))

        # Get most recent update time from VNs with characters having this trait
        max_updated = await self.db.scalar(
            select(func.max(VisualNovel.updated_at))
            .join(CharacterVN, CharacterVN.vn_id == VisualNovel.id)
            .join(CharacterTrait, CharacterTrait.character_id == CharacterVN.character_id)
            .where(CharacterTrait.trait_id == trait_id)
        )

        response = TraitStatsResponse(
            trait=TraitDetailResponse(
                id=f"i{trait.id}",
                name=trait.name,
                description=trait.description,
                group_id=trait.group_id,
                group_name=trait.group_name,
                char_count=trait.char_count or len(vns),
                aliases=trait.aliases,
                applicable=trait.applicable if trait.applicable is not None else True,
            ),
            average_rating=round(avg_rating, 2),
            total_votes=total_votes,
            total_vns=len(vns),
            score_distribution=score_dist,
            score_distribution_jp=score_dist_jp,
            release_year_distribution=release_year_dist,
            release_year_with_ratings=release_year_with_ratings,
            length_distribution=length_dist,
            age_rating_distribution=age_dist,
            # When force_refresh, show current time to indicate data was just refreshed
            last_updated=datetime.now() if force_refresh else (max_updated or datetime.now()),
        )

        # Cache for 1 hour
        await self.cache.set(cache_key, response.model_dump(mode='json'), ttl=3600)

        return response

    async def get_tag_vns_by_category(
        self,
        tag_id: int,
        category_type: str,
        category_value: str,
        limit: int = 20,
        offset: int = 0,
    ) -> tuple[list[dict], int]:
        """Get VNs with a specific tag filtered by category.

        Args:
            tag_id: The tag ID
            category_type: One of 'release_year', 'length', 'score', 'age_rating'
            category_value: The category value (e.g., '2017', 'very_long', '8', 'adult')
            limit: Max VNs to return
            offset: Pagination offset

        Returns:
            Tuple of (list of VN dicts, total count)
        """
        # Build base query - only finished VNs to match VNDB search behavior
        base_query = (
            select(
                VisualNovel.id,
                VisualNovel.title,
                VisualNovel.title_jp,
                VisualNovel.title_romaji,
                VisualNovel.image_url,
                VisualNovel.released,
                VisualNovel.rating,
                VisualNovel.votecount,
                VisualNovel.length,
                VisualNovel.length_minutes,
                VisualNovel.minage,
                VisualNovel.olang,
            )
            .join(VNTag, VisualNovel.id == VNTag.vn_id)
            .where(
                VNTag.tag_id == tag_id,
                VNTag.score > 0,  # exclude only 0.0 scores (unapplied/removed tags)
                VNTag.lie == False,  # exclude disputed/incorrect tags
            )
        )

        # Apply category filter
        base_query = self._apply_category_filter(base_query, category_type, category_value)

        # Get total count
        count_query = select(func.count()).select_from(base_query.subquery())
        result = await self.db.execute(count_query)
        total = result.scalar_one_or_none() or 0

        # Get paginated results, ordered by rating descending
        paginated_query = (
            base_query
            .order_by(VisualNovel.rating.desc().nullslast())
            .limit(limit)
            .offset(offset)
        )
        result = await self.db.execute(paginated_query)
        rows = result.all()

        vns = [
            {
                "id": row.id,
                "title": row.title,
                "title_jp": row.title_jp,
                "title_romaji": row.title_romaji,
                "image_url": row.image_url,
                "released": row.released.isoformat() if row.released else None,
                "rating": row.rating,
                "votecount": row.votecount or 0,
                "olang": row.olang,
            }
            for row in rows
        ]

        return vns, total

    async def get_tag_vns_with_full_tags(
        self,
        tag_id: int,
        page: int = 1,
        limit: int = 24,
        sort: str = "rating",
        spoiler_level: int = 0,
        olang: str | None = None,
    ) -> tuple[list[dict], int, int]:
        """Get VNs with a specific tag, including ALL tags for each VN with full data.

        This is used for the tag page novels tab where we need to sort tags by
        IDF-weighted score (requires vn_count, spoiler for each tag).

        Args:
            tag_id: The tag ID
            page: Page number (1-indexed)
            limit: Max VNs to return per page
            sort: Sort field - 'rating', 'votecount', or 'released'

        Returns:
            Tuple of (list of VN dicts with tags, total count, total pages)
        """
        # Build base query for VNs with this tag
        base_query = (
            select(
                VisualNovel.id,
                VisualNovel.title,
                VisualNovel.title_jp,
                VisualNovel.title_romaji,
                VisualNovel.image_url,
                VisualNovel.image_sexual,
                VisualNovel.released,
                VisualNovel.rating,
                VisualNovel.votecount,
                VisualNovel.olang,
            )
            .join(VNTag, VisualNovel.id == VNTag.vn_id)
            .where(
                VNTag.tag_id == tag_id,
                VNTag.score > 0,
                VNTag.lie == False,
                VNTag.spoiler_level <= spoiler_level,
            )
        )

        if olang:
            base_query = base_query.where(VisualNovel.olang == olang)

        # Get total count
        count_query = select(func.count()).select_from(base_query.subquery())
        result = await self.db.execute(count_query)
        total = result.scalar_one_or_none() or 0

        # Apply sorting
        if sort == "votecount":
            order_col = VisualNovel.votecount.desc().nullslast()
        elif sort == "released":
            order_col = VisualNovel.released.desc().nullslast()
        else:
            order_col = VisualNovel.rating.desc().nullslast()

        # Apply pagination
        offset = (page - 1) * limit

        # Get VNs
        vn_query = base_query.order_by(order_col).offset(offset).limit(limit)
        result = await self.db.execute(vn_query)
        vn_rows = result.all()

        # For each VN, get all its tags with full data
        vns = []
        for row in vn_rows:
            # Query tags for this VN (filtered by spoiler level)
            tags_result = await self.db.execute(
                select(Tag, VNTag.score, VNTag.spoiler_level)
                .join(VNTag, Tag.id == VNTag.tag_id)
                .where(
                    VNTag.vn_id == row.id,
                    VNTag.score > 0,
                    VNTag.lie == False,
                    VNTag.spoiler_level <= spoiler_level,
                )
                .order_by(VNTag.score.desc())
            )
            tags = [
                {
                    "id": f"g{tag.id}",
                    "name": tag.name,
                    "category": tag.category,
                    "score": score,
                    "spoiler": tag_spoiler,
                    "vn_count": tag.vn_count or 0,
                }
                for tag, score, tag_spoiler in tags_result
            ]

            vns.append({
                "id": row.id,
                "title": row.title,
                "title_jp": row.title_jp,
                "title_romaji": row.title_romaji,
                "image_url": row.image_url,
                "image_sexual": row.image_sexual,
                "released": row.released.isoformat() if row.released else None,
                "rating": row.rating,
                "votecount": row.votecount or 0,
                "olang": row.olang,
                "tags": tags,
            })

        pages = (total + limit - 1) // limit if total > 0 else 1
        return vns, total, pages

    async def get_trait_vns_with_full_tags(
        self,
        trait_id: int,
        page: int = 1,
        limit: int = 24,
        sort: str = "rating",
        spoiler_level: int = 0,
        olang: str | None = None,
    ) -> tuple[list[dict], int, int]:
        """Get VNs with characters having a specific trait, including ALL tags for each VN.

        This is used for the trait page novels tab where we need to sort tags by
        IDF-weighted score (requires vn_count, spoiler for each tag).

        Args:
            trait_id: The trait ID
            page: Page number (1-indexed)
            limit: Max VNs to return per page
            sort: Sort field - 'rating', 'votecount', or 'released'

        Returns:
            Tuple of (list of VN dicts with tags, total count, total pages)
        """
        # Build base query for VNs with characters having this trait
        base_query = (
            select(
                VisualNovel.id,
                VisualNovel.title,
                VisualNovel.title_jp,
                VisualNovel.title_romaji,
                VisualNovel.image_url,
                VisualNovel.image_sexual,
                VisualNovel.released,
                VisualNovel.rating,
                VisualNovel.votecount,
                VisualNovel.olang,
            )
            .join(CharacterVN, VisualNovel.id == CharacterVN.vn_id)
            .join(CharacterTrait, CharacterVN.character_id == CharacterTrait.character_id)
            .where(
                CharacterTrait.trait_id == trait_id,
                CharacterTrait.spoiler_level <= spoiler_level,
            )
            .distinct()
        )

        if olang:
            base_query = base_query.where(VisualNovel.olang == olang)

        # Get total count
        count_query = select(func.count()).select_from(base_query.subquery())
        result = await self.db.execute(count_query)
        total = result.scalar_one_or_none() or 0

        # Apply sorting
        if sort == "votecount":
            order_col = VisualNovel.votecount.desc().nullslast()
        elif sort == "released":
            order_col = VisualNovel.released.desc().nullslast()
        else:
            order_col = VisualNovel.rating.desc().nullslast()

        # Apply pagination
        offset = (page - 1) * limit

        # Get VNs
        vn_query = base_query.order_by(order_col).offset(offset).limit(limit)
        result = await self.db.execute(vn_query)
        vn_rows = result.all()

        # For each VN, get all its tags with full data
        vns = []
        for row in vn_rows:
            # Query tags for this VN (filtered by spoiler level)
            tags_result = await self.db.execute(
                select(Tag, VNTag.score, VNTag.spoiler_level)
                .join(VNTag, Tag.id == VNTag.tag_id)
                .where(
                    VNTag.vn_id == row.id,
                    VNTag.score > 0,
                    VNTag.lie == False,
                    VNTag.spoiler_level <= spoiler_level,
                )
                .order_by(VNTag.score.desc())
            )
            tags = [
                {
                    "id": f"g{tag.id}",
                    "name": tag.name,
                    "category": tag.category,
                    "score": score,
                    "spoiler": tag_spoiler,
                    "vn_count": tag.vn_count or 0,
                }
                for tag, score, tag_spoiler in tags_result
            ]

            vns.append({
                "id": row.id,
                "title": row.title,
                "title_jp": row.title_jp,
                "title_romaji": row.title_romaji,
                "image_url": row.image_url,
                "image_sexual": row.image_sexual,
                "released": row.released.isoformat() if row.released else None,
                "rating": row.rating,
                "votecount": row.votecount or 0,
                "olang": row.olang,
                "tags": tags,
            })

        pages = (total + limit - 1) // limit if total > 0 else 1
        return vns, total, pages

    async def get_trait_vns_by_category(
        self,
        trait_id: int,
        category_type: str,
        category_value: str,
        limit: int = 20,
        offset: int = 0,
    ) -> tuple[list[dict], int]:
        """Get VNs with characters having a specific trait, filtered by category.

        Args:
            trait_id: The trait ID
            category_type: One of 'release_year', 'length', 'score', 'age_rating'
            category_value: The category value (e.g., '2017', 'very_long', '8', 'adult')
            limit: Max VNs to return
            offset: Pagination offset

        Returns:
            Tuple of (list of VN dicts, total count)
        """
        # Build base query with DISTINCT to avoid counting VNs multiple times
        # Only finished VNs to match VNDB search behavior
        base_query = (
            select(
                VisualNovel.id,
                VisualNovel.title,
                VisualNovel.title_jp,
                VisualNovel.title_romaji,
                VisualNovel.image_url,
                VisualNovel.released,
                VisualNovel.rating,
                VisualNovel.votecount,
                VisualNovel.length,
                VisualNovel.length_minutes,
                VisualNovel.minage,
                VisualNovel.olang,
            )
            .join(CharacterVN, VisualNovel.id == CharacterVN.vn_id)
            .join(CharacterTrait, CharacterVN.character_id == CharacterTrait.character_id)
            .where(
                CharacterTrait.trait_id == trait_id,
            )
            .distinct()
        )

        # Apply category filter
        base_query = self._apply_category_filter(base_query, category_type, category_value)

        # Get total count
        count_query = select(func.count()).select_from(base_query.subquery())
        result = await self.db.execute(count_query)
        total = result.scalar_one_or_none() or 0

        # Get paginated results, ordered by rating descending
        paginated_query = (
            base_query
            .order_by(VisualNovel.rating.desc().nullslast())
            .limit(limit)
            .offset(offset)
        )
        result = await self.db.execute(paginated_query)
        rows = result.all()

        vns = [
            {
                "id": row.id,
                "title": row.title,
                "title_jp": row.title_jp,
                "title_romaji": row.title_romaji,
                "image_url": row.image_url,
                "released": row.released.isoformat() if row.released else None,
                "rating": row.rating,
                "votecount": row.votecount or 0,
                "olang": row.olang,
            }
            for row in rows
        ]

        return vns, total

    def _apply_category_filter(self, query, category_type: str, category_value: str):
        """Apply category-specific filter to a VN query."""
        from sqlalchemy import or_

        if category_type == "release_year":
            year = int(category_value)
            query = query.where(
                func.extract('year', VisualNovel.released) == year
            )
        elif category_type == "length":
            # Map length category to filter conditions
            # VNDB prioritizes length_minutes (vote average) over length (old category)
            # We use COALESCE to prefer length_minutes when available (> 0)
            # Fall back to length only if length_minutes is NULL or 0
            effective_length = func.coalesce(
                case(
                    (VisualNovel.length_minutes > 0, VisualNovel.length_minutes),
                    else_=None
                ),
                VisualNovel.length
            )

            # Length ranges (in minutes):
            # very_short: < 120 (< 2 hours) OR old category 1
            # short: 120-600 (2-10 hours) OR old category 2
            # medium: 600-1800 (10-30 hours) OR old category 3
            # long: 1800-3000 (30-50 hours) OR old category 4
            # very_long: >= 3000 (>= 50 hours) OR old category 5
            # Boundary values count in BOTH adjacent categories
            length_conditions = {
                "very_short": [
                    # Old category 1 (only when no length_minutes)
                    (VisualNovel.length == 1) & ((VisualNovel.length_minutes == None) | (VisualNovel.length_minutes <= 0)),
                    # Minutes < 120 (including boundary at 120)
                    (VisualNovel.length_minutes > 0) & (VisualNovel.length_minutes <= 120),
                ],
                "short": [
                    # Old category 2 (only when no length_minutes)
                    (VisualNovel.length == 2) & ((VisualNovel.length_minutes == None) | (VisualNovel.length_minutes <= 0)),
                    # Minutes 120-600 (boundary 120 from very_short, up to 600 inclusive)
                    (VisualNovel.length_minutes > 0) & (VisualNovel.length_minutes >= 120) & (VisualNovel.length_minutes <= 600),
                ],
                "medium": [
                    # Old category 3 (only when no length_minutes)
                    (VisualNovel.length == 3) & ((VisualNovel.length_minutes == None) | (VisualNovel.length_minutes <= 0)),
                    # Minutes 600-1800 (boundary 600 from short, up to 1800 inclusive)
                    (VisualNovel.length_minutes > 0) & (VisualNovel.length_minutes >= 600) & (VisualNovel.length_minutes <= 1800),
                ],
                "long": [
                    # Old category 4 (only when no length_minutes)
                    (VisualNovel.length == 4) & ((VisualNovel.length_minutes == None) | (VisualNovel.length_minutes <= 0)),
                    # Minutes 1800-3000 (boundary 1800 from medium, up to 3000 inclusive)
                    (VisualNovel.length_minutes > 0) & (VisualNovel.length_minutes >= 1800) & (VisualNovel.length_minutes <= 3000),
                ],
                "very_long": [
                    # Old category 5 (only when no length_minutes)
                    (VisualNovel.length == 5) & ((VisualNovel.length_minutes == None) | (VisualNovel.length_minutes <= 0)),
                    # Minutes >= 3000 (boundary 3000 from long)
                    (VisualNovel.length_minutes > 0) & (VisualNovel.length_minutes >= 3000),
                ],
            }
            conditions = length_conditions.get(category_value, [])
            if conditions:
                query = query.where(or_(*conditions))
        elif category_type == "score":
            score = int(category_value)
            # Score bucket: e.g., score=8 means 8.0 <= rating < 9.0
            query = query.where(
                VisualNovel.rating >= score,
                VisualNovel.rating < score + 1,
            )
        elif category_type == "age_rating":
            # Map age category to minage ranges
            age_conditions = {
                "all_ages": VisualNovel.minage <= 12,
                "teen": (VisualNovel.minage > 12) & (VisualNovel.minage <= 17),
                "adult": VisualNovel.minage > 17,
            }
            condition = age_conditions.get(category_value)
            if condition is not None:
                query = query.where(condition)

        return query

    # ============ Producer Stats Methods ============

    async def get_producer_stats(self, producer_id: str, force_refresh: bool = False) -> ProducerStatsResponse | None:
        """Calculate statistics for ALL VNs by a specific producer/developer.

        Uses the full database to provide accurate aggregate statistics.
        """
        # Normalize producer ID (accept both "p123" and "123" formats)
        if producer_id.startswith("p"):
            producer_id_num = producer_id
        else:
            producer_id_num = f"p{producer_id}"

        # Check cache first
        cache_key = f"producer_stats:v3:{producer_id_num}"  # v3: added last_updated
        if not force_refresh:
            cached = await self.cache.get(cache_key)
            if cached:
                return ProducerStatsResponse(**cached)

        # Get producer info
        result = await self.db.execute(
            select(Producer).where(Producer.id == producer_id_num)
        )
        producer = result.scalar_one_or_none()
        if not producer:
            return None

        # Get ALL VNs by this producer (as developer OR publisher)
        # Path: ReleaseProducer → Release → ReleaseVN → VisualNovel
        # Include all VNs regardless of devstatus to match VNDB counts exactly
        result = await self.db.execute(
            select(
                VisualNovel.id,
                VisualNovel.rating,
                VisualNovel.votecount,
                VisualNovel.released,
                VisualNovel.length,
                VisualNovel.length_minutes,
                VisualNovel.minage,
                VisualNovel.olang,  # Original language for JP counts
            )
            .select_from(VisualNovel)
            .join(ReleaseVN, VisualNovel.id == ReleaseVN.vn_id)
            .join(Release, ReleaseVN.release_id == Release.id)
            .join(ReleaseProducer, Release.id == ReleaseProducer.release_id)
            .where(
                ReleaseProducer.producer_id == producer_id_num,
                or_(ReleaseProducer.developer == True, ReleaseProducer.publisher == True),  # Developer or publisher role
            )
            .distinct()  # Avoid counting VNs multiple times if they have multiple releases
        )
        vns = result.all()

        if not vns:
            # Return empty stats if no VNs found
            # Use global max updated_at as fallback
            global_max_updated = await self.db.scalar(
                select(func.max(VisualNovel.updated_at))
            )
            return ProducerStatsResponse(
                producer=ProducerDetailResponse(
                    id=producer_id_num,
                    name=producer.name,
                    original=producer.original,
                    type=producer.type,
                    lang=producer.lang,
                    description=producer.description,
                    vn_count=0,
                    aliases=None,
                ),
                average_rating=None,
                bayesian_rating=None,
                total_votes=0,
                total_vns=0,
                score_distribution={str(i): 0 for i in range(1, 11)},
                release_year_distribution={},
                release_year_with_ratings=[],
                length_distribution={cat: CategoryStats(count=0, avg_rating=0) for cat in ["very_short", "short", "medium", "long", "very_long"]},
                age_rating_distribution={cat: CategoryStats(count=0, avg_rating=0) for cat in ["all_ages", "teen", "adult"]},
                # When force_refresh, show current time to indicate data was just refreshed
                last_updated=datetime.now() if force_refresh else (global_max_updated or datetime.now()),
            )

        # Initialize distributions
        score_dist = {str(i): 0 for i in range(1, 11)}
        score_dist_jp = {str(i): 0 for i in range(1, 11)}  # JP-original VN counts per score
        release_year_dist: dict[str, int] = {}
        year_ratings: dict[int, dict] = {}
        length_categories = ["very_short", "short", "medium", "long", "very_long"]
        length_data = {cat: {"count": 0, "total_rating": 0, "rated_count": 0, "jp_count": 0} for cat in length_categories}
        age_data = {
            "all_ages": {"count": 0, "total_rating": 0, "rated_count": 0, "jp_count": 0},
            "teen": {"count": 0, "total_rating": 0, "rated_count": 0, "jp_count": 0},
            "adult": {"count": 0, "total_rating": 0, "rated_count": 0, "jp_count": 0},
        }

        total_votes = 0
        total_rating = 0.0
        rated_count = 0

        for vn in vns:
            # Track if this is a Japanese-original VN
            is_jp = vn.olang == 'ja'

            # Score distribution
            if vn.rating is not None:
                score = int(min(10, max(1, math.floor(vn.rating))))
                score_dist[str(score)] += 1
                if is_jp:
                    score_dist_jp[str(score)] += 1
                total_rating += vn.rating
                rated_count += 1

            # Vote count
            if vn.votecount:
                total_votes += vn.votecount

            # Release year distribution - use VN's primary released date
            release_year = vn.released.year if vn.released else None

            if release_year:
                year_str = str(release_year)
                release_year_dist[year_str] = release_year_dist.get(year_str, 0) + 1

                if release_year not in year_ratings:
                    year_ratings[release_year] = {"count": 0, "total_rating": 0, "rated_count": 0, "jp_count": 0}
                year_ratings[release_year]["count"] += 1
                if is_jp:
                    year_ratings[release_year]["jp_count"] += 1
                if vn.rating is not None:
                    year_ratings[release_year]["total_rating"] += vn.rating
                    year_ratings[release_year]["rated_count"] += 1

            # Length distribution (prefer length_minutes when available)
            for length_cat in length_to_categories(vn.length, vn.length_minutes):
                length_data[length_cat]["count"] += 1
                if is_jp:
                    length_data[length_cat]["jp_count"] += 1
                if vn.rating is not None:
                    length_data[length_cat]["total_rating"] += vn.rating
                    length_data[length_cat]["rated_count"] += 1

            # Age rating distribution
            if vn.minage is not None:
                if vn.minage <= 12:
                    age_key = "all_ages"
                elif vn.minage <= 17:
                    age_key = "teen"
                else:
                    age_key = "adult"
                age_data[age_key]["count"] += 1
                if is_jp:
                    age_data[age_key]["jp_count"] += 1
                if vn.rating is not None:
                    age_data[age_key]["total_rating"] += vn.rating
                    age_data[age_key]["rated_count"] += 1

        # Build response
        avg_rating = total_rating / rated_count if rated_count > 0 else None

        # Calculate Bayesian rating (damped mean)
        # Uses global average of ~7.0 and prior weight of 10
        GLOBAL_AVG = 7.0
        PRIOR_WEIGHT = 10
        bayesian_rating = None
        if rated_count > 0:
            bayesian_rating = round(
                (rated_count * avg_rating + PRIOR_WEIGHT * GLOBAL_AVG) / (rated_count + PRIOR_WEIGHT),
                2
            )

        # Convert length data to CategoryStats (includes jp_count)
        length_dist = {}
        for name, data in length_data.items():
            avg = data["total_rating"] / data["rated_count"] if data["rated_count"] > 0 else 0
            length_dist[name] = CategoryStats(count=data["count"], avg_rating=round(avg, 2), jp_count=data["jp_count"])

        # Convert age data to CategoryStats (includes jp_count)
        age_dist = {}
        for name, data in age_data.items():
            avg = data["total_rating"] / data["rated_count"] if data["rated_count"] > 0 else 0
            age_dist[name] = CategoryStats(count=data["count"], avg_rating=round(avg, 2), jp_count=data["jp_count"])

        # Build release year with ratings
        release_year_with_ratings = []
        for year in sorted(year_ratings.keys()):
            data = year_ratings[year]
            avg = data["total_rating"] / data["rated_count"] if data["rated_count"] > 0 else 0
            release_year_with_ratings.append(YearWithRating(
                year=year,
                count=data["count"],
                avg_rating=round(avg, 2),
                jp_count=data["jp_count"],
            ))

        # Sort release year distribution
        release_year_dist = dict(sorted(release_year_dist.items()))

        # Get most recent update time from VNs by this producer (reflects when data actually changed)
        max_updated = await self.db.scalar(
            select(func.max(VisualNovel.updated_at))
            .where(VisualNovel.id.in_([vn.id for vn in vns]))
        )

        response = ProducerStatsResponse(
            producer=ProducerDetailResponse(
                id=producer_id_num,
                name=producer.name,
                original=producer.original,
                type=producer.type,
                lang=producer.lang,
                description=producer.description,
                vn_count=len(vns),
                aliases=None,
            ),
            average_rating=round(avg_rating, 2) if avg_rating else None,
            bayesian_rating=bayesian_rating,
            total_votes=total_votes,
            total_vns=rated_count,
            score_distribution=score_dist,
            score_distribution_jp=score_dist_jp,
            release_year_distribution=release_year_dist,
            release_year_with_ratings=release_year_with_ratings,
            length_distribution=length_dist,
            age_rating_distribution=age_dist,
            # When force_refresh, show current time to indicate data was just refreshed
            last_updated=datetime.now() if force_refresh else (max_updated or datetime.now()),
        )

        # Cache for 1 hour
        await self.cache.set(cache_key, response.model_dump(mode='json'), ttl=3600)

        return response

    async def get_producer_vns(
        self,
        producer_id: str,
        page: int = 1,
        limit: int = 24,
        sort: str = "rating",
    ) -> ProducerVNsResponse | None:
        """Get paginated list of VNs by a producer."""
        # Normalize producer ID
        if not producer_id.startswith("p"):
            producer_id = f"p{producer_id}"

        # Verify producer exists
        result = await self.db.execute(
            select(Producer.id).where(Producer.id == producer_id)
        )
        if not result.scalar_one_or_none():
            return None

        # Base query for VNs by this producer (as developer or publisher)
        query = (
            select(
                VisualNovel.id,
                VisualNovel.title,
                VisualNovel.title_jp,
                VisualNovel.title_romaji,
                VisualNovel.image_url,
                VisualNovel.released,
                VisualNovel.rating,
                VisualNovel.votecount,
                VisualNovel.olang,
            )
            .select_from(VisualNovel)
            .join(ReleaseVN, VisualNovel.id == ReleaseVN.vn_id)
            .join(Release, ReleaseVN.release_id == Release.id)
            .join(ReleaseProducer, Release.id == ReleaseProducer.release_id)
            .where(
                ReleaseProducer.producer_id == producer_id,
                or_(ReleaseProducer.developer == True, ReleaseProducer.publisher == True),
            )
            .distinct()
        )

        # Count query
        count_query = (
            select(func.count(VisualNovel.id.distinct()))
            .select_from(VisualNovel)
            .join(ReleaseVN, VisualNovel.id == ReleaseVN.vn_id)
            .join(Release, ReleaseVN.release_id == Release.id)
            .join(ReleaseProducer, Release.id == ReleaseProducer.release_id)
            .where(
                ReleaseProducer.producer_id == producer_id,
                or_(ReleaseProducer.developer == True, ReleaseProducer.publisher == True),
            )
        )

        # Sorting
        if sort == "released":
            query = query.order_by(VisualNovel.released.desc().nullslast())
        elif sort == "votecount":
            query = query.order_by(VisualNovel.votecount.desc().nullslast())
        else:  # Default: rating
            query = query.order_by(VisualNovel.rating.desc().nullslast())

        # Pagination
        offset = (page - 1) * limit
        query = query.offset(offset).limit(limit)

        # Execute queries
        result = await self.db.execute(query)
        vns = result.all()

        count_result = await self.db.execute(count_query)
        total = count_result.scalar_one_or_none() or 0

        return ProducerVNsResponse(
            vns=[
                VNSummary(
                    id=vn.id,
                    title=vn.title,
                    title_jp=vn.title_jp,
                    title_romaji=vn.title_romaji,
                    image_url=vn.image_url,
                    released=vn.released,
                    rating=vn.rating,
                    votecount=vn.votecount or 0,
                    olang=vn.olang,
                )
                for vn in vns
            ],
            total=total,
            page=page,
            pages=(total + limit - 1) // limit if total > 0 else 1,
        )

    async def get_producer_vns_with_tags(
        self,
        producer_id: str,
        page: int = 1,
        limit: int = 24,
        sort: str = "rating",
        spoiler_level: int = 0,
        olang: str | None = None,
    ) -> tuple[list[dict], int, int] | None:
        """Get paginated list of VNs by a producer, with full tag data for each VN.

        Returns tuple of (vns list, total count, total pages) or None if producer not found.
        """
        # Normalize producer ID
        if not producer_id.startswith("p"):
            producer_id = f"p{producer_id}"

        # Verify producer exists
        result = await self.db.execute(
            select(Producer.id).where(Producer.id == producer_id)
        )
        if not result.scalar_one_or_none():
            return None

        # Base query for VNs by this producer (as developer or publisher)
        base_query = (
            select(
                VisualNovel.id,
                VisualNovel.title,
                VisualNovel.title_jp,
                VisualNovel.title_romaji,
                VisualNovel.image_url,
                VisualNovel.image_sexual,
                VisualNovel.released,
                VisualNovel.rating,
                VisualNovel.votecount,
                VisualNovel.olang,
            )
            .select_from(VisualNovel)
            .join(ReleaseVN, VisualNovel.id == ReleaseVN.vn_id)
            .join(Release, ReleaseVN.release_id == Release.id)
            .join(ReleaseProducer, Release.id == ReleaseProducer.release_id)
            .where(
                ReleaseProducer.producer_id == producer_id,
                or_(ReleaseProducer.developer == True, ReleaseProducer.publisher == True),
            )
            .distinct()
        )

        if olang:
            base_query = base_query.where(VisualNovel.olang == olang)

        # Count query
        count_query = select(func.count()).select_from(base_query.subquery())
        count_result = await self.db.execute(count_query)
        total = count_result.scalar_one_or_none() or 0

        # Apply sorting
        if sort == "released":
            base_query = base_query.order_by(VisualNovel.released.desc().nullslast())
        elif sort == "votecount":
            base_query = base_query.order_by(VisualNovel.votecount.desc().nullslast())
        else:  # Default: rating
            base_query = base_query.order_by(VisualNovel.rating.desc().nullslast())

        # Pagination
        offset = (page - 1) * limit
        vn_query = base_query.offset(offset).limit(limit)

        result = await self.db.execute(vn_query)
        vn_rows = result.all()

        # For each VN, get all its tags with full data
        vns = []
        for row in vn_rows:
            tags_result = await self.db.execute(
                select(Tag, VNTag.score, VNTag.spoiler_level)
                .join(VNTag, Tag.id == VNTag.tag_id)
                .where(
                    VNTag.vn_id == row.id,
                    VNTag.score > 0,
                    VNTag.lie == False,
                    VNTag.spoiler_level <= spoiler_level,
                )
                .order_by(VNTag.score.desc())
            )
            tags = [
                {
                    "id": f"g{tag.id}",
                    "name": tag.name,
                    "category": tag.category,
                    "score": score,
                    "spoiler": tag_spoiler,
                    "vn_count": tag.vn_count or 0,
                }
                for tag, score, tag_spoiler in tags_result
            ]

            vns.append({
                "id": row.id,
                "title": row.title,
                "title_jp": row.title_jp,
                "title_romaji": row.title_romaji,
                "image_url": row.image_url,
                "image_sexual": row.image_sexual,
                "released": row.released.isoformat() if row.released else None,
                "rating": row.rating,
                "votecount": row.votecount or 0,
                "olang": row.olang,
                "tags": tags,
            })

        pages = (total + limit - 1) // limit if total > 0 else 1
        return vns, total, pages

    async def get_similar_producers(
        self,
        producer_id: str,
        limit: int = 10,
    ) -> list[SimilarProducerResponse]:
        """Find similar producers based on staff overlap.

        Two producers are considered similar if they share staff members.
        """
        # Normalize producer ID
        if not producer_id.startswith("p"):
            producer_id = f"p{producer_id}"

        # Get all VN IDs for this producer (as developer or publisher)
        vn_result = await self.db.execute(
            select(VisualNovel.id)
            .select_from(VisualNovel)
            .join(ReleaseVN, VisualNovel.id == ReleaseVN.vn_id)
            .join(Release, ReleaseVN.release_id == Release.id)
            .join(ReleaseProducer, Release.id == ReleaseProducer.release_id)
            .where(
                ReleaseProducer.producer_id == producer_id,
                or_(ReleaseProducer.developer == True, ReleaseProducer.publisher == True),
            )
            .distinct()
        )
        base_vn_ids = set(row[0] for row in vn_result.all())

        if not base_vn_ids:
            return []

        # Get staff IDs working on these VNs
        staff_result = await self.db.execute(
            select(VNStaff.staff_id)
            .where(VNStaff.vn_id.in_(base_vn_ids))
            .distinct()
        )
        base_staff_ids = set(row[0] for row in staff_result.all())

        if not base_staff_ids:
            return []

        # Find other producers whose VNs share staff with the base producer
        # This is a proxy for "similar" - same staff often work with similar developers
        similar_query = (
            select(
                Producer.id,
                Producer.name,
                Producer.original,
                Producer.type,
                func.count(VisualNovel.id.distinct()).label("vn_count"),
                func.count(VNStaff.staff_id.distinct()).label("shared_staff"),
            )
            .select_from(Producer)
            .join(ReleaseProducer, Producer.id == ReleaseProducer.producer_id)
            .join(Release, ReleaseProducer.release_id == Release.id)
            .join(ReleaseVN, Release.id == ReleaseVN.release_id)
            .join(VisualNovel, ReleaseVN.vn_id == VisualNovel.id)
            .join(VNStaff, VisualNovel.id == VNStaff.vn_id)
            .where(
                or_(ReleaseProducer.developer == True, ReleaseProducer.publisher == True),
                Producer.id != producer_id,
                VNStaff.staff_id.in_(base_staff_ids),
            )
            .group_by(Producer.id, Producer.name, Producer.original, Producer.type)
            .order_by(func.count(VNStaff.staff_id.distinct()).desc())
            .limit(limit)
        )

        result = await self.db.execute(similar_query)
        similar = result.all()

        # Calculate similarity as percentage of shared staff
        total_staff = len(base_staff_ids)
        return [
            SimilarProducerResponse(
                id=row.id,
                name=row.name,
                original=row.original,
                type=row.type,
                vn_count=row.vn_count,
                shared_vns=row.shared_staff,  # Using shared staff count
                similarity=round(min(100, (row.shared_staff / total_staff) * 100), 1) if total_staff > 0 else 0,
            )
            for row in similar
        ]

    # ============ Staff Stats Methods ============

    async def get_staff_stats(self, staff_id: str, force_refresh: bool = False) -> StaffStatsResponse | None:
        """Calculate statistics for ALL VNs a staff member worked on.

        Uses the full database to provide accurate aggregate statistics.
        """
        # Normalize staff ID (accept both "s123" and "123" formats)
        if staff_id.startswith("s"):
            staff_id_num = staff_id
        else:
            staff_id_num = f"s{staff_id}"

        # Check cache first
        cache_key = f"staff_stats:v3:{staff_id_num}"  # v3: added last_updated
        if not force_refresh:
            cached = await self.cache.get(cache_key)
            if cached:
                return StaffStatsResponse(**cached)

        # Get staff info
        result = await self.db.execute(
            select(Staff).where(Staff.id == staff_id_num)
        )
        staff = result.scalar_one_or_none()
        if not staff:
            return None

        # Get ALL VNs this staff worked on via VNStaff
        result = await self.db.execute(
            select(
                VisualNovel.id,
                VisualNovel.rating,
                VisualNovel.votecount,
                VisualNovel.released,
                VisualNovel.length,
                VisualNovel.length_minutes,
                VisualNovel.minage,
                VisualNovel.olang,  # Original language for JP counts
                VNStaff.role,
            )
            .select_from(VisualNovel)
            .join(VNStaff, VisualNovel.id == VNStaff.vn_id)
            .where(
                VNStaff.staff_id == staff_id_num,
            )
        )
        vns = result.all()

        if not vns:
            # Return empty stats if no VNs found
            # Use global max updated_at as fallback
            global_max_updated = await self.db.scalar(
                select(func.max(VisualNovel.updated_at))
            )
            return StaffStatsResponse(
                staff=StaffDetailResponse(
                    id=staff_id_num,
                    name=staff.name,
                    original=staff.original,
                    lang=staff.lang,
                    gender=staff.gender,
                    description=staff.description,
                    vn_count=0,
                ),
                average_rating=None,
                bayesian_rating=None,
                total_votes=0,
                total_vns=0,
                role_breakdown={},
                score_distribution={str(i): 0 for i in range(1, 11)},
                release_year_distribution={},
                release_year_with_ratings=[],
                length_distribution={cat: CategoryStats(count=0, avg_rating=0) for cat in ["very_short", "short", "medium", "long", "very_long"]},
                age_rating_distribution={cat: CategoryStats(count=0, avg_rating=0) for cat in ["all_ages", "teen", "adult"]},
                # When force_refresh, show current time to indicate data was just refreshed
                last_updated=datetime.now() if force_refresh else (global_max_updated or datetime.now()),
            )

        # Track unique VNs for stats (one VN may have multiple roles)
        unique_vns: dict[str, any] = {}
        role_breakdown: dict[str, int] = {}

        for vn in vns:
            # Track role breakdown
            role_breakdown[vn.role] = role_breakdown.get(vn.role, 0) + 1
            # Track unique VN data (use first occurrence)
            if vn.id not in unique_vns:
                unique_vns[vn.id] = vn

        vn_list = list(unique_vns.values())

        # Initialize distributions
        score_dist = {str(i): 0 for i in range(1, 11)}
        score_dist_jp = {str(i): 0 for i in range(1, 11)}  # JP-original VN counts per score
        release_year_dist: dict[str, int] = {}
        year_ratings: dict[int, dict] = {}
        length_categories = ["very_short", "short", "medium", "long", "very_long"]
        length_data = {cat: {"count": 0, "total_rating": 0, "rated_count": 0, "jp_count": 0} for cat in length_categories}
        age_data = {
            "all_ages": {"count": 0, "total_rating": 0, "rated_count": 0, "jp_count": 0},
            "teen": {"count": 0, "total_rating": 0, "rated_count": 0, "jp_count": 0},
            "adult": {"count": 0, "total_rating": 0, "rated_count": 0, "jp_count": 0},
        }

        total_votes = 0
        total_rating = 0.0
        rated_count = 0

        for vn in vn_list:
            # Track if this is a Japanese-original VN
            is_jp = vn.olang == 'ja'

            # Score distribution
            if vn.rating is not None:
                score = int(min(10, max(1, math.floor(vn.rating))))
                score_dist[str(score)] += 1
                if is_jp:
                    score_dist_jp[str(score)] += 1
                total_rating += vn.rating
                rated_count += 1

            # Vote count
            if vn.votecount:
                total_votes += vn.votecount

            # Release year distribution - use VN's primary released date
            release_year = vn.released.year if vn.released else None

            if release_year:
                year_str = str(release_year)
                release_year_dist[year_str] = release_year_dist.get(year_str, 0) + 1

                if release_year not in year_ratings:
                    year_ratings[release_year] = {"count": 0, "total_rating": 0, "rated_count": 0, "jp_count": 0}
                year_ratings[release_year]["count"] += 1
                if is_jp:
                    year_ratings[release_year]["jp_count"] += 1
                if vn.rating is not None:
                    year_ratings[release_year]["total_rating"] += vn.rating
                    year_ratings[release_year]["rated_count"] += 1

            # Length distribution (prefer length_minutes when available)
            for length_cat in length_to_categories(vn.length, vn.length_minutes):
                length_data[length_cat]["count"] += 1
                if is_jp:
                    length_data[length_cat]["jp_count"] += 1
                if vn.rating is not None:
                    length_data[length_cat]["total_rating"] += vn.rating
                    length_data[length_cat]["rated_count"] += 1

            # Age rating distribution
            if vn.minage is not None:
                if vn.minage <= 12:
                    age_key = "all_ages"
                elif vn.minage <= 17:
                    age_key = "teen"
                else:
                    age_key = "adult"
                age_data[age_key]["count"] += 1
                if is_jp:
                    age_data[age_key]["jp_count"] += 1
                if vn.rating is not None:
                    age_data[age_key]["total_rating"] += vn.rating
                    age_data[age_key]["rated_count"] += 1

        # Build response
        avg_rating = total_rating / rated_count if rated_count > 0 else None

        # Calculate Bayesian rating (damped mean)
        GLOBAL_AVG = 7.0
        PRIOR_WEIGHT = 10
        bayesian_rating = None
        if rated_count > 0:
            bayesian_rating = round(
                (rated_count * avg_rating + PRIOR_WEIGHT * GLOBAL_AVG) / (rated_count + PRIOR_WEIGHT),
                2
            )

        # Convert length data to CategoryStats (includes jp_count)
        length_dist = {}
        for name, data in length_data.items():
            avg = data["total_rating"] / data["rated_count"] if data["rated_count"] > 0 else 0
            length_dist[name] = CategoryStats(count=data["count"], avg_rating=round(avg, 2), jp_count=data["jp_count"])

        # Convert age data to CategoryStats (includes jp_count)
        age_dist = {}
        for name, data in age_data.items():
            avg = data["total_rating"] / data["rated_count"] if data["rated_count"] > 0 else 0
            age_dist[name] = CategoryStats(count=data["count"], avg_rating=round(avg, 2), jp_count=data["jp_count"])

        # Build release year with ratings
        release_year_with_ratings = []
        for year in sorted(year_ratings.keys()):
            data = year_ratings[year]
            avg = data["total_rating"] / data["rated_count"] if data["rated_count"] > 0 else 0
            release_year_with_ratings.append(YearWithRating(
                year=year,
                count=data["count"],
                avg_rating=round(avg, 2),
                jp_count=data["jp_count"],
            ))

        # Sort release year distribution
        release_year_dist = dict(sorted(release_year_dist.items()))

        # Get most recent update time from VNs this staff worked on (reflects when data actually changed)
        max_updated = await self.db.scalar(
            select(func.max(VisualNovel.updated_at))
            .where(VisualNovel.id.in_(list(unique_vns.keys())))
        )

        response = StaffStatsResponse(
            staff=StaffDetailResponse(
                id=staff_id_num,
                name=staff.name,
                original=staff.original,
                lang=staff.lang,
                gender=staff.gender,
                description=staff.description,
                vn_count=len(vn_list),
            ),
            average_rating=round(avg_rating, 2) if avg_rating else None,
            bayesian_rating=bayesian_rating,
            total_votes=total_votes,
            total_vns=rated_count,
            role_breakdown=role_breakdown,
            score_distribution=score_dist,
            score_distribution_jp=score_dist_jp,
            release_year_distribution=release_year_dist,
            release_year_with_ratings=release_year_with_ratings,
            length_distribution=length_dist,
            age_rating_distribution=age_dist,
            # When force_refresh, show current time to indicate data was just refreshed
            last_updated=datetime.now() if force_refresh else (max_updated or datetime.now()),
        )

        # Cache for 1 hour
        await self.cache.set(cache_key, response.model_dump(mode='json'), ttl=3600)

        return response

    async def get_staff_vns(
        self,
        staff_id: str,
        page: int = 1,
        limit: int = 24,
        sort: str = "rating",
    ) -> StaffVNsResponse | None:
        """Get paginated list of VNs a staff member worked on."""
        # Normalize staff ID
        if not staff_id.startswith("s"):
            staff_id = f"s{staff_id}"

        # Verify staff exists
        result = await self.db.execute(
            select(Staff.id).where(Staff.id == staff_id)
        )
        if not result.scalar_one_or_none():
            return None

        # Base query for VNs this staff worked on
        query = (
            select(
                VisualNovel.id,
                VisualNovel.title,
                VisualNovel.image_url,
                VisualNovel.released,
                VisualNovel.rating,
                VisualNovel.votecount,
                VisualNovel.olang,
            )
            .select_from(VisualNovel)
            .join(VNStaff, VisualNovel.id == VNStaff.vn_id)
            .where(
                VNStaff.staff_id == staff_id,
            )
            .distinct()
        )

        # Count query
        count_query = (
            select(func.count(VisualNovel.id.distinct()))
            .select_from(VisualNovel)
            .join(VNStaff, VisualNovel.id == VNStaff.vn_id)
            .where(
                VNStaff.staff_id == staff_id,
            )
        )

        # Sorting
        if sort == "released":
            query = query.order_by(VisualNovel.released.desc().nullslast())
        elif sort == "votecount":
            query = query.order_by(VisualNovel.votecount.desc().nullslast())
        else:  # Default: rating
            query = query.order_by(VisualNovel.rating.desc().nullslast())

        # Pagination
        offset = (page - 1) * limit
        query = query.offset(offset).limit(limit)

        # Execute queries
        result = await self.db.execute(query)
        vns = result.all()

        count_result = await self.db.execute(count_query)
        total = count_result.scalar_one_or_none() or 0

        return StaffVNsResponse(
            vns=[
                VNSummary(
                    id=vn.id,
                    title=vn.title,
                    image_url=vn.image_url,
                    released=vn.released,
                    rating=vn.rating,
                    votecount=vn.votecount or 0,
                    olang=vn.olang,
                )
                for vn in vns
            ],
            total=total,
            page=page,
            pages=(total + limit - 1) // limit if total > 0 else 1,
        )

    async def get_staff_vns_with_tags(
        self,
        staff_id: str,
        page: int = 1,
        limit: int = 24,
        sort: str = "rating",
        spoiler_level: int = 0,
        olang: str | None = None,
    ) -> tuple[list[dict], int, int] | None:
        """Get paginated list of VNs a staff member worked on, with full tag data for each VN.

        Returns tuple of (vns list, total count, total pages) or None if staff not found.
        """
        # Normalize staff ID
        if not staff_id.startswith("s"):
            staff_id = f"s{staff_id}"

        # Verify staff exists
        result = await self.db.execute(
            select(Staff.id).where(Staff.id == staff_id)
        )
        if not result.scalar_one_or_none():
            return None

        # Base query for VNs this staff worked on
        base_query = (
            select(
                VisualNovel.id,
                VisualNovel.title,
                VisualNovel.title_jp,
                VisualNovel.title_romaji,
                VisualNovel.image_url,
                VisualNovel.image_sexual,
                VisualNovel.released,
                VisualNovel.rating,
                VisualNovel.votecount,
                VisualNovel.olang,
            )
            .select_from(VisualNovel)
            .join(VNStaff, VisualNovel.id == VNStaff.vn_id)
            .where(VNStaff.staff_id == staff_id)
            .distinct()
        )

        if olang:
            base_query = base_query.where(VisualNovel.olang == olang)

        # Count query
        count_query = select(func.count()).select_from(base_query.subquery())
        count_result = await self.db.execute(count_query)
        total = count_result.scalar_one_or_none() or 0

        # Apply sorting
        if sort == "released":
            base_query = base_query.order_by(VisualNovel.released.desc().nullslast())
        elif sort == "votecount":
            base_query = base_query.order_by(VisualNovel.votecount.desc().nullslast())
        else:  # Default: rating
            base_query = base_query.order_by(VisualNovel.rating.desc().nullslast())

        # Pagination
        offset = (page - 1) * limit
        vn_query = base_query.offset(offset).limit(limit)

        result = await self.db.execute(vn_query)
        vn_rows = result.all()

        # For each VN, get all its tags with full data
        vns = []
        for row in vn_rows:
            tags_result = await self.db.execute(
                select(Tag, VNTag.score, VNTag.spoiler_level)
                .join(VNTag, Tag.id == VNTag.tag_id)
                .where(
                    VNTag.vn_id == row.id,
                    VNTag.score > 0,
                    VNTag.lie == False,
                    VNTag.spoiler_level <= spoiler_level,
                )
                .order_by(VNTag.score.desc())
            )
            tags = [
                {
                    "id": f"g{tag.id}",
                    "name": tag.name,
                    "category": tag.category,
                    "score": score,
                    "spoiler": tag_spoiler,
                    "vn_count": tag.vn_count or 0,
                }
                for tag, score, tag_spoiler in tags_result
            ]

            vns.append({
                "id": row.id,
                "title": row.title,
                "title_jp": row.title_jp,
                "title_romaji": row.title_romaji,
                "image_url": row.image_url,
                "image_sexual": row.image_sexual,
                "released": row.released.isoformat() if row.released else None,
                "rating": row.rating,
                "votecount": row.votecount or 0,
                "olang": row.olang,
                "tags": tags,
            })

        pages = (total + limit - 1) // limit if total > 0 else 1
        return vns, total, pages

    # ============ Seiyuu Stats Methods ============

    async def get_seiyuu_stats(self, staff_id: str, force_refresh: bool = False) -> SeiyuuStatsResponse | None:
        """Calculate statistics for ALL VNs a voice actor appeared in.

        Uses the full database to provide accurate aggregate statistics.
        """
        # Normalize staff ID (seiyuu use staff IDs)
        if staff_id.startswith("s"):
            staff_id_num = staff_id
        else:
            staff_id_num = f"s{staff_id}"

        # Check cache first
        cache_key = f"seiyuu_stats:v3:{staff_id_num}"  # v3: added last_updated
        if not force_refresh:
            cached = await self.cache.get(cache_key)
            if cached:
                return SeiyuuStatsResponse(**cached)

        # Get staff info
        result = await self.db.execute(
            select(Staff).where(Staff.id == staff_id_num)
        )
        staff = result.scalar_one_or_none()
        if not staff:
            return None

        # Get ALL VNs this seiyuu voiced in via VNSeiyuu
        result = await self.db.execute(
            select(
                VisualNovel.id,
                VisualNovel.rating,
                VisualNovel.votecount,
                VisualNovel.released,
                VisualNovel.length,
                VisualNovel.length_minutes,
                VisualNovel.minage,
                VisualNovel.olang,  # Original language for JP counts
                VNSeiyuu.character_id,
            )
            .select_from(VisualNovel)
            .join(VNSeiyuu, VisualNovel.id == VNSeiyuu.vn_id)
            .where(
                VNSeiyuu.staff_id == staff_id_num,
            )
        )
        vns = result.all()

        if not vns:
            # Return empty stats if no VNs found
            # Use global max updated_at as fallback
            global_max_updated = await self.db.scalar(
                select(func.max(VisualNovel.updated_at))
            )
            return SeiyuuStatsResponse(
                staff=StaffDetailResponse(
                    id=staff_id_num,
                    name=staff.name,
                    original=staff.original,
                    lang=staff.lang,
                    gender=staff.gender,
                    description=staff.description,
                    vn_count=0,
                ),
                average_rating=None,
                bayesian_rating=None,
                total_votes=0,
                total_vns=0,
                character_count=0,
                score_distribution={str(i): 0 for i in range(1, 11)},
                release_year_distribution={},
                release_year_with_ratings=[],
                length_distribution={cat: CategoryStats(count=0, avg_rating=0) for cat in ["very_short", "short", "medium", "long", "very_long"]},
                age_rating_distribution={cat: CategoryStats(count=0, avg_rating=0) for cat in ["all_ages", "teen", "adult"]},
                # When force_refresh, show current time to indicate data was just refreshed
                last_updated=datetime.now() if force_refresh else (global_max_updated or datetime.now()),
            )

        # Track unique VNs and characters
        unique_vns: dict[str, any] = {}
        unique_characters: set[str] = set()

        for vn in vns:
            unique_characters.add(vn.character_id)
            if vn.id not in unique_vns:
                unique_vns[vn.id] = vn

        vn_list = list(unique_vns.values())
        character_count = len(unique_characters)

        # Initialize distributions
        score_dist = {str(i): 0 for i in range(1, 11)}
        score_dist_jp = {str(i): 0 for i in range(1, 11)}  # JP-original VN counts per score
        release_year_dist: dict[str, int] = {}
        year_ratings: dict[int, dict] = {}
        length_categories = ["very_short", "short", "medium", "long", "very_long"]
        length_data = {cat: {"count": 0, "total_rating": 0, "rated_count": 0, "jp_count": 0} for cat in length_categories}
        age_data = {
            "all_ages": {"count": 0, "total_rating": 0, "rated_count": 0, "jp_count": 0},
            "teen": {"count": 0, "total_rating": 0, "rated_count": 0, "jp_count": 0},
            "adult": {"count": 0, "total_rating": 0, "rated_count": 0, "jp_count": 0},
        }

        total_votes = 0
        total_rating = 0.0
        rated_count = 0

        for vn in vn_list:
            # Track if this is a Japanese-original VN
            is_jp = vn.olang == 'ja'

            # Score distribution
            if vn.rating is not None:
                score = int(min(10, max(1, math.floor(vn.rating))))
                score_dist[str(score)] += 1
                if is_jp:
                    score_dist_jp[str(score)] += 1
                total_rating += vn.rating
                rated_count += 1

            # Vote count
            if vn.votecount:
                total_votes += vn.votecount

            # Release year distribution - use VN's primary released date
            release_year = vn.released.year if vn.released else None

            if release_year:
                year_str = str(release_year)
                release_year_dist[year_str] = release_year_dist.get(year_str, 0) + 1

                if release_year not in year_ratings:
                    year_ratings[release_year] = {"count": 0, "total_rating": 0, "rated_count": 0, "jp_count": 0}
                year_ratings[release_year]["count"] += 1
                if is_jp:
                    year_ratings[release_year]["jp_count"] += 1
                if vn.rating is not None:
                    year_ratings[release_year]["total_rating"] += vn.rating
                    year_ratings[release_year]["rated_count"] += 1

            # Length distribution (prefer length_minutes when available)
            for length_cat in length_to_categories(vn.length, vn.length_minutes):
                length_data[length_cat]["count"] += 1
                if is_jp:
                    length_data[length_cat]["jp_count"] += 1
                if vn.rating is not None:
                    length_data[length_cat]["total_rating"] += vn.rating
                    length_data[length_cat]["rated_count"] += 1

            # Age rating distribution
            if vn.minage is not None:
                if vn.minage <= 12:
                    age_key = "all_ages"
                elif vn.minage <= 17:
                    age_key = "teen"
                else:
                    age_key = "adult"
                age_data[age_key]["count"] += 1
                if is_jp:
                    age_data[age_key]["jp_count"] += 1
                if vn.rating is not None:
                    age_data[age_key]["total_rating"] += vn.rating
                    age_data[age_key]["rated_count"] += 1

        # Build response
        avg_rating = total_rating / rated_count if rated_count > 0 else None

        # Calculate Bayesian rating (damped mean)
        GLOBAL_AVG = 7.0
        PRIOR_WEIGHT = 10
        bayesian_rating = None
        if rated_count > 0:
            bayesian_rating = round(
                (rated_count * avg_rating + PRIOR_WEIGHT * GLOBAL_AVG) / (rated_count + PRIOR_WEIGHT),
                2
            )

        # Convert length data to CategoryStats (includes jp_count)
        length_dist = {}
        for name, data in length_data.items():
            avg = data["total_rating"] / data["rated_count"] if data["rated_count"] > 0 else 0
            length_dist[name] = CategoryStats(count=data["count"], avg_rating=round(avg, 2), jp_count=data["jp_count"])

        # Convert age data to CategoryStats (includes jp_count)
        age_dist = {}
        for name, data in age_data.items():
            avg = data["total_rating"] / data["rated_count"] if data["rated_count"] > 0 else 0
            age_dist[name] = CategoryStats(count=data["count"], avg_rating=round(avg, 2), jp_count=data["jp_count"])

        # Build release year with ratings
        release_year_with_ratings = []
        for year in sorted(year_ratings.keys()):
            data = year_ratings[year]
            avg = data["total_rating"] / data["rated_count"] if data["rated_count"] > 0 else 0
            release_year_with_ratings.append(YearWithRating(
                year=year,
                count=data["count"],
                avg_rating=round(avg, 2),
                jp_count=data["jp_count"],
            ))

        # Sort release year distribution
        release_year_dist = dict(sorted(release_year_dist.items()))

        # Get most recent update time from VNs this seiyuu appeared in (reflects when data actually changed)
        max_updated = await self.db.scalar(
            select(func.max(VisualNovel.updated_at))
            .where(VisualNovel.id.in_(list(unique_vns.keys())))
        )

        response = SeiyuuStatsResponse(
            staff=StaffDetailResponse(
                id=staff_id_num,
                name=staff.name,
                original=staff.original,
                lang=staff.lang,
                gender=staff.gender,
                description=staff.description,
                vn_count=len(vn_list),
            ),
            average_rating=round(avg_rating, 2) if avg_rating else None,
            bayesian_rating=bayesian_rating,
            total_votes=total_votes,
            total_vns=rated_count,
            character_count=character_count,
            score_distribution=score_dist,
            score_distribution_jp=score_dist_jp,
            release_year_distribution=release_year_dist,
            release_year_with_ratings=release_year_with_ratings,
            length_distribution=length_dist,
            age_rating_distribution=age_dist,
            # When force_refresh, show current time to indicate data was just refreshed
            last_updated=datetime.now() if force_refresh else (max_updated or datetime.now()),
        )

        # Cache for 1 hour
        await self.cache.set(cache_key, response.model_dump(mode='json'), ttl=3600)

        return response

    async def get_seiyuu_vns(
        self,
        staff_id: str,
        page: int = 1,
        limit: int = 24,
        sort: str = "rating",
    ) -> SeiyuuVNsResponse | None:
        """Get paginated list of VNs a voice actor appeared in."""
        # Normalize staff ID
        if not staff_id.startswith("s"):
            staff_id = f"s{staff_id}"

        # Verify staff exists
        result = await self.db.execute(
            select(Staff.id).where(Staff.id == staff_id)
        )
        if not result.scalar_one_or_none():
            return None

        # Base query for VNs this seiyuu voiced in
        query = (
            select(
                VisualNovel.id,
                VisualNovel.title,
                VisualNovel.image_url,
                VisualNovel.released,
                VisualNovel.rating,
                VisualNovel.votecount,
                VisualNovel.olang,
            )
            .select_from(VisualNovel)
            .join(VNSeiyuu, VisualNovel.id == VNSeiyuu.vn_id)
            .where(
                VNSeiyuu.staff_id == staff_id,
            )
            .distinct()
        )

        # Count query
        count_query = (
            select(func.count(VisualNovel.id.distinct()))
            .select_from(VisualNovel)
            .join(VNSeiyuu, VisualNovel.id == VNSeiyuu.vn_id)
            .where(
                VNSeiyuu.staff_id == staff_id,
            )
        )

        # Sorting
        if sort == "released":
            query = query.order_by(VisualNovel.released.desc().nullslast())
        elif sort == "votecount":
            query = query.order_by(VisualNovel.votecount.desc().nullslast())
        else:  # Default: rating
            query = query.order_by(VisualNovel.rating.desc().nullslast())

        # Pagination
        offset = (page - 1) * limit
        query = query.offset(offset).limit(limit)

        # Execute queries
        result = await self.db.execute(query)
        vns = result.all()

        count_result = await self.db.execute(count_query)
        total = count_result.scalar_one_or_none() or 0

        return SeiyuuVNsResponse(
            vns=[
                VNSummary(
                    id=vn.id,
                    title=vn.title,
                    image_url=vn.image_url,
                    released=vn.released,
                    rating=vn.rating,
                    votecount=vn.votecount or 0,
                    olang=vn.olang,
                )
                for vn in vns
            ],
            total=total,
            page=page,
            pages=(total + limit - 1) // limit if total > 0 else 1,
        )

    async def get_seiyuu_vns_with_tags(
        self,
        staff_id: str,
        page: int = 1,
        limit: int = 24,
        sort: str = "rating",
        spoiler_level: int = 0,
        olang: str | None = None,
    ) -> tuple[list[dict], int, int] | None:
        """Get paginated list of VNs a voice actor appeared in, with full tag data for each VN.

        Returns tuple of (vns list, total count, total pages) or None if seiyuu not found.
        """
        # Normalize staff ID
        if not staff_id.startswith("s"):
            staff_id = f"s{staff_id}"

        # Verify staff exists
        result = await self.db.execute(
            select(Staff.id).where(Staff.id == staff_id)
        )
        if not result.scalar_one_or_none():
            return None

        # Base query for VNs this seiyuu voiced in
        base_query = (
            select(
                VisualNovel.id,
                VisualNovel.title,
                VisualNovel.title_jp,
                VisualNovel.title_romaji,
                VisualNovel.image_url,
                VisualNovel.image_sexual,
                VisualNovel.released,
                VisualNovel.rating,
                VisualNovel.votecount,
                VisualNovel.olang,
            )
            .select_from(VisualNovel)
            .join(VNSeiyuu, VisualNovel.id == VNSeiyuu.vn_id)
            .where(VNSeiyuu.staff_id == staff_id)
            .distinct()
        )

        if olang:
            base_query = base_query.where(VisualNovel.olang == olang)

        # Count query
        count_query = select(func.count()).select_from(base_query.subquery())
        count_result = await self.db.execute(count_query)
        total = count_result.scalar_one_or_none() or 0

        # Apply sorting
        if sort == "released":
            base_query = base_query.order_by(VisualNovel.released.desc().nullslast())
        elif sort == "votecount":
            base_query = base_query.order_by(VisualNovel.votecount.desc().nullslast())
        else:  # Default: rating
            base_query = base_query.order_by(VisualNovel.rating.desc().nullslast())

        # Pagination
        offset = (page - 1) * limit
        vn_query = base_query.offset(offset).limit(limit)

        result = await self.db.execute(vn_query)
        vn_rows = result.all()

        # For each VN, get all its tags with full data
        vns = []
        for row in vn_rows:
            tags_result = await self.db.execute(
                select(Tag, VNTag.score, VNTag.spoiler_level)
                .join(VNTag, Tag.id == VNTag.tag_id)
                .where(
                    VNTag.vn_id == row.id,
                    VNTag.score > 0,
                    VNTag.lie == False,
                    VNTag.spoiler_level <= spoiler_level,
                )
                .order_by(VNTag.score.desc())
            )
            tags = [
                {
                    "id": f"g{tag.id}",
                    "name": tag.name,
                    "category": tag.category,
                    "score": score,
                    "spoiler": tag_spoiler,
                    "vn_count": tag.vn_count or 0,
                }
                for tag, score, tag_spoiler in tags_result
            ]

            vns.append({
                "id": row.id,
                "title": row.title,
                "title_jp": row.title_jp,
                "title_romaji": row.title_romaji,
                "image_url": row.image_url,
                "image_sexual": row.image_sexual,
                "released": row.released.isoformat() if row.released else None,
                "rating": row.rating,
                "votecount": row.votecount or 0,
                "olang": row.olang,
                "tags": tags,
            })

        pages = (total + limit - 1) // limit if total > 0 else 1
        return vns, total, pages

    async def get_seiyuu_characters(
        self,
        staff_id: str,
        page: int = 1,
        limit: int = 24,
        sort: str = "name",
    ) -> SeiyuuCharactersResponse | None:
        """Get paginated list of characters voiced by a seiyuu."""
        if not staff_id.startswith("s"):
            staff_id = f"s{staff_id}"

        # Verify staff exists
        result = await self.db.execute(
            select(Staff.id).where(Staff.id == staff_id)
        )
        if not result.scalar_one_or_none():
            return None

        # Aggregate per character: vn_count and first note
        char_agg = (
            select(
                VNSeiyuu.character_id,
                func.count(distinct(VNSeiyuu.vn_id)).label("vn_count"),
                func.min(VNSeiyuu.note).label("first_note"),
            )
            .where(VNSeiyuu.staff_id == staff_id)
            .group_by(VNSeiyuu.character_id)
            .subquery()
        )

        # Join with Character table
        base_query = (
            select(
                Character.id,
                Character.name,
                Character.original,
                Character.image_url,
                Character.image_sexual,
                Character.sex,
                char_agg.c.vn_count,
                char_agg.c.first_note,
            )
            .join(char_agg, Character.id == char_agg.c.character_id)
        )

        # Count total
        count_result = await self.db.execute(
            select(func.count()).select_from(base_query.subquery())
        )
        total = count_result.scalar_one_or_none() or 0

        # Sorting
        if sort == "vn_count":
            base_query = base_query.order_by(char_agg.c.vn_count.desc(), Character.name.asc())
        else:
            base_query = base_query.order_by(Character.name.asc())

        # Pagination
        offset = (page - 1) * limit
        base_query = base_query.offset(offset).limit(limit)

        result = await self.db.execute(base_query)
        char_rows = result.all()

        # Batch-fetch VNs for all characters on this page
        char_ids = [row.id for row in char_rows]
        vns_by_char: dict[str, list[SeiyuuCharacterVNInfo]] = {cid: [] for cid in char_ids}

        if char_ids:
            vn_result = await self.db.execute(
                select(
                    VNSeiyuu.character_id,
                    VisualNovel.id,
                    VisualNovel.title,
                    VisualNovel.title_jp,
                    VisualNovel.title_romaji,
                )
                .join(VisualNovel, VNSeiyuu.vn_id == VisualNovel.id)
                .where(
                    VNSeiyuu.staff_id == staff_id,
                    VNSeiyuu.character_id.in_(char_ids),
                )
                .order_by(VisualNovel.rating.desc().nullslast())
            )
            for row in vn_result.all():
                vns_by_char[row[0]].append(
                    SeiyuuCharacterVNInfo(
                        id=row[1],
                        title=row[2],
                        title_jp=row[3],
                        title_romaji=row[4],
                    )
                )

        characters = [
            SeiyuuVoicedCharacter(
                id=row.id,
                name=row.name,
                original=row.original,
                image_url=row.image_url,
                image_sexual=row.image_sexual,
                sex=row.sex,
                vn_count=row.vn_count,
                vns=vns_by_char.get(row.id, []),
                note=row.first_note,
            )
            for row in char_rows
        ]

        pages = (total + limit - 1) // limit if total > 0 else 1
        return SeiyuuCharactersResponse(
            characters=characters,
            total=total,
            page=page,
            pages=pages,
        )

    # ============ Similar Tags/Traits using NPMI ============

    # Constants for NPMI similarity
    SIMILAR_MIN_CO_OCCURRENCE = 5   # Minimum shared items to consider
    SIMILAR_MIN_ITEM_COUNT = 10     # Minimum global count to avoid noise
    SIMILAR_CACHE_TTL = 3600        # 1 hour cache

    async def get_similar_tags(self, tag_id: int, limit: int = 30) -> list[dict]:
        """
        Get similar tags using NPMI (Normalized Pointwise Mutual Information).

        NPMI measures how much more likely two tags co-occur than expected by chance,
        normalized to [-1, 1]. This naturally penalizes overly common tags like "ADV".

        Formula:
            PMI = log2(P(A,B) / (P(A) * P(B)))
            NPMI = PMI / -log2(P(A,B))
            confidence = min(1.0, sqrt(co_occurrence / 10))
            final_score = NPMI * confidence
        """
        cache_key = f"similar_tags:{tag_id}"
        cached = await self.cache.get(cache_key)
        if cached:
            return cached[:limit]

        # Get total VN count
        total_vns_result = await self.db.execute(
            select(func.count(VisualNovel.id))
        )
        total_vns = total_vns_result.scalar_one() or 1

        # Get base tag info
        base_result = await self.db.execute(
            select(Tag.name, Tag.vn_count).where(Tag.id == tag_id)
        )
        base = base_result.first()
        if not base or not base.vn_count:
            return []

        base_count = base.vn_count

        # Query co-occurrences via self-join on vn_tags
        query = text("""
            SELECT t.id, t.name, t.category, t.vn_count,
                   COUNT(DISTINCT vt1.vn_id) as shared_count
            FROM vn_tags vt1
            JOIN vn_tags vt2 ON vt1.vn_id = vt2.vn_id
            JOIN tags t ON vt2.tag_id = t.id
            WHERE vt1.tag_id = :base_id
              AND vt2.tag_id != :base_id
              AND vt1.spoiler_level = 0 AND vt2.spoiler_level = 0
              AND vt1.score > 0 AND vt2.score > 0
              AND (vt1.lie IS NULL OR vt1.lie = false)
              AND (vt2.lie IS NULL OR vt2.lie = false)
              AND t.vn_count >= :min_count
            GROUP BY t.id, t.name, t.category, t.vn_count
            HAVING COUNT(DISTINCT vt1.vn_id) >= :min_cooccur
            LIMIT 200
        """)

        rows_result = await self.db.execute(query, {
            "base_id": tag_id,
            "min_count": self.SIMILAR_MIN_ITEM_COUNT,
            "min_cooccur": self.SIMILAR_MIN_CO_OCCURRENCE,
        })
        rows = rows_result.fetchall()

        # Calculate NPMI for each co-occurring tag
        results = []
        for row in rows:
            other_id, name, category, other_count, shared = row

            if other_count is None or other_count < self.SIMILAR_MIN_ITEM_COUNT:
                continue

            # Calculate probabilities
            p_a = base_count / total_vns
            p_b = other_count / total_vns
            p_ab = shared / total_vns

            # Avoid log(0)
            if p_ab <= 0 or p_a <= 0 or p_b <= 0:
                continue

            # PMI = log2(P(A,B) / (P(A) * P(B)))
            pmi = math.log2(p_ab / (p_a * p_b))

            # NPMI = PMI / -log2(P(A,B)) - normalizes to [-1, 1]
            npmi = pmi / -math.log2(p_ab)

            # Confidence dampening for rare co-occurrences
            confidence = min(1.0, math.sqrt(shared / 10))

            # Final score
            final_score = npmi * confidence

            results.append({
                "id": f"g{other_id}",
                "name": name,
                "category": category,
                "vn_count": other_count,
                "shared_vn_count": shared,
                "similarity": round(max(0, final_score), 4),
            })

        # Sort by final similarity score
        results.sort(key=lambda x: x["similarity"], reverse=True)

        # Cache top 50 results
        await self.cache.set(cache_key, results[:50], ttl=self.SIMILAR_CACHE_TTL)

        return results[:limit]

    async def get_similar_traits(self, trait_id: int, limit: int = 30) -> list[dict]:
        """
        Get similar traits using NPMI (Normalized Pointwise Mutual Information).

        Similar to tags but operates on characters instead of VNs.
        Naturally penalizes overly common traits like "Pale" or "Slim".
        """
        cache_key = f"similar_traits:{trait_id}"
        cached = await self.cache.get(cache_key)
        if cached:
            return cached[:limit]

        # Get total character count
        total_chars_result = await self.db.execute(
            select(func.count(Character.id))
        )
        total_chars = total_chars_result.scalar_one() or 1

        # Get base trait info
        base_result = await self.db.execute(
            select(Trait.name, Trait.char_count).where(Trait.id == trait_id)
        )
        base = base_result.first()
        if not base or not base.char_count:
            return []

        base_count = base.char_count

        # Query co-occurrences via self-join on character_traits
        query = text("""
            SELECT t.id, t.name, t.group_id, t.group_name, t.char_count,
                   COUNT(DISTINCT ct1.character_id) as shared_count
            FROM character_traits ct1
            JOIN character_traits ct2 ON ct1.character_id = ct2.character_id
            JOIN traits t ON ct2.trait_id = t.id
            WHERE ct1.trait_id = :base_id
              AND ct2.trait_id != :base_id
              AND ct1.spoiler_level = 0 AND ct2.spoiler_level = 0
              AND t.char_count >= :min_count
            GROUP BY t.id, t.name, t.group_id, t.group_name, t.char_count
            HAVING COUNT(DISTINCT ct1.character_id) >= :min_cooccur
            LIMIT 200
        """)

        rows_result = await self.db.execute(query, {
            "base_id": trait_id,
            "min_count": self.SIMILAR_MIN_ITEM_COUNT,
            "min_cooccur": self.SIMILAR_MIN_CO_OCCURRENCE,
        })
        rows = rows_result.fetchall()

        # Calculate NPMI for each co-occurring trait
        results = []
        for row in rows:
            other_id, name, group_id, group_name, other_count, shared = row

            if other_count is None or other_count < self.SIMILAR_MIN_ITEM_COUNT:
                continue

            # Calculate probabilities
            p_a = base_count / total_chars
            p_b = other_count / total_chars
            p_ab = shared / total_chars

            if p_ab <= 0 or p_a <= 0 or p_b <= 0:
                continue

            pmi = math.log2(p_ab / (p_a * p_b))
            npmi = pmi / -math.log2(p_ab)
            confidence = min(1.0, math.sqrt(shared / 10))
            final_score = npmi * confidence

            results.append({
                "id": f"i{other_id}",
                "name": name,
                "group_id": group_id,
                "group_name": group_name,
                "char_count": other_count,
                "shared_char_count": shared,
                "similarity": round(max(0, final_score), 4),
            })

        results.sort(key=lambda x: x["similarity"], reverse=True)
        await self.cache.set(cache_key, results[:50], ttl=self.SIMILAR_CACHE_TTL)

        return results[:limit]

    # ============ Cross-Type Relationships using NPMI ============

    async def get_tag_traits(self, tag_id: int, limit: int = 30) -> list[dict]:
        """Get traits related to a tag using NPMI.

        Finds traits that appear on characters in VNs with this tag,
        ranked by how much more likely they co-occur than expected by chance.
        """
        cache_key = f"tag_traits:{tag_id}"
        cached = await self.cache.get(cache_key)
        if cached:
            return cached[:limit]

        # Get base tag info
        base_result = await self.db.execute(
            select(Tag.name, Tag.vn_count).where(Tag.id == tag_id)
        )
        base = base_result.first()
        if not base or not base.vn_count:
            return []

        # Total characters in system
        total_chars_result = await self.db.execute(select(func.count(Character.id)))
        total_chars = total_chars_result.scalar_one() or 1

        # Query: Find traits that appear on characters in VNs with this tag
        # Path: vn_tags → character_vn → character_traits
        query = text("""
            SELECT t.id, t.name, t.group_id, t.group_name, t.char_count,
                   COUNT(DISTINCT ct.character_id) as shared_count
            FROM vn_tags vt
            JOIN character_vn cv ON vt.vn_id = cv.vn_id
            JOIN character_traits ct ON cv.character_id = ct.character_id
            JOIN traits t ON ct.trait_id = t.id
            WHERE vt.tag_id = :tag_id
              AND vt.spoiler_level = 0 AND vt.score > 0
              AND (vt.lie IS NULL OR vt.lie = false)
              AND ct.spoiler_level = 0
              AND t.char_count >= :min_count
            GROUP BY t.id, t.name, t.group_id, t.group_name, t.char_count
            HAVING COUNT(DISTINCT ct.character_id) >= :min_cooccur
            LIMIT 200
        """)

        rows_result = await self.db.execute(query, {
            "tag_id": tag_id,
            "min_count": self.SIMILAR_MIN_ITEM_COUNT,
            "min_cooccur": self.SIMILAR_MIN_CO_OCCURRENCE,
        })
        rows = rows_result.fetchall()

        # Get count of characters in VNs with this tag (for NPMI)
        chars_in_tag_result = await self.db.execute(text("""
            SELECT COUNT(DISTINCT cv.character_id)
            FROM vn_tags vt
            JOIN character_vn cv ON vt.vn_id = cv.vn_id
            WHERE vt.tag_id = :tag_id AND vt.spoiler_level = 0 AND vt.score > 0
              AND (vt.lie IS NULL OR vt.lie = false)
        """), {"tag_id": tag_id})
        chars_in_tag = chars_in_tag_result.scalar_one() or 1

        # Calculate NPMI
        results = []
        for row in rows:
            trait_id, name, group_id, group_name, trait_char_count, shared = row

            if trait_char_count is None or trait_char_count < self.SIMILAR_MIN_ITEM_COUNT:
                continue

            # P(tag) = proportion of chars in VNs with this tag
            p_a = chars_in_tag / total_chars
            # P(trait) = proportion of chars with this trait
            p_b = trait_char_count / total_chars
            # P(tag,trait) = proportion with both
            p_ab = shared / total_chars

            if p_ab <= 0 or p_a <= 0 or p_b <= 0:
                continue

            pmi = math.log2(p_ab / (p_a * p_b))
            npmi = pmi / -math.log2(p_ab)
            confidence = min(1.0, math.sqrt(shared / 10))
            final_score = npmi * confidence

            results.append({
                "id": f"i{trait_id}",
                "name": name,
                "group_id": group_id,
                "group_name": group_name,
                "character_count": trait_char_count,
                "shared_char_count": shared,
                "frequency": round(max(0, final_score), 4),
            })

        results.sort(key=lambda x: x["frequency"], reverse=True)
        await self.cache.set(cache_key, results[:50], ttl=self.SIMILAR_CACHE_TTL)

        return results[:limit]

    async def get_trait_tags(self, trait_id: int, limit: int = 30) -> list[dict]:
        """Get tags related to a trait using NPMI.

        Finds tags on VNs that have characters with this trait,
        ranked by how much more likely they co-occur than expected by chance.
        """
        cache_key = f"trait_tags:{trait_id}"
        cached = await self.cache.get(cache_key)
        if cached:
            return cached[:limit]

        # Get base trait info
        base_result = await self.db.execute(
            select(Trait.name, Trait.char_count).where(Trait.id == trait_id)
        )
        base = base_result.first()
        if not base or not base.char_count:
            return []

        # Total VNs in system
        total_vns_result = await self.db.execute(select(func.count(VisualNovel.id)))
        total_vns = total_vns_result.scalar_one() or 1

        # Query: Find tags on VNs that have characters with this trait
        # Path: character_traits → character_vn → vn_tags
        query = text("""
            SELECT t.id, t.name, t.category, t.vn_count,
                   COUNT(DISTINCT vt.vn_id) as shared_count
            FROM character_traits ct
            JOIN character_vn cv ON ct.character_id = cv.character_id
            JOIN vn_tags vt ON cv.vn_id = vt.vn_id
            JOIN tags t ON vt.tag_id = t.id
            WHERE ct.trait_id = :trait_id
              AND ct.spoiler_level = 0
              AND vt.spoiler_level = 0 AND vt.score > 0
              AND (vt.lie IS NULL OR vt.lie = false)
              AND t.vn_count >= :min_count
            GROUP BY t.id, t.name, t.category, t.vn_count
            HAVING COUNT(DISTINCT vt.vn_id) >= :min_cooccur
            LIMIT 200
        """)

        rows_result = await self.db.execute(query, {
            "trait_id": trait_id,
            "min_count": self.SIMILAR_MIN_ITEM_COUNT,
            "min_cooccur": self.SIMILAR_MIN_CO_OCCURRENCE,
        })
        rows = rows_result.fetchall()

        # Get count of VNs with characters having this trait (for NPMI)
        vns_with_trait_result = await self.db.execute(text("""
            SELECT COUNT(DISTINCT cv.vn_id)
            FROM character_traits ct
            JOIN character_vn cv ON ct.character_id = cv.character_id
            WHERE ct.trait_id = :trait_id AND ct.spoiler_level = 0
        """), {"trait_id": trait_id})
        vns_with_trait = vns_with_trait_result.scalar_one() or 1

        # Calculate NPMI
        results = []
        for row in rows:
            tag_id, name, category, tag_vn_count, shared = row

            if tag_vn_count is None or tag_vn_count < self.SIMILAR_MIN_ITEM_COUNT:
                continue

            p_a = vns_with_trait / total_vns
            p_b = tag_vn_count / total_vns
            p_ab = shared / total_vns

            if p_ab <= 0 or p_a <= 0 or p_b <= 0:
                continue

            pmi = math.log2(p_ab / (p_a * p_b))
            npmi = pmi / -math.log2(p_ab)
            confidence = min(1.0, math.sqrt(shared / 10))
            final_score = npmi * confidence

            results.append({
                "id": f"g{tag_id}",
                "name": name,
                "category": category,
                "vn_count": tag_vn_count,
                "shared_vn_count": shared,
                "frequency": round(max(0, final_score), 4),
            })

        results.sort(key=lambda x: x["frequency"], reverse=True)
        await self.cache.set(cache_key, results[:50], ttl=self.SIMILAR_CACHE_TTL)

        return results[:limit]