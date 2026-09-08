"""News aggregation API endpoints."""

import base64
import math
import re
from collections import defaultdict
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from app.core.auth import require_admin
from sqlalchemy import exists, func, or_, select, cast, Date
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.db.models import NewsItem, Announcement, RSSFeedConfig, VisualNovel
from app.db import schemas
from app.core.cache import get_cache
from app.services.news.inventory import list_sources
from app.services.news.sections import (
    DLSITE_RANKINGS_KEY,
    GETCHU_RANKINGS_KEY,
    OUT_NOW_WINDOW,
    SECTIONS,
    STORE_SOURCES,
    section_sources,
)

router = APIRouter()

# Per-source daily caps (only show this many per day in date-filtered mode)
SOURCE_DAILY_CAPS: dict[str, int] = {
    "vndb": 5,
}

# Sources that should be grouped into daily digests
DIGEST_SOURCES = {"vndb", "vndb_release"}

# Labels for digest cards
DIGEST_LABELS = {
    "vndb": "Recently Added to VNDB",
    "vndb_release": "VN Releases",
}

# URL slug mapping for digest permalinks
DIGEST_SLUGS = {
    "vndb": "recently-added",
    "vndb_release": "releases",
}
SLUG_TO_SOURCE = {v: k for k, v in DIGEST_SLUGS.items()}

FEED_MAX = 60
# A sale row is current while the storefront check keeps seeing it.
SALE_FRESH = timedelta(days=2)

SOURCE_LABELS = {
    "vndb": "New on VNDB",
    "vndb_release": "VNDB Releases",
    "rss": "Press",
    "twitter": "X",
    "bluesky": "Bluesky",
    "youtube": "Trailers",
    "steam": "Steam",
    "dlsite": "DLsite",
    "getchu": "Getchu",
    "digiket": "DiGiket",
    "booth": "BOOTH",
    "melonbooks": "Melonbooks",
    "freem": "ふりーむ！",
    "creator": "Creators",
    "vndb_review": "VNDB reviews",
    "review": "Reviews",
    "bsky_search": "Bluesky",
    "note": "note",
    "hatena": "Hatena Bookmark",
    "forum": "VNDB discussions",
    "reddit": "Reddit",
    "board": "5ch",
    "chan": "4chan",
    "jiten": "jiten.moe",
    "announcement": "Announcements",
}


def _vn_id(item: NewsItem) -> str | None:
    return item.vn_id or (item.extra_data or {}).get("vn_id")


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
        vnId=_vn_id(item),
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
        vnId=_vn_id(item),
    )


