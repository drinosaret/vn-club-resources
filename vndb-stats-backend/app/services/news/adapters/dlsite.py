"""DLsite: the release calendars, pre-orders, announcements, discounts and rankings.

Every listing carries a hidden attributes record per work (maker, an adult marker, the
work type, options), so a work can be typed and flagged without opening its page. Only
adventure and digital-novel works are read. A work the catalogue knows becomes a row for
that VN; any other becomes a row of its own, linking to the store.

The store publishes a crawl delay and answers bursts with a challenge page, so requests
are spaced and a challenge is retried once after a pause.
"""

from __future__ import annotations

import asyncio
import html
import json
import logging
import re
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any, Awaitable, Callable

import aiohttp

from app.services.news.drafts import NewsDraft
from app.services.news.matching import MatchedVN

logger = logging.getLogger(__name__)

BASE = "https://www.dlsite.com"
SITES = ("pro", "maniax")
DAY_URL = BASE + "/{site}/new/=/date/{day}/work_type_category/game/show_layout/2"
RESERVE_URL = (
    BASE + "/pro/fsr/=/work_category/pc/work_type_category/game/is_reserve/1/order/release_d"
)
ANNOUNCE_URL = BASE + "/maniax/announce/list/day/=/year/{y}/mon/{m}/day/{d:02d}"
# The doujin storefront answers a "pc" category with the commercial catalogue, so the two
# discount listings differ by more than the site segment.
DISCOUNT_URLS = {
    "pro": BASE + "/pro/fsr/=/work_category/pc/work_type/ADV/campaign/campaign/order/cend",
    "maniax": BASE + "/maniax/fsr/=/work_category/doujin/work_type/ADV/campaign/campaign/order/cend",
}
RANKING_URL = BASE + "/{site}/ranking/week?category=game&sub=ADV"
INFO_URL = BASE + "/{site}/product/info/ajax?product_id={ids}"

# The store's robots.txt crawl delay, and the pause before retrying a challenge answer.
CRAWL_DELAY = 10
CHALLENGE_PAUSE = 60
DAYS_BACK = 3
RANKING_ROWS = 20
NSFW_COVER = 1.5
KEEP_TYPES = {"ADV", "DNV"}
USER_AGENT = "Mozilla/5.0 (compatible; VN-Club-Resources/1.0; +https://vnclub.org)"

_HEADING = re.compile(r'<h3 class="work_update">\s*(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日')
_RECORD = re.compile(r'<div hidden class="ga4_event_item_(\w+)"([^>]*)>')
_ATTR = re.compile(r'data-(\w+)="([^"]*)"')
_ATTRIBUTES = re.compile(r'class="__product_attributes"[^>]*id="_(\w+)"\s+value="([^"]*)"')
_MAKER = re.compile(r'maker_id/(\w+)\.html">([^<]+)</a>')
_THUMB = re.compile(
    r"(//img\.dlsite\.jp/resize/[^'\"\s]*?/(\w+)_(?:img_main|img_sam|ana_img_main)_240x240\.jpg)"
)
_NAMED_LINK = re.compile(r'product_id/(\w+)\.html"\s+title="([^"]*)"')
_TEXT_LINK = re.compile(r'product_id/(\w+)\.html">([^<]+)</a>')
_PRODUCT_LINK = re.compile(r'product_id/(\w+)\.html')
_FSR_ITEM = re.compile(r'data-list_item_product_id="(\w+)"')
_ANNOUNCE_ITEM = re.compile(r'class="n_worklist_item"')
_CATEGORY = re.compile(r'work_category type_(\w+)')
_PRICE = re.compile(r'work_price_base">([\d,]+)')
_STRIKE = re.compile(r'class="strike\s*">.*?work_price_base">([\d,]+)', re.S)
_SALE_BADGE = re.compile(r'type_sale">(\d+)%OFF')
_EXPECTED = re.compile(r'<span class="expected_date">\s*([^<]+?)\s*</span>')
_RANK_ROW = re.compile(r'<tr[^>]*>(.*?)</tr>', re.S)
_RANK_NO = re.compile(r'class="rank_no[^"]*">(\d+)<')
_FULL_DATE = re.compile(r"(\d{4})年(\d{2})月(\d{2})日")


