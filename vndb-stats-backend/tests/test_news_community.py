import json
from datetime import datetime, timezone
from pathlib import Path

from app.services.news.adapters.boards import parse_subjects
from app.services.news.adapters.fourchan import parse_catalog
from app.services.news.adapters.jiten import parse_log
from app.services.news.adapters.rss import parse_feed
from app.services.news.sources import (
    EN,
    JP_READING_TERMS,
    TRANSLATION_TERMS,
    Board,
    RssFeed,
)

FIX = Path(__file__).parent / "fixtures" / "news"
NOW = datetime(2026, 9, 6, 12, 0, tzinfo=timezone.utc)


def test_board_new_threads_only():
    board = Board("board.test", "hgame", "テスト板")
    drafts = parse_subjects((FIX / "board_subject.txt").read_bytes(), board, NOW)
    assert [d.title for d in drafts] == ["ブランド総合スレ", "新作購入検討スレ part1"]
    d = drafts[1]
    assert d.source == "board" and d.source_label == "テスト板"
    assert d.url == "https://board.test/test/read.cgi/hgame/1788600000/"
    assert d.published_at == datetime.fromtimestamp(1788600000, tz=timezone.utc)
    assert d.extra["replies"] == 12 and d.extra["lang"] == "ja"


def test_fourchan_generals_by_subject():
    payload = json.loads((FIX / "fourchan_catalog.json").read_text(encoding="utf-8"))
    drafts = parse_catalog(payload, NOW)
    assert [d.key for d in drafts] == ["jp-1001", "jp-1002"]
    d = drafts[0]
    assert d.source == "chan" and d.url == "https://boards.4chan.org/jp/thread/1001"
    assert d.image_url == "https://i.4cdn.org/jp/1788684347874695s.jpg"
    assert d.summary == "Guide: link Previous thread" and d.extra["lang"] == EN


def test_jiten_new_vn_decks():
    payload = json.loads((FIX / "jiten_log.json").read_text(encoding="utf-8"))
    drafts = parse_log(payload, NOW)
    assert [d.key for d in drafts] == ["900001"]
    d = drafts[0]
    assert d.source == "jiten" and d.vn_id == "v99999"
    assert d.url == "https://jiten.moe/decks/media/900001"
    assert d.image_url == "https://cdn.jiten.moe/900001/cover.jpg"
    assert "difficulty 5.5" in d.summary and "123,456 characters" in d.summary


def test_google_news_names_the_outlet_and_drops_its_suffix():
    feed = RssFeed("Google News", "https://news.google.com/rss/search?q=x", label_from_entry=True)
    drafts = parse_feed((FIX / "google_news.xml").read_text(encoding="utf-8"), feed, NOW)
    assert [d.source_label for d in drafts] == ["架空メディア", "別のメディア"]
    assert drafts[0].title == "美少女ゲームの新作が発表、発売は来春"
    assert drafts[0].source == "rss"


def test_reddit_keeps_reading_posts_and_strips_the_trailer():
    feed = RssFeed(
        "r/test", "https://www.reddit.com/r/test/new/.rss", JP_READING_TERMS, TRANSLATION_TERMS,
        lang=EN, source="reddit",
    )
    drafts = parse_feed((FIX / "reddit.xml").read_text(encoding="utf-8"), feed, NOW)
    assert len(drafts) == 1
    d = drafts[0]
    assert d.source == "reddit" and d.key == "t3_aaaaaa"
    assert d.summary == "Finished my first untranslated eroge, about 40 hours with a text hooker."


def test_forum_feed_keeps_opening_posts_only():
    feed = RssFeed("VNDB discussions", "https://vndb.org/feeds/posts.atom", lang=EN, source="forum", key_pattern=r"\.1$")
    drafts = parse_feed((FIX / "vndb_posts.atom").read_text(encoding="utf-8"), feed, NOW)
    assert [d.key for d in drafts] == ["https://vndb.org/t99999.1"]


def test_feed_thumbnail_is_used_before_any_page_fetch():
    feed = RssFeed("note", "https://note.com/hashtag/x/rss", source="note")
    drafts = parse_feed((FIX / "note.xml").read_text(encoding="utf-8"), feed, NOW)
    assert len(drafts) == 1
    assert drafts[0].image_url.startswith("https://assets.st-note.com/")
    assert drafts[0].source == "note"
