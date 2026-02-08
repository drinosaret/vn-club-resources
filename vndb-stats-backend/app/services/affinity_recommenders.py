"""
Affinity-based recommendation engines.

These recommenders use user preference affinities extracted by PreferenceExtractor
to find VNs that match user's favorite tags, traits, staff, seiyuu, and producers.
"""

import logging
import math
from typing import Optional

import numpy as np
from sqlalchemy import select, func, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import (
    VisualNovel, Tag, VNTag, Trait, CharacterTrait, CharacterVN,
    Staff, VNStaff, VNSeiyuu, Producer, ReleaseProducer, ReleaseVN,
    GlobalVote, CFVNFactors, TagVNVector, VNGraphEmbedding, UserGraphEmbedding,
    VNSimilarity, VNCoOccurrence,
)
from app.services.preference_extractor import UserPreferences, PreferenceExtractor

logger = logging.getLogger(__name__)


class TagAffinityRecommender:
    """
    Recommends VNs based on user's tag affinities from preference extraction.

    Uses weighted scoring based on user's tag affinities - tags
    with higher affinity scores contribute more to the VN's score.
    """

    def __init__(self, db: AsyncSession):
        self.db = db

    async def recommend(
        self,
        user_prefs: UserPreferences,
        exclude_vns: set[str],
        limit: int = 20,
        min_rating: float = 0,
        spoiler_level: int = 0,
        length_filter: Optional[str] = None,
    ) -> list[dict]:
        """
        Find VNs that strongly match user's preferred tags.

        Uses weighted scoring based on user's tag affinities - tags
        with higher affinity scores contribute more to the VN's score.

        Args:
            user_prefs: User preferences from PreferenceExtractor
            exclude_vns: VN IDs to exclude (user's list)
            limit: Max recommendations to return
            min_rating: Minimum VNDB rating filter
            spoiler_level: Max tag spoiler level (0=none, 1=minor, 2=major)
            length_filter: Optional length filter

        Returns:
            List of recommendation dicts with vn_id, score, matched_tags
        """
        if not user_prefs.tag_affinities:
            return []

        # Filter tags by minimum threshold and sort by affinity
        MIN_TAG_AFFINITY = 1.5
        sorted_tags = [
            (tid, score) for tid, score in user_prefs.tag_affinities.items()
            if score >= MIN_TAG_AFFINITY
        ]
        sorted_tags.sort(key=lambda x: x[1], reverse=True)
        sorted_tags = sorted_tags[:30]

        if not sorted_tags:
            return []

        tag_ids = [t[0] for t in sorted_tags]
        tag_weights = dict(sorted_tags)

        # Calculate IDF (inverse document frequency) for each tag
        # This penalizes popular tags that appear in many VNs
        idf_query = (
            select(VNTag.tag_id, func.count(VNTag.vn_id.distinct()).label("doc_freq"))
            .where(VNTag.tag_id.in_(tag_ids))
            .where(VNTag.lie == False)  # exclude disputed/incorrect tags
            .group_by(VNTag.tag_id)
        )
        idf_result = await self.db.execute(idf_query)
        tag_doc_freq = {row.tag_id: row.doc_freq for row in idf_result.all()}

        # Get total VN count for IDF calculation
        total_vns_result = await self.db.execute(
            select(func.count(VisualNovel.id))
        )
        total_vns = total_vns_result.scalar_one_or_none() or 1

        # Apply IDF weighting: affinity * log(N / df)
        # Rare tags get boosted, common tags get dampened
        idf_weighted_tags = {}
        for tag_id, affinity in tag_weights.items():
            df = tag_doc_freq.get(tag_id, 1)
            idf = math.log(total_vns / (df + 1))
            idf_weighted_tags[tag_id] = affinity * idf

        # Max score for normalizing to 0-100 display
        max_tag_score = max(idf_weighted_tags.values()) if idf_weighted_tags else 1
        # Max user preference weight for display normalization (separate from IDF)
        max_user_tag_weight = max(tag_weights.values()) if tag_weights else 1

        # Get avoided tags for negative scoring
        avoided_tag_ids = set(user_prefs.avoided_tag_affinities.keys())
        avoided_weights = user_prefs.avoided_tag_affinities

        # Fetch tag names for ID -> name mapping
        all_relevant_tag_ids = list(set(tag_ids) | avoided_tag_ids)
        tag_name_query = select(Tag.id, Tag.name).where(Tag.id.in_(all_relevant_tag_ids))
        tag_name_result = await self.db.execute(tag_name_query)
        tag_id_to_name = {row.id: row.name for row in tag_name_result.all()}

        # Find VNs with these tags - capture tag IDs for Python-side weighting
        query = (
            select(
                VNTag.vn_id,
                func.count(VNTag.tag_id.distinct()).label("tag_match_count"),
                func.array_agg(VNTag.tag_id.distinct()).label("matched_tag_ids"),
            )
            .where(VNTag.tag_id.in_(tag_ids))
            .where(VNTag.spoiler_level <= spoiler_level)
            .where(VNTag.score > 0)
            .where(VNTag.lie == False)  # exclude disputed/incorrect tags
            .where(~VNTag.vn_id.in_(exclude_vns) if exclude_vns else True)
            .group_by(VNTag.vn_id)
            .order_by(func.count(VNTag.tag_id.distinct()).desc())
            .limit(limit * 3)  # Get more candidates for filtering
        )

        result = await self.db.execute(query)
        candidates = result.all()

        if not candidates:
            return []

        # Get VN details for filtering
        vn_ids = [c.vn_id for c in candidates]

        # Query for avoided tags on candidate VNs (for negative scoring)
        vn_avoided_tags: dict[str, list[int]] = {}
        if avoided_tag_ids:
            avoided_query = (
                select(VNTag.vn_id, func.array_agg(VNTag.tag_id.distinct()))
                .where(VNTag.vn_id.in_(vn_ids))
                .where(VNTag.tag_id.in_(list(avoided_tag_ids)))
                .where(VNTag.spoiler_level <= spoiler_level)
                .where(VNTag.score > 0)
                .where(VNTag.lie == False)  # exclude disputed/incorrect tags
                .group_by(VNTag.vn_id)
            )
            avoided_result = await self.db.execute(avoided_query)
            vn_avoided_tags = {row[0]: row[1] for row in avoided_result.all()}

        vn_query = select(VisualNovel).where(VisualNovel.id.in_(vn_ids))

        if min_rating > 0:
            vn_query = vn_query.where(VisualNovel.rating >= min_rating)

        if length_filter:
            length_map = {"very_short": 1, "short": 2, "medium": 3, "long": 4, "very_long": 5}
            if length_filter in length_map:
                vn_query = vn_query.where(VisualNovel.length == length_map[length_filter])

        vn_result = await self.db.execute(vn_query)
        valid_vns = {vn.id for vn in vn_result.scalars().all()}

        # Build results with IDF-weighted scoring and avoided tag penalties
        max_possible_score = sum(idf_weighted_tags.values())
        results = []

        for c in candidates:
            if c.vn_id not in valid_vns:
                continue

            # Calculate IDF-weighted score: sum of (affinity * IDF) for each matched tag
            matched_ids = c.matched_tag_ids or []
            weighted_sum = sum(idf_weighted_tags.get(tid, 0) for tid in matched_ids)

            # Apply penalty for avoided tags on this VN
            avoided_on_vn = vn_avoided_tags.get(c.vn_id, [])
            avoided_penalty = sum(avoided_weights.get(tid, 0) for tid in avoided_on_vn)
            # Scale penalty to be proportional (0.5 factor to not completely dominate)
            weighted_sum -= avoided_penalty * 0.5

            normalized_score = weighted_sum / max_possible_score if max_possible_score > 0 else 0
            normalized_score = max(0, normalized_score)  # Floor at 0

            # Build matched tags sorted by user's preference weight (not IDF)
            tag_with_scores = [
                (tag_id_to_name.get(tid, "Unknown"), tag_weights.get(tid, 0))
                for tid in matched_ids
                if tid in tag_id_to_name
            ]
            tag_with_scores.sort(key=lambda x: x[1], reverse=True)
            matched_tags = [
                f"{name} ({int((score / max_user_tag_weight) * 100)})"
                for name, score in tag_with_scores[:5]
            ]

            results.append({
                "vn_id": c.vn_id,
                "score": normalized_score,
                "tag_score": normalized_score,
                "cf_score": None,
                "matched_tags": matched_tags,
                "avoided_tag_count": len(avoided_on_vn),  # For debugging/display
            })

        # Re-sort by weighted score (since SQL ordered by count, not weighted score)
        results.sort(key=lambda x: x["score"], reverse=True)

        return results[:limit]