def _announcement_response(ann: Announcement) -> schemas.AnnouncementResponse:
    return schemas.AnnouncementResponse(
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


def _parse_date(date_str: str) -> datetime:
    """Parse YYYY-MM-DD string to date, raise HTTPException on invalid."""
    try:
        return datetime.strptime(date_str, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid date format: {date_str}. Expected YYYY-MM-DD.",
        )


# ==================== Public Endpoints ====================

@router.get("", response_model=schemas.NewsListResponse)
async def list_news(
    page: int = Query(1, ge=1, description="Page number"),
    limit: int = Query(20, ge=1, le=200, description="Items per page"),
    source: str | None = Query(None, description="Filter by source"),
    date: str | None = Query(None, description="Filter by date (YYYY-MM-DD)"),
    db: AsyncSession = Depends(get_db),
):
    """
    List news items with pagination and optional filtering.

    When `date` is provided, returns flat items for that UTC day.
    When `date` is omitted, returns the legacy feed with digest grouping.
    """
    # --- Date-filtered mode: flat items for a specific day ---
    if date:
        date_obj = _parse_date(date)
        start_of_day = datetime(date_obj.year, date_obj.month, date_obj.day, tzinfo=timezone.utc)
        end_of_day = start_of_day + timedelta(days=1)

        base_filter = [
            NewsItem.is_hidden == False,
            NewsItem.published_at >= start_of_day,
            NewsItem.published_at < end_of_day,
        ]
        if source:
            base_filter.append(NewsItem.source == source)

        # Source counts for this date (always useful for tab badges)
        source_counts_query = (
            select(NewsItem.source, func.count(NewsItem.id))
            .where(*base_filter[:3])  # date filters only (not source-filtered)
            .group_by(NewsItem.source)
        )
        source_result = await db.execute(source_counts_query)
        sources = {row[0]: row[1] for row in source_result.all()}

        # Items query
        query = select(NewsItem).where(*base_filter)
        query = query.order_by(NewsItem.published_at.desc())

        # Apply per-source daily caps if not filtering by a single source
        if not source and SOURCE_DAILY_CAPS:
            result = await db.execute(query)
            all_items = list(result.scalars().all())

            # Cap items per source
            source_seen: dict[str, int] = {}
            capped_items: list[NewsItem] = []
            for item in all_items:
                cap = SOURCE_DAILY_CAPS.get(item.source)
                if cap is not None:
                    seen = source_seen.get(item.source, 0)
                    if seen >= cap:
                        continue
                    source_seen[item.source] = seen + 1
                capped_items.append(item)

            total = len(capped_items)
            offset = (page - 1) * limit
            items = capped_items[offset:offset + limit]

            # Adjust source counts to reflect caps
            for src, cap in SOURCE_DAILY_CAPS.items():
                if src in sources and sources[src] > cap:
                    sources[src] = cap
        else:
            count_query = select(func.count()).select_from(query.subquery())
            total = (await db.execute(count_query)).scalar_one_or_none() or 0

            offset = (page - 1) * limit
            query = query.offset(offset).limit(limit)
            result = await db.execute(query)
            items = result.scalars().all()

        return schemas.NewsListResponse(
            items=[_news_item_to_list_item(item) for item in items],
            total=total,
            page=page,
            pages=math.ceil(total / limit) if total > 0 else 0,
            sources=sources,
        )

    # --- Legacy mode (no date): digest grouping for backward compat ---

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


@router.get("/dates", response_model=schemas.NewsDateListResponse)
async def list_news_dates(
    source: str | None = Query(None, description="Filter by source"),
    days: int = Query(90, ge=7, le=365, description="How many days back to look"),
    db: AsyncSession = Depends(get_db),
):
    """
    Get dates that have news content, with per-source counts.

    Used by the frontend date picker to show which dates have items.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    # Group by (date, source)
    date_col = func.date(func.timezone("UTC", NewsItem.published_at)).label("d")
    query = (
        select(date_col, NewsItem.source, func.count(NewsItem.id).label("cnt"))
        .where(NewsItem.is_hidden == False, NewsItem.published_at >= cutoff)
    )
    if source:
        query = query.where(NewsItem.source == source)
    query = query.group_by("d", NewsItem.source).order_by(date_col.desc())

    result = await db.execute(query)
    rows = result.all()

    # Aggregate into per-date structure
    date_map: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for d, src, cnt in rows:
        date_str = d.isoformat() if hasattr(d, "isoformat") else str(d)
        date_map[date_str][src] = cnt

    dates = []
    for date_str in sorted(date_map.keys(), reverse=True):
        src_counts = dict(date_map[date_str])
        dates.append(schemas.NewsDateInfo(
            date=date_str,
            count=sum(src_counts.values()),
            sources=src_counts,
        ))

    return schemas.NewsDateListResponse(
        dates=dates,
        total_dates=len(dates),
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

    sources = []
    total = 0
    for source, count in result.all():
        sources.append(schemas.NewsSourceInfo(
            id=source,
            label=SOURCE_LABELS.get(source, source),
            count=count,
        ))
        total += count

    return schemas.NewsSourcesResponse(sources=sources, total=total)


@router.get("/digest/{slug}/{date_str}", response_model=schemas.NewsDigestItem)
async def get_digest(
    slug: str,
    date_str: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Get a specific digest by type slug and date.

    Slug must be one of: 'recently-added' (vndb), 'releases' (vndb_release).
    Date must be in YYYY-MM-DD format.
    """
    source = SLUG_TO_SOURCE.get(slug)
    if not source:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown digest type: {slug}. Valid types: {', '.join(SLUG_TO_SOURCE.keys())}",
        )

    date_obj = _parse_date(date_str)

    # Query items for this source and date (UTC day boundaries)
    start_of_day = datetime(date_obj.year, date_obj.month, date_obj.day, tzinfo=timezone.utc)
    end_of_day = start_of_day + timedelta(days=1)

    result = await db.execute(
        select(NewsItem)
        .where(
            NewsItem.is_hidden == False,
            NewsItem.source == source,
            NewsItem.published_at >= start_of_day,
            NewsItem.published_at < end_of_day,
        )
        .order_by(NewsItem.published_at.desc())
    )
    items = result.scalars().all()

    if not items:
        raise HTTPException(
            status_code=404,
            detail=f"No {DIGEST_LABELS.get(source, source)} found for {date_str}.",
        )

    # Reuse existing helper for consistent digest creation
    digest = _create_digest_item(source, date_str, items)

    return schemas.NewsDigestItem(
        type="digest",
        id=digest.id,
        source=digest.source,
        sourceLabel=digest.sourceLabel,
        title=digest.title,
        date=digest.date,
        count=digest.count,
        items=digest.items,
        publishedAt=digest.publishedAt,
        previewImages=digest.previewImages,
    )


