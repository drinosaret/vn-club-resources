"""
Extract user preference features for the HGAT recommendation model.

This service converts the weighted scores calculated by stats_service into
feature vectors that can be used as user node features in the knowledge graph.
"""

import logging
from dataclasses import dataclass
from typing import Optional

import numpy as np
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.stats_service import StatsService
from app.db.schemas import UserStatsResponse

logger = logging.getLogger(__name__)


@dataclass
class ImplicitSignals:
    """Implicit feedback signals from user's VN list."""

    wishlist_vns: list[str]  # VN IDs on wishlist (positive signal)
    dropped_vns: list[str]  # VN IDs dropped (negative signal)
    playing_vns: list[str]  # VN IDs currently playing (engaged signal)
    finished_no_vote_vns: list[str]  # Finished but not voted (moderate positive)


@dataclass
class UserPreferences:
    """User preference vectors for HGAT model."""

    # Entity-level preferences (ID -> weighted score)
    tag_affinities: dict[int, float]  # tag_id -> weighted_score
    avoided_tag_affinities: dict[int, float]  # tag_id -> negative weight (for penalty)
    producer_affinities: dict[str, float]  # producer_id -> weighted_score
    staff_affinities: dict[tuple[str, str], float]  # (staff_id, role) -> weighted_score
    seiyuu_affinities: dict[str, float]  # staff_id -> weighted_score
    trait_affinities: dict[int, float]  # trait_id -> weighted_score

    # Aggregate preferences
    avg_rating: float
    total_completed: int
    preferred_length: Optional[int]  # 1-5 scale
    preferred_era: Optional[str]  # "classic" (pre-2015) or "modern"

    # Loved/avoided tags (for explanations)
    loved_tags: list[dict]  # [{id, name, diff}, ...]
    avoided_tags: list[dict]  # [{id, name, diff}, ...]

    # Implicit feedback signals
    implicit_signals: Optional[ImplicitSignals] = None