class TraitAffinityRecommender:
    """
    Recommends VNs based on user's preferred character traits.

    Joins through Character -> CharacterTrait -> CharacterVN to find
    VNs with characters that have user's preferred traits.
    """

    def __init__(self, db: AsyncSession):
        self.db = db

    async def recommend(
        self,
        user_prefs: UserPreferences,
        exclude_vns: set[str],
        limit: int = 20,
        min_rating: float = 0,
        spoiler_level: int = 0,
        length_filter: Optional[str] = None,
    ) -> list[dict]:
        """
        Find VNs with characters matching user's preferred traits.

        Uses weighted scoring based on user's trait affinities - traits
        with higher affinity scores contribute more to the VN's score.
        """
        if not user_prefs.trait_affinities:
            return []

        # Filter traits by minimum threshold and sort by affinity
        MIN_TRAIT_AFFINITY = 1.5
        sorted_traits = [
            (tid, score) for tid, score in user_prefs.trait_affinities.items()
            if score >= MIN_TRAIT_AFFINITY
        ]
        sorted_traits.sort(key=lambda x: x[1], reverse=True)
        sorted_traits = sorted_traits[:30]

        if not sorted_traits:
            return []

        trait_ids = [t[0] for t in sorted_traits]
        trait_weights = dict(sorted_traits)
        # Max score for normalizing to 0-100 display (like stats pages)
        max_trait_score = sorted_traits[0][1] if sorted_traits else 1

        # Fetch trait names for ID -> name mapping
        trait_name_query = select(Trait.id, Trait.name).where(Trait.id.in_(trait_ids))
        trait_name_result = await self.db.execute(trait_name_query)
        trait_id_to_name = {row.id: row.name for row in trait_name_result.all()}

        # Find VNs through character-trait joins
        query = (
            select(
                CharacterVN.vn_id,
                func.count(CharacterTrait.trait_id.distinct()).label("trait_match_count"),
                func.array_agg(CharacterTrait.trait_id.distinct()).label("matched_trait_ids"),
            )
            .select_from(CharacterTrait)
            .join(CharacterVN, CharacterVN.character_id == CharacterTrait.character_id)
            .where(CharacterTrait.trait_id.in_(trait_ids))
            .where(CharacterTrait.spoiler_level <= spoiler_level)
            .where(~CharacterVN.vn_id.in_(exclude_vns) if exclude_vns else True)
            .group_by(CharacterVN.vn_id)
            .order_by(func.count(CharacterTrait.trait_id.distinct()).desc())
            .limit(limit * 3)
        )

        result = await self.db.execute(query)
        candidates = result.all()

        if not candidates:
            return []

        # Filter by VN attributes
        vn_ids = [c.vn_id for c in candidates]
        vn_query = select(VisualNovel).where(VisualNovel.id.in_(vn_ids))

        if min_rating > 0:
            vn_query = vn_query.where(VisualNovel.rating >= min_rating)

        if length_filter:
            length_map = {"very_short": 1, "short": 2, "medium": 3, "long": 4, "very_long": 5}
            if length_filter in length_map:
                vn_query = vn_query.where(VisualNovel.length == length_map[length_filter])

        vn_result = await self.db.execute(vn_query)
        valid_vns = {vn.id for vn in vn_result.scalars().all()}

        # Build results with weighted scoring
        max_possible_score = sum(trait_weights.values())
        results = []

        for c in candidates:
            if c.vn_id not in valid_vns:
                continue

            # Calculate weighted score: sum of user's affinity for each matched trait
            matched_ids = c.matched_trait_ids or []
            weighted_sum = sum(trait_weights.get(tid, 0) for tid in matched_ids)
            normalized_score = weighted_sum / max_possible_score if max_possible_score > 0 else 0

            # Build matched traits with scores (normalized to 0-100), sorted by weight descending
            trait_with_scores = [
                (trait_id_to_name.get(tid, "Unknown"), trait_weights.get(tid, 0))
                for tid in matched_ids
                if tid in trait_id_to_name
            ]
            trait_with_scores.sort(key=lambda x: x[1], reverse=True)
            matched_traits = [
                f"{name} ({int((score / max_trait_score) * 100)})"
                for name, score in trait_with_scores[:5]
            ]

            results.append({
                "vn_id": c.vn_id,
                "score": normalized_score,
                "tag_score": None,
                "cf_score": None,
                "matched_traits": matched_traits,
            })

            if len(results) >= limit:
                break

        # Re-sort by weighted score (since SQL ordered by count, not weighted score)
        results.sort(key=lambda x: x["score"], reverse=True)

        return results[:limit]


