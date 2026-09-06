"""Plain text out of description markup."""

from app.services.bbcode import BLURB_CHARS, plain_summary, strip_bbcode


def test_markup_is_removed_and_link_text_survives():
    text = "A [b]bold[/b] claim about [url=https://example.invalid]the thing[/url]."
    assert strip_bbcode(text) == "A bold claim about the thing."


def test_paired_spoiler_content_does_not_survive():
    assert "secret" not in strip_bbcode("Before [spoiler]the secret[/spoiler] after")


def test_a_spoiler_left_open_by_truncation_does_not_survive():
    # Descriptions are cut before they are stripped, so the closing tag can be missing. The
    # paired pattern needs both, which is why the open case is handled separately.
    assert strip_bbcode("Before [spoiler]the secret ends here") == "Before"


def test_a_short_description_is_returned_whole():
    assert plain_summary("Two sentences. Nothing more.") == "Two sentences. Nothing more."


def test_an_empty_description_reads_as_absent():
    assert plain_summary(None) is None
    assert plain_summary("") is None
    # Markup that leaves no words behind is the same as having none.
    assert plain_summary("[spoiler]all of it[/spoiler]") is None


def test_a_long_description_is_cut_on_a_word_boundary():
    summary = plain_summary("alpha " * 200)
    assert summary is not None
    assert len(summary) <= BLURB_CHARS + 1  # the ellipsis is added after the cut
    assert summary.endswith("…")
    # A cut lands between words rather than through one.
    assert "alph…" not in summary


def test_newlines_collapse_into_one_run():
    assert plain_summary("first\n\n\nsecond") == "first second"


def test_trailing_punctuation_is_not_left_against_the_ellipsis():
    summary = plain_summary("word, " * 200)
    assert summary is not None
    assert ",…" not in summary
