from app.services.recommendation_filters import (
    LABEL_BLACKLIST,
    compute_exclude_vn_ids,
)


def _labels():
    return {
        "1": ["v1"],         # Playing
        "2": ["v2", "v3"],   # Finished
        "4": ["v4"],         # Dropped
        "5": ["v5"],         # Wishlist (must NOT be excluded)
        "6": ["v6", "v7"],   # Blacklist
    }


def test_consumed_labels_always_excluded():
    exclude = compute_exclude_vn_ids(_labels(), exclude_blacklist=False)
    assert {"v1", "v2", "v3", "v4"} <= exclude


def test_wishlist_is_never_excluded():
    assert "v5" not in compute_exclude_vn_ids(_labels(), exclude_blacklist=True)


def test_blacklist_excluded_when_toggle_on():
    exclude = compute_exclude_vn_ids(_labels(), exclude_blacklist=True)
    assert {"v6", "v7"} <= exclude


def test_blacklist_kept_when_toggle_off():
    exclude = compute_exclude_vn_ids(_labels(), exclude_blacklist=False)
    assert "v6" not in exclude and "v7" not in exclude


def test_default_hides_blacklist():
    # Default (no arg) must hide blacklist, matching the on-by-default toggle.
    assert {"v6", "v7"} <= compute_exclude_vn_ids(_labels())


def test_blacklist_is_label_six_not_eight():
    # Regression guard: the old code read label "8", which never matches anything.
    assert LABEL_BLACKLIST == "6"
    exclude = compute_exclude_vn_ids({"8": ["vX"], "6": ["vY"]}, exclude_blacklist=True)
    assert "vY" in exclude      # label 6 is the real blacklist
    assert "vX" not in exclude  # label 8 is meaningless