class StaffAffinityRecommender:
    """
    Recommends VNs based on user's preferred staff members.

    Uses staff_affinities to find VNs by the same writers, artists, etc.
    """

    def __init__(self, db: AsyncSession):
        self.db = db

    async def recommend(
        self,
        user_prefs: UserPreferences,
        exclude_vns: set[str],
        limit: int = 20,
        min_rating: float = 0,
        role_filter: Optional[str] = None,
        length_filter: Optional[str] = None,
    ) -> list[dict]:
        """
        Find VNs featuring user's preferred staff.

        Uses weighted scoring based on user's staff affinities - staff
        with higher affinity scores contribute more to the VN's score.

        Args:
            role_filter: Optional filter for specific role ("scenario", "art", "music", "director")
        """
        if not user_prefs.staff_affinities:
            return []

        # Filter by minimum threshold and sort by affinity
        MIN_STAFF_AFFINITY = 1.5
        sorted_staff = [
            (key, score) for key, score in user_prefs.staff_affinities.items()
            if score >= MIN_STAFF_AFFINITY
        ]
        sorted_staff.sort(key=lambda x: x[1], reverse=True)
        sorted_staff = sorted_staff[:30]

        if not sorted_staff:
            return []

        # Extract unique staff IDs and their max scores for weighting
        staff_scores = {}
        for (staff_id, role), score in sorted_staff:
            if staff_id not in staff_scores or staff_scores[staff_id] < score:
                staff_scores[staff_id] = score

        staff_ids = list(staff_scores.keys())
        # Max score for normalizing to 0-100 display (like stats pages)
        max_staff_score = max(staff_scores.values()) if staff_scores else 1

        # Fetch staff names for ID -> name mapping
        staff_name_query = select(Staff.id, Staff.name).where(Staff.id.in_(staff_ids))
        staff_name_result = await self.db.execute(staff_name_query)
        staff_id_to_name = {row.id: row.name for row in staff_name_result.all()}

        # Build query for VNs with these staff
        query = (
            select(
                VNStaff.vn_id,
                func.count(VNStaff.staff_id.distinct()).label("staff_match_count"),
                func.array_agg(VNStaff.staff_id.distinct()).label("matched_staff_ids"),
            )
            .where(VNStaff.staff_id.in_(staff_ids))
            .where(~VNStaff.vn_id.in_(exclude_vns) if exclude_vns else True)
        )

        if role_filter:
            query = query.where(VNStaff.role == role_filter)

        query = (
            query
            .group_by(VNStaff.vn_id)
            .order_by(func.count(VNStaff.staff_id.distinct()).desc())
            .limit(limit * 3)
        )

        result = await self.db.execute(query)
        candidates = result.all()

        if not candidates:
            return []

        # Filter by VN attributes
        vn_ids = [c.vn_id for c in candidates]
        vn_query = select(VisualNovel).where(VisualNovel.id.in_(vn_ids))

        if min_rating > 0:
            vn_query = vn_query.where(VisualNovel.rating >= min_rating)

        if length_filter:
            length_map = {"very_short": 1, "short": 2, "medium": 3, "long": 4, "very_long": 5}
            if length_filter in length_map:
                vn_query = vn_query.where(VisualNovel.length == length_map[length_filter])

        vn_result = await self.db.execute(vn_query)
        valid_vns = {vn.id for vn in vn_result.scalars().all()}

        # Build results with weighted scoring
        max_possible_score = sum(staff_scores.values())
        results = []

        for c in candidates:
            if c.vn_id not in valid_vns:
                continue

            # Calculate weighted score: sum of user's affinity for each matched staff
            matched_ids = c.matched_staff_ids or []
            weighted_sum = sum(staff_scores.get(sid, 0) for sid in matched_ids)
            normalized_score = weighted_sum / max_possible_score if max_possible_score > 0 else 0

            # Build matched staff with scores (normalized to 0-100), sorted by weight descending
            staff_with_scores = [
                (staff_id_to_name.get(sid, "Unknown"), staff_scores.get(sid, 0))
                for sid in matched_ids
                if sid in staff_id_to_name
            ]
            staff_with_scores.sort(key=lambda x: x[1], reverse=True)
            matched_staff = [
                f"{name} ({int((score / max_staff_score) * 100)})"
                for name, score in staff_with_scores[:5]
            ]

            results.append({
                "vn_id": c.vn_id,
                "score": normalized_score,
                "tag_score": None,
                "cf_score": None,
                "matched_staff": matched_staff,
            })

        # Re-sort by weighted score
        results.sort(key=lambda x: x["score"], reverse=True)

        return results[:limit]