@dataclass
class DlsiteWork:
    product_id: str
    name: str
    maker: str | None
    work_type: str
    site: str
    adult: bool = False
    price: str | None = None
    original_price: str | None = None
    discount: int | None = None
    image_url: str | None = None
    expected: str | None = None
    rank: int | None = None
    released: date | None = None


# ---------------------------------------------------------------- shared parsing


def _attributes(page: str) -> dict[str, set[str]]:
    return {pid: set(value.split(",")) for pid, value in _ATTRIBUTES.findall(page)}


def _makers(page: str) -> dict[str, str]:
    return {mid: html.unescape(name).strip() for mid, name in _MAKER.findall(page)}


def _thumbs(page: str) -> dict[str, str]:
    return {pid: "https:" + url for url, pid in _THUMB.findall(page)}


def _names(page: str) -> dict[str, str]:
    names = {pid: html.unescape(t) for pid, t in _NAMED_LINK.findall(page)}
    for pid, text in _TEXT_LINK.findall(page):
        text = html.unescape(text).strip()
        if text and pid not in names:
            names[pid] = text
    return names


def _work_type(tokens: set[str], block: str) -> str:
    for t in tokens:
        if t in KEEP_TYPES:
            return t
    m = _CATEGORY.search(block)
    return m.group(1) if m else ""


def _maker_of(tokens: set[str], makers: dict[str, str]) -> str | None:
    for t in tokens:
        if t in makers:
            return makers[t]
    return None


def _build(
    pid: str, block: str, site: str, tokens: set[str], makers, names, thumbs
) -> DlsiteWork | None:
    work_type = _work_type(tokens, block)
    if work_type not in KEEP_TYPES:
        return None
    price = _PRICE.search(block)
    strike = _STRIKE.search(block)
    badge = _SALE_BADGE.search(block)
    return DlsiteWork(
        product_id=pid,
        name=names.get(pid, pid),
        maker=_maker_of(tokens, makers),
        work_type=work_type,
        site=site,
        # The doujin storefront is adult as a whole and does not mark works individually.
        adult="adl" in tokens or site == "maniax",
        price=price.group(1) if price else None,
        original_price=strike.group(1) if strike else None,
        discount=int(badge.group(1)) if badge else None,
        image_url=thumbs.get(pid),
    )


def parse_day_page(page: str, site: str = "pro") -> tuple[date | None, list[DlsiteWork]]:
    """The release calendar for one day."""
    head = _HEADING.search(page)
    day = date(int(head.group(1)), int(head.group(2)), int(head.group(3))) if head else None
    attrs, makers, thumbs = _attributes(page), _makers(page), _thumbs(page)
    works = []
    for pid, attrs_raw in _RECORD.findall(page):
        record = {k: html.unescape(v) for k, v in _ATTR.findall(attrs_raw)}
        tokens = attrs.get(pid, set()) | {record.get("work_type", ""), record.get("maker_id", "")}
        names = {pid: record.get("work_name", pid)}
        work = _build(pid, "", site, tokens, makers, names, thumbs)
        if work is None:
            continue
        work.price = record.get("price")
        work.released = day
        works.append(work)
    return day, works


def _blocks(page: str, marker: re.Pattern, id_in_marker: bool = True) -> list[tuple[str, str]]:
    """Split a listing into (product id, markup) per item."""
    positions = [(m.start(), m.group(1) if id_in_marker else None) for m in marker.finditer(page)]
    out = []
    for i, (start, pid) in enumerate(positions):
        end = positions[i + 1][0] if i + 1 < len(positions) else len(page)
        block = page[start:end]
        if pid is None:
            m = _PRODUCT_LINK.search(block)
            if not m:
                continue
            pid = m.group(1)
        out.append((pid, block))
    return out


