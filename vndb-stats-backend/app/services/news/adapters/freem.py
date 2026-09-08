"""ふりーむ！: the newest free novel games, all-ages.

The category listing is newest first and carries no dates; each game's own page shows
the day it was registered, so candidates are opened in page order until one is older
than the window. A game whose page cannot be read counts as new. Every game is matched
against the catalogue; an unmatched one becomes a row of its own with the site's picture.
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

BASE = "https://www.freem.ne.jp"
# The novel-game category of the Windows section.
LIST_URL = BASE + "/win/category/4?sort=new"
GAME_URL = BASE + "/win/game/{id}"
MAX_ITEMS = 20
REGISTERED_WINDOW = timedelta(days=7)
REQUEST_GAP = 3
NSFW_COVER = 1.5
USER_AGENT = "Mozilla/5.0 (compatible; VN-Club-Resources/1.0; +https://vnclub.org)"
# The site localises its labels by the request language; the date row is read in either.
HEADERS = {"User-Agent": USER_AGENT, "Accept-Language": "ja"}

_LIST = re.compile(r'<ul class="([^"]*\bgame-list\b[^"]*)">(.*?)</ul>', re.S)
_ENTRY = re.compile(r'<li class="col">\s*<a href="/win/game/(\d+)">')
_THUMB = re.compile(r'data-src="(https://fpiccdn\.com/[^"]+)"')
_TITLE = re.compile(r'<h3 class="pc">(?:<span[^>]*></span>)?\s*([^<]*?)\s*</h3>')
_ALT = re.compile(r'alt="([^"]*)"')
_CIRCLE = re.compile(r'<h4><a href="/brand/(\d+)">([^<]*)</a>')
_BLURB = re.compile(r'<div class="game-list-sub pc">.*?<p>([^<]*)</p>', re.S)
_REGISTERED = re.compile(r'(?:■登録日|\[Registered\])\s*</th>\s*<td[^>]*>\s*(\d{4})-(\d{2})-(\d{2})')
_OG_IMAGE = re.compile(r'<meta property="og:image" content="([^"]*)"')


@dataclass
class FreemGame:
    game_id: str
    title: str
    circle: str | None
    blurb: str | None = None
    image_url: str | None = None
    registered: date | None = None


@dataclass
class FreemDetail:
    registered: date | None = None
    image_url: str | None = None


# ---------------------------------------------------------------- parsing


def _entries(page: str) -> list[tuple[str, str]]:
    """(game id, markup) per entry of the listing proper, each game once.

    The page ends with a recommendations strip in the same markup; it is skipped, since
    the games there are older picks, not new listings.
    """
    out: list[tuple[str, str]] = []
    seen: set[str] = set()
    for classes, body in _LIST.findall(page):
        if "recommend" in classes:
            continue
        positions = list(_ENTRY.finditer(body))
        for i, m in enumerate(positions):
            end = positions[i + 1].start() if i + 1 < len(positions) else len(body)
            if m.group(1) not in seen:
                seen.add(m.group(1))
                out.append((m.group(1), body[m.start():end]))
    return out


def parse_listing(page: str) -> list[FreemGame]:
    """The games of one listing page, in page order."""
    games = []
    for game_id, block in _entries(page):
        title = _TITLE.search(block)
        alt = _ALT.search(block)
        circle = _CIRCLE.search(block)
        blurb = _BLURB.search(block)
        thumb = _THUMB.search(block)
        name = html.unescape((title.group(1) if title else "") or (alt.group(1) if alt else "")).strip()
        games.append(
            FreemGame(
                game_id=game_id,
                title=name or game_id,
                circle=html.unescape(circle.group(2)).strip() if circle else None,
                blurb=(html.unescape(blurb.group(1)).strip() or None) if blurb else None,
                image_url=html.unescape(thumb.group(1)) if thumb else None,
            )
        )
    return games


def parse_detail(page: str) -> FreemDetail:
    """The registration day and the full-size picture from a game's own page."""
    detail = FreemDetail()
    m = _REGISTERED.search(page)
    if m:
        try:
            detail.registered = date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError:
            pass
    m = _OG_IMAGE.search(page)
    if m and m.group(1).startswith("https://fpiccdn.com/"):
        detail.image_url = html.unescape(m.group(1))
    return detail


# ---------------------------------------------------------------- drafts

Matcher = Callable[[str, str], Awaitable[MatchedVN | None]]


def _summary(game: FreemGame) -> str | None:
    parts = [p for p in (game.circle, game.blurb) if p]
    return " / ".join(parts) if parts else None


async def _draft(game: FreemGame, match: Matcher, now: datetime) -> NewsDraft:
    vn = await match("freem", game.game_id)
    if game.registered:
        published = datetime.combine(game.registered, datetime.min.time(), tzinfo=now.tzinfo)
    else:
        published = now
    extra: dict[str, Any] = {
        "kind": "released",
        "game_id": game.game_id,
        "store_title": game.title,
        "final_price": "無料",
        "platforms": ["win"],
        "released": game.registered.isoformat() if game.registered else None,
        "developers": [game.circle] if game.circle else [],
        "minage": None,
    }
    url = GAME_URL.format(id=game.game_id)
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
            source="freem",
            source_label="ふりーむ！",
            key=game.game_id,
            title=vn.title,
            summary=_summary(game),
            url=url,
            image_url=vn.image_url or game.image_url,
            image_is_nsfw=bool(has_cover and vn.image_sexual and vn.image_sexual >= NSFW_COVER),
            published_at=published,
            tags=["released"],
            vn_id=vn.id,
            extra=extra,
        )
    return NewsDraft(
        source="freem",
        source_label="ふりーむ！",
        key=game.game_id,
        title=game.title,
        summary=_summary(game),
        url=url,
        image_url=game.image_url,
        image_is_nsfw=False,
        published_at=published,
        tags=["released"],
        extra=extra,
    )


async def drafts_from_works(games: list[FreemGame], match: Matcher, now: datetime) -> list[NewsDraft]:
    """Rows for the games registered inside the window; an undated game counts as new."""
    drafts = []
    for game in games[:MAX_ITEMS]:
        if game.registered and now.date() - game.registered > REGISTERED_WINDOW:
            continue
        drafts.append(await _draft(game, match, now))
    return drafts


# ---------------------------------------------------------------- fetching


async def _get(session: aiohttp.ClientSession, url: str) -> str | None:
    try:
        async with session.get(
            url, headers=HEADERS, timeout=aiohttp.ClientTimeout(total=30)
        ) as resp:
            if resp.status != 200:
                logger.warning("freem %s returned %s", url, resp.status)
                return None
            return await resp.text()
    except Exception as e:  # noqa: BLE001
        logger.warning("freem %s failed: %s", url, e)
        return None


async def fetch_new(session: aiohttp.ClientSession, match: Matcher, now: datetime) -> list[NewsDraft]:
    page = await _get(session, LIST_URL)
    if not page:
        return []
    games = parse_listing(page)
    kept: list[FreemGame] = []
    for game in games[:MAX_ITEMS]:
        await asyncio.sleep(REQUEST_GAP)
        detail_page = await _get(session, GAME_URL.format(id=game.game_id))
        if detail_page:
            detail = parse_detail(detail_page)
            game.registered = detail.registered
            game.image_url = detail.image_url or game.image_url
        # The listing is newest first, so the first game past the window ends the read.
        if game.registered and now.date() - game.registered > REGISTERED_WINDOW:
            break
        kept.append(game)
    drafts = await drafts_from_works(kept, match, now)
    logger.info("freem: %d rows of %d listed", len(drafts), len(games))
    return drafts
