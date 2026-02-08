"""News aggregation scheduled tasks.

Runs at the same times as the Discord bot:
- VNDB New VNs: 10:00 UTC daily
- VNDB Releases: 16:00 UTC daily
- RSS Feeds: 06:00, 18:00 UTC
- Twitter: 01:00, 07:00, 13:00, 19:00 UTC
- Cleanup: 00:00 UTC daily
"""

import hashlib
import logging
import time
from typing import Any

import aiohttp

from app.db.database import async_session_maker
from app.services.news_service import NewsService
from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

# Twitter client (initialized once)
_twitter_client = None
_twitter_authenticated = False
_twitter_auth_failed_until: float = 0.0
_twitter_auth_token_fingerprint: str | None = None
_twitter_init_failed = False

_TWITTER_AUTH_FAILURE_COOLDOWN_SECONDS = 60 * 60  # 1 hour


def _get_twitter_client():
    """Get or create Twitter client."""
    global _twitter_client, _twitter_authenticated, _twitter_init_failed

    if _twitter_init_failed:
        return None

    if _twitter_client is None:
        try:
            from tweety import Twitter
            _twitter_client = Twitter("VNNewsBot")
            logger.info("Twitter client initialized")
        except ImportError:
            logger.warning("tweety-ns not installed, Twitter integration disabled")
            _twitter_init_failed = True
            return None
        except Exception as e:
            logger.error(f"Error initializing Twitter client: {e}")
            _twitter_init_failed = True
            return None

    return _twitter_client


async def _authenticate_twitter(client: Any, auth_token: str) -> bool:
    """Authenticate Twitter client."""
    global _twitter_authenticated, _twitter_auth_failed_until, _twitter_auth_token_fingerprint

    now = time.time()
    if _twitter_auth_failed_until and now < _twitter_auth_failed_until:
        logger.warning("Twitter auth is in cooldown; skipping this run")
        return False

    token_fp = hashlib.sha256(auth_token.encode("utf-8")).hexdigest()[:12]

    # If already authenticated with the same token, skip re-auth.
    if _twitter_authenticated and _twitter_auth_token_fingerprint == token_fp:
        return True

    try:
        import asyncio
        await asyncio.wait_for(
            asyncio.to_thread(client.load_auth_token, auth_token),
            timeout=30.0
        )
        _twitter_authenticated = True
        _twitter_auth_token_fingerprint = token_fp
        _twitter_auth_failed_until = 0.0
        logger.info("Twitter client authenticated successfully")
        return True
    except Exception as e:
        logger.error(f"Twitter authentication failed: {e}")
        # Don’t permanently disable: auth tokens can expire/rotate.
        # Back off a bit to avoid hammering Twitter if blocked.
        _twitter_authenticated = False
        _twitter_auth_failed_until = time.time() + _TWITTER_AUTH_FAILURE_COOLDOWN_SECONDS
        return False


async def run_vndb_news_check():
    """Fetch and save newly added VNs from VNDB. Runs at 10:00 UTC daily."""
    logger.info("Running VNDB new VNs check...")

    try:
        async with aiohttp.ClientSession() as http_session:
            news_service = NewsService(session=http_session)

            async with async_session_maker() as db:
                # Fetch new VNs
                new_vns = await news_service.fetch_vndb_new_vns(db)

                if new_vns:
                    saved = await news_service.save_vndb_new_vns(db, new_vns)
                    logger.info(f"VNDB news check completed: saved {saved} new VNs")
                else:
                    logger.info("VNDB news check completed: no new VNs found")

    except Exception as e:
        logger.error(f"Error in VNDB news check: {e}", exc_info=True)


async def run_vndb_releases_check():
    """Fetch and save VN releases for today/tomorrow. Runs at 16:00 UTC daily."""
    logger.info("Running VNDB releases check...")

    try:
        async with aiohttp.ClientSession() as http_session:
            news_service = NewsService(session=http_session)

            async with async_session_maker() as db:
                # Fetch releases
                releases = await news_service.fetch_vndb_releases(db)

                if releases["today"] or releases["tomorrow"]:
                    saved = await news_service.save_vndb_releases(db, releases)
                    logger.info(f"VNDB releases check completed: saved {saved} release items")
                else:
                    logger.info("VNDB releases check completed: no releases found")

    except Exception as e:
        logger.error(f"Error in VNDB releases check: {e}", exc_info=True)


