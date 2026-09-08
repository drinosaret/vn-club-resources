"""Getchu: the monthly release schedule with prices, and the pre-order and sales rankings.

The schedule lists every edition of a title (package, console port, bundle) as a row of its
own, each linking the soft id that the catalogue's release links carry. Pages are EUC-JP
and sit behind an age-confirmation cookie. The PC game section is the adult one, so a row
counts as adult unless the page marks it otherwise. Package pictures are refused without a
same-site referer, which whatever serves them has to send.
"""

from __future__ import annotations

import asyncio
import html
import logging
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any, Awaitable, Callable

import aiohttp

from app.services.news.drafts import NewsDraft
from app.services.news.matching import MatchedVN
from app.services.news.sections import OUT_NOW_WINDOW

logger = logging.getLogger(__name__)

BASE = "https://www.getchu.com"
PRICE_URL = BASE + "/all/price.html?genre=pc_soft&year={y}&month={m}"
RANKING_URL = BASE + "/rank/?type={kind}"
SOFT_URL = BASE + "/soft.phtml?id={id}"
PACKAGE_URL = BASE + "/brandnew/{id}/c{id}package.jpg"
THUMB_URL = BASE + "/brandnew/{id}/c{id}package_s.jpg"
ENCODING = "euc_jp"
# The cookie the age-confirmation page sets; without it listings answer with the gate.
COOKIES = {"getchu_adalt_flag": "getchu.com"}
REQUEST_PAUSE = 3
RELEASED_WINDOW = OUT_NOW_WINDOW
RANKING_KINDS = ("reserve", "sales")
RANKING_ROWS = 20
NSFW_COVER = 1.5
USER_AGENT = "Mozilla/5.0 (compatible; VN-Club-Resources/1.0; +https://vnclub.org)"

_SOFT_ID = re.compile(r"soft\.phtml\?id=(\d+)")
_ROW = re.compile(r"<TR[^>]*>(.*?)</TR>", re.S | re.I)
_CELL = re.compile(r"<TD[^>]*>(.*?)</TD>", re.S | re.I)
_DAY = re.compile(r"(\d{1,2})/(\d{1,2})\s*$")
_TITLE_LINK = re.compile(r'soft\.phtml\?id=\d+"[^>]*>(.*?)</A>', re.S | re.I)
# The schedule marks each price cell with a comment naming its role, which is steadier
# than the column position once an edition with a bonus splits over two rows.
_PRICE_CELL = re.compile(r"<!--(定価|特典あり価格|特典なし価格)-->\s*<TD[^>]*>(.*?)</TD>", re.S | re.I)
_CONTINUATION = re.compile(r"\s*<!--特典なし価格-->")
_BONUS_CELL = re.compile(r"<!--(?:特典内容|特典なし)-->\s*<TD[^>]*>(.*?)</TD>", re.S | re.I)
_TAX_IN = re.compile(r"税込\s*(￥[\d,]+)")
_YEN = re.compile(r"[￥¥][\d,]+")
_TAG = re.compile(r"<[^>]+>")
_SPACE = re.compile(r"[\s　]+")
_RANK_ITEM = re.compile(r'rankw_item_row"')
_RANK_NO = re.compile(r'rank_badge rank_no\d+">(\d+)<')
_RANK_NAME = re.compile(r'<div class="item_name">(.*?)</div>', re.S)
_RANK_BRAND = re.compile(r'<div class="item_brand">(.*?)</div>', re.S)
_RANK_PRICE = re.compile(r'<div class="item_price">(.*?)</div>\s*</div>', re.S)
_PRICE_LINE = re.compile(r"(特典付き|特典なし|価格)：<span[^>]*>([^<]+)</span>")
_THUMB = re.compile(r'data-src="(/brandnew/[^"]+)"')
_FULL_DATE = re.compile(r"(\d{4})年(\d{2})月(\d{2})日")


@dataclass
class GetchuListing:
    soft_id: str
    title: str
    brand: str | None
    released: date | None = None
    media: str | None = None
    list_price: str | None = None
    sale_price: str | None = None
    bonus: str | None = None
    in_stock: bool = True
    adult: bool = True
    rank: int | None = None
    image_url: str | None = None


def decode_page(raw: bytes) -> str:
    return raw.decode(ENCODING, errors="replace")


def _text(markup: str) -> str:
    return _SPACE.sub(" ", html.unescape(_TAG.sub("", markup))).strip()


def _price(markup: str) -> str | None:
    """The tax-inclusive figure when the cell prints both, else the first yen amount."""
    text = html.unescape(_TAG.sub(" ", markup))
    tax_in = _TAX_IN.search(text)
    if tax_in:
        return tax_in.group(1)
    plain = _YEN.search(text)
    return plain.group(0) if plain else None


def _platforms(title: str) -> list[str]:
    lowered = title.lower()
    if "switch" in lowered:
        return ["swi"]
    for tag, code in (("ps5", "ps5"), ("ps4", "ps4"), ("psvita", "psv"), ("ps vita", "psv")):
        if tag in lowered:
            return [code]
    return ["win"]


