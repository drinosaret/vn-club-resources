"""Recommendation engine service."""

import asyncio
import logging
import sys
from datetime import datetime

from typing import Literal, Optional

import numpy as np
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db.models import (
    VisualNovel, Tag, VNTag, GlobalVote,
    CFVNFactors, TagVNVector,
)
from app.db.schemas import (
    Recommendation, SimilarVNsResponse, VNSummary, SimilarVN,
)
from app.services.diversity_reranker import apply_diversity_reranking
from app.services.explanation_service import ExplanationService
from app.services.preference_extractor import PreferenceExtractor, UserPreferences
from app.services.affinity_recommenders import (
    TagAffinityRecommender,
    TraitAffinityRecommender,
    StaffAffinityRecommender,
    SeiyuuAffinityRecommender,
    ProducerAffinityRecommender,
    SimilarToFavoritesRecommender,
    SimilarUsersRecommender,
    HGATRecommender,
    PrecomputedSimilarityRecommender,
    ItemItemCFRecommender,
    HybridCFRecommender,
)
from app.services.user_cache_service import UserCacheService

logger = logging.getLogger(__name__)
settings = get_settings()


class TagBasedRecommender:
    """Content-based filtering using tag vectors."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self._tag_to_idx: dict[int, int] = {}
        self._num_tags: int = 0

    async def _load_tag_index(self):
        """Load tag ID to index mapping."""
        if self._tag_to_idx:
            return

        result = await self.db.execute(
            select(Tag.id).where(Tag.applicable == True).order_by(Tag.id)
        )
        tags = result.scalars().all()

        self._tag_to_idx = {tid: idx for idx, tid in enumerate(tags)}
        self._num_tags = len(tags)

    async def build_user_profile(self, user_votes: list[dict]) -> np.ndarray:
        """
        Create weighted tag vector from user's rated VNs.
        Higher-rated VNs contribute more to the profile.
        """
        await self._load_tag_index()

        profile = np.zeros(self._num_tags)
        total_weight = 0

        # Build VN ID to weight mapping
        vn_weights = {}
        for vote in user_votes:
            weight = (vote["score"] - 50) / 50  # Normalize 10-100 to -0.8 to 1
            vn_weights[vote["vn_id"]] = weight
            total_weight += abs(weight)

        if not vn_weights:
            return profile

        # Try to use precomputed vectors first (single batch query)
        vn_ids = list(vn_weights.keys())
        result = await self.db.execute(
            select(TagVNVector.vn_id, TagVNVector.tag_vector)
            .where(TagVNVector.vn_id.in_(vn_ids))
        )
        cached_vectors = {r.vn_id: np.array(r.tag_vector) for r in result.all()}

        # For VNs with precomputed vectors, add directly to profile
        for vn_id, vec in cached_vectors.items():
            weight = vn_weights[vn_id]
            profile += vec * weight

        # For VNs without precomputed vectors, batch fetch tags
        missing_vns = set(vn_ids) - set(cached_vectors.keys())
        if missing_vns:
            result = await self.db.execute(
                select(VNTag.vn_id, VNTag.tag_id, VNTag.score)
                .where(VNTag.vn_id.in_(missing_vns))
                .where(VNTag.spoiler_level == 0)
                .where(VNTag.score > 0)
                .where(VNTag.lie == False)  # exclude disputed/incorrect tags
            )
            for row in result.all():
                if row.tag_id in self._tag_to_idx:
                    idx = self._tag_to_idx[row.tag_id]
                    weight = vn_weights[row.vn_id]
                    profile[idx] += row.score * weight

        # Normalize
        if total_weight > 0:
            profile /= total_weight

        norm = np.linalg.norm(profile)
        if norm > 0:
            profile /= norm

        return profile

    async def get_vn_tag_vector(self, vn_id: str) -> np.ndarray:
        """Get tag vector for a VN."""
        await self._load_tag_index()

        # Check precomputed vectors first
        result = await self.db.execute(
            select(TagVNVector.tag_vector).where(TagVNVector.vn_id == vn_id)
        )
        cached = result.scalar_one_or_none()
        if cached:
            return np.array(cached)

        # Compute on the fly
        vector = np.zeros(self._num_tags)

        result = await self.db.execute(
            select(VNTag.tag_id, VNTag.score)
            .where(VNTag.vn_id == vn_id)
            .where(VNTag.spoiler_level == 0)
            .where(VNTag.score > 0)
            .where(VNTag.lie == False)  # exclude disputed/incorrect tags
        )

        for tag_id, score in result.all():
            if tag_id in self._tag_to_idx:
                idx = self._tag_to_idx[tag_id]
                vector[idx] = score

        # Normalize
        norm = np.linalg.norm(vector)
        if norm > 0:
            vector /= norm

        return vector

    async def recommend(
        self,
        user_votes: list[dict],
        exclude_vns: set[str],
        limit: int = 20,
        min_rating: float = 0,
    ) -> list[dict]:
        """Find VNs most similar to user's taste profile."""
        if not user_votes:
            return []

        user_profile = await self.build_user_profile(user_votes)

        # Get candidate VNs with precomputed vectors in single query
        query = (
            select(TagVNVector.vn_id, TagVNVector.tag_vector)
            .join(VisualNovel, VisualNovel.id == TagVNVector.vn_id)
            .where(~TagVNVector.vn_id.in_(exclude_vns) if exclude_vns else True)
        )
        if min_rating > 0:
            query = query.where(VisualNovel.rating >= min_rating)

        result = await self.db.execute(query.limit(2000))
        candidates = result.all()

        # Calculate similarities in batch
        similarities = []
        for vn_id, tag_vector in candidates:
            vn_vector = np.array(tag_vector)
            sim = float(np.dot(user_profile, vn_vector))
            if sim > 0:
                similarities.append((vn_id, sim))

        # Sort and return top N
        similarities.sort(key=lambda x: x[1], reverse=True)
        return [{"vn_id": v, "tag_score": s} for v, s in similarities[:limit]]


