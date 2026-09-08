"""DiGiket: the newest works on the doujin and commercial adult game listings.

The store's feed endpoint answers a fixed page of its newest works as JSON in the Windows
Japanese code page, with the genre and tags rendered as link markup. Only adventure and
novel genres are read. Everything on the store is adult, so every store picture is
flagged. The catalogue's release links carry the numeric part of the store id.
"""

from __future__ import annotations

import asyncio
import html
import json
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable

import aiohttp

from app.services.news.drafts import NewsDraft
from app.services.news.matching import MatchedVN

logger = logging.getLogger(__name__)

API_URL = "https://api.digiket.com/xml/api/getxml.php?target={target}&sort=new&xmltype=JSON"
# The listing's target number: doujin circles and commercial brands are separate feeds.
TARGETS = {"doujin": 1, "commercial": 4}
WORK_URL = "https://www.digiket.com/work/show/_data/ID={id}/"
ENCODING = "cp932"
REQUEST_PAUSE = 3
NEW_WINDOW = timedelta(days=7)
KEEP_GENRES = ("アドベンチャー", "ノベル")
PREORDER_MARK = "【予約】"
NSFW_COVER = 1.5
JST = timezone(timedelta(hours=9))
USER_AGENT = "Mozilla/5.0 (compatible; VN-Club-Resources/1.0; +https://vnclub.org)"

_TAG = re.compile(r"<[^>]+>")
_SPACE = re.compile(r"\s+")
_ID_DIGITS = re.compile(r"(\d+)$")


@dataclass
class DigiketWork:
    trade_id: str
    title: str
    maker: str | None
    target: str
    registered: datetime
    genre: str
    tags: list[str] = field(default_factory=list)
    intro: str | None = None
    price: str | None = None
    image_url: str | None = None


def catalogue_id(trade_id: str) -> str:
    """The form the catalogue's release links store: the digits without prefix or padding."""
    m = _ID_DIGITS.search(trade_id)
    return str(int(m.group(1))) if m else trade_id


def _text(markup: str) -> str:
    return _SPACE.sub(" ", html.unescape(_TAG.sub(" ", markup or ""))).strip()


def _tags(markup: str) -> list[str]:
    return [t for t in (_text(part) for part in re.split(r"</a>", markup or "", flags=re.I)) if t]


def _registered(stamp: str) -> datetime | None:
    try:
        return datetime.strptime(stamp, "%Y%m%d%H%M%S").replace(tzinfo=JST).astimezone(timezone.utc)
    except (TypeError, ValueError):
        return None


def parse_works(payload: bytes | str, target: str = "doujin") -> list[DigiketWork]:
    """The adventure and novel works in one feed answer."""
    text = payload.decode(ENCODING, errors="replace") if isinstance(payload, bytes) else payload
    try:
        items = json.loads(text)
    except ValueError:
        return []
    if not isinstance(items, list):
        return []
    works = []
    for item in items:
        if not isinstance(item, dict) or not item.get("trade_id"):
            continue
        genre = _text(item.get("genre", ""))
        if not any(g in genre for g in KEEP_GENRES):
            continue
        registered = _registered(item.get("registdate", ""))
        if registered is None:
            continue
        price = str(item.get("price") or "").strip()
        image = item.get("trade_cg") or item.get("trade_cg_1") or ""
        works.append(
            DigiketWork(
                trade_id=str(item["trade_id"]),
                title=_text(item.get("trade_name") or item["trade_id"]),
                maker=_text(item.get("circle_name", "")) or None,
                target=target,
                registered=registered,
                genre=genre,
                tags=_tags(item.get("key", "")),
                intro=_text(item.get("intro", "")) or None,
                price=f"￥{int(price):,}" if price.isdigit() else None,
                image_url=("https:" + image) if image.startswith("//") else (image or None),
            )
        )
    return works


# ---------------------------------------------------------------- drafts

Matcher = Callable[[str, str], Awaitable[MatchedVN | None]]


def _summary(work: DigiketWork) -> str:
    parts = [work.maker, work.genre, ", ".join(work.tags)]
    return " · ".join(p for p in parts if p)


def _kind(work: DigiketWork) -> str:
    # The commercial listing registers a pre-order as a work whose title carries the mark.
    return "preorder" if PREORDER_MARK in work.title else "released"


async def _draft(work: DigiketWork, published_at: datetime, match: Matcher) -> NewsDraft:
    vn = await match("digiket", catalogue_id(work.trade_id))
    kind = _kind(work)
    extra: dict[str, Any] = {
        "kind": kind,
        "trade_id": work.trade_id,
        "target": work.target,
        "store_title": work.title,
        "maker": work.maker,
        "genre": work.genre,
        "store_tags": work.tags,
        "platforms": ["win"],
        "original_price": None,
        "final_price": work.price,
        "released": work.registered.astimezone(JST).date().isoformat(),
    }
    url = WORK_URL.format(id=work.trade_id)
    if vn is not None:
        extra.update(
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
            source="digiket",
            source_label="DiGiket",
            key=work.trade_id,
            title=vn.title,
            summary=_summary(work),
            url=url,
            image_url=vn.image_url or work.image_url,
            image_is_nsfw=bool(vn.image_sexual and vn.image_sexual >= NSFW_COVER) if has_cover else True,
            published_at=published_at,
            tags=[kind],
            vn_id=vn.id,
            extra=extra,
        )
    extra.update({"developers": [work.maker] if work.maker else [], "minage": 18})
    return NewsDraft(
        source="digiket",
        source_label="DiGiket",
        key=work.trade_id,
        title=work.title,
        summary=_summary(work),
        url=url,
        image_url=work.image_url,
        image_is_nsfw=True,
        published_at=published_at,
        tags=[kind],
        extra=extra,
    )


async def drafts_from_works(
    works: list[DigiketWork], match: Matcher, now: datetime
) -> list[NewsDraft]:
    """Works registered within the window. A registration stamped ahead of the clock is
    dated now, so the feed never carries a row from the future."""
    drafts = []
    for work in works:
        if now - work.registered > NEW_WINDOW:
            continue
        drafts.append(await _draft(work, min(work.registered, now), match))
    return drafts


# ---------------------------------------------------------------- fetching


async def fetch_new_works(
    session: aiohttp.ClientSession, match: Matcher, now: datetime
) -> list[NewsDraft]:
    works: list[DigiketWork] = []
    for i, (target, number) in enumerate(TARGETS.items()):
        if i:
            await asyncio.sleep(REQUEST_PAUSE)
        url = API_URL.format(target=number)
        try:
            async with session.get(
                url, headers={"User-Agent": USER_AGENT}, timeout=aiohttp.ClientTimeout(total=30)
            ) as resp:
                if resp.status != 200:
                    logger.warning("DiGiket %s returned %s", target, resp.status)
                    continue
                works.extend(parse_works(await resp.read(), target))
        except Exception as e:  # noqa: BLE001
            logger.warning("DiGiket %s failed: %s", target, e)
    drafts = await drafts_from_works(works, match, now)
    logger.info("DiGiket: %d works kept, %d rows", len(works), len(drafts))
    return drafts
