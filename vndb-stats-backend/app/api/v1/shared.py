"""Shareable layout endpoints for grids and tier lists."""

import json
import re
import secrets
import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, field_validator
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from slowapi import Limiter
from slowapi.util import get_remote_address

from app.db.database import get_db, async_session
from app.db.models import SharedLayout
from app.core.cache import get_cache
from app.config import get_settings

logger = logging.getLogger(__name__)

router = APIRouter()
limiter = Limiter(key_func=get_remote_address)

CACHE_PREFIX = "shared:"
CACHE_TTL = 3600  # 1 hour

ID_PATTERN = re.compile(r"^[vc]\d{1,8}$")
SHARE_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{6,12}$")
MAX_PAYLOAD_ITEMS = 500
MAX_PAYLOAD_BYTES = 50_000  # 50KB — generous for even max tier lists
MAX_TITLE_LEN = 80
MAX_TIER_LABEL_LEN = 40
MAX_TIER_COLOR_LEN = 80
MAX_TIER_ID_LEN = 20
MAX_CUSTOM_TITLE_LEN = 80
MAX_OVERRIDE_IMAGE_URL_LEN = 500
MAX_RETRIES = 3

# Trusted image URL patterns for override imageUrl validation.
# Relative paths from our own image proxy, plus VNDB's CDN.
TRUSTED_IMAGE_PATTERNS = (
    "/img/",             # Our image proxy: /img/cv/12/12345.webp
    "/api/vndb-image/",  # API image route
    "/api/proxy-image",  # General proxy route
    "https://t.vndb.org/",
    "http://t.vndb.org/",
)


def _generate_id() -> str:
    return secrets.token_urlsafe(6)  # 8 chars of URL-safe base64


def _validate_item_id(item_id: str) -> bool:
    return bool(ID_PATTERN.match(item_id))


ALLOWED_OVERRIDE_KEYS = {"customTitle", "imageUrl", "imageSexual", "cropData", "vote"}
ALLOWED_GRID_SETTINGS_KEYS = {"cropSquare", "showFrame", "showTitles", "showScores", "titleMaxH", "titlePreference"}
ALLOWED_TIERLIST_SETTINGS_KEYS = {"displayMode", "thumbnailSize", "showTitles", "showScores", "titleMaxH", "cropSquare", "titlePreference"}
ALLOWED_TIER_DEF_KEYS = {"id", "label", "color", "textColor", "noAutoSort"}


def _validate_overrides(overrides: dict, valid_item_ids: set[str]) -> None:
    """Validate and bound-check item overrides."""
    if not isinstance(overrides, dict):
        raise HTTPException(status_code=400, detail="overrides must be an object")
    for item_id, ov in overrides.items():
        if not isinstance(item_id, str) or not _validate_item_id(item_id):
            raise HTTPException(status_code=400, detail=f"Invalid override item ID: {item_id}")
        if item_id not in valid_item_ids:
            raise HTTPException(status_code=400, detail=f"Override for unknown item: {item_id}")
        if not isinstance(ov, dict):
            raise HTTPException(status_code=400, detail=f"Override for {item_id} must be an object")
        extra = set(ov.keys()) - ALLOWED_OVERRIDE_KEYS
        if extra:
            raise HTTPException(status_code=400, detail=f"Unknown override keys: {extra}")
        if "customTitle" in ov:
            if not isinstance(ov["customTitle"], str) or len(ov["customTitle"]) > MAX_CUSTOM_TITLE_LEN:
                raise HTTPException(status_code=400, detail="customTitle too long")
        if "imageUrl" in ov:
            url = ov["imageUrl"]
            if not isinstance(url, str) or len(url) > MAX_OVERRIDE_IMAGE_URL_LEN:
                raise HTTPException(status_code=400, detail="imageUrl too long")
            if not any(url.startswith(prefix) for prefix in TRUSTED_IMAGE_PATTERNS):
                raise HTTPException(
                    status_code=400,
                    detail="imageUrl must be from a trusted source",
                )
        if "imageSexual" in ov:
            if not isinstance(ov["imageSexual"], (int, float)):
                raise HTTPException(status_code=400, detail="imageSexual must be a number")
        if "vote" in ov:
            if not isinstance(ov["vote"], (int, float)) or not (0 <= ov["vote"] <= 100):
                raise HTTPException(status_code=400, detail="vote must be 0-100")
        if "cropData" in ov:
            if not isinstance(ov["cropData"], dict):
                raise HTTPException(status_code=400, detail="cropData must be an object")


