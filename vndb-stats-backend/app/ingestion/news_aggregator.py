"""News jobs. Each source adapter runs on its own; one failing never blocks the rest.

The jobs, scheduled in scripts/worker.py:
- headlines: press feeds, Bluesky and X accounts, brand sites
- reviews: the VNDB review listing and the review feeds
- community: creators, boards, forums, community writing, Bluesky search
- trailers: YouTube channels
- VNDB new entries and releases, with catch-up runs through the afternoon
- storefronts and the award site, after the dump import
- deleted-VN reconcile, after the dump import
- retention cleanup

The headlines and community runs end by giving recent imageless rows a preview picture
from the page each row points at, and by filling in developer names for rows filed with
only one script of them.
"""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone
from pathlib import Path

import aiohttp

from sqlalchemy import select

from app.db.database import async_session_maker
from app.db.models import RSSFeedConfig
from app.core.cache import get_cache
from app.services.news import pictures, relevance, store
from app.services.news.sections import (
    DLSITE_RANKINGS_KEY,
    DLSITE_RANKINGS_TTL,
    GETCHU_RANKINGS_KEY,
)
from app.services.news.adapters import (
    bluesky,
    bluesky_search,
    boards,
    booth,
    brandsites,
    digiket,
    dlsite,
    fourchan,
    freem,
    fxtwitter,
    gamer,
    getchu,
    jiten,
    kadokawa,
    melonbooks,
    moeaward,
    rss,
    steam,
    vndb,
    vndb_reviews,
    youtube,
)
from app.services.news.matching import article_origin, resolve_store_vn
from app.services.news.sources import (
    EN,
    BLUESKY_ACCOUNTS,
    BOARDS,
    BLUESKY_SEARCHES,
    BOARDS,
    COMMUNITY_SOURCES,
    CREATOR_ACCOUNTS,
    REVIEW_SOURCES,
    RSS_FEEDS,
    X_ACCOUNTS,
    YOUTUBE_CHANNELS,
    RssFeed,
)

logger = logging.getLogger(__name__)

HTTP_TIMEOUT = aiohttp.ClientTimeout(total=60)
PER_HOST_CONNECTIONS = 8
# Some outlets refuse a bare library client; every request says who is asking.
USER_AGENT = "Mozilla/5.0 (compatible; VN-Club-Resources/1.0; +https://vnclub.org)"


def _http() -> aiohttp.ClientSession:
    # A run opens many sources at once; the per-host cap keeps the accounts that share
    # one relay from reaching it as a burst it answers with a rate limit.
    return aiohttp.ClientSession(
        timeout=HTTP_TIMEOUT,
        headers={"User-Agent": USER_AGENT},
        connector=aiohttp.TCPConnector(limit_per_host=PER_HOST_CONNECTIONS),
    )


async def _run_adapter(label: str, coro):
    try:
        return await coro
    except Exception as e:  # noqa: BLE001
        logger.error("News adapter %s failed: %s", label, e)
        return []


async def _rss_feeds() -> list[RssFeed]:
    """The registry's press feeds plus any feed an admin added at runtime through the bot."""
    feeds = [f for f in RSS_FEEDS if f.source not in COMMUNITY_SOURCES + REVIEW_SOURCES]
    known = {f.url for f in feeds}
    async with async_session_maker() as db:
        result = await db.execute(select(RSSFeedConfig).where(RSSFeedConfig.is_active == True))  # noqa: E712
        rows = result.scalars().all()
    for row in rows:
        if row.url and row.url not in known:
            feeds.append(
                RssFeed(row.name, row.url, list(row.keywords or []), list(row.exclude_keywords or []))
            )
    return feeds


# Sources whose English rows are about one work, where the catalogue can say whether that
# work is Japanese in origin. Thread openers are included: the board a thread sits on is
# not published, so the title it names is what places it.
_ORIGIN_CHECKED_SOURCES = ("rss", "review", "forum")


