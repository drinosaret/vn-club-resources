"""
Rate-limited VNDB API client for real-time user data ONLY.

============================================================================
IMPORTANT: DATA SOURCE PRIORITY - READ THIS FIRST
============================================================================
This project has a LOCAL PostgreSQL database populated from VNDB daily dumps
containing 40k+ visual novels with complete metadata, tags, traits, staff, etc.

>>> DO NOT USE THIS CLIENT FOR: <<<
- VN metadata (titles, descriptions, ratings, images, etc.)
- Tag/trait information
- Staff/producer data
- Any bulk VN queries
- Recommendations or statistics

>>> USE THE LOCAL DATABASE INSTEAD via: <<<
- app/db/models.py (SQLAlchemy models)
- app/services/ (service layer)
- SQL queries against PostgreSQL

>>> THIS CLIENT SHOULD ONLY BE USED FOR: <<<
- Real-time user list fetching (user's current VN list from VNDB)
- User lookups by username/UID (to resolve usernames to UIDs)
- Data that MUST be current and cannot wait for daily dump updates

Architecture: VNDB Daily Dumps → PostgreSQL (PRIMARY) → Backend API → Frontend
             VNDB API (this client) → ONLY for real-time user-specific data
============================================================================
"""

import asyncio
import logging
from collections import deque
from time import time
from typing import Any

import httpx

from app.config import get_settings
from app.core.retry import RetryConfig, async_retry

logger = logging.getLogger(__name__)
settings = get_settings()


class RateLimiter:
    """Token bucket rate limiter for VNDB API."""

    def __init__(self, max_requests: int = 200, window_seconds: int = 300):
        self.max_requests = max_requests
        self.window = window_seconds
        self.requests: deque[float] = deque()
        self._lock = asyncio.Lock()

    async def acquire(self):
        """Wait until a request can be made within rate limits."""
        async with self._lock:
            while True:
                now = time()

                # Remove expired timestamps
                while self.requests and self.requests[0] < now - self.window:
                    self.requests.popleft()

                if len(self.requests) < self.max_requests:
                    # We can make a request - record it and exit
                    self.requests.append(now)
                    break

                # Need to wait - calculate sleep time
                sleep_time = self.requests[0] + self.window - now
                if sleep_time > 0:
                    logger.info(f"Rate limit reached, waiting {sleep_time:.2f}s")
                    await asyncio.sleep(sleep_time)
                # Loop back to re-check after sleeping