def _encode_cursor(published_at: datetime, item_id: str) -> str:
    return base64.urlsafe_b64encode(f"{published_at.isoformat()}|{item_id}".encode()).decode()


def _decode_cursor(raw: str) -> tuple[datetime, str]:
    try:
        text = base64.urlsafe_b64decode(raw.encode()).decode()
        stamp, item_id = text.split("|", 1)
        return datetime.fromisoformat(stamp), item_id
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid cursor")


# The tags column is the generic array type, so membership is spelled with ANY. A row
# with no tags at all has to count as "not a sale" rather than as unknown.
_IS_SALE = NewsItem.tags.any("sale")
_NOT_SALE = or_(NewsItem.tags.is_(None), ~NewsItem.tags.any("sale"))


LANGS = ("ja", "en")


def _lang_filter(lang: str | None):
    """Rows in one language, plus rows that are in neither (the catalogue, the stores)."""
    if lang not in LANGS:
        return None
    tagged = NewsItem.extra_data["lang"].astext
    return or_(tagged == lang, tagged.is_(None))


def _section_filter(slug: str):
    conds = [NewsItem.source.in_(section_sources(slug))]
    if slug == "releases":
        # A sale is a price, not a release.
        conds.append(_NOT_SALE)
    return conds


@router.get("/image-check")
async def image_check(
    url: str = Query(..., max_length=500),
    db: AsyncSession = Depends(get_db),
):
    """Whether a URL is the picture of some news item.

    The site's image proxy serves a fixed list of hosts and, beyond it, only pictures the
    aggregator itself recorded, which is what this answers.
    """
    known = await db.scalar(select(exists().where(NewsItem.image_url == url)))
    return {"allowed": bool(known)}


