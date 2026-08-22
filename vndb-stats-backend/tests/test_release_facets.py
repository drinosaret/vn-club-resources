"""Cover the per-VN release facets derived from the dump files.

The freeware distinction is the subtle part: `has_free_release` asks whether a VN can be
obtained for free at all, while `jp_freeware` reproduces VNDB's stricter reading, where
every Japanese release must be free. A VN with one free release and one paid one satisfies
the first and not the second.
"""

import os
import tempfile
from datetime import date

from app.ingestion.importer import (
    _compute_release_facets,
    _parse_dump_date,
    _parse_dump_int,
)

NULL = "\\N"


def _write_dump(directory: str, name: str, header: list[str], rows: list[list[str]]):
    with open(os.path.join(directory, name + ".header"), "w", encoding="utf-8") as f:
        f.write("\t".join(header) + "\n")
    with open(os.path.join(directory, name), "w", encoding="utf-8") as f:
        for row in rows:
            f.write("\t".join(row) + "\n")


#: Columns a release row carries, beyond the three the older tests were written against.
#: Rows shorter than this are padded with "an ordinary official release that is not a
#: patch", which is what every test predating those columns meant.
_RELEASE_COLUMNS = ["id", "olang", "freeware", "official", "patch"]
_RELEASE_DEFAULTS = ["t", "f"]


def _pad(row: list[str]) -> list[str]:
    return list(row) + _RELEASE_DEFAULTS[len(row) - 3:]


def _facets(releases, titles, release_vn):
    """Build the three dump files in a temp dir and compute facets from them."""
    releases = [_pad(row) for row in releases]
    with tempfile.TemporaryDirectory() as directory:
        _write_dump(directory, "releases", _RELEASE_COLUMNS, releases)
        _write_dump(directory, "releases_titles", ["id", "lang", "mtl", "title", "latin"], titles)
        _write_dump(directory, "releases_vn", ["id", "vid", "rtype"], release_vn)
        return _compute_release_facets(directory)


def test_languages_come_from_every_release_title_not_just_olang():
    # One release, Japanese original, but also carrying an English title. Reading olang
    # alone would call this Japanese-only.
    facets = _facets(
        releases=[["r1", "ja", "f"]],
        titles=[["r1", "ja", "f", "t", "t"], ["r1", "en", "f", "t", "t"]],
        release_vn=[["r1", "v1", "complete"]],
    )
    assert facets["v1"]["languages"] == {"ja", "en"}


def test_japanese_only_vn_has_exactly_one_language():
    facets = _facets(
        releases=[["r1", "ja", "f"]],
        titles=[["r1", "ja", "f", "t", "t"]],
        release_vn=[["r1", "v1", "complete"]],
    )
    assert facets["v1"]["languages"] == {"ja"}


def test_free_full_release_sets_has_free_release():
    facets = _facets(
        releases=[["r1", "ja", "t"]],
        titles=[["r1", "ja", "f", "t", "t"]],
        release_vn=[["r1", "v1", "complete"]],
    )
    assert facets["v1"]["has_free_release"] is True


def test_free_trial_alone_does_not_count_as_a_free_release():
    # Nearly every commercial VN ships a free trial; treating that as "free" would make
    # the facet meaningless.
    facets = _facets(
        releases=[["r1", "ja", "t"]],
        titles=[["r1", "ja", "f", "t", "t"]],
        release_vn=[["r1", "v1", "trial"]],
    )
    assert facets["v1"]["has_free_release"] is False


def test_jp_freeware_requires_every_japanese_release_to_be_free():
    facets = _facets(
        releases=[["r1", "ja", "t"], ["r2", "ja", "f"]],
        titles=[["r1", "ja", "f", "t", "t"], ["r2", "ja", "f", "t", "t"]],
        release_vn=[["r1", "v1", "complete"], ["r2", "v1", "complete"]],
    )
    # Both flags reject this, for the same reason: r2 is a paid Japanese release.
    assert facets["v1"]["has_free_release"] is False
    assert facets["v1"]["jp_freeware"] is False


def test_jp_freeware_ignores_paid_releases_in_other_languages():
    # A free Japanese original with a paid English localisation is still Japanese freeware.
    facets = _facets(
        releases=[["r1", "ja", "t"], ["r2", "en", "f"]],
        titles=[["r1", "ja", "f", "t", "t"], ["r2", "en", "f", "t", "t"]],
        release_vn=[["r1", "v1", "complete"], ["r2", "v1", "complete"]],
    )
    assert facets["v1"]["jp_freeware"] is True


def test_jp_freeware_requires_a_non_trial_release():
    facets = _facets(
        releases=[["r1", "ja", "t"]],
        titles=[["r1", "ja", "f", "t", "t"]],
        release_vn=[["r1", "v1", "trial"]],
    )
    assert facets["v1"]["jp_freeware"] is False


