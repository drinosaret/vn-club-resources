"""News aggregation API endpoints."""

import math
from collections import defaultdict
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from app.core.auth import require_admin
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.db.models import NewsItem, Announcement, RSSFeedConfig
from app.db import schemas

router = APIRouter()

# Sources that should be grouped into daily digests
DIGEST_SOURCES = {"vndb", "vndb_release"}

# Labels for digest cards
DIGEST_LABELS = {
    "vndb": "Recently Added to VNDB",
    "vndb_release": "VN Releases",
}


def _news_item_to_response(item: NewsItem) -> schemas.NewsItemResponse:
    """Convert a NewsItem model to response schema."""
    return schemas.NewsItemResponse(
        id=item.id,
        source=item.source,
        sourceLabel=item.source_label or item.source,
        title=item.title,
        summary=item.summary,
        url=item.url,
        imageUrl=item.image_url,
        imageIsNsfw=item.image_is_nsfw or False,
        publishedAt=item.published_at,
        tags=item.tags,
        extraData=item.extra_data,
    )


def _create_digest_item(source: str, date_key: str, items: list[NewsItem]) -> schemas.NewsListItem:
    """Create a digest card from grouped news items."""
    # Sort items by published_at descending
    sorted_items = sorted(items, key=lambda x: x.published_at, reverse=True)
    latest_time = sorted_items[0].published_at

    # Get preview images (first 4 non-NSFW covers)
    preview_images = []
    for item in sorted_items:
        if item.image_url and not item.image_is_nsfw and len(preview_images) < 4:
            preview_images.append(item.image_url)

    # Parse date for display
    from datetime import datetime as dt
    date_obj = dt.strptime(date_key, "%Y-%m-%d")
    formatted_date = date_obj.strftime("%B %d, %Y")

    label = DIGEST_LABELS.get(source, source)
    title = f"{label} - {formatted_date}"

    return schemas.NewsListItem(
        type="digest",
        id=f"digest-{source}-{date_key}",
        source=source,
        sourceLabel=label,
        title=title,
        date=date_key,
        count=len(items),
        items=[_news_item_to_response(item) for item in sorted_items],
        publishedAt=latest_time,
        previewImages=preview_images,
    )


def _news_item_to_list_item(item: NewsItem) -> schemas.NewsListItem:
    """Convert a NewsItem to a NewsListItem for the unified response."""
    return schemas.NewsListItem(
        type="item",
        id=item.id,
        source=item.source,
        sourceLabel=item.source_label or item.source,
        title=item.title,
        summary=item.summary,
        url=item.url,
        imageUrl=item.image_url,
        imageIsNsfw=item.image_is_nsfw or False,
        publishedAt=item.published_at,
        tags=item.tags,
        extraData=item.extra_data,
    )


# ==================== Public Endpoints ====================

@router.get("", response_model=schemas.NewsListResponse)
async def list_news(
    page: int = Query(1, ge=1, description="Page number"),
    limit: int = Query(20, ge=1, le=100, description="Items per page"),
    source: str | None = Query(None, description="Filter by source"),
    db: AsyncSession = Depends(get_db),
):
    """
    List news items with pagination and optional filtering.

    Returns news from all sources: VNDB, RSS feeds, Twitter, and announcements.
    When no source filter is applied, VNDB items are grouped into daily digest cards.
    """
    # Get source counts (always needed)
    source_counts_query = (
        select(NewsItem.source, func.count(NewsItem.id))
        .where(NewsItem.is_hidden == False)
        .group_by(NewsItem.source)
    )
    source_result = await db.execute(source_counts_query)
    sources = {row[0]: row[1] for row in source_result.all()}

    # If filtering by a specific source, return individual items (no grouping)
    if source:
        query = select(NewsItem).where(
            NewsItem.is_hidden == False,
            NewsItem.source == source
        )

        # Get total count
        count_query = select(func.count()).select_from(query.subquery())
        total = (await db.execute(count_query)).scalar_one_or_none() or 0

        # Get paginated results
        offset = (page - 1) * limit
        query = query.order_by(NewsItem.published_at.desc()).offset(offset).limit(limit)
        result = await db.execute(query)
        items = result.scalars().all()

        return schemas.NewsListResponse(
            items=[_news_item_to_list_item(item) for item in items],
            total=total,
            page=page,
            pages=math.ceil(total / limit) if total > 0 else 0,
            sources=sources,
        )

    # No source filter - group VNDB items into daily digests
    # Limit to last 90 days to avoid loading entire table into memory
    cutoff_date = datetime.now(timezone.utc) - timedelta(days=90)
    query = (
        select(NewsItem)
        .where(NewsItem.is_hidden == False)
        .where(NewsItem.published_at >= cutoff_date)
        .order_by(NewsItem.published_at.desc())
    )
    result = await db.execute(query)
    all_items = result.scalars().all()

    # Group digest sources by date, keep others as individual items
    digest_groups: dict[str, dict[str, list[NewsItem]]] = defaultdict(lambda: defaultdict(list))
    individual_items: list[schemas.NewsListItem] = []

    for item in all_items:
        if item.source in DIGEST_SOURCES:
            date_key = item.published_at.strftime("%Y-%m-%d")
            digest_groups[item.source][date_key].append(item)
        else:
            individual_items.append(_news_item_to_list_item(item))

    # Create digest cards from groups
    digest_items: list[schemas.NewsListItem] = []
    for source_name, date_groups in digest_groups.items():
        for date_key, items_in_date in date_groups.items():
            digest_items.append(_create_digest_item(source_name, date_key, items_in_date))

    # Combine all items and sort by publishedAt
    all_list_items = individual_items + digest_items
    all_list_items.sort(key=lambda x: x.publishedAt, reverse=True)

    # Apply pagination
    total = len(all_list_items)
    offset = (page - 1) * limit
    paginated_items = all_list_items[offset:offset + limit]

    return schemas.NewsListResponse(
        items=paginated_items,
        total=total,
        page=page,
        pages=math.ceil(total / limit) if total > 0 else 0,
        sources=sources,
    )


