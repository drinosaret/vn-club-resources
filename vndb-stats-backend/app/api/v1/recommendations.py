"""
Recommendation endpoints.

============================================================================
DATA SOURCE: LOCAL POSTGRESQL DATABASE + PRECOMPUTED MODELS
============================================================================
All recommendations are generated from the LOCAL PostgreSQL database,
which is populated daily from VNDB database dumps. The recommendation
algorithms use:

- Tag vectors: Precomputed from local VN-tag relationships
- Collaborative filtering: Trained on local user vote data
- Staff/seiyuu/producer affinity: Computed from local staff tables
- VN-VN similarity: Precomputed and cached in UserRecommendationCache

This approach provides:
- Complete coverage (40k+ VNs in the model)
- Fast responses (precomputed, not computed on-demand from API)
- Accurate recommendations (full dataset, not API-limited samples)

>>> DO NOT add VNDB API calls for recommendation features <<<

The only VNDB API usage is in UserService for fetching the user's
current VN list (to know what they've played/rated).
============================================================================
"""

import asyncio
import time
from datetime import datetime, timedelta
from enum import Enum
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.dialects.postgresql import insert
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.db.database import get_db, async_session

# Rate limiter for expensive recommendation endpoints
limiter = Limiter(key_func=get_remote_address)
from app.db import schemas
from app.db.models import UserRecommendationCache, VisualNovel
from app.core.auth import is_admin_request
from app.services.recommendation_service import RecommendationService
from app.services.user_service import UserService
from app.services.hybrid_recommender import HybridRecommender, RecommendationResult

MAX_FILTER_IDS = 30

# Cache configuration
CACHE_TTL_HOURS = 24  # Consider cache fresh for 24 hours

router = APIRouter()


class RecommendationMethod(str, Enum):
    """Available recommendation methods."""
    # Original methods
    TAG = "tag"
    COLLABORATIVE = "collaborative"
    HYBRID = "hybrid"
    COMBINED = "combined"  # Multi-signal combining all methods
    # Affinity-based methods
    TAGS_AFFINITY = "tags_affinity"
    TRAITS_AFFINITY = "traits_affinity"
    STAFF_AFFINITY = "staff_affinity"
    SEIYUU_AFFINITY = "seiyuu_affinity"
    PRODUCER_AFFINITY = "producer_affinity"
    # Special methods
    SIMILAR_NOVELS = "similar_novels"
    SIMILAR_USERS = "similar_users"