def parse_fsr_list(page: str, site: str) -> list[DlsiteWork]:
    """A search listing: pre-orders or discounts."""
    attrs, makers, thumbs, names = _attributes(page), _makers(page), _thumbs(page), _names(page)
    works = []
    for pid, block in _blocks(page, _FSR_ITEM):
        work = _build(pid, block, site, attrs.get(pid, set()), makers, names, thumbs)
        if work:
            works.append(work)
    return works


def parse_announce_list(page: str, site: str = "maniax") -> list[DlsiteWork]:
    """Announced works, each with the store's own wording of its expected date."""
    attrs, makers, thumbs, names = _attributes(page), _makers(page), _thumbs(page), _names(page)
    works = []
    for pid, block in _blocks(page, _ANNOUNCE_ITEM, id_in_marker=False):
        work = _build(pid, block, site, attrs.get(pid, set()), makers, names, thumbs)
        if work is None:
            continue
        m = _EXPECTED.search(block)
        work.expected = html.unescape(m.group(1)).replace("発売予定", "").strip() if m else None
        works.append(work)
    return works


def parse_ranking(page: str, site: str) -> list[DlsiteWork]:
    """The ranking table, in rank order."""
    attrs, makers, thumbs, names = _attributes(page), _makers(page), _thumbs(page), _names(page)
    start = page.find('id="ranking_table"')
    if start < 0:
        return []
    works = []
    for row in _RANK_ROW.findall(page[start:]):
        no = _RANK_NO.search(row)
        pid_m = _PRODUCT_LINK.search(row)
        if not no or not pid_m:
            continue
        pid = pid_m.group(1)
        work = _build(pid, row, site, attrs.get(pid, set()), makers, names, thumbs)
        if work is None:
            continue
        work.rank = int(no.group(1))
        works.append(work)
    works.sort(key=lambda w: w.rank or 0)
    return works[:RANKING_ROWS]


def parse_expected_date(text: str | None) -> str | None:
    """ISO form of a full expected date; a month-only wording stays as written."""
    if not text:
        return None
    m = _FULL_DATE.search(text)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    return text


# ---------------------------------------------------------------- drafts

Matcher = Callable[[str, str], Awaitable[MatchedVN | None]]


def _work_url(work: DlsiteWork, announce: bool = False) -> str:
    kind = "announce" if announce else "work"
    return f"{BASE}/{work.site}/{kind}/=/product_id/{work.product_id}.html"


async def _draft(
    work: DlsiteWork,
    kind: str,
    key: str,
    published_at: datetime,
    match: Matcher,
    announce: bool = False,
    extra: dict[str, Any] | None = None,
) -> NewsDraft:
    vn = await match("dlsite", work.product_id)
    base_extra: dict[str, Any] = {
        "kind": kind,
        "site": work.site,
        "product_id": work.product_id,
        "store_title": work.name,
        "maker": work.maker,
        "work_type": work.work_type,
        "price": work.price,
        "original_price": work.original_price,
        "discount": work.discount,
        "platforms": ["win"],
        "released": work.released.isoformat() if work.released else None,
    }
    base_extra.update(extra or {})
    if vn is not None:
        base_extra.update(
            {
                "vn_id": vn.id,
                "alttitle": vn.title_jp,
                "title_romaji": vn.title_romaji,
                "developers": vn.developers or ([work.maker] if work.maker else []),
                "developers_original": vn.developers_original or ([work.maker] if work.maker else []),
                "minage": vn.minage,
                "image_sexual": vn.image_sexual,
            }
        )
        has_cover = bool(vn.image_url)
        return NewsDraft(
            source="dlsite",
            source_label="DLsite",
            key=key,
            title=vn.title,
            summary=work.name,
            url=_work_url(work, announce),
            image_url=vn.image_url or work.image_url,
            image_is_nsfw=(
                bool(vn.image_sexual and vn.image_sexual >= NSFW_COVER) if has_cover else work.adult
            ),
            published_at=published_at,
            tags=[kind],
            vn_id=vn.id,
            extra=base_extra,
        )
    base_extra.update(
        {"developers": [work.maker] if work.maker else [], "minage": 18 if work.adult else None}
    )
    return NewsDraft(
        source="dlsite",
        source_label="DLsite",
        key=key,
        title=work.name,
        summary=work.maker,
        url=_work_url(work, announce),
        image_url=work.image_url,
        image_is_nsfw=work.adult,
        published_at=published_at,
        tags=[kind],
        extra=base_extra,
    )


