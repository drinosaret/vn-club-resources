"""Async HTTP client for The Movie Database (TMDB), used by Movie Night.

Auth accepts either a v4 read access token (sent as a Bearer header) or a v3
API key (sent as an api_key query param); we pick based on the token shape.
The key is read from settings and never logged.
"""

import logging

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)

BASE_URL = "https://api.themoviedb.org/3"
IMG_BASE = "https://image.tmdb.org/t/p/w500"
TIMEOUT = 15.0


class TMDBError(Exception):
    """Raised when TMDB is misconfigured or unreachable."""


def is_configured() -> bool:
    return bool(get_settings().tmdb_api_key)


def _auth() -> tuple[dict, dict]:
    """Return (headers, params) carrying credentials for the configured token."""
    key = get_settings().tmdb_api_key or ""
    # v4 read tokens are JWTs (contain dots); v3 keys are plain hex.
    if key.count(".") >= 2:
        return {"Authorization": f"Bearer {key}"}, {}
    return {}, {"api_key": key}


# Default to Japanese so the bot shows JP titles; `title` is the localized title
# for the requested language, `original_title` is always the original.
DEFAULT_LANGUAGE = "ja"


def _movie_from_result(r: dict) -> dict:
    release_date = r.get("release_date") or ""
    year = None
    if len(release_date) >= 4 and release_date[:4].isdigit():
        year = int(release_date[:4])
    poster_path = r.get("poster_path")
    return {
        "tmdb_id": r.get("id"),
        "title": r.get("title") or r.get("original_title") or "Untitled",
        "original_title": r.get("original_title") or None,
        "release_year": year,
        "poster_url": f"{IMG_BASE}{poster_path}" if poster_path else None,
        "overview": r.get("overview") or None,
    }


async def search_movies(query: str, limit: int = 25, language: str = DEFAULT_LANGUAGE) -> list[dict]:
    """Search films by title. Returns up to `limit` normalized dicts ([] on error).

    Localized to `language` (Japanese by default), so `title` is the JP title when
    a translation exists; `original_title` carries the original-language title.
    """
    if not is_configured():
        raise TMDBError("TMDB_API_KEY is not configured")
    headers, params = _auth()
    params = {**params, "query": query, "include_adult": "false", "page": 1, "language": language}
    try:
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=TIMEOUT, headers=headers) as client:
            resp = await client.get("/search/movie", params=params)
            resp.raise_for_status()
            results = resp.json().get("results", [])
            return [_movie_from_result(r) for r in results[:limit]]
    except TMDBError:
        raise
    except httpx.HTTPStatusError as e:
        # Never log the exception message: for a v3 api_key it embeds the URL + key.
        logger.warning("TMDB search failed: HTTP %s", e.response.status_code)
        return []
    except Exception as e:
        logger.warning("TMDB search failed: %s", type(e).__name__)
        return []


async def get_movie(tmdb_id: int, language: str = DEFAULT_LANGUAGE) -> dict | None:
    """Fetch a single film by id (localized to `language`), or None on error."""
    if not is_configured():
        raise TMDBError("TMDB_API_KEY is not configured")
    headers, params = _auth()
    params = {**params, "language": language}
    try:
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=TIMEOUT, headers=headers) as client:
            resp = await client.get(f"/movie/{tmdb_id}", params=params)
            resp.raise_for_status()
            return _movie_from_result(resp.json())
    except TMDBError:
        raise
    except httpx.HTTPStatusError as e:
        # Never log the exception message: for a v3 api_key it embeds the URL + key.
        logger.warning("TMDB get_movie failed: HTTP %s", e.response.status_code)
        return None
    except Exception as e:
        logger.warning("TMDB get_movie failed: %s", type(e).__name__)
        return None