@router.get("/{vndb_uid}", response_model=schemas.RecommendationsResponse)
@limiter.limit("10/minute")
async def get_recommendations(
    request: Request,
    vndb_uid: str,
    method: RecommendationMethod = Query(
        default=RecommendationMethod.HYBRID,
        description="Recommendation algorithm to use"
    ),
    limit: int = Query(default=20, ge=1, le=100, description="Number of recommendations"),
    exclude_wishlist: bool = Query(default=True, description="Exclude VNs in wishlist"),
    min_rating: float = Query(default=0, ge=0, le=10, description="Minimum VNDB rating"),
    length_filter: Optional[str] = Query(
        default=None,
        description="Filter by VN length: very_short, short, medium, long, very_long"
    ),
    spoiler_level: int = Query(
        default=0, ge=0, le=2,
        description="Max tag/trait spoiler level: 0=none, 1=minor, 2=major"
    ),
    skip_explanations: bool = Query(
        default=False,
        description="Skip generating personalized explanations (faster)"
    ),
    db: AsyncSession = Depends(get_db),
):
    """
    Get personalized VN recommendations for a user.

    Methods:
    - tag: Content-based filtering using tag similarity
    - collaborative: User-based collaborative filtering
    - hybrid: Combination of both (recommended)
    - tags_affinity: Based on user's loved tags
    - traits_affinity: Based on preferred character traits
    - staff_affinity: Based on preferred staff (writers, artists, etc.)
    - seiyuu_affinity: Based on preferred voice actors
    - producer_affinity: Based on preferred developers/publishers
    - similar_novels: VNs similar to user's favorites
    - similar_users: What similar users rated highly

    Filters:
    - length_filter: Filter by VN length category
    - spoiler_level: Max spoiler level for tag/trait visibility

    Each recommendation includes:
    - Match score and confidence
    - Human-readable reasons
    - VN metadata
    - Method-specific matched entities (tags, traits, staff, etc.)
    """
    user_service = UserService(db)
    rec_service = RecommendationService(db)

    user_data = await user_service.get_user_list(vndb_uid)

    if not user_data:
        raise HTTPException(status_code=404, detail=f"User {vndb_uid} not found")

    # Only exclude VNs the user has consumed (not wishlist or custom lists)
    # Labels: 1=Playing, 2=Finished, 3=Stalled, 4=Dropped, 8=Blacklist
    labels = user_data.get("labels", {})
    consumed_labels = ["1", "2", "3", "4"]  # Playing, Finished, Stalled, Dropped

    exclude_vns = set()
    for label_id in consumed_labels:
        exclude_vns.update(labels.get(label_id, []))

    # Get dropped and blacklisted counts for messaging
    dropped_ids = set(labels.get("4", []))  # Dropped
    blacklisted_ids = set(labels.get("8", []))  # Blacklist
    exclude_vns.update(blacklisted_ids)

    # Note: exclude_wishlist param kept for backwards compatibility but no longer needed
    # since wishlist is not included in exclude_vns by default

    recommendations = await rec_service.get_recommendations(
        vndb_uid=vndb_uid,
        user_votes=user_data.get("votes", []),
        exclude_vns=exclude_vns,
        method=method.value,
        limit=limit,
        min_rating=min_rating,
        length_filter=length_filter,
        spoiler_level=spoiler_level,
        skip_explanations=skip_explanations,
    )

    # Build exclusion message
    dropped_count = len(dropped_ids)
    blacklisted_count = len(blacklisted_ids)
    total_excluded = len(exclude_vns)

    exclusion_message = None
    if dropped_count > 0 or blacklisted_count > 0:
        parts = []
        if blacklisted_count > 0:
            parts.append(f"{blacklisted_count} blacklisted")
        if dropped_count > 0:
            parts.append(f"{dropped_count} dropped")
        exclusion_message = f"Excluding {total_excluded} novel(s) including {' and '.join(parts)}"

    return schemas.RecommendationsResponse(
        method=method.value,
        recommendations=recommendations,
        excluded_count=total_excluded,
        dropped_count=dropped_count,
        blacklisted_count=blacklisted_count,
        total_excluded_message=exclusion_message,
    )


@router.get("/{vndb_uid}/similar/{vn_id}", response_model=schemas.SimilarVNsResponse)
@limiter.limit("30/minute")
async def get_similar_vns(
    request: Request,
    vndb_uid: str,
    vn_id: str,
    limit: int = Query(default=10, ge=1, le=50, description="Number of similar VNs"),
    db: AsyncSession = Depends(get_db),
):
    """
    Find VNs similar to a specific title.

    Uses tag-based similarity to find VNs with similar characteristics.
    Results are filtered to exclude VNs the user has already read.
    """
    user_service = UserService(db)
    rec_service = RecommendationService(db)

    user_data = await user_service.get_user_list(vndb_uid)
    exclude_vns = set(user_data.get("vn_ids", [])) if user_data else set()

    similar = await rec_service.find_similar_vns(
        vn_id=vn_id,
        exclude_vns=exclude_vns,
        limit=limit,
    )

    if not similar:
        raise HTTPException(status_code=404, detail=f"VN {vn_id} not found")

    return similar


# ============ New Simplified Hybrid Endpoint ============