def test_vn_with_no_japanese_release_is_not_jp_freeware():
    facets = _facets(
        releases=[["r1", "en", "t"]],
        titles=[["r1", "en", "f", "t", "t"]],
        release_vn=[["r1", "v1", "complete"]],
    )
    assert facets["v1"]["jp_freeware"] is False
    assert facets["v1"]["has_free_release"] is True


def test_vn_ids_are_normalised_to_the_v_prefix():
    facets = _facets(
        releases=[["r1", "ja", "f"]],
        titles=[["r1", "ja", "f", "t", "t"]],
        release_vn=[["r1", "17", "complete"]],
    )
    assert "v17" in facets


def test_missing_dump_files_return_none_so_the_caller_can_fall_back():
    with tempfile.TemporaryDirectory() as directory:
        assert _compute_release_facets(directory) is None


def test_dump_null_sentinel_parses_as_absent():
    assert _parse_dump_date(NULL) is None
    assert _parse_dump_int(NULL) is None
    assert _parse_dump_date("") is None
    assert _parse_dump_int(None) is None


def test_dump_values_parse():
    assert _parse_dump_date("2011-03-30") == date(2011, 3, 30)
    assert _parse_dump_int("31") == 31


def test_malformed_values_do_not_raise():
    assert _parse_dump_date("not-a-date") is None
    assert _parse_dump_int("not-a-number") is None


# --- what counts as free to read ----------------------------------------------------
#
# Release rows are [id, olang, freeware, official, patch]; the last two may be omitted.
# The rule is: no paid release anywhere, and at least one free release readable on its own.

def test_a_title_whose_releases_are_all_free_counts():
    facets = _facets(
        releases=[["r1", "ja", "t"]],
        titles=[["r1", "ja", "f", "t", "t"]],
        release_vn=[["r1", "v1", "complete"]],
    )
    assert facets["v1"]["has_free_release"] is True


def test_one_paid_release_disqualifies_the_whole_title():
    # A commercial title can carry a promotional free edition, so "has some free release"
    # is not the same question as "can be obtained for free".
    facets = _facets(
        releases=[["r1", "ja", "t"], ["r2", "ja", "f"]],
        titles=[["r1", "ja", "f", "t", "t"], ["r2", "ja", "f", "t", "t"]],
        release_vn=[["r1", "v1", "complete"], ["r2", "v1", "complete"]],
    )
    assert facets["v1"]["has_free_release"] is False


def test_a_paid_release_in_another_language_still_disqualifies():
    # Sold anywhere is sold, so a title with a free Japanese release and a paid English one
    # is not something a reader can get for nothing.
    facets = _facets(
        releases=[["r1", "ja", "t"], ["r2", "en", "f"]],
        titles=[["r1", "ja", "f", "t", "t"], ["r2", "en", "f", "t", "t"]],
        release_vn=[["r1", "v1", "complete"], ["r2", "v1", "complete"]],
    )
    assert facets["v1"]["has_free_release"] is False


def test_free_patches_alone_do_not_make_a_title_free():
    # A patch needs the game underneath it, so it cannot be the release that qualifies.
    facets = _facets(
        releases=[["r1", "en", "t", "f", "t"]],
        titles=[["r1", "en", "f", "t", "t"]],
        release_vn=[["r1", "v1", "complete"]],
    )
    assert facets["v1"]["has_free_release"] is False


def test_a_free_trial_alone_does_not_qualify():
    facets = _facets(
        releases=[["r1", "ja", "t"]],
        titles=[["r1", "ja", "f", "t", "t"]],
        release_vn=[["r1", "v1", "trial"]],
    )
    assert facets["v1"]["has_free_release"] is False


def test_a_free_partial_release_alone_does_not_qualify():
    facets = _facets(
        releases=[["r1", "ja", "t"]],
        titles=[["r1", "ja", "f", "t", "t"]],
        release_vn=[["r1", "v1", "partial"]],
    )
    assert facets["v1"]["has_free_release"] is False


def test_a_free_trial_alongside_a_free_full_release_is_fine():
    # Everything is free, and one of them is readable on its own.
    facets = _facets(
        releases=[["r1", "ja", "t"], ["r2", "ja", "t"]],
        titles=[["r1", "ja", "f", "t", "t"], ["r2", "ja", "f", "t", "t"]],
        release_vn=[["r1", "v1", "trial"], ["r2", "v1", "complete"]],
    )
    assert facets["v1"]["has_free_release"] is True


def test_japanese_freeware_ignores_a_paid_release_in_another_language():
    # The narrower flag asks only about the Japanese releases, which is what separates it
    # from the board above.
    facets = _facets(
        releases=[["r1", "ja", "t"], ["r2", "en", "f"]],
        titles=[["r1", "ja", "f", "t", "t"], ["r2", "en", "f", "t", "t"]],
        release_vn=[["r1", "v1", "complete"], ["r2", "v1", "complete"]],
    )
    assert facets["v1"]["jp_freeware"] is True
    assert facets["v1"]["has_free_release"] is False