async def run_rss_check():
    """Check RSS feeds for new VN-related news. Runs at 06:00, 18:00 UTC."""
    logger.info("Running RSS feed check...")

    try:
        async with aiohttp.ClientSession() as http_session:
            news_service = NewsService(session=http_session)

            async with async_session_maker() as db:
                # Get RSS configs
                configs = await news_service.get_rss_configs(db)

                total_saved = 0
                for config in configs:
                    try:
                        entries = await news_service.fetch_rss_feed(
                            config.url,
                            config.keywords,
                            config.exclude_keywords
                        )

                        if entries:
                            saved = await news_service.save_rss_entries(db, entries, config.name)
                            total_saved += saved

                    except Exception as e:
                        logger.error(f"Error checking RSS feed {config.name}: {e}")

                logger.info(f"RSS check completed: saved {total_saved} entries")

    except Exception as e:
        logger.error(f"Error in RSS check: {e}", exc_info=True)


async def run_twitter_check():
    """Check Twitter accounts for VN-related news. Runs at 01:00, 07:00, 13:00, 19:00 UTC."""
    logger.info("Running Twitter check...")

    # Check if Twitter auth token is configured
    twitter_auth_token = getattr(settings, 'twitter_auth_token', None)
    if not twitter_auth_token:
        logger.info("Twitter auth token not configured, skipping Twitter check")
        return

    try:
        # Get Twitter client
        twitter_client = _get_twitter_client()
        if not twitter_client:
            logger.info("Twitter client not available, skipping")
            return

        # Authenticate if needed
        if not await _authenticate_twitter(twitter_client, twitter_auth_token):
            logger.info("Twitter authentication failed, skipping")
            return

        async with aiohttp.ClientSession() as http_session:
            news_service = NewsService(session=http_session)

            async with async_session_maker() as db:
                all_tweets = []
                # Cache account banners for accounts that exclude images
                account_banners: dict[str, str | None] = {}

                # Check each configured account
                for account in NewsService.TWITTER_ACCOUNTS:
                    try:
                        username = account["username"]
                        exclude_images = account.get("exclude_images", False)

                        # Fetch banner for accounts that exclude tweet images
                        if exclude_images and username not in account_banners:
                            banner = await news_service.fetch_user_banner(username, twitter_client)
                            account_banners[username] = banner
                            if banner:
                                logger.debug(f"Fetched banner for @{username}")

                        tweets = await news_service.fetch_tweets(
                            username,
                            account.get("exclude_phrases", []),
                            account.get("include_phrases", []),
                            twitter_client
                        )

                        # Add account info to tweets
                        for tweet in tweets:
                            tweet["_exclude_images"] = exclude_images
                            tweet["_fallback_image"] = account_banners.get(username) if exclude_images else None

                        all_tweets.extend(tweets)
                        logger.info(f"Found {len(tweets)} tweets from @{username}")

                    except Exception as e:
                        logger.error(f"Error checking @{account['username']}: {e}")

                # Sort by creation time, take top N
                all_tweets.sort(
                    key=lambda t: t.get('created_at') or 0,
                    reverse=True
                )
                tweets_to_save = all_tweets[:NewsService.MAX_TWEETS_PER_CHECK]

                if tweets_to_save:
                    total_saved = 0
                    for tweet in tweets_to_save:
                        saved = await news_service.save_tweets(
                            db,
                            [tweet],
                            exclude_images=tweet.get("_exclude_images", False),
                            fallback_image_url=tweet.get("_fallback_image")
                        )
                        total_saved += saved

                    logger.info(f"Twitter check completed: saved {total_saved} tweets")
                else:
                    logger.info("Twitter check completed: no new tweets")

    except Exception as e:
        logger.error(f"Error in Twitter check: {e}", exc_info=True)


async def run_news_cleanup():
    """Clean up old news items and tracking data. Runs at 00:00 UTC daily."""
    logger.info("Running news cleanup...")

    try:
        async with aiohttp.ClientSession() as http_session:
            news_service = NewsService(session=http_session)

            async with async_session_maker() as db:
                await news_service.cleanup_old_items(db)
                logger.info("News cleanup completed")

    except Exception as e:
        logger.error(f"Error in news cleanup: {e}", exc_info=True)


async def run_all_news_checks():
    """Run all news checks at once (for manual trigger)."""
    logger.info("Running all news checks...")

    await run_vndb_news_check()
    await run_vndb_releases_check()
    await run_rss_check()
    await run_twitter_check()

    logger.info("All news checks completed")


async def run_news_catch_up():
    """Check if today's news was fetched, catch up if missing.

    Only catches up for the current day to prevent spam.
    Runs periodically and on startup.
    """
    logger.info("Running news catch-up check for today...")

    try:
        async with aiohttp.ClientSession() as http_session:
            news_service = NewsService(session=http_session)

            async with async_session_maker() as db:
                results = await news_service.check_and_catch_up_today(db)

                total = sum(results.values())
                if total > 0:
                    logger.info(f"News catch-up completed: {results}")
                else:
                    logger.debug("News catch-up: today's news already fetched")

    except Exception as e:
        logger.error(f"Error in news catch-up: {e}", exc_info=True)
