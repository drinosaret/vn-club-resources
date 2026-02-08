"""
Simplified Hybrid Recommendation Engine

Combines three signals with weighted scoring:
- Tag cosine similarity (weight: 1.5) - content-based
- Collaborative filtering (weight: 1.0) - "users who liked X also liked Y"
- Staff/developer match (weight: 0.5) - bonus for preferred creators

Inspired by VisualNovelRecommendationEngine's approach:
- Sparse matrix operations for efficiency
- Higher weight on content (tags) to prevent popularity bias
- Pre-computation for fast queries
"""

import logging
import math
from dataclasses import dataclass, field
from typing import Optional
import numpy as np
from scipy.sparse import csr_matrix
from sklearn.metrics.pairwise import cosine_similarity
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

import random
from app.db.models import (
    VisualNovel, VNTag, Tag, GlobalVote, VNStaff, Staff,
    VNSimilarity, VNCoOccurrence, VNSeiyuu, CharacterVN, CharacterTrait, Trait,
    ReleaseVN, ReleaseProducer, Producer
)

logger = logging.getLogger(__name__)


# Tags to ignore (presentation-related, not content)
IGNORE_TAGS = {
    32,    # ADV (Adventure game format)
    2040,  # NVL (Novel format)
    2461,  # Engine: Ren'Py
    1434,  # Engine: KiriKiri
    1431,  # Engine: VNDS
    43,    # Sexual Content (too common to be useful)
}

# Weights for combining signals - balanced for personalization
TAG_WEIGHT = 2.5                 # Content similarity from tag matching
VN_SIMILARITY_WEIGHT = 2.0       # "Similar Games" - direct VN-to-VN similarity from VNSimilarity table
USERS_ALSO_READ_WEIGHT = 2.0     # "Users Also Read" - co-occurrence patterns from VNCoOccurrence table
DEVELOPER_WEIGHT = 0.6           # Developer/publisher match
STAFF_WEIGHT = 0.5               # Staff (writers, artists) match
SEIYUU_WEIGHT = 0.3              # Voice actor preference signal
TRAIT_WEIGHT = 0.5               # Character trait preference signal
QUALITY_WEIGHT = 1.5             # Quality signal using raw average rating (not Bayesian)

# Maximum theoretical weighted score (for normalization to 0-100)
MAX_WEIGHTED_SCORE = (
    TAG_WEIGHT + VN_SIMILARITY_WEIGHT + USERS_ALSO_READ_WEIGHT +
    DEVELOPER_WEIGHT + STAFF_WEIGHT + SEIYUU_WEIGHT + TRAIT_WEIGHT +
    QUALITY_WEIGHT
)  # = 10.4

# Elite tier multipliers for user's top-ranked tags
# These boost the influence of a user's strongest preferences
ELITE_TIER_1_MULTIPLIER = 4.0  # Top 5 tags - core preferences
ELITE_TIER_2_MULTIPLIER = 2.5  # Tags 6-10 - strong preferences
ELITE_TIER_3_MULTIPLIER = 1.6  # Tags 11-20 - notable preferences
BEST_MATCH_WEIGHT = 0.4        # Weight for best-match component in tag scoring


@dataclass
class RecommendationResult:
    """A single recommendation with explanation."""
    vn_id: str
    title: str
    score: float
    match_reasons: list[str]
    image_url: Optional[str] = None
    image_sexual: Optional[float] = None  # For NSFW blur (0=safe, 1=suggestive, 2=explicit)
    rating: Optional[float] = None
    title_jp: Optional[str] = None       # Original Japanese title (kanji/kana)
    title_romaji: Optional[str] = None   # Romanized title
    tag_score: float = 0.0
    similar_games_score: float = 0.0      # From VNSimilarity table
    users_also_read_score: float = 0.0    # From VNCoOccurrence table
    developer_score: float = 0.0
    staff_score: float = 0.0
    seiyuu_score: float = 0.0
    trait_score: float = 0.0
    quality_score: float = 0.0  # Based on raw average rating (not Bayesian)
    normalized_score: int = 0  # 0-100 scale for display

    # Detailed breakdown for popup (populated when generating recommendations)
    matched_tags: list[dict] = field(default_factory=list)
    # [{"id": 123, "name": "Mystery", "user_weight": 1.8, "vn_score": 2.1}]

    matched_staff: list[dict] = field(default_factory=list)
    # [{"id": "s123", "name": "Jun Maeda", "user_avg_rating": 8.5}]

    matched_developers: list[dict] = field(default_factory=list)
    # [{"name": "Key", "user_avg_rating": 8.3}]

    matched_seiyuu: list[dict] = field(default_factory=list)
    # [{"id": "s123", "name": "Sawashiro Miyuki", "weighted_score": 85, "count": 5}]

    matched_traits: list[dict] = field(default_factory=list)
    # [{"id": 123, "name": "Kuudere", "weighted_score": 75, "count": 8}]

    contributing_vns: list[dict] = field(default_factory=list)
    # [{"id": "v4", "title": "Clannad", "similarity": 0.85}]

    similar_games_details: list[dict] = field(default_factory=list)
    # [{"source_vn_id": "v4", "source_title": "Clannad", "similarity": 0.85}]

    users_also_read_details: list[dict] = field(default_factory=list)
    # [{"source_vn_id": "v4", "source_title": "Clannad", "co_score": 0.76, "user_count": 145}]