class SeiyuuAffinityRecommender:
    """
    Recommends VNs based on user's preferred voice actors (seiyuu).
    """

    def __init__(self, db: AsyncSession):
        self.db = db

    async def recommend(
        self,
        user_prefs: UserPreferences,
        exclude_vns: set[str],
        limit: int = 20,
        min_rating: float = 0,
        length_filter: Optional[str] = None,
    ) -> list[dict]:
        """
        Find VNs featuring user's preferred voice actors.

        Uses weighted scoring based on user's seiyuu affinities - seiyuu
        with higher affinity scores contribute more to the VN's score.
        """
        if not user_prefs.seiyuu_affinities:
            return []

        # Filter by minimum threshold and sort by affinity
        MIN_SEIYUU_AFFINITY = 1.5
        sorted_seiyuu = [
            (sid, score) for sid, score in user_prefs.seiyuu_affinities.items()
            if score >= MIN_SEIYUU_AFFINITY
        ]
        sorted_seiyuu.sort(key=lambda x: x[1], reverse=True)
        sorted_seiyuu = sorted_seiyuu[:30]

        if not sorted_seiyuu:
            return []

        seiyuu_ids = [s[0] for s in sorted_seiyuu]
        seiyuu_weights = dict(sorted_seiyuu)
        # Max score for normalizing to 0-100 display (like stats pages)
        max_seiyuu_score = sorted_seiyuu[0][1] if sorted_seiyuu else 1

        # Fetch seiyuu names for ID -> name mapping
        seiyuu_name_query = select(Staff.id, Staff.name).where(Staff.id.in_(seiyuu_ids))
        seiyuu_name_result = await self.db.execute(seiyuu_name_query)
        seiyuu_id_to_name = {row.id: row.name for row in seiyuu_name_result.all()}

        # Find VNs with these seiyuu
        query = (
            select(
                VNSeiyuu.vn_id,
                func.count(VNSeiyuu.staff_id.distinct()).label("seiyuu_match_count"),
                func.array_agg(VNSeiyuu.staff_id.distinct()).label("matched_seiyuu_ids"),
            )
            .where(VNSeiyuu.staff_id.in_(seiyuu_ids))
            .where(~VNSeiyuu.vn_id.in_(exclude_vns) if exclude_vns else True)
            .group_by(VNSeiyuu.vn_id)
            .order_by(func.count(VNSeiyuu.staff_id.distinct()).desc())
            .limit(limit * 3)
        )

        result = await self.db.execute(query)
        candidates = result.all()

        if not candidates:
            return []

        # Filter by VN attributes
        vn_ids = [c.vn_id for c in candidates]
        vn_query = select(VisualNovel).where(VisualNovel.id.in_(vn_ids))

        if min_rating > 0:
            vn_query = vn_query.where(VisualNovel.rating >= min_rating)

        if length_filter:
            length_map = {"very_short": 1, "short": 2, "medium": 3, "long": 4, "very_long": 5}
            if length_filter in length_map:
                vn_query = vn_query.where(VisualNovel.length == length_map[length_filter])

        vn_result = await self.db.execute(vn_query)
        valid_vns = {vn.id for vn in vn_result.scalars().all()}

        # Build results with weighted scoring
        max_possible_score = sum(seiyuu_weights.values())
        results = []

        for c in candidates:
            if c.vn_id not in valid_vns:
                continue

            # Calculate weighted score: sum of user's affinity for each matched seiyuu
            matched_ids = c.matched_seiyuu_ids or []
            weighted_sum = sum(seiyuu_weights.get(sid, 0) for sid in matched_ids)
            normalized_score = weighted_sum / max_possible_score if max_possible_score > 0 else 0

            # Build matched seiyuu with scores (normalized to 0-100), sorted by weight descending
            seiyuu_with_scores = [
                (seiyuu_id_to_name.get(sid, "Unknown"), seiyuu_weights.get(sid, 0))
                for sid in matched_ids
                if sid in seiyuu_id_to_name
            ]
            seiyuu_with_scores.sort(key=lambda x: x[1], reverse=True)
            matched_seiyuu = [
                f"{name} ({int((score / max_seiyuu_score) * 100)})"
                for name, score in seiyuu_with_scores[:5]
            ]

            results.append({
                "vn_id": c.vn_id,
                "score": normalized_score,
                "tag_score": None,
                "cf_score": None,
                "matched_staff": matched_seiyuu,  # Use matched_staff for seiyuu too
            })

        # Re-sort by weighted score
        results.sort(key=lambda x: x["score"], reverse=True)

        return results[:limit]


class ProducerAffinityRecommender:
    """
    Recommends VNs from user's preferred developers/publishers.
    """

    def __init__(self, db: AsyncSession):
        self.db = db

    async def recommend(
        self,
        user_prefs: UserPreferences,
        exclude_vns: set[str],
        limit: int = 20,
        min_rating: float = 0,
        length_filter: Optional[str] = None,
    ) -> list[dict]:
        """
        Find VNs from user's preferred developers/publishers.

        Uses weighted scoring based on user's producer affinities - producers
        with higher affinity scores contribute more to the VN's score.
        """
        if not user_prefs.producer_affinities:
            return []

        # Filter by minimum threshold and sort by affinity
        MIN_PRODUCER_AFFINITY = 1.5
        sorted_producers = [
            (pid, score) for pid, score in user_prefs.producer_affinities.items()
            if score >= MIN_PRODUCER_AFFINITY
        ]
        sorted_producers.sort(key=lambda x: x[1], reverse=True)
        sorted_producers = sorted_producers[:30]

        if not sorted_producers:
            return []

        producer_ids = [p[0] for p in sorted_producers]
        producer_weights = dict(sorted_producers)
        # Max score for normalizing to 0-100 display (like stats pages)
        max_producer_score = sorted_producers[0][1] if sorted_producers else 1

        # Fetch producer names for ID -> name mapping
        producer_name_query = select(Producer.id, Producer.name).where(Producer.id.in_(producer_ids))
        producer_name_result = await self.db.execute(producer_name_query)
        producer_id_to_name = {row.id: row.name for row in producer_name_result.all()}

        # Find VNs from these producers through release chain
        query = (
            select(
                ReleaseVN.vn_id,
                func.count(ReleaseProducer.producer_id.distinct()).label("producer_match_count"),
                func.array_agg(ReleaseProducer.producer_id.distinct()).label("matched_producer_ids"),
            )
            .select_from(ReleaseProducer)
            .join(ReleaseVN, ReleaseVN.release_id == ReleaseProducer.release_id)
            .where(ReleaseProducer.producer_id.in_(producer_ids))
            .where(ReleaseProducer.developer == True)  # Focus on developers
            .where(~ReleaseVN.vn_id.in_(exclude_vns) if exclude_vns else True)
            .group_by(ReleaseVN.vn_id)
            .order_by(func.count(ReleaseProducer.producer_id.distinct()).desc())
            .limit(limit * 3)
        )

        result = await self.db.execute(query)
        candidates = result.all()

        if not candidates:
            return []

        # Filter by VN attributes
        vn_ids = [c.vn_id for c in candidates]
        vn_query = select(VisualNovel).where(VisualNovel.id.in_(vn_ids))

        if min_rating > 0:
            vn_query = vn_query.where(VisualNovel.rating >= min_rating)

        if length_filter:
            length_map = {"very_short": 1, "short": 2, "medium": 3, "long": 4, "very_long": 5}
            if length_filter in length_map:
                vn_query = vn_query.where(VisualNovel.length == length_map[length_filter])

        vn_result = await self.db.execute(vn_query)
        valid_vns = {vn.id for vn in vn_result.scalars().all()}

        # Build results with weighted scoring
        max_possible_score = sum(producer_weights.values())
        results = []

        for c in candidates:
            if c.vn_id not in valid_vns:
                continue

            # Calculate weighted score: sum of user's affinity for each matched producer
            matched_ids = c.matched_producer_ids or []
            weighted_sum = sum(producer_weights.get(pid, 0) for pid in matched_ids)
            normalized_score = weighted_sum / max_possible_score if max_possible_score > 0 else 0

            # Build matched producer with score (normalized to 0-100), use the highest weighted one
            producer_with_scores = [
                (producer_id_to_name.get(pid, "Unknown"), producer_weights.get(pid, 0))
                for pid in matched_ids
                if pid in producer_id_to_name
            ]
            producer_with_scores.sort(key=lambda x: x[1], reverse=True)
            # Format the top producer with normalized score
            matched_producer = f"{producer_with_scores[0][0]} ({int((producer_with_scores[0][1] / max_producer_score) * 100)})" if producer_with_scores else None

            results.append({
                "vn_id": c.vn_id,
                "score": normalized_score,
                "tag_score": None,
                "cf_score": None,
                "matched_producer": matched_producer,
            })

        # Re-sort by weighted score
        results.sort(key=lambda x: x["score"], reverse=True)

        return results[:limit]