# ---------------------------------------------------------------- schedule


def parse_price_table(page: str, year: int, month: int) -> list[GetchuListing]:
    """The month's schedule, one listing per edition.

    An edition sold with and without a bonus spans two rows; the second carries only the
    plain edition's price and belongs to the listing above it.
    """
    start = page.find('<form name="form2">')
    end = page.find("</TABLE>", start)
    table = page[start:end] if start >= 0 and end >= 0 else page
    listings: list[GetchuListing] = []
    current: GetchuListing | None = None
    for row in _ROW.findall(table):
        id_m = _SOFT_ID.search(row)
        prices = {role: _price(cell) for role, cell in _PRICE_CELL.findall(row)}
        if id_m is None:
            if current is not None and _CONTINUATION.match(row):
                current.sale_price = prices.get("特典なし価格") or current.sale_price
                current.in_stock = current.in_stock or "cart.phtml" in row
            continue
        cells = _CELL.findall(row)
        day = _DAY.search(cells[0]) if cells else None
        released = None
        if day and int(day.group(1)) == month:
            try:
                released = date(year, month, int(day.group(2)))
            except ValueError:
                released = None
        title_m = _TITLE_LINK.search(row)
        bonus_m = _BONUS_CELL.search(row)
        bonus = _text(bonus_m.group(1)) if bonus_m else ""
        current = GetchuListing(
            soft_id=id_m.group(1),
            title=_text(title_m.group(1)) if title_m else id_m.group(1),
            brand=(_text(cells[2]) or None) if len(cells) > 2 else None,
            released=released,
            media=(_text(cells[3]) or None) if len(cells) > 3 else None,
            list_price=prices.get("定価"),
            sale_price=prices.get("特典なし価格") or prices.get("特典あり価格"),
            bonus=bonus if bonus and bonus != "特典なし" else None,
            in_stock="cart.phtml" in row,
            image_url=PACKAGE_URL.format(id=id_m.group(1)),
        )
        listings.append(current)
    return listings


# ---------------------------------------------------------------- rankings


def parse_ranking(page: str) -> list[GetchuListing]:
    """The ranked items in rank order, capped to the first page's worth."""
    positions = [m.start() for m in _RANK_ITEM.finditer(page)]
    listings = []
    for i, start in enumerate(positions):
        block = page[start : positions[i + 1] if i + 1 < len(positions) else len(page)]
        id_m = _SOFT_ID.search(block)
        rank = _RANK_NO.search(block)
        if not id_m or not rank:
            continue
        name = _RANK_NAME.search(block)
        brand = _RANK_BRAND.search(block)
        price_block = _RANK_PRICE.search(block)
        prices = dict(_PRICE_LINE.findall(price_block.group(1))) if price_block else {}
        price = prices.get("特典なし") or prices.get("価格") or prices.get("特典付き")
        thumb = _THUMB.search(block)
        when = _FULL_DATE.search(block)
        listings.append(
            GetchuListing(
                soft_id=id_m.group(1),
                title=_text(re.sub(r"<span[^>]*>.*?</span>", "", name.group(1), flags=re.S))
                if name
                else id_m.group(1),
                brand=_text(brand.group(1)).strip("()（）") or None if brand else None,
                released=date(int(when.group(1)), int(when.group(2)), int(when.group(3)))
                if when
                else None,
                sale_price=html.unescape(price).strip() if price else None,
                adult="item_name_badge_18" in block,
                rank=int(rank.group(1)),
                image_url=BASE + thumb.group(1) if thumb else THUMB_URL.format(id=id_m.group(1)),
            )
        )
    listings.sort(key=lambda l: l.rank or 0)
    return listings[:RANKING_ROWS]


# ---------------------------------------------------------------- drafts

Matcher = Callable[[str, str], Awaitable[MatchedVN | None]]


def _jst_today(now: datetime) -> date:
    return (now + timedelta(hours=9)).date()


async def _draft(
    listing: GetchuListing, kind: str, key: str, published_at: datetime, match: Matcher
) -> NewsDraft:
    vn = await match("getchu", listing.soft_id)
    extra: dict[str, Any] = {
        "kind": kind,
        "soft_id": listing.soft_id,
        "store_title": listing.title,
        "brand": listing.brand,
        "media": listing.media,
        "bonus": listing.bonus,
        "in_stock": listing.in_stock,
        "platforms": _platforms(listing.title),
        "original_price": listing.list_price,
        "final_price": listing.sale_price or listing.list_price,
        "released": listing.released.isoformat() if listing.released else None,
    }
    if kind == "preorder" and listing.released:
        extra["expected_date"] = listing.released.isoformat()
    url = SOFT_URL.format(id=listing.soft_id)
    if vn is not None:
        extra.update(
            {
                "vn_id": vn.id,
                "alttitle": vn.title_jp,
                "title_romaji": vn.title_romaji,
                "developers": vn.developers or ([listing.brand] if listing.brand else []),
                "developers_original": vn.developers_original or ([listing.brand] if listing.brand else []),
                "minage": vn.minage,
                "image_sexual": vn.image_sexual,
            }
        )
        has_cover = bool(vn.image_url)
        return NewsDraft(
            source="getchu",
            source_label="Getchu",
            key=key,
            title=vn.title,
            summary=listing.title,
            url=url,
            image_url=vn.image_url or listing.image_url,
            image_is_nsfw=(
                bool(vn.image_sexual and vn.image_sexual >= NSFW_COVER)
                if has_cover
                else listing.adult
            ),
            published_at=published_at,
            tags=[kind],
            vn_id=vn.id,
            extra=extra,
        )
    extra.update(
        {
            "developers": [listing.brand] if listing.brand else [],
            "minage": 18 if listing.adult else None,
        }
    )
    return NewsDraft(
        source="getchu",
        source_label="Getchu",
        key=key,
        title=listing.title,
        summary=listing.brand,
        url=url,
        image_url=listing.image_url,
        image_is_nsfw=listing.adult,
        published_at=published_at,
        tags=[kind],
        extra=extra,
    )


