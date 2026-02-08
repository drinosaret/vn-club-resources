"""Admin authentication dependency for protecting sensitive endpoints."""

import hmac
import logging

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from app.config import get_settings

logger = logging.getLogger(__name__)

settings = get_settings()

# Optional bearer token scheme - won't reject missing tokens,
# allowing the dependency to return a clear 401 instead of 403.
_bearer_scheme = HTTPBearer(auto_error=False)


async def require_admin(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
) -> str:
    """
    Dependency that enforces admin API key authentication.

    Usage:
        @router.get("/admin/something")
        async def my_endpoint(admin: str = Depends(require_admin)):
            ...

    The client must send:
        Authorization: Bearer <ADMIN_API_KEY>

    Returns the validated API key on success.
    """
    if not settings.admin_api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Admin authentication not configured",
        )

    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Admin API key required",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Use constant-time comparison to prevent timing attacks
    if not hmac.compare_digest(
        credentials.credentials.encode("utf-8"),
        settings.admin_api_key.encode("utf-8"),
    ):
        client_ip = request.client.host if request.client else "unknown"
        logger.warning("Failed admin auth attempt from %s", client_ip)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid admin API key",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return credentials.credentials


async def is_admin_request(request: Request) -> bool:
    """
    Non-raising check for admin authentication.

    Returns True if the request has a valid admin API key, False otherwise.
    Use this to gate optional admin-only features (e.g. cache bypass)
    without rejecting the entire request.
    """
    if not settings.admin_api_key:
        return False

    auth_header = request.headers.get("authorization", "")
    if not auth_header.startswith("Bearer "):
        return False

    token = auth_header[7:]  # Strip "Bearer " prefix
    return hmac.compare_digest(
        token.encode("utf-8"),
        settings.admin_api_key.encode("utf-8"),
    )
