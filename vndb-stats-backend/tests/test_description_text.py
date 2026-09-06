"""Cleaning rules for description text fed to the sentence encoder."""

import pytest

from app.ingestion.description_text import (
    MIN_USEFUL_LENGTH,
    build_embedding_input,
    clean_description_for_embedding,
    prepare_embedding_input,
    text_hash,
)


def test_escaped_newlines_become_breaks():
    cleaned = clean_description_for_embedding("First line.\\nSecond line.")
    assert "\\n" not in cleaned
    assert cleaned == "First line.\nSecond line."


def test_link_keeps_its_text_and_loses_its_target():
    raw = "He meets [url=/c200]Kinzo[/url] on the island."
    assert clean_description_for_embedding(raw) == "He meets Kinzo on the island."


@pytest.mark.parametrize(
    "trailer",
    [
        "[From [url=http://example.invalid/x]Example Shop[/url]]",
        "[From Example Shop]",
        "[Translated from [url=http://example.invalid/]the official site[/url]]",
        "[Translated and edited from the official website]",
        "[Condensed from Example Shop]",
        "[Modified from example wiki]",
        "[MTLed from Example]",
        "(Source: Example Wiki)",
        "[Partially taken from Example]",
    ],
)
def test_attribution_trailers_are_dropped(trailer):
    body = "A detective returns to the town where he grew up."
    cleaned = clean_description_for_embedding(f"{body}\\n\\n{trailer}")
    assert cleaned == body


def test_ordinary_bracketed_aside_survives():
    raw = "The heroine [renameable] joins the club."
    assert "[renameable]" in clean_description_for_embedding(raw)


def test_bare_urls_are_removed():
    cleaned = clean_description_for_embedding(
        "Play it at https://example.invalid/game today."
    )
    assert "example.invalid" not in cleaned
    assert cleaned.startswith("Play it at")


def test_inline_markup_is_unwrapped_not_deleted():
    raw = "[b]Chapter one[/b] and [spoiler]the twist[/spoiler]."
    cleaned = clean_description_for_embedding(raw)
    assert cleaned == "Chapter one and the twist."


def test_blank_input_is_empty():
    assert clean_description_for_embedding(None) == ""
    assert clean_description_for_embedding("") == ""


def test_entry_note_lines_are_dropped():
    raw = "A story about a shrine.\\nNote: this entry covers the trial edition."
    assert clean_description_for_embedding(raw) == "A story about a shrine."


def test_title_leads_the_encoder_input():
    assert build_embedding_input("Some Title", "A story.") == "Some Title. A story."


def test_encoder_input_without_prose_is_empty():
    assert build_embedding_input("Some Title", "") == ""


def test_prepare_rejects_entries_below_the_prose_floor():
    short = "x" * (MIN_USEFUL_LENGTH - 1)
    assert prepare_embedding_input("Some Title", short) == ""

    long_enough = "y" * MIN_USEFUL_LENGTH
    assert prepare_embedding_input("Some Title", long_enough).startswith("Some Title. ")


def test_prepare_rejects_an_entry_that_is_only_attribution():
    assert prepare_embedding_input("Some Title", "[From Example Shop]") == ""


def test_hash_tracks_the_text_it_is_taken_from():
    assert text_hash("a") == text_hash("a")
    assert text_hash("a") != text_hash("b")


def test_hash_is_stable_across_equivalent_markup():
    """Two descriptions differing only in provenance encode the same, so re-encoding
    one because its credit link moved would be wasted work."""
    body = "A long summer at a rural shrine, told across several arcs."
    a = prepare_embedding_input("T", f"{body}\\n\\n[From [url=http://a.invalid]A[/url]]")
    b = prepare_embedding_input("T", f"{body}\\n\\n[From [url=http://b.invalid]B[/url]]")
    assert text_hash(a) == text_hash(b)