class CollaborativeRecommender:
    """Collaborative filtering using precomputed factors."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_vn_factors(self, vn_id: str) -> np.ndarray | None:
        """Get precomputed CF factors for a VN."""
        result = await self.db.execute(
            select(CFVNFactors.factors).where(CFVNFactors.vn_id == vn_id)
        )
        factors = result.scalar_one_or_none()
        return np.array(factors) if factors else None

    async def recommend_for_user(
        self,
        user_votes: list[dict],
        exclude_vns: set[str],
        limit: int = 20,
    ) -> list[dict]:
        """
        For users not in training data, compute factors on-the-fly
        using their votes to find similar items.
        """
        if not user_votes:
            return []

        # Get VN factors for user's rated VNs (batch query)
        vote_vn_ids = [v["vn_id"] for v in user_votes]
        result = await self.db.execute(
            select(CFVNFactors.vn_id, CFVNFactors.factors)
            .where(CFVNFactors.vn_id.in_(vote_vn_ids))
        )
        vn_factors_map = {r.vn_id: np.array(r.factors) for r in result.all()}

        # Build weighted factors
        rated_factors = []
        weights = []
        for vote in user_votes:
            factors = vn_factors_map.get(vote["vn_id"])
            if factors is not None:
                rated_factors.append(factors)
                weights.append((vote["score"] - 50) / 50)

        if not rated_factors:
            return []

        # Compute pseudo user factors (weighted average)
        user_factors = np.average(rated_factors, weights=weights, axis=0)

        # Get all VN factors (excluding user's VNs)
        result = await self.db.execute(
            select(CFVNFactors.vn_id, CFVNFactors.factors)
            .where(~CFVNFactors.vn_id.in_(exclude_vns) if exclude_vns else True)
            .limit(5000)
        )
        all_vn_factors = result.all()

        # Calculate scores
        scores = []
        for vn_id, vn_factors in all_vn_factors:
            score = float(np.dot(user_factors, np.array(vn_factors)))
            scores.append((vn_id, score))

        scores.sort(key=lambda x: x[1], reverse=True)
        return [{"vn_id": v, "cf_score": s} for v, s in scores[:limit]]


class RecommendationService:
    """Main recommendation service combining multiple methods."""

    # All supported methods
    METHODS = [
        "tag", "collaborative", "hybrid", "combined",
        "tags_affinity", "traits_affinity", "staff_affinity",
        "seiyuu_affinity", "producer_affinity",
        "similar_novels", "similar_users",
        "hgat", "similar_novels_fast",  # HGAT and precomputed similarity
        "item_item_cf",  # Item-item collaborative filtering
        "hybrid_cf",  # Hybrid CF+content (LightFM alternative)
        "combined_cached",  # Fast combined from cache
    ]

    def __init__(self, db: AsyncSession):
        self.db = db
        self.tag_recommender = TagBasedRecommender(db)
        self.cf_recommender = CollaborativeRecommender(db)
        self.tag_weight = settings.tag_weight
        self.cf_weight = settings.cf_weight
        # Affinity-based recommenders
        self.tag_affinity_recommender = TagAffinityRecommender(db)
        self.trait_affinity_recommender = TraitAffinityRecommender(db)
        self.staff_affinity_recommender = StaffAffinityRecommender(db)
        self.seiyuu_affinity_recommender = SeiyuuAffinityRecommender(db)
        self.producer_affinity_recommender = ProducerAffinityRecommender(db)
        self.similar_to_favorites_recommender = SimilarToFavoritesRecommender(db)
        self.similar_users_recommender = SimilarUsersRecommender(db)
        # New recommenders
        self.hgat_recommender = HGATRecommender(db)
        self.precomputed_similarity_recommender = PrecomputedSimilarityRecommender(db)
        self.item_item_cf_recommender = ItemItemCFRecommender(db)
        self.hybrid_cf_recommender = HybridCFRecommender(db)
        # Cache service
        self.cache_service = UserCacheService(db)

    async def get_recommendations(
        self,
        vndb_uid: str,
        user_votes: list[dict],
        exclude_vns: set[str],
        method: str = "hybrid",
        limit: int = 20,
        min_rating: float = 0,
        length_filter: Optional[str] = None,
        spoiler_level: int = 0,
        skip_explanations: bool = False,
    ) -> list[Recommendation]:
        """Get personalized recommendations."""
        # Only extract user preferences if needed for affinity methods or explanations
        needs_prefs = method in [
            "tags_affinity", "traits_affinity", "staff_affinity",
            "seiyuu_affinity", "producer_affinity"
        ] or not skip_explanations

        user_prefs = None
        pref_error = None
        if needs_prefs:
            try:
                pref_extractor = PreferenceExtractor(self.db)
                user_prefs = await pref_extractor.extract_preferences(vndb_uid)
            except Exception as e:
                pref_error = str(e)
                logger.error(f"Preference extraction failed for {vndb_uid}: {e}")

        if method == "tag":
            recs = await self.tag_recommender.recommend(
                user_votes, exclude_vns, limit, min_rating
            )
            for r in recs:
                r["cf_score"] = None
                r["score"] = r["tag_score"]

        elif method == "collaborative":
            recs = await self.cf_recommender.recommend_for_user(
                user_votes, exclude_vns, limit
            )
            for r in recs:
                r["tag_score"] = None
                r["score"] = r["cf_score"]

        elif method == "tags_affinity":
            if not user_prefs:
                logger.warning(f"[{method}] No user_prefs for {vndb_uid}, error: {pref_error}")
                return []
            recs = await self.tag_affinity_recommender.recommend(
                user_prefs=user_prefs,
                exclude_vns=exclude_vns,
                limit=limit,
                min_rating=min_rating,
                spoiler_level=spoiler_level,
                length_filter=length_filter,
            )

        elif method == "traits_affinity":
            if not user_prefs:
                logger.warning(f"[{method}] No user_prefs for {vndb_uid}, error: {pref_error}")
                return []
            recs = await self.trait_affinity_recommender.recommend(
                user_prefs=user_prefs,
                exclude_vns=exclude_vns,
                limit=limit,
                min_rating=min_rating,
                spoiler_level=spoiler_level,
                length_filter=length_filter,
            )

        elif method == "staff_affinity":
            if not user_prefs:
                logger.warning(f"[{method}] No user_prefs for {vndb_uid}, error: {pref_error}")
                return []
            recs = await self.staff_affinity_recommender.recommend(
                user_prefs=user_prefs,
                exclude_vns=exclude_vns,
                limit=limit,
                min_rating=min_rating,
                length_filter=length_filter,
            )

        elif method == "seiyuu_affinity":
            if not user_prefs:
                logger.warning(f"[{method}] No user_prefs for {vndb_uid}, error: {pref_error}")
                return []
            recs = await self.seiyuu_affinity_recommender.recommend(
                user_prefs=user_prefs,
                exclude_vns=exclude_vns,
                limit=limit,
                min_rating=min_rating,
                length_filter=length_filter,
            )

        elif method == "producer_affinity":
            if not user_prefs:
                logger.warning(f"[{method}] No user_prefs for {vndb_uid}, error: {pref_error}")
                return []
            recs = await self.producer_affinity_recommender.recommend(
                user_prefs=user_prefs,
                exclude_vns=exclude_vns,
                limit=limit,
                min_rating=min_rating,
                length_filter=length_filter,
            )

        elif method == "similar_novels":
            recs = await self.similar_to_favorites_recommender.recommend(
                user_votes, exclude_vns, limit, min_rating, length_filter=length_filter
            )

        elif method == "similar_users":
            recs = await self.similar_users_recommender.recommend(
                user_votes, exclude_vns, limit, min_rating, length_filter=length_filter
            )

        elif method == "hgat":
            # HGAT graph neural network embeddings
            recs = await self.hgat_recommender.recommend(
                user_votes, exclude_vns, limit, min_rating, length_filter=length_filter
            )

        elif method == "similar_novels_fast":
            # Fast similar novels using precomputed VN-VN similarity matrix
            recs = await self.precomputed_similarity_recommender.recommend(
                user_votes, exclude_vns, limit, min_rating, length_filter=length_filter
            )

        elif method == "item_item_cf":
            # Item-item collaborative filtering: "users who liked X also liked Y"
            recs = await self.item_item_cf_recommender.recommend(
                user_votes, exclude_vns, limit, min_rating, length_filter=length_filter
            )

        elif method == "hybrid_cf":
            # Hybrid CF+content embeddings (LightFM alternative, works on all Python versions)
            recs = await self.hybrid_cf_recommender.recommend(
                user_votes, exclude_vns, limit, min_rating, length_filter=length_filter
            )

        elif method == "combined_cached":
            # Try to get cached combined recommendations first
            cached = await self.cache_service.get_cached_recommendations(
                vndb_uid, exclude_vns, limit, min_rating, length_filter
            )
            if cached:
                recs = cached
            else:
                # Fall back to computing combined (will also cache the result)
                recs = await self._multi_signal_recommend(
                    user_votes, user_prefs, exclude_vns, limit, min_rating,
                    spoiler_level, length_filter
                )
                # Cache the results for next time
                await self.cache_service.store_recommendations(vndb_uid, recs)

        elif method == "combined":
            # Multi-signal needs user_prefs for affinity methods
            if not user_prefs:
                try:
                    pref_extractor = PreferenceExtractor(self.db)
                    user_prefs = await pref_extractor.extract_preferences(vndb_uid)
                except Exception as e:
                    logger.warning(f"Failed to extract preferences for multi-signal: {e}")

            recs = await self._multi_signal_recommend(
                user_votes, user_prefs, exclude_vns, limit, min_rating,
                spoiler_level, length_filter
            )

        else:  # hybrid (default)
            recs = await self._hybrid_recommend(
                user_votes, exclude_vns, limit, min_rating
            )

        # Enrich with VN details and personalized explanations
        return await self._enrich_recommendations(recs, user_prefs, skip_explanations=skip_explanations)

    async def _hybrid_recommend(
        self,
        user_votes: list[dict],
        exclude_vns: set[str],
        limit: int,
        min_rating: float,
        apply_diversity: bool = True,
    ) -> list[dict]:
        """Combine tag-based and collaborative recommendations."""
        # Get recommendations from both systems
        # Request more candidates for diversity reranking
        candidate_limit = limit * 3 if apply_diversity else limit * 2

        tag_recs = await self.tag_recommender.recommend(
            user_votes, exclude_vns, candidate_limit, min_rating
        )
        cf_recs = await self.cf_recommender.recommend_for_user(
            user_votes, exclude_vns, candidate_limit
        )

        # Normalize scores
        tag_scores = self._normalize_scores({r["vn_id"]: r["tag_score"] for r in tag_recs})
        cf_scores = self._normalize_scores({r["vn_id"]: r["cf_score"] for r in cf_recs})

        # Combine with weights
        all_vns = set(tag_scores.keys()) | set(cf_scores.keys())
        combined = []

        for vn_id in all_vns:
            tag_s = tag_scores.get(vn_id, 0)
            cf_s = cf_scores.get(vn_id, 0)
            final_score = self.tag_weight * tag_s + self.cf_weight * cf_s
            combined.append({
                "vn_id": vn_id,
                "score": final_score,
                "tag_score": tag_s if vn_id in tag_scores else None,
                "cf_score": cf_s if vn_id in cf_scores else None,
            })

        combined.sort(key=lambda x: x["score"], reverse=True)

        # Apply diversity reranking to reduce popularity bias and ensure variety
        if apply_diversity and len(combined) > limit:
            try:
                reranked = await apply_diversity_reranking(
                    self.db,
                    combined[:limit * 2],  # Rerank top candidates
                    diversity_lambda=0.6,   # Balance relevance vs diversity
                    novelty_weight=0.15,    # Penalize very popular items
                    top_k=limit,
                )
                # Merge diversity metadata back
                original_by_id = {r["vn_id"]: r for r in combined}

                result = []
                for r in reranked:
                    orig = original_by_id.get(r["vn_id"], {})
                    result.append({
                        "vn_id": r["vn_id"],
                        "score": r["score"],
                        "original_score": r.get("original_score"),
                        "tag_score": orig.get("tag_score"),
                        "cf_score": orig.get("cf_score"),
                        "diversity_applied": True,
                    })
                return result
            except Exception as e:
                logger.warning(f"Diversity reranking failed, using original order: {e}")

        return combined[:limit]

    async def _multi_signal_recommend(
        self,
        user_votes: list[dict],
        user_prefs: Optional[UserPreferences],
        exclude_vns: set[str],
        limit: int,
        min_rating: float,
        spoiler_level: int = 0,
        length_filter: Optional[str] = None,
    ) -> list[dict]:
        """
        True multi-signal recommendation combining all methods.

        Runs all recommenders sequentially, normalizes scores,
        and combines with configurable weights.
        """
        import traceback

        try:
            return await self._multi_signal_recommend_impl(
                user_votes, user_prefs, exclude_vns, limit, min_rating,
                spoiler_level, length_filter
            )
        except Exception as e:
            logger.error(f"Multi-signal recommendation failed: {e}\n{traceback.format_exc()}")
            # Fall back to hybrid method
            logger.info("Falling back to hybrid method")
            return await self._hybrid_recommend(user_votes, exclude_vns, limit, min_rating)

    async def _multi_signal_recommend_impl(
        self,
        user_votes: list[dict],
        user_prefs: Optional[UserPreferences],
        exclude_vns: set[str],
        limit: int,
        min_rating: float,
        spoiler_level: int = 0,
        length_filter: Optional[str] = None,
    ) -> list[dict]:
        """Implementation of multi-signal recommendation."""
        candidate_limit = 60  # Get top 60 from each method

        # Define async tasks - handle user_prefs being None
        async def safe_tag_affinity():
            if not user_prefs:
                return []
            try:
                return await self.tag_affinity_recommender.recommend(
                    user_prefs=user_prefs,
                    exclude_vns=exclude_vns,
                    limit=candidate_limit,
                    min_rating=min_rating,
                    spoiler_level=spoiler_level,
                    length_filter=length_filter,
                )
            except Exception as e:
                logger.warning(f"Tag affinity failed: {e}")
                return []

        async def safe_trait_affinity():
            if not user_prefs:
                return []
            try:
                return await self.trait_affinity_recommender.recommend(
                    user_prefs=user_prefs,
                    exclude_vns=exclude_vns,
                    limit=candidate_limit,
                    min_rating=min_rating,
                    spoiler_level=spoiler_level,
                    length_filter=length_filter,
                )
            except Exception as e:
                logger.warning(f"Trait affinity failed: {e}")
                return []

        async def safe_staff_affinity():
            if not user_prefs:
                return []
            try:
                return await self.staff_affinity_recommender.recommend(
                    user_prefs=user_prefs,
                    exclude_vns=exclude_vns,
                    limit=candidate_limit,
                    min_rating=min_rating,
                    length_filter=length_filter,
                )
            except Exception as e:
                logger.warning(f"Staff affinity failed: {e}")
                return []

        async def safe_seiyuu_affinity():
            if not user_prefs:
                return []
            try:
                return await self.seiyuu_affinity_recommender.recommend(
                    user_prefs=user_prefs,
                    exclude_vns=exclude_vns,
                    limit=candidate_limit,
                    min_rating=min_rating,
                    length_filter=length_filter,
                )
            except Exception as e:
                logger.warning(f"Seiyuu affinity failed: {e}")
                return []

        async def safe_producer_affinity():
            if not user_prefs:
                return []
            try:
                return await self.producer_affinity_recommender.recommend(
                    user_prefs=user_prefs,
                    exclude_vns=exclude_vns,
                    limit=candidate_limit,
                    min_rating=min_rating,
                    length_filter=length_filter,
                )
            except Exception as e:
                logger.warning(f"Producer affinity failed: {e}")
                return []

        async def safe_similar_favorites():
            try:
                return await self.similar_to_favorites_recommender.recommend(
                    user_votes, exclude_vns, candidate_limit, min_rating,
                    length_filter=length_filter
                )
            except Exception as e:
                logger.warning(f"Similar favorites failed: {e}")
                return []

        async def safe_similar_users():
            try:
                return await self.similar_users_recommender.recommend(
                    user_votes, exclude_vns, candidate_limit, min_rating,
                    length_filter=length_filter
                )
            except Exception as e:
                logger.warning(f"Similar users failed: {e}")
                return []

        # Wrap tag and CF recommenders with safe error handling
        async def safe_tag():
            try:
                return await self.tag_recommender.recommend(user_votes, exclude_vns, candidate_limit, min_rating)
            except Exception as e:
                logger.warning(f"Tag recommender failed: {e}")
                return []

        async def safe_cf():
            try:
                return await self.cf_recommender.recommend_for_user(user_votes, exclude_vns, candidate_limit)
            except Exception as e:
                logger.warning(f"CF recommender failed: {e}")
                return []

        async def safe_precomputed_similarity():
            try:
                return await self.precomputed_similarity_recommender.recommend(
                    user_votes, exclude_vns, candidate_limit, min_rating,
                    length_filter=length_filter
                )
            except Exception as e:
                logger.warning(f"Precomputed similarity failed: {e}")
                return []

        async def safe_item_item_cf():
            try:
                return await self.item_item_cf_recommender.recommend(
                    user_votes, exclude_vns, candidate_limit, min_rating,
                    length_filter=length_filter
                )
            except Exception as e:
                logger.warning(f"Item-item CF failed: {e}")
                return []

        # Run ALL recommenders in parallel for speed
        logger.info("[Multi-signal] Starting all recommenders in parallel")
        (
            tag_recs, cf_recs, tag_aff_recs, trait_recs, staff_recs,
            seiyuu_recs, producer_recs, similar_fav_recs, similar_user_recs,
            precomputed_sim_recs, item_item_cf_recs
        ) = await asyncio.gather(
            safe_tag(),
            safe_cf(),
            safe_tag_affinity(),
            safe_trait_affinity(),
            safe_staff_affinity(),
            safe_seiyuu_affinity(),
            safe_producer_affinity(),
            safe_similar_favorites(),
            safe_similar_users(),
            safe_precomputed_similarity(),
            safe_item_item_cf(),
        )
        logger.info(f"[Multi-signal] Results: tag={len(tag_recs)}, cf={len(cf_recs)}, tag_aff={len(tag_aff_recs)}, traits={len(trait_recs)}, staff={len(staff_recs)}, seiyuu={len(seiyuu_recs)}, producer={len(producer_recs)}, fav={len(similar_fav_recs)}, users={len(similar_user_recs)}, precomputed_sim={len(precomputed_sim_recs)}, item_cf={len(item_item_cf_recs)}")

        # Build match data lookup from all recommenders
        vn_match_data: dict[str, dict] = {}

        def collect_matches(recs: list[dict], field_map: dict[str, str]):
            """Collect match metadata from recommender results into vn_match_data."""
            for rec in recs:
                vn_id = rec["vn_id"]
                if vn_id not in vn_match_data:
                    vn_match_data[vn_id] = {}
                for src_field, dest_field in field_map.items():
                    if rec.get(src_field):
                        vn_match_data[vn_id][dest_field] = rec[src_field]

        collect_matches(tag_aff_recs, {"matched_tags": "matched_tags"})
        collect_matches(trait_recs, {"matched_traits": "matched_traits"})
        collect_matches(staff_recs, {"matched_staff": "matched_staff"})
        collect_matches(seiyuu_recs, {"matched_staff": "matched_seiyuu"})  # seiyuu uses matched_staff key
        collect_matches(producer_recs, {"matched_producer": "matched_producer"})
        collect_matches(similar_fav_recs, {"similar_to_titles": "similar_to_titles"})
        collect_matches(similar_user_recs, {"similar_user_count": "similar_user_count"})
        collect_matches(precomputed_sim_recs, {"similar_to_titles": "precomputed_similar_to"})
        collect_matches(item_item_cf_recs, {"co_rated_with": "co_rated_with"})

        # Build score dictionaries for each method
        scores = {
            'tag': self._normalize_scores({r["vn_id"]: r.get("tag_score", r.get("score", 0)) for r in tag_recs}),
            'cf': self._normalize_scores({r["vn_id"]: r.get("cf_score", r.get("score", 0)) for r in cf_recs}),
            'tag_affinity': self._normalize_scores({r["vn_id"]: r.get("score", 0) for r in tag_aff_recs}),
            'trait_affinity': self._normalize_scores({r["vn_id"]: r.get("score", 0) for r in trait_recs}),
            'staff_affinity': self._normalize_scores({r["vn_id"]: r.get("score", 0) for r in staff_recs}),
            'seiyuu_affinity': self._normalize_scores({r["vn_id"]: r.get("score", 0) for r in seiyuu_recs}),
            'producer_affinity': self._normalize_scores({r["vn_id"]: r.get("score", 0) for r in producer_recs}),
            'similar_favorites': self._normalize_scores({r["vn_id"]: r.get("score", 0) for r in similar_fav_recs}),
            'similar_users': self._normalize_scores({r["vn_id"]: r.get("score", 0) for r in similar_user_recs}),
            'precomputed_similarity': self._normalize_scores({r["vn_id"]: r.get("score", 0) for r in precomputed_sim_recs}),
            'item_item_cf': self._normalize_scores({r["vn_id"]: r.get("score", 0) for r in item_item_cf_recs}),
        }

        # Equal weights for all signals (11 total now)
        equal_weight = 1 / 11
        weights = {
            'tag': equal_weight,
            'cf': equal_weight,
            'tag_affinity': equal_weight,
            'trait_affinity': equal_weight,
            'staff_affinity': equal_weight,
            'seiyuu_affinity': equal_weight,
            'producer_affinity': equal_weight,
            'similar_favorites': equal_weight,
            'similar_users': equal_weight,
            'precomputed_similarity': equal_weight,
            'item_item_cf': equal_weight,
        }

        # Collect all candidate VN IDs
        all_vn_ids = set()
        for method_scores in scores.values():
            all_vn_ids.update(method_scores.keys())

        logger.info(f"Multi-signal: {len(all_vn_ids)} unique candidates from {len(scores)} methods")

        # Calculate combined scores
        combined = []
        for vn_id in all_vn_ids:
            final_score = 0
            method_scores_for_vn = {}
            methods_matched = 0

            for method, method_scores_dict in scores.items():
                score = method_scores_dict.get(vn_id, 0)
                method_scores_for_vn[method] = score
                final_score += weights[method] * score
                if score > 0:
                    methods_matched += 1

            # Apply multi-method bonus
            if methods_matched >= 7:
                final_score *= 1.25  # 25% bonus for 7+ methods
            elif methods_matched >= 5:
                final_score *= 1.15  # 15% bonus for 5+ methods

            combined.append({
                "vn_id": vn_id,
                "score": final_score,
                "tag_score": method_scores_for_vn.get('tag'),
                "cf_score": method_scores_for_vn.get('cf'),
                "methods_matched": methods_matched,
                "signal_scores": method_scores_for_vn,
                # Include match data from all recommenders
                **vn_match_data.get(vn_id, {}),
            })

        # Sort by combined score
        combined.sort(key=lambda x: x["score"], reverse=True)

        # Apply diversity reranking
        if len(combined) > limit:
            try:
                reranked = await apply_diversity_reranking(
                    self.db,
                    combined[:limit * 2],
                    diversity_lambda=0.6,
                    novelty_weight=0.15,
                    top_k=limit,
                )
                # Preserve multi-signal metadata in reranked results
                original_by_id = {r["vn_id"]: r for r in combined}
                result = []
                for r in reranked:
                    orig = original_by_id.get(r["vn_id"], {})
                    result.append({
                        "vn_id": r["vn_id"],
                        "score": r["score"],
                        "tag_score": orig.get("tag_score"),
                        "cf_score": orig.get("cf_score"),
                        "methods_matched": orig.get("methods_matched"),
                        "signal_scores": orig.get("signal_scores"),
                        # Preserve match data from all recommenders
                        "matched_tags": orig.get("matched_tags"),
                        "matched_traits": orig.get("matched_traits"),
                        "matched_staff": orig.get("matched_staff"),
                        "matched_seiyuu": orig.get("matched_seiyuu"),
                        "matched_producer": orig.get("matched_producer"),
                        "similar_to_titles": orig.get("similar_to_titles"),
                        "similar_user_count": orig.get("similar_user_count"),
                    })
                return result
            except Exception as e:
                logger.warning(f"Diversity reranking failed: {e}")

        return combined[:limit]

    def _normalize_scores(self, scores: dict[str, float]) -> dict[str, float]:
        """Normalize scores to 0-1 range."""
        if not scores:
            return {}

        values = list(scores.values())
        min_val = min(values)
        max_val = max(values)

        if max_val == min_val:
            return {k: 0.5 for k in scores}

        return {
            k: (v - min_val) / (max_val - min_val)
            for k, v in scores.items()
        }

    async def _enrich_recommendations(
        self,
        recs: list[dict],
        user_prefs: Optional[UserPreferences] = None,
        skip_explanations: bool = False,
    ) -> list[Recommendation]:
        """Enrich recommendations with VN details and personalized reasons."""
        if not recs:
            return []

        vn_ids = [r["vn_id"] for r in recs]

        # Get VN details
        result = await self.db.execute(
            select(VisualNovel).where(VisualNovel.id.in_(vn_ids))
        )
        vns = {vn.id: vn for vn in result.scalars().all()}

        # Initialize explanation service if we have user preferences and not skipping
        explanation_service = ExplanationService(self.db) if user_prefs and not skip_explanations else None

        enriched = []
        for rec in recs:
            vn = vns.get(rec["vn_id"])
            if not vn:
                continue

            # Generate personalized reasons using explanation service (if not skipped)
            reasons = []

            if user_prefs and explanation_service:
                try:
                    explanations = await explanation_service.generate_explanations(
                        rec["vn_id"], user_prefs, max_explanations=3
                    )
                    reasons = [e.text for e in explanations]
                except Exception:
                    # Explanation generation failed - use fallback reasons
                    pass

            # Fallback to generic reasons if no personalized explanations
            if not reasons:
                if rec.get("tag_score") and rec["tag_score"] > 0.5:
                    reasons.append("Matches your preferred tags")
                if rec.get("cf_score") and rec["cf_score"] > 0.5:
                    reasons.append("Users with similar taste rated highly")
                if vn.rating and vn.rating >= 8:
                    reasons.append(f"Highly rated ({vn.rating:.1f})")

            enriched.append(Recommendation(
                vn_id=vn.id,
                title=vn.title,
                title_jp=vn.title_jp,
                title_romaji=vn.title_romaji,
                image_url=vn.image_url,
                image_sexual=vn.image_sexual,
                rating=vn.rating,
                released=vn.released,
                score=rec["score"],
                reasons=reasons or ["Recommended based on your list"],
                tag_match_score=rec.get("tag_score"),
                cf_score=rec.get("cf_score"),
                olang=vn.olang,
                length=vn.length,
                matched_tags=rec.get("matched_tags"),
                matched_traits=rec.get("matched_traits"),
                matched_staff=rec.get("matched_staff"),
                matched_seiyuu=rec.get("matched_seiyuu"),
                matched_producer=rec.get("matched_producer"),
                # Source traceability for specific methods
                similar_to_titles=rec.get("similar_to_titles"),
                similar_user_count=rec.get("similar_user_count"),
                # Multi-signal combined recommendations
                methods_matched=rec.get("methods_matched"),
                signal_scores=rec.get("signal_scores"),
            ))

        return enriched

    async def find_similar_vns(
        self,
        vn_id: str,
        exclude_vns: set[str],
        limit: int = 10,
    ) -> SimilarVNsResponse | None:
        """Find VNs similar to a given title."""
        # Get base VN
        result = await self.db.execute(
            select(VisualNovel).where(VisualNovel.id == vn_id)
        )
        base_vn = result.scalar_one_or_none()
        if not base_vn:
            return None

        # Get base VN's tag vector
        base_vector = await self.tag_recommender.get_vn_tag_vector(vn_id)

        # Find similar VNs
        result = await self.db.execute(
            select(VisualNovel.id)
            .where(VisualNovel.id != vn_id)
            .where(~VisualNovel.id.in_(exclude_vns))
            .limit(500)
        )
        candidate_ids = [r[0] for r in result.all()]

        similarities = []
        for cand_id in candidate_ids:
            cand_vector = await self.tag_recommender.get_vn_tag_vector(cand_id)
            sim = float(np.dot(base_vector, cand_vector))
            if sim > 0.1:
                similarities.append((cand_id, sim))

        similarities.sort(key=lambda x: x[1], reverse=True)
        top_similar = similarities[:limit]

        # Get VN details
        sim_ids = [s[0] for s in top_similar]
        result = await self.db.execute(
            select(VisualNovel).where(VisualNovel.id.in_(sim_ids))
        )
        vns = {vn.id: vn for vn in result.scalars().all()}

        similar_vns = []
        for vn_id, sim in top_similar:
            vn = vns.get(vn_id)
            if vn:
                similar_vns.append(SimilarVN(
                    vn_id=vn.id,
                    title=vn.title,
                    image_url=vn.image_url,
                    rating=vn.rating,
                    similarity=round(sim, 2),
                    olang=vn.olang,
                ))

        return SimilarVNsResponse(
            base_vn=VNSummary(
                id=base_vn.id,
                title=base_vn.title,
                image_url=base_vn.image_url,
                released=base_vn.released,
                rating=base_vn.rating,
                votecount=base_vn.votecount,
                olang=base_vn.olang,
            ),
            similar=similar_vns,
        )
