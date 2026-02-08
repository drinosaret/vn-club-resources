"""
Generate personalized explanations for recommendations.

Uses the user's preference data (staff, seiyuu, producer, tag affinities)
to explain WHY a VN is being recommended.
"""

import logging
from dataclasses import dataclass
from typing import Optional

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import (
    VisualNovel, VNTag, Tag, VNStaff, VNSeiyuu, Staff,
    ReleaseVN, ReleaseProducer, Producer,
)
from app.services.preference_extractor import UserPreferences

logger = logging.getLogger(__name__)


@dataclass
class Explanation:
    """A single explanation for a recommendation."""

    text: str
    category: str  # "staff", "seiyuu", "producer", "tag", "similar", "rating"
    strength: float  # How strong this reason is (0-1)
    entity_id: Optional[str] = None  # For linking to staff/producer pages
    entity_name: Optional[str] = None


class ExplanationService:
    """
    Generate personalized explanations for recommendations.

    Uses the user's preferences to match against VN metadata and
    generate human-readable explanations.
    """

    def __init__(self, db: AsyncSession):
        self.db = db

    async def generate_explanations(
        self,
        vn_id: str,
        user_prefs: UserPreferences,
        max_explanations: int = 3,
    ) -> list[Explanation]:
        """
        Generate explanations for why a VN is recommended.

        Args:
            vn_id: VN to explain
            user_prefs: User's preference data from PreferenceExtractor
            max_explanations: Maximum number of explanations to return

        Returns:
            List of Explanation objects, sorted by strength
        """
        explanations = []

        # Check staff matches (scenario writers, artists, etc.)
        staff_explanations = await self._check_staff_matches(vn_id, user_prefs)
        explanations.extend(staff_explanations)

        # Check seiyuu matches
        seiyuu_explanations = await self._check_seiyuu_matches(vn_id, user_prefs)
        explanations.extend(seiyuu_explanations)

        # Check producer/developer matches
        producer_explanations = await self._check_producer_matches(vn_id, user_prefs)
        explanations.extend(producer_explanations)

        # Check tag matches
        tag_explanations = await self._check_tag_matches(vn_id, user_prefs)
        explanations.extend(tag_explanations)

        # Sort by strength and return top N
        explanations.sort(key=lambda x: x.strength, reverse=True)
        if explanations:
            logger.debug(f"Generated {len(explanations)} explanations for {vn_id}")
        return explanations[:max_explanations]

    async def _check_staff_matches(
        self,
        vn_id: str,
        user_prefs: UserPreferences,
    ) -> list[Explanation]:
        """Check if VN has staff the user likes."""
        explanations = []

        # Get VN's staff
        result = await self.db.execute(
            select(VNStaff.staff_id, VNStaff.role, Staff.name)
            .join(Staff, VNStaff.staff_id == Staff.id)
            .where(VNStaff.vn_id == vn_id)
        )

        for staff_id, role, staff_name in result.all():
            # Check if user has positive affinity for this staff+role
            key = (staff_id, role)
            if key in user_prefs.staff_affinities:
                affinity = user_prefs.staff_affinities[key]
                if affinity > 0:
                    # Generate explanation based on role
                    role_text = self._format_role(role)
                    text = f"{role_text} by {staff_name}"

                    if affinity > 0.5:
                        text += f" (you rate their work highly)"
                    elif affinity > 0:
                        text += f" (you've enjoyed their work)"

                    explanations.append(Explanation(
                        text=text,
                        category="staff",
                        strength=min(affinity, 1.0),
                        entity_id=staff_id,
                        entity_name=staff_name,
                    ))

        return explanations

    async def _check_seiyuu_matches(
        self,
        vn_id: str,
        user_prefs: UserPreferences,
    ) -> list[Explanation]:
        """Check if VN has voice actors the user likes."""
        explanations = []

        # Get VN's seiyuu
        result = await self.db.execute(
            select(VNSeiyuu.staff_id, Staff.name)
            .join(Staff, VNSeiyuu.staff_id == Staff.id)
            .where(VNSeiyuu.vn_id == vn_id)
            .distinct()
        )

        for staff_id, staff_name in result.all():
            if staff_id in user_prefs.seiyuu_affinities:
                affinity = user_prefs.seiyuu_affinities[staff_id]
                if affinity > 0:
                    text = f"Voiced by {staff_name}"

                    if affinity > 0.5:
                        text += f" (one of your favorite VAs)"
                    elif affinity > 0:
                        text += f" (you've enjoyed their performances)"

                    explanations.append(Explanation(
                        text=text,
                        category="seiyuu",
                        strength=min(affinity, 1.0),
                        entity_id=staff_id,
                        entity_name=staff_name,
                    ))

        return explanations

    async def _check_producer_matches(
        self,
        vn_id: str,
        user_prefs: UserPreferences,
    ) -> list[Explanation]:
        """Check if VN is from a developer/publisher the user likes."""
        explanations = []

        # Get VN's producers via releases
        result = await self.db.execute(
            text("""
                SELECT DISTINCT p.id, p.name, rp.developer, rp.publisher
                FROM release_vn rv
                JOIN release_producers rp ON rv.release_id = rp.release_id
                JOIN producers p ON rp.producer_id = p.id
                WHERE rv.vn_id = :vn_id
            """),
            {"vn_id": vn_id}
        )

        for producer_id, producer_name, is_developer, is_publisher in result.all():
            if producer_id in user_prefs.producer_affinities:
                affinity = user_prefs.producer_affinities[producer_id]
                if affinity > 0:
                    if is_developer:
                        text = f"Made by {producer_name}"
                    else:
                        text = f"Published by {producer_name}"

                    if affinity > 0.5:
                        text += f" (one of your top developers)"
                    elif affinity > 0:
                        text += f" (you've enjoyed their games)"

                    explanations.append(Explanation(
                        text=text,
                        category="producer",
                        strength=min(affinity, 1.0),
                        entity_id=producer_id,
                        entity_name=producer_name,
                    ))

        return explanations

    async def _check_tag_matches(
        self,
        vn_id: str,
        user_prefs: UserPreferences,
    ) -> list[Explanation]:
        """Check if VN has tags the user loves or avoids."""
        explanations = []

        # Get VN's tags
        result = await self.db.execute(
            select(VNTag.tag_id, VNTag.score, Tag.name)
            .join(Tag, VNTag.tag_id == Tag.id)
            .where(VNTag.vn_id == vn_id)
            .where(VNTag.spoiler_level == 0)
            .where(VNTag.score >= 1.5)  # Only prominent tags
            .where(VNTag.lie == False)  # exclude disputed/incorrect tags
        )

        vn_tags = [(tag_id, score, name) for tag_id, score, name in result.all()]

        # Check against user's loved tags
        for loved_tag in user_prefs.loved_tags[:10]:
            for tag_id, tag_score, tag_name in vn_tags:
                if tag_id == loved_tag["id"]:
                    diff = loved_tag.get("diff", 0)
                    text = f"Features '{tag_name}' tag"

                    if diff > 1:
                        text += f" (you rate {diff:+.1f} above average)"
                    elif diff > 0:
                        text += f" (one of your preferred tags)"

                    # Strength based on tag score and user preference
                    strength = min((tag_score / 3.0) * (1 + diff / 2), 1.0)

                    explanations.append(Explanation(
                        text=text,
                        category="tag",
                        strength=max(strength, 0.3),
                        entity_id=str(tag_id),
                        entity_name=tag_name,
                    ))
                    break

        return explanations

    def _format_role(self, role: str) -> str:
        """Format staff role for display."""
        role_map = {
            "scenario": "Written",
            "art": "Art",
            "music": "Music",
            "songs": "Songs",
            "director": "Directed",
        }
        return role_map.get(role, role.capitalize())


async def generate_recommendation_explanations(
    db: AsyncSession,
    vn_id: str,
    user_prefs: UserPreferences,
    max_explanations: int = 3,
) -> list[str]:
    """
    Convenience function to generate explanation strings.

    Args:
        db: Database session
        vn_id: VN to explain
        user_prefs: User's preferences
        max_explanations: Maximum explanations to return

    Returns:
        List of explanation strings
    """
    service = ExplanationService(db)
    explanations = await service.generate_explanations(
        vn_id, user_prefs, max_explanations
    )
    return [e.text for e in explanations]