@router.get("/sources", response_model=schemas.NewsSourcesResponse)
async def get_news_sources(
    db: AsyncSession = Depends(get_db),
):
    """Get available news sources with item counts."""
    query = (
        select(NewsItem.source, func.count(NewsItem.id))
        .where(NewsItem.is_hidden == False)
        .group_by(NewsItem.source)
    )
    result = await db.execute(query)

    source_labels = {
        "vndb": "VNDB New VNs",
        "vndb_release": "VNDB Releases",
        "rss": "RSS Feeds",
        "twitter": "Twitter",
        "announcement": "Announcements",
    }

    sources = []
    total = 0
    for source, count in result.all():
        sources.append(schemas.NewsSourceInfo(
            id=source,
            label=source_labels.get(source, source),
            count=count,
        ))
        total += count

    return schemas.NewsSourcesResponse(sources=sources, total=total)


@router.get("/{item_id}", response_model=schemas.NewsItemResponse)
async def get_news_item(
    item_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Get a single news item by ID."""
    result = await db.execute(
        select(NewsItem).where(NewsItem.id == item_id)
    )
    item = result.scalar_one_or_none()

    if not item:
        raise HTTPException(status_code=404, detail="News item not found")

    return _news_item_to_response(item)




# ==================== Announcement Endpoints ====================

@router.get("/announcements/list", response_model=list[schemas.AnnouncementResponse])
async def list_announcements(
    include_inactive: bool = Query(False, description="Include inactive announcements"),
    db: AsyncSession = Depends(get_db),
):
    """List all announcements."""
    query = select(Announcement)
    if not include_inactive:
        query = query.where(Announcement.is_active == True)
    query = query.order_by(Announcement.published_at.desc())

    result = await db.execute(query)
    announcements = result.scalars().all()

    return [
        schemas.AnnouncementResponse(
            id=ann.id,
            title=ann.title,
            content=ann.content,
            url=ann.url,
            imageUrl=ann.image_url,
            publishedAt=ann.published_at,
            expiresAt=ann.expires_at,
            isActive=ann.is_active,
            createdBy=ann.created_by,
        )
        for ann in announcements
    ]


# ==================== RSS Config Endpoints ====================

@router.get("/rss-configs", response_model=list[schemas.RSSFeedConfigResponse], dependencies=[Depends(require_admin)], include_in_schema=False)
async def list_rss_configs(
    db: AsyncSession = Depends(get_db),
):
    """List all RSS feed configurations."""
    result = await db.execute(
        select(RSSFeedConfig).order_by(RSSFeedConfig.name)
    )
    configs = result.scalars().all()

    return [
        schemas.RSSFeedConfigResponse(
            id=config.id,
            name=config.name,
            url=config.url,
            keywords=config.keywords,
            excludeKeywords=config.exclude_keywords,
            isActive=config.is_active,
            lastChecked=config.last_checked,
            checkIntervalMinutes=config.check_interval_minutes or 60,
        )
        for config in configs
    ]
