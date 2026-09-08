from datetime import datetime, timezone

from app.services.news.linked import clean_title, describe, is_bare_link, parse_page_meta

PAGE = """<html><head>
<meta property="og:title" content="Sample Title SEASON 2001 | 各月発売ゲームタイトル一覧 | Calendar Site 美少女ゲームカレンダー" />
<meta property="og:description" content="Calendar Site では、国内の美少女ゲームの発売情報等を掲載しています。" />
</head><body><dt>発売日</dt><dd>2001年9月7日</dd></body></html>"""


def test_bare_link_detection():
    assert is_bare_link("https://example.test/game/1/")
    assert is_bare_link("  https://example.test/game/1/ \n")
    assert not is_bare_link("New title https://example.test/game/1/")
    assert not is_bare_link(None)


def test_clean_title_drops_site_suffixes():
    assert clean_title("Sample Title | Section | Site") == "Sample Title"
    assert clean_title("Only Title") == "Only Title"


def test_page_meta_and_anniversary():
    meta = parse_page_meta(PAGE)
    assert meta.title.startswith("Sample Title")
    assert meta.released.isoformat() == "2001-09-07"
    posted = datetime(2026, 9, 6, 20, 55, tzinfo=timezone.utc)  # Sep 7 in Japan
    title, summary, extra = describe(meta, posted, None)
    assert title == "Sample Title SEASON 2001"
    assert summary == "2001年9月7日発売 · 本日で25周年"
    assert extra["kind"] == "anniversary" and extra["years"] == 25


def test_non_anniversary_release_date_is_just_stated():
    meta = parse_page_meta(PAGE)
    posted = datetime(2026, 3, 1, tzinfo=timezone.utc)
    title, summary, extra = describe(meta, posted, None)
    assert summary == "2001年9月7日発売" and "kind" not in extra


def test_generic_site_description_is_not_used():
    meta = parse_page_meta(PAGE.replace("<dt>発売日</dt><dd>2001年9月7日</dd>", ""))
    title, summary, extra = describe(meta, datetime(2026, 9, 6, tzinfo=timezone.utc), "Calendar Site")
    assert title == "Sample Title SEASON 2001" and summary is None