@router.get("/feed", response_model=schemas.NewsFeedResponse)
async def feed(
    section: str = Query("headlines", description="Section slug"),
    before: str | None = Query(None, description="Cursor from a previous page"),
    after: str | None = Query(None, description="Cursor of the newest row already shown"),
    limit: int = Query(30, ge=1, le=FEED_MAX),
    lang: str | None = Query(None, description="Keep to sources in one language: ja or en"),
    db: AsyncSession = Depends(get_db),
):
    """One page of a section, newest first, keyset-paged on (published_at, id).

    `before` walks back in time; `after` returns what arrived since a row, newest first;
    when more than `limit` arrived the page cursor points at the oldest of them, and when
    nothing arrived the newest cursor is the one asked with.
    """
    if section not in SECTIONS:
        raise HTTPException(status_code=404, detail="Unknown section")
    if before and after:
        raise HTTPException(status_code=400, detail="Use before or after, not both")
    query = select(NewsItem).where(NewsItem.is_hidden == False, *_section_filter(section))
    lang_cond = _lang_filter(lang)
    if lang_cond is not None:
        query = query.where(lang_cond)
    if before:
        stamp, item_id = _decode_cursor(before)
        query = query.where(
            (NewsItem.published_at < stamp)
            | ((NewsItem.published_at == stamp) & (NewsItem.id < item_id))
        )
    if after:
        stamp, item_id = _decode_cursor(after)
        query = query.where(
            (NewsItem.published_at > stamp)
            | ((NewsItem.published_at == stamp) & (NewsItem.id > item_id))
        )
    query = query.order_by(NewsItem.published_at.desc(), NewsItem.id.desc()).limit(limit + 1)
    rows = list((await db.execute(query)).scalars().all())
    more = len(rows) > limit
    rows = rows[:limit]
    if section == "releases":
        # A title VNDB records and a store lists days apart is one release, not two.
        rows = _first_per_vn(rows)
    return schemas.NewsFeedResponse(
        items=[_news_item_to_response(r) for r in rows],
        nextCursor=_encode_cursor(rows[-1].published_at, rows[-1].id) if more and rows else None,
        newestCursor=_encode_cursor(rows[0].published_at, rows[0].id) if rows else after,
    )


def _first_per_vn(rows: list[NewsItem]) -> list[NewsItem]:
    seen: set[str] = set()
    out = []
    for row in rows:
        key = _vn_id(row)
        if key and key in seen:
            continue
        if key:
            seen.add(key)
        out.append(row)
    return out


async def _by_sources(db: AsyncSession, sources: tuple[str, ...], limit: int, *conds):
    q = (
        select(NewsItem)
        .where(NewsItem.is_hidden == False, NewsItem.source.in_(sources), *conds)
        .order_by(NewsItem.published_at.desc(), NewsItem.id.desc())
        .limit(limit)
    )
    return [_news_item_to_response(r) for r in (await db.execute(q)).scalars().all()]


def _seen_after(stamp: object, cutoff: datetime) -> bool:
    if not isinstance(stamp, str):
        return False
    try:
        return datetime.fromisoformat(stamp) >= cutoff
    except ValueError:
        return False


# The catalogue's own figures for a row that names a title. They are read as the response
# is built rather than stored, so a rating or a vote count is never served stale.
_CATALOGUE_FIGURES = ("rating", "votecount", "length_minutes")


async def _add_catalogue_figures(db: AsyncSession, *lists: list[schemas.NewsItemResponse]) -> None:
    ids = {item.vnId for rows in lists for item in rows if item.vnId}
    if not ids:
        return
    found = (
        await db.execute(
            select(
                VisualNovel.id,
                VisualNovel.rating,
                VisualNovel.votecount,
                VisualNovel.length_minutes,
            ).where(VisualNovel.id.in_(ids))
        )
    ).all()
    figures = {
        row.id: {
            "rating": row.rating,
            "votecount": row.votecount,
            "length_minutes": row.length_minutes,
        }
        for row in found
    }
    # A title the catalogue does not hold still carries the keys, with nothing in them.
    absent = dict.fromkeys(_CATALOGUE_FIGURES)
    for rows in lists:
        for item in rows:
            if item.vnId:
                item.extraData = {**(item.extraData or {}), **figures.get(item.vnId, absent)}


def _dedupe_by_vn(items: list[schemas.NewsItemResponse]) -> list[schemas.NewsItemResponse]:
    """One row per VN, the catalogue's own entry first so a storefront copy never outranks it."""
    order = {"vndb_release": 0, "dlsite": 1, "steam": 2, "getchu": 3}
    seen: set[str] = set()
    out = []
    for item in sorted(items, key=lambda i: order.get(i.source, 9)):
        key = item.vnId or item.id
        if key in seen:
            continue
        seen.add(key)
        out.append(item)
    return out


TICKER_LIMIT = 20
TICKER_SECTIONS = ("headlines", "releases", "reviews")
# A store can file a whole batch of releases under one timestamp, which would otherwise
# let a single feed own the entire strip.
TICKER_PER_LABEL = 3
TICKER_QUOTAS = {"headlines": 10, "releases": 6, "reviews": 4}


