"""Tell the site that a feed it caches has been rebuilt.

The site holds its fetch of the trend feed for a while so a render never waits
on the backend. A rebuild would otherwise reach readers only when that hold
expires, so the rebuild ends by asking the site to drop it. Best effort: a site
that is unreachable or not configured for it is left to its own timer.
"""

import logging
import os

import httpx

logger = logging.getLogger(__name__)

REVALIDATE_PATH = "/api/revalidate"
TIMEOUT_SECONDS = 10


def _settings() -> tuple[str, str]:
    """The site address and the shared secret, both from the environment.

    No default for the address: a deployment that holds a secret but names no
    site must send nothing, rather than send its secret to a site it does not
    run.
    """
    url = os.environ.get("FRONTEND_URL", "").strip().rstrip("/")
    secret = os.environ.get("BLACKLIST_REFRESH_SECRET", "")
    return url, secret


async def revalidate_site(tags: list[str]) -> bool:
    """Ask the site to drop its cached copies of the tagged fetches.

    Returns whether the site confirmed it. Without a shared secret there is no
    site to ask, and nothing is sent.
    """
    url, secret = _settings()
    if not url or not secret or not tags:
        return False
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as client:
            resp = await client.post(
                f"{url}{REVALIDATE_PATH}",
                headers={"x-refresh-token": secret},
                json={"tags": tags},
            )
    except Exception as e:  # noqa: BLE001
        logger.warning("Site revalidation not reached: %s", type(e).__name__)
        return False
    if resp.status_code != 200:
        logger.warning("Site revalidation refused: HTTP %s", resp.status_code)
        return False
    logger.info("Site revalidated: %s", ", ".join(tags))
    return True
