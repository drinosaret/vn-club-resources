"""BOOTH: the newest PC-game listings carrying the novel/adventure tag.

A tag search answers only items carrying the tag, so the browse page already narrows the
category to the works wanted. It is sorted by publication and carries no dates itself; the
per-item JSON supplies the publication time and the adult flag, and the listing is read
newest first until an item falls outside the window, so items that merely resurface on
the page are not filed again. Every listing is matched against the catalogue; an unmatched
work becomes a row of its own with the store picture.
"""

from __future__ import annotations

import asyncio
import html
import json
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Awaitable, Callable

import aiohttp

from app.services.news.drafts import NewsDraft
from app.services.news.matching import MatchedVN

logger = logging.getLogger(__name__)

BASE = "https://booth.pm"
BROWSE_TAG = "ノベル・アドベンチャー"
BROWSE_URL = BASE + "/ja/browse/PC%E3%82%B2%E3%83%BC%E3%83%A0?sort=new&tags%5B%5D=" + (
    "%E3%83%8E%E3%83%99%E3%83%AB%E3%83%BB%E3%82%A2%E3%83%89%E3%83%99%E3%83%B3%E3%83%81%E3%83%A3%E3%83%BC"
)
ITEM_JSON_URL = BASE + "/ja/items/{id}.json"
ITEM_URL = BASE + "/ja/items/{id}"
# Adult listings are hidden from a visitor who has not confirmed their age.
COOKIES = {"adult": "t"}
MAX_ITEMS = 30
PUBLISHED_WINDOW = timedelta(days=7)
REQUEST_GAP = 2
NSFW_COVER = 1.5
USER_AGENT = "Mozilla/5.0 (compatible; VN-Club-Resources/1.0; +https://vnclub.org)"

# Wording that marks a novel or adventure work in the store's own tags and copy.
NOVEL_WORDS = re.compile(r"ノベル|ADV|アドベンチャー|ビジュアルノベル|恋愛|乙女ゲーム|BL")

_CARD = re.compile(r'<li class="item-card[^"]*"([^>]*)>')
_ATTR = re.compile(r'data-product-(\w+)="([^"]*)"')
_THUMB = re.compile(r'item-card__thumbnail-image"[^>]*data-original="([^"]+)"')
_SHOP = re.compile(r'item-card__shop-name">([^<]*)<')


@dataclass
class BoothItem:
    item_id: str
    name: str
    shop: str | None
    price: int | None = None
    image_url: str | None = None
    adult: bool = False
    published_at: datetime | None = None
    tags: list[str] = field(default_factory=list)
    description: str | None = None


# ---------------------------------------------------------------- parsing


def parse_listing(page: str, tag: str | None = BROWSE_TAG) -> list[BoothItem]:
    """The cards of one browse page, in page order.

    `tag` is the tag the page was filtered by; every card is known to carry it.
    """
    positions = [m for m in _CARD.finditer(page)]
    items = []
    for i, m in enumerate(positions):
        end = positions[i + 1].start() if i + 1 < len(positions) else len(page)
        block = page[m.start():end]
        attrs = {k: html.unescape(v) for k, v in _ATTR.findall(m.group(1))}
        item_id = attrs.get("id")
        if not item_id:
            continue
        thumb = _THUMB.search(block)
        shop = _SHOP.search(block)
        price = attrs.get("price")
        items.append(
            BoothItem(
                item_id=item_id,
                name=attrs.get("name") or item_id,
                shop=html.unescape(shop.group(1)).strip() if shop else attrs.get("brand"),
                price=int(price) if price and price.isdigit() else None,
                image_url=html.unescape(thumb.group(1)) if thumb else None,
                tags=[tag] if tag else [],
            )
        )
    return items