def _lang_conds(lang: str | None) -> tuple:
    cond = _lang_filter(lang)
    return (cond,) if cond is not None else ()


def _cap_per_label(
    rows: list[schemas.NewsItemResponse], cap: int
) -> list[schemas.NewsItemResponse]:
    """Keep the newest `cap` rows for each sourceLabel, in the input order."""
    seen: dict[str, int] = {}
    out = []
    for row in rows:
        count = seen.get(row.sourceLabel, 0)
        if count >= cap:
            continue
        seen[row.sourceLabel] = count + 1
        out.append(row)
    return out


@router.get("/ticker", response_model=schemas.NewsTickerResponse)
async def ticker(
    lang: str | None = Query(None, description="Keep to sources in one language: ja or en"),
    db: AsyncSession = Depends(get_db),
):
    """The ticker strip, drawn from the headline, release and review sections.

    A store adapter can file a whole batch of releases with one timestamp, so each section
    is capped to a handful of rows per sourceLabel before the sections are combined by
    quota; that keeps the strip a mix of sources and sections rather than one feed's dump.
    Releases keep one row per title, as the section's own feed does.
    """
    by_section: dict[str, list[schemas.NewsItemResponse]] = {}
    for slug in TICKER_SECTIONS:
        # Dedupe shrinks the releases fetch, so it starts from a deeper pool than the others.
        fetch_limit = TICKER_LIMIT * 2 if slug == "releases" else TICKER_LIMIT
        rows = await _by_sources(
            db, section_sources(slug), fetch_limit, *_section_filter(slug)[1:], *_lang_conds(lang)
        )
        if slug == "releases":
            rows = _dedupe_by_vn(rows)
        rows.sort(key=lambda i: (i.publishedAt, i.id), reverse=True)
        by_section[slug] = _cap_per_label(rows, TICKER_PER_LABEL)

    picked: list[schemas.NewsItemResponse] = []
    leftover: list[schemas.NewsItemResponse] = []
    for slug in TICKER_SECTIONS:
        rows = by_section[slug]
        quota = TICKER_QUOTAS.get(slug, 0)
        picked.extend(rows[:quota])
        leftover.extend(rows[quota:])

    if len(picked) < TICKER_LIMIT:
        leftover.sort(key=lambda i: (i.publishedAt, i.id), reverse=True)
        picked.extend(leftover[: TICKER_LIMIT - len(picked)])

    picked.sort(key=lambda i: (i.publishedAt, i.id), reverse=True)
    return schemas.NewsTickerResponse(items=picked[:TICKER_LIMIT])


# Pages that have rails but are not sections of the feed.
RAIL_PAGES = ("front", "upcoming", "day")
THREAD_SOURCES = ("board", "chan", "forum", "reddit")
THREAD_SCAN = 50
REVIEW_WINDOW = timedelta(days=30)
ELSEWHERE_PER_SECTION = 4
RAIL_TOP = 5
MODULE_TRAILERS = 4
MODULE_COVERS = 6
MODULE_REVIEWS = 3


def _replies(item: schemas.NewsItemResponse) -> int:
    value = (item.extraData or {}).get("replies")
    return value if isinstance(value, int) else -1