class VNDBClient:
    """Async client for VNDB Kana API with rate limiting."""

    def __init__(self):
        self.base_url = settings.vndb_api_url
        self.token = settings.vndb_api_token
        self.rate_limiter = RateLimiter(
            max_requests=settings.vndb_rate_limit_requests,
            window_seconds=settings.vndb_rate_limit_window,
        )
        self._client: httpx.AsyncClient | None = None

    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create HTTP client."""
        if self._client is None or self._client.is_closed:
            headers = {"Content-Type": "application/json"}
            if self.token:
                headers["Authorization"] = f"Token {self.token}"

            self._client = httpx.AsyncClient(
                base_url=self.base_url,
                headers=headers,
                timeout=30.0,
            )
        return self._client

    async def close(self):
        """Close the HTTP client."""
        if self._client and not self._client.is_closed:
            await self._client.aclose()

    async def _request(
        self,
        method: str,
        endpoint: str,
        json_data: dict | None = None,
        max_retries: int = 3,
    ) -> dict:
        """
        Make a rate-limited request to VNDB API with automatic retry.

        Retries are performed for transient errors (network issues, timeouts, 5xx).
        Non-retryable errors (4xx client errors) are raised immediately.
        """
        # Configure retry behavior
        retry_config = RetryConfig(
            max_attempts=max_retries,
            base_delay=1.0,
            max_delay=30.0,
            retryable_exceptions=(
                httpx.TimeoutException,
                httpx.NetworkError,
                ConnectionError,
                asyncio.TimeoutError,
            ),
            retryable_status_codes=(500, 502, 503, 504, 520, 521, 522, 523, 524),
        )

        @async_retry(retry_config)
        async def do_request() -> dict:
            # Rate limiting happens before each attempt
            await self.rate_limiter.acquire()
            client = await self._get_client()

            try:
                if method == "GET":
                    response = await client.get(endpoint)
                elif method == "POST":
                    response = await client.post(endpoint, json=json_data)
                else:
                    raise ValueError(f"Unsupported method: {method}")

                response.raise_for_status()
                return response.json()

            except httpx.HTTPStatusError as e:
                # Log the error (retry decorator will handle retryable ones)
                logger.warning(
                    f"VNDB API error: {e.response.status_code} - {e.response.text[:200]}"
                )
                raise

        try:
            return await do_request()
        except Exception as e:
            logger.error(f"VNDB API request failed after retries: {endpoint} - {e}")
            raise

    async def get_stats(self) -> dict:
        """Get overall VNDB statistics."""
        return await self._request("GET", "/stats")

    async def get_user(self, username: str | None = None, uid: str | None = None) -> dict | None:
        """Look up a user by username or UID."""
        params = []
        if username:
            params.append(f"q={username}")
        elif uid:
            # Use q parameter with full UID (e.g., q=u215373)
            params.append(f"q={uid}")

        query = "&".join(params)
        try:
            result = await self._request("GET", f"/user?{query}")
            if not result:
                return None
            # VNDB API returns {"u12345": {...}}, extract the user object
            if isinstance(result, dict) and len(result) > 0:
                # Get the first (and only) user object from the response
                user_data = next(iter(result.values()))
                return user_data
            return result
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                return None
            raise

    async def query_ulist(
        self,
        user_id: str,
        fields: str = "id,vote,voted,added,started,finished,lastmod,labels.id,labels.label",
        filters: list | None = None,
        results: int = 100,
        page: int = 1,
    ) -> dict:
        """
        Query a user's VN list.

        Args:
            user_id: VNDB user ID (e.g., "u12345")
            fields: Comma-separated fields to return
            filters: Filter array (e.g., ["label", "=", 7] for finished)
            results: Results per page (max 100)
            page: Page number
        """
        payload = {
            "user": user_id,
            "fields": fields,
            "results": results,
            "page": page,
        }

        if filters:
            payload["filters"] = filters

        return await self._request("POST", "/ulist", payload)

    async def get_full_user_list(
        self,
        user_id: str,
        fields: str = "id,vote,voted,added,started,finished,lastmod,labels.id,labels.label",
        max_pages: int = 100,
        timeout: float = 300.0,
    ) -> list[dict]:
        """
        Fetch complete user list with pagination.

        Uses parallel page fetching in batches for improved performance.
        Respects max_user_vns config to cap results for very large lists.

        Args:
            user_id: VNDB user ID (e.g., "u12345")
            fields: Comma-separated fields to return
            max_pages: Maximum number of pages to fetch (default 100 = 10,000 items)
            timeout: Overall timeout in seconds (default 5 minutes)

        Returns:
            List of user list entries

        Raises:
            asyncio.TimeoutError: If pagination takes longer than timeout
        """
        max_vns = settings.max_user_vns
        parallel_pages = settings.vndb_parallel_pages

        try:
            async with asyncio.timeout(timeout):
                # First, get page 1 to determine total count and if we need more pages
                first_result = await self.query_ulist(
                    user_id=user_id,
                    fields=fields,
                    results=100,
                    page=1,
                )

                all_results = first_result.get("results", [])
                logger.info(
                    f"[{user_id}] Page 1: got {len(all_results)} items, more={first_result.get('more', False)}"
                )

                # If no more results or we've hit the cap, return early
                if not first_result.get("more", False) or len(all_results) >= max_vns:
                    logger.info(f"[{user_id}] Early exit after page 1 with {len(all_results)} total items")
                    return all_results[:max_vns]

                # Fetch remaining pages in parallel batches
                page = 2
                while page <= max_pages and len(all_results) < max_vns:
                    # Determine batch size (don't exceed max_pages or fetch more than needed)
                    pages_needed = min(
                        parallel_pages,
                        max_pages - page + 1,
                        (max_vns - len(all_results) + 99) // 100,  # Rough estimate of pages needed
                    )

                    if pages_needed <= 0:
                        break

                    # Create batch of page fetch tasks
                    batch_tasks = [
                        self.query_ulist(
                            user_id=user_id,
                            fields=fields,
                            results=100,
                            page=p,
                        )
                        for p in range(page, page + pages_needed)
                    ]

                    # Fetch batch in parallel
                    batch_results = await asyncio.gather(*batch_tasks, return_exceptions=True)

                    # Process results
                    has_more = False
                    batch_items = 0
                    for i, result in enumerate(batch_results):
                        if isinstance(result, Exception):
                            logger.warning(f"[{user_id}] Failed to fetch page {page + i}: {result}")
                            continue

                        results = result.get("results", [])
                        batch_items += len(results)
                        all_results.extend(results)

                        # Track if there's more data
                        if result.get("more", False) and results:
                            has_more = True

                        # Stop if we've hit the cap
                        if len(all_results) >= max_vns:
                            break

                    logger.info(
                        f"[{user_id}] Batch pages {page}-{page + pages_needed - 1}: "
                        f"got {batch_items} items, total={len(all_results)}, has_more={has_more}"
                    )

                    page += pages_needed

                    # Exit if no more results
                    if not has_more:
                        logger.info(f"[{user_id}] No more results after page {page - 1}")
                        break

                # Apply cap and warn if list was truncated
                if len(all_results) > max_vns:
                    logger.info(
                        f"User {user_id} list truncated from {len(all_results)} to {max_vns} items"
                    )
                    all_results = all_results[:max_vns]

                if page > max_pages:
                    logger.warning(
                        f"[{user_id}] List exceeded max pages ({max_pages}), "
                        f"fetched {len(all_results)} items"
                    )

                logger.info(f"[{user_id}] Pagination complete: {len(all_results)} total items fetched")

        except asyncio.TimeoutError:
            logger.error(
                f"[{user_id}] Timeout fetching user list after {timeout}s, "
                f"got {len(all_results)} items"
            )
            raise

        return all_results

    async def query_vn(
        self,
        filters: list | None = None,
        fields: str = "id,title,rating,votecount",
        results: int = 100,
        page: int = 1,
    ) -> dict:
        """Query visual novels."""
        payload = {
            "fields": fields,
            "results": results,
            "page": page,
        }

        if filters:
            payload["filters"] = filters

        return await self._request("POST", "/vn", payload)

    async def get_vn_by_ids(
        self,
        vn_ids: list[str],
        fields: str = "id,title,rating,released,image.url,tags.rating",
    ) -> list[dict]:
        """Get VN details by IDs."""
        if not vn_ids:
            return []

        # VNDB accepts up to 100 IDs at a time
        all_results = []

        for i in range(0, len(vn_ids), 100):
            batch = vn_ids[i:i + 100]
            filters = ["or"] + [["id", "=", vid] for vid in batch]

            result = await self.query_vn(
                filters=filters,
                fields=fields,
                results=100,
            )
            all_results.extend(result.get("results", []))

        return all_results


# Singleton client instance
_client: VNDBClient | None = None


def get_vndb_client() -> VNDBClient:
    """Get the singleton VNDB client."""
    global _client
    if _client is None:
        _client = VNDBClient()
    return _client