def _parse_stamp(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _parse_price(value: Any) -> int | None:
    digits = re.sub(r"[^\d]", "", value) if isinstance(value, str) else ""
    return int(digits) if digits else None


def apply_item_json(item: BoothItem, data: dict[str, Any]) -> BoothItem:
    """Fill the fields only the item's own record carries."""
    item.adult = bool(data.get("is_adult"))
    item.published_at = _parse_stamp(data.get("published_at")) or item.published_at
    item.description = data.get("description") or item.description
    names = [t.get("name") for t in data.get("tags") or [] if isinstance(t, dict)]
    item.tags = list(dict.fromkeys(item.tags + [n for n in names if isinstance(n, str)]))
    shop = data.get("shop") or {}
    if isinstance(shop, dict) and shop.get("name"):
        item.shop = shop["name"]
    if data.get("name"):
        item.name = data["name"]
    price = _parse_price(data.get("price"))
    if price is not None:
        item.price = price
    if not item.image_url:
        images = data.get("images") or []
        first = images[0] if images and isinstance(images[0], dict) else {}
        item.image_url = first.get("resized") or first.get("original") or None
    return item


def is_novel_like(item: BoothItem) -> bool:
    text = " ".join([item.name, *item.tags, item.description or ""])
    return bool(NOVEL_WORDS.search(text))


def format_price(price: int | None) -> str | None:
    if price is None:
        return None
    return "無料" if price == 0 else f"¥{price:,}"


# ---------------------------------------------------------------- drafts

Matcher = Callable[[str, str], Awaitable[MatchedVN | None]]


async def _draft(item: BoothItem, match: Matcher, now: datetime) -> NewsDraft:
    vn = await match("booth", item.item_id)
    published = item.published_at or now
    extra: dict[str, Any] = {
        "kind": "released",
        "item_id": item.item_id,
        "store_title": item.name,
        "final_price": format_price(item.price),
        "platforms": ["win"],
        "released": published.date().isoformat(),
        "developers": [item.shop] if item.shop else [],
        "minage": 18 if item.adult else None,
    }
    if vn is not None:
        extra.update(
            {
                "vn_id": vn.id,
                "alttitle": vn.title_jp,
                "title_romaji": vn.title_romaji,
                "developers": vn.developers or extra["developers"],
                "developers_original": vn.developers_original or extra["developers"],
                "minage": vn.minage,
                "image_sexual": vn.image_sexual,
            }
        )
        has_cover = bool(vn.image_url)
        return NewsDraft(
            source="booth",
            source_label="BOOTH",
            key=item.item_id,
            title=vn.title,
            summary=item.name,
            url=ITEM_URL.format(id=item.item_id),
            image_url=vn.image_url or item.image_url,
            image_is_nsfw=(
                bool(vn.image_sexual and vn.image_sexual >= NSFW_COVER) if has_cover else item.adult
            ),
            published_at=published,
            tags=["released"],
            vn_id=vn.id,
            extra=extra,
        )
    return NewsDraft(
        source="booth",
        source_label="BOOTH",
        key=item.item_id,
        title=item.name,
        summary=item.shop,
        url=ITEM_URL.format(id=item.item_id),
        image_url=item.image_url,
        image_is_nsfw=item.adult,
        published_at=published,
        tags=["released"],
        extra=extra,
    )


async def drafts_from_works(items: list[BoothItem], match: Matcher, now: datetime) -> list[NewsDraft]:
    """Rows for the novel-like items published inside the window; an undated item counts as new."""
    drafts = []
    for item in items[:MAX_ITEMS]:
        if not is_novel_like(item):
            continue
        if item.published_at and now - item.published_at > PUBLISHED_WINDOW:
            continue
        drafts.append(await _draft(item, match, now))
    return drafts


# ---------------------------------------------------------------- fetching


async def _get(session: aiohttp.ClientSession, url: str) -> str | None:
    try:
        async with session.get(
            url,
            headers={"User-Agent": USER_AGENT},
            cookies=COOKIES,
            timeout=aiohttp.ClientTimeout(total=30),
        ) as resp:
            if resp.status != 200:
                logger.warning("BOOTH %s returned %s", url, resp.status)
                return None
            return await resp.text()
    except Exception as e:  # noqa: BLE001
        logger.warning("BOOTH %s failed: %s", url, e)
        return None


async def fetch_new(session: aiohttp.ClientSession, match: Matcher, now: datetime) -> list[NewsDraft]:
    page = await _get(session, BROWSE_URL)
    if not page:
        return []
    items = parse_listing(page)
    kept: list[BoothItem] = []
    for item in items[:MAX_ITEMS]:
        await asyncio.sleep(REQUEST_GAP)
        text = await _get(session, ITEM_JSON_URL.format(id=item.item_id))
        try:
            data = json.loads(text) if text else None
        except ValueError:
            data = None
        if isinstance(data, dict):
            apply_item_json(item, data)
        # The page is newest first, so the first item past the window ends the read.
        if item.published_at and now - item.published_at > PUBLISHED_WINDOW:
            break
        kept.append(item)
    drafts = await drafts_from_works(kept, match, now)
    logger.info("BOOTH: %d rows of %d listed", len(drafts), len(items))
    return drafts
