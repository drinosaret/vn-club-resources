"""Length bucketing utilities.

These helpers are intentionally dependency-free so they can be unit-tested
without importing the full stats service module.
"""

import math

# Weekly Roudoku's default nomination cap: VNDB's "Very Short" bucket.
VERY_SHORT_MAX_MINUTES = 120

# Each 1-5 category mapped to the top of its range, so a VN known only by
# category is judged by the longest it could be. Bucket 5 is unbounded, hence
# inf rather than None: "Very Long" must FAIL a gate, not read as "unknown".
BUCKET_CEILING_MINUTES: dict[int, float] = {
    1: 120,
    2: 600,
    3: 1800,
    4: 3000,
    5: math.inf,
}

_BUCKET_LABELS = ["Very Short", "Short", "Medium", "Long", "Very Long"]


def length_to_category(length: int | None) -> str | None:
    """Convert VNDB length value to a single category name.

    DEPRECATED: Prefer `length_to_categories()` which matches VNDB behavior
    for filtering/bucketing.
    """
    categories = length_to_categories(length)
    return categories[0] if categories else None


def length_to_categories(length: int | None, length_minutes: int | None = None) -> list[str]:
    """Convert VNDB length value to category name(s).

    Priority: `length_minutes` (vote-based average) > `length` (database field).

    Note: In the VNDB dumps, `length_minutes` can be present but non-positive
    (0/None) for unknown/insufficient data. In that case we fall back to the
    legacy `length` field to avoid incorrectly dropping VNs from distributions.

    VNDB uses two formats in the database:
    - Old format: 1-5 representing categories directly
    - New format: Minutes (values > 5)

    VNDB categories (strictly less-than boundaries):
    - 1 / Very Short: < 2 hours (< 120 minutes)
    - 2 / Short: 2-10 hours (120 to < 600 minutes)
    - 3 / Medium: 10-30 hours (600 to < 1800 minutes)
    - 4 / Long: 30-50 hours (1800 to < 3000 minutes)
    - 5 / Very Long: >= 50 hours (>= 3000 minutes)

    Returns:
        List of category names (usually a single entry).
    """
    use_vote_minutes = length_minutes is not None and length_minutes > 0
    effective_length = length_minutes if use_vote_minutes else length

    if effective_length is None or effective_length <= 0:
        return []

    # Old category format (1-5) - only used when `length_minutes` is not available
    # and the `length` field contains a category value.
    if not use_vote_minutes and 1 <= effective_length <= 5:
        category_map = {
            1: "very_short",
            2: "short",
            3: "medium",
            4: "long",
            5: "very_long",
        }
        cat = category_map.get(effective_length)
        return [cat] if cat else []

    # Minutes format (length_minutes OR length > 5)
    if effective_length < 120:
        return ["very_short"]
    if effective_length < 600:
        return ["short"]
    if effective_length < 1800:
        return ["medium"]
    if effective_length < 3000:
        return ["long"]
    return ["very_long"]


def effective_length_minutes(length: int | None, length_minutes: int | None) -> float | None:
    """The playtime in minutes to judge a VN by, or None when VNDB has no data.

    Resolution order matches `length_to_categories` so the gate and the bucket
    label can never disagree about the same VN:

    1. `length_minutes` when positive (the vote-based average)
    2. the 1-5 `length` category, mapped to its bucket CEILING
    3. `length` above 5, which in the dumps means raw minutes
    4. None

    Step 2 uses the ceiling rather than a midpoint because a category is all we
    know: judge the VN by the longest it could be, not by an average that might
    let a 9-hour title through a 2-hour cap.
    """
    if length_minutes is not None and length_minutes > 0:
        return float(length_minutes)
    if length is None or length <= 0:
        return None
    if 1 <= length <= 5:
        return BUCKET_CEILING_MINUTES[length]
    return float(length)


def format_length(minutes: float | None) -> str:
    """Human-readable playtime for embeds and rejection copy."""
    if minutes is None:
        return "unknown"
    if minutes == math.inf:
        return "50h+"
    if minutes < 60:
        return f"{int(minutes)}m"
    hours, mins = divmod(int(minutes), 60)
    return f"{hours}h {mins}m" if mins else f"{hours}h"


def length_bucket_label(minutes: float | None) -> str:
    """The VNDB category name a playtime falls in ("Very Short" ... "Very Long")."""
    if minutes is None:
        return "Unknown"
    for label, ceiling in zip(_BUCKET_LABELS, (120, 600, 1800, 3000, math.inf)):
        if minutes <= ceiling:
            return label
    return _BUCKET_LABELS[-1]


def passes_length_gate(
    length: int | None, length_minutes: int | None, max_minutes: int
) -> tuple[bool, str]:
    """Whether a VN is short enough to nominate. Returns (ok, reason) where
    reason is 'ok', 'too_long', or 'no_length'.

    The comparison is inclusive, so a VN in category 1 (ceiling 120) passes a
    cap of 120. The cap reads as "fits inside this budget", which is why a
    vote-average of exactly 120 passes here while `length_to_categories` calls
    it "short" (its boundaries are strictly less-than).

    A VN with NO length data is REJECTED, not admitted. The costs are lopsided:
    a wrong rejection costs one member another pick, while a wrong acceptance
    costs the club its week and needs an admin to unwind both the pick and its
    calendar row. VNs with neither field are also mostly unreleased or obscure
    doujin, and admitting them would make "no data" the cheapest way around the
    cap. Admins can still add one by hand, and the block lifts on its own once
    VNDB gets a length vote.

    Not checked here (deliberately, for now): `devstatus`, so an in-development
    or cancelled VN with a short length can still be nominated.
    """
    effective = effective_length_minutes(length, length_minutes)
    if effective is None:
        return False, "no_length"
    if effective <= float(max_minutes):
        return True, "ok"
    return False, "too_long"
