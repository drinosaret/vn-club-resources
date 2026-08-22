"""Aggregations behind the global stats dashboard.

Kept out of stats_service, which is already large enough that finding anything in it is a
chore. New global-scale queries belong here.

Everything reads visual_novels and nothing else. That table is ~60K rows, so each query
below is a single scan measured in tens of milliseconds, cheap enough to answer at request
time behind the usual cache. Anything that needed the vote or list tables would not be, and
lives in the leaderboard job instead.
"""

from __future__ import annotations

import logging

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.cache import get_cache

logger = logging.getLogger(__name__)

CACHE_TTL_SECONDS = 3600

#: VNDB has entries dated well before the medium existed, mostly placeholders and data
#: errors. Charting from them stretches every axis to no purpose.
EARLIEST_YEAR = 1980

#: Announced-but-unreleased titles carry dates years ahead, so an uncapped release timeline
#: trails off into years holding one or two entries and squeezes the years that matter. Each
#: query below bounds the upper end against the current year rather than a constant, so it
#: stays correct without maintenance.

#: Languages given their own series. The rest are pooled, because a chart with dozens of
#: bands communicates less than one with a handful.
TRACKED_LANGUAGES = ("ja", "en", "zh-Hans", "zh-Hant", "ko", "ru", "es", "de")

#: Platforms worth a series of their own, chosen to span the medium's history rather than
#: to be the largest today.
TRACKED_PLATFORMS = ("win", "p98", "p88", "psp", "ps2", "ps4", "swi", "and", "ios", "lin", "mac")

TOP_ENTRIES = 20


async def get_release_timeline(db: AsyncSession) -> dict:
    """How the database's output changed over time.

    Four series, all from one table: releases per year split by original language, the
    platform mix, the median length, and the average rating by release year. Together they
    answer what the medium looked like in a given year, which the existing per-year count
    alone cannot.
    """
    cache = get_cache()
    cached = await cache.get("global:timeline:v1")
    if cached:
        return cached

    by_language = await db.execute(
        text("""
            SELECT EXTRACT(YEAR FROM released)::int AS year,
                   COALESCE(olang, 'unknown') AS language,
                   count(*) AS count
            FROM visual_novels
            WHERE released IS NOT NULL
              AND EXTRACT(YEAR FROM released) >= :earliest
              AND EXTRACT(YEAR FROM released) <= EXTRACT(YEAR FROM CURRENT_DATE)
            GROUP BY 1, 2
            ORDER BY 1
        """),
        {"earliest": EARLIEST_YEAR},
    )

    # Anything outside the tracked set is pooled rather than dropped, so the per-year
    # totals still add up to the real count.
    language_series: dict[int, dict[str, int]] = {}
    for row in by_language:
        bucket = row.language if row.language in TRACKED_LANGUAGES else "other"
        year = language_series.setdefault(row.year, {})
        year[bucket] = year.get(bucket, 0) + row.count

    by_platform = await db.execute(
        text("""
            SELECT EXTRACT(YEAR FROM released)::int AS year,
                   platform,
                   count(*) AS count
            FROM visual_novels, unnest(platforms) AS platform
            WHERE released IS NOT NULL
              AND EXTRACT(YEAR FROM released) >= :earliest
              AND EXTRACT(YEAR FROM released) <= EXTRACT(YEAR FROM CURRENT_DATE)
            GROUP BY 1, 2
            ORDER BY 1
        """),
        {"earliest": EARLIEST_YEAR},
    )

    platform_series: dict[int, dict[str, int]] = {}
    for row in by_platform:
        bucket = row.platform if row.platform in TRACKED_PLATFORMS else "other"
        year = platform_series.setdefault(row.year, {})
        year[bucket] = year.get(bucket, 0) + row.count

    # Median rather than mean: a handful of enormous outliers drag a mean upward and make
    # every year look longer than the titles actually released in it.
    lengths = await db.execute(
        text("""
            SELECT EXTRACT(YEAR FROM released)::int AS year,
                   percentile_cont(0.5) WITHIN GROUP (ORDER BY length_minutes) AS median_minutes,
                   count(*) AS count
            FROM visual_novels
            WHERE released IS NOT NULL
              AND length_minutes IS NOT NULL
              AND length_minutes > 0
              AND EXTRACT(YEAR FROM released) >= :earliest
              AND EXTRACT(YEAR FROM released) <= EXTRACT(YEAR FROM CURRENT_DATE)
            GROUP BY 1
            HAVING count(*) >= 5
            ORDER BY 1
        """),
        {"earliest": EARLIEST_YEAR},
    )

    ratings = await db.execute(
        text("""
            SELECT EXTRACT(YEAR FROM released)::int AS year,
                   avg(rating) AS average,
                   count(*) AS count
            FROM visual_novels
            WHERE released IS NOT NULL
              AND rating IS NOT NULL
              AND votecount >= 10
              AND EXTRACT(YEAR FROM released) >= :earliest
              AND EXTRACT(YEAR FROM released) <= EXTRACT(YEAR FROM CURRENT_DATE)
            GROUP BY 1
            HAVING count(*) >= 5
            ORDER BY 1
        """),
        {"earliest": EARLIEST_YEAR},
    )

    result = {
        "languages": TRACKED_LANGUAGES,
        "platforms": TRACKED_PLATFORMS,
        "by_language": [
            {"year": year, **counts} for year, counts in sorted(language_series.items())
        ],
        "by_platform": [
            {"year": year, **counts} for year, counts in sorted(platform_series.items())
        ],
        "median_length": [
            {"year": r.year, "median_minutes": round(float(r.median_minutes)), "count": r.count}
            for r in lengths
        ],
        "average_rating": [
            {"year": r.year, "average": round(float(r.average), 3), "count": r.count}
            for r in ratings
        ],
    }

    await cache.set("global:timeline:v1", result, ttl=CACHE_TTL_SECONDS)
    return result