def _validate_grid_data(data: dict) -> None:
    mode = data.get("mode")
    if mode not in ("vns", "characters"):
        raise HTTPException(status_code=400, detail="Invalid mode")

    grid_size = data.get("gridSize")
    if grid_size not in (3, 4, 5):
        raise HTTPException(status_code=400, detail="gridSize must be 3, 4, or 5")

    cells = data.get("cells")
    if not isinstance(cells, list) or len(cells) != grid_size * grid_size:
        raise HTTPException(status_code=400, detail=f"cells must have {grid_size * grid_size} items")

    has_item = False
    for cell in cells:
        if cell is None:
            continue
        if not isinstance(cell, str) or not _validate_item_id(cell):
            raise HTTPException(status_code=400, detail=f"Invalid item ID: {cell}")
        has_item = True

    if not has_item:
        raise HTTPException(status_code=400, detail="Grid must have at least one item")

    # Optional pool
    pool = data.get("pool", [])
    if not isinstance(pool, list):
        raise HTTPException(status_code=400, detail="pool must be a list")
    for item_id in pool:
        if not isinstance(item_id, str) or not _validate_item_id(item_id):
            raise HTTPException(status_code=400, detail=f"Invalid pool item ID: {item_id}")

    cell_count = sum(1 for c in cells if c is not None)
    if cell_count + len(pool) > MAX_PAYLOAD_ITEMS:
        raise HTTPException(status_code=400, detail=f"Too many items (max {MAX_PAYLOAD_ITEMS})")

    title = data.get("gridTitle", "")
    if not isinstance(title, str) or len(title) > MAX_TITLE_LEN:
        raise HTTPException(status_code=400, detail="gridTitle too long")

    # Validate overrides
    overrides = data.get("overrides")
    if overrides is not None:
        valid_ids = {c for c in cells if c is not None} | set(pool)
        _validate_overrides(overrides, valid_ids)

    # Validate settings
    settings = data.get("settings")
    if settings is not None:
        if not isinstance(settings, dict):
            raise HTTPException(status_code=400, detail="settings must be an object")
        extra = set(settings.keys()) - ALLOWED_GRID_SETTINGS_KEYS
        if extra:
            raise HTTPException(status_code=400, detail=f"Unknown settings keys: {extra}")