class SimilarToFavoritesRecommender:
    """
    Finds VNs similar to user's top-rated titles using tag vectors.
    """

    def __init__(self, db: AsyncSession):
        self.db = db
        self._tag_to_idx: dict[int, int] = {}
        self._num_tags: int = 0

    async def _load_tag_index(self):
        """Load tag ID to index mapping."""
        if self._tag_to_idx:
            return

        from app.db.models import Tag
        result = await self.db.execute(
            select(Tag.id).where(Tag.applicable == True).order_by(Tag.id)
        )
        tags = result.scalars().all()
        self._tag_to_idx = {tid: idx for idx, tid in enumerate(tags)}
        self._num_tags = len(tags)

    async def _get_vn_tag_vector(self, vn_id: str) -> np.ndarray:
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
        top_n_favorites: int = 10,
        length_filter: Optional[str] = None,
    ) -> list[dict]:
        """
        Find VNs similar to user's highest-rated titles.

        Args:
            user_votes: User's votes [{vn_id, score}, ...]
            top_n_favorites: Number of top-rated VNs to use as seeds

        Returns:
            List of recommendations with similar_to_titles showing which
            favorites each recommendation is similar to.
        """
        if not user_votes:
            return []

        # Get user's top-rated VNs
        sorted_votes = sorted(user_votes, key=lambda x: x["score"], reverse=True)
        top_favorite_ids = [v["vn_id"] for v in sorted_votes[:top_n_favorites]]

        # Get titles for top favorites
        title_query = select(VisualNovel.id, VisualNovel.title).where(
            VisualNovel.id.in_(top_favorite_ids)
        )
        title_result = await self.db.execute(title_query)
        favorite_titles = {r[0]: r[1] for r in title_result.all()}

        # Get tag vectors for favorites with their titles
        favorites_data: list[tuple[str, str, np.ndarray]] = []  # (vn_id, title, vector)
        for vn_id in top_favorite_ids:
            vec = await self._get_vn_tag_vector(vn_id)
            if np.any(vec):
                title = favorite_titles.get(vn_id, vn_id)
                favorites_data.append((vn_id, title, vec))

        if not favorites_data:
            return []

        # Get candidate VNs
        query = select(VisualNovel.id).where(~VisualNovel.id.in_(exclude_vns))
        if min_rating > 0:
            query = query.where(VisualNovel.rating >= min_rating)
        if length_filter:
            length_map = {"very_short": 1, "short": 2, "medium": 3, "long": 4, "very_long": 5}
            if length_filter in length_map:
                query = query.where(VisualNovel.length == length_map[length_filter])

        result = await self.db.execute(query.limit(1000))
        candidate_ids = [r[0] for r in result.all()]

        # Calculate similarities to EACH favorite and track sources
        results = []
        for vn_id in candidate_ids:
            vn_vector = await self._get_vn_tag_vector(vn_id)
            if not np.any(vn_vector):
                continue

            # Calculate similarity to each favorite
            similar_favorites: list[tuple[str, float]] = []  # (title, similarity)
            for fav_id, fav_title, fav_vector in favorites_data:
                sim = float(np.dot(fav_vector, vn_vector))
                if sim > 0.25:  # Threshold for meaningful similarity
                    similar_favorites.append((fav_title, sim))

            if not similar_favorites:
                continue

            # Sort by similarity and take top 3
            similar_favorites.sort(key=lambda x: x[1], reverse=True)
            top_similar = similar_favorites[:3]

            # Overall score is the average of top similarities
            avg_sim = sum(s[1] for s in top_similar) / len(top_similar)

            results.append({
                "vn_id": vn_id,
                "score": avg_sim,
                "tag_score": avg_sim,
                "cf_score": None,
                "similar_to_titles": [title for title, _ in top_similar],
            })

        # Sort by score
        results.sort(key=lambda x: x["score"], reverse=True)

        return results[:limit]