async def get_database_growth(db: AsyncSession, japanese_only: bool = False) -> dict:
    """When the database itself was built, and where the effort went.

    Distinct from release dates: this is when entries were catalogued and edited, not when
    the games came out. A 2003 title cataloged in 2019 contributes to 2003 in the release
    timeline and to 2019 here.

    `japanese_only` narrows the two title lists and nothing else. The growth curve and the
    totals describe the catalogue as a whole, and filtering them by original language would
    answer a different question than the one the section asks.

    Everything below depends on the entry_meta columns; before the first import that
    populates them the response is empty rather than wrong.
    """
    cache = get_cache()
    key = "global:database:v1:ja" if japanese_only else "global:database:v1"
    cached = await cache.get(key)
    if cached:
        return cached

    language_filter = "AND olang = 'ja'" if japanese_only else ""

    growth = await db.execute(
        text("""
            SELECT to_char(date_trunc('month', entry_created), 'YYYY-MM') AS month,
                   count(*) AS count
            FROM visual_novels
            WHERE entry_created IS NOT NULL
            GROUP BY 1
            ORDER BY 1
        """)
    )
    growth_rows = [{"month": r.month, "count": r.count} for r in growth]

    edited = await db.execute(
        text(f"""
            SELECT id, title, title_jp, title_romaji,
                   entry_num_edits, entry_num_users, entry_lastmod
            FROM visual_novels
            WHERE entry_num_edits IS NOT NULL
            {language_filter}
            ORDER BY entry_num_edits DESC, id
            LIMIT :limit
        """),
        {"limit": TOP_ENTRIES},
    )

    recent = await db.execute(
        text(f"""
            SELECT id, title, title_jp, title_romaji,
                   image_url, image_sexual, entry_lastmod
            FROM visual_novels
            WHERE entry_lastmod IS NOT NULL
            {language_filter}
            ORDER BY entry_lastmod DESC, id
            LIMIT :limit
        """),
        {"limit": TOP_ENTRIES},
    )

    totals = await db.execute(
        text("""
            SELECT count(*) FILTER (WHERE entry_created IS NOT NULL) AS dated,
                   min(entry_created) AS first_entry,
                   sum(entry_num_edits) AS total_edits,
                   avg(entry_num_edits) AS mean_edits
            FROM visual_novels
        """)
    )
    summary = totals.first()

    result = {
        "growth": growth_rows,
        "most_edited": [
            {
                "id": r.id,
                "title": r.title,
                "title_jp": r.title_jp,
                "title_romaji": r.title_romaji,
                "edits": r.entry_num_edits,
                "editors": r.entry_num_users,
                "last_edited": r.entry_lastmod.isoformat() if r.entry_lastmod else None,
            }
            for r in edited
        ],
        "recently_updated": [
            {
                "id": r.id,
                "title": r.title,
                "title_jp": r.title_jp,
                "title_romaji": r.title_romaji,
                "image_url": r.image_url,
                "image_sexual": r.image_sexual,
                "last_edited": r.entry_lastmod.isoformat() if r.entry_lastmod else None,
            }
            for r in recent
        ],
        "summary": {
            "entries_with_dates": summary.dated if summary else 0,
            "first_entry": summary.first_entry.isoformat()
            if summary and summary.first_entry
            else None,
            "total_edits": int(summary.total_edits) if summary and summary.total_edits else 0,
            "mean_edits": round(float(summary.mean_edits), 1)
            if summary and summary.mean_edits
            else 0.0,
        },
    }

    await cache.set(key, result, ttl=CACHE_TTL_SECONDS)
    return result