# What reaches most of the registry is already selected: a hashtag or search feed, a
# board with one thread per work, a subreddit about this medium, a brand's own channel.
# The entries that are not carry the scene's conversation and a good deal beside it, and
# a row from one of those files only when something in it ties it to the medium.
_BROAD_CHANNELS = frozenset(c.channel_id for c in YOUTUBE_CHANNELS if c.broad)
_PER_WORK_BOARDS = frozenset(b.name for b in BOARDS if b.per_work)


def _reads_loosely(draft) -> bool:
    """Whether a draft comes from a source that carries more than this medium."""
    if draft.extra.get("broad") or draft.extra.get("channel_id") in _BROAD_CHANNELS:
        return True
    # A post search matches the words, not the subject, so its hits are read.
    if draft.source == "bsky_search":
        return True
    return draft.source == "board" and draft.source_label not in _PER_WORK_BOARDS


async def _drop_off_topic(db, drafts: list) -> list:
    """Posts from a loose source that name nothing tying them to this medium."""
    kept = []
    seen: dict[tuple, bool] = {}
    for draft in drafts:
        if not _reads_loosely(draft):
            kept.append(draft)
            continue
        body = f"{draft.title} {draft.summary or ''}"
        # The post's own address is not read: a source hosted on a catalogue or a store
        # would place every one of its own rows.
        links = [u for u in (draft.extra.get("expanded_urls") or []) if isinstance(u, str)]
        key = (body, tuple(links))
        if key not in seen:
            try:
                seen[key] = await relevance.is_vn_related(db, body, links=links)
            except Exception as e:  # noqa: BLE001
                logger.error("Relevance check failed: %s", e)
                await db.rollback()
                seen[key] = True
        if not seen[key]:
            logger.info("Not VN-related: %s", draft.title)
            continue
        kept.append(draft)
    return kept


async def _drop_other_origins(db, drafts: list) -> list:
    """English articles about a title the catalogue files under another original language."""
    kept = []
    seen: dict[str, str | None] = {}
    for draft in drafts:
        if draft.extra.get("lang") != EN or draft.source not in _ORIGIN_CHECKED_SOURCES:
            kept.append(draft)
            continue
        body = f"{draft.title} {draft.summary or ''}"
        if body not in seen:
            try:
                seen[body] = await article_origin(db, body)
            except Exception as e:  # noqa: BLE001
                logger.error("Origin check failed: %s", e)
                await db.rollback()
                seen[body] = None
        origin = seen[body]
        if origin and origin != "ja":
            logger.info("Dropping %s: original language %s", draft.title, origin)
            continue
        kept.append(draft)
    return kept


async def _run_pictures(http: aiohttp.ClientSession, db) -> int:
    """Preview pictures for the imageless rows a fetch job has just left behind."""
    try:
        return await pictures.fill_missing_pictures(http, db)
    except Exception as e:  # noqa: BLE001
        logger.error("Picture fill failed: %s", e)
        return 0


async def _run_developer_scripts(db) -> int:
    """Developer names in both scripts for rows filed with only one."""
    try:
        return await pictures.fill_developer_scripts(db)
    except Exception as e:  # noqa: BLE001
        logger.error("Developer name fill failed: %s", e)
        return 0


async def run_headlines_check():
    now = datetime.now(timezone.utc)
    feeds = await _rss_feeds()
    async with _http() as http:
        batches = await asyncio.gather(
            *[_run_adapter(f.name, rss.fetch_feed(http, f, now)) for f in feeds],
            *[_run_adapter(a.handle, bluesky.fetch_author_feed(http, a, now)) for a in BLUESKY_ACCOUNTS],
            *[_run_adapter(a.handle, fxtwitter.fetch_statuses(http, a, now)) for a in X_ACCOUNTS],
            _run_adapter("kadokawa", kadokawa.fetch_all(http, now)),
            _run_adapter("gamer", gamer.fetch_all(http, now)),
            _run_adapter("brand sites", brandsites.fetch_all(http, now)),
        )
        drafts = [d for batch in batches for d in batch]
        drafts.sort(key=lambda d: d.published_at, reverse=True)
        fetched = len(drafts)
        async with async_session_maker() as db:
            drafts = await _drop_other_origins(db, drafts)
            drafts = await _drop_off_topic(db, drafts)
            saved = await store.save_drafts(db, drafts)
            pictured = await _run_pictures(http, db)
            rescripted = await _run_developer_scripts(db)
    logger.info(
        "Headlines check: %d new of %d fetched, %d pictures filled, %d developer names rewritten",
        saved,
        fetched,
        pictured,
        rescripted,
    )


