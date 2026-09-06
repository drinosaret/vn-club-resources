"""Tests for the winner filter the hikaru calendar import reads through.

The import mirrors another bot's pool into the events table, and the same count
decides two things: what gets written, and whether the prune that follows is
allowed to run at all. A read with nothing usable in it has to stay empty, since
an empty winner set pruned against the calendar would clear the archive the
history page is made of.
"""

from app.services import hikaru_import as h


def _row(vndb_id="v123", start="2026-01", end="2026-01", status="monthly"):
    """A row shaped like the import's own select list."""
    return (vndb_id, start, end, status, "Title", "タイトル", "Title", None, False)


def test_complete_rows_are_kept_in_order():
    rows = [_row("v1"), _row("v2", status="seasonal")]
    assert h.usable_winners(rows) == rows


def test_rows_missing_a_month_bound_are_dropped():
    assert h.usable_winners([_row(start=None)]) == []
    assert h.usable_winners([_row(end=None)]) == []
    assert h.usable_winners([_row(start="")]) == []


def test_pool_statuses_outside_the_calendar_are_dropped():
    assert h.usable_winners([_row(status="nominated")]) == []
    assert h.usable_winners([_row(status="special")]) == []


def test_every_mapped_status_is_usable():
    for status in h._STATUS_TO_TYPE:
        assert h.usable_winners([_row(status=status)]) == [_row(status=status)]


def test_an_unusable_read_is_indistinguishable_from_an_empty_one():
    assert h.usable_winners([]) == []
    assert h.usable_winners([_row(status="nominated"), _row(start=None)]) == []


def test_usable_rows_survive_alongside_unusable_ones():
    keep = _row("v7")
    assert h.usable_winners([_row(status="nominated"), keep, _row(end=None)]) == [keep]