async def drafts_from_works(
    day: date, works: list[DlsiteWork], match: Matcher, now: datetime, site: str = "pro"
) -> list[NewsDraft]:
    """Releases of one calendar day."""
    stamp = datetime.combine(day, datetime.min.time(), tzinfo=now.tzinfo)
    drafts = []
    for work in works:
        work.site = site
        work.released = day
        drafts.append(await _draft(work, "released", work.product_id, stamp, match))
    return drafts


async def drafts_from_preorders(
    works: list[DlsiteWork], match: Matcher, now: datetime
) -> list[NewsDraft]:
    return [await _draft(w, "preorder", f"{w.product_id}-preorder", now, match) for w in works]


async def drafts_from_announced(
    day: date, works: list[DlsiteWork], match: Matcher, now: datetime
) -> list[NewsDraft]:
    stamp = datetime.combine(day, datetime.min.time(), tzinfo=now.tzinfo)
    return [
        await _draft(
            w,
            "announced",
            f"{w.product_id}-announced",
            stamp,
            match,
            announce=True,
            extra={"expected": parse_expected_date(w.expected), "expected_text": w.expected},
        )
        for w in works
    ]


async def drafts_from_discounts(
    works: list[DlsiteWork], match: Matcher, now: datetime
) -> list[NewsDraft]:
    out = []
    for w in works:
        if not w.discount:
            continue
        out.append(await _draft(w, "sale", f"{w.product_id}-sale-{w.discount}", now, match))
    return out


async def ranking_entries(works: list[DlsiteWork], match: Matcher) -> list[dict[str, Any]]:
    """The ranking as the API serves it, each row tied to its VN when the catalogue has it."""
    entries = []
    for w in works:
        vn = await match("dlsite", w.product_id)
        has_cover = bool(vn and vn.image_url)
        entries.append(
            {
                "rank": w.rank,
                "productId": w.product_id,
                "site": w.site,
                "title": vn.title if vn else w.name,
                "titleJp": vn.title_jp if vn else None,
                "titleRomaji": vn.title_romaji if vn else None,
                "storeTitle": w.name,
                "maker": w.maker,
                "url": _work_url(w),
                "imageUrl": vn.image_url if has_cover else w.image_url,
                "imageIsNsfw": (
                    bool(vn.image_sexual and vn.image_sexual >= NSFW_COVER) if has_cover else w.adult
                ),
                "vnId": vn.id if vn else None,
                "price": w.price,
            }
        )
    return entries


# ---------------------------------------------------------------- fetching


class _Client:
    """Requests to the store, spaced to its crawl delay, with one retry past a challenge."""

    def __init__(self, session: aiohttp.ClientSession):
        self.session = session
        self.requests = 0

    async def get(self, url: str) -> str | None:
        for attempt in range(2):
            if self.requests:
                await asyncio.sleep(CRAWL_DELAY if attempt == 0 else CHALLENGE_PAUSE)
            self.requests += 1
            try:
                async with self.session.get(
                    url,
                    headers={"User-Agent": USER_AGENT},
                    timeout=aiohttp.ClientTimeout(total=30),
                ) as resp:
                    if resp.status == 202:
                        logger.info("DLsite challenge on %s; pausing", url)
                        continue
                    if resp.status != 200:
                        logger.warning("DLsite %s returned %s", url, resp.status)
                        return None
                    return await resp.text()
            except Exception as e:  # noqa: BLE001
                logger.warning("DLsite %s failed: %s", url, e)
                return None
        return None

    async def get_json(self, url: str) -> Any:
        text = await self.get(url)
        if not text:
            return None
        try:
            return json.loads(text)
        except ValueError:
            return None


