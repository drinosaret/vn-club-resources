"""
User data fetching service.

============================================================================
ALL USER DATA COMES FROM LOCAL DATABASE (VNDB DUMPS)
============================================================================
UserService retrieves user VN lists from the LOCAL PostgreSQL database,
which is populated daily from official VNDB database dumps.

Data sources:
- ulist_vns: User VN list entries (what VNs they have, votes, dates)
- ulist_labels: User VN list labels (Playing, Finished, Stalled, etc.)

>>> NO VNDB API CALLS FOR USER LIST DATA <<<

The only remaining API usage is:
- lookup_user_by_username(): Resolve username -> UID (for convenience)
- get_user_profile(): Get basic profile info (optional, for display)

These could also be replaced with local data if we import users table,
but they're lightweight and infrequent operations.

Data flow: VNDB Dumps -> importer.py -> ulist_vns/ulist_labels -> This Service
============================================================================
"""

import logging
from datetime import datetime
from typing import Any

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.vndb_client import get_vndb_client
from app.core.cache import get_cache
from app.db.models import UlistVN, UlistLabel, VisualNovel
from app.db.schemas import UserLookupResponse, UserProfileResponse, UserVNListResponse, UserVNListItem, UserVNListItemVN, UserVNListItemImage, UserVNListItemLabel

logger = logging.getLogger(__name__)
settings = get_settings()


