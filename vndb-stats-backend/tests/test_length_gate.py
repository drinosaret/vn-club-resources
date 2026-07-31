import math

import pytest

from app.services.length_utils import (
    VERY_SHORT_MAX_MINUTES,
    effective_length_minutes,
    format_length,
    length_bucket_label,
    length_to_categories,
    passes_length_gate,
)

CAP = VERY_SHORT_MAX_MINUTES  # 120


# ── effective_length_minutes ───────────────────────────────

def test_positive_vote_minutes_win_over_the_category():
    assert effective_length_minutes(length=5, length_minutes=90) == 90.0


def test_non_positive_vote_minutes_fall_back_to_the_category():
    assert effective_length_minutes(length=2, length_minutes=0) == 600
    assert effective_length_minutes(length=2, length_minutes=None) == 600


@pytest.mark.parametrize(
    "category,ceiling",
    [(1, 120), (2, 600), (3, 1800), (4, 3000), (5, math.inf)],
)
def test_each_category_maps_to_its_ceiling(category, ceiling):
    assert effective_length_minutes(length=category, length_minutes=None) == ceiling


def test_length_above_five_is_read_as_raw_minutes():
    assert effective_length_minutes(length=450, length_minutes=None) == 450.0


def test_no_data_at_all_is_none():
    assert effective_length_minutes(length=None, length_minutes=None) is None
    assert effective_length_minutes(length=0, length_minutes=0) is None


# ── passes_length_gate ─────────────────────────────────────

def test_missing_length_data_is_rejected_not_allowed():
    """The gate fails closed. See the passes_length_gate docstring for why:
    a wrong rejection costs one member a re-pick, a wrong acceptance costs the
    club a week. Changing this to fail open is a policy decision, not a bugfix.
    """
    assert passes_length_gate(None, None, CAP) == (False, "no_length")
    assert passes_length_gate(None, 0, CAP) == (False, "no_length")


def test_cap_is_inclusive():
    assert passes_length_gate(None, 119, CAP) == (True, "ok")
    assert passes_length_gate(None, 120, CAP) == (True, "ok")
    assert passes_length_gate(None, 121, CAP) == (False, "too_long")


def test_very_short_category_passes_the_default_cap():
    # Category 1's ceiling is exactly the cap; the inclusive comparison is what
    # makes the whole ceiling mapping work.
    assert passes_length_gate(1, None, CAP) == (True, "ok")


@pytest.mark.parametrize("category", [2, 3, 4, 5])
def test_longer_categories_fail_the_default_cap(category):
    assert passes_length_gate(category, None, CAP) == (False, "too_long")


def test_very_long_fails_rather_than_reading_as_unknown():
    # inf, not None: bucket 5 must be "too long", never "no data".
    assert passes_length_gate(5, None, 100_000) == (False, "too_long")


def test_a_raised_cap_admits_longer_vns():
    assert passes_length_gate(None, 540, 600) == (True, "ok")
    assert passes_length_gate(2, None, 600) == (True, "ok")


# ── agreement with the existing bucketer ───────────────────

@pytest.mark.parametrize("category", [1, 2, 3, 4, 5])
def test_category_labels_agree_with_length_to_categories(category):
    minutes = effective_length_minutes(category, None)
    expected = length_to_categories(category)[0].replace("_", " ").title()
    assert length_bucket_label(minutes) == expected


# ── display helpers (they go straight into user-facing copy) ──

def test_format_length_shapes():
    assert format_length(None) == "unknown"
    assert format_length(45) == "45m"
    assert format_length(120) == "2h"
    assert format_length(100) == "1h 40m"
    assert format_length(math.inf) == "50h+"


def test_bucket_label_unknown():
    assert length_bucket_label(None) == "Unknown"