async def _most_reviewed_and_reviewers(
    db: AsyncSession, review_sources: tuple[str, ...], window_start: datetime, lang_conds: tuple,
) -> tuple[list[schemas.NewsRailVN], list[schemas.NewsRailReviewer]]:
    """Counted in SQL rather than over a fetched page, so the ranking covers the whole
    window instead of however many rows a single query happened to return."""
    n = func.count().label("n")
    counts_q = (
        select(NewsItem.vn_id, n)
        .where(
            NewsItem.is_hidden == False,
            NewsItem.source.in_(review_sources),
            NewsItem.vn_id.isnot(None),
            NewsItem.published_at >= window_start,
            *lang_conds,
        )
        .group_by(NewsItem.vn_id)
        .order_by(n.desc(), NewsItem.vn_id)
        .limit(RAIL_TOP)
    )
    counts = (await db.execute(counts_q)).all()
    vn_ids = [row.vn_id for row in counts]
    count_by_vn = {row.vn_id: row.n for row in counts}

    most_reviewed: list[schemas.NewsRailVN] = []
    if vn_ids:
        rows_q = (
            select(NewsItem)
            .where(
                NewsItem.is_hidden == False,
                NewsItem.source.in_(review_sources),
                NewsItem.vn_id.in_(vn_ids),
                NewsItem.published_at >= window_start,
            )
            .order_by(NewsItem.published_at.desc(), NewsItem.id.desc())
        )
        by_vn: dict[str, list[NewsItem]] = defaultdict(list)
        for row in (await db.execute(rows_q)).scalars().all():
            by_vn[row.vn_id].append(row)
        for vn_id in vn_ids:
            group = by_vn.get(vn_id, [])
            if not group:
                continue
            # The catalogue's own review rows carry the title and cover; a blog row carries
            # the post's title, so the catalogue row speaks for the group when there is one.
            head = next((r for r in group if r.source == "vndb_review"), group[0])
            alt = (head.extra_data or {}).get("alttitle")
            most_reviewed.append(schemas.NewsRailVN(
                vnId=vn_id,
                title=head.title,
                titleJp=alt if isinstance(alt, str) else None,
                imageUrl=head.image_url,
                imageIsNsfw=head.image_is_nsfw or False,
                count=count_by_vn[vn_id],
            ))

    # Only the catalogue's own review identity is counted here, so a blog byline never
    # merges with a reviewer username by coincidence of spelling.
    reviewer_name = NewsItem.extra_data["reviewer"].astext.label("name")
    m = func.count().label("n")
    # One address per name: rows filed before the address was read carry none.
    reviewer_url = func.max(NewsItem.extra_data["reviewer_url"].astext).label("url")
    reviewers_q = (
        select(reviewer_name, m, reviewer_url)
        .where(
            NewsItem.is_hidden == False,
            NewsItem.source == "vndb_review",
            NewsItem.published_at >= window_start,
            reviewer_name.isnot(None),
            reviewer_name != "",
            *lang_conds,
        )
        .group_by(reviewer_name)
        .order_by(m.desc(), reviewer_name)
        .limit(RAIL_TOP)
    )
    reviewers = [
        schemas.NewsRailReviewer(name=row.name, count=row.n, url=row.url)
        for row in (await db.execute(reviewers_q)).all()
    ]
    return most_reviewed, reviewers


@router.get("/rail/{section}", response_model=schemas.NewsRailResponse)
async def rail(
    section: str,
    lang: str | None = Query(None, description="Keep to sources in one language: ja or en"),
    db: AsyncSession = Depends(get_db),
):
    """The rails of one page: the other sections' newest rows, the busiest threads, the
    creators' latest, the month's most-reviewed titles and reviewers, and the lists the
    river's inline modules draw from."""
    if section not in SECTIONS and section not in RAIL_PAGES:
        raise HTTPException(status_code=404, detail="Unknown section")
    lang_conds = _lang_conds(lang)
    now = datetime.now(timezone.utc)

    elsewhere = []
    for slug in SECTIONS:
        if slug == section:
            continue
        rows = await _by_sources(
            db, section_sources(slug), ELSEWHERE_PER_SECTION * 2,
            *_section_filter(slug)[1:], *lang_conds,
        )
        if slug == "releases":
            rows = sorted(_dedupe_by_vn(rows), key=lambda i: (i.publishedAt, i.id), reverse=True)
        elsewhere.append(schemas.NewsRailSection(section=slug, items=rows[:ELSEWHERE_PER_SECTION]))

    threads = await _by_sources(db, THREAD_SOURCES, THREAD_SCAN, *lang_conds)
    boards = sorted(threads, key=_replies, reverse=True)[:RAIL_TOP]
    creators = await _by_sources(db, ("creator",), RAIL_TOP, *lang_conds)

    most_reviewed, reviewers = await _most_reviewed_and_reviewers(
        db, section_sources("reviews"), now - REVIEW_WINDOW, lang_conds,
    )

    return schemas.NewsRailResponse(
        elsewhere=elsewhere,
        boards=boards,
        creators=creators,
        mostReviewed=most_reviewed,
        reviewers=reviewers,
        trailers=await _by_sources(db, ("youtube",), MODULE_TRAILERS, *lang_conds),
        covers=await _by_sources(db, ("vndb",), MODULE_COVERS, *lang_conds),
        reviews=await _by_sources(db, section_sources("reviews"), MODULE_REVIEWS, *lang_conds),
    )


