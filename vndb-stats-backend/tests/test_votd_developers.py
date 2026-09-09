"""Developer credits carry both scripts for the site; the bot has to render them
as plain names whichever shape it is handed."""

from app.services.vn_of_the_day_service import developer_labels


def test_credits_render_as_the_original_script_by_default():
    devs = [{"name": "Key", "original": "キー"}, {"name": "Nitroplus", "original": None}]
    assert developer_labels(devs) == ["キー", "Nitroplus"]


def test_the_latin_name_can_be_preferred():
    devs = [{"name": "Key", "original": "キー"}]
    assert developer_labels(devs, prefer_original=False) == ["Key"]


def test_bare_strings_still_render():
    assert developer_labels(["Key", "Key", "", None]) == ["Key"]


def test_the_limit_applies_after_dedupe():
    devs = [{"name": "A"}, {"name": "A"}, {"name": "B"}, {"name": "C"}]
    assert developer_labels(devs, limit=2) == ["A", "B"]


def test_nothing_in_gives_nothing_out():
    assert developer_labels(None) == []
