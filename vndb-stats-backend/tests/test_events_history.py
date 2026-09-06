"""Tests for the public picks-history filter.

parse_history_types decides what the history listing shows from a query string a
visitor can edit, so it has to hold the allowlist and never resolve to an empty
selection.
"""

from app.services import events_service as e


def test_no_filter_means_every_pick_type():
    assert e.parse_history_types(None) == list(e.HISTORY_TYPES)
    assert e.parse_history_types("") == list(e.HISTORY_TYPES)


def test_named_types_are_kept_in_allowlist_order():
    assert e.parse_history_types("roudoku,vn_of_month") == ["vn_of_month", "roudoku"]


def test_unknown_types_are_dropped():
    assert e.parse_history_types("vn_of_season,custom,vn_month_voting") == ["vn_of_season"]


def test_wholly_unrecognised_filter_falls_back_to_every_type():
    assert e.parse_history_types("custom") == list(e.HISTORY_TYPES)
    assert e.parse_history_types(",, ,") == list(e.HISTORY_TYPES)


def test_whitespace_and_repeats_are_tolerated():
    assert e.parse_history_types(" roudoku , roudoku ") == ["roudoku"]


def test_cache_key_separates_filters_and_pages():
    assert e.events_history_key(["roudoku"], 60, 0) != e.events_history_key(["roudoku"], 60, 60)
    assert e.events_history_key(["roudoku"], 60, 0) != e.events_history_key(
        ["movie_night"], 60, 0
    )
    assert e.events_history_key(["roudoku"], 60, 0).startswith("events:history:")
