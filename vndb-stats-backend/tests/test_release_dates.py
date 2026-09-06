"""Cover the recovery of release-date precision from a clamped date.

The interesting cases are the two the stored date cannot tell apart on its own: the first
of January, which is what a year-only announcement clamps to, and the first of any other
month, which is what a month-only announcement clamps to. Both must narrow to the part
that was stated, and neither may narrow when a release confirms the exact day.
"""

from datetime import date

from app.services.release_dates import (
    PRECISION_DAY,
    PRECISION_MONTH,
    PRECISION_YEAR,
    classify_release_precision,
)


def test_matching_release_means_the_day_was_stated():
    assert classify_release_precision(date(2027, 1, 1), True) == PRECISION_DAY
    assert classify_release_precision(date(2026, 9, 25), True) == PRECISION_DAY


def test_first_of_january_without_a_match_narrows_to_the_year():
    assert classify_release_precision(date(2027, 1, 1), False) == PRECISION_YEAR


def test_first_of_another_month_without_a_match_narrows_to_the_month():
    assert classify_release_precision(date(2026, 10, 1), False) == PRECISION_MONTH
    assert classify_release_precision(date(2026, 12, 1), False) == PRECISION_MONTH


def test_a_day_that_cannot_be_a_clamp_is_kept_whole():
    # Nothing clamps to the 25th, so the date is exact whether or not a release row
    # happens to carry it.
    assert classify_release_precision(date(2026, 9, 25), False) == PRECISION_DAY
    assert classify_release_precision(date(2027, 1, 2), False) == PRECISION_DAY
