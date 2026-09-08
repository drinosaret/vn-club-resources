"""One fetched item, before it is a row.

Every adapter returns these and knows nothing about the table; the store turns them into
rows, so the id and dedupe rules live in one place.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

# A key that can stand in a row id unchanged. Anything else (a URL, an at:// URI) is
# hashed, which also bounds its length for the tracker column.
_SAFE_KEY = re.compile(r"^[A-Za-z0-9_.:-]{1,64}$")


@dataclass
class NewsDraft:
    source: str
    source_label: str
    key: str
    title: str
    published_at: datetime
    summary: str | None = None
    url: str | None = None
    image_url: str | None = None
    image_is_nsfw: bool = False
    tags: list[str] | None = None
    extra: dict[str, Any] = field(default_factory=dict)
    vn_id: str | None = None

    def __post_init__(self) -> None:
        # A time read without a zone is taken as UTC: drafts sort against each other by
        # this value, and a naive one cannot be ordered among aware ones.
        if self.published_at.tzinfo is None:
            self.published_at = self.published_at.replace(tzinfo=timezone.utc)

    @property
    def item_id(self) -> str:
        return f"{self.source}-{tracker_key(self)}"


def tracker_key(draft: NewsDraft) -> str:
    """The dedupe key stored against the source.

    md5 rather than a stronger hash because the value is an identifier, not a secret, and
    existing rows carry md5-derived ids that must still match.
    """
    if _SAFE_KEY.match(draft.key):
        return draft.key
    return hashlib.md5(draft.key.encode("utf-8")).hexdigest()[:16]
