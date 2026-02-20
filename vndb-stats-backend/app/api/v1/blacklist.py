"""Cover blacklist API endpoints for managing auto and manual cover blacklisting."""

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.db.models import (
    CoverBlacklist, CoverBlacklistConfig, Tag, VisualNovel
)
from app.core.auth import require_admin

router = APIRouter()


def _escape_like(value: str) -> str:
    """Escape SQL LIKE wildcard characters in user input."""
    return value.replace('%', r'\%').replace('_', r'\_')


# ==================== Pydantic Schemas ====================

class BlacklistConfigResponse(BaseModel):
    """Auto-blacklist rule response."""
    id: int
    tagId: int
    tagName: str
    tagCategory: str | None
    votecountThreshold: int
    minTagScore: float
    isActive: bool
    createdAt: datetime | None
    updatedAt: datetime | None

    class Config:
        from_attributes = True


class BlacklistEntryResponse(BaseModel):
    """Blacklisted VN entry response."""
    vnId: str
    vnTitle: str
    vnImageUrl: str | None
    reason: str
    tagIds: list[int] | None
    tagNames: list[str] | None
    addedAt: datetime
    addedBy: str | None
    notes: str | None

    class Config:
        from_attributes = True


class BlacklistStatsResponse(BaseModel):
    """Blacklist statistics."""
    totalBlacklisted: int
    manualCount: int
    autoCount: int
    rulesCount: int
    activeRulesCount: int


class BlacklistIdsResponse(BaseModel):
    """List of blacklisted VN IDs for caching."""
    vnIds: list[str]
    updatedAt: datetime


class TagSearchResult(BaseModel):
    """Tag search result for autocomplete."""
    id: int
    name: str
    category: str | None
    vnCount: int


# ==================== Helper Functions ====================

async def _get_tag_names(db: AsyncSession, tag_ids: list[int] | None) -> list[str]:
    """Get tag names for a list of tag IDs."""
    if not tag_ids:
        return []
    result = await db.execute(
        select(Tag.name).where(Tag.id.in_(tag_ids))
    )
    return [row[0] for row in result.all()]


# ==================== Public Endpoints ====================

@router.get("/ids", response_model=BlacklistIdsResponse, include_in_schema=False)
async def get_blacklist_ids(db: AsyncSession = Depends(get_db)):
    """
    Get all blacklisted VN IDs.

    This endpoint is used by the image route to cache the blacklist
    and check if a cover should be blocked.
    """
    result = await db.execute(select(CoverBlacklist.vn_id))
    vn_ids = [row[0] for row in result.all()]

    return BlacklistIdsResponse(
        vnIds=vn_ids,
        updatedAt=datetime.now(timezone.utc)
    )


# ==================== Admin Config Endpoints ====================

@router.get("/admin/config", response_model=list[BlacklistConfigResponse], dependencies=[Depends(require_admin)], include_in_schema=False)
async def list_blacklist_configs(
    db: AsyncSession = Depends(get_db),
):
    """List all auto-blacklist rules."""
    result = await db.execute(
        select(CoverBlacklistConfig, Tag)
        .join(Tag, CoverBlacklistConfig.tag_id == Tag.id)
        .order_by(CoverBlacklistConfig.id)
    )
    rows = result.all()

    return [
        BlacklistConfigResponse(
            id=config.id,
            tagId=config.tag_id,
            tagName=tag.name,
            tagCategory=tag.category,
            votecountThreshold=config.votecount_threshold,
            minTagScore=config.min_tag_score,
            isActive=config.is_active,
            createdAt=config.created_at,
            updatedAt=config.updated_at,
        )
        for config, tag in rows
    ]


@router.get("/admin/entries", response_model=list[BlacklistEntryResponse], dependencies=[Depends(require_admin)], include_in_schema=False)
async def list_blacklist_entries(
    reason: Optional[str] = Query(None, description="Filter by reason: 'manual' or 'auto_tag'"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    """List blacklisted VN entries."""
    query = (
        select(CoverBlacklist, VisualNovel)
        .join(VisualNovel, CoverBlacklist.vn_id == VisualNovel.id)
    )

    if reason:
        query = query.where(CoverBlacklist.reason == reason)

    query = query.order_by(CoverBlacklist.added_at.desc()).limit(limit).offset(offset)

    result = await db.execute(query)
    rows = result.all()

    entries = []
    for blacklist, vn in rows:
        tag_names = await _get_tag_names(db, blacklist.tag_ids)
        entries.append(BlacklistEntryResponse(
            vnId=blacklist.vn_id,
            vnTitle=vn.title,
            vnImageUrl=vn.image_url,
            reason=blacklist.reason,
            tagIds=blacklist.tag_ids,
            tagNames=tag_names if tag_names else None,
            addedAt=blacklist.added_at,
            addedBy=blacklist.added_by,
            notes=blacklist.notes,
        ))

    return entries


@router.get("/admin/stats", response_model=BlacklistStatsResponse, dependencies=[Depends(require_admin)], include_in_schema=False)
async def get_blacklist_stats(
    db: AsyncSession = Depends(get_db),
):
    """Get blacklist statistics."""
    # Total blacklisted
    result = await db.execute(select(func.count()).select_from(CoverBlacklist))
    total = result.scalar_one_or_none() or 0

    # By reason
    result = await db.execute(
        select(func.count()).select_from(CoverBlacklist).where(CoverBlacklist.reason == "manual")
    )
    manual_count = result.scalar_one_or_none() or 0

    auto_count = total - manual_count

    # Rules count
    result = await db.execute(select(func.count()).select_from(CoverBlacklistConfig))
    rules_count = result.scalar_one_or_none() or 0

    result = await db.execute(
        select(func.count()).select_from(CoverBlacklistConfig).where(CoverBlacklistConfig.is_active == True)
    )
    active_rules_count = result.scalar_one_or_none() or 0

    return BlacklistStatsResponse(
        totalBlacklisted=total,
        manualCount=manual_count,
        autoCount=auto_count,
        rulesCount=rules_count,
        activeRulesCount=active_rules_count,
    )


# ==================== Tag Search Endpoint ====================

@router.get("/admin/tags/search", response_model=list[TagSearchResult], dependencies=[Depends(require_admin)], include_in_schema=False)
async def search_tags(
    q: str = Query(..., min_length=2, description="Search query"),
    limit: int = Query(20, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
):
    """Search tags for autocomplete when creating rules."""
    result = await db.execute(
        select(Tag)
        .where(Tag.name.ilike(f"%{_escape_like(q)}%"))
        .order_by(Tag.vn_count.desc())
        .limit(limit)
    )
    tags = result.scalars().all()

    return [
        TagSearchResult(
            id=tag.id,
            name=tag.name,
            category=tag.category,
            vnCount=tag.vn_count or 0,
        )
        for tag in tags
    ]