async def get_cached_recommendations(
    db: AsyncSession,
    user_id: str,
    exclude_vn_ids: set[str],
    limit: int,
    min_rating: Optional[float] = None,
    min_length: Optional[int] = None,
    max_length: Optional[int] = None,
    japanese_only: bool = True,
) -> tuple[list[dict], bool]:
    """
    Try to get recommendations from cache.

    Returns:
        (recommendations, is_from_cache)
    """
    cutoff = datetime.utcnow() - timedelta(hours=CACHE_TTL_HOURS)

    # Query cached recommendations with VN details
    query = (
        select(
            UserRecommendationCache.vn_id,
            UserRecommendationCache.combined_score,
            UserRecommendationCache.tag_score,
            UserRecommendationCache.cf_score,
            UserRecommendationCache.hgat_score,
            UserRecommendationCache.users_also_read_score,
            UserRecommendationCache.developer_score,
            UserRecommendationCache.seiyuu_score,
            UserRecommendationCache.trait_score,
            UserRecommendationCache.quality_score,
            UserRecommendationCache.updated_at,
            VisualNovel.title,
            VisualNovel.title_jp,
            VisualNovel.title_romaji,
            VisualNovel.image_url,
            VisualNovel.image_sexual,
            VisualNovel.rating,
            VisualNovel.length,
        )
        .join(VisualNovel, UserRecommendationCache.vn_id == VisualNovel.id)
        .where(UserRecommendationCache.user_id == user_id)
        .where(UserRecommendationCache.updated_at >= cutoff)
        .where(UserRecommendationCache.vn_id.notin_(exclude_vn_ids))
    )

    # Apply filters
    if min_rating is not None:
        query = query.where(VisualNovel.rating >= min_rating)
    if min_length is not None:
        query = query.where(VisualNovel.length >= min_length)
    if max_length is not None:
        query = query.where(VisualNovel.length <= max_length)
    if japanese_only:
        query = query.where(VisualNovel.olang == "ja")

    query = query.order_by(UserRecommendationCache.combined_score.desc())
    query = query.limit(limit)

    result = await db.execute(query)
    rows = result.all()

    if not rows:
        return [], False

    # Format cached results
    recommendations = []
    for row in rows:
        # Build match reasons from scores
        reasons = []
        if row.tag_score and row.tag_score > 0.3:
            reasons.append("Similar tags")
        if row.cf_score and row.cf_score > 0.3:
            reasons.append("Liked by similar users")
        if row.hgat_score and row.hgat_score > 0.3:
            reasons.append("Same developer/writer")

        recommendations.append({
            "vn_id": row.vn_id,
            "title": row.title,
            "title_jp": row.title_jp,
            "title_romaji": row.title_romaji,
            "score": round(row.combined_score, 3),
            "match_reasons": reasons if reasons else ["Matches your preferences"],
            "image_url": row.image_url,
            "image_sexual": row.image_sexual,
            "rating": row.rating,
            "scores": {
                "tag": round(row.tag_score or 0, 3),
                "similar_games": round(row.cf_score or 0, 3),
                "users_also_read": round(row.users_also_read_score or 0, 3),
                "developer": round(row.developer_score or 0, 3),
                "staff": round(row.hgat_score or 0, 3),
                "seiyuu": round(row.seiyuu_score or 0, 3),
                "trait": round(row.trait_score or 0, 3),
                "quality": round(row.quality_score or 0, 3),
            }
        })

    return recommendations, True


