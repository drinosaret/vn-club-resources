"""Helpers for deciding which VNs to exclude from a user's recommendations.

VNDB ulist label ids are documented on the UlistLabel model in app/db/models.py.
Recommendations must never suggest VNs the user has already engaged with, and
should hide blacklisted VNs unless the user opts to see them.
"""

# VNDB ulist label ids (keys of the per-user labels dict from UserService).
LABEL_PLAYING = "1"
LABEL_FINISHED = "2"
LABEL_STALLED = "3"
LABEL_DROPPED = "4"
LABEL_WISHLIST = "5"
LABEL_BLACKLIST = "6"

# VNs under these labels are always excluded: the user has already engaged with
# them, so recommending them is never useful. Wishlist (5) is intentionally kept.
ALWAYS_EXCLUDED_LABELS = (LABEL_PLAYING, LABEL_FINISHED, LABEL_STALLED, LABEL_DROPPED)


def compute_exclude_vn_ids(
    labels: dict[str, list[str]],
    exclude_blacklist: bool = True,
) -> set[str]:
    """VN ids to exclude from recommendations for a user.

    `labels` maps a VNDB label id (as a string) to the list of VN ids the user
    filed under it. Playing/Finished/Stalled/Dropped VNs are always excluded.
    Blacklisted VNs (label 6) are excluded only when `exclude_blacklist` is True,
    which the recommendations page exposes as a user toggle defaulting to on.
    """
    exclude: set[str] = set()
    for label_id in ALWAYS_EXCLUDED_LABELS:
        exclude.update(labels.get(label_id, []))
    if exclude_blacklist:
        exclude.update(labels.get(LABEL_BLACKLIST, []))
    return exclude
