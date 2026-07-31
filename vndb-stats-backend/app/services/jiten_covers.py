"""Cover safety for VN posts: swap an adult VNDB cover for jiten.moe's SFW one.

jiten.moe hosts an always-SFW cover for most VNs, keyed by its own deck id. When
a VNDB cover is flagged we prefer that swap, and only blur when the VN has no
jiten deck. This mirrors hikaru's resolve_display_cover (VN_Club_Bot/lib/
jiten_client.py) and the site's lib/safe-cover.ts, which already does the same
lookup in TypeScript for the home page.

The bot's threshold (0.7) is lower than the website's blur bar (1.5, see
components/NSFWImage.tsx). That is deliberate, not drift: the website has
click-to-reveal, a Discord channel does not, so a post gets the stricter bar.
"""

import asyncio
import logging
import random
import re

import httpx

from app.core.cache import get_cache
from app.services.jiten_client import BASE_URL, TIMEOUT

logger = logging.getLogger(__name__)

# VNDB image.sexual runs 0-2; 0.7 catches the "suggestive" band.
COVER_BLUR_THRESHOLD = 0.7

# jiten serves covers at a deterministic path, so a deck id is all we need.
CDN_COVER_URL = "https://cdn.jiten.moe/{deck_id}/cover.jpg"

DECK_ID_TTL = 24 * 3600  # deck mappings essentially never change
NULL_DECK_ID_TTL = 3600  # recheck "not on jiten" sooner
DECK_COVER_TTL = 6 * 3600

_RETRY_DELAYS = (1, 3, 5)

# vndb_id reaches this module from a nomination row, so it is always a
# visual_novels primary key. Re-check the shape anyway before it is spliced into
# a request path: it is the only value here that originates outside this service.
_VNDB_ID_RE = re.compile(r"\Av[0-9]{1,9}\Z")

# Per-key coalescing: two members nominating the same VN at once must not both
# hit jiten. The bot, api, and worker are separate containers, so the Redis
# layer below is what actually shares results; these locks only dedupe in-process.
_deck_locks: dict[str, asyncio.Lock] = {}
_cover_locks: dict[int, asyncio.Lock] = {}


def _lock(store: dict, key) -> asyncio.Lock:
    lock = store.get(key)
    if lock is None:
        lock = store[key] = asyncio.Lock()
    return lock


async def _get_json(path: str):
    """GET with a jittered backoff. Raises on 5xx/network, returns None on 4xx.

    The 4xx/5xx split is the point: 4xx means "jiten doesn't have this VN" and is
    safe to cache, 5xx means jiten is having a bad day and must NOT be cached as
    a negative, or an outage would strip covers for a day.
    """
    last: Exception | None = None
    for attempt, delay in enumerate((0,) + _RETRY_DELAYS):
        if delay:
            await asyncio.sleep(delay * random.uniform(0.75, 1.25))
        try:
            async with httpx.AsyncClient(base_url=BASE_URL, timeout=TIMEOUT) as client:
                resp = await client.get(path)
            if 400 <= resp.status_code < 500:
                return None
            resp.raise_for_status()
            return resp.json()
        except Exception as exc:  # noqa: BLE001 - retried, then re-raised below
            last = exc
    raise last  # type: ignore[misc]


async def resolve_deck_id(vndb_id: str) -> int | None:
    """The jiten deck id for a VNDB id ("v17"), or None when the VN isn't on jiten."""
    if not _VNDB_ID_RE.match(vndb_id or ""):
        logger.warning("refusing jiten lookup for a malformed VNDB id")
        return None
    cache = get_cache()
    key = f"jiten:deck:{vndb_id}"
    cached = await cache.get(key)
    if cached is not None:
        return cached.get("id")

    async with _lock(_deck_locks, vndb_id):
        cached = await cache.get(key)
        if cached is not None:
            return cached.get("id")
        ids = await _get_json(f"/api/media-deck/by-link-id/2/{vndb_id}")
        deck_id = ids[0] if isinstance(ids, list) and ids else None
        await cache.set(key, {"id": deck_id}, ttl=DECK_ID_TTL if deck_id else NULL_DECK_ID_TTL)
        return deck_id


async def deck_has_cover(deck_id: int) -> bool:
    """Whether the deck actually has cover art.

    The CDN url is composed, not read back from the API, so without this check we
    would happily write a cover.jpg that 404s into an events row and an embed.
    """
    cache = get_cache()
    key = f"jiten:cover:{deck_id}"
    cached = await cache.get(key)
    if cached is not None:
        return bool(cached.get("has_cover"))

    async with _lock(_cover_locks, deck_id):
        cached = await cache.get(key)
        if cached is not None:
            return bool(cached.get("has_cover"))
        data = await _get_json(f"/api/media-deck/{deck_id}/detail")
        detail = (data or {}).get("data") or {}
        main = detail.get("mainDeck") or {}
        has_cover = bool(main.get("coverName") or detail.get("coverName"))
        await cache.set(key, {"has_cover": has_cover}, ttl=DECK_COVER_TTL)
        return has_cover


async def get_sfw_cover_url(vndb_id: str) -> str | None:
    """jiten's SFW cover for a VN, or None when it has no deck or no cover art."""
    try:
        deck_id = await resolve_deck_id(vndb_id)
        if deck_id and await deck_has_cover(deck_id):
            return CDN_COVER_URL.format(deck_id=deck_id)
    except Exception as exc:  # noqa: BLE001
        # jiten unreachable: the caller falls through to blurring the real cover.
        logger.warning("jiten cover lookup failed for %s: %s", vndb_id, type(exc).__name__)
    return None


async def resolve_display_cover(
    vndb_id: str,
    image_url: str | None,
    image_sexual: float | None,
    *,
    mode: str = "auto",
) -> tuple[str | None, bool, bool]:
    """Pick the cover to render. Returns (url, blur, show).

    auto    - jiten's SFW cover when the VNDB one is flagged, else the VNDB cover;
              blur only when it is flagged AND there is no swap available
    shown   - the VNDB cover as-is
    blurred - the VNDB cover, blurred (never the swap: you blur the real art)
    hidden  - no cover at all
    """
    if mode == "hidden":
        return None, False, False
    if mode == "shown":
        return image_url, False, True
    if mode == "blurred":
        # Only claim "blurred" when there is something to blur, so a coverless VN
        # falls to the neutral placeholder instead of an NSFW-looking smear.
        return image_url, bool(image_url), True

    score = image_sexual or 0
    if score < COVER_BLUR_THRESHOLD or not image_url:
        return image_url, False, True
    swap = await get_sfw_cover_url(vndb_id)
    if swap:
        return swap, False, True
    return image_url, True, True
