import json
from datetime import datetime, timezone
from pathlib import Path

from app.services.news.adapters.bluesky_search import parse_search
from app.services.news.sources import EN, BlueskySearch

FIX = Path(__file__).parent / "fixtures" / "news"
NOW = datetime(2026, 9, 7, 0, 0, tzinfo=timezone.utc)


def test_search_keeps_substantial_posts_without_avatars():
    payload = json.loads((FIX / "bluesky_search.json").read_text(encoding="utf-8"))
    drafts = parse_search(payload, BlueskySearch("エロゲ 感想", "Bluesky 感想"), NOW)
    # The labelled promotion and the storefront link are out with the short reply.
    assert [d.key for d in drafts] == ["3abc1", "3abc4"]
    ja, en = drafts
    assert ja.source == "bsky_search" and ja.source_label == "Bluesky 感想"
    assert ja.extra["lang"] == "ja" and en.extra["lang"] == EN
    assert "avatar_url" not in ja.extra and ja.extra["query"] == "エロゲ 感想"
    assert ja.url == "https://bsky.app/profile/reader.test/post/3abc1"


def test_search_respects_the_cap_and_excludes():
    payload = json.loads((FIX / "bluesky_search.json").read_text(encoding="utf-8"))
    one = parse_search(payload, BlueskySearch("x", "X", max_items=1), NOW)
    assert len(one) == 1
    none = parse_search(payload, BlueskySearch("x", "X", exclude=["text hooker", "余韻"]), NOW)
    assert none == []
