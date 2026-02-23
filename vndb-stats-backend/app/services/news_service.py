"""News aggregation service - ports logic from Discord bot.

============================================================================
NOTE ON VNDB API USAGE
============================================================================
This service is a LEGITIMATE use case for the VNDB API. Unlike other parts
of the codebase that should use local database dumps, the news service needs
real-time information about:
- Newly added VN entries (which may not be in the daily dumps yet)
- Today's/tomorrow's releases (needs current release dates)

The VNDB API is appropriate here because we're fetching LATEST updates,
not historical data that's already available in dumps.
============================================================================
"""

import asyncio
import hashlib
import html
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from urllib.parse import urlparse

import aiohttp
import feedparser
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import NewsItem, PostedItemsTracker, RSSFeedConfig, Announcement

logger = logging.getLogger(__name__)


class NewsService:
    """News aggregation service ported from VNCRbot."""

    # Constants from Discord bot
    MAX_NEW_VNS_PER_CHECK = 5
    MAX_RSS_ENTRIES_PER_FEED = 3
    MAX_TWEETS_PER_CHECK = 3
    RSS_MAX_AGE_DAYS = 7
    POSTED_IDS_RETENTION_DAYS = 90
    VNDB_FETCH_LIMIT = 50
    NSFW_SEXUAL_THRESHOLD = 0.99

    # VNDB API endpoints - used for fetching LATEST news (new VNs, releases)
    # This is a legitimate API use case since we need real-time data
    VNDB_VN_API = "https://api.vndb.org/kana/vn"
    VNDB_RELEASE_API = "https://api.vndb.org/kana/release"

    # Default RSS feeds for Japanese VN news
    DEFAULT_RSS_FEEDS = [
        {
            "name": "4Gamer VN News",
            "url": "https://www.4gamer.net/rss/index.xml",
            "keywords": ["ビジュアルノベル", "ギャルゲ", "エロゲ", "美少女ゲーム", "ノベルゲーム"],
            "exclude_keywords": ["アクション", "アクションアドベンチャー", "FPS", "TPS", "格闘", "シューティング", "レース"]
        },
        {
            "name": "Automaton VN News",
            "url": "https://automaton-media.com/feed/",
            "keywords": ["ビジュアルノベル", "ギャルゲ", "エロゲ", "美少女ゲーム", "ノベルゲーム", "アダルトゲーム", "18禁", "乙女ゲーム", "BLゲーム"],
            "exclude_keywords": ["アクション", "アクションアドベンチャー", "FPS", "TPS", "格闘", "シューティング", "レース", "RPG", "MMORPG", "ストラテジー", "シミュレーション", "スポーツ", "パズル"]
        },
        {
            "name": "Game Watch VN News",
            "url": "https://game.watch.impress.co.jp/data/rss/1.0/gmw/feed.rdf",
            "keywords": ["ビジュアルノベル", "ギャルゲ", "エロゲ", "美少女ゲーム", "ノベルゲーム", "アダルトゲーム", "18禁", "乙女ゲーム"],
            "exclude_keywords": ["アクション", "アクションアドベンチャー", "FPS", "TPS", "格闘", "シューティング", "レース", "RPG", "MMORPG", "ストラテジー", "シミュレーション", "スポーツ", "パズル", "ホラー"]
        },
        {
            "name": "Moepedia",
            "url": "https://moepedia.net/feed/",
            "keywords": [],
            "exclude_keywords": []
        },
        {
            "name": "iNSIDE VN News",
            "url": "https://www.inside-games.jp/rss/index.rdf",
            "keywords": ["ビジュアルノベル", "ギャルゲ", "エロゲ", "美少女ゲーム", "ノベルゲーム", "乙女ゲーム", "BLゲーム", "恋愛アドベンチャー", "アダルトゲーム"],
            "exclude_keywords": ["アクション", "アクションアドベンチャー", "FPS", "TPS", "格闘", "シューティング", "レース", "RPG", "MMORPG", "ストラテジー", "シミュレーション", "スポーツ", "パズル"]
        },
        {
            "name": "Denfaminicogamer VN News",
            "url": "https://news.denfaminicogamer.jp/feed",
            "keywords": ["ビジュアルノベル", "ギャルゲ", "エロゲ", "美少女ゲーム", "ノベルゲーム", "乙女ゲーム", "BLゲーム", "恋愛アドベンチャー", "アダルトゲーム", "18禁"],
            "exclude_keywords": ["アクション", "アクションアドベンチャー", "FPS", "TPS", "格闘", "シューティング", "レース", "RPG", "MMORPG", "ストラテジー", "シミュレーション", "スポーツ", "パズル", "ホラー"]
        },
        {
            "name": "Ima-ero",
            "url": "https://www.ima-ero.com/feed/",
            "keywords": [],
            "exclude_keywords": []
        }
    ]

    # Twitter accounts to monitor
    TWITTER_ACCOUNTS = [
        {
            "username": "ErogeAreAlive",
            "exclude_phrases": ["[Official TL]", "[Fan TL]", "english", "tl", "translation", "translate"],
            "include_phrases": [],
            "exclude_images": False
        },
        {
            "username": "moeaward",
            "exclude_phrases": [],
            "include_phrases": [],
            "exclude_images": True
        },
        {
            "username": "bugbug_info",
            "exclude_phrases": [],
            "include_phrases": ["https://www.bugbug.news/b_game/"],
            "exclude_images": True
        },
        {
            "username": "cybernhmksk",
            "exclude_phrases": [],
            "include_phrases": ["fanza.co.jp", "dlaf.jp"],
            "exclude_images": True
        },
        {
            "username": "Moepedia_net",
            "exclude_phrases": [],
            "include_phrases": [],
            "exclude_images": True
        },
        {
            "username": "getchucom",
            "exclude_phrases": [],
            "include_phrases": ["美少女ゲーム", "PCゲーム", "発売", "予約"],
            "exclude_images": True
        }
    ]

    def __init__(self, session: aiohttp.ClientSession | None = None):
        self.session = session
        self._owns_session = False

    async def __aenter__(self):
        if self.session is None:
            self.session = aiohttp.ClientSession()
            self._owns_session = True
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self._owns_session and self.session:
            await self.session.close()

    # ==================== Duplicate Tracking ====================

    async def is_duplicate(self, db: AsyncSession, source: str, item_id: str) -> bool:
        """Check if an item has already been posted."""
        result = await db.execute(
            select(PostedItemsTracker).where(
                PostedItemsTracker.source == source,
                PostedItemsTracker.item_id == item_id
            )
        )
        return result.scalar_one_or_none() is not None

    async def mark_as_posted(self, db: AsyncSession, source: str, item_id: str):
        """Mark an item as posted."""
        tracker = PostedItemsTracker(
            source=source,
            item_id=item_id,
            posted_at=datetime.now(timezone.utc)
        )
        db.add(tracker)

    async def cleanup_old_items(self, db: AsyncSession):
        """Remove items older than retention period."""
        cutoff = datetime.now(timezone.utc) - timedelta(days=self.POSTED_IDS_RETENTION_DAYS)
        await db.execute(
            delete(PostedItemsTracker).where(PostedItemsTracker.posted_at < cutoff)
        )
        await db.execute(
            delete(NewsItem).where(NewsItem.published_at < cutoff)
        )
        await db.commit()
        logger.info(f"Cleaned up items older than {cutoff}")

    # ==================== Catch-Up for Missing News ====================

    async def check_and_catch_up_today(self, db: AsyncSession) -> dict[str, int]:
        """Check if today's VNDB news was fetched, and fetch if missing.

        Only fetches if:
        - It's past the scheduled fetch time for that source
        - No news items exist for today from that source

        Returns dict mapping source to count of items fetched.
        """
        now = datetime.now(timezone.utc)
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        today_str = now.strftime("%Y-%m-%d")

        results = {"vndb": 0, "vndb_release": 0}

        # VNDB New VNs - scheduled at 10:00 UTC
        if now.hour >= 10:
            has_vndb_today = await db.scalar(
                select(func.count())
                .select_from(NewsItem)
                .where(NewsItem.source == "vndb")
                .where(NewsItem.published_at >= today_start)
            )
            if not has_vndb_today:
                logger.info(f"Catch-up: No VNDB new VNs for today ({today_str}), fetching...")
                new_vns = await self.fetch_vndb_new_vns(db)
                if new_vns:
                    results["vndb"] = await self.save_vndb_new_vns(db, new_vns)

        # VNDB Releases - scheduled at 16:00 UTC
        if now.hour >= 16:
            has_releases_today = await db.scalar(
                select(func.count())
                .select_from(NewsItem)
                .where(NewsItem.source == "vndb_release")
                .where(NewsItem.published_at >= today_start)
            )
            if not has_releases_today:
                logger.info(f"Catch-up: No VNDB releases for today ({today_str}), fetching...")
                releases = await self.fetch_vndb_releases(db)
                if releases:
                    results["vndb_release"] = await self.save_vndb_releases(db, releases)

        return results

    # ==================== VNDB New VNs ====================

    async def fetch_vndb_new_vns(self, db: AsyncSession) -> list[dict[str, Any]]:
        """Fetch newly added VN entries from VNDB database."""
        try:
            # Hard daily cap: check how many VNDB items already exist for today
            today_start = datetime.now(timezone.utc).replace(
                hour=0, minute=0, second=0, microsecond=0
            )
            existing_today = await db.scalar(
                select(func.count())
                .select_from(NewsItem)
                .where(NewsItem.source == "vndb")
                .where(NewsItem.published_at >= today_start)
            ) or 0
            remaining = self.MAX_NEW_VNS_PER_CHECK - existing_today
            if remaining <= 0:
                logger.info(
                    f"Already have {existing_today} VNDB items today "
                    f"(limit {self.MAX_NEW_VNS_PER_CHECK}), skipping fetch"
                )
                return []

            query = {
                "filters": ["olang", "=", "ja"],
                "fields": "id,title,alttitle,description,released,languages,platforms,image.url,image.sexual,image.violence,developers.name,tags.name,tags.rating,tags.category",
                "sort": "id",
                "reverse": True,
                "results": self.VNDB_FETCH_LIMIT,
                "page": 1
            }

            headers = {"Content-Type": "application/json"}

            async with self.session.post(self.VNDB_VN_API, json=query, headers=headers) as resp:
                if resp.status != 200:
                    logger.error(f"VNDB API error: {resp.status}")
                    return []

                data = await resp.json()
                vns = data.get("results", [])

                # Filter out already posted VNs, respect daily cap
                new_vns = []
                for vn in vns:
                    vn_id = vn.get("id")
                    if not await self.is_duplicate(db, "vndb", vn_id):
                        new_vns.append(vn)
                    if len(new_vns) >= remaining:
                        break

                # Process VNs: check cover NSFW status
                processed_vns = []
                for vn in new_vns:
                    image_data = vn.get("image")
                    cover_is_nsfw = False
                    cover_url = None

                    if image_data:
                        sexual_value = image_data.get("sexual")
                        cover_url = image_data.get("url")
                        if sexual_value is not None and sexual_value >= self.NSFW_SEXUAL_THRESHOLD:
                            cover_is_nsfw = True

                    vn["cover_is_nsfw"] = cover_is_nsfw
                    vn["cover_url"] = cover_url
                    processed_vns.append(vn)

                logger.info(f"Found {len(processed_vns)} new Japanese VN entries")
                return processed_vns

        except Exception as e:
            logger.error(f"Error fetching new VNDB VNs: {e}", exc_info=True)
            return []

    async def save_vndb_new_vns(self, db: AsyncSession, vns: list[dict[str, Any]]) -> int:
        """Save newly fetched VNs to database as news items."""
        saved = 0
        for vn in vns:
            vn_id = vn.get("id")

            # Build developers list
            developers = [d.get("name") for d in vn.get("developers", []) if d.get("name")]

            # Build summary from description
            description = vn.get("description") or ""
            summary = self._clean_html(description)[:500]

            # Extract top content tags (excluding sexual/ero tags)
            vn_tags = vn.get("tags", []) or []
            top_tags = self._get_content_tags(vn_tags, limit=5)

            news_item = NewsItem(
                id=f"vndb-{vn_id}",
                source="vndb",
                source_label="Recently Added to VNDB",
                title=vn.get("title") or vn.get("alttitle") or "Unknown",
                summary=summary,
                url=f"https://vndb.org/{vn_id}",
                image_url=vn.get("cover_url"),
                image_is_nsfw=vn.get("cover_is_nsfw", False),
                published_at=datetime.now(timezone.utc),
                fetched_at=datetime.now(timezone.utc),
                tags=top_tags if top_tags else None,
                extra_data={
                    "vn_id": vn_id,
                    "alttitle": vn.get("alttitle"),
                    "developers": developers,
                    "platforms": vn.get("platforms", []),
                    "languages": vn.get("languages", []),
                    "released": vn.get("released"),
                }
            )

            db.add(news_item)
            await self.mark_as_posted(db, "vndb", vn_id)
            saved += 1

        await db.commit()
        logger.info(f"Saved {saved} new VNDB VN news items")
        return saved

    # ==================== VNDB Releases ====================

    async def fetch_vndb_releases(self, db: AsyncSession) -> dict[str, list[dict[str, Any]]]:
        """Fetch VN releases from VNDB for today and tomorrow."""
        try:
            today = datetime.now(timezone.utc)
            tomorrow = today + timedelta(days=1)

            today_str = today.strftime("%Y-%m-%d")
            tomorrow_str = tomorrow.strftime("%Y-%m-%d")

            results = {"today": [], "tomorrow": []}

            for day_key, date_str in [("today", today_str), ("tomorrow", tomorrow_str)]:
                query = {
                    "filters": ["and",
                        ["released", "=", date_str],
                        ["vn", "=", ["olang", "=", "ja"]],
                        ["lang", "=", "ja"]
                    ],
                    "fields": "id,title,alttitle,released,minage,platforms,vns.id,vns.title,vns.alttitle,vns.developers.name,vns.image.url,vns.image.sexual,vns.tags.name,vns.tags.rating,vns.tags.category",
                    "sort": "released",
                    "reverse": False,
                    "results": 100,
                    "page": 1
                }

                headers = {"Content-Type": "application/json"}

                async with self.session.post(self.VNDB_RELEASE_API, json=query, headers=headers) as resp:
                    if resp.status != 200:
                        logger.error(f"VNDB Release API error: {resp.status}")
                        continue

                    data = await resp.json()
                    releases = data.get("results", [])

                    # Group releases by VN
                    vn_groups: dict[str, dict[str, Any]] = {}
                    for release in releases:
                        vns = release.get("vns", [])
                        if not vns:
                            continue
                        vn_data = vns[0]
                        vn_id = vn_data.get("id")
                        if not vn_id:
                            continue

                        if vn_id not in vn_groups:
                            image_data = vn_data.get("image")
                            cover_is_nsfw = False
                            cover_url = None
                            if image_data:
                                sexual_value = image_data.get("sexual")
                                cover_url = image_data.get("url")
                                if sexual_value is not None and sexual_value >= self.NSFW_SEXUAL_THRESHOLD:
                                    cover_is_nsfw = True

                            # Extract content tags (excluding sexual/ero tags)
                            vn_tags = vn_data.get("tags", []) or []
                            content_tags = self._get_content_tags(vn_tags, limit=5)

                            vn_groups[vn_id] = {
                                "vn_id": vn_id,
                                "title": vn_data.get("title") or vn_data.get("alttitle") or release.get("title"),
                                "alttitle": vn_data.get("alttitle"),
                                "cover_url": cover_url,
                                "cover_is_nsfw": cover_is_nsfw,
                                "developers": [d.get("name") for d in vn_data.get("developers", []) if d.get("name")],
                                "vn_tags": content_tags,
                                "releases": [],
                                "platforms": set()
                            }

                        vn_groups[vn_id]["releases"].append({
                            "id": release.get("id"),
                            "title": release.get("title"),
                            "alttitle": release.get("alttitle"),
                            "platforms": release.get("platforms", [])
                        })
                        for platform in release.get("platforms", []):
                            vn_groups[vn_id]["platforms"].add(platform)

                    # Convert sets to lists for JSON serialization
                    for vn_data in vn_groups.values():
                        vn_data["platforms"] = list(vn_data["platforms"])
                    results[day_key] = list(vn_groups.values())

            logger.info(f"Found {len(results['today'])} releases today, {len(results['tomorrow'])} tomorrow")
            return results

        except Exception as e:
            logger.error(f"Error fetching VNDB releases: {e}", exc_info=True)
            return {"today": [], "tomorrow": []}

    async def save_vndb_releases(self, db: AsyncSession, releases: dict[str, list[dict[str, Any]]]) -> int:
        """Save individual release items per VN (for proper digest grouping)."""
        today = datetime.now(timezone.utc)
        saved = 0

        # Process today's releases
        for vn_data in releases.get("today", []):
            vn_id = vn_data.get("vn_id")
            if not vn_id:
                continue

            # Create unique ID per VN per day
            date_str = today.strftime("%Y-%m-%d")
            item_id = f"vndb_release-{vn_id}-{date_str}"

            # Check if already posted
            if await self.is_duplicate(db, "vndb_release", item_id):
                continue

            # Build release info for summary
            release_list = vn_data.get("releases", [])
            platforms = vn_data.get("platforms", [])
            platform_str = ", ".join(platforms[:3]) if platforms else ""

            # Build summary showing release editions
            release_titles = [r.get("title", "") for r in release_list[:3]]
            summary = " | ".join(release_titles) if release_titles else f"Released on {platform_str}"

            news_item = NewsItem(
                id=item_id,
                source="vndb_release",
                source_label="VN Releases",
                title=vn_data.get("title") or "Unknown",
                summary=summary[:500],
                url=f"https://vndb.org/{vn_id}",
                image_url=vn_data.get("cover_url"),
                image_is_nsfw=vn_data.get("cover_is_nsfw", False),
                published_at=today,
                fetched_at=today,
                tags=platforms[:5] if platforms else None,
                extra_data={
                    "vn_id": vn_id,
                    "alttitle": vn_data.get("alttitle"),
                    "developers": vn_data.get("developers", []),
                    "platforms": platforms,
                    "releases": release_list,
                    "released": date_str,
                    "vn_tags": vn_data.get("vn_tags", []),
                }
            )

            db.add(news_item)
            await self.mark_as_posted(db, "vndb_release", item_id)
            saved += 1

        # Process tomorrow's releases (with tomorrow's date for grouping)
        tomorrow = today + timedelta(days=1)
        for vn_data in releases.get("tomorrow", []):
            vn_id = vn_data.get("vn_id")
            if not vn_id:
                continue

            date_str = tomorrow.strftime("%Y-%m-%d")
            item_id = f"vndb_release-{vn_id}-{date_str}"

            if await self.is_duplicate(db, "vndb_release", item_id):
                continue

            release_list = vn_data.get("releases", [])
            platforms = vn_data.get("platforms", [])
            platform_str = ", ".join(platforms[:3]) if platforms else ""

            release_titles = [r.get("title", "") for r in release_list[:3]]
            summary = " | ".join(release_titles) if release_titles else f"Released on {platform_str}"

            news_item = NewsItem(
                id=item_id,
                source="vndb_release",
                source_label="VN Releases",
                title=vn_data.get("title") or "Unknown",
                summary=summary[:500],
                url=f"https://vndb.org/{vn_id}",
                image_url=vn_data.get("cover_url"),
                image_is_nsfw=vn_data.get("cover_is_nsfw", False),
                published_at=tomorrow,  # Use tomorrow's date for proper grouping
                fetched_at=today,
                tags=platforms[:5] if platforms else None,
                extra_data={
                    "vn_id": vn_id,
                    "alttitle": vn_data.get("alttitle"),
                    "developers": vn_data.get("developers", []),
                    "platforms": platforms,
                    "releases": release_list,
                    "released": date_str,
                    "vn_tags": vn_data.get("vn_tags", []),
                }
            )

            db.add(news_item)
            await self.mark_as_posted(db, "vndb_release", item_id)
            saved += 1

        if saved:
            await db.commit()
        logger.info(f"Saved {saved} VNDB release news items")
        return saved

    # ==================== RSS Feeds ====================

    async def get_rss_configs(self, db: AsyncSession) -> list[RSSFeedConfig]:
        """Get all active RSS feed configurations."""
        result = await db.execute(
            select(RSSFeedConfig).where(RSSFeedConfig.is_active == True)
        )
        configs = result.scalars().all()

        # If no configs in DB, return defaults
        if not configs:
            return [
                RSSFeedConfig(
                    id=i,
                    name=feed["name"],
                    url=feed["url"],
                    keywords=feed.get("keywords"),
                    exclude_keywords=feed.get("exclude_keywords"),
                    is_active=True
                )
                for i, feed in enumerate(self.DEFAULT_RSS_FEEDS, 1)
            ]

        return list(configs)

    async def fetch_rss_feed(
        self,
        feed_url: str,
        keywords: list[str] | None,
        exclude_keywords: list[str] | None
    ) -> list[dict[str, Any]]:
        """Fetch and parse an RSS feed, filtering by keywords."""
        keywords = keywords or []
        exclude_keywords = exclude_keywords or []

        try:
            async with self.session.get(feed_url, timeout=aiohttp.ClientTimeout(total=30)) as response:
                if response.status != 200:
                    logger.warning(f"RSS feed returned status {response.status}: {feed_url}")
                    return []

                content = await response.text()
                feed = feedparser.parse(content)

                if not feed.entries:
                    return []

                filtered_entries = []

                for entry in feed.entries:
                    title = entry.get('title', '')
                    description = entry.get('description', '') or entry.get('summary', '')
                    content_text = title + ' ' + description

                    # Filter by keywords if specified
                    if keywords:
                        if not any(keyword.lower() in content_text.lower() for keyword in keywords):
                            continue

                    # Exclude by keywords
                    if exclude_keywords:
                        if any(keyword.lower() in content_text.lower() for keyword in exclude_keywords):
                            continue

                    # Get entry ID
                    entry_id = entry.get('id') or entry.get('link') or entry.get('guid', '')
                    if not entry_id:
                        continue

                    # Parse publication date
                    published = entry.get('published') or entry.get('updated')
                    pub_date = None
                    if published:
                        try:
                            from dateutil import parser as date_parser
                            pub_date = date_parser.parse(published)
                            if pub_date.tzinfo is None:
                                pub_date = pub_date.replace(tzinfo=timezone.utc)
                        except Exception:
                            pass

                    # Only include entries from the last N days
                    if pub_date:
                        age = datetime.now(timezone.utc) - pub_date
                        if age.days > self.RSS_MAX_AGE_DAYS:
                            continue

                    filtered_entries.append({
                        'id': entry_id,
                        'title': self._clean_html(title),
                        'link': entry.get('link', ''),
                        'description': self._clean_html(description)[:500],
                        'published': pub_date,
                        'thumbnail': None
                    })

                # Fetch thumbnails in parallel
                if filtered_entries:
                    await self._fetch_thumbnails_for_entries(filtered_entries)

                # Sort by publication date (newest first)
                filtered_entries.sort(
                    key=lambda x: x['published'] or datetime.min.replace(tzinfo=timezone.utc),
                    reverse=True
                )

                return filtered_entries[:self.MAX_RSS_ENTRIES_PER_FEED]

        except Exception as e:
            logger.error(f"Error fetching RSS feed {feed_url}: {e}", exc_info=True)
            return []

    async def _fetch_thumbnails_for_entries(self, entries: list[dict[str, Any]]):
        """Fetch Open Graph images from article pages in parallel."""
        tasks = []
        for entry in entries:
            if entry.get('link'):
                tasks.append(self._extract_og_image(entry['link']))

        if tasks:
            thumbnails = await asyncio.gather(*tasks, return_exceptions=True)
            for entry, thumbnail in zip(entries, thumbnails):
                if isinstance(thumbnail, str):
                    entry['thumbnail'] = thumbnail

    async def _extract_og_image(self, url: str) -> str | None:
        """Extract Open Graph image from a webpage."""
        try:
            async with self.session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as response:
                if response.status != 200:
                    return None

                # Detect encoding
                encoding = None
                content_type = response.headers.get('Content-Type', '')
                if 'charset=' in content_type:
                    encoding = content_type.split('charset=')[-1].split(';')[0].strip()

                try:
                    html_content = await response.text(encoding=encoding or 'utf-8')
                except (UnicodeDecodeError, LookupError):
                    try:
                        html_content = await response.text(encoding='euc-jp')
                    except (UnicodeDecodeError, LookupError):
                        html_content = await response.text(encoding='shift_jis', errors='ignore')

                # Extract Open Graph image
                og_image = re.search(r'<meta property="og:image" content="([^"]+)"', html_content)
                if og_image:
                    image_url = og_image.group(1)
                    if image_url.startswith('/'):
                        parsed = urlparse(url)
                        image_url = f"{parsed.scheme}://{parsed.netloc}{image_url}"
                    return image_url

                # Fallback: twitter:image
                twitter_image = re.search(r'<meta name="twitter:image" content="([^"]+)"', html_content)
                if twitter_image:
                    image_url = twitter_image.group(1)
                    if image_url.startswith('/'):
                        parsed = urlparse(url)
                        image_url = f"{parsed.scheme}://{parsed.netloc}{image_url}"
                    return image_url

                return None

        except Exception as e:
            logger.debug(f"Error extracting OG image from {url}: {e}")
            return None

    async def save_rss_entries(
        self,
        db: AsyncSession,
        entries: list[dict[str, Any]],
        feed_name: str
    ) -> int:
        """Save RSS entries as news items."""
        saved = 0
        for entry in entries:
            entry_id = entry['id']
            entry_hash = hashlib.md5(entry_id.encode()).hexdigest()[:16]

            # Check if already posted
            if await self.is_duplicate(db, "rss", entry_hash):
                continue

            news_item = NewsItem(
                id=f"rss-{entry_hash}",
                source="rss",
                source_label=feed_name,
                title=entry['title'][:500],
                summary=entry['description'],
                url=entry['link'],
                image_url=entry.get('thumbnail'),
                image_is_nsfw=False,
                published_at=entry['published'] or datetime.now(timezone.utc),
                fetched_at=datetime.now(timezone.utc),
                tags=["news"],
                extra_data={
                    "feed_name": feed_name,
                    "original_id": entry_id
                }
            )

            db.add(news_item)
            await self.mark_as_posted(db, "rss", entry_hash)
            saved += 1

        if saved:
            await db.commit()
        logger.info(f"Saved {saved} RSS entries from {feed_name}")
        return saved

    # ==================== Twitter ====================

    async def fetch_user_banner(self, username: str, twitter_client: Any) -> str | None:
        """Fetch a Twitter user's profile banner image URL."""
        try:
            user = await asyncio.wait_for(
                asyncio.to_thread(twitter_client.get_user_info, username),
                timeout=15.0
            )
            if user and hasattr(user, 'profile_banner_url'):
                return user.profile_banner_url
            return None
        except Exception as e:
            logger.debug(f"Could not fetch banner for @{username}: {e}")
            return None

    async def fetch_tweets(
        self,
        username: str,
        exclude_phrases: list[str],
        include_phrases: list[str],
        twitter_client: Any
    ) -> list[dict[str, Any]]:
        """Fetch recent tweets from a Twitter user using tweety-ns."""
        try:
            # Get user's tweets
            user_tweets = await asyncio.wait_for(
                asyncio.to_thread(
                    twitter_client.get_tweets,
                    username,
                    pages=1,
                    wait_time=2
                ),
                timeout=30.0
            )

            if not user_tweets:
                return []

            filtered_tweets = []

            for tweet_obj in user_tweets:
                try:
                    # Handle SelfThread objects
                    if hasattr(tweet_obj, '__class__') and tweet_obj.__class__.__name__ == 'SelfThread':
                        if hasattr(tweet_obj, 'tweets') and tweet_obj.tweets:
                            tweet = tweet_obj.tweets[0]
                        else:
                            continue
                    else:
                        tweet = tweet_obj

                    # Skip retweets
                    if hasattr(tweet, 'is_retweet') and tweet.is_retweet:
                        continue

                    tweet_text = tweet.text if hasattr(tweet, 'text') else str(tweet)

                    if tweet_text.strip().startswith("RT @"):
                        continue

                    # Check excluded phrases
                    if exclude_phrases:
                        if any(phrase.lower() in tweet_text.lower() for phrase in exclude_phrases):
                            continue

                    # Extract URLs
                    tweet_urls = []
                    if hasattr(tweet, 'urls') and tweet.urls:
                        for url_obj in tweet.urls:
                            if hasattr(url_obj, 'expanded_url'):
                                tweet_urls.append(url_obj.expanded_url)
                            elif hasattr(url_obj, 'url'):
                                tweet_urls.append(url_obj.url)

                    # Check include phrases
                    full_content = tweet_text + " " + " ".join(tweet_urls)
                    if include_phrases:
                        if not any(phrase.lower() in full_content.lower() for phrase in include_phrases):
                            continue

                    # Extract media URL
                    media_url = None
                    if hasattr(tweet, 'media') and tweet.media:
                        media_item = tweet.media[0] if isinstance(tweet.media, list) else tweet.media
                        if hasattr(media_item, 'media_url_https'):
                            media_url = media_item.media_url_https
                        elif hasattr(media_item, 'url'):
                            media_url = media_item.url

                    created_at = tweet.created_on if hasattr(tweet, 'created_on') else None

                    # Filter by age
                    if created_at:
                        age = datetime.now(timezone.utc) - created_at.replace(tzinfo=timezone.utc)
                        if age.days > self.RSS_MAX_AGE_DAYS:
                            continue

                    filtered_tweets.append({
                        'id': str(tweet.id),
                        'text': tweet_text,
                        'created_at': created_at,
                        'url': tweet.url if hasattr(tweet, 'url') else f"https://twitter.com/{username}/status/{tweet.id}",
                        'media_url': media_url,
                        'expanded_urls': tweet_urls,
                        'username': username
                    })

                except Exception as e:
                    logger.warning(f"Error processing tweet: {e}")
                    continue

            return filtered_tweets

        except asyncio.TimeoutError:
            logger.error(f"Twitter operation timed out for @{username}")
            return []
        except Exception as e:
            logger.error(f"Error fetching tweets from @{username}: {e}", exc_info=True)
            return []

    async def save_tweets(
        self,
        db: AsyncSession,
        tweets: list[dict[str, Any]],
        exclude_images: bool = False,
        fallback_image_url: str | None = None
    ) -> int:
        """Save tweets as news items.

        Args:
            db: Database session
            tweets: List of tweet data dicts
            exclude_images: If True, don't use tweet media images
            fallback_image_url: Image to use when exclude_images=True (e.g. account banner)
        """
        saved = 0
        for tweet in tweets:
            tweet_id = tweet['id']

            if await self.is_duplicate(db, "twitter", tweet_id):
                continue

            # Clean tweet text
            tweet_text = tweet['text']
            expanded_urls = tweet.get('expanded_urls', [])

            if exclude_images:
                tweet_text = re.sub(r'https?://t\.co/\S+', '', tweet_text).strip()
                for url in expanded_urls:
                    if url not in tweet_text:
                        tweet_text += f"\n{url}"

            # Determine image URL
            image_url = None
            if exclude_images:
                # Use fallback image (account banner) for sources that exclude tweet images
                image_url = fallback_image_url
            else:
                image_url = tweet.get('media_url')

            news_item = NewsItem(
                id=f"twitter-{tweet_id}",
                source="twitter",
                source_label=f"@{tweet['username']}",
                title=tweet_text[:100] + ("..." if len(tweet_text) > 100 else ""),
                summary=tweet_text[:500],
                url=tweet['url'],
                image_url=image_url,
                image_is_nsfw=False,
                published_at=tweet['created_at'] or datetime.now(timezone.utc),
                fetched_at=datetime.now(timezone.utc),
                tags=["twitter"],
                extra_data={
                    "tweet_id": tweet_id,
                    "username": tweet['username'],
                    "expanded_urls": expanded_urls
                }
            )

            db.add(news_item)
            await self.mark_as_posted(db, "twitter", tweet_id)
            saved += 1

        if saved:
            await db.commit()
        logger.info(f"Saved {saved} tweets")
        return saved

    # ==================== Announcements ====================

    async def get_active_announcements(self, db: AsyncSession) -> list[NewsItem]:
        """Get active announcements as news items."""
        now = datetime.now(timezone.utc)
        result = await db.execute(
            select(Announcement).where(
                Announcement.is_active == True,
                (Announcement.expires_at.is_(None) | (Announcement.expires_at > now))
            )
        )
        announcements = result.scalars().all()

        news_items = []
        for ann in announcements:
            news_items.append(NewsItem(
                id=f"announcement-{ann.id}",
                source="announcement",
                source_label="Announcement",
                title=ann.title,
                summary=ann.content,
                url=ann.url,
                image_url=ann.image_url,
                image_is_nsfw=False,
                published_at=ann.published_at,
                fetched_at=ann.published_at,
                tags=["announcement"],
                extra_data={"announcement_id": ann.id}
            ))

        return news_items

    # ==================== Utilities ====================

    def _get_content_tags(self, tags: list[dict], limit: int = 5) -> list[str]:
        """Extract top content tags, filtering out sexual (ero) tags.

        VNDB tag categories: cont=content, ero=sexual, tech=technical
        """
        content_tags = [t for t in tags if t.get("category") != "ero"]
        sorted_tags = sorted(content_tags, key=lambda t: t.get("rating", 0), reverse=True)
        return [t.get("name") for t in sorted_tags[:limit] if t.get("name")]

    def _clean_html(self, text: str) -> str:
        """Remove HTML tags, VNDB BBCode, and clean up text."""
        if not text:
            return ""
        # Remove HTML tags (replace with space to preserve word boundaries)
        text = re.sub(r'<[^>]+>', ' ', text)
        # Remove VNDB BBCode: [url=...]...[/url] -> keep the link text
        text = re.sub(r'\[url=[^\]]*\]([^\[]*)\[/url\]', r'\1', text)
        # Remove other common BBCode tags: [b], [i], [spoiler], etc.
        text = re.sub(r'\[/?(?:b|i|u|s|spoiler|quote|code|raw)\]', '', text)
        # Unescape HTML entities
        text = html.unescape(text)
        # Normalize whitespace
        text = re.sub(r'\s+', ' ', text).strip()
        return text