async def drafts_from_listings(
    listings: list[GetchuListing], match: Matcher, now: datetime
) -> list[NewsDraft]:
    """Recent dates become releases; future dates become pre-orders.

    A pre-order key carries its date, so a title whose date moves gets a fresh row rather
    than a silent change to the old one.
    """
    today = _jst_today(now)
    drafts = []
    for listing in listings:
        if listing.released is None:
            continue
        age = today - listing.released
        if timedelta(0) <= age <= RELEASED_WINDOW:
            stamp = datetime.combine(listing.released, datetime.min.time(), tzinfo=now.tzinfo)
            drafts.append(await _draft(listing, "released", listing.soft_id, stamp, match))
        elif age < timedelta(0):
            key = f"{listing.soft_id}-preorder-{listing.released.isoformat()}"
            drafts.append(await _draft(listing, "preorder", key, now, match))
    return drafts


async def ranking_entries(listings: list[GetchuListing], match: Matcher) -> list[dict[str, Any]]:
    """The ranking as the API serves it, each row tied to its VN when the catalogue has it."""
    entries = []
    for l in listings:
        vn = await match("getchu", l.soft_id)
        has_cover = bool(vn and vn.image_url)
        entries.append(
            {
                "rank": l.rank,
                "productId": l.soft_id,
                "site": "getchu",
                "title": vn.title if vn else l.title,
                "titleJp": vn.title_jp if vn else None,
                "titleRomaji": vn.title_romaji if vn else None,
                "storeTitle": l.title,
                "maker": l.brand,
                "url": SOFT_URL.format(id=l.soft_id),
                "imageUrl": vn.image_url if has_cover else l.image_url,
                "imageIsNsfw": (
                    bool(vn.image_sexual and vn.image_sexual >= NSFW_COVER) if has_cover else l.adult
                ),
                "vnId": vn.id if vn else None,
                "price": l.sale_price,
            }
        )
    return entries


# ---------------------------------------------------------------- fetching


class _Client:
    """Requests to the store, spaced apart, each carrying the age-confirmation cookie."""

    def __init__(self, session: aiohttp.ClientSession):
        self.session = session
        self.requests = 0

    async def get(self, url: str) -> str | None:
        if self.requests:
            await asyncio.sleep(REQUEST_PAUSE)
        self.requests += 1
        try:
            async with self.session.get(
                url,
                headers={"User-Agent": USER_AGENT},
                cookies=COOKIES,
                timeout=aiohttp.ClientTimeout(total=30),
            ) as resp:
                if resp.status != 200:
                    logger.warning("Getchu %s returned %s", url, resp.status)
                    return None
                return decode_page(await resp.read())
        except Exception as e:  # noqa: BLE001
            logger.warning("Getchu %s failed: %s", url, e)
            return None


def _months(now: datetime) -> list[tuple[int, int]]:
    """The store month before the current one, the current one and the next, as (year,
    month): the released window reaches back into the previous month."""
    today = _jst_today(now)
    previous = (today.replace(day=1) - timedelta(days=1)).replace(day=1)
    following = (today.replace(day=1) + timedelta(days=32)).replace(day=1)
    return [(previous.year, previous.month), (today.year, today.month), (following.year, following.month)]


async def fetch_schedule(
    session: aiohttp.ClientSession, match: Matcher, now: datetime
) -> list[NewsDraft]:
    client = _Client(session)
    listings: list[GetchuListing] = []
    for year, month in _months(now):
        page = await client.get(PRICE_URL.format(y=year, m=month))
        if page:
            listings.extend(parse_price_table(page, year, month))
    drafts = await drafts_from_listings(listings, match, now)
    logger.info("Getchu: %d listings, %d rows, %d requests", len(listings), len(drafts), client.requests)
    return drafts


async def fetch_rankings(
    session: aiohttp.ClientSession, match: Matcher
) -> dict[str, list[dict[str, Any]]]:
    client = _Client(session)
    out: dict[str, list[dict[str, Any]]] = {}
    for kind in RANKING_KINDS:
        page = await client.get(RANKING_URL.format(kind=kind))
        if page:
            out[kind] = await ranking_entries(parse_ranking(page), match)
    return out
