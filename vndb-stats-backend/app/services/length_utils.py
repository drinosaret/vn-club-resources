"""Length bucketing utilities.

These helpers are intentionally dependency-free so they can be unit-tested
without importing the full stats service module.
"""


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