@router.get("/front", response_model=schemas.NewsFrontResponse)
async def front(db: AsyncSession = Depends(get_db)):
    """The front page's rail: the day's releases, the newest catalogue entries and trailers,
    current sales, and any active announcement."""
    now = datetime.now(timezone.utc)
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    tomorrow = today + timedelta(days=1)
    day_after = tomorrow + timedelta(days=1)
    # The day's releases: the catalogue's own, and a store copy only when it is tied to an
    # entry, so the rail stays a list of titles a reader can look up here.
    release_sources = ("vndb_release",) + STORE_SOURCES
    out_now = or_(NewsItem.source == "vndb_release", NewsItem.tags.any("released"))
    tied = or_(NewsItem.source == "vndb_release", NewsItem.vn_id.isnot(None))
    releases_today = await _by_sources(
        db, release_sources, 40, out_now, tied,
        NewsItem.published_at >= today, NewsItem.published_at < tomorrow,
    )
    releases_tomorrow = await _by_sources(
        db, release_sources, 40, out_now, tied,
        NewsItem.published_at >= tomorrow, NewsItem.published_at < day_after,
    )
    rankings = await get_cache().get(DLSITE_RANKINGS_KEY) or {}
    dlsite_top = ((rankings.get("sites") or {}).get("pro") or [])[:5]
    catalogue = await _by_sources(db, ("vndb",), 5)
    trailers = await _by_sources(db, ("youtube",), 2)
    reviews = await _by_sources(db, section_sources("reviews"), 5)
    sale_rows = await _by_sources(db, ("steam",), 30, _IS_SALE)
    fresh = now - SALE_FRESH
    sale = [
        r for r in sale_rows
        if r.extraData and _seen_after(r.extraData.get("last_seen"), fresh)
    ][:6]
    ann = await db.execute(
        select(Announcement)
        .where(
            Announcement.is_active == True,
            (Announcement.expires_at.is_(None) | (Announcement.expires_at > now)),
        )
        .order_by(Announcement.published_at.desc())
        .limit(3)
    )
    releases_today = _dedupe_by_vn(releases_today)
    releases_tomorrow = _dedupe_by_vn(releases_tomorrow)
    await _add_catalogue_figures(db, releases_today, releases_tomorrow)
    return schemas.NewsFrontResponse(
        releasesToday=releases_today,
        releasesTomorrow=releases_tomorrow,
        catalogue=catalogue,
        trailers=trailers,
        reviews=reviews,
        sale=sale,
        announcements=[_announcement_response(a) for a in ann.scalars().all()],
        dlsiteRanking=dlsite_top,
    )


@router.get("/dlsite", response_model=schemas.NewsDlsiteResponse)
async def dlsite_page(db: AsyncSession = Depends(get_db)):
    """The store's weekly adventure-game rankings, as the storefront job last saw them."""
    rankings = await get_cache().get(DLSITE_RANKINGS_KEY) or {}
    sites = rankings.get("sites") or {}
    return schemas.NewsDlsiteResponse(
        asOf=rankings.get("asOf"),
        pro=sites.get("pro") or [],
        maniax=sites.get("maniax") or [],
    )