class PreferenceExtractor:
    """Extract user preferences from stats data."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.stats_service = StatsService(db)

    async def extract_preferences(
        self,
        vndb_uid: str,
        stats: Optional[UserStatsResponse] = None,
    ) -> UserPreferences:
        """
        Extract user preferences from stats data.

        Args:
            vndb_uid: VNDB user ID
            stats: Pre-computed stats (optional, will fetch if not provided)

        Returns:
            UserPreferences object with all preference vectors
        """
        # Fetch stats if not provided
        user_data = None
        if stats is None:
            from app.services.user_service import UserService
            user_service = UserService(self.db)
            user_data = await user_service.get_user_list(vndb_uid)
            if user_data is None:
                raise ValueError(f"User {vndb_uid} not found or list is private")
            stats = await self.stats_service.calculate_user_stats(vndb_uid, user_data)

        # Fetch tag analytics separately (not included in UserStatsResponse)
        tag_analytics = None
        try:
            if user_data is None:
                from app.services.user_service import UserService
                user_service = UserService(self.db)
                user_data = await user_service.get_user_list(vndb_uid)
            tag_analytics = await self.stats_service.calculate_tag_analytics(vndb_uid, user_data)
        except Exception as e:
            logger.warning(f"Failed to fetch tag analytics for {vndb_uid}: {e}")

        # Extract tag preferences (both positive and negative)
        tag_affinities = self._extract_tag_affinities(tag_analytics)
        avoided_tag_affinities = self._extract_avoided_tag_affinities(tag_analytics)

        # Extract entity preferences
        producer_affinities = self._extract_producer_affinities(stats)
        staff_affinities = self._extract_staff_affinities(stats)
        seiyuu_affinities = self._extract_seiyuu_affinities(stats)
        trait_affinities = self._extract_trait_affinities(stats)

        # Extract aggregate preferences
        avg_rating = stats.summary.average_score or 0.0
        total_completed = stats.summary.total_vns or 0

        # Determine preferred length (most common)
        preferred_length = self._get_preferred_length(stats)

        # Determine preferred era
        preferred_era = self._get_preferred_era(stats)

        # Get loved/avoided tags for explanations
        loved_tags = []
        avoided_tags = []
        if tag_analytics and tag_analytics.tag_preferences:
            loved_list = tag_analytics.tag_preferences.get("loved", [])
            avoided_list = tag_analytics.tag_preferences.get("avoided", [])
            loved_tags = [
                {"id": t.tag_id, "name": t.name, "diff": round(t.user_avg - (t.global_avg or 0), 2)}
                for t in loved_list[:20]
            ]
            avoided_tags = [
                {"id": t.tag_id, "name": t.name, "diff": round(t.user_avg - (t.global_avg or 0), 2)}
                for t in avoided_list[:20]
            ]

        # Extract implicit signals from user_data
        implicit_signals = self._extract_implicit_signals(user_data)

        return UserPreferences(
            tag_affinities=tag_affinities,
            avoided_tag_affinities=avoided_tag_affinities,
            producer_affinities=producer_affinities,
            staff_affinities=staff_affinities,
            seiyuu_affinities=seiyuu_affinities,
            trait_affinities=trait_affinities,
            avg_rating=avg_rating,
            total_completed=total_completed,
            preferred_length=preferred_length,
            preferred_era=preferred_era,
            loved_tags=loved_tags,
            avoided_tags=avoided_tags,
            implicit_signals=implicit_signals,
        )

    def _extract_implicit_signals(self, user_data) -> Optional[ImplicitSignals]:
        """
        Extract implicit feedback signals from user's VN list.

        VNDB system labels:
        - 1: Playing
        - 2: Finished
        - 3: Stalled
        - 4: Dropped
        - 5: Wishlist (high priority)
        - 6: Wishlist (medium priority)
        - 7: Wishlist (low priority)
        - 8: Blacklist

        user_data is a dict with:
        - labels: Dict of label_id -> [vn_ids]
        - votes: List of {vn_id, score}
        - wishlist_ids: List of wishlist VN IDs
        """
        if not user_data or not isinstance(user_data, dict):
            return None

        labels = user_data.get("labels", {})
        votes = user_data.get("votes", [])

        # Get voted VN IDs for checking finished-no-vote
        voted_vn_ids = {v.get("vn_id") for v in votes if isinstance(v, dict)}

        # Extract VNs by label
        playing_vns = labels.get("1", []) if isinstance(labels, dict) else []
        dropped_vns = labels.get("4", []) if isinstance(labels, dict) else []
        finished_vns = labels.get("2", []) if isinstance(labels, dict) else []

        # Wishlist: use dedicated field or combine label 5, 6, 7
        wishlist_vns = user_data.get("wishlist_ids", [])
        if not wishlist_vns and isinstance(labels, dict):
            wishlist_vns = labels.get("5", []) + labels.get("6", []) + labels.get("7", [])

        # Finished but no vote
        finished_no_vote_vns = [vn_id for vn_id in finished_vns if vn_id not in voted_vn_ids]

        return ImplicitSignals(
            wishlist_vns=wishlist_vns,
            dropped_vns=dropped_vns,
            playing_vns=playing_vns,
            finished_no_vote_vns=finished_no_vote_vns,
        )

    def _extract_tag_affinities(self, tag_analytics) -> dict[int, float]:
        """Extract tag preferences with weighted scores."""
        affinities = {}

        if not tag_analytics:
            return affinities

        # Use top_tags with weighted scores
        for tag in tag_analytics.top_tags:
            if tag.weighted_score is not None:
                affinities[tag.tag_id] = tag.weighted_score

        return affinities

    def _extract_avoided_tag_affinities(self, tag_analytics) -> dict[int, float]:
        """Extract avoided tag preferences for negative scoring.

        Uses tags where user rates significantly below global average.
        The weight is based on how much lower the user rates these tags.
        """
        affinities = {}

        if not tag_analytics or not tag_analytics.tag_preferences:
            return affinities

        avoided_list = tag_analytics.tag_preferences.get("avoided", [])
        for tag in avoided_list:
            # Calculate penalty weight based on how much user dislikes this tag
            # diff = user_avg - global_avg (negative means user rates lower)
            diff = tag.user_avg - (tag.global_avg or 0)
            if diff < -0.5:
                # Convert negative diff to positive weight for penalty
                # More negative diff = stronger penalty
                affinities[tag.tag_id] = abs(diff)

        return affinities

    def _extract_producer_affinities(self, stats: UserStatsResponse) -> dict[str, float]:
        """Extract producer (developer/publisher) preferences."""
        affinities = {}

        # Developers
        for dev in stats.developers_breakdown:
            if dev.weighted_score is not None:
                affinities[dev.id] = dev.weighted_score

        # Publishers (with lower weight if also a developer)
        for pub in stats.publishers_breakdown:
            if pub.weighted_score is not None:
                if pub.id not in affinities:
                    affinities[pub.id] = pub.weighted_score * 0.8  # Slightly lower weight
                else:
                    # Average if both developer and publisher
                    affinities[pub.id] = (affinities[pub.id] + pub.weighted_score) / 2

        return affinities

    def _extract_staff_affinities(self, stats: UserStatsResponse) -> dict[tuple[str, str], float]:
        """Extract staff preferences by role."""
        affinities = {}

        for staff in stats.staff_breakdown:
            if staff.weighted_score is not None:
                key = (staff.id, staff.role)
                affinities[key] = staff.weighted_score

        return affinities

    def _extract_seiyuu_affinities(self, stats: UserStatsResponse) -> dict[str, float]:
        """Extract voice actor preferences."""
        affinities = {}

        for seiyuu in stats.seiyuu_breakdown:
            if seiyuu.weighted_score is not None:
                affinities[seiyuu.id] = seiyuu.weighted_score

        return affinities

    def _extract_trait_affinities(self, stats: UserStatsResponse) -> dict[int, float]:
        """Extract character trait preferences."""
        affinities = {}

        for trait in stats.traits_breakdown:
            if trait.weighted_score is not None:
                affinities[trait.id] = trait.weighted_score

        return affinities

    def _get_preferred_length(self, stats: UserStatsResponse) -> Optional[int]:
        """Determine user's preferred VN length (1-5 scale)."""
        if not stats.length_distribution:
            return None

        # Find length category with highest count
        max_count = 0
        preferred = None

        length_map = {
            "very_short": 1,
            "short": 2,
            "medium": 3,
            "long": 4,
            "very_long": 5,
        }

        for length_name, data in stats.length_distribution.items():
            if isinstance(data, dict) and data.get("count", 0) > max_count:
                max_count = data["count"]
                preferred = length_map.get(length_name)

        return preferred

    def _get_preferred_era(self, stats: UserStatsResponse) -> Optional[str]:
        """Determine if user prefers classic or modern VNs."""
        if not stats.release_year_distribution:
            return None

        classic_count = 0  # pre-2015
        modern_count = 0  # 2015+

        for year_str, count in stats.release_year_distribution.items():
            try:
                year = int(year_str)
                if year < 2015:
                    classic_count += count
                else:
                    modern_count += count
            except ValueError:
                continue

        if classic_count > modern_count * 1.5:
            return "classic"
        elif modern_count > classic_count * 1.5:
            return "modern"
        else:
            return None  # Balanced

    def preferences_to_vector(
        self,
        preferences: UserPreferences,
        mappings: dict,
        embed_dim: int = 64,
    ) -> np.ndarray:
        """
        Convert user preferences to a dense feature vector.

        This creates a fixed-size vector by aggregating preference scores
        across different entity types, suitable for model input.

        Args:
            preferences: UserPreferences object
            mappings: Node ID mappings from graph_builder
            embed_dim: Target embedding dimension

        Returns:
            np.ndarray of shape (embed_dim,)
        """
        # Initialize feature sections
        features = []

        # Section 1: Tag preferences (top-k weighted average)
        tag_features = self._aggregate_entity_features(
            preferences.tag_affinities,
            mappings.get('tag', {}),
            dim=16,
        )
        features.append(tag_features)

        # Section 2: Producer preferences
        producer_features = self._aggregate_entity_features(
            preferences.producer_affinities,
            mappings.get('producer', {}),
            dim=8,
        )
        features.append(producer_features)

        # Section 3: Staff preferences (aggregate across roles)
        staff_scores = {}
        for (staff_id, role), score in preferences.staff_affinities.items():
            if staff_id in staff_scores:
                staff_scores[staff_id] = max(staff_scores[staff_id], score)
            else:
                staff_scores[staff_id] = score

        staff_features = self._aggregate_entity_features(
            staff_scores,
            mappings.get('staff', {}),
            dim=8,
        )
        features.append(staff_features)

        # Section 4: Seiyuu preferences
        seiyuu_features = self._aggregate_entity_features(
            preferences.seiyuu_affinities,
            mappings.get('staff', {}),  # Seiyuu are also in staff
            dim=8,
        )
        features.append(seiyuu_features)

        # Section 5: Trait preferences
        trait_features = self._aggregate_entity_features(
            preferences.trait_affinities,
            mappings.get('trait', {}),
            dim=8,
        )
        features.append(trait_features)

        # Section 6: Aggregate features
        agg_features = np.zeros(16, dtype=np.float32)
        agg_features[0] = preferences.avg_rating / 10.0  # Normalize
        agg_features[1] = np.log1p(preferences.total_completed) / 10.0  # Log scale
        if preferences.preferred_length:
            agg_features[2] = preferences.preferred_length / 5.0
        if preferences.preferred_era == "classic":
            agg_features[3] = 1.0
        elif preferences.preferred_era == "modern":
            agg_features[4] = 1.0
        features.append(agg_features)

        # Concatenate and pad/truncate to embed_dim
        full_vector = np.concatenate(features)

        if len(full_vector) < embed_dim:
            full_vector = np.pad(full_vector, (0, embed_dim - len(full_vector)))
        elif len(full_vector) > embed_dim:
            full_vector = full_vector[:embed_dim]

        return full_vector.astype(np.float32)

    def _aggregate_entity_features(
        self,
        affinities: dict,
        mappings: dict,
        dim: int,
    ) -> np.ndarray:
        """
        Aggregate entity preferences into a fixed-size vector.

        Uses a simple approach: bin entities by their index modulo dim,
        and aggregate scores within each bin.
        """
        features = np.zeros(dim, dtype=np.float32)
        counts = np.zeros(dim, dtype=np.float32)

        for entity_id, score in affinities.items():
            if entity_id in mappings:
                idx = mappings[entity_id] % dim
                features[idx] += score
                counts[idx] += 1

        # Average (avoid division by zero)
        mask = counts > 0
        features[mask] /= counts[mask]

        return features


async def extract_all_user_preferences(
    db: AsyncSession,
    user_ids: list[str],
    mappings: dict,
) -> dict[str, np.ndarray]:
    """
    Extract preference vectors for multiple users.

    Args:
        db: Database session
        user_ids: List of VNDB user IDs
        mappings: Node ID mappings from graph_builder

    Returns:
        Dict of user_id -> preference vector
    """
    extractor = PreferenceExtractor(db)
    results = {}

    for i, uid in enumerate(user_ids):
        try:
            prefs = await extractor.extract_preferences(uid)
            results[uid] = extractor.preferences_to_vector(prefs, mappings)

            if (i + 1) % 100 == 0:
                logger.info(f"Extracted preferences for {i + 1}/{len(user_ids)} users")

        except Exception as e:
            logger.warning(f"Failed to extract preferences for {uid}: {e}")
            # Use zero vector as fallback
            results[uid] = np.zeros(64, dtype=np.float32)

    return results
