from app.services.length_utils import length_to_categories


def test_length_minutes_zero_falls_back_to_legacy_category():
    # If vote-based length is present but 0 (unknown/insufficient), we should not drop the VN.
    assert length_to_categories(length=1, length_minutes=0) == ["very_short"]


def test_length_minutes_zero_falls_back_to_legacy_minutes():
    # Legacy `length` can itself be minute-based in some dumps.
    assert length_to_categories(length=119, length_minutes=0) == ["very_short"]
    assert length_to_categories(length=120, length_minutes=0) == ["short"]


def test_minutes_boundaries_are_strictly_less_than():
    assert length_to_categories(length=None, length_minutes=119) == ["very_short"]
    assert length_to_categories(length=None, length_minutes=120) == ["short"]
    assert length_to_categories(length=None, length_minutes=599) == ["short"]
    assert length_to_categories(length=None, length_minutes=600) == ["medium"]
    assert length_to_categories(length=None, length_minutes=1799) == ["medium"]
    assert length_to_categories(length=None, length_minutes=1800) == ["long"]
    assert length_to_categories(length=None, length_minutes=2999) == ["long"]
    assert length_to_categories(length=None, length_minutes=3000) == ["very_long"]