async def cache_recommendations_async(
    user_id: str,
    results: list[RecommendationResult],
):
    """Cache recommendations in the background (non-blocking).

    Creates its own database session to avoid conflicts with the request session.
    """
    if not results:
        return

    now = datetime.utcnow()
    records = [
        {
            "user_id": user_id,
            "vn_id": r.vn_id,
            "combined_score": r.score,
            "tag_score": r.tag_score,
            "cf_score": r.similar_games_score,  # Legacy column name
            "hgat_score": r.staff_score,  # Legacy column name
            "users_also_read_score": r.users_also_read_score,
            "developer_score": r.developer_score,
            "seiyuu_score": r.seiyuu_score,
            "trait_score": r.trait_score,
            "quality_score": r.quality_score,
            "updated_at": now,
        }
        for r in results
    ]

    try:
        # Use a new session for background task to avoid conflicts with request session
        async with async_session() as db:
            stmt = insert(UserRecommendationCache).values(records)
            stmt = stmt.on_conflict_do_update(
                index_elements=["user_id", "vn_id"],
                set_={
                    "combined_score": stmt.excluded.combined_score,
                    "tag_score": stmt.excluded.tag_score,
                    "cf_score": stmt.excluded.cf_score,
                    "hgat_score": stmt.excluded.hgat_score,
                    "users_also_read_score": stmt.excluded.users_also_read_score,
                    "developer_score": stmt.excluded.developer_score,
                    "seiyuu_score": stmt.excluded.seiyuu_score,
                    "trait_score": stmt.excluded.trait_score,
                    "quality_score": stmt.excluded.quality_score,
                    "updated_at": stmt.excluded.updated_at,
                },
            )
            await db.execute(stmt)
            await db.commit()
    except Exception:
        # Cache write failed - silently ignore
        pass