class UserService:
    """Service for managing user data from local database (VNDB dumps)."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.vndb = get_vndb_client()  # Only for username lookup and profile
        self.cache = get_cache()

    async def lookup_user_by_username(self, username: str) -> UserLookupResponse | None:
        """Look up a VNDB user by username.

        This is one of the few remaining API calls - used to resolve
        usernames to UIDs for user convenience.
        """
        # Check cache first
        cache_key = f"user:lookup:{username.lower()}"
        cached = await self.cache.get(cache_key)
        if cached:
            return UserLookupResponse(**cached)

        # Query VNDB API (lightweight call)
        user = await self.vndb.get_user(username=username)
        if not user:
            return None

        result = UserLookupResponse(
            uid=user.get("id", ""),
            username=user.get("username", username),
        )

        # Cache for 1 hour
        await self.cache.set(cache_key, result.model_dump(), ttl=3600)

        return result

    async def get_user_profile(self, vndb_uid: str) -> UserProfileResponse | None:
        """Get basic user profile information.

        Lightweight API call for display purposes.
        """
        user = await self.vndb.get_user(uid=vndb_uid)
        if not user:
            return None

        return UserProfileResponse(
            uid=user.get("id", vndb_uid),
            username=user.get("username", ""),
            list_public=True,  # Assume public unless we get an error
        )

    async def get_user_list(self, vndb_uid: str, force_refresh: bool = False) -> dict | None:
        """
        Get user's VN list from LOCAL DATABASE (dump data).

        This queries the ulist_vns and ulist_labels tables which are populated
        daily from VNDB database dumps. No API calls are made.

        Returns a dict containing:
        - vn_ids: List of all VN IDs in the user's list
        - votes: List of {vn_id, score} for voted VNs
        - wishlist_ids: List of wishlist VN IDs
        - labels: Dict of label -> [vn_ids]
        - items: List of items with date info for trends
        - total: Total count of VNs
        - username: Username (if available)

        Args:
            vndb_uid: User ID (e.g., "u12345")
            force_refresh: If True, bypass Redis cache (still reads from DB)
        """
        # Normalize UID format
        if not vndb_uid.startswith("u"):
            vndb_uid = f"u{vndb_uid}"

        cache_key = self.cache.user_list_key(vndb_uid)

        # Check Redis cache first (unless force_refresh)
        if not force_refresh:
            cached = await self.cache.get(cache_key)
            if cached:
                logger.debug(f"[{vndb_uid}] Returning cached user list")
                return cached

        # Query local database for user's VN list
        logger.info(f"[{vndb_uid}] Fetching user list from local database")

        # Get all VN entries for this user
        result = await self.db.execute(
            select(UlistVN).where(UlistVN.uid == vndb_uid)
        )
        vn_entries = result.scalars().all()

        if not vn_entries:
            logger.info(f"[{vndb_uid}] No VN list entries found in database")
            return None

        # Get all labels for this user
        labels_result = await self.db.execute(
            select(UlistLabel).where(UlistLabel.uid == vndb_uid)
        )
        label_entries = labels_result.scalars().all()

        # Process into the expected format
        processed = self._process_local_user_list(vn_entries, label_entries)

        # Try to get username from API (lightweight call, cached)
        try:
            user = await self.vndb.get_user(uid=vndb_uid)
            processed["username"] = user.get("username", "") if user else ""
        except Exception as e:
            logger.debug(f"[{vndb_uid}] Could not fetch username: {e}")
            processed["username"] = ""

        logger.info(
            f"[{vndb_uid}] Loaded user list from database: "
            f"{processed['total']} VNs, {len(processed['votes'])} votes, "
            f"labels={{{', '.join(f'{k}:{len(v)}' for k, v in processed['labels'].items())}}}"
        )

        # Cache in Redis
        await self.cache.set(cache_key, processed, ttl=settings.cache_ttl_seconds)

        return processed

    def _process_local_user_list(
        self,
        vn_entries: list[UlistVN],
        label_entries: list[UlistLabel]
    ) -> dict:
        """Process database entries into the expected format for stats calculation."""

        # Build a mapping of vid -> list of label IDs
        vid_labels: dict[str, list[int]] = {}
        for label_entry in label_entries:
            vid = label_entry.vid
            if vid not in vid_labels:
                vid_labels[vid] = []
            vid_labels[vid].append(label_entry.label)

        vn_ids = []
        votes = []
        wishlist_ids = []
        labels: dict[str, list[str]] = {}
        items = []  # Store items with date info for trends

        for entry in vn_entries:
            vid = entry.vid
            vn_ids.append(vid)

            # Process vote
            if entry.vote:
                votes.append({
                    "vn_id": vid,
                    "score": entry.vote,  # 10-100 scale
                })

            # Process labels for this VN
            entry_labels = vid_labels.get(vid, [])
            item_labels = []

            for label_id in entry_labels:
                label_key = str(label_id)

                if label_key not in labels:
                    labels[label_key] = []
                labels[label_key].append(vid)
                item_labels.append({"id": label_id})

                # Check for wishlist (label ID 5)
                if label_id == 5:
                    wishlist_ids.append(vid)

            # Store item with all date info for trends analysis
            items.append({
                "vn_id": vid,
                "vote": entry.vote,
                "added": entry.added,  # Unix timestamp (BigInteger)
                "voted": entry.vote_date,  # Unix timestamp (when user voted)
                "started": entry.started.isoformat() if entry.started else None,  # ISO date string
                "finished": entry.finished.isoformat() if entry.finished else None,  # ISO date string
                "lastmod": entry.lastmod,  # Unix timestamp (when entry was last modified)
                "labels": item_labels,
            })

        return {
            "vn_ids": vn_ids,
            "votes": votes,
            "wishlist_ids": wishlist_ids,
            "labels": labels,
            "items": items,  # For trends
            "total": len(vn_ids),
        }

    async def refresh_user_data(self, vndb_uid: str) -> bool:
        """Clear caches and re-read user data from local database.

        Since user data now comes from database dumps (not API), a "refresh"
        simply clears the Redis cache so the next get_user_list() call
        will read fresh data from the local database.

        Note: To get truly fresh data, a new database import must be run.
        The dump data is only as fresh as the last import.
        """
        logger.info(f"Refreshing user data for {vndb_uid} (clearing caches)")

        # Clear all Redis caches for this user
        cache_key = self.cache.user_list_key(vndb_uid)
        await self.cache.delete(cache_key)
        await self.cache.delete(self.cache.user_stats_key(vndb_uid))
        # Also clear recommendations cache
        await self.cache.delete(self.cache.recommendations_key(vndb_uid, "hybrid"))
        await self.cache.delete(self.cache.recommendations_key(vndb_uid, "similar"))
        await self.cache.delete(self.cache.recommendations_key(vndb_uid, "collaborative"))

        # Re-fetch from local database
        data = await self.get_user_list(vndb_uid, force_refresh=True)
        if data:
            logger.info(f"Successfully refreshed data for {vndb_uid}: {data.get('total', 0)} VNs")
        else:
            logger.warning(f"No data found for {vndb_uid} in local database")

        return data is not None

    async def check_user_exists(self, vndb_uid: str) -> bool:
        """Check if a user exists in the local database.

        Useful for quickly checking if we have data for a user without
        loading their entire list.
        """
        if not vndb_uid.startswith("u"):
            vndb_uid = f"u{vndb_uid}"

        result = await self.db.execute(
            select(func.count()).select_from(UlistVN).where(UlistVN.uid == vndb_uid)
        )
        count = result.scalar()
        return count > 0 if count else False

    async def get_user_vn_list_with_metadata(
        self,
        vndb_uid: str,
        page: int = 1,
        limit: int = 50,
        label_filter: int | None = None,
        sort: str = "vote"
    ) -> UserVNListResponse:
        """Get user's VN list with full VN metadata from local database.

        Joins ulist_vns with visual_novels and ulist_labels to return
        complete information for each VN in the user's list.

        Args:
            vndb_uid: User ID (e.g., "u12345")
            page: Page number (1-indexed)
            limit: Items per page (max 100)
            label_filter: Optional label ID to filter by (2=Finished, 5=Wishlist, etc.)
            sort: Sort by: vote, added, title, rating

        Returns:
            UserVNListResponse with paginated items
        """
        # Normalize UID format
        if not vndb_uid.startswith("u"):
            vndb_uid = f"u{vndb_uid}"

        # Build base query joining ulist_vns with visual_novels
        base_query = (
            select(UlistVN, VisualNovel)
            .outerjoin(VisualNovel, UlistVN.vid == VisualNovel.id)
            .where(UlistVN.uid == vndb_uid)
        )

        # Apply label filter if provided
        if label_filter is not None:
            # Subquery to find VNs with the specified label
            label_subquery = (
                select(UlistLabel.vid)
                .where(UlistLabel.uid == vndb_uid)
                .where(UlistLabel.label == label_filter)
            )
            base_query = base_query.where(UlistVN.vid.in_(label_subquery))

        # Get total count
        count_result = await self.db.execute(
            select(func.count()).select_from(base_query.subquery())
        )
        total = count_result.scalar() or 0

        # Apply sorting with vid tiebreaker for stable pagination
        # Without tiebreaker, equal values cause duplicates/missing items across pages
        if sort == "vote":
            base_query = base_query.order_by(
                UlistVN.vote.desc().nulls_last(),
                UlistVN.vid.asc()
            )
        elif sort == "added":
            base_query = base_query.order_by(
                UlistVN.added.desc().nulls_last(),
                UlistVN.vid.asc()
            )
        elif sort == "title":
            base_query = base_query.order_by(
                VisualNovel.title.asc().nulls_last(),
                UlistVN.vid.asc()
            )
        elif sort == "rating":
            base_query = base_query.order_by(
                VisualNovel.rating.desc().nulls_last(),
                UlistVN.vid.asc()
            )
        else:
            base_query = base_query.order_by(
                UlistVN.vote.desc().nulls_last(),
                UlistVN.vid.asc()
            )

        # Apply pagination
        offset = (page - 1) * limit
        base_query = base_query.offset(offset).limit(limit)

        # Execute query
        result = await self.db.execute(base_query)
        rows = result.all()

        # Get all labels for these VNs in one query
        vid_list = [row[0].vid for row in rows]
        labels_result = await self.db.execute(
            select(UlistLabel)
            .where(UlistLabel.uid == vndb_uid)
            .where(UlistLabel.vid.in_(vid_list))
        )
        all_labels = labels_result.scalars().all()

        # Build a mapping of vid -> labels
        vid_labels: dict[str, list[UserVNListItemLabel]] = {}
        label_names = {1: "Playing", 2: "Finished", 3: "Stalled", 4: "Dropped", 5: "Wishlist", 6: "Blacklist"}
        for label_entry in all_labels:
            vid = label_entry.vid
            if vid not in vid_labels:
                vid_labels[vid] = []
            vid_labels[vid].append(UserVNListItemLabel(
                id=label_entry.label,
                label=label_names.get(label_entry.label)
            ))

        # Build response items
        items = []
        for ulist_entry, vn in rows:
            # Build VN metadata
            vn_data = None
            if vn:
                image_data = None
                if vn.image_url:
                    image_data = UserVNListItemImage(
                        url=vn.image_url,
                        sexual=vn.image_sexual
                    )
                vn_data = UserVNListItemVN(
                    title=vn.title,
                    title_jp=vn.title_jp,
                    title_romaji=vn.title_romaji,
                    image=image_data,
                    rating=vn.rating,
                    released=vn.released.isoformat() if vn.released else None,
                    olang=vn.olang
                )

            items.append(UserVNListItem(
                id=ulist_entry.vid,
                vote=ulist_entry.vote,
                labels=vid_labels.get(ulist_entry.vid, []),
                added=ulist_entry.added,
                started=ulist_entry.started.isoformat() if ulist_entry.started else None,
                finished=ulist_entry.finished.isoformat() if ulist_entry.finished else None,
                vn=vn_data
            ))

        return UserVNListResponse(
            items=items,
            total=total,
            page=page,
            limit=limit,
            has_more=offset + len(items) < total
        )
