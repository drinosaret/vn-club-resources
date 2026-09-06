"""The reader profile as a Redis entry.

Building the profile is the largest share of a cold recommendation, and it is a pure
function of the reader's votes, the spoiler level and the switches that shape it, so a
tab, a popup and a filtered request for the same reader can all read one build. The key
carries a digest of exactly those inputs: a vote added or changed, a different spoiler
level or a moved switch is a different entry, and the daily import flushes the prefix
because the catalogue behind the votes has changed underneath them.

JSON is the store's format, so the maps keyed by integer id and the two sets are named
here and restored on the way out. The version constant is bumped whenever the profile's
shape changes, so a build from older code is never read by newer code.
"""

import hashlib
import json
import logging
from typing import Any, Optional

from app.core.cache import get_cache

logger = logging.getLogger(__name__)

PROFILE_VERSION = 1

# A day: the import that changes the catalogue also flushes the prefix, so the TTL is a
# backstop rather than the invalidation.
PROFILE_TTL_SECONDS = 24 * 3600

KEY_PREFIX = "rec:profile:"

# Maps whose keys are tag or trait ids.
INT_KEYED = (
    "tag_weights",
    "tag_dislikes",
    "tag_absolute_scores",
    "tag_weighted_scores",
    "tag_counts",
    "tag_idf",
    "tag_means",
    "preferred_traits",
    "trait_weighted_scores",
    "trait_counts",
    "trait_means",
)

SET_VALUED = ("excluded_tag_ids", "elite_tag_ids")


def _int_keys(mapping: dict) -> dict:
    return {int(key): value for key, value in mapping.items()}


def encode_profile(profile: dict) -> dict:
    """The profile as JSON-safe data."""
    out: dict[str, Any] = {}
    for name, value in profile.items():
        if name in SET_VALUED:
            out[name] = sorted(value)
        elif name == "seed_tag_profiles":
            out[name] = [
                [{str(k): v for k, v in vector.items()}, magnitude, liking]
                for vector, magnitude, liking in value
            ]
        elif name in INT_KEYED:
            out[name] = {str(key): item for key, item in value.items()}
        else:
            out[name] = value
    return out


def decode_profile(data: dict) -> dict:
    """The profile as the engine reads it."""
    out: dict[str, Any] = {}
    for name, value in data.items():
        if name in SET_VALUED:
            out[name] = set(value)
        elif name == "seed_tag_profiles":
            out[name] = [
                (_int_keys(vector), float(magnitude), float(liking))
                for vector, magnitude, liking in value
            ]
        elif name in INT_KEYED:
            out[name] = _int_keys(value)
        else:
            out[name] = value
    return out


def profile_key(user_votes: list[dict], spoiler_level: int, switches: dict) -> str:
    """One key per distinct build. Order of votes does not matter; their content does."""
    votes = sorted(
        (
            str(vote.get("vn_id") or vote.get("id")),
            int(vote.get("score", vote.get("vote", 0)) or 0),
            int(vote.get("vote_date") or 0),
        )
        for vote in user_votes
        if vote.get("vn_id") or vote.get("id")
    )
    material = json.dumps(
        {"v": PROFILE_VERSION, "votes": votes, "spoiler": spoiler_level, "switches": switches},
        sort_keys=True,
        default=str,
    )
    digest = hashlib.sha256(material.encode("utf-8")).hexdigest()[:24]
    return f"{KEY_PREFIX}{digest}"


async def read_profile(key: str) -> Optional[dict]:
    data = await get_cache().get(key)
    if not isinstance(data, dict):
        return None
    try:
        return decode_profile(data)
    except Exception as exc:
        # Whatever is in the store is untrusted: a shape the codec cannot read is a miss
        # and a rebuild, never an error on the request.
        logger.warning(f"Cached profile unreadable, rebuilding: {exc}")
        return None


async def write_profile(key: str, profile: dict) -> None:
    await get_cache().set(key, encode_profile(profile), ttl=PROFILE_TTL_SECONDS)
