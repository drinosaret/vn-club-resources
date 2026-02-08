from app.services.length_utils import length_to_categories


def test_length_minutes_non_positive_falls_back_to_length_category():
    # If length_minutes is present but non-positive, it should be treated as missing
    # and fall back to the legacy length category.
    assert length_to_categories(length=1, length_minutes=0) == ["very_short"]
    assert length_to_categories(length=2, length_minutes=0) == ["short"]


def test_length_minutes_positive_takes_priority_over_length():
    # length_minutes should override the legacy category field when it contains real data
    # (e.g. 121 minutes => "short" even if legacy says "very_short").
    assert length_to_categories(length=1, length_minutes=121) == ["short"]


def test_minutes_boundaries_are_strict():
    # VNDB UI labels are strictly less-than on boundaries
    assert length_to_categories(length=None, length_minutes=119) == ["very_short"]
    assert length_to_categories(length=None, length_minutes=120) == ["short"]
