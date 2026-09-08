"""Melonbooks: the pre-order and new-arrival sections of the PC software category.

The category page groups works under headed sections; only the pre-order and new-arrival
ones are read. The listing shows neither the release date nor the age rating, so each
candidate's own page is opened for both, spaced out. A work whose page cannot be read is
kept and its picture blurred: the category is mostly adult, so the safe default is the
blur. Every work is matched against the catalogue; an unmatched work becomes a row of
its own with the store picture.
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

logger = logging.getLogger(__name__)

BASE = "https://www.melonbooks.co.jp"
# The PC software category; the wider game category mixes in console titles.
LIST_URL = BASE + "/game/list.php?category_id=46&orderby=release_date&is_end_of_sale=1&is_end_of_sale2=1"
DETAIL_URL = BASE + "/detail/detail.php?product_id={id}"
# Adult works are hidden from a visitor who has not confirmed their age.
COOKIES = {"AUTH_ADULT": "1"}
SECTIONS = {"予約開始作品": "preorder", "新入荷作品": "released"}
MAX_ITEMS = 20
RELEASED_WINDOW = timedelta(days=14)
REQUEST_GAP = 3
NSFW_COVER = 1.5
USER_AGENT = "Mozilla/5.0 (compatible; VN-Club-Resources/1.0; +https://vnclub.org)"

_SECTION = re.compile(r'<h3 class="section-find">\s*([^<]+?)\s*</h3>')
_ITEM = re.compile(r'<li class="product_(\d+)"')
_TITLE = re.compile(r'class="item-ttl product_title">([^<]*)<')
_MAKER = re.compile(r'maker_id=\d+[^"]*"\s+title="([^"]*)"')
_THUMB = re.compile(r'data-src="(//melonbooks\.akamaized\.net/[^"]+)"')
_PRICE = re.compile(r'item-price">&yen;([\d,]+)<')
_RESERVE = re.compile(r'item-state-reserve')
_RELEASE_DATE = re.compile(r'product-info__release-date">\s*発売日：(\d{4})年(\d{1,2})月(\d{1,2})日')
_ISSUE_DATE = re.compile(r'<th[^>]*>\s*発行日\s*</th>\s*<td[^>]*>\s*(\d{4})/(\d{1,2})/(\d{1,2})')
_WORK_TYPE = re.compile(r'<th[^>]*>\s*作品種別\s*</th>\s*<td[^>]*>(.*?)</td>', re.S)
_ADULT_WORDS = re.compile(r"18|成年|アダルト")


@dataclass
class MelonWork:
    product_id: str
    name: str
    maker: str | None
    kind: str
    price: int | None = None
    image_url: str | None = None
    adult: bool | None = None
    released: date | None = None


@dataclass
class MelonDetail:
    adult: bool | None = None
    released: date | None = None
    work_type: str | None = None


# ---------------------------------------------------------------- parsing


def _blocks(section: str) -> list[tuple[str, str]]:
    positions = list(_ITEM.finditer(section))
    out = []
    for i, m in enumerate(positions):
        end = positions[i + 1].start() if i + 1 < len(positions) else len(section)
        out.append((m.group(1), section[m.start():end]))
    return out


def parse_listing(page: str) -> list[MelonWork]:
    """Pre-orders first, then new arrivals, each work once."""
    heads = list(_SECTION.finditer(page))
    sections: dict[str, str] = {}
    for i, m in enumerate(heads):
        end = heads[i + 1].start() if i + 1 < len(heads) else len(page)
        sections.setdefault(m.group(1), page[m.end():end])
    works: list[MelonWork] = []
    seen: set[str] = set()
    for heading, kind in SECTIONS.items():
        for pid, block in _blocks(sections.get(heading, "")):
            if pid in seen:
                continue
            seen.add(pid)
            title = _TITLE.search(block)
            maker = _MAKER.search(block)
            thumb = _THUMB.search(block)
            price = _PRICE.search(block)
            works.append(
                MelonWork(
                    product_id=pid,
                    name=html.unescape(title.group(1)).strip() if title else pid,
                    maker=html.unescape(maker.group(1)).strip() if maker else None,
                    kind="preorder" if _RESERVE.search(block) else kind,
                    price=int(price.group(1).replace(",", "")) if price else None,
                    image_url="https:" + html.unescape(thumb.group(1)) if thumb else None,
                )
            )
    return works


def parse_detail(page: str) -> MelonDetail:
    """The rating and the release date from a work's own page."""
    detail = MelonDetail()
    m = _WORK_TYPE.search(page)
    if m:
        detail.work_type = re.sub(r"<[^>]+>|\s+", " ", m.group(1)).strip()
        detail.adult = bool(_ADULT_WORDS.search(detail.work_type))
    m = _RELEASE_DATE.search(page) or _ISSUE_DATE.search(page)
    if m:
        try:
            detail.released = date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError:
            pass
    return detail


