"""Service for managing cover image blacklisting based on tag and age rules."""

import logging
from datetime import datetime, timezone
from typing import TypedDict

from sqlalchemy import select, delete, and_, func, exists
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import (
    CoverBlacklist, CoverBlacklistConfig, Tag, VNTag, VisualNovel,
    Release, ReleaseVN
)

logger = logging.getLogger(__name__)


class AutoBlacklistStats(TypedDict):
    """Statistics from auto-blacklist evaluation."""
    added: int
    removed: int
    total: int


async def evaluate_auto_blacklist(db: AsyncSession) -> AutoBlacklistStats:
    """
    Evaluate and apply all active auto-blacklist rules.

    This function:
    1. Gets all active blacklist config rules
    2. For each rule, finds VNs that match ALL conditions:
       - VN votecount < votecount_threshold
       - Tag conditions (AND logic): VN has each specified tag with score >= min_tag_score
       - Age condition: 'any_18plus' (minage==18) or 'only_18plus' (all known releases 18+, unknown ignored)
    3. Adds matching VNs to blacklist with reason='auto_tag'
    4. Removes auto entries that no longer match any active rule

    Returns statistics about changes made.
    """
    logger.info("Starting auto-blacklist evaluation")

    # Get all active rules
    result = await db.execute(
        select(CoverBlacklistConfig).where(CoverBlacklistConfig.is_active == True)
    )
    rules = result.scalars().all()

    if not rules:
        logger.info("No active blacklist rules found")
        # Clean up any stale auto entries
        result = await db.execute(
            select(CoverBlacklist).where(CoverBlacklist.reason == "auto_tag")
        )
        stale_entries = result.scalars().all()
        removed = 0
        for entry in stale_entries:
            await db.delete(entry)
            removed += 1
        if removed:
            await db.commit()
        result = await db.execute(select(func.count()).select_from(CoverBlacklist))
        total = result.scalar_one_or_none() or 0
        return {"added": 0, "removed": removed, "total": total}

    logger.info(f"Found {len(rules)} active blacklist rules")

    # Find all VNs that should be blacklisted based on current rules
    # This builds a union of all VNs matching any rule
    vns_to_blacklist: dict[str, list[int]] = {}  # vn_id -> list of matching tag_ids

    for rule in rules:
        # Start with VNs below vote threshold
        query = select(VisualNovel.id).where(
            VisualNovel.votecount < rule.votecount_threshold
        )

        # Tag conditions (AND logic) — each tag adds an EXISTS subquery
        for tag_id in rule.tag_ids_list:
            query = query.where(
                exists(
                    select(VNTag.vn_id).where(
                        and_(
                            VNTag.vn_id == VisualNovel.id,
                            VNTag.tag_id == tag_id,
                            VNTag.score >= rule.min_tag_score,
                            VNTag.lie == False,
                        )
                    )
                )
            )

        # Age conditions
        if rule.age_condition == "any_18plus":
            # VN has at least one 18+ release (minage field = max across releases)
            query = query.where(VisualNovel.minage == 18)

        elif rule.age_condition == "only_18plus":
            # All known releases must be 18+; unknown (NULL) ratings are ignored
            # Condition 1: at least one release with minage >= 18
            query = query.where(
                exists(
                    select(Release.id)
                    .join(ReleaseVN, Release.id == ReleaseVN.release_id)
                    .where(
                        and_(
                            ReleaseVN.vn_id == VisualNovel.id,
                            Release.minage >= 18
                        )
                    )
                )
            )
            # Condition 2: no release with known minage < 18
            query = query.where(
                ~exists(
                    select(Release.id)
                    .join(ReleaseVN, Release.id == ReleaseVN.release_id)
                    .where(
                        and_(
                            ReleaseVN.vn_id == VisualNovel.id,
                            Release.minage < 18
                        )
                    )
                )
            )

        result = await db.execute(query)
        matching_vn_ids = [row[0] for row in result.all()]

        # Collect tag_ids from this rule for blacklist entry metadata
        rule_tag_ids = rule.tag_ids_list

        for vn_id in matching_vn_ids:
            if vn_id not in vns_to_blacklist:
                vns_to_blacklist[vn_id] = []
            for tid in rule_tag_ids:
                if tid not in vns_to_blacklist[vn_id]:
                    vns_to_blacklist[vn_id].append(tid)

    logger.info(f"Found {len(vns_to_blacklist)} VNs matching blacklist rules")

    # Get current auto blacklist entries
    result = await db.execute(
        select(CoverBlacklist).where(CoverBlacklist.reason == "auto_tag")
    )
    current_auto_entries = {entry.vn_id: entry for entry in result.scalars().all()}

    added = 0
    removed = 0

    # Add new entries
    for vn_id, tag_ids in vns_to_blacklist.items():
        if vn_id not in current_auto_entries:
            # New entry
            entry = CoverBlacklist(
                vn_id=vn_id,
                reason="auto_tag",
                tag_ids=tag_ids,
                added_at=datetime.now(timezone.utc),
            )
            db.add(entry)
            added += 1
        else:
            # Update tag_ids if changed
            existing = current_auto_entries[vn_id]
            if set(existing.tag_ids or []) != set(tag_ids):
                existing.tag_ids = tag_ids
                existing.added_at = datetime.now(timezone.utc)

    # Remove entries that no longer match
    for vn_id, entry in current_auto_entries.items():
        if vn_id not in vns_to_blacklist:
            await db.delete(entry)
            removed += 1

    await db.commit()

    # Get final count
    result = await db.execute(select(func.count()).select_from(CoverBlacklist))
    total = result.scalar_one_or_none() or 0

    logger.info(f"Auto-blacklist evaluation complete: added={added}, removed={removed}, total={total}")

    return {"added": added, "removed": removed, "total": total}


async def is_vn_blacklisted(db: AsyncSession, vn_id: str) -> bool:
    """Check if a VN's cover is blacklisted."""
    result = await db.execute(
        select(CoverBlacklist.vn_id).where(CoverBlacklist.vn_id == vn_id)
    )
    return result.scalar_one_or_none() is not None


async def get_all_blacklisted_ids(db: AsyncSession) -> set[str]:
    """Get all blacklisted VN IDs as a set."""
    result = await db.execute(select(CoverBlacklist.vn_id))
    return {row[0] for row in result.all()}
