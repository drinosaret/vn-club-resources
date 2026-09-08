"""Store search results for the Visual Novel tag with Japanese language support.

The endpoint is the one the store's own infinite scroll calls; it answers JSON whose
`results_html` is the same markup the page shows. Every listing is matched against the
catalogue and only Japanese-original titles become rows.
"""

from __future__ import annotations

import html
import logging
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Awaitable, Callable

import aiohttp

from app.services.news.drafts import NewsDraft
from app.services.news.matching import MatchedVN

logger = logging.getLogger(__name__)

SEARCH_URL = (
    "https://store.steampowered.com/search/results/?query&start=0&count=50&infinite=1"
    "&json=1&tags=3799&supportedlang=japanese&cc=jp&l=english"
)
QUERIES = {"released": "&sort_by=Released_DESC", "sale": "&specials=1"}
RELEASED_WINDOW = timedelta(days=7)
NSFW_COVER = 1.5
USER_AGENT = "Mozilla/5.0 (compatible; VN-Club-Resources/1.0; +https://vnclub.org)"

_ROW = re.compile(r'<a\s[^>]*data-ds-appid="(\d+)"[^>]*>(.*?)</a>', re.S)
_TITLE = re.compile(r'<span class="title">(.*?)</span>', re.S)
_RELEASED = re.compile(r'<div class="search_released[^"]*">\s*(.*?)\s*</div>', re.S)
_IMG = re.compile(r'<img\s+src="([^"]+)"')
_DISCOUNT = re.compile(r'data-discount="(\d+)"')
_ORIG = re.compile(r'<div class="discount_original_price">(.*?)</div>')
_FINAL = re.compile(r'<div class="discount_final_price">(.*?)</div>')
_MONTHS = {
    m: i
    for i, m in enumerate(
        ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], 1
    )
}


@dataclass
class SteamListing:
    appid: str
    title: str
    released: date | None
    image_url: str | None
    discount: int
    original_price: str | None
    final_price: str | None


def _parse_release(text: str) -> date | None:
    m = re.match(r"(\d{1,2}) (\w{3}), (\d{4})", text.strip())
    if not m or m.group(2) not in _MONTHS:
        return None
    return date(int(m.group(3)), _MONTHS[m.group(2)], int(m.group(1)))


def parse_results(results_html: str) -> list[SteamListing]:
    listings = []
    for appid, body in _ROW.findall(results_html):
        title = _TITLE.search(body)
        released = _RELEASED.search(body)
        img = _IMG.search(body)
        discount = _DISCOUNT.search(body)
        orig, final = _ORIG.search(body), _FINAL.search(body)
        listings.append(
            SteamListing(
                appid=appid,
                title=html.unescape(title.group(1)).strip() if title else appid,
                released=_parse_release(released.group(1)) if released else None,
                image_url=html.unescape(img.group(1)).split("?")[0] if img else None,
                discount=int(discount.group(1)) if discount else 0,
                original_price=html.unescape(orig.group(1)).strip() if orig else None,
                final_price=html.unescape(final.group(1)).strip() if final else None,
            )
        )
    return listings


Matcher = Callable[[str, str], Awaitable[MatchedVN | None]]


async def drafts_from_listings(
    listings: list[SteamListing], kind: str, match: Matcher, now: datetime
) -> list[NewsDraft]:
    drafts: list[NewsDraft] = []
    for listing in listings:
        if kind == "released":
            if not listing.released or now.date() - listing.released > RELEASED_WINDOW:
                continue
        elif listing.discount <= 0:
            continue
        vn = await match("steam", listing.appid)
        if vn is None:
            continue
        key = listing.appid if kind == "released" else f"{listing.appid}-sale-{listing.discount}"
        if kind == "released" and listing.released:
            released_at = datetime.combine(listing.released, datetime.min.time(), tzinfo=now.tzinfo)
        else:
            released_at = now
        drafts.append(
            NewsDraft(
                source="steam",
                source_label="Steam",
                key=key,
                title=vn.title,
                summary=listing.title,
                url=f"https://store.steampowered.com/app/{listing.appid}/",
                image_url=vn.image_url,
                image_is_nsfw=bool(vn.image_sexual and vn.image_sexual >= NSFW_COVER),
                published_at=released_at,
                tags=[kind],
                vn_id=vn.id,
                extra={
                    "vn_id": vn.id,
                    "alttitle": vn.title_jp,
                    "title_romaji": vn.title_romaji,
                    "developers": vn.developers,
                    "developers_original": vn.developers_original,
                    "platforms": ["win"],
                    "minage": vn.minage,
                    "image_sexual": vn.image_sexual,
                    "appid": listing.appid,
                    "store_title": listing.title,
                    "discount": listing.discount,
                    "original_price": listing.original_price,
                    "final_price": listing.final_price,
                    "released": listing.released.isoformat() if listing.released else None,
                },
            )
        )
    return drafts


async def fetch_listings(session: aiohttp.ClientSession, kind: str) -> list[SteamListing]:
    url = SEARCH_URL + QUERIES[kind]
    headers = {"User-Agent": USER_AGENT}
    async with session.get(url, headers=headers, timeout=aiohttp.ClientTimeout(total=30)) as resp:
        if resp.status != 200:
            logger.warning("Steam search (%s) returned %s", kind, resp.status)
            return []
        data = await resp.json(content_type=None)
    return parse_results(data.get("results_html") or "")