class SimilarUsersRecommender:
    """
    Recommends VNs that similar users rated highly.

    Finds users with similar voting patterns and recommends
    their highly-rated VNs that the target user hasn't read.
    """

    def __init__(self, db: AsyncSession):
        self.db = db

    async def recommend(
        self,
        user_votes: list[dict],
        exclude_vns: set[str],
        limit: int = 20,
        min_rating: float = 0,
        top_n_users: int = 20,
        length_filter: Optional[str] = None,
    ) -> list[dict]:
        """
        Recommend from similar users' highly-rated VNs.

        This uses the global_votes table to find users with overlapping
        highly-rated VNs and recommends what they liked.
        """
        if not user_votes:
            return []

        # Get user's highly-rated VN IDs (score >= 70)
        user_high_rated = {v["vn_id"] for v in user_votes if v["score"] >= 70}
        if len(user_high_rated) < 3:
            return []  # Need some overlap to find similar users

        # Find users who also rated these VNs highly
        # This is a simplified approach - in production you'd use CF factors
        query = (
            select(
                GlobalVote.user_hash,
                func.count(GlobalVote.vn_id).label("overlap_count"),
            )
            .where(GlobalVote.vn_id.in_(user_high_rated))
            .where(GlobalVote.vote >= 70)
            .group_by(GlobalVote.user_hash)
            .having(func.count(GlobalVote.vn_id) >= 3)
            .order_by(func.count(GlobalVote.vn_id).desc())
            .limit(top_n_users)
        )

        result = await self.db.execute(query)
        similar_users = [r.user_hash for r in result.all()]

        if not similar_users:
            return []

        # Get VNs these similar users rated highly that target user hasn't read
        rec_query = (
            select(
                GlobalVote.vn_id,
                func.avg(GlobalVote.vote).label("avg_vote"),
                func.count(GlobalVote.user_hash).label("voter_count"),
            )
            .where(GlobalVote.user_hash.in_(similar_users))
            .where(GlobalVote.vote >= 75)
            .where(~GlobalVote.vn_id.in_(exclude_vns) if exclude_vns else True)
            .group_by(GlobalVote.vn_id)
            .having(func.count(GlobalVote.user_hash) >= 2)  # At least 2 similar users
            .order_by(func.avg(GlobalVote.vote).desc())
            .limit(limit * 2)
        )

        result = await self.db.execute(rec_query)
        candidates = result.all()

        if not candidates:
            return []

        # Filter by VN attributes
        vn_ids = [c.vn_id for c in candidates]
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
        for c in candidates:
            if c.vn_id not in valid_vns:
                continue

            # Score based on average vote from similar users, normalized to 0-1
            normalized_score = (c.avg_vote - 50) / 50  # 50-100 -> 0-1

            results.append({
                "vn_id": c.vn_id,
                "score": max(0, normalized_score),
                "tag_score": None,
                "cf_score": normalized_score,
                "similar_user_count": c.voter_count,  # How many similar users liked this
            })

            if len(results) >= limit:
                break

        return results


class HGATRecommender:
    """
    Recommends VNs using precomputed HGAT graph neural network embeddings.

    Uses embeddings from the heterogeneous knowledge graph to find VNs
    that are semantically similar to what the user likes.
    """

    def __init__(self, db: AsyncSession):
        self.db = db
        self._vn_embeddings: dict[str, np.ndarray] = {}
        self._embeddings_loaded = False

    async def _load_vn_embeddings(self):
        """Load all VN embeddings into memory for fast computation."""
        if self._embeddings_loaded:
            return

        result = await self.db.execute(
            select(VNGraphEmbedding.vn_id, VNGraphEmbedding.embedding)
            .where(VNGraphEmbedding.model_version == "hgat_v1")
        )

        for row in result.all():
            self._vn_embeddings[row[0]] = np.array(row[1])

        self._embeddings_loaded = True
        logger.info(f"Loaded {len(self._vn_embeddings)} VN HGAT embeddings")

    async def recommend(
        self,
        user_votes: list[dict],
        exclude_vns: set[str],
        limit: int = 20,
        min_rating: float = 0,
        length_filter: Optional[str] = None,
    ) -> list[dict]:
        """
        Recommend VNs using HGAT embeddings.

        Creates a user profile by averaging embeddings of their highly-rated VNs,
        then finds VNs with similar embeddings.
        """
        if not user_votes:
            return []

        await self._load_vn_embeddings()

        if not self._vn_embeddings:
            logger.warning("No HGAT embeddings available")
            return []

        # Build user profile from highly-rated VNs (score >= 70)
        user_high_rated = [v["vn_id"] for v in user_votes if v["score"] >= 70]

        # Collect embeddings for user's favorites
        user_vectors = []
        for vn_id in user_high_rated[:20]:  # Use top 20 favorites
            if vn_id in self._vn_embeddings:
                user_vectors.append(self._vn_embeddings[vn_id])

        if not user_vectors:
            return []

        # Create user profile by averaging favorite embeddings
        user_profile = np.mean(user_vectors, axis=0)
        user_norm = np.linalg.norm(user_profile)
        if user_norm > 0:
            user_profile /= user_norm

        # Compute similarity to all VNs
        candidates = []
        for vn_id, vn_embedding in self._vn_embeddings.items():
            if vn_id in exclude_vns:
                continue

            # Cosine similarity (embeddings should already be normalized)
            vn_norm = np.linalg.norm(vn_embedding)
            if vn_norm > 0:
                sim = float(np.dot(user_profile, vn_embedding / vn_norm))
            else:
                sim = 0

            if sim > 0.3:  # Threshold for meaningful similarity
                candidates.append((vn_id, sim))

        # Sort by similarity
        candidates.sort(key=lambda x: x[1], reverse=True)
        candidates = candidates[:limit * 2]

        if not candidates:
            return []

        # Filter by VN attributes
        vn_ids = [c[0] for c in candidates]
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
        for vn_id, sim in candidates:
            if vn_id not in valid_vns:
                continue

            results.append({
                "vn_id": vn_id,
                "score": sim,
                "tag_score": None,
                "cf_score": None,
                "hgat_score": sim,
            })

            if len(results) >= limit:
                break

        return results