@router.get("/{vndb_uid}/v2")
@limiter.limit("10/minute")
async def get_recommendations_v2(
    request: Request,
    vndb_uid: str,
    limit: int = Query(default=50, ge=1, le=200, description="Number of recommendations"),
    min_rating: Optional[float] = Query(default=None, description="Minimum global rating"),
    min_length: Optional[int] = Query(default=None, ge=1, le=5, description="Minimum length (1-5)"),
    max_length: Optional[int] = Query(default=None, ge=1, le=5, description="Maximum length (1-5)"),
    include_tags: Optional[str] = Query(default=None, description="Comma-separated tag IDs to include"),
    exclude_tags: Optional[str] = Query(default=None, description="Comma-separated tag IDs to exclude"),
    include_traits: Optional[str] = Query(default=None, description="Comma-separated trait IDs to include"),
    exclude_traits: Optional[str] = Query(default=None, description="Comma-separated trait IDs to exclude"),
    skip_cache: bool = Query(default=False, description="Force fresh computation, bypass cache"),
    include_details: bool = Query(default=False, description="Include full details for popup (slower)"),
    japanese_only: bool = Query(default=True, description="Only show Japanese original language VNs"),
    spoiler_level: int = Query(default=0, ge=0, le=2, description="Max tag/trait spoiler level: 0=none, 1=minor, 2=major"),
    db: AsyncSession = Depends(get_db),
):
    """
    Get personalized VN recommendations using the new hybrid algorithm.

    This endpoint uses a simplified but more effective approach:
    - Tag cosine similarity (weight: 1.5) - content-based
    - Collaborative filtering (weight: 1.0) - "users who liked X also liked Y"
    - Staff/developer match (weight: 0.5) - bonus for preferred creators
    - MMR diversity reranking to prevent result clustering

    **Cache behavior:**
    - Pre-computed recommendations are served from cache when available (<24h old)
    - Cache miss triggers fresh computation and caches results for next time
    - Use `skip_cache=true` to force fresh computation
    - Cache is only used when spoiler_level=0 (default)

    Returns recommendations with match reasons explaining why each VN was recommended.
    """
    total_start = time.time()
    user_service = UserService(db)

    # Get user data
    user_data = await user_service.get_user_list(vndb_uid)
    if not user_data:
        raise HTTPException(status_code=404, detail=f"User {vndb_uid} not found")

    # Only exclude VNs the user has consumed (not wishlist or custom lists)
    # Labels: 1=Playing, 2=Finished, 3=Stalled, 4=Dropped, 8=Blacklist
    labels = user_data.get("labels", {})
    consumed_labels = ["1", "2", "3", "4", "8"]  # Playing, Finished, Stalled, Dropped, Blacklist
    exclude_vn_ids = set()
    for label_id in consumed_labels:
        exclude_vn_ids.update(labels.get(label_id, []))

    # Filter votes to only include Finished VNs (label 2) to match stats page calculation
    finished_vn_ids = set(labels.get("2", []))
    all_votes = user_data.get("votes", [])
    user_votes = [v for v in all_votes if v.get("vn_id") in finished_vn_ids]

    # Only allow cache bypass for admin requests
    if skip_cache and not await is_admin_request(request):
        skip_cache = False

    # Parse tag filters (not cacheable - applied post-hoc)
    include_tag_ids = None
    exclude_tag_ids = None
    if include_tags:
        include_tag_ids = [int(t.strip()) for t in include_tags.split(",") if t.strip().isdigit()][:MAX_FILTER_IDS]
    if exclude_tags:
        exclude_tag_ids = [int(t.strip()) for t in exclude_tags.split(",") if t.strip().isdigit()][:MAX_FILTER_IDS]

    # Parse trait filters (not cacheable - applied post-hoc)
    include_trait_ids = None
    exclude_trait_ids = None
    if include_traits:
        include_trait_ids = [int(t.strip()) for t in include_traits.split(",") if t.strip().isdigit()][:MAX_FILTER_IDS]
    if exclude_traits:
        exclude_trait_ids = [int(t.strip()) for t in exclude_traits.split(",") if t.strip().isdigit()][:MAX_FILTER_IDS]

    # Try cache first (if no tag/trait filters, not skipped, and default spoiler level)
    # Cache is computed at spoiler_level=0, so bypass for higher levels
    from_cache = False
    if not skip_cache and not include_tag_ids and not exclude_tag_ids and not include_trait_ids and not exclude_trait_ids and spoiler_level == 0:
        cached_results, from_cache = await get_cached_recommendations(
            db=db,
            user_id=vndb_uid,
            exclude_vn_ids=exclude_vn_ids,
            limit=limit,
            min_rating=min_rating,
            min_length=min_length,
            max_length=max_length,
            japanese_only=japanese_only,
        )
        if from_cache and cached_results:
            elapsed = time.time() - total_start
            return {
                "recommendations": cached_results,
                "count": len(cached_results),
                "excluded_count": len(exclude_vn_ids),
                "elapsed_seconds": round(elapsed, 2),
                "from_cache": True,
            }

    # Cache miss - compute fresh recommendations
    recommender = HybridRecommender(db)
    results = await recommender.recommend(
        user_votes=user_votes,
        exclude_vn_ids=exclude_vn_ids,
        limit=limit,
        min_rating=min_rating,
        min_length=min_length,
        max_length=max_length,
        include_tags=include_tag_ids,
        exclude_tags=exclude_tag_ids,
        include_traits=include_trait_ids,
        exclude_traits=exclude_trait_ids,
        skip_details=not include_details,
        japanese_only=japanese_only,
        spoiler_level=spoiler_level,
    )

    elapsed = time.time() - total_start

    # Cache results in background (don't block response) - only cache at default spoiler level
    if results and not include_tag_ids and not exclude_tag_ids and not include_trait_ids and not exclude_trait_ids and spoiler_level == 0:
        asyncio.create_task(cache_recommendations_async(vndb_uid, results))

    # Format response
    recommendations_data = []
    for r in results:
        rec = {
            "vn_id": r.vn_id,
            "title": r.title,
            "title_jp": r.title_jp,
            "title_romaji": r.title_romaji,
            "score": round(r.score, 3),
            "normalized_score": r.normalized_score,
            "match_reasons": r.match_reasons,
            "image_url": r.image_url,
            "image_sexual": r.image_sexual,
            "rating": r.rating,
            "scores": {
                "tag": round(r.tag_score, 3),
                "similar_games": round(r.similar_games_score, 3),
                "users_also_read": round(r.users_also_read_score, 3),
                "developer": round(r.developer_score, 3),
                "staff": round(r.staff_score, 3),
                "seiyuu": round(r.seiyuu_score, 3),
                "trait": round(r.trait_score, 3),
                "quality": round(r.quality_score, 3),
            },
        }
        # Only include details if requested (to reduce payload size)
        if include_details:
            rec["details"] = {
                "matched_tags": r.matched_tags,
                "matched_staff": r.matched_staff,
                "matched_developers": r.matched_developers,
                "matched_seiyuu": r.matched_seiyuu,
                "matched_traits": r.matched_traits,
                "contributing_vns": r.contributing_vns,
                "similar_games": r.similar_games_details,
                "users_also_read": r.users_also_read_details,
            }
        recommendations_data.append(rec)

    return {
        "recommendations": recommendations_data,
        "count": len(results),
        "excluded_count": len(exclude_vn_ids),
        "elapsed_seconds": round(elapsed, 2),
        "from_cache": False,
    }