class HybridRecommender:
    """
    Simplified hybrid recommendation engine.

    Uses three weighted signals:
    1. Tag cosine similarity (1.5x) - finds VNs with similar tags
    2. Collaborative filtering (1.0x) - finds VNs liked by similar users
    3. Staff match bonus (0.5x) - boosts VNs by preferred developers/writers
    """

    def __init__(self, db: AsyncSession):
        self.db = db
        self._tag_vectors: Optional[dict] = None  # vn_id -> sparse vector
        self._vn_tags_map: Optional[dict] = None  # vn_id -> {tag_id: score}
        self._all_tag_ids: Optional[list] = None  # ordered list of all tag IDs
        self._tag_idf_cache: Optional[dict] = None  # tag_id -> IDF weight

    def _calculate_bayesian_score(
        self,
        user_avg: float,
        count: int,
        user_overall_avg: float,
        prior_weight: int = 3,
    ) -> float:
        """
        Calculate Bayesian (damped mean) score for tag/staff ranking.

        Formula: (count × user_avg + prior_weight × user_overall_avg) / (count + prior_weight)

        This pulls tags with few VNs toward the user's overall average, while tags with
        many VNs approach the user's raw average. A lower prior_weight gives more
        influence to the user's own ratings.

        Args:
            user_avg: User's average rating for VNs with this tag (0-10 scale)
            count: Number of user's VNs with this tag
            user_overall_avg: User's overall average rating (0-10 scale)
            prior_weight: Smoothing factor (default 3)

        Returns:
            Bayesian score (0-10 scale)
        """
        if count == 0:
            return user_overall_avg
        return (count * user_avg + prior_weight * user_overall_avg) / (count + prior_weight)

    def _calculate_weighted_score(
        self,
        bayesian_score: float,
        count: int,
        min_confidence_count: int = 5,  # Match stats page calculation
    ) -> float:
        """
        Calculate confidence-weighted score for tag/staff ranking.

        Formula: bayesian_score * min(1, count / min_confidence_count)

        This penalizes tags with few instances (unreliable data) while leaving
        tags with sufficient instances at their Bayesian score.

        Args:
            bayesian_score: The Bayesian damped mean score
            count: Number of user's VNs with this tag
            min_confidence_count: Count at which confidence reaches 100%

        Returns:
            Weighted score (higher = better preference signal)
        """
        confidence = min(1.0, count / min_confidence_count)
        return bayesian_score * confidence

    async def _load_tag_idf_weights(self) -> dict[int, float]:
        """
        Load IDF (Inverse Document Frequency) weights for all tags.

        IDF = log(total_vns / tag_vn_count)

        Rare tags (low vn_count) get higher IDF, making them more influential.
        Common tags (high vn_count) get lower IDF, dampening their impact.

        This ensures niche tags like "Nakige" (368 VNs, IDF~2.2) contribute more
        than generic tags like "Romance" (17k VNs, IDF~0.5) to the recommendation score.
        """
        if self._tag_idf_cache is not None:
            return self._tag_idf_cache

        try:
            # Get total VN count for IDF calculation
            total_result = await self.db.execute(
                select(func.count(VisualNovel.id))
            )
            total_vns = total_result.scalar_one_or_none() or 1

            # Load vn_count for all tags from Tag table
            result = await self.db.execute(
                select(Tag.id, Tag.vn_count)
                .where(Tag.vn_count > 0)
            )
            rows = result.all()  # Consume results immediately

            self._tag_idf_cache = {}
            for row in rows:
                # IDF formula: log(N / df) where df = document frequency (vn_count)
                idf = math.log(total_vns / (row.vn_count + 1))
                # Floor at 0.1 to prevent near-zero weights for very common tags
                self._tag_idf_cache[row.id] = max(0.1, idf)

            logger.debug(f"Loaded IDF weights for {len(self._tag_idf_cache)} tags (total_vns={total_vns})")
        except Exception as e:
            logger.warning(f"Failed to load IDF weights: {e}, using default IDF=1.0")
            self._tag_idf_cache = {}

        return self._tag_idf_cache

    async def recommend(
        self,
        user_votes: list[dict],  # [{vn_id, score}, ...]
        exclude_vn_ids: set[str],
        limit: int = 50,
        min_rating: Optional[float] = None,
        min_length: Optional[int] = None,
        max_length: Optional[int] = None,
        include_tags: Optional[list[int]] = None,
        exclude_tags: Optional[list[int]] = None,
        include_traits: Optional[list[int]] = None,
        exclude_traits: Optional[list[int]] = None,
        skip_details: bool = False,
        japanese_only: bool = True,
        spoiler_level: int = 0,
    ) -> list[RecommendationResult]:
        """
        Get personalized recommendations for a user.

        Args:
            user_votes: User's VN ratings [{vn_id: "v123", score: 85}, ...]
            exclude_vn_ids: VN IDs to exclude (already played)
            limit: Max recommendations to return
            min_rating: Minimum global rating filter
            min_length: Minimum length (1-5) filter
            max_length: Maximum length (1-5) filter
            include_tags: Only include VNs with these tags
            exclude_tags: Exclude VNs with these tags
            include_traits: Only include VNs with characters having these traits
            exclude_traits: Exclude VNs with characters having these traits
            japanese_only: Only include Japanese original language VNs (default True)

        Returns:
            List of RecommendationResult sorted by score
        """
        if not user_votes:
            return []

        # Build user profile from their ratings
        user_profile = await self._build_user_profile(user_votes, spoiler_level=spoiler_level)
        high_rated_vns = user_profile.get("high_rated_vns", [])
        vn_scores = user_profile.get("vn_scores", {})  # VN ID -> score (0-10)
        logger.info(f"User has {len(high_rated_vns)} highly-rated VNs (score >= 85)")

        # Get candidate VNs using similarity-based selection
        candidates = await self._get_candidates(
            exclude_vn_ids=exclude_vn_ids,
            min_rating=min_rating,
            min_length=min_length,
            max_length=max_length,
            include_tags=include_tags,
            exclude_tags=exclude_tags,
            include_traits=include_traits,
            exclude_traits=exclude_traits,
            limit=limit * 5,  # Get more candidates for scoring
            high_rated_vns=high_rated_vns,
            elite_tag_ids=user_profile.get("elite_tag_ids"),
            japanese_only=japanese_only,
            spoiler_level=spoiler_level,
        )

        if not candidates:
            return []

        # Batch load tags for all candidates (optimization)
        candidate_ids = [vn["id"] for vn in candidates]
        all_tags = await self._batch_get_vn_tags(candidate_ids, spoiler_level=spoiler_level)
        all_developers = await self._batch_get_vn_developers(candidate_ids)
        all_staff = await self._batch_get_vn_staff(candidate_ids)
        all_seiyuu = await self._batch_get_vn_seiyuu(candidate_ids)
        all_traits = await self._batch_get_vn_traits(candidate_ids, spoiler_level=spoiler_level)

        # Load tag names for generating specific match reasons
        user_tag_ids = set(user_profile["tag_weights"].keys())
        all_vn_tag_ids = set()
        for vn_tags in all_tags.values():
            all_vn_tag_ids.update(vn_tags.keys())
        relevant_tag_ids = user_tag_ids.intersection(all_vn_tag_ids)
        tag_names = await self._batch_get_tag_names(relevant_tag_ids)

        # Load staff names for matching staff (only for details)
        staff_names = {}
        seiyuu_names = {}
        trait_names = {}
        if not skip_details:
            user_staff_ids = set(user_profile.get("preferred_staff", {}).keys())
            all_vn_staff_ids = set()
            for staff_list in all_staff.values():
                all_vn_staff_ids.update(staff_list)
            relevant_staff_ids = user_staff_ids.intersection(all_vn_staff_ids)
            staff_names = await self._batch_get_staff_names(relevant_staff_ids)

            # Load seiyuu names (seiyuu are also staff)
            user_seiyuu_ids = set(user_profile.get("preferred_seiyuu", {}).keys())
            all_vn_seiyuu_ids = set()
            for seiyuu_list in all_seiyuu.values():
                all_vn_seiyuu_ids.update(seiyuu_list)
            relevant_seiyuu_ids = user_seiyuu_ids.intersection(all_vn_seiyuu_ids)
            seiyuu_names = await self._batch_get_staff_names(relevant_seiyuu_ids)

            # Load trait names
            user_trait_ids = set(user_profile.get("preferred_traits", {}).keys())
            all_vn_trait_ids = set()
            for trait_dict in all_traits.values():
                all_vn_trait_ids.update(trait_dict.keys())
            relevant_trait_ids = user_trait_ids.intersection(all_vn_trait_ids)
            trait_names = await self._batch_get_trait_names(relevant_trait_ids)

        # Load titles for user's highly-rated VNs (only for details)
        user_vn_titles = {}
        if not skip_details:
            user_vn_titles = await self._batch_get_vn_titles(high_rated_vns[:20])

        # Batch load Similar Games scores (from VNSimilarity table - same as VN page)
        similar_games_data = await self._batch_get_similar_games_scores(
            candidate_ids=candidate_ids,
            high_rated_vns=high_rated_vns,
            vn_scores=vn_scores,
        )

        # Batch load Users Also Read scores (from VNCoOccurrence table - same as VN page)
        users_also_read_data = await self._batch_get_users_also_read_scores(
            candidate_ids=candidate_ids,
            high_rated_vns=high_rated_vns,
            vn_scores=vn_scores,
        )

        # Score each candidate using cached data
        scored = []
        for vn in candidates:
            vn_id = vn["id"]
            vn_tags = all_tags.get(vn_id, {})
            vn_developers = all_developers.get(vn_id, [])
            vn_staff = all_staff.get(vn_id, [])
            vn_seiyuu = all_seiyuu.get(vn_id, [])
            vn_traits = all_traits.get(vn_id, {})

            # Compute scores using cached data
            tag_score = self._compute_tag_score_fast(user_profile, vn_tags)
            developer_score = self._compute_developer_score_fast(user_profile, vn_developers)
            staff_score = self._compute_staff_score_fast(user_profile, vn_staff)
            seiyuu_score = self._compute_seiyuu_score_fast(user_profile, vn_seiyuu)
            trait_score = self._compute_trait_score_fast(user_profile, vn_traits)

            # Compute quality score from average rating (not Bayesian)
            # Use average_rating if available, fall back to Bayesian rating, default to 7.0
            vn_avg_rating = vn.get("average_rating") or vn.get("rating") or 7.0
            # Map 5.0-10.0 rating to 0.0-1.0 quality score
            # Below 5.0 = 0, 10.0 = 1.0
            quality_score = max(0, (vn_avg_rating - 5.0) / 5.0)

            # Get VN page similarity scores (Similar Games + Users Also Read)
            similar_games_score, similar_games_details_raw = similar_games_data.get(vn_id, (0.0, []))
            users_also_read_score, users_also_read_details_raw = users_also_read_data.get(vn_id, (0.0, []))

            # Enrich details with VN titles (for display in frontend)
            similar_games_details = [
                {**d, "source_title": user_vn_titles.get(d["source_vn_id"], d["source_vn_id"])}
                for d in similar_games_details_raw
            ]
            users_also_read_details = [
                {**d, "source_title": user_vn_titles.get(d["source_vn_id"], d["source_vn_id"])}
                for d in users_also_read_details_raw
            ]

            # Weighted combination (Similar Games and Users Also Read are the dominant signals)
            total_score = (
                tag_score * TAG_WEIGHT +
                similar_games_score * VN_SIMILARITY_WEIGHT +
                users_also_read_score * USERS_ALSO_READ_WEIGHT +
                developer_score * DEVELOPER_WEIGHT +
                staff_score * STAFF_WEIGHT +
                seiyuu_score * SEIYUU_WEIGHT +
                trait_score * TRAIT_WEIGHT +
                quality_score * QUALITY_WEIGHT
            )

            # Calculate normalized score (0-100) before popularity penalty
            overall_normalized_score = min(100, round((total_score / MAX_WEIGHTED_SCORE) * 100))
            if overall_normalized_score == 0 and total_score > 0:
                logger.warning(f"VN {vn_id}: normalized_score=0 but total_score={total_score:.4f}, tag={tag_score:.3f}, sim={similar_games_score:.3f}, cooc={users_also_read_score:.3f}")

            # Note: Popularity penalty disabled - letting quality scores speak for themselves

            # Build simple match reasons (details computed later for top results only)
            reasons = []
            user_tags = user_profile["tag_weights"]

            # Always use fast path for scoring loop - details added after MMR
            # Count matching tags for basic reason
            matching_tag_count = sum(1 for tag_id in vn_tags if tag_id in user_tags and user_tags[tag_id] > 0)
            if tag_score > 0.2 and matching_tag_count > 0:
                # Get top 3 tag names for reason
                top_tags = sorted(
                    [(tag_id, user_tags.get(tag_id, 0) * vn_tags.get(tag_id, 0))
                     for tag_id in vn_tags if tag_id in user_tags],
                    key=lambda x: x[1], reverse=True
                )[:3]
                top_tag_names = [tag_names.get(tid, f"Tag {tid}") for tid, _ in top_tags]
                reasons.append(", ".join(top_tag_names))

            if similar_games_score > 0.3:
                reasons.append("Similar to your favorites")

            if users_also_read_score > 0.3:
                reasons.append("Fans also enjoyed")

            if staff_score > 0.2:
                # Quick check for developer/staff match
                user_devs = user_profile.get("preferred_developers", {})
                vn_devs_set = set(vn_developers)
                matching_devs = list(vn_devs_set.intersection(user_devs.keys()))[:2]
                if matching_devs:
                    reasons.append("By " + ", ".join(matching_devs))

            # Initialize empty detail containers (populated after MMR if needed)
            matched_tags_detail = []
            matched_developers_detail = []
            matched_staff_detail = []
            matched_seiyuu_detail = []
            matched_traits_detail = []
            contributing_vns_detail = []

            scored.append(RecommendationResult(
                vn_id=vn_id,
                title=vn["title"],
                score=total_score,
                normalized_score=overall_normalized_score,
                match_reasons=reasons if reasons else ["Matches your preferences"],
                image_url=vn.get("image_url"),
                image_sexual=vn.get("image_sexual"),
                rating=vn.get("average_rating") or vn.get("rating"),  # Prefer average
                title_jp=vn.get("title_jp"),
                title_romaji=vn.get("title_romaji"),
                tag_score=tag_score,
                similar_games_score=similar_games_score,
                users_also_read_score=users_also_read_score,
                developer_score=developer_score,
                staff_score=staff_score,
                seiyuu_score=seiyuu_score,
                trait_score=trait_score,
                quality_score=quality_score,
                matched_tags=matched_tags_detail,
                matched_staff=matched_staff_detail,
                matched_developers=matched_developers_detail,
                matched_seiyuu=matched_seiyuu_detail,
                matched_traits=matched_traits_detail,
                contributing_vns=contributing_vns_detail,
                similar_games_details=similar_games_details,
                users_also_read_details=users_also_read_details,
            ))

        # Sort by score
        scored.sort(key=lambda x: x.score, reverse=True)

        # Limit candidates for diversity reranking (performance optimization)
        # Only need 2x limit since MMR will select from top candidates anyway
        candidates_for_mmr = scored[:limit * 2] if len(scored) > limit * 2 else scored
        logger.info(f"MMR input: {len(candidates_for_mmr)} candidates (from {len(scored)} total)")

        # Apply diversity reranking to prevent clustering
        diverse_results = await self._apply_diversity_reranking(
            recommendations=candidates_for_mmr,
            all_tags=all_tags,
            limit=limit,
            diversity_weight=0.3,
        )

        # Compute details only for final results (performance optimization)
        # This is done AFTER MMR so we only compute for ~100 results, not 400+
        if not skip_details:
            logger.info(f"Computing details for {len(diverse_results)} final results")
            user_overall_avg = user_profile.get("user_overall_avg", 7.0)
            tag_weighted_scores = user_profile.get("tag_weighted_scores", {})
            tag_absolute_scores = user_profile.get("tag_absolute_scores", {})
            tag_counts = user_profile.get("tag_counts", {})
            tag_idf = user_profile.get("tag_idf", {})
            max_tag_weighted = user_profile.get("max_tag_weighted", 1.0)
            user_devs = user_profile.get("preferred_developers", {})
            user_staff_prefs = user_profile.get("preferred_staff", {})
            dev_weighted_scores = user_profile.get("dev_weighted_scores", {})
            dev_counts = user_profile.get("dev_counts", {})
            staff_weighted_scores = user_profile.get("staff_weighted_scores", {})
            staff_counts = user_profile.get("staff_counts", {})
            max_dev_weighted = user_profile.get("max_dev_weighted", 1.0)
            max_staff_weighted = user_profile.get("max_staff_weighted", 1.0)
            user_seiyuu_prefs = user_profile.get("preferred_seiyuu", {})
            seiyuu_weighted_scores = user_profile.get("seiyuu_weighted_scores", {})
            seiyuu_counts = user_profile.get("seiyuu_counts", {})
            max_seiyuu_weighted = user_profile.get("max_seiyuu_weighted", 1.0)
            user_trait_prefs = user_profile.get("preferred_traits", {})
            trait_weighted_scores = user_profile.get("trait_weighted_scores", {})
            trait_counts = user_profile.get("trait_counts", {})
            max_trait_weighted = user_profile.get("max_trait_weighted", 1.0)
            user_tags = user_profile["tag_weights"]

            for result in diverse_results:
                vn_id = result.vn_id
                vn_tags = all_tags.get(vn_id, {})
                vn_developers = all_developers.get(vn_id, [])
                vn_staff = all_staff.get(vn_id, [])
                vn_seiyuu = all_seiyuu.get(vn_id, [])
                vn_traits = all_traits.get(vn_id, {})

                # === Detailed matched tags ===
                matched_tags_detail = []
                for tag_id, vn_tag_score in vn_tags.items():
                    if tag_id in user_tags and user_tags[tag_id] > 0:
                        tag_absolute = tag_absolute_scores.get(tag_id, 0)
                        idf = tag_idf.get(tag_id, 1.0)
                        contribution = user_tags[tag_id] * vn_tag_score
                        weighted_score_raw = tag_weighted_scores.get(tag_id, user_overall_avg)
                        normalized_score = (weighted_score_raw / max_tag_weighted) * 100 if max_tag_weighted > 0 else 0
                        matched_tags_detail.append({
                            "id": tag_id,
                            "name": tag_names.get(tag_id, f"Tag {tag_id}"),
                            "user_weight": round(tag_absolute, 2),
                            "vn_score": round(vn_tag_score, 2),
                            "contribution": round(contribution, 2),
                            "idf": round(idf, 2),
                            "weighted_score": round(normalized_score, 1),
                            "count": tag_counts.get(tag_id, 0),
                        })
                matched_tags_detail.sort(key=lambda x: x["weighted_score"], reverse=True)
                result.matched_tags = matched_tags_detail[:10]

                # === Detailed matched developers ===
                matched_developers_detail = []
                vn_devs_set = set(vn_developers)
                for dev_name in vn_devs_set.intersection(user_devs.keys()):
                    dev_delta = user_devs.get(dev_name, 0)
                    weighted_score_raw = dev_weighted_scores.get(dev_name, user_overall_avg)
                    normalized_score = (weighted_score_raw / max_dev_weighted) * 100 if max_dev_weighted > 0 else 0
                    matched_developers_detail.append({
                        "name": dev_name,
                        "user_avg_rating": round(dev_delta + user_overall_avg, 1),
                        "weight": round(dev_delta, 2),
                        "weighted_score": round(normalized_score, 1),
                        "count": dev_counts.get(dev_name, 0),
                    })
                matched_developers_detail.sort(key=lambda x: x["weighted_score"], reverse=True)
                result.matched_developers = matched_developers_detail

                # === Detailed matched staff ===
                matched_staff_detail = []
                vn_staff_set = set(vn_staff)
                for staff_id in vn_staff_set.intersection(user_staff_prefs.keys()):
                    staff_name = staff_names.get(staff_id, "")
                    if staff_name:
                        staff_delta = user_staff_prefs.get(staff_id, 0)
                        weighted_score_raw = staff_weighted_scores.get(staff_id, user_overall_avg)
                        normalized_score = (weighted_score_raw / max_staff_weighted) * 100 if max_staff_weighted > 0 else 0
                        matched_staff_detail.append({
                            "id": staff_id,
                            "name": staff_name,
                            "user_avg_rating": round(staff_delta + user_overall_avg, 1),
                            "weight": round(staff_delta, 2),
                            "weighted_score": round(normalized_score, 1),
                            "count": staff_counts.get(staff_id, 0),
                        })
                matched_staff_detail.sort(key=lambda x: x["weighted_score"], reverse=True)
                result.matched_staff = matched_staff_detail

                # === Detailed matched seiyuu ===
                matched_seiyuu_detail = []
                vn_seiyuu_set = set(vn_seiyuu)
                for seiyuu_id in vn_seiyuu_set.intersection(user_seiyuu_prefs.keys()):
                    seiyuu_name = seiyuu_names.get(seiyuu_id, "")
                    if seiyuu_name:
                        weighted_score_raw = seiyuu_weighted_scores.get(seiyuu_id, user_overall_avg)
                        normalized_score = (weighted_score_raw / max_seiyuu_weighted) * 100 if max_seiyuu_weighted > 0 else 0
                        matched_seiyuu_detail.append({
                            "id": seiyuu_id,
                            "name": seiyuu_name,
                            "weighted_score": round(normalized_score, 1),
                            "count": seiyuu_counts.get(seiyuu_id, 0),
                        })
                matched_seiyuu_detail.sort(key=lambda x: x["weighted_score"], reverse=True)
                result.matched_seiyuu = matched_seiyuu_detail[:5]

                # === Detailed matched traits ===
                matched_traits_detail = []
                for trait_id, trait_weight in vn_traits.items():
                    if trait_id in user_trait_prefs:
                        trait_name = trait_names.get(trait_id, "")
                        if trait_name:
                            weighted_score_raw = trait_weighted_scores.get(trait_id, user_overall_avg)
                            normalized_score = (weighted_score_raw / max_trait_weighted) * 100 if max_trait_weighted > 0 else 0
                            matched_traits_detail.append({
                                "id": trait_id,
                                "name": trait_name,
                                "weighted_score": round(normalized_score, 1),
                                "count": trait_counts.get(trait_id, 0),
                            })
                matched_traits_detail.sort(key=lambda x: x["weighted_score"], reverse=True)
                result.matched_traits = matched_traits_detail[:5]

                # === Contributing VNs (computes similarity for each) ===
                contributing_vns_detail = []
                for user_vn_id in high_rated_vns[:20]:
                    user_vn_tags = all_tags.get(user_vn_id, {})
                    if not user_vn_tags:
                        continue
                    sim = self._compute_tag_similarity(user_vn_tags, vn_tags)
                    if sim > 0.3:
                        contributing_vns_detail.append({
                            "id": user_vn_id,
                            "title": user_vn_titles.get(user_vn_id, user_vn_id),
                            "similarity": round(sim * 100, 0),
                        })
                contributing_vns_detail.sort(key=lambda x: x["similarity"], reverse=True)
                result.contributing_vns = contributing_vns_detail[:5]

        return diverse_results

    async def get_details_for_vn(
        self,
        user_votes: list[dict],
        vn_id: str,
        spoiler_level: int = 0,
    ) -> Optional[RecommendationResult]:
        """
        Compute detailed recommendation breakdown for a single VN.

        This is optimized for fetching details on-demand after the initial
        recommendations list is displayed (without details).
        """
        if not user_votes:
            return None

        # Build user profile
        user_profile = await self._build_user_profile(user_votes, spoiler_level=spoiler_level)
        high_rated_vns = user_profile.get("high_rated_vns", [])
        vn_scores = user_profile.get("vn_scores", {})

        # Get VN info
        vn_result = await self.db.execute(
            select(VisualNovel)
            .where(VisualNovel.id == vn_id)
        )
        vn_row = vn_result.scalars().first()
        if not vn_row:
            return None

        # Load data for just this VN
        vn_tags = (await self._batch_get_vn_tags([vn_id])).get(vn_id, {})
        vn_developers = (await self._batch_get_vn_developers([vn_id])).get(vn_id, [])
        vn_staff = (await self._batch_get_vn_staff([vn_id])).get(vn_id, [])
        vn_seiyuu = (await self._batch_get_vn_seiyuu([vn_id])).get(vn_id, [])
        vn_traits = (await self._batch_get_vn_traits([vn_id])).get(vn_id, {})

        # Load tag names
        user_tag_ids = set(user_profile["tag_weights"].keys())
        vn_tag_ids = set(vn_tags.keys())
        relevant_tag_ids = user_tag_ids.intersection(vn_tag_ids)
        tag_names = await self._batch_get_tag_names(relevant_tag_ids)

        # Load staff names
        user_staff_ids = set(user_profile.get("preferred_staff", {}).keys())
        vn_staff_set = set(vn_staff)
        relevant_staff_ids = user_staff_ids.intersection(vn_staff_set)
        staff_names = await self._batch_get_staff_names(relevant_staff_ids)

        # Load seiyuu names (seiyuu are also staff)
        user_seiyuu_ids = set(user_profile.get("preferred_seiyuu", {}).keys())
        vn_seiyuu_set = set(vn_seiyuu)
        relevant_seiyuu_ids = user_seiyuu_ids.intersection(vn_seiyuu_set)
        seiyuu_names = await self._batch_get_staff_names(relevant_seiyuu_ids)

        # Load trait names
        user_trait_ids = set(user_profile.get("preferred_traits", {}).keys())
        vn_trait_ids = set(vn_traits.keys())
        relevant_trait_ids = user_trait_ids.intersection(vn_trait_ids)
        trait_names = await self._batch_get_trait_names(relevant_trait_ids)

        # Load user's VN titles for "because you liked" section
        user_vn_titles = await self._batch_get_vn_titles(high_rated_vns[:20])

        # Load tags for user's VNs (for similarity computation)
        all_tags = await self._batch_get_vn_tags(high_rated_vns[:20])
        all_tags[vn_id] = vn_tags

        # Compute scores
        tag_score = self._compute_tag_score_fast(user_profile, vn_tags)
        developer_score = self._compute_developer_score_fast(user_profile, vn_developers)
        staff_score = self._compute_staff_score_fast(user_profile, vn_staff)
        seiyuu_score = self._compute_seiyuu_score_fast(user_profile, vn_seiyuu)
        trait_score = self._compute_trait_score_fast(user_profile, vn_traits)

        # Quality score based on average rating
        vn_avg_rating = vn_row.average_rating or vn_row.rating or 7.0
        quality_score = max(0, (vn_avg_rating - 5.0) / 5.0)

        # Get Similar Games score (from VNSimilarity table)
        similar_games_data = await self._batch_get_similar_games_scores([vn_id], high_rated_vns, vn_scores)
        similar_games_score, similar_games_details_raw = similar_games_data.get(vn_id, (0.0, []))

        # Get Users Also Read score (from VNCoOccurrence table)
        users_also_read_data = await self._batch_get_users_also_read_scores([vn_id], high_rated_vns, vn_scores)
        users_also_read_score, users_also_read_details_raw = users_also_read_data.get(vn_id, (0.0, []))

        # Enrich details with VN titles (for display in frontend)
        similar_games_details = [
            {**d, "source_title": user_vn_titles.get(d["source_vn_id"], d["source_vn_id"])}
            for d in similar_games_details_raw
        ]
        users_also_read_details = [
            {**d, "source_title": user_vn_titles.get(d["source_vn_id"], d["source_vn_id"])}
            for d in users_also_read_details_raw
        ]

        # Compute total score
        total_score = (
            tag_score * TAG_WEIGHT +
            similar_games_score * VN_SIMILARITY_WEIGHT +
            users_also_read_score * USERS_ALSO_READ_WEIGHT +
            developer_score * DEVELOPER_WEIGHT +
            staff_score * STAFF_WEIGHT +
            seiyuu_score * SEIYUU_WEIGHT +
            trait_score * TRAIT_WEIGHT +
            quality_score * QUALITY_WEIGHT
        )

        # Calculate normalized score (0-100) before any adjustments
        overall_normalized_score = min(100, round((total_score / MAX_WEIGHTED_SCORE) * 100))

        # Build detailed breakdown
        user_tags = user_profile["tag_weights"]
        tag_weighted_scores = user_profile.get("tag_weighted_scores", {})
        tag_absolute_scores = user_profile.get("tag_absolute_scores", {})
        tag_counts = user_profile.get("tag_counts", {})
        tag_idf = user_profile.get("tag_idf", {})
        user_overall_avg = user_profile.get("user_overall_avg", 7.0)
        max_tag_weighted = user_profile.get("max_tag_weighted", 1.0)
        max_dev_weighted = user_profile.get("max_dev_weighted", 1.0)
        max_staff_weighted = user_profile.get("max_staff_weighted", 1.0)

        # Matched tags
        matched_tags_detail = []
        for tag_id, vn_tag_score in vn_tags.items():
            if tag_id in user_tags and user_tags[tag_id] > 0:
                # Get absolute score for display (not IDF-weighted)
                tag_absolute = tag_absolute_scores.get(tag_id, 0)
                idf = tag_idf.get(tag_id, 1.0)
                # Contribution to score uses IDF-weighted user_tags
                contribution = user_tags[tag_id] * vn_tag_score
                weighted_score_raw = tag_weighted_scores.get(tag_id, user_overall_avg)
                # Normalize to 0-100 scale where user's top tag = 100 (matches stats page)
                normalized_score = (weighted_score_raw / max_tag_weighted) * 100 if max_tag_weighted > 0 else 0
                matched_tags_detail.append({
                    "id": tag_id,
                    "name": tag_names.get(tag_id, f"Tag {tag_id}"),
                    "user_weight": round(tag_absolute, 2),  # Display absolute, not IDF-weighted
                    "vn_score": round(vn_tag_score, 2),
                    "contribution": round(contribution, 2),
                    "idf": round(idf, 2),  # NEW: Show IDF for transparency
                    "weighted_score": round(normalized_score, 1),
                    "count": tag_counts.get(tag_id, 0),
                })
        matched_tags_detail.sort(key=lambda x: x["weighted_score"], reverse=True)
        matched_tags_detail = matched_tags_detail[:10]

        # Matched developers
        user_devs = user_profile.get("preferred_developers", {})
        dev_weighted_scores = user_profile.get("dev_weighted_scores", {})
        dev_counts = user_profile.get("dev_counts", {})
        vn_devs_set = set(vn_developers)

        matched_developers_detail = []
        for dev_name in vn_devs_set.intersection(user_devs.keys()):
            dev_delta = user_devs.get(dev_name, 0)
            weighted_score_raw = dev_weighted_scores.get(dev_name, user_overall_avg)
            # Normalize to 0-100 scale where user's top developer = 100 (matches stats page)
            normalized_score = (weighted_score_raw / max_dev_weighted) * 100 if max_dev_weighted > 0 else 0
            matched_developers_detail.append({
                "name": dev_name,
                "user_avg_rating": round(dev_delta + user_overall_avg, 1),
                "weight": round(dev_delta, 2),
                "weighted_score": round(normalized_score, 1),
                "count": dev_counts.get(dev_name, 0),
            })
        matched_developers_detail.sort(key=lambda x: x["weighted_score"], reverse=True)

        # Matched staff
        user_staff_prefs = user_profile.get("preferred_staff", {})
        staff_weighted_scores = user_profile.get("staff_weighted_scores", {})
        staff_counts = user_profile.get("staff_counts", {})

        matched_staff_detail = []
        for staff_id in vn_staff_set.intersection(user_staff_prefs.keys()):
            staff_name = staff_names.get(staff_id, "")
            if staff_name:
                staff_delta = user_staff_prefs.get(staff_id, 0)
                weighted_score_raw = staff_weighted_scores.get(staff_id, user_overall_avg)
                # Normalize to 0-100 scale where user's top staff = 100 (matches stats page)
                normalized_score = (weighted_score_raw / max_staff_weighted) * 100 if max_staff_weighted > 0 else 0
                matched_staff_detail.append({
                    "id": staff_id,
                    "name": staff_name,
                    "user_avg_rating": round(staff_delta + user_overall_avg, 1),
                    "weight": round(staff_delta, 2),
                    "weighted_score": round(normalized_score, 1),
                    "count": staff_counts.get(staff_id, 0),
                })
        matched_staff_detail.sort(key=lambda x: x["weighted_score"], reverse=True)

        # Matched seiyuu
        user_seiyuu_prefs = user_profile.get("preferred_seiyuu", {})
        seiyuu_weighted_scores = user_profile.get("seiyuu_weighted_scores", {})
        seiyuu_counts = user_profile.get("seiyuu_counts", {})
        max_seiyuu_weighted = user_profile.get("max_seiyuu_weighted", 1.0)

        matched_seiyuu_detail = []
        for seiyuu_id in vn_seiyuu_set.intersection(user_seiyuu_prefs.keys()):
            seiyuu_name = seiyuu_names.get(seiyuu_id, "")
            if seiyuu_name:
                weighted_score_raw = seiyuu_weighted_scores.get(seiyuu_id, user_overall_avg)
                normalized_score = (weighted_score_raw / max_seiyuu_weighted) * 100 if max_seiyuu_weighted > 0 else 0
                matched_seiyuu_detail.append({
                    "id": seiyuu_id,
                    "name": seiyuu_name,
                    "weighted_score": round(normalized_score, 1),
                    "count": seiyuu_counts.get(seiyuu_id, 0),
                })
        matched_seiyuu_detail.sort(key=lambda x: x["weighted_score"], reverse=True)
        matched_seiyuu_detail = matched_seiyuu_detail[:5]

        # Matched traits
        user_trait_prefs = user_profile.get("preferred_traits", {})
        trait_weighted_scores = user_profile.get("trait_weighted_scores", {})
        trait_counts = user_profile.get("trait_counts", {})
        max_trait_weighted = user_profile.get("max_trait_weighted", 1.0)

        matched_traits_detail = []
        for trait_id in vn_trait_ids.intersection(user_trait_prefs.keys()):
            trait_name = trait_names.get(trait_id, "")
            if trait_name:
                weighted_score_raw = trait_weighted_scores.get(trait_id, user_overall_avg)
                normalized_score = (weighted_score_raw / max_trait_weighted) * 100 if max_trait_weighted > 0 else 0
                matched_traits_detail.append({
                    "id": trait_id,
                    "name": trait_name,
                    "weighted_score": round(normalized_score, 1),
                    "count": trait_counts.get(trait_id, 0),
                })
        matched_traits_detail.sort(key=lambda x: x["weighted_score"], reverse=True)
        matched_traits_detail = matched_traits_detail[:5]

        # Contributing VNs
        contributing_vns_detail = []
        for user_vn_id in high_rated_vns[:20]:
            user_vn_tags = all_tags.get(user_vn_id, {})
            if not user_vn_tags:
                continue
            sim = self._compute_tag_similarity(user_vn_tags, vn_tags)
            if sim > 0.3:
                contributing_vns_detail.append({
                    "id": user_vn_id,
                    "title": user_vn_titles.get(user_vn_id, user_vn_id),
                    "similarity": round(sim * 100, 0),
                })
        contributing_vns_detail.sort(key=lambda x: x["similarity"], reverse=True)
        contributing_vns_detail = contributing_vns_detail[:5]

        # Build match reasons
        reasons = []
        if tag_score > 0.2 and matched_tags_detail:
            top_tag_names = [t["name"] for t in matched_tags_detail[:3]]
            reasons.append(", ".join(top_tag_names))
        if similar_games_score > 0.3:
            reasons.append("Similar to your favorites")
        if users_also_read_score > 0.3:
            reasons.append("Fans also enjoyed")
        if staff_score > 0.2:
            creator_names = [d["name"] for d in matched_developers_detail[:2]]
            creator_names += [s["name"] for s in matched_staff_detail[:2]]
            creator_names = [c for c in creator_names if c][:2]
            if creator_names:
                reasons.append("By " + ", ".join(creator_names))

        return RecommendationResult(
            vn_id=vn_id,
            title=vn_row.title,
            score=total_score,
            normalized_score=overall_normalized_score,
            match_reasons=reasons if reasons else ["Matches your preferences"],
            image_url=vn_row.image_url,
            image_sexual=vn_row.image_sexual,
            rating=vn_row.average_rating or vn_row.rating,  # Prefer average
            title_jp=vn_row.title_jp,
            title_romaji=vn_row.title_romaji,
            tag_score=tag_score,
            similar_games_score=similar_games_score,
            users_also_read_score=users_also_read_score,
            developer_score=developer_score,
            staff_score=staff_score,
            seiyuu_score=seiyuu_score,
            trait_score=trait_score,
            quality_score=quality_score,
            matched_tags=matched_tags_detail,
            matched_staff=matched_staff_detail,
            matched_developers=matched_developers_detail,
            matched_seiyuu=matched_seiyuu_detail,
            matched_traits=matched_traits_detail,
            contributing_vns=contributing_vns_detail,
            similar_games_details=similar_games_details,
            users_also_read_details=users_also_read_details,
        )

    async def _batch_get_vn_tags(self, vn_ids: list[str], spoiler_level: int = 0) -> dict[str, dict[int, float]]:
        """Batch load tags for multiple VNs."""
        if not vn_ids:
            return {}

        result = await self.db.execute(
            select(VNTag.vn_id, VNTag.tag_id, VNTag.score)
            .where(VNTag.vn_id.in_(vn_ids))
            .where(VNTag.spoiler_level <= spoiler_level)
            .where(VNTag.score > 0)
            .where(VNTag.lie == False)  # exclude disputed/incorrect tags
        )

        tags_by_vn: dict[str, dict[int, float]] = {}
        for row in result.all():
            if row.vn_id not in tags_by_vn:
                tags_by_vn[row.vn_id] = {}
            tags_by_vn[row.vn_id][row.tag_id] = row.score

        return tags_by_vn

    async def _batch_get_vn_developers(self, vn_ids: list[str]) -> dict[str, list[str]]:
        """Batch load developers for multiple VNs.

        Queries through: VN → ReleaseVN → ReleaseProducer → Producer
        Returns producer names (not IDs) for matching against user preferences.
        """
        if not vn_ids:
            return {}

        # Query developers through the release chain
        result = await self.db.execute(
            select(ReleaseVN.vn_id, Producer.name)
            .select_from(ReleaseVN)
            .join(ReleaseProducer, ReleaseVN.release_id == ReleaseProducer.release_id)
            .join(Producer, ReleaseProducer.producer_id == Producer.id)
            .where(ReleaseVN.vn_id.in_(vn_ids))
            .where(ReleaseProducer.developer == True)
            .distinct()
        )

        developers_by_vn: dict[str, list[str]] = {vn_id: [] for vn_id in vn_ids}
        for row in result.all():
            if row.name:
                developers_by_vn[row.vn_id].append(row.name)

        return developers_by_vn

    async def _batch_get_vn_staff(self, vn_ids: list[str]) -> dict[str, list[str]]:
        """Batch load staff for multiple VNs."""
        if not vn_ids:
            return {}

        try:
            result = await self.db.execute(
                select(VNStaff.vn_id, VNStaff.staff_id)
                .where(VNStaff.vn_id.in_(vn_ids))
            )

            staff_by_vn: dict[str, list[str]] = {}
            for row in result.all():
                if row.vn_id not in staff_by_vn:
                    staff_by_vn[row.vn_id] = []
                staff_by_vn[row.vn_id].append(row.staff_id)

            return staff_by_vn
        except Exception:
            return {}

    async def _batch_get_vn_seiyuu(self, vn_ids: list[str]) -> dict[str, list[str]]:
        """Batch load voice actors (seiyuu) for multiple VNs."""
        if not vn_ids:
            return {}

        try:
            result = await self.db.execute(
                select(VNSeiyuu.vn_id, VNSeiyuu.staff_id)
                .where(VNSeiyuu.vn_id.in_(vn_ids))
            )

            seiyuu_by_vn: dict[str, list[str]] = {}
            for row in result.all():
                if row.vn_id not in seiyuu_by_vn:
                    seiyuu_by_vn[row.vn_id] = []
                # Only add if not already present (can have multiple characters voiced by same VA)
                if row.staff_id not in seiyuu_by_vn[row.vn_id]:
                    seiyuu_by_vn[row.vn_id].append(row.staff_id)

            return seiyuu_by_vn
        except Exception:
            return {}

    async def _batch_get_vn_traits(self, vn_ids: list[str], spoiler_level: int = 0) -> dict[str, dict[int, int]]:
        """Batch load character traits for multiple VNs.

        Returns {vn_id: {trait_id: count}} where count is how many characters
        in that VN have that trait. Filters by max spoiler level.
        """
        if not vn_ids:
            return {}

        try:
            # Join CharacterVN -> CharacterTrait to get traits per VN
            # Count how many characters have each trait (weighted by occurrence)
            result = await self.db.execute(
                select(CharacterVN.vn_id, CharacterTrait.trait_id)
                .join(CharacterTrait, CharacterTrait.character_id == CharacterVN.character_id)
                .where(CharacterVN.vn_id.in_(vn_ids))
                .where(CharacterTrait.spoiler_level <= spoiler_level)
            )

            traits_by_vn: dict[str, dict[int, int]] = {}
            for row in result.all():
                if row.vn_id not in traits_by_vn:
                    traits_by_vn[row.vn_id] = {}
                trait_id = row.trait_id
                traits_by_vn[row.vn_id][trait_id] = traits_by_vn[row.vn_id].get(trait_id, 0) + 1

            return traits_by_vn
        except Exception as e:
            logger.warning(f"Failed to load VN traits: {e}")
            return {}

    async def _batch_get_tag_names(self, tag_ids: set[int]) -> dict[int, str]:
        """Batch load tag names for display."""
        if not tag_ids:
            return {}

        try:
            result = await self.db.execute(
                select(Tag.id, Tag.name)
                .where(Tag.id.in_(list(tag_ids)))
            )
            return {row.id: row.name for row in result.all()}
        except Exception as e:
            logger.warning(f"Failed to load tag names: {e}")
            return {}

    async def _batch_get_staff_names(self, staff_ids: set[str]) -> dict[str, str]:
        """Batch load staff names for display."""
        if not staff_ids:
            return {}

        try:
            result = await self.db.execute(
                select(Staff.id, Staff.name)
                .where(Staff.id.in_(list(staff_ids)))
            )
            return {row.id: row.name for row in result.all()}
        except Exception as e:
            logger.warning(f"Failed to load staff names: {e}")
            return {}

    async def _batch_get_trait_names(self, trait_ids: set[int]) -> dict[int, str]:
        """Batch load trait names for display."""
        if not trait_ids:
            return {}

        try:
            result = await self.db.execute(
                select(Trait.id, Trait.name)
                .where(Trait.id.in_(list(trait_ids)))
            )
            return {row.id: row.name for row in result.all()}
        except Exception as e:
            logger.warning(f"Failed to load trait names: {e}")
            return {}

    async def _batch_get_vn_titles(self, vn_ids: list[str]) -> dict[str, str]:
        """Batch load VN titles for display."""
        if not vn_ids:
            return {}

        try:
            result = await self.db.execute(
                select(VisualNovel.id, VisualNovel.title)
                .where(VisualNovel.id.in_(vn_ids))
            )
            return {row.id: row.title for row in result.all()}
        except Exception as e:
            logger.warning(f"Failed to load VN titles: {e}")
            return {}

    async def _batch_get_collab_details(
        self,
        candidate_ids: list[str],
        high_rated_vns: list[str],
    ) -> dict[str, dict]:
        """
        Batch get collaborative filtering details for all candidates.

        Returns {vn_id: {"similar_users_count": N, "their_avg_rating": X}}
        """
        if not candidate_ids or not high_rated_vns:
            return {}

        try:
            # Get aggregated co-occurrence data
            result = await self.db.execute(
                select(
                    VNCoOccurrence.similar_vn_id,
                    func.sum(VNCoOccurrence.user_count).label("user_sum"),
                    func.avg(VNCoOccurrence.co_rating_score).label("avg_score"),
                )
                .where(VNCoOccurrence.vn_id.in_(high_rated_vns))
                .where(VNCoOccurrence.similar_vn_id.in_(candidate_ids))
                .group_by(VNCoOccurrence.similar_vn_id)
            )

            details = {}
            for row in result.all():
                details[row.similar_vn_id] = {
                    "similar_users_count": int(row.user_sum or 0),
                    "their_avg_rating": round((row.avg_score or 0) * 10, 1),  # Convert to 0-10 scale
                }
            return details
        except Exception as e:
            logger.warning(f"Failed to load collab details: {e}")
            return {}

    def _compute_tag_score_fast(
        self, user_profile: dict, vn_tags: dict[int, float]
    ) -> float:
        """
        Compute tag match score using IDF-weighted affinity sum.

        Score = sum(user_affinity[tag] * vn_tag_score[tag]) / max_possible_score

        Where:
        - user_affinity already includes IDF weighting (from _build_user_profile)
        - vn_tag_score is VNDB's 0-3 relevance score for the tag on this VN

        This approach:
        - Rewards strong matches on niche tags (high IDF like Nakige)
        - Uses absolute preference scores, not deltas from average
        - Considers how strongly the tag applies to the VN (0-3 score)
        """
        user_tags = user_profile["tag_weights"]  # IDF-weighted affinities (with elite boosting)
        elite_tag_ids = user_profile.get("elite_tag_ids", set())  # User's top 10 tags
        if not user_tags or not vn_tags:
            return 0.0

        # Compute weighted sum: user affinity * VN tag relevance score
        # Also track best match among elite tags for the best-match component
        weighted_sum = 0.0
        matched_count = 0
        best_elite_contribution = 0.0
        for tag_id, vn_score in vn_tags.items():
            if tag_id in user_tags and user_tags[tag_id] > 0:
                # vn_score is 0-3 from VNDB (how strongly tag applies to VN)
                # user_tags[tag_id] is IDF-weighted user preference (with elite boosting)
                contribution = user_tags[tag_id] * vn_score
                weighted_sum += contribution
                matched_count += 1

                # Track best match among elite tags (user's top 10)
                if tag_id in elite_tag_ids:
                    best_elite_contribution = max(best_elite_contribution, contribution)

        if weighted_sum <= 0 or matched_count == 0:
            return 0.0

        # Normalize by computing max possible score
        # Use user's top N tag weights (sorted by IDF-weighted value)
        # to avoid over-normalization from obscure tags
        top_user_weights = sorted(
            [w for w in user_tags.values() if w > 0],
            reverse=True
        )[:15]  # Top 15 tags

        # Max possible = sum of top weights * max VN tag score (3.0)
        max_possible = sum(top_user_weights) * 3.0

        if max_possible <= 0:
            return 0.0

        # Normalize sum-based score to 0-1 range
        sum_score = weighted_sum / max_possible

        # Calculate best-match component
        # This ensures VNs matching user's top tags strongly get credit
        # even if they don't match many other tags
        max_elite_contrib = top_user_weights[0] * 3.0 if top_user_weights else 1.0
        best_match_score = min(1.0, best_elite_contribution / max_elite_contrib) if max_elite_contrib > 0 else 0.0

        # Blend sum-based and best-match components
        # 70% sum (rewards breadth) + 30% best-match (rewards depth on top tags)
        blended = (1 - BEST_MATCH_WEIGHT) * sum_score + BEST_MATCH_WEIGHT * best_match_score

        # Small bonus for matching many tags (up to 10% boost)
        match_bonus = min(0.1, matched_count * 0.01)

        return min(1.0, max(0.0, blended + match_bonus))

    def _compute_developer_score_fast(
        self,
        user_profile: dict,
        vn_developers: list[str],
    ) -> float:
        """Compute developer/publisher match using WEIGHTED preferences.

        Uses the actual Bayesian-weighted scores from the user profile,
        not just binary overlap. A developer with avg rating 9 contributes
        more than one with avg rating 7.
        """
        user_dev_weights = user_profile.get("preferred_developers", {})
        max_dev_weighted = user_profile.get("max_dev_weighted", 10.0)
        user_avg = user_profile.get("user_overall_avg", 7.0)

        if not user_dev_weights or not vn_developers:
            return 0.0

        # Sum weighted preference scores for overlapping developers
        # preferred_developers stores delta from user average, so we add it back
        dev_score = 0.0
        for dev in vn_developers:
            if dev in user_dev_weights:
                # Convert delta back to absolute score, then normalize
                abs_score = user_dev_weights[dev] + user_avg
                dev_score += abs_score / max_dev_weighted if max_dev_weighted > 0 else 0

        return min(1.0, dev_score)

    def _compute_staff_score_fast(
        self,
        user_profile: dict,
        vn_staff: list[str],
    ) -> float:
        """Compute staff (writers, artists) match using WEIGHTED preferences.

        Uses the actual Bayesian-weighted scores from the user profile,
        not just binary overlap. A 9-rated writer contributes more than
        a 7-rated writer.
        """
        user_staff_weights = user_profile.get("preferred_staff", {})
        max_staff_weighted = user_profile.get("max_staff_weighted", 10.0)
        user_avg = user_profile.get("user_overall_avg", 7.0)

        if not user_staff_weights or not vn_staff:
            return 0.0

        # Sum weighted preference scores for overlapping staff
        staff_score = 0.0
        for staff_id in vn_staff:
            if staff_id in user_staff_weights:
                # Convert delta back to absolute score, then normalize
                abs_score = user_staff_weights[staff_id] + user_avg
                staff_score += abs_score / max_staff_weighted if max_staff_weighted > 0 else 0

        return min(1.0, staff_score)

    def _compute_seiyuu_score_fast(
        self,
        user_profile: dict,
        vn_seiyuu: list[str],
    ) -> float:
        """Compute voice actor (seiyuu) preference match using weighted preferences."""
        user_seiyuu_weights = user_profile.get("preferred_seiyuu", {})
        max_seiyuu_weighted = user_profile.get("max_seiyuu_weighted", 10.0)
        user_avg = user_profile.get("user_overall_avg", 7.0)

        if not user_seiyuu_weights or not vn_seiyuu:
            return 0.0

        # Sum weighted preference scores for overlapping seiyuu
        seiyuu_score = 0.0
        for staff_id in vn_seiyuu:
            if staff_id in user_seiyuu_weights:
                # Convert delta back to absolute score, then normalize
                abs_score = user_seiyuu_weights[staff_id] + user_avg
                seiyuu_score += abs_score / max_seiyuu_weighted if max_seiyuu_weighted > 0 else 0

        return min(1.0, seiyuu_score)

    def _compute_trait_score_fast(
        self,
        user_profile: dict,
        vn_traits: dict[int, int],  # {trait_id: count}
    ) -> float:
        """Compute character trait preference match using weighted preferences.

        vn_traits contains trait_id -> count of characters with that trait.
        This captures things like "many tsundere characters" boosting the score
        for users who prefer tsundere.
        """
        user_trait_weights = user_profile.get("preferred_traits", {})
        max_trait_weighted = user_profile.get("max_trait_weighted", 10.0)
        user_avg = user_profile.get("user_overall_avg", 7.0)

        if not user_trait_weights or not vn_traits:
            return 0.0

        # Sum weighted preference scores for overlapping traits
        trait_score = 0.0
        for trait_id, count in vn_traits.items():
            if trait_id in user_trait_weights:
                # Convert delta back to absolute score, then normalize
                abs_score = user_trait_weights[trait_id] + user_avg
                # Weight by sqrt(count) to give bonus for multiple characters with same trait
                # but not linearly (diminishing returns)
                weight = min(2.0, 1.0 + (count - 1) * 0.3)  # 1.0 for 1 char, max 2.0
                trait_score += (abs_score / max_trait_weighted) * weight if max_trait_weighted > 0 else 0

        return min(1.0, trait_score)

    async def _apply_diversity_reranking(
        self,
        recommendations: list[RecommendationResult],
        all_tags: dict[str, dict[int, float]],
        limit: int,
        diversity_weight: float = 0.3,
    ) -> list[RecommendationResult]:
        """
        Apply Maximal Marginal Relevance (MMR) diversity reranking.

        Balances relevance (original score) with diversity (dissimilarity to
        already-selected items). This prevents results from clustering around
        similar VNs.

        Args:
            recommendations: Scored recommendations sorted by score
            all_tags: Pre-loaded tags for candidates {vn_id: {tag_id: score}}
            limit: Number of results to return
            diversity_weight: Weight for diversity (0 = pure relevance, 1 = pure diversity)

        Returns:
            Reranked list balancing relevance and diversity
        """
        if len(recommendations) <= limit:
            return recommendations

        # Start with the highest-scored item
        selected: list[RecommendationResult] = [recommendations[0]]
        remaining = recommendations[1:]

        while len(selected) < limit and remaining:
            best_mmr_score = -float('inf')
            best_idx = 0

            for idx, candidate in enumerate(remaining):
                # Relevance: original score (normalized)
                relevance = candidate.score

                # Diversity: minimum dissimilarity to recently selected items
                # Only compare to last 10 selected (they represent the "diversity frontier")
                # This is O(remaining × 10) instead of O(remaining × selected)
                max_similarity = 0.0
                candidate_tags = all_tags.get(candidate.vn_id, {})
                recent_selected = selected[-10:] if len(selected) > 10 else selected

                for selected_item in recent_selected:
                    selected_tags = all_tags.get(selected_item.vn_id, {})
                    similarity = self._compute_tag_similarity(candidate_tags, selected_tags)
                    max_similarity = max(max_similarity, similarity)

                diversity = 1.0 - max_similarity

                # MMR score: balance relevance and diversity
                mmr_score = (1 - diversity_weight) * relevance + diversity_weight * diversity

                if mmr_score > best_mmr_score:
                    best_mmr_score = mmr_score
                    best_idx = idx

            # Add best candidate to selected
            selected.append(remaining[best_idx])
            remaining.pop(best_idx)

        return selected

    def _compute_tag_similarity(
        self,
        tags_a: dict[int, float],
        tags_b: dict[int, float],
    ) -> float:
        """Compute cosine similarity between two tag vectors."""
        if not tags_a or not tags_b:
            return 0.0

        # Find common tags
        common_tags = set(tags_a.keys()).intersection(set(tags_b.keys()))
        if not common_tags:
            return 0.0

        # Compute dot product
        dot_product = sum(tags_a[t] * tags_b[t] for t in common_tags)

        # Compute magnitudes
        mag_a = np.sqrt(sum(v ** 2 for v in tags_a.values()))
        mag_b = np.sqrt(sum(v ** 2 for v in tags_b.values()))

        if mag_a == 0 or mag_b == 0:
            return 0.0

        return dot_product / (mag_a * mag_b)

    async def _build_user_profile(self, user_votes: list[dict], spoiler_level: int = 0) -> dict:
        """
        Build user's tag preference profile from their ratings using Bayesian weighting.

        Uses the same scoring approach as the stats page:
        1. Calculate Bayesian damped mean for each tag/staff
        2. Apply confidence penalty for low-count items

        Returns dict with:
        - tag_weights: {tag_id: weight} - Bayesian-weighted scores
        - high_rated_vns: list of vn_ids with high ratings
        - preferred_staff: {staff_id: weight}
        - preferred_developers: {developer_name: weight}
        """
        # Extract VN IDs and scores (0-10 scale)
        vn_scores = {}  # vn_id -> score (0-10)
        high_rated_vns = []

        for vote in user_votes:
            vn_id = vote.get("vn_id") or vote.get("id")
            raw_score = vote.get("score", vote.get("vote", 50))

            if not vn_id:
                continue

            # Convert to 0-10 scale (VNDB stores as 10-100)
            score = raw_score / 10.0
            vn_scores[vn_id] = score

            if raw_score >= 85:  # 8.5+ on 10-scale
                high_rated_vns.append(vn_id)

        # Sort high_rated_vns by rating so [:20] gets the user's TOP 20 favorites
        # This ensures VNs rated 10.0 have more influence than VNs rated 8.5
        high_rated_vns.sort(key=lambda vn_id: vn_scores.get(vn_id, 0), reverse=True)

        if not vn_scores:
            return {
                "tag_weights": {},
                "high_rated_vns": [],
                "preferred_staff": {},
                "preferred_developers": {},
                "preferred_seiyuu": {},
                "preferred_traits": {},
                "user_overall_avg": 7.0,  # Default
            }

        # Calculate user's overall average rating (for Bayesian prior)
        user_overall_avg = sum(vn_scores.values()) / len(vn_scores)

        # Batch load all data
        vn_ids = list(vn_scores.keys())
        all_tags = await self._batch_get_vn_tags(vn_ids, spoiler_level=spoiler_level)
        all_developers = await self._batch_get_vn_developers(vn_ids)
        all_staff = await self._batch_get_vn_staff(vn_ids)
        all_seiyuu = await self._batch_get_vn_seiyuu(vn_ids)
        all_traits = await self._batch_get_vn_traits(vn_ids, spoiler_level=spoiler_level)

        # Load IDF weights for tag scoring
        tag_idf = await self._load_tag_idf_weights()

        # Group VNs by tag: {tag_id: [vn_ids]}
        tag_to_vns: dict[int, list[str]] = {}
        for vn_id in vn_ids:
            vn_tags = all_tags.get(vn_id, {})
            for tag_id in vn_tags.keys():
                if tag_id in IGNORE_TAGS:
                    continue
                if tag_id not in tag_to_vns:
                    tag_to_vns[tag_id] = []
                tag_to_vns[tag_id].append(vn_id)

        # Calculate Bayesian-weighted tag scores with IDF weighting
        tag_weights = {}  # For scoring: IDF-weighted absolute preference
        tag_absolute_scores = {}  # Raw absolute scores for display
        tag_weighted_scores = {}  # For display: actual weighted score (0-10 scale)
        tag_counts = {}  # For reference
        for tag_id, vn_list in tag_to_vns.items():
            count = len(vn_list)
            tag_avg = sum(vn_scores[vn_id] for vn_id in vn_list) / count

            # Apply Bayesian damping (pulls low-count toward user's average)
            bayesian = self._calculate_bayesian_score(
                user_avg=tag_avg,
                count=count,
                user_overall_avg=user_overall_avg,
                prior_weight=3,
            )

            # Apply confidence penalty (low-count = less reliable)
            # Use min_confidence_count=5 to match stats page calculation
            weighted = self._calculate_weighted_score(
                bayesian_score=bayesian,
                count=count,
                min_confidence_count=5,
            )

            # Store actual weighted score for display (0-10 scale)
            tag_weighted_scores[tag_id] = weighted
            tag_absolute_scores[tag_id] = weighted  # Absolute score for display
            tag_counts[tag_id] = count

            # NEW: Use IDF-weighted absolute score for recommendations
            # This makes niche tags (high IDF) more influential than common tags
            # Nakige (IDF~2.2) will contribute ~4x more than Romance (IDF~0.5)
            idf = tag_idf.get(tag_id, 1.0)
            tag_weights[tag_id] = weighted * idf

        # Apply elite tier boosting to user's top tags
        # This ensures their strongest preferences dominate recommendations
        elite_tag_ids = set()
        sorted_by_weight = sorted(tag_weights.items(), key=lambda x: x[1], reverse=True)
        for rank, (tag_id, _) in enumerate(sorted_by_weight):
            if rank < 5:
                # Top 5 tags get maximum boost
                tag_weights[tag_id] *= ELITE_TIER_1_MULTIPLIER
                elite_tag_ids.add(tag_id)
            elif rank < 10:
                # Tags 6-10 get strong boost
                tag_weights[tag_id] *= ELITE_TIER_2_MULTIPLIER
                elite_tag_ids.add(tag_id)
            elif rank < 20:
                # Tags 11-20 get moderate boost
                tag_weights[tag_id] *= ELITE_TIER_3_MULTIPLIER

        logger.debug(f"Applied elite tier boosting to {len(elite_tag_ids)} top tags")

        # Group VNs by staff: {staff_id: [vn_ids]}
        staff_to_vns: dict[str, list[str]] = {}
        for vn_id in vn_ids:
            vn_staff = all_staff.get(vn_id, [])
            for staff_id in vn_staff:
                if staff_id not in staff_to_vns:
                    staff_to_vns[staff_id] = []
                staff_to_vns[staff_id].append(vn_id)

        # Calculate Bayesian-weighted staff scores
        preferred_staff = {}  # For scoring: delta from user's average
        staff_weighted_scores = {}  # For display: actual weighted score (0-10 scale)
        staff_counts = {}  # For reference
        for staff_id, vn_list in staff_to_vns.items():
            count = len(vn_list)
            staff_avg = sum(vn_scores[vn_id] for vn_id in vn_list) / count

            bayesian = self._calculate_bayesian_score(
                user_avg=staff_avg,
                count=count,
                user_overall_avg=user_overall_avg,
                prior_weight=3,
            )
            # Use min_confidence_count=5 to match stats page calculation
            weighted = self._calculate_weighted_score(
                bayesian_score=bayesian,
                count=count,
                min_confidence_count=5,
            )
            # Store actual weighted score for display
            staff_weighted_scores[staff_id] = weighted
            staff_counts[staff_id] = count
            preferred_staff[staff_id] = weighted - user_overall_avg

            # Debug milktub
            if staff_id == 's465':
                logger.info(f"[RECS DEBUG] milktub: count={count}, avg={staff_avg:.4f}, "
                           f"user_overall={user_overall_avg:.4f}, bayesian={bayesian:.4f}, weighted={weighted:.4f}")

        # Group VNs by developer: {developer: [vn_ids]}
        dev_to_vns: dict[str, list[str]] = {}
        for vn_id in vn_ids:
            vn_developers = all_developers.get(vn_id, [])
            for developer in vn_developers:
                if developer not in dev_to_vns:
                    dev_to_vns[developer] = []
                dev_to_vns[developer].append(vn_id)

        # Calculate Bayesian-weighted developer scores
        preferred_developers = {}  # For scoring: delta from user's average
        dev_weighted_scores = {}  # For display: actual weighted score (0-10 scale)
        dev_counts = {}  # For reference
        for developer, vn_list in dev_to_vns.items():
            count = len(vn_list)
            dev_avg = sum(vn_scores[vn_id] for vn_id in vn_list) / count

            bayesian = self._calculate_bayesian_score(
                user_avg=dev_avg,
                count=count,
                user_overall_avg=user_overall_avg,
                prior_weight=3,
            )
            # Use min_confidence_count=5 to match stats page calculation
            weighted = self._calculate_weighted_score(
                bayesian_score=bayesian,
                count=count,
                min_confidence_count=5,
            )
            # Store actual weighted score for display
            dev_weighted_scores[developer] = weighted
            dev_counts[developer] = count
            preferred_developers[developer] = weighted - user_overall_avg

        # Group VNs by seiyuu: {staff_id: [vn_ids]}
        seiyuu_to_vns: dict[str, list[str]] = {}
        for vn_id in vn_ids:
            vn_seiyuu = all_seiyuu.get(vn_id, [])
            for staff_id in vn_seiyuu:
                if staff_id not in seiyuu_to_vns:
                    seiyuu_to_vns[staff_id] = []
                seiyuu_to_vns[staff_id].append(vn_id)

        # Calculate Bayesian-weighted seiyuu scores
        preferred_seiyuu = {}  # For scoring: delta from user's average
        seiyuu_weighted_scores = {}  # For display: actual weighted score (0-10 scale)
        seiyuu_counts = {}  # For reference
        for staff_id, vn_list in seiyuu_to_vns.items():
            count = len(vn_list)
            seiyuu_avg = sum(vn_scores[vn_id] for vn_id in vn_list) / count

            bayesian = self._calculate_bayesian_score(
                user_avg=seiyuu_avg,
                count=count,
                user_overall_avg=user_overall_avg,
                prior_weight=3,
            )
            weighted = self._calculate_weighted_score(
                bayesian_score=bayesian,
                count=count,
                min_confidence_count=5,
            )
            # Store actual weighted score for display
            seiyuu_weighted_scores[staff_id] = weighted
            seiyuu_counts[staff_id] = count
            preferred_seiyuu[staff_id] = weighted - user_overall_avg

        # Group VNs by trait: {trait_id: [vn_ids]}
        # Traits are counted per character, so a VN with 3 tsundere characters
        # contributes more to the tsundere trait preference
        trait_to_vns: dict[int, list[str]] = {}
        for vn_id in vn_ids:
            vn_traits = all_traits.get(vn_id, {})
            for trait_id in vn_traits.keys():
                if trait_id not in trait_to_vns:
                    trait_to_vns[trait_id] = []
                trait_to_vns[trait_id].append(vn_id)

        # Calculate Bayesian-weighted trait scores
        preferred_traits = {}  # For scoring: delta from user's average
        trait_weighted_scores = {}  # For display: actual weighted score (0-10 scale)
        trait_counts = {}  # For reference
        for trait_id, vn_list in trait_to_vns.items():
            count = len(vn_list)
            trait_avg = sum(vn_scores[vn_id] for vn_id in vn_list) / count

            bayesian = self._calculate_bayesian_score(
                user_avg=trait_avg,
                count=count,
                user_overall_avg=user_overall_avg,
                prior_weight=3,
            )
            weighted = self._calculate_weighted_score(
                bayesian_score=bayesian,
                count=count,
                min_confidence_count=5,
            )
            # Store actual weighted score for display
            trait_weighted_scores[trait_id] = weighted
            trait_counts[trait_id] = count
            preferred_traits[trait_id] = weighted - user_overall_avg

        # Calculate max weighted scores for normalization (to match stats page display)
        max_tag_weighted = max(tag_weighted_scores.values()) if tag_weighted_scores else 1.0
        max_staff_weighted = max(staff_weighted_scores.values()) if staff_weighted_scores else 1.0
        max_dev_weighted = max(dev_weighted_scores.values()) if dev_weighted_scores else 1.0
        max_seiyuu_weighted = max(seiyuu_weighted_scores.values()) if seiyuu_weighted_scores else 1.0
        max_trait_weighted = max(trait_weighted_scores.values()) if trait_weighted_scores else 1.0

        # Debug: log milktub normalized score
        if 's465' in staff_weighted_scores:
            milktub_weighted = staff_weighted_scores['s465']
            milktub_normalized = (milktub_weighted / max_staff_weighted) * 100
            logger.info(f"[RECS DEBUG] milktub normalized: {milktub_weighted:.4f} / {max_staff_weighted:.4f} * 100 = {milktub_normalized:.1f}")

        logger.info(
            f"Built user profile: {len(tag_weights)} tags, {len(preferred_staff)} staff, "
            f"{len(preferred_developers)} developers, {len(preferred_seiyuu)} seiyuu, "
            f"{len(preferred_traits)} traits (user avg: {user_overall_avg:.2f})"
        )

        return {
            "tag_weights": tag_weights,  # IDF-weighted absolute scores for scoring (with elite boosting)
            "tag_absolute_scores": tag_absolute_scores,  # Raw absolute scores for display
            "tag_weighted_scores": tag_weighted_scores,  # For display (0-10 scale)
            "tag_counts": tag_counts,
            "tag_idf": tag_idf,  # IDF values for transparency in display
            "max_tag_weighted": max_tag_weighted,  # For normalization
            "elite_tag_ids": elite_tag_ids,  # User's top 10 tags (for best-match scoring)
            "high_rated_vns": high_rated_vns,
            "vn_scores": vn_scores,  # VN ID -> score (0-10) for weighting
            "preferred_staff": preferred_staff,
            "staff_weighted_scores": staff_weighted_scores,  # For display (0-10 scale)
            "staff_counts": staff_counts,
            "max_staff_weighted": max_staff_weighted,  # For normalization
            "preferred_developers": preferred_developers,
            "dev_weighted_scores": dev_weighted_scores,  # For display (0-10 scale)
            "dev_counts": dev_counts,
            "max_dev_weighted": max_dev_weighted,  # For normalization
            "preferred_seiyuu": preferred_seiyuu,
            "seiyuu_weighted_scores": seiyuu_weighted_scores,  # For display (0-10 scale)
            "seiyuu_counts": seiyuu_counts,
            "max_seiyuu_weighted": max_seiyuu_weighted,  # For normalization
            "preferred_traits": preferred_traits,
            "trait_weighted_scores": trait_weighted_scores,  # For display (0-10 scale)
            "trait_counts": trait_counts,
            "max_trait_weighted": max_trait_weighted,  # For normalization
            "user_overall_avg": user_overall_avg,
        }

    async def _get_vn_tags(self, vn_id: str, spoiler_level: int = 0) -> dict[int, float]:
        """Get tags for a VN as {tag_id: score}."""
        result = await self.db.execute(
            select(VNTag.tag_id, VNTag.score)
            .where(VNTag.vn_id == vn_id)
            .where(VNTag.spoiler_level <= spoiler_level)
            .where(VNTag.score > 0)
            .where(VNTag.lie == False)  # exclude disputed/incorrect tags
        )
        return {row.tag_id: row.score for row in result.all()}

    async def _get_vn_staff(self, vn_id: str) -> list[str]:
        """Get staff IDs for a VN (writers, artists, etc)."""
        try:
            result = await self.db.execute(
                select(VNStaff.staff_id)
                .where(VNStaff.vn_id == vn_id)
            )
            return [row.staff_id for row in result.all()]
        except Exception:
            return []

    async def _get_vn_developers(self, vn_id: str) -> list[str]:
        """Get developer names for a VN."""
        try:
            result = await self.db.execute(
                select(Producer.name)
                .select_from(ReleaseVN)
                .join(ReleaseProducer, ReleaseVN.release_id == ReleaseProducer.release_id)
                .join(Producer, ReleaseProducer.producer_id == Producer.id)
                .where(ReleaseVN.vn_id == vn_id)
                .where(ReleaseProducer.developer == True)
                .distinct()
            )
            return [row.name for row in result.all() if row.name]
        except Exception:
            return []

    async def _get_similar_vn_candidates(
        self,
        high_rated_vns: list[str],
        exclude_vn_ids: set[str],
        limit: int,
        spoiler_level: int = 0,
    ) -> set[str]:
        """
        Get candidate VN IDs similar to user's highly-rated VNs.
        First tries pre-computed VNSimilarity table, falls back to live tag matching.
        """
        if not high_rated_vns:
            return set()

        similar_vns: set[str] = set()

        # Try pre-computed similarity table first
        try:
            result = await self.db.execute(
                select(VNSimilarity.similar_vn_id, VNSimilarity.similarity_score)
                .where(VNSimilarity.vn_id.in_(high_rated_vns))
                .where(VNSimilarity.similar_vn_id.notin_(exclude_vn_ids))
                .order_by(VNSimilarity.similarity_score.desc())
                .limit(limit)
            )
            raw_similar = [(row.similar_vn_id, row.similarity_score) for row in result.all()]

            if raw_similar:
                # Take top similar VNs by similarity score
                raw_similar.sort(key=lambda x: x[1], reverse=True)
                for vn_id, _ in raw_similar[:limit]:
                    similar_vns.add(vn_id)

                logger.info(f"VNSimilarity found {len(similar_vns)} candidates")
        except Exception as e:
            logger.warning(f"VNSimilarity lookup failed: {e}")

        # If pre-computed table is empty, find candidates via live tag matching
        if len(similar_vns) < limit // 2:
            logger.info("Using live tag matching for candidate selection")
            tag_based = await self._get_tag_based_candidates(
                high_rated_vns=high_rated_vns,
                exclude_vn_ids=exclude_vn_ids.union(similar_vns),
                limit=limit - len(similar_vns),
                spoiler_level=spoiler_level,
            )
            similar_vns.update(tag_based)

        return similar_vns

    async def _get_tag_based_candidates(
        self,
        high_rated_vns: list[str],
        exclude_vn_ids: set[str],
        limit: int,
        spoiler_level: int = 0,
    ) -> set[str]:
        """
        Find candidate VNs by matching tags with user's favorites.
        Uses IDF weighting so rare/niche tags count more than common ones.
        """
        if not high_rated_vns:
            return set()

        # Get top tags from user's highly-rated VNs with their scores
        tag_result = await self.db.execute(
            select(VNTag.tag_id, func.sum(VNTag.score).label('total_score'))
            .where(VNTag.vn_id.in_(high_rated_vns[:20]))
            .where(VNTag.spoiler_level <= spoiler_level)
            .where(VNTag.tag_id.notin_(IGNORE_TAGS))
            .where(VNTag.lie == False)  # exclude disputed/incorrect tags
            .group_by(VNTag.tag_id)
            .order_by(func.sum(VNTag.score).desc())
            .limit(50)  # Get more tags for IDF filtering
        )
        user_tags = {row.tag_id: row.total_score for row in tag_result.all()}

        if not user_tags:
            return set()

        # Get IDF weights for these tags (inverse of how common they are)
        idf_result = await self.db.execute(
            select(VNTag.tag_id, func.count(func.distinct(VNTag.vn_id)).label('doc_count'))
            .where(VNTag.tag_id.in_(list(user_tags.keys())))
            .where(VNTag.spoiler_level <= spoiler_level)
            .where(VNTag.lie == False)  # exclude disputed/incorrect tags
            .group_by(VNTag.tag_id)
        )
        tag_doc_counts = {row.tag_id: row.doc_count for row in idf_result.all()}

        # Get total VN count for IDF calculation
        total_vns_result = await self.db.execute(
            select(func.count(func.distinct(VisualNovel.id)))
        )
        total_vns = total_vns_result.scalar_one_or_none() or 10000

        # Compute IDF-weighted tag importance
        # IDF = log(total_docs / doc_count) - rare tags get higher weights
        tag_idf_weights = {}
        for tag_id, user_score in user_tags.items():
            doc_count = tag_doc_counts.get(tag_id, total_vns)
            idf = math.log(total_vns / max(doc_count, 1))
            # TF-IDF: user's tag score * IDF weight
            tag_idf_weights[tag_id] = user_score * idf

        # Select top 30 tags by IDF-weighted importance (favors niche tags)
        sorted_tags = sorted(tag_idf_weights.items(), key=lambda x: x[1], reverse=True)
        top_tag_ids = [tag_id for tag_id, _ in sorted_tags[:30]]

        if not top_tag_ids:
            return set()

        # Find VNs with these tags, weighted by IDF
        # Use a subquery to compute weighted match scores
        candidates_query = (
            select(
                VNTag.vn_id,
                func.sum(VNTag.score).label('weighted_score'),
                func.count(VNTag.tag_id).label('match_count')
            )
            .where(VNTag.tag_id.in_(top_tag_ids))
            .where(VNTag.spoiler_level <= spoiler_level)
            .where(VNTag.score >= 1.0)
            .where(VNTag.lie == False)  # exclude disputed/incorrect tags
        )
        if exclude_vn_ids:
            candidates_query = candidates_query.where(
                VNTag.vn_id.notin_(exclude_vn_ids)
            )
        candidates_query = (
            candidates_query
            .group_by(VNTag.vn_id)
            .having(func.count(VNTag.tag_id) >= 3)
            .order_by(func.sum(VNTag.score).desc())
            .limit(limit)
        )

        result = await self.db.execute(candidates_query)
        raw_candidates = [(row.vn_id, row.weighted_score) for row in result.all()]

        if not raw_candidates:
            return set()

        # Sort by tag score and return top candidates (no popularity penalty)
        raw_candidates.sort(key=lambda x: x[1], reverse=True)
        result_ids = {vn_id for vn_id, _ in raw_candidates[:limit]}
        logger.info(f"Tag-based selection found {len(result_ids)} candidates using IDF-weighted tags")
        return result_ids

    async def _get_elite_tag_candidates(
        self,
        elite_tag_ids: set[int],
        exclude_vn_ids: set[str],
        limit: int,
        spoiler_level: int = 0,
    ) -> set[str]:
        """
        Find VNs matching ANY of the user's elite tags (top 5).
        No minimum tag count requirement - even 1 elite tag match qualifies.
        This ensures rare tags the user loves can surface recommendations.
        """
        if not elite_tag_ids:
            return set()

        # Find VNs with ANY elite tag, ordered by tag score
        query = (
            select(
                VNTag.vn_id,
                func.max(VNTag.score).label('best_score')
            )
            .where(VNTag.tag_id.in_(elite_tag_ids))
            .where(VNTag.spoiler_level <= spoiler_level)
            .where(VNTag.score >= 2.0)  # Strong tag presence only
            .where(VNTag.lie == False)  # exclude disputed/incorrect tags
        )
        if exclude_vn_ids:
            query = query.where(VNTag.vn_id.notin_(exclude_vn_ids))

        query = (
            query
            .group_by(VNTag.vn_id)
            .order_by(func.max(VNTag.score).desc())
            .limit(limit)
        )

        result = await self.db.execute(query)
        elite_vns = {row.vn_id for row in result.all()}

        logger.info(f"Elite tag query found {len(elite_vns)} VNs matching tags {elite_tag_ids}")
        return elite_vns

    async def _get_cooccurrence_candidates(
        self,
        high_rated_vns: list[str],
        exclude_vn_ids: set[str],
        limit: int,
    ) -> set[str]:
        """
        Get candidates from VNCoOccurrence - VNs that fans of user's favorites also read.
        This ensures VNs with high co-occurrence (but different tag profiles) are considered.
        """
        if not high_rated_vns:
            return set()

        query = (
            select(VNCoOccurrence.similar_vn_id)
            .where(VNCoOccurrence.vn_id.in_(high_rated_vns[:20]))
            .where(VNCoOccurrence.user_count >= 20)  # Minimum confidence
        )
        if exclude_vn_ids:
            query = query.where(VNCoOccurrence.similar_vn_id.notin_(exclude_vn_ids))

        query = query.order_by(VNCoOccurrence.co_rating_score.desc()).limit(limit)

        result = await self.db.execute(query)
        cooccurrence_vns = {row.similar_vn_id for row in result.all()}

        logger.info(f"Co-occurrence candidates: {len(cooccurrence_vns)} VNs from top favorites")
        return cooccurrence_vns

    async def _batch_get_similar_games_scores(
        self,
        candidate_ids: list[str],
        high_rated_vns: list[str],
        vn_scores: dict[str, float] = None,
    ) -> dict[str, tuple[float, list[dict]]]:
        """
        Score candidates by similarity to user's favorites using VNSimilarity table.
        This is the same data shown in "Similar Games" on VN pages.

        Contributions are weighted by how highly the user rated the source VN.
        VNs rated 10.0 contribute more than VNs rated 8.5.

        Returns: {vn_id: (score, [{source_vn_id, similarity}])}
        """
        if not high_rated_vns or not candidate_ids:
            return {}

        vn_scores = vn_scores or {}

        # Query VNSimilarity: for each candidate, find how similar it is to user's favorites
        query = (
            select(
                VNSimilarity.similar_vn_id,
                VNSimilarity.vn_id.label('source_vn_id'),
                VNSimilarity.similarity_score,
            )
            .where(VNSimilarity.vn_id.in_(high_rated_vns[:20]))
            .where(VNSimilarity.similar_vn_id.in_(candidate_ids))
            .order_by(VNSimilarity.similarity_score.desc())
        )

        result = await self.db.execute(query)
        rows = result.all()

        # Aggregate: candidate gets credit for being similar to ANY favorite
        # Weight by how highly the user rated the source VN
        candidate_data: dict[str, list[tuple[str, float, float]]] = {}  # vn_id -> [(source_id, similarity, user_rating_weight)]
        for row in rows:
            cand_id = row.similar_vn_id
            source_vn_id = row.source_vn_id
            # User's rating of source VN (0-10 scale), normalized to 0-1
            # VNs rated 10.0 get full weight, 8.5 gets 0.85 weight
            user_rating_weight = vn_scores.get(source_vn_id, 7.0) / 10.0
            if cand_id not in candidate_data:
                candidate_data[cand_id] = []
            candidate_data[cand_id].append((source_vn_id, row.similarity_score, user_rating_weight))

        # Compute final scores
        # Score = weighted_best_match + weighted_avg, with bonus for multiple matches
        final_scores = {}
        for cand_id, matches in candidate_data.items():
            # Weight similarity scores by user's rating of the source VN
            weighted_scores = [(m[1] * m[2]) for m in matches]
            raw_scores = [m[1] for m in matches]

            max_weighted = max(weighted_scores)
            avg_weighted = sum(weighted_scores) / len(weighted_scores)

            # Bonus for matching multiple favorites (up to 30%)
            match_bonus = min(1.3, 1.0 + len(matches) * 0.05)
            score = (0.6 * max_weighted + 0.4 * avg_weighted) * match_bonus

            # Store details for display (top 5 matches, sorted by weighted score)
            sorted_matches = sorted(matches, key=lambda x: -(x[1] * x[2]))[:5]
            details = [
                {"source_vn_id": m[0], "similarity": m[1], "user_rating_weight": round(m[2], 2)}
                for m in sorted_matches
            ]
            final_scores[cand_id] = (min(1.0, score), details)

        logger.info(f"Similar Games scores: {len(final_scores)} candidates")
        return final_scores

    async def _batch_get_users_also_read_scores(
        self,
        candidate_ids: list[str],
        high_rated_vns: list[str],
        vn_scores: dict[str, float] = None,
    ) -> dict[str, tuple[float, list[dict]]]:
        """
        Score candidates by co-occurrence patterns using VNCoOccurrence table.
        This is the same data shown in "Users Also Read" on VN pages.

        Contributions are weighted by how highly the user rated the source VN.
        VNs rated 10.0 contribute more than VNs rated 8.5.

        Returns: {vn_id: (score, [{source_vn_id, co_score, user_count}])}
        """
        if not high_rated_vns or not candidate_ids:
            logger.info("Users Also Read: skipping - no high_rated_vns or candidates")
            return {}

        vn_scores = vn_scores or {}

        logger.info(f"Users Also Read query: high_rated_vns[:5]={high_rated_vns[:5]}, {len(candidate_ids)} candidates")

        # Query VNCoOccurrence: for each candidate, find co-rating with user's favorites
        query = (
            select(
                VNCoOccurrence.similar_vn_id,
                VNCoOccurrence.vn_id.label('source_vn_id'),
                VNCoOccurrence.co_rating_score,
                VNCoOccurrence.user_count,
            )
            .where(VNCoOccurrence.vn_id.in_(high_rated_vns[:20]))
            .where(VNCoOccurrence.similar_vn_id.in_(candidate_ids))
            .order_by(VNCoOccurrence.co_rating_score.desc())
        )

        result = await self.db.execute(query)
        rows = result.all()
        logger.info(f"Users Also Read: {len(rows)} co-occurrence rows found")

        # Aggregate per candidate
        # Store tuple: (source_vn_id, co_rating_score, user_count, user_rating_weight)
        candidate_data: dict[str, list[tuple[str, float, int, float]]] = {}
        for row in rows:
            cand_id = row.similar_vn_id
            source_vn_id = row.source_vn_id
            # User's rating of source VN (0-10 scale), normalized to 0-1
            # VNs rated 10.0 get full weight, 8.5 gets 0.85 weight
            user_rating_weight = vn_scores.get(source_vn_id, 7.0) / 10.0
            if cand_id not in candidate_data:
                candidate_data[cand_id] = []
            candidate_data[cand_id].append((source_vn_id, row.co_rating_score, row.user_count, user_rating_weight))

        # Compute final scores
        # co_rating_score ranges from ~0-12, normalize to 0-1 for proper weighting
        CO_RATING_SCALE = 10.0  # Normalize by dividing by this value

        final_scores = {}
        for cand_id, matches in candidate_data.items():
            # Normalize and weight raw scores by user's rating of source VN
            weighted_scores = [min(1.0, m[1] / CO_RATING_SCALE) * m[3] for m in matches]
            user_counts = [m[2] for m in matches]

            max_score = max(weighted_scores)
            avg_score = sum(weighted_scores) / len(weighted_scores)
            total_users = sum(user_counts)

            # Confidence based on user count (max at 50 total users)
            confidence = min(1.0, total_users / 50)
            # Bonus for multiple matching favorites
            match_bonus = min(1.3, 1.0 + len(matches) * 0.05)

            score = (0.6 * max_score + 0.4 * avg_score) * confidence * match_bonus

            # Store details (top 5 matches, sorted by weighted score)
            sorted_matches = sorted(matches, key=lambda x: -(x[1] / CO_RATING_SCALE * x[3]))[:5]
            details = [
                {"source_vn_id": m[0], "co_score": m[1], "user_count": m[2], "user_rating_weight": round(m[3], 2)}
                for m in sorted_matches
            ]
            final_scores[cand_id] = (min(1.0, score), details)

        logger.info(f"Users Also Read scores: {len(final_scores)} candidates")
        return final_scores

    async def _get_candidates(
        self,
        exclude_vn_ids: set[str],
        min_rating: Optional[float],
        min_length: Optional[int],
        max_length: Optional[int],
        include_tags: Optional[list[int]],
        exclude_tags: Optional[list[int]],
        include_traits: Optional[list[int]],
        exclude_traits: Optional[list[int]],
        limit: int,
        high_rated_vns: Optional[list[str]] = None,
        elite_tag_ids: Optional[set[int]] = None,
        japanese_only: bool = True,
        spoiler_level: int = 0,
    ) -> list[dict]:
        """
        Get candidate VNs using similarity-based selection.

        Instead of just top-rated VNs, we now:
        1. Get VNs similar to user's favorites (from VNSimilarity table)
        2. Add some random exploration (20% of results)
        3. Add VNs matching elite tags (user's top 5) to ensure rare tag coverage
        4. Apply user's filters
        5. Fallback to quality-based selection if no similarity data
        6. Filter by original language if japanese_only=True
        7. Filter by character traits if specified
        """
        all_candidate_ids: set[str] = set()

        # Try similarity-based candidates if user has favorites
        if high_rated_vns:
            try:
                similar_candidate_ids = await self._get_similar_vn_candidates(
                    high_rated_vns=high_rated_vns,
                    exclude_vn_ids=exclude_vn_ids,
                    limit=int(limit * 0.8),  # 80% from similarity
                    spoiler_level=spoiler_level,
                )
                all_candidate_ids.update(similar_candidate_ids)
            except Exception as e:
                logger.warning(f"Similarity lookup failed: {e}")

        # Add random exploration candidates
        try:
            exploration_limit = max(50, int(limit * 0.2))
            exploration_query = select(VisualNovel.id).where(
                VisualNovel.rating >= 6.0  # Decent quality (VNDB scale is 1-10)
            )
            if exclude_vn_ids:
                exploration_query = exploration_query.where(
                    VisualNovel.id.notin_(exclude_vn_ids)
                )
            if japanese_only:
                exploration_query = exploration_query.where(
                    VisualNovel.olang == "ja"
                )
            exploration_query = exploration_query.order_by(func.random()).limit(
                exploration_limit * 3
            )
            exploration_result = await self.db.execute(exploration_query)
            exploration_ids = {row.id for row in exploration_result.all()}
            all_candidate_ids.update(exploration_ids)
        except Exception as e:
            logger.warning(f"Exploration query failed: {e}")

        # Add elite tag candidates - VNs matching user's top 5 tags
        # These bypass the normal >= 3 tag filter to ensure rare tag matches
        if elite_tag_ids:
            try:
                elite_candidates = await self._get_elite_tag_candidates(
                    elite_tag_ids=elite_tag_ids,
                    exclude_vn_ids=exclude_vn_ids.union(all_candidate_ids),
                    limit=50,
                    spoiler_level=spoiler_level,
                )
                all_candidate_ids.update(elite_candidates)
                logger.info(f"Added {len(elite_candidates)} elite tag candidates")
            except Exception as e:
                logger.warning(f"Elite tag candidate query failed: {e}")

        # Add co-occurrence candidates - VNs that fans of user's favorites also read
        # This ensures high co-occurrence VNs (with different tag profiles) are considered
        if high_rated_vns:
            try:
                cooccurrence_candidates = await self._get_cooccurrence_candidates(
                    high_rated_vns=high_rated_vns,
                    exclude_vn_ids=exclude_vn_ids.union(all_candidate_ids),
                    limit=100,  # Get plenty since these are high-quality candidates
                )
                all_candidate_ids.update(cooccurrence_candidates)
                logger.info(f"Added {len(cooccurrence_candidates)} co-occurrence candidates")
            except Exception as e:
                logger.warning(f"Co-occurrence candidate query failed: {e}")

        # Fallback: if still no candidates, get top-rated VNs directly
        if not all_candidate_ids:
            logger.info("Using fallback candidate selection (no similarity data)")
            fallback_query = select(
                VisualNovel.id,
                VisualNovel.title,
                VisualNovel.title_jp,
                VisualNovel.title_romaji,
                VisualNovel.image_url,
                VisualNovel.image_sexual,
                VisualNovel.rating,
                VisualNovel.average_rating,
                VisualNovel.length,
            ).where(VisualNovel.rating.isnot(None))

            if exclude_vn_ids:
                fallback_query = fallback_query.where(
                    VisualNovel.id.notin_(exclude_vn_ids)
                )
            if min_rating is not None:
                fallback_query = fallback_query.where(VisualNovel.rating >= min_rating)
            if min_length is not None:
                fallback_query = fallback_query.where(VisualNovel.length >= min_length)
            if max_length is not None:
                fallback_query = fallback_query.where(VisualNovel.length <= max_length)
            if japanese_only:
                fallback_query = fallback_query.where(VisualNovel.olang == "ja")

            # Order by rating for fallback (better than random)
            fallback_query = fallback_query.order_by(VisualNovel.rating.desc())
            fallback_query = fallback_query.limit(limit)

            result = await self.db.execute(fallback_query)
            candidates = [
                {
                    "id": row.id,
                    "title": row.title,
                    "title_jp": row.title_jp,
                    "title_romaji": row.title_romaji,
                    "image_url": row.image_url,
                    "image_sexual": row.image_sexual,
                    "rating": row.rating,
                    "average_rating": row.average_rating,
                    "length": row.length,
                }
                for row in result.all()
            ]

            if include_tags or exclude_tags:
                candidates = await self._filter_by_tags(
                    candidates, include_tags, exclude_tags, spoiler_level=spoiler_level
                )
            if include_traits or exclude_traits:
                candidates = await self._filter_by_traits(
                    candidates, include_traits, exclude_traits, spoiler_level=spoiler_level
                )
            return candidates

        # Normal path: fetch full VN details for collected candidates
        query = select(
            VisualNovel.id,
            VisualNovel.title,
            VisualNovel.title_jp,
            VisualNovel.title_romaji,
            VisualNovel.image_url,
            VisualNovel.image_sexual,
            VisualNovel.rating,
            VisualNovel.average_rating,
            VisualNovel.length,
        ).where(VisualNovel.id.in_(all_candidate_ids))

        # Apply filters
        if min_rating is not None:
            query = query.where(VisualNovel.rating >= min_rating)
        if min_length is not None:
            query = query.where(VisualNovel.length >= min_length)
        if max_length is not None:
            query = query.where(VisualNovel.length <= max_length)
        if japanese_only:
            query = query.where(VisualNovel.olang == "ja")

        # No popularity ordering - let the scoring decide
        query = query.limit(limit)

        result = await self.db.execute(query)
        candidates = [
            {
                "id": row.id,
                "title": row.title,
                "title_jp": row.title_jp,
                "title_romaji": row.title_romaji,
                "image_url": row.image_url,
                "image_sexual": row.image_sexual,
                "rating": row.rating,
                "average_rating": row.average_rating,
                "length": row.length,
            }
            for row in result.all()
        ]

        # Apply tag filters if specified
        if include_tags or exclude_tags:
            candidates = await self._filter_by_tags(
                candidates, include_tags, exclude_tags, spoiler_level=spoiler_level
            )

        # Apply trait filters if specified
        if include_traits or exclude_traits:
            candidates = await self._filter_by_traits(
                candidates, include_traits, exclude_traits, spoiler_level=spoiler_level
            )

        return candidates

    async def _filter_by_tags(
        self,
        candidates: list[dict],
        include_tags: Optional[list[int]],
        exclude_tags: Optional[list[int]],
        spoiler_level: int = 0,
    ) -> list[dict]:
        """Filter candidates by tag requirements."""
        filtered = []
        for vn in candidates:
            vn_tags = await self._get_vn_tags(vn["id"], spoiler_level=spoiler_level)
            vn_tag_ids = set(vn_tags.keys())

            # Check include tags (VN must have at least one)
            if include_tags:
                if not vn_tag_ids.intersection(set(include_tags)):
                    continue

            # Check exclude tags (VN must not have any)
            if exclude_tags:
                if vn_tag_ids.intersection(set(exclude_tags)):
                    continue

            filtered.append(vn)

        return filtered

    async def _filter_by_traits(
        self,
        candidates: list[dict],
        include_traits: Optional[list[int]],
        exclude_traits: Optional[list[int]],
        spoiler_level: int = 0,
    ) -> list[dict]:
        """Filter candidates by character trait requirements.

        Traits are linked to characters, not directly to VNs, so we need to:
        1. Get all characters for each VN
        2. Get all traits for those characters
        3. Check if the VN matches the trait requirements
        """
        if not include_traits and not exclude_traits:
            return candidates

        # Get all VN IDs we need to check
        vn_ids = [vn["id"] for vn in candidates]

        # Batch query: get trait IDs for each VN through character relationships
        # VN -> CharacterVN -> CharacterTrait -> trait_id
        query = (
            select(CharacterVN.vn_id, CharacterTrait.trait_id)
            .join(CharacterTrait, CharacterVN.character_id == CharacterTrait.character_id)
            .where(CharacterVN.vn_id.in_(vn_ids))
            .where(CharacterTrait.spoiler_level <= spoiler_level)
        )
        result = await self.db.execute(query)

        # Build a map of vn_id -> set of trait_ids
        vn_traits: dict[str, set[int]] = {}
        for row in result.all():
            vn_id = row[0]
            trait_id = row[1]
            if vn_id not in vn_traits:
                vn_traits[vn_id] = set()
            vn_traits[vn_id].add(trait_id)

        # Filter candidates
        filtered = []
        for vn in candidates:
            vn_trait_ids = vn_traits.get(vn["id"], set())

            # Check include traits (VN must have at least one character with the trait)
            if include_traits:
                if not vn_trait_ids.intersection(set(include_traits)):
                    continue

            # Check exclude traits (VN must not have any character with the trait)
            if exclude_traits:
                if vn_trait_ids.intersection(set(exclude_traits)):
                    continue

            filtered.append(vn)

        return filtered

    async def _compute_tag_score(self, user_profile: dict, vn_id: str) -> float:
        """
        Compute tag similarity score between user profile and VN.

        Uses cosine similarity between:
        - User's weighted tag preferences
        - VN's tag vector
        """
        user_tags = user_profile["tag_weights"]
        if not user_tags:
            return 0.0

        vn_tags = await self._get_vn_tags(vn_id)
        if not vn_tags:
            return 0.0

        # Compute dot product (cosine similarity numerator)
        dot_product = 0.0
        for tag_id, vn_score in vn_tags.items():
            if tag_id in user_tags:
                dot_product += user_tags[tag_id] * vn_score

        # Compute magnitudes
        user_magnitude = np.sqrt(sum(v ** 2 for v in user_tags.values()))
        vn_magnitude = np.sqrt(sum(v ** 2 for v in vn_tags.values()))

        if user_magnitude == 0 or vn_magnitude == 0:
            return 0.0

        # Cosine similarity
        similarity = dot_product / (user_magnitude * vn_magnitude)

        # Normalize to 0-1 range (similarity can be negative)
        return max(0.0, min(1.0, (similarity + 1) / 2))

    async def _compute_collab_score(
        self, user_votes: list[dict], vn_id: str
    ) -> float:
        """
        Compute collaborative filtering score.

        Finds users who highly rated the same VNs as this user,
        then checks if they also highly rated the candidate VN.
        """
        # Get user's highly rated VNs
        high_rated = [
            v.get("vn_id") or v.get("id")
            for v in user_votes
            if (v.get("score") or v.get("vote", 0)) >= 85
        ]

        if not high_rated:
            return 0.0

        try:
            # Find users who also rated these VNs highly
            similar_users_query = (
                select(GlobalVote.user_hash)
                .where(GlobalVote.vn_id.in_(high_rated))
                .where(GlobalVote.vote >= 85)
                .group_by(GlobalVote.user_hash)
                .having(func.count(GlobalVote.vn_id) >= 2)  # At least 2 overlapping
                .limit(100)
            )
            result = await self.db.execute(similar_users_query)
            similar_users = [row.user_hash for row in result.all()]

            if not similar_users:
                return 0.0

            # Check if these users rated the candidate VN
            votes_query = (
                select(func.avg(GlobalVote.vote), func.count(GlobalVote.vote))
                .where(GlobalVote.vn_id == vn_id)
                .where(GlobalVote.user_hash.in_(similar_users))
            )
            result = await self.db.execute(votes_query)
            row = result.first()

            if not row or row[1] == 0:
                return 0.0

            avg_vote = row[0]
            vote_count = row[1]

            # Score based on average vote and confidence (vote count)
            # Normalize to 0-1 range
            base_score = (avg_vote - 50) / 50  # -1 to 1
            confidence = min(1.0, vote_count / 10)  # Max confidence at 10 votes

            return max(0.0, base_score * confidence)

        except Exception as e:
            logger.warning(f"Collab score failed for {vn_id}: {e}")
            return 0.0

    async def _compute_staff_score(
        self, user_votes: list[dict], vn_id: str
    ) -> float:
        """
        Compute staff/developer match score.

        Gives bonus if VN shares staff/developers with user's favorites.
        """
        # Get user's high-rated VNs
        high_rated = [
            v.get("vn_id") or v.get("id")
            for v in user_votes
            if (v.get("score") or v.get("vote", 0)) >= 85
        ]

        if not high_rated:
            return 0.0

        # Get staff and developers from user's favorites
        user_staff = set()
        user_developers = set()
        for rated_vn_id in high_rated[:20]:  # Limit for performance
            staff = await self._get_vn_staff(rated_vn_id)
            user_staff.update(staff)
            developers = await self._get_vn_developers(rated_vn_id)
            user_developers.update(developers)

        if not user_staff and not user_developers:
            return 0.0

        # Check candidate VN's staff/developers
        vn_staff = set(await self._get_vn_staff(vn_id))
        vn_developers = set(await self._get_vn_developers(vn_id))

        staff_overlap = len(user_staff.intersection(vn_staff))
        developer_overlap = len(user_developers.intersection(vn_developers))

        # Score based on overlap
        score = 0.0
        if developer_overlap > 0:
            score += 0.5  # Developer match is strong signal
        if staff_overlap > 0:
            score += min(0.5, staff_overlap * 0.1)  # Staff matches add up

        return min(1.0, score)


async def get_recommendations_for_user(
    db: AsyncSession,
    vndb_uid: str,
    user_votes: list[dict],
    exclude_vn_ids: set[str],
    limit: int = 50,
    **filters
) -> list[RecommendationResult]:
    """
    Convenience function to get recommendations for a user.

    Args:
        db: Database session
        vndb_uid: User's VNDB ID (for logging)
        user_votes: User's VN ratings
        exclude_vn_ids: VNs to exclude
        limit: Max results
        **filters: Additional filters (min_rating, min_length, etc)

    Returns:
        List of recommendations
    """
    recommender = HybridRecommender(db)

    try:
        results = await recommender.recommend(
            user_votes=user_votes,
            exclude_vn_ids=exclude_vn_ids,
            limit=limit,
            **filters
        )
        logger.info(f"Generated {len(results)} recommendations for {vndb_uid}")
        return results
    except Exception as e:
        logger.error(f"Recommendation failed for {vndb_uid}: {e}")
        return []