class PrecomputedSimilarityRecommender:
    """
    Fast similar novels recommender using precomputed VN-VN similarities.

    Uses the vn_similarities table for O(1) lookup instead of O(n) computation.
    """

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_similar_vns(
        self,
        vn_id: str,
        exclude_vns: set[str],
        limit: int = 20,
        min_rating: float = 0,
    ) -> list[dict]:
        """
        Get VNs similar to the given VN using precomputed similarities.
        """
        # Query precomputed similarities
        query = (
            select(
                VNSimilarity.similar_vn_id,
                VNSimilarity.similarity_score,
            )
            .where(VNSimilarity.vn_id == vn_id)
            .where(~VNSimilarity.similar_vn_id.in_(exclude_vns) if exclude_vns else True)
            .order_by(VNSimilarity.similarity_score.desc())
            .limit(limit * 2)
        )

        result = await self.db.execute(query)
        candidates = result.all()

        if not candidates:
            return []

        # Filter by VN attributes
        vn_ids = [c[0] for c in candidates]
        vn_query = select(VisualNovel).where(VisualNovel.id.in_(vn_ids))

        if min_rating > 0:
            vn_query = vn_query.where(VisualNovel.rating >= min_rating)

        vn_result = await self.db.execute(vn_query)
        valid_vns = {vn.id for vn in vn_result.scalars().all()}

        # Build results
        results = []
        for similar_vn_id, score in candidates:
            if similar_vn_id not in valid_vns:
                continue

            results.append({
                "vn_id": similar_vn_id,
                "score": float(score),
                "similarity_score": float(score),
            })

            if len(results) >= limit:
                break

        return results

    async def recommend(
        self,
        user_votes: list[dict],
        exclude_vns: set[str],
        limit: int = 20,
        min_rating: float = 0,
        top_n_favorites: int = 10,
        length_filter: Optional[str] = None,
    ) -> list[dict]:
        """
        Find VNs similar to user's favorites using precomputed similarities.

        Much faster than SimilarToFavoritesRecommender because it uses
        precomputed VN-VN similarity lookups instead of computing on the fly.
        """
        if not user_votes:
            return []

        # Get user's top-rated VNs
        sorted_votes = sorted(user_votes, key=lambda x: x["score"], reverse=True)
        top_favorite_ids = [v["vn_id"] for v in sorted_votes[:top_n_favorites]]

        # Get titles for favorites
        title_query = select(VisualNovel.id, VisualNovel.title).where(
            VisualNovel.id.in_(top_favorite_ids)
        )
        title_result = await self.db.execute(title_query)
        favorite_titles = {r[0]: r[1] for r in title_result.all()}

        # Collect similar VNs from each favorite
        similar_map: dict[str, list[tuple[str, float]]] = {}  # vn_id -> [(source_title, score), ...]

        for fav_id in top_favorite_ids:
            fav_title = favorite_titles.get(fav_id, fav_id)

            # Get precomputed similar VNs for this favorite
            query = (
                select(VNSimilarity.similar_vn_id, VNSimilarity.similarity_score)
                .where(VNSimilarity.vn_id == fav_id)
                .where(~VNSimilarity.similar_vn_id.in_(exclude_vns) if exclude_vns else True)
                .order_by(VNSimilarity.similarity_score.desc())
                .limit(30)
            )

            result = await self.db.execute(query)
            for similar_vn_id, score in result.all():
                if similar_vn_id not in similar_map:
                    similar_map[similar_vn_id] = []
                similar_map[similar_vn_id].append((fav_title, float(score)))

        if not similar_map:
            return []

        # Score each candidate by their similarity to favorites
        candidates = []
        for vn_id, sources in similar_map.items():
            # Sort sources by similarity
            sources.sort(key=lambda x: x[1], reverse=True)
            top_sources = sources[:3]

            # Average similarity as score
            avg_score = sum(s[1] for s in top_sources) / len(top_sources)
            # Bonus for being similar to multiple favorites
            multi_source_bonus = min(0.1, 0.02 * len(sources))

            candidates.append({
                "vn_id": vn_id,
                "score": avg_score + multi_source_bonus,
                "similar_to_titles": [title for title, _ in top_sources],
            })

        # Sort by score
        candidates.sort(key=lambda x: x["score"], reverse=True)
        candidates = candidates[:limit * 2]

        # Filter by VN attributes
        vn_ids = [c["vn_id"] for c in candidates]
        vn_query = select(VisualNovel).where(VisualNovel.id.in_(vn_ids))

        if min_rating > 0:
            vn_query = vn_query.where(VisualNovel.rating >= min_rating)

        if length_filter:
            length_map = {"very_short": 1, "short": 2, "medium": 3, "long": 4, "very_long": 5}
            if length_filter in length_map:
                vn_query = vn_query.where(VisualNovel.length == length_map[length_filter])

        vn_result = await self.db.execute(vn_query)
        valid_vns = {vn.id for vn in vn_result.scalars().all()}

        # Filter results
        results = []
        for c in candidates:
            if c["vn_id"] not in valid_vns:
                continue

            results.append({
                "vn_id": c["vn_id"],
                "score": c["score"],
                "tag_score": c["score"],
                "cf_score": None,
                "similar_to_titles": c["similar_to_titles"],
            })

            if len(results) >= limit:
                break

        return results


