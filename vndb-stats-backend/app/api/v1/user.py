"""User lookup and management endpoints."""

from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from slowapi import Limiter
from slowapi.util import get_remote_address

from app.db.database import get_db
from app.db import schemas
from app.services.user_service import UserService

router = APIRouter()
limiter = Limiter(key_func=get_remote_address)


@router.get("/lookup", response_model=schemas.UserLookupResponse)
async def lookup_user(
    username: str = Query(..., description="VNDB username to look up"),
    db: AsyncSession = Depends(get_db),
):
    """
    Look up a VNDB user by username.

    Returns the user's UID and basic profile information.
    This is used to resolve usernames to UIDs for stats queries.
    """
    user_service = UserService(db)

    user = await user_service.lookup_user_by_username(username)
    if not user:
        raise HTTPException(
            status_code=404,
            detail=f"User '{username}' not found on VNDB"
        )

    return user


@router.get("/{vndb_uid}", response_model=schemas.UserProfileResponse)
async def get_user_profile(
    vndb_uid: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Get basic profile information for a VNDB user.

    Returns username and list visibility settings.
    """
    user_service = UserService(db)

    profile = await user_service.get_user_profile(vndb_uid)
    if not profile:
        raise HTTPException(status_code=404, detail=f"User {vndb_uid} not found")

    return profile


@router.get("/{vndb_uid}/list", response_model=schemas.UserVNListResponse)
async def get_user_vn_list(
    vndb_uid: str,
    response: Response,
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1, description="Page number (1-indexed)"),
    limit: int = Query(50, ge=1, le=2000, description="Items per page"),
    label: int | None = Query(None, description="Filter by label ID (1=Playing, 2=Finished, 3=Stalled, 4=Dropped, 5=Wishlist)"),
    sort: str = Query("vote", description="Sort by: vote, added, title, rating"),
):
    """
    Get a user's VN list with full VN metadata.

    Returns paginated list of VNs from the user's list, joined with
    visual_novels table to include titles, images, ratings, etc.

    Data comes from local database (VNDB dumps).
    """
    # Set cache headers - user-specific data
    response.headers["Cache-Control"] = "private, max-age=300"  # 5 minutes

    user_service = UserService(db)

    # Check if user exists in our database
    exists = await user_service.check_user_exists(vndb_uid)
    if not exists:
        raise HTTPException(
            status_code=404,
            detail=f"User {vndb_uid} not found in database. The user may not have a public list or hasn't been imported yet."
        )

    return await user_service.get_user_vn_list_with_metadata(
        vndb_uid,
        page=page,
        limit=limit,
        label_filter=label,
        sort=sort
    )


@router.post("/{vndb_uid}/refresh")
@limiter.limit("5/minute")
async def refresh_user_data(
    request: Request,
    vndb_uid: str,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """
    Force refresh of a user's cached data.

    Clears all caches and fetches the latest data from VNDB API.
    This includes user list, stats, and recommendations caches.
    """
    # Prevent any caching of this response
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"

    user_service = UserService(db)

    success = await user_service.refresh_user_data(vndb_uid)
    if not success:
        raise HTTPException(
            status_code=503,
            detail="Failed to refresh user data from VNDB"
        )

    return {
        "status": "refreshed",
        "uid": vndb_uid,
        "timestamp": datetime.utcnow().isoformat(),
    }
