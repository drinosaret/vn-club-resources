"""Precision of a release date recovered from the imported dump.

VNDB records a release date as an integer where an unknown month or day is a sentinel
rather than a value, so "sometime in 2027" and "1 January 2027" arrive in the same field.
Import clamps the sentinels to the first of the month, which means the stored date alone
cannot say which of the two it is.

The releases table is the tiebreaker. Its own parse of the same raw value keeps only dates
that resolve to a real calendar day, so an imprecise release lands there as NULL while an
exact one lands as the date itself. A title whose date is matched by one of its releases
therefore had a real day in the dump; a title whose date matches nothing was clamped.

What survives the clamp is still a true statement, just a shorter one: the month for a
release announced by month, the year for a release announced by year. Saying which of the
three a date is lets a page state only the part that was actually announced.
"""

from datetime import date

# Widest to narrowest. A consumer that cannot render one level can fall back to the next.
PRECISION_DAY = "day"
PRECISION_MONTH = "month"
PRECISION_YEAR = "year"


def classify_release_precision(released: date, has_exact_release: bool) -> str:
    """Return how much of `released` the dump actually stated.

    `has_exact_release` is whether any release of the title carries this date verbatim.
    """
    if has_exact_release:
        return PRECISION_DAY
    # Only the first of a month can be the product of a clamp, so any other day was stated.
    if released.day != 1:
        return PRECISION_DAY
    # An unknown month clamps to January, so January is indistinguishable from year-only
    # and only the year can be claimed.
    if released.month == 1:
        return PRECISION_YEAR
    return PRECISION_MONTH