def _validate_tierlist_data(data: dict) -> None:
    mode = data.get("mode")
    if mode not in ("vns", "characters"):
        raise HTTPException(status_code=400, detail="Invalid mode")

    tier_defs = data.get("tierDefs")
    if not isinstance(tier_defs, list) or not (1 <= len(tier_defs) <= 15):
        raise HTTPException(status_code=400, detail="tierDefs must have 1-15 tiers")

    tier_ids = set()
    for td in tier_defs:
        if not isinstance(td, dict):
            raise HTTPException(status_code=400, detail="Invalid tier definition")
        for key in ("id", "label", "color", "textColor"):
            if key not in td or not isinstance(td[key], str):
                raise HTTPException(status_code=400, detail=f"Tier missing {key}")
        if len(td["id"]) > MAX_TIER_ID_LEN:
            raise HTTPException(status_code=400, detail="Tier ID too long")
        if len(td["label"]) > MAX_TIER_LABEL_LEN:
            raise HTTPException(status_code=400, detail="Tier label too long")
        if len(td["color"]) > MAX_TIER_COLOR_LEN or len(td["textColor"]) > MAX_TIER_COLOR_LEN:
            raise HTTPException(status_code=400, detail="Tier color too long")
        tier_ids.add(td["id"])

    tiers = data.get("tiers")
    if not isinstance(tiers, dict):
        raise HTTPException(status_code=400, detail="tiers must be an object")

    total_items = 0
    for tier_id, items in tiers.items():
        if tier_id not in tier_ids:
            raise HTTPException(status_code=400, detail=f"Unknown tier ID: {tier_id}")
        if not isinstance(items, list):
            raise HTTPException(status_code=400, detail=f"Tier {tier_id} items must be a list")
        for item_id in items:
            if not isinstance(item_id, str) or not _validate_item_id(item_id):
                raise HTTPException(status_code=400, detail=f"Invalid item ID: {item_id}")
            total_items += 1

    # Optional pool
    pool = data.get("pool", [])
    if not isinstance(pool, list):
        raise HTTPException(status_code=400, detail="pool must be a list")
    for item_id in pool:
        if not isinstance(item_id, str) or not _validate_item_id(item_id):
            raise HTTPException(status_code=400, detail=f"Invalid pool item ID: {item_id}")
    total_items += len(pool)

    if total_items == 0:
        raise HTTPException(status_code=400, detail="Tier list must have at least one item")
    if total_items > MAX_PAYLOAD_ITEMS:
        raise HTTPException(status_code=400, detail=f"Too many items (max {MAX_PAYLOAD_ITEMS})")

    title = data.get("listTitle", "")
    if not isinstance(title, str) or len(title) > MAX_TITLE_LEN:
        raise HTTPException(status_code=400, detail="listTitle too long")

    # Validate overrides
    overrides = data.get("overrides")
    if overrides is not None:
        all_item_ids: set[str] = set()
        for items in tiers.values():
            if isinstance(items, list):
                all_item_ids.update(i for i in items if isinstance(i, str))
        all_item_ids.update(pool)
        _validate_overrides(overrides, all_item_ids)

    # Validate settings
    settings = data.get("settings")
    if settings is not None:
        if not isinstance(settings, dict):
            raise HTTPException(status_code=400, detail="settings must be an object")
        extra = set(settings.keys()) - ALLOWED_TIERLIST_SETTINGS_KEYS
        if extra:
            raise HTTPException(status_code=400, detail=f"Unknown settings keys: {extra}")

    # Sanitize tier defs — strip unknown keys
    for td in tier_defs:
        extra_keys = set(td.keys()) - ALLOWED_TIER_DEF_KEYS
        for k in extra_keys:
            del td[k]


TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"


async def _verify_turnstile(token: str, ip: str | None = None) -> bool:
    """Verify a Turnstile token with Cloudflare. Returns True if valid."""
    secret = get_settings().turnstile_secret_key
    if not secret:
        return True  # Turnstile not configured — allow all

    payload: dict[str, str] = {"secret": secret, "response": token}
    if ip:
        payload["remoteip"] = ip

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.post(TURNSTILE_VERIFY_URL, data=payload)
            result = resp.json()
            if not result.get("success"):
                logger.warning("Turnstile verification failed: %s", result.get("error-codes"))
            return bool(result.get("success"))
    except Exception as e:
        logger.error("Turnstile verification error: %s", e)
        return True  # Fail open — don't block real users if Cloudflare is down


class SharedLayoutCreate(BaseModel):
    type: str
    data: dict
    turnstile_token: str | None = None

    @field_validator("type")
    @classmethod
    def validate_type(cls, v: str) -> str:
        if v not in ("grid", "tierlist"):
            raise ValueError("type must be 'grid' or 'tierlist'")
        return v


class SharedLayoutResponse(BaseModel):
    id: str


class SharedLayoutDetail(BaseModel):
    id: str
    type: str
    data: dict
    created_at: str


def _summarize_payload(layout_type: str, data: dict) -> str:
    """Build a concise summary string for logging."""
    if layout_type == "grid":
        mode = data.get("mode", "?")
        size = data.get("gridSize", "?")
        cells = data.get("cells", [])
        pool = data.get("pool", [])
        filled = sum(1 for c in cells if c is not None) if isinstance(cells, list) else 0
        pool_count = len(pool) if isinstance(pool, list) else 0
        title = data.get("gridTitle", "")
        overrides = len(data.get("overrides", {}))
        parts = [f"grid {size}x{size} {mode}", f"{filled} filled"]
        if pool_count:
            parts.append(f"{pool_count} pool")
        if overrides:
            parts.append(f"{overrides} overrides")
        if title:
            parts.append(f"title={title!r:.30}")
        return " | ".join(parts)
    else:
        mode = data.get("mode", "?")
        tiers = data.get("tiers", {})
        pool = data.get("pool", [])
        tier_count = len(tiers) if isinstance(tiers, dict) else 0
        item_count = sum(len(v) for v in tiers.values()) if isinstance(tiers, dict) else 0
        pool_count = len(pool) if isinstance(pool, list) else 0
        title = data.get("listTitle", "")
        parts = [f"tierlist {mode}", f"{tier_count} tiers", f"{item_count} items"]
        if pool_count:
            parts.append(f"{pool_count} pool")
        if title:
            parts.append(f"title={title!r:.30}")
        return " | ".join(parts)