def format_price(price: int | None) -> str | None:
    if price is None:
        return None
    return "無料" if price == 0 else f"¥{price:,}"


# ---------------------------------------------------------------- drafts

Matcher = Callable[[str, str], Awaitable[MatchedVN | None]]


async def _draft(work: MelonWork, match: Matcher, now: datetime) -> NewsDraft:
    vn = await match("melonjp", work.product_id)
    # Without a rating the category's own balance decides.
    adult = True if work.adult is None else work.adult
    key = work.product_id if work.kind == "released" else f"{work.product_id}-{work.kind}"
    released = work.released.isoformat() if work.released else None
    extra: dict[str, Any] = {
        "kind": work.kind,
        "product_id": work.product_id,
        "store_title": work.name,
        "maker": work.maker,
        "final_price": format_price(work.price),
        "platforms": ["win"],
        "released": released,
        "developers": [work.maker] if work.maker else [],
        "minage": 18 if adult else None,
    }
    if work.kind == "preorder":
        extra["expected"] = released
        extra["expected_date"] = released
    if work.kind == "released" and work.released and work.released <= now.date():
        published = datetime.combine(work.released, datetime.min.time(), tzinfo=now.tzinfo)
    else:
        published = now
    url = DETAIL_URL.format(id=work.product_id)
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
            source="melonbooks",
            source_label="Melonbooks",
            key=key,
            title=vn.title,
            summary=work.name,
            url=url,
            image_url=vn.image_url or work.image_url,
            image_is_nsfw=(
                bool(vn.image_sexual and vn.image_sexual >= NSFW_COVER) if has_cover else adult
            ),
            published_at=published,
            tags=[work.kind],
            vn_id=vn.id,
            extra=extra,
        )
    return NewsDraft(
        source="melonbooks",
        source_label="Melonbooks",
        key=key,
        title=work.name,
        summary=work.maker,
        url=url,
        image_url=work.image_url,
        image_is_nsfw=adult,
        published_at=published,
        tags=[work.kind],
        extra=extra,
    )


async def drafts_from_works(works: list[MelonWork], match: Matcher, now: datetime) -> list[NewsDraft]:
    """Rows for the works; an arrival whose release lies well behind is stock, not news."""
    drafts = []
    for work in works[:MAX_ITEMS]:
        if (
            work.kind == "released"
            and work.released
            and now.date() - work.released > RELEASED_WINDOW
        ):
            continue
        drafts.append(await _draft(work, match, now))
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
                logger.warning("Melonbooks %s returned %s", url, resp.status)
                return None
            return await resp.text()
    except Exception as e:  # noqa: BLE001
        logger.warning("Melonbooks %s failed: %s", url, e)
        return None


async def fetch_new(session: aiohttp.ClientSession, match: Matcher, now: datetime) -> list[NewsDraft]:
    page = await _get(session, LIST_URL)
    if not page:
        return []
    works = parse_listing(page)[:MAX_ITEMS]
    for work in works:
        await asyncio.sleep(REQUEST_GAP)
        detail_page = await _get(session, DETAIL_URL.format(id=work.product_id))
        if not detail_page:
            continue
        detail = parse_detail(detail_page)
        work.adult = detail.adult
        work.released = detail.released
    drafts = await drafts_from_works(works, match, now)
    logger.info("Melonbooks: %d rows of %d listed", len(drafts), len(works))
    return drafts
