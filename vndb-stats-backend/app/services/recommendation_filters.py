"""The reader profile and exclusion rules a recommendation run is built from.

VNDB ulist label ids are documented on the UlistLabel model in app/db/models.py.
Recommendations must never suggest VNs the user has already engaged with, and
should hide blacklisted VNs unless the user opts to see them.

Both rules live here rather than beside either caller: the request path and the batch job
have to build the same profile from the same list, or a cached row is not the row a
request would have written. Keeping them here also lets a caller with no web layer, and
one with no scoring stack, take them without the other's imports.
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


def finished_votes(user_data: dict) -> list[dict]:
    """The reader's finished titles as scored evidence for the profile.

    Votes are narrowed to the Finished label so the profile matches what the stats page
    counts. A reader who logs without rating has no vote rows at all, so unless unrated
    evidence is enabled they arrive here with nothing for any signal to work from.
    """
    # Read at call time: the switches belong to the scoring stack, which the rest of this
    # module's callers have no reason to load.
    from app.services import hybrid_recommender

    labels = user_data.get("labels", {})
    finished_vn_ids = set(labels.get(LABEL_FINISHED, []))
    all_votes = user_data.get("votes", [])
    votes = [v for v in all_votes if v.get("vn_id") in finished_vn_ids]

    if hybrid_recommender.UNRATED_AS_EVIDENCE:
        rated = {v.get("vn_id") for v in votes}
        votes.extend(
            {"vn_id": vn_id, "score": hybrid_recommender.UNRATED_EVIDENCE_SCORE}
            for vn_id in sorted(finished_vn_ids - rated)
        )

    return votes