class ItemItemCFRecommender:
    """
    Item-item collaborative filtering recommender.

    Uses precomputed VN co-occurrence data to find "users who liked X also liked Y".
    """

    def __init__(self, db: AsyncSession):
        self.db = db

    async def recommend(
        self,
        user_votes: list[dict],
        exclude_vns: set[str],
        limit: int = 20,
        min_rating: float = 0,
        length_filter: Optional[str] = None,
    ) -> list[dict]:
        """
        Recommend VNs based on item-item co-occurrence.

        For each VN the user rated highly, finds VNs that are frequently
        co-rated highly by other users, weighted by the user's rating.
        """
        if not user_votes:
            return []

        # Get user's highly-rated VNs (≥70)
        user_high_rated = [(v["vn_id"], v["score"]) for v in user_votes if v["score"] >= 70]

        if not user_high_rated:
            return []

        # Sort by score to prioritize highest-rated
        user_high_rated.sort(key=lambda x: x[1], reverse=True)
        seed_vns = user_high_rated[:15]  # Use top 15 as seeds

        # Collect similar VNs from co-occurrence table
        similar_map: dict[str, list[tuple[str, float, float]]] = {}  # vn_id -> [(source_title, co_score, user_rating), ...]

        # Get titles for seed VNs
        seed_vn_ids = [v[0] for v in seed_vns]
        title_query = select(VisualNovel.id, VisualNovel.title).where(
            VisualNovel.id.in_(seed_vn_ids)
        )
        title_result = await self.db.execute(title_query)
        seed_titles = {r[0]: r[1] for r in title_result.all()}

        for seed_id, user_rating in seed_vns:
            seed_title = seed_titles.get(seed_id, seed_id)

            # Get co-occurring VNs for this seed
            query = (
                select(VNCoOccurrence.similar_vn_id, VNCoOccurrence.co_rating_score, VNCoOccurrence.user_count)
                .where(VNCoOccurrence.vn_id == seed_id)
                .where(~VNCoOccurrence.similar_vn_id.in_(exclude_vns) if exclude_vns else True)
                .order_by(VNCoOccurrence.co_rating_score.desc())
                .limit(30)
            )

            result = await self.db.execute(query)
            for similar_vn_id, co_score, user_count in result.all():
                if similar_vn_id not in similar_map:
                    similar_map[similar_vn_id] = []
                # Weight by user's rating of the seed VN
                weighted_score = co_score * (user_rating / 100.0)
                similar_map[similar_vn_id].append((seed_title, weighted_score, user_count))

        if not similar_map:
            return []

        # Score each candidate
        candidates = []
        for vn_id, sources in similar_map.items():
            # Sort sources by weighted score
            sources.sort(key=lambda x: x[1], reverse=True)
            top_sources = sources[:3]

            # Score = average of weighted scores + bonus for multiple sources
            avg_score = sum(s[1] for s in top_sources) / len(top_sources)
            multi_source_bonus = min(0.15, 0.03 * len(sources))
            total_user_count = sum(s[2] for s in sources)

            candidates.append({
                "vn_id": vn_id,
                "score": avg_score + multi_source_bonus,
                "co_rated_with": [title for title, _, _ in top_sources],
                "total_user_count": total_user_count,
            })

        # Sort by score
        candidates.sort(key=lambda x: x["score"], reverse=True)
        candidates = candidates[:limit * 2]

        # Filter by VN attributes
        vn_ids = [c["vn_id"] for c in candidates]
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
        for c in candidates:
            if c["vn_id"] not in valid_vns:
                continue

            results.append({
                "vn_id": c["vn_id"],
                "score": c["score"],
                "tag_score": None,
                "cf_score": c["score"],
                "co_rated_with": c["co_rated_with"],  # VNs this was co-rated with
            })

            if len(results) >= limit:
                break

        return results


class HybridCFRecommender:
    """
    Hybrid collaborative filtering recommender using combined CF + content embeddings.

    Uses precomputed embeddings that combine ALS collaborative filtering factors
    with tag-based content vectors. Works on all Python versions (no LightFM dependency).

    Key features:
    - Combines collaborative signals (what similar users like) with content (tags)
    - Handles cold-start VNs using content-only embeddings
    - Fast inference using cosine similarity on precomputed embeddings
    """

    def __init__(self, db: AsyncSession):
        self.db = db
        self._vn_embeddings: dict[str, np.ndarray] = {}
        self._embeddings_loaded = False

    async def _load_vn_embeddings(self):
        """Load all hybrid VN embeddings into memory for fast computation."""
        if self._embeddings_loaded:
            return

        result = await self.db.execute(
            select(VNGraphEmbedding.vn_id, VNGraphEmbedding.embedding)
            .where(VNGraphEmbedding.model_version == "hybrid_v1")
        )

        for row in result.all():
            self._vn_embeddings[row[0]] = np.array(row[1])

        self._embeddings_loaded = True
        logger.info(f"Loaded {len(self._vn_embeddings)} hybrid CF embeddings")

    async def recommend(
        self,
        user_votes: list[dict],
        exclude_vns: set[str],
        limit: int = 20,
        min_rating: float = 0,
        length_filter: Optional[str] = None,
    ) -> list[dict]:
        """
        Recommend VNs using hybrid CF+content embeddings.

        Creates a user profile by averaging embeddings of their highly-rated VNs,
        then finds VNs with similar embeddings.
        """
        if not user_votes:
            return []

        await self._load_vn_embeddings()

        if not self._vn_embeddings:
            logger.warning("No hybrid embeddings available, run train_lightfm() first")
            return []

        # Build user profile from highly-rated VNs (score >= 70)
        user_high_rated = sorted(
            [v for v in user_votes if v["score"] >= 70],
            key=lambda x: x["score"],
            reverse=True
        )

        # Collect embeddings for user's favorites
        user_vectors = []
        weights = []
        for vote in user_high_rated[:20]:  # Use top 20 favorites
            vn_id = vote["vn_id"]
            if vn_id in self._vn_embeddings:
                user_vectors.append(self._vn_embeddings[vn_id])
                # Weight by rating (higher rated = more influence)
                weights.append(vote["score"] / 100.0)

        if not user_vectors:
            return []

        # Create user profile by weighted average of favorite embeddings
        weights = np.array(weights)
        weights = weights / weights.sum()  # Normalize weights
        user_profile = np.average(user_vectors, axis=0, weights=weights)

        # Normalize
        user_norm = np.linalg.norm(user_profile)
        if user_norm > 0:
            user_profile /= user_norm

        # Compute similarity to all VNs
        candidates = []
        for vn_id, vn_embedding in self._vn_embeddings.items():
            if vn_id in exclude_vns:
                continue

            # Cosine similarity (embeddings are normalized)
            vn_norm = np.linalg.norm(vn_embedding)
            if vn_norm > 0:
                sim = float(np.dot(user_profile, vn_embedding / vn_norm))
            else:
                sim = 0

            if sim > 0.3:  # Threshold for meaningful similarity
                candidates.append((vn_id, sim))

        # Sort by similarity
        candidates.sort(key=lambda x: x[1], reverse=True)
        candidates = candidates[:limit * 2]

        if not candidates:
            return []

        # Filter by VN attributes
        vn_ids = [c[0] for c in candidates]
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
        for vn_id, sim in candidates:
            if vn_id not in valid_vns:
                continue

            results.append({
                "vn_id": vn_id,
                "score": sim,
                "tag_score": sim * 0.4,  # Approximate content contribution
                "cf_score": sim * 0.6,   # Approximate CF contribution
                "hybrid_score": sim,
            })

            if len(results) >= limit:
                break

        return results