@router.post("", response_model=SharedLayoutResponse)
@limiter.limit("10/minute;50/day")
async def create_shared_layout(
    body: SharedLayoutCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Create a shareable link for a grid or tier list layout."""
    # Turnstile bot protection
    settings = get_settings()
    if settings.turnstile_secret_key:
        if not body.turnstile_token:
            raise HTTPException(status_code=403, detail="Verification required")
        client_ip = get_remote_address(request)
        if not await _verify_turnstile(body.turnstile_token, client_ip):
            raise HTTPException(status_code=403, detail="Verification failed")

    # Payload size cap
    payload_size = len(json.dumps(body.data).encode())
    if payload_size > MAX_PAYLOAD_BYTES:
        raise HTTPException(status_code=400, detail="Payload too large")

    if body.type == "grid":
        _validate_grid_data(body.data)
    else:
        _validate_tierlist_data(body.data)

    for attempt in range(MAX_RETRIES):
        share_id = _generate_id()
        existing = await db.execute(
            select(SharedLayout.id).where(SharedLayout.id == share_id)
        )
        if existing.scalar_one_or_none() is not None:
            continue

        layout = SharedLayout(id=share_id, type=body.type, data=body.data)
        db.add(layout)
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
            continue

        # Cache it immediately
        cache = get_cache()
        await cache.set(
            f"{CACHE_PREFIX}{share_id}",
            {"id": share_id, "type": body.type, "data": body.data, "created_at": layout.created_at.isoformat()},
            ttl=CACHE_TTL,
        )

        ua = request.headers.get("user-agent", "unknown")
        summary = _summarize_payload(body.type, body.data)
        logger.info("Shared %s created: %s | id=%s | ua=%s", body.type, summary, share_id, ua[:120])

        return SharedLayoutResponse(id=share_id)

    raise HTTPException(status_code=500, detail="Failed to generate unique ID")


@router.get("/{share_id}", response_model=SharedLayoutDetail)
async def get_shared_layout(
    share_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Retrieve a shared grid or tier list layout."""
    if not SHARE_ID_PATTERN.match(share_id):
        raise HTTPException(status_code=404, detail="Shared layout not found")

    cache = get_cache()
    cache_key = f"{CACHE_PREFIX}{share_id}"

    cached = await cache.get(cache_key)
    if cached:
        # Increment view count in a separate session so the cached response is unaffected
        _increment_view_count_bg(share_id)
        return cached

    result = await db.execute(
        select(SharedLayout).where(SharedLayout.id == share_id)
    )
    layout = result.scalar_one_or_none()
    if not layout:
        raise HTTPException(status_code=404, detail="Shared layout not found")

    response = {
        "id": layout.id,
        "type": layout.type,
        "data": layout.data,
        "created_at": layout.created_at.isoformat(),
    }
    await cache.set(cache_key, response, ttl=CACHE_TTL)

    # Increment view count in a separate session to avoid tainting the read session
    _increment_view_count_bg(share_id)

    return response


def _increment_view_count_bg(share_id: str) -> None:
    """Fire-and-forget view count increment using a separate DB session."""
    import asyncio

    async def _do_increment():
        try:
            async with async_session() as session:
                await session.execute(
                    update(SharedLayout)
                    .where(SharedLayout.id == share_id)
                    .values(view_count=SharedLayout.view_count + 1, last_viewed_at=func.now())
                )
                await session.commit()
        except Exception as e:
            logger.warning("view_count update failed for %s: %s", share_id, e)

    try:
        loop = asyncio.get_running_loop()
        loop.create_task(_do_increment())
    except RuntimeError:
        pass