async def _paced(label: str, coros, pause: float = 5.0):
    """Requests to one host in turn, with a pause: a burst to it answers with a rate limit."""
    out = []
    for i, coro in enumerate(coros):
        if i:
            await asyncio.sleep(pause)
        out.extend(await _run_adapter(label, coro))
    return out


async def run_community_check():
    """Creators, boards, forums and community writing."""
    now = datetime.now(timezone.utc)
    feeds = [f for f in RSS_FEEDS if f.source in COMMUNITY_SOURCES]
    paced = [f for f in feeds if f.source == "reddit"]
    feeds = [f for f in feeds if f not in paced]
    async with _http() as http:
        batches = await asyncio.gather(
            *[_run_adapter(f.name, rss.fetch_feed(http, f, now)) for f in feeds],
            _paced("reddit", [rss.fetch_feed(http, f, now) for f in paced]),
            *[_run_adapter(a.handle, fxtwitter.fetch_statuses(http, a, now)) for a in CREATOR_ACCOUNTS],
            *[_run_adapter(b.board, boards.fetch_board(http, b, now)) for b in BOARDS],
            _run_adapter("4chan", fourchan.fetch_catalog(http, now)),
            *[_run_adapter(s.name, bluesky_search.fetch_search(http, s, now)) for s in BLUESKY_SEARCHES],
        )
        drafts = [d for batch in batches for d in batch]
        drafts.sort(key=lambda d: d.published_at, reverse=True)
        fetched = len(drafts)
        async with async_session_maker() as db:
            drafts = await _drop_other_origins(db, drafts)
            drafts = await _drop_off_topic(db, drafts)
            saved = await store.save_drafts(db, drafts)
            pictured = await _run_pictures(http, db)
            rescripted = await _run_developer_scripts(db)
    logger.info(
        "Community check: %d new of %d fetched, %d pictures filled, %d developer names rewritten",
        saved,
        fetched,
        pictured,
        rescripted,
    )


async def run_reviews_check():
    """The review listing and the review feeds. The listing is read first so a post
    that also reaches a community feed is filed as the review it is."""
    now = datetime.now(timezone.utc)
    feeds = [f for f in RSS_FEEDS if f.source in REVIEW_SOURCES]
    async with _http() as http, async_session_maker() as db:
        drafts = list(await _run_adapter("vndb reviews", vndb_reviews.fetch_new_reviews(http, db, now)))
        batches = await asyncio.gather(
            *[_run_adapter(f.name, rss.fetch_feed(http, f, now)) for f in feeds]
        )
        drafts += [d for batch in batches for d in batch]
        drafts.sort(key=lambda d: d.published_at, reverse=True)
        fetched = len(drafts)
        drafts = await _drop_other_origins(db, drafts)
        saved = await store.save_drafts(db, drafts)
    logger.info("Reviews check: %d new of %d fetched", saved, fetched)


async def run_trailers_check():
    now = datetime.now(timezone.utc)
    async with _http() as http:
        batches = await asyncio.gather(
            *[_run_adapter(c.name, youtube.fetch_channel(http, c, now)) for c in YOUTUBE_CHANNELS]
        )
    drafts = [d for batch in batches for d in batch]
    fetched = len(drafts)
    async with async_session_maker() as db:
        drafts = await _drop_off_topic(db, drafts)
        saved = await store.save_drafts(db, drafts)
    logger.info("Trailers check: %d new of %d fetched", saved, fetched)