@dataclass
class DlsiteBatch:
    released: list[NewsDraft] = field(default_factory=list)
    preorders: list[NewsDraft] = field(default_factory=list)
    announced: list[NewsDraft] = field(default_factory=list)
    sales: list[NewsDraft] = field(default_factory=list)
    rankings: dict[str, list[dict[str, Any]]] = field(default_factory=dict)


def _jst_today(now: datetime) -> date:
    """Store days are Japanese calendar days."""
    return (now + timedelta(hours=9)).date()


async def _fetch_calendar(client: _Client, match: Matcher, now: datetime) -> list[NewsDraft]:
    """The last few days' pages. Releases cluster on one weekday, so most days are empty."""
    drafts: list[NewsDraft] = []
    today = _jst_today(now)
    for site in SITES:
        for offset in range(DAYS_BACK):
            day = today - timedelta(days=offset)
            page = await client.get(DAY_URL.format(site=site, day=day.isoformat()))
            if not page:
                continue
            parsed_day, works = parse_day_page(page, site)
            if parsed_day != day:
                # A day with nothing redirects to another; its works belong to that day.
                continue
            drafts.extend(await drafts_from_works(day, works, match, now, site))
    return drafts


async def _fetch_preorders(client: _Client, match: Matcher, now: datetime) -> list[NewsDraft]:
    page = await client.get(RESERVE_URL)
    if not page:
        return []
    works = parse_fsr_list(page, "pro")
    if works:
        ids = ",".join(w.product_id for w in works)
        info = await client.get_json(INFO_URL.format(site="pro", ids=ids))
        if isinstance(info, dict):
            for w in works:
                stamp = (info.get(w.product_id) or {}).get("regist_date")
                if isinstance(stamp, str) and len(stamp) >= 10:
                    try:
                        w.released = date.fromisoformat(stamp[:10])
                    except ValueError:
                        pass
    return await drafts_from_preorders(works, match, now)


async def _fetch_announced(client: _Client, match: Matcher, now: datetime) -> list[NewsDraft]:
    drafts: list[NewsDraft] = []
    today = _jst_today(now)
    for offset in range(DAYS_BACK):
        day = today - timedelta(days=offset)
        page = await client.get(ANNOUNCE_URL.format(y=day.year, m=day.month, d=day.day))
        if not page:
            continue
        drafts.extend(await drafts_from_announced(day, parse_announce_list(page), match, now))
    return drafts


async def _fetch_discounts(client: _Client, match: Matcher, now: datetime) -> list[NewsDraft]:
    drafts: list[NewsDraft] = []
    for site in SITES:
        page = await client.get(DISCOUNT_URLS[site])
        if page:
            drafts.extend(await drafts_from_discounts(parse_fsr_list(page, site), match, now))
    return drafts


async def _fetch_rankings(client: _Client, match: Matcher) -> dict[str, list[dict[str, Any]]]:
    out: dict[str, list[dict[str, Any]]] = {}
    for site in SITES:
        page = await client.get(RANKING_URL.format(site=site))
        if page:
            out[site] = await ranking_entries(parse_ranking(page, site), match)
    return out


async def fetch_all(session: aiohttp.ClientSession, match: Matcher, now: datetime) -> DlsiteBatch:
    """Everything the store contributes, in one paced pass."""
    client = _Client(session)
    batch = DlsiteBatch()
    # The ranking pages are the first to be refused once the store's request budget is
    # spent, so they go first; the cache keeps the last snapshot when they are not.
    batch.rankings = await _fetch_rankings(client, match)
    batch.released = await _fetch_calendar(client, match, now)
    batch.preorders = await _fetch_preorders(client, match, now)
    batch.announced = await _fetch_announced(client, match, now)
    batch.sales = await _fetch_discounts(client, match, now)
    logger.info(
        "DLsite: %d released, %d pre-orders, %d announced, %d sales, %d ranked, %d requests",
        len(batch.released),
        len(batch.preorders),
        len(batch.announced),
        len(batch.sales),
        sum(len(v) for v in batch.rankings.values()),
        client.requests,
    )
    return batch