@router.get("/{vndb_uid}/v2/details/{vn_id}")
@limiter.limit("30/minute")
async def get_recommendation_details(
    request: Request,
    vndb_uid: str,
    vn_id: str,
    spoiler_level: int = Query(0, ge=0, le=2, description="Max tag/trait spoiler level (0=None, 1=Minor, 2=Major)"),
    db: AsyncSession = Depends(get_db),
):
    """
    Get detailed breakdown for why a specific VN was recommended to a user.

    This endpoint computes the detailed match reasons for a single VN,
    useful for showing a "Why this recommendation?" popup without
    slowing down the main recommendations list.

    Returns:
    - matched_tags: Tags that match user preferences with weighted scores
    - matched_staff: Staff members from user's preferred creators
    - matched_developers: Developers from user's preferred studios
    - contributing_vns: User's VNs that are similar to this one
    - collab: Collaborative filtering details (similar users who rated this)
    """
    total_start = time.time()
    user_service = UserService(db)

    # Get user data
    user_data = await user_service.get_user_list(vndb_uid)
    if not user_data:
        raise HTTPException(status_code=404, detail=f"User {vndb_uid} not found")

    # Filter votes to only include Finished VNs (label 2) to match stats page calculation
    labels = user_data.get("labels", {})
    finished_vn_ids = set(labels.get("2", []))
    all_votes = user_data.get("votes", [])
    user_votes = [v for v in all_votes if v.get("vn_id") in finished_vn_ids]

    # Use optimized single-VN details method
    recommender = HybridRecommender(db)
    result = await recommender.get_details_for_vn(
        user_votes=user_votes,
        vn_id=vn_id,
        spoiler_level=spoiler_level,
    )

    if not result:
        raise HTTPException(status_code=404, detail=f"VN {vn_id} not found")

    elapsed = time.time() - total_start

    return {
        "vn_id": result.vn_id,
        "title": result.title,
        "score": round(result.score, 3),
        "normalized_score": result.normalized_score,
        "scores": {
            "tag": round(result.tag_score, 3),
            "similar_games": round(result.similar_games_score, 3),
            "users_also_read": round(result.users_also_read_score, 3),
            "developer": round(result.developer_score, 3),
            "staff": round(result.staff_score, 3),
            "seiyuu": round(result.seiyuu_score, 3),
            "trait": round(result.trait_score, 3),
            "quality": round(result.quality_score, 3),
        },
        "details": {
            "matched_tags": result.matched_tags,
            "matched_staff": result.matched_staff,
            "matched_developers": result.matched_developers,
            "matched_seiyuu": result.matched_seiyuu,
            "matched_traits": result.matched_traits,
            "contributing_vns": result.contributing_vns,
            "similar_games": result.similar_games_details,
            "users_also_read": result.users_also_read_details,
        },
        "elapsed_seconds": round(elapsed, 2),
    }