async def run_storefront_check():
    now = datetime.now(timezone.utc)
    async with _http() as http, async_session_maker() as db:

        async def match(site: str, value: str):
            # Each lookup takes its own session: the stores are read at a crawl pace, and
            # a transaction left open between paced requests outlives the server's idle
            # limit and takes the connection with it.
            async with async_session_maker() as lookup:
                return await resolve_store_vn(lookup, site, value)

        released = await _run_adapter("steam released", steam.fetch_listings(http, "released"))
        on_sale = await _run_adapter("steam sale", steam.fetch_listings(http, "sale"))
        saved = await store.save_drafts(
            db, await steam.drafts_from_listings(released, "released", match, now)
        )
        saved += await store.save_drafts(
            db,
            await steam.drafts_from_listings(on_sale, "sale", match, now),
            refresh_existing=True,
        )
        batch = await _run_adapter("dlsite", dlsite.fetch_all(http, match, now))
        if batch:
            saved += await store.save_drafts(db, batch.released)
            saved += await store.save_drafts(db, batch.preorders)
            saved += await store.save_drafts(db, batch.announced)
            saved += await store.save_drafts(db, batch.sales, refresh_existing=True)
            if batch.rankings:
                await get_cache().set(
                    DLSITE_RANKINGS_KEY,
                    {"asOf": now.isoformat(), "sites": batch.rankings},
                    ttl=DLSITE_RANKINGS_TTL,
                )
        saved += await store.save_drafts(
            db, await _run_adapter("moeaward", moeaward.fetch_news(http, now))
        )
        getchu_rows = await _run_adapter("getchu", getchu.fetch_schedule(http, match, now))
        saved += await store.save_drafts(db, [d for d in getchu_rows if d.tags == ["released"]])
        saved += await store.save_drafts(
            db, [d for d in getchu_rows if d.tags == ["preorder"]], refresh_existing=True
        )
        getchu_ranks = await _run_adapter("getchu rankings", getchu.fetch_rankings(http, match))
        if getchu_ranks:
            await get_cache().set(
                GETCHU_RANKINGS_KEY,
                {"asOf": now.isoformat(), "kinds": getchu_ranks},
                ttl=DLSITE_RANKINGS_TTL,
            )
        for label, coro in (
            ("digiket", digiket.fetch_new_works(http, match, now)),
            ("booth", booth.fetch_new(http, match, now)),
            ("melonbooks", melonbooks.fetch_new(http, match, now)),
            ("freem", freem.fetch_new(http, match, now)),
        ):
            saved += await store.save_drafts(db, await _run_adapter(label, coro))
    logger.info("Storefront check: %d new", saved)


async def run_vndb_news_check():
    async with _http() as http, async_session_maker() as db:
        saved = await vndb.fetch_and_save_new_vns(http, db)
        saved += await store.save_drafts(
            db, await _run_adapter("jiten", jiten.fetch_new_decks(http, datetime.now(timezone.utc)))
        )
    logger.info("VNDB new entries: %d saved", saved)


async def run_vndb_releases_check():
    async with _http() as http, async_session_maker() as db:
        saved = await vndb.fetch_and_save_releases(http, db)
    logger.info("VNDB releases: %d saved", saved)


async def run_news_cleanup():
    async with async_session_maker() as db:
        await store.cleanup_old_items(db)
    logger.info("News cleanup completed")


def _cover_cache_dir() -> Path | None:
    raw = os.environ.get("VNDB_CACHE_DIR")
    return Path(raw) if raw else None


async def run_news_reconcile():
    async with async_session_maker() as db:
        await store.reconcile_deleted_vns(db, _cover_cache_dir())


async def run_news_catch_up():
    async with _http() as http, async_session_maker() as db:
        results = await vndb.catch_up_today(http, db, datetime.now(timezone.utc))
    if any(results.values()):
        logger.info("News catch-up: %s", results)


async def run_all_news_checks():
    """Every fetch job in sequence, for a manual trigger."""
    for job in (
        run_vndb_news_check,
        run_vndb_releases_check,
        run_headlines_check,
        run_reviews_check,
        run_community_check,
        run_trailers_check,
        run_storefront_check,
    ):
        try:
            await job()
        except Exception as e:  # noqa: BLE001
            logger.error("%s failed: %s", job.__name__, e, exc_info=True)