# What the releases page shows in each block, and for how long a listing counts.
LISTING_WINDOW = timedelta(days=14)
TILE_CAP = 24
COMING_CAP = 40
_OUT_NOW = or_(NewsItem.source == "vndb_release", NewsItem.tags.any("released"))
_LISTED_AHEAD = or_(NewsItem.tags.any("preorder"), NewsItem.tags.any("announced"))
_DOUJIN_STORE = NewsItem.extra_data["site"].astext == "maniax"
_COMMERCIAL = or_(NewsItem.source != "dlsite", NewsItem.extra_data["site"].astext != "maniax")


def _expected(item: schemas.NewsItemResponse) -> str:
    """The listing's announced day, in whichever key its store wrote; unknown sorts last."""
    extra = item.extraData or {}
    for key in ("expected", "expected_date"):
        value = extra.get(key)
        if isinstance(value, str) and re.match(r"^\d{4}-\d{2}(-\d{2})?$", value):
            return value
    return "9999"


def _discount(item: schemas.NewsItemResponse) -> int:
    value = (item.extraData or {}).get("discount")
    return int(value) if isinstance(value, (int, float)) else 0


@router.get("/releases", response_model=schemas.NewsReleasesResponse)
async def releases_page(db: AsyncSession = Depends(get_db)):
    """The releases page in one call: this week's releases, listings ahead, current
    discounts, the doujin shelves, and both stores' rankings."""
    now = datetime.now(timezone.utc)
    commercial = ("vndb_release", "steam", "dlsite", "getchu", "melonbooks")
    out_now = await _by_sources(
        db, commercial, 160, _OUT_NOW, _COMMERCIAL, NewsItem.published_at >= now - OUT_NOW_WINDOW
    )
    coming = await _by_sources(
        db, ("getchu", "dlsite", "melonbooks", "digiket"), 160, _LISTED_AHEAD, _COMMERCIAL,
        NewsItem.published_at >= now - LISTING_WINDOW,
    )
    coming = sorted(_dedupe_by_vn(coming), key=_expected)[:COMING_CAP]
    sale_rows = await _by_sources(db, ("steam", "dlsite"), 120, _IS_SALE)
    fresh = now - SALE_FRESH
    on_sale = [r for r in sale_rows if r.extraData and _seen_after(r.extraData.get("last_seen"), fresh)]
    on_sale = sorted(_dedupe_by_vn(on_sale), key=_discount, reverse=True)[:TILE_CAP]
    doujin = await _by_sources(
        db, ("dlsite", "booth", "digiket", "freem"), 60, _NOT_SALE,
        or_(NewsItem.source != "dlsite", _DOUJIN_STORE), NewsItem.published_at >= now - LISTING_WINDOW,
    )
    dl = await get_cache().get(DLSITE_RANKINGS_KEY) or {}
    gc = await get_cache().get(GETCHU_RANKINGS_KEY) or {}
    # The whole window is shown; the query's own limit is the only cap.
    out_now = _dedupe_by_vn(out_now)
    doujin = _dedupe_by_vn(doujin)[:TILE_CAP]
    await _add_catalogue_figures(db, out_now, coming, on_sale, doujin)
    return schemas.NewsReleasesResponse(
        outNow=out_now,
        comingUp=coming,
        onSale=on_sale,
        doujin=doujin,
        dlsite={"asOf": dl.get("asOf"), **(dl.get("sites") or {})},
        getchu={"asOf": gc.get("asOf"), **(gc.get("kinds") or {})},
    )


@router.get("/inventory", response_model=schemas.NewsInventoryResponse)
async def inventory():
    """Everything the aggregator reads, grouped by the section its rows land in."""
    return schemas.NewsInventoryResponse(sources=list_sources())


@router.get("/getchu", response_model=schemas.NewsGetchuResponse)
async def getchu_page(db: AsyncSession = Depends(get_db)):
    """The retailer's pre-order and sales rankings, as the storefront job last saw them."""
    rankings = await get_cache().get(GETCHU_RANKINGS_KEY) or {}
    kinds = rankings.get("kinds") or {}
    return schemas.NewsGetchuResponse(
        asOf=rankings.get("asOf"),
        reserve=kinds.get("reserve") or [],
        sales=kinds.get("sales") or [],
    )


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

    return [_announcement_response(ann) for ann in announcements]


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
