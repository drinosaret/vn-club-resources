import json
from datetime import datetime, timezone
from pathlib import Path

from app.services.news.adapters.bluesky import parse_author_feed
from app.services.news.adapters.fxtwitter import has_substance, page_link, parse_statuses
from app.services.news.adapters.rss import parse_feed
from app.services.news.adapters.vndb import _by_day, _group_releases, draft_new_vn, draft_release
from app.services.news.adapters.youtube import parse_channel_feed
from app.services.news.sources import (
    LOCALISATION_TERMS,
    RSS_FEEDS,
    NON_JP_ORIGIN_CATEGORIES,
    BlueskyAccount,
    RssFeed,
    XAccount,
    YouTubeChannel,
)

FIX = Path(__file__).parent / "fixtures" / "news"
NOW = datetime(2026, 9, 6, 12, 0, tzinfo=timezone.utc)


def test_rss_keeps_matching_recent_entries_only():
    feed = RssFeed("Test", "https://example.test/feed", ["ノベルゲーム"], ["アクション"])
    drafts = parse_feed((FIX / "rss.xml").read_text(encoding="utf-8"), feed, NOW)
    assert [d.title for d in drafts] == ["新作ノベルゲーム発表"]
    d = drafts[0]
    assert d.source == "rss" and d.source_label == "Test" and d.url.startswith("https://")
    assert d.published_at.tzinfo is not None and d.extra["feed_name"] == "Test"
    assert d.extra["lang"] == "ja"
    assert d.summary == "A new title was announced."


def test_rss_drops_rights_footer():
    feed = RssFeed("Test", "https://example.test/feed")
    payload = (FIX / "rss.xml").read_text(encoding="utf-8").replace(
        "<description>Old.</description>",
        "<description>Body text ... Copyright &#169; 2026 All Rights Reserved.</description>",
    ).replace("Fri, 07 Aug 2026", "Sat, 05 Sep 2026")
    drafts = parse_feed(payload, feed, NOW)
    old = next(d for d in drafts if d.title == "ノベルゲームの旧ニュース")
    assert old.summary == "Body text"


def test_youtube_entries_become_trailers():
    channel = YouTubeChannel("Brand", "UC" + "x" * 22)
    drafts = parse_channel_feed((FIX / "youtube.atom").read_text(encoding="utf-8"), channel, NOW)
    assert len(drafts) == 2
    d = drafts[0]
    assert d.source == "youtube" and d.key == "abc123defgh"
    assert d.url == "https://www.youtube.com/watch?v=abc123defgh"
    assert d.image_url == "https://i.ytimg.com/vi/abc123defgh/hqdefault.jpg"
    assert d.extra["channel_id"].startswith("UC")


def test_bluesky_skips_reposts_and_replies():
    acct = BlueskyAccount("brand.test", "Brand")
    payload = json.loads((FIX / "bluesky.json").read_text(encoding="utf-8"))
    drafts = parse_author_feed(payload, acct, NOW)
    assert len(drafts) == 1
    d = drafts[0]
    assert d.source == "bluesky" and d.url == "https://bsky.app/profile/brand.test/post/3abcxyz"
    assert d.image_url.startswith("https://cdn.bsky.app/img/feed_thumbnail/")
    assert d.title == "新作タイトルを発表しました" and d.summary.startswith(d.title)


def test_title_pattern_routes_one_feed_to_two_sections():
    payload = (FIX / "fuwanovel.xml").read_text(encoding="utf-8")
    news = RssFeed("Site", "https://example.test/feed/", exclude=LOCALISATION_TERMS + ["Review:"], lang="en")
    reviews = RssFeed("Site reviews", "https://example.test/feed/", exclude=LOCALISATION_TERMS, lang="en", source="review", title_pattern=r"^Review:")
    # The status roundup and the localisation item are out; the announcement stays.
    assert [d.title for d in parse_feed(payload, news, NOW)] == [
        "Studio announces a new mystery title for winter",
    ]
    filed = parse_feed(payload, reviews, NOW)
    assert [d.title for d in filed] == ["Review: Kakuu no Koi Monogatari"]
    assert filed[0].source == "review"


def test_search_feed_pseudo_entry_is_skipped():
    feed = RssFeed("Outlet", "https://example.test/?s=x&feed=rss2", lang="en")
    drafts = parse_feed((FIX / "search_feed.xml").read_text(encoding="utf-8"), feed, NOW)
    assert [d.title for d in drafts] == ["Studio unveils a new occult visual novel set to release this winter"]


def test_platform_creator_name_is_kept():
    feed = RssFeed("note", "https://note.com/hashtag/x/rss", source="note")
    drafts = parse_feed((FIX / "note.xml").read_text(encoding="utf-8"), feed, NOW)
    assert drafts[0].extra["creator"] == "書き手"


def test_bluesky_links_only_drops_posts_without_a_link():
    payload = json.loads((FIX / "bluesky.json").read_text(encoding="utf-8"))
    kept = parse_author_feed(payload, BlueskyAccount("brand.test", "Brand"), NOW)
    strict = parse_author_feed(payload, BlueskyAccount("brand.test", "Brand", links_only=True), NOW)
    assert len(kept) == 1
    assert [d for d in strict] == [d for d in kept if d.extra["expanded_urls"]]


def test_fxtwitter_filters_and_expands_links():
    acct = XAccount("acct", exclude=["translation"])
    payload = json.loads((FIX / "fxtwitter.json").read_text(encoding="utf-8"))
    drafts = parse_statuses(payload, acct, NOW)
    assert [d.key for d in drafts] == ["1000000000000000001"]
    d = drafts[0]
    assert d.source == "twitter" and d.source_label == "@acct"
    assert d.url == "https://x.com/acct/status/1000000000000000001"
    assert "https://example.test/article" in d.summary and "t.co" not in d.summary
    assert d.image_url.startswith("https://pbs.twimg.com/")
    assert d.title == "新作の記事を公開しました"
    assert d.extra["avatar_url"].startswith("https://pbs.twimg.com/profile_images/")


def test_page_link_skips_network_hosts():
    assert page_link(["https://x.com/a/status/1", "https://www.example.test/post"]) == "https://www.example.test/post"
    assert page_link(["https://t.co/x", "https://bsky.app/profile/a/post/b"]) is None
    assert page_link([]) is None


def test_rss_nsfw_feed_marks_pictures():
    feed = RssFeed("Adult", "https://example.test/feed", nsfw_images=True)
    drafts = parse_feed((FIX / "rss.xml").read_text(encoding="utf-8"), feed, NOW)
    assert drafts and all(d.image_is_nsfw for d in drafts)


def test_bluesky_carries_facet_links():
    acct = BlueskyAccount("brand.test", "Brand")
    payload = json.loads((FIX / "bluesky.json").read_text(encoding="utf-8"))
    drafts = parse_author_feed(payload, acct, NOW)
    assert drafts[0].extra["expanded_urls"] == ["https://example.test/article"]
    assert drafts[0].extra["avatar_url"].startswith("https://cdn.bsky.app/img/avatar/")


def test_fxtwitter_exclude_images_drops_media():
    acct = XAccount("acct", exclude_images=True)
    payload = json.loads((FIX / "fxtwitter.json").read_text(encoding="utf-8"))
    drafts = parse_statuses(payload, acct, NOW)
    assert len(drafts) == 2
    assert all(d.image_url is None for d in drafts)


def test_vndb_new_entry_keeps_developer_names_in_both_scripts():
    vn = {
        "id": "v1",
        "title": "Sample Title",
        "developers": [
            {"name": "Studio One", "original": "スタジオワン"},
            {"name": "Studio Two", "original": None},
            {"original": "名前なし"},
        ],
    }
    draft = draft_new_vn(vn, NOW)
    assert draft.extra["developers"] == ["Studio One", "Studio Two"]
    assert draft.extra["developers_original"] == ["スタジオワン", "Studio Two"]


def test_vndb_release_keeps_developer_names_in_both_scripts():
    releases = [
        {
            "id": "r1",
            "title": "Sample Release",
            "platforms": ["win"],
            "vns": [
                {
                    "id": "v1",
                    "title": "Sample Title",
                    "developers": [
                        {"name": "Studio One", "original": "スタジオワン"},
                        {"name": "Studio Two"},
                    ],
                }
            ],
        }
    ]
    draft = draft_release(_group_releases(releases)["v1"], NOW)
    assert draft.extra["developers"] == ["Studio One", "Studio Two"]
    assert draft.extra["developers_original"] == ["スタジオワン", "Studio Two"]


CATEGORY_FEED = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Category Feed</title>
<item><title>An announcement</title><link>https://example.test/a/1</link>
<guid isPermaLink="false">https://example.test/?p=11</guid>
<pubDate>Sat, 05 Sep 2026 09:00:00 +0000</pubDate>
<category><![CDATA[News]]></category><category><![CDATA[Japanese VN]]></category>
<description>A title was announced.</description></item>
<item><title>Another announcement</title><link>https://example.test/a/2</link>
<guid isPermaLink="false">https://example.test/?p=12</guid>
<pubDate>Sat, 05 Sep 2026 09:00:00 +0000</pubDate>
<category><![CDATA[New Official TL Releases]]></category>
<description>A title was announced.</description></item>
<item><title>A third announcement</title><link>https://example.test/a/3</link>
<guid isPermaLink="false">https://example.test/?p=13</guid>
<pubDate>Sat, 05 Sep 2026 09:00:00 +0000</pubDate>
<category><![CDATA[BL]]></category><category><![CDATA[Chinese VN]]></category>
<description>A title was announced.</description></item>
</channel></rss>"""


def test_rss_keeps_every_entry_when_no_category_is_excluded():
    feed = RssFeed("Test", "https://example.test/feed")
    assert len(parse_feed(CATEGORY_FEED, feed, NOW)) == 3


def test_rss_drops_entries_filed_under_an_excluded_category():
    feed = RssFeed("Test", "https://example.test/feed", exclude_categories=["TL Release"])
    assert [d.title for d in parse_feed(CATEGORY_FEED, feed, NOW)] == [
        "An announcement",
        "A third announcement",
    ]


def test_rss_drops_entries_tagged_with_another_origin():
    feed = RssFeed("Test", "https://example.test/feed", exclude_categories=NON_JP_ORIGIN_CATEGORIES)
    kept = [d.title for d in parse_feed(CATEGORY_FEED, feed, NOW)]
    assert "A third announcement" not in kept
    # A tag naming this medium's own origin is not one of them.
    assert "An announcement" in kept


def test_rss_allowlist_keeps_only_the_named_category():
    feed = RssFeed("Test", "https://example.test/feed", include_categories=["Japanese VN"])
    assert [d.title for d in parse_feed(CATEGORY_FEED, feed, NOW)] == ["An announcement"]


THREAD_FEED = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Threads</title>
<item><title>To split, or not to split? General Thread (#1)</title>
<link>https://example.test/t1.1</link>
<guid isPermaLink="false">https://example.test/t1.1</guid>
<pubDate>Sat, 05 Sep 2026 09:00:00 +0000</pubDate>
<description>A question for the board.</description></item>
<item><title>Regarding r164109.2 (#1)</title>
<link>https://example.test/t2.1</link>
<guid isPermaLink="false">https://example.test/t2.1</guid>
<pubDate>Sat, 05 Sep 2026 09:00:00 +0000</pubDate>
<description>Thanks for cleaning up my submitted games.</description></item>
<item><title>Regarding v900001 (#1)</title>
<link>https://example.test/t3.1</link>
<guid isPermaLink="false">https://example.test/t3.1</guid>
<pubDate>Sat, 05 Sep 2026 09:00:00 +0000</pubDate>
<description>An edit comment.</description></item>
<item><title>about Kakuu no Koi Monogatari (#1)</title>
<link>https://example.test/t4.1</link>
<guid isPermaLink="false">https://example.test/t4.1</guid>
<pubDate>Sat, 05 Sep 2026 09:00:00 +0000</pubDate>
<description>A note about a title.</description></item>
<item><title>where to get it? (#1)</title>
<link>https://example.test/t5.1</link>
<guid isPermaLink="false">https://example.test/t5.1</guid>
<pubDate>Sat, 05 Sep 2026 09:00:00 +0000</pubDate>
<description>The store page seems to be down.</description></item>
<item><title>An ordinary opener (#1)</title>
<link>https://example.test/t6.1</link>
<guid isPermaLink="false">https://example.test/t6.1</guid>
<pubDate>Sat, 05 Sep 2026 09:00:00 +0000</pubDate>
<description>Do you have this game? The store page seems to be down.</description></item>
<item><title>Crashes when I press start (#1)</title>
<link>https://example.test/t7.1</link>
<guid isPermaLink="false">https://example.test/t7.1</guid>
<pubDate>Sat, 05 Sep 2026 09:00:00 +0000</pubDate>
<description>It closes on the menu.</description></item>
<item><title>Warm welcomes! (#1)</title><link>https://vndb.org/t99998.1</link>
<guid isPermaLink="false">https://vndb.org/t99998.1</guid>
<pubDate>Sat, 05 Sep 2026 09:00:00 +0000</pubDate>
<description>Hello everyone, glad to be here.</description></item>
<item><title>Is it possible to know when I cast a vote on a VN? (#1)</title><link>https://vndb.org/t99997.1</link>
<guid isPermaLink="false">https://vndb.org/t99997.1</guid>
<pubDate>Sat, 05 Sep 2026 09:00:00 +0000</pubDate>
<description>I cannot find the date of my votes anywhere.</description></item>
</channel></rss>"""

THREAD_FEED_CONFIG = next(f for f in RSS_FEEDS if f.source == "forum")


def test_rss_keeps_every_thread_without_the_exclude_patterns():
    feed = RssFeed("Test", "https://example.test/feed")
    assert len(parse_feed(THREAD_FEED, feed, NOW)) == 9


def test_rss_drops_record_keeping_and_threads_aimed_at_one_member():
    feed = RssFeed(
        "Test",
        "https://example.test/feed",
        source="forum",
        title_exclude_pattern=THREAD_FEED_CONFIG.title_exclude_pattern,
        summary_exclude_pattern=THREAD_FEED_CONFIG.summary_exclude_pattern,
    )
    kept = [d.title for d in parse_feed(THREAD_FEED, feed, NOW)]
    assert kept == ["To split, or not to split? General Thread"]


def test_rss_summary_rule_reads_only_the_opening_words():
    feed = RssFeed(
        "Test",
        "https://example.test/feed",
        summary_exclude_pattern=THREAD_FEED_CONFIG.summary_exclude_pattern,
    )
    kept = [d.title for d in parse_feed(THREAD_FEED, feed, NOW)]
    # Second-person address opens the post; the same words further in do not place it.
    assert "An ordinary opener (#1)" not in kept
    assert "Crashes when I press start (#1)" in kept


SHORTS_ATOM = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
<entry><yt:videoId>aaaaaaaaaaa</yt:videoId><title>A full review of a title</title>
<published>2026-09-05T09:00:00+00:00</published></entry>
<entry><yt:videoId>bbbbbbbbbbb</yt:videoId><title>Quick thoughts #Shorts</title>
<published>2026-09-05T09:00:00+00:00</published></entry>
</feed>"""


def test_youtube_skips_shorts_by_the_tag_in_the_title():
    channel = YouTubeChannel("Reviewer", "UC" + "x" * 22, lang="en", source="review")
    drafts = parse_channel_feed(SHORTS_ATOM, channel, NOW)
    assert [d.title for d in drafts] == ["A full review of a title"]
    assert drafts[0].source == "review" and drafts[0].tags == ["review"]


def _status(text, *, status_id="1000000000000000009", media=None, urls=None):
    raw = {"text": text, "facets": []}
    for url in urls or []:
        raw["facets"].append({"type": "url", "original": url, "replacement": url})
    status = {
        "id": status_id,
        "url": f"https://x.com/acct/status/{status_id}",
        "text": text,
        "raw_text": raw,
        "created_timestamp": int(NOW.timestamp()) - 3600,
        "author": {"screen_name": "acct", "name": "Account"},
    }
    if media:
        status["media"] = {"all": [{"type": "photo", "url": media}]}
    return {"results": [status]}


def test_relay_account_drops_shop_stock_and_mobile_game_events():
    from app.services.news.sources import RELAY_NOISE_TERMS

    relay = XAccount("acct", exclude=RELAY_NOISE_TERMS, exclude_images=True)
    for noise in (
        "【恋姫†大戦】 SSR【水辺の純真】朱里【ピックアップガチャ開催中】",
        "【ゆずソフトショップ】 『カコ☆タマ』特大タペストリー 各種",
        "【グッドスマイルカンパニー】 ねんどろいど 神尾観鈴【再販情報】",
        "本日、発売15周年のタイトルはこちら！",
    ):
        assert parse_statuses(_status(noise, media="https://pbs.example.test/a.jpg"), relay, NOW) == [], noise
    kept = parse_statuses(_status("【Innocent Grey】 『カラノショウジョコンプリートボックス』特設サイト公開！"), relay, NOW)
    assert len(kept) == 1


def test_creator_post_with_nothing_to_open_and_nothing_to_say_is_dropped():
    acct = XAccount("acct", source="creator")
    assert parse_statuses(_status("どぁああああっ！"), acct, NOW) == []
    assert parse_statuses(_status("#ねぶパ 2026 @someone"), acct, NOW) == []
    # A link, a picture, or words of its own is enough.
    assert parse_statuses(_status("どぁああああっ！", urls=["https://example.test/a"]), acct, NOW)
    assert parse_statuses(_status("どぁああああっ！", media="https://pbs.example.test/a.jpg"), acct, NOW)
    assert parse_statuses(_status("明後日の大阪のイベントに参加します。スペースはG11bです。よろしくお願いいたします。"), acct, NOW)


def test_creator_stream_chatter_is_dropped():
    acct = XAccount("acct", source="creator")
    long_enough = "本日20時から" + "お待ちしています。" * 5
    assert parse_statuses(_status(long_enough), acct, NOW)
    assert parse_statuses(_status(long_enough + "配信中です"), acct, NOW) == []
    assert parse_statuses(_status(long_enough + "VTuberの話"), acct, NOW) == []


def test_the_substance_rule_is_only_for_creators():
    brand = XAccount("acct")
    assert parse_statuses(_status("どぁああああっ！"), brand, NOW)


def test_has_substance_counts_words_of_its_own():
    assert not has_substance("short", [], None)
    assert has_substance("short", ["https://example.test/a"], None)
    assert has_substance("short", [], "https://pbs.example.test/a.jpg")
    assert has_substance("x" * 40, [], None)


def test_fxtwitter_text_is_stored_as_plain_text():
    # The service escapes the markup characters; a row holds what the post actually says.
    escaped = "主題歌歌唱&amp;千夏役 （ՙ&gt;⩊&lt;ՙ） &quot;quoted&quot;"
    draft = parse_statuses(_status(escaped), XAccount("acct"), NOW)[0]
    assert draft.title == "主題歌歌唱&千夏役 （ՙ>⩊<ՙ） " + chr(34) + "quoted" + chr(34)
    assert "&amp;" not in draft.summary and "&gt;" not in draft.summary


def test_vndb_releases_bucket_by_their_own_day_and_drop_partial_dates():
    releases = [
        {"id": "r1", "released": "2026-09-04", "vns": [{"id": "v1", "title": "A"}]},
        {"id": "r2", "released": "2026-09-04", "vns": [{"id": "v1", "title": "A"}]},
        {"id": "r3", "released": "2026-09-06", "vns": [{"id": "v1", "title": "A"}]},
        {"id": "r4", "released": "2026-09", "vns": [{"id": "v2", "title": "B"}]},
        {"id": "r5", "released": "TBA", "vns": [{"id": "v3", "title": "C"}]},
    ]
    days = _by_day(releases)
    assert sorted(days) == ["2026-09-04", "2026-09-06"]
    assert [r["id"] for r in days["2026-09-04"]] == ["r1", "r2"]
    # The same title released twice in one day is one row for that day, and another row
    # for the later day, so the keys never collide across the window.
    keys = [
        draft_release(g, datetime(2026, 9, 4, tzinfo=timezone.utc)).key
        for g in _group_releases(days["2026-09-04"]).values()
    ] + [
        draft_release(g, datetime(2026, 9, 6, tzinfo=timezone.utc)).key
        for g in _group_releases(days["2026-09-06"]).values()
    ]
    assert keys == ["v1-2026-09-04", "v1-2026-09-06"]


def test_reddit_help_and_recommendation_threads_are_excluded():
    import re

    from app.services.news.sources import REDDIT_TITLE_EXCLUDE

    for chatter in (
        "How do I change the language text?",
        "Any good short VN recs for a beginner?",
        "Question about save files",
        "Recommend me something short",
    ):
        assert re.search(REDDIT_TITLE_EXCLUDE, chatter), chatter
    for news in ("Studio announces a new title for winter", "Finished reading a long eroge in Japanese, some thoughts"):
        assert not re.search(REDDIT_TITLE_EXCLUDE, news), news


def test_an_account_without_pictures_takes_none_from_its_links_either():
    from app.services.news.adapters.fxtwitter import wants_page_image
    from app.services.news.drafts import NewsDraft
    from app.services.news.sources import XAccount

    bare = NewsDraft(source="twitter", source_label="@a", key="1", title="a post about a title", published_at=NOW)
    assert not wants_page_image(XAccount("acct", exclude_images=True), bare)
    assert wants_page_image(XAccount("acct"), bare)
    assert not wants_page_image(XAccount("acct", link_images=False), bare)
    pictured = NewsDraft(source="twitter", source_label="@a", key="2", title="a post about a title",
                         published_at=NOW, image_url="https://pbs.example.test/a.jpg")
    assert not wants_page_image(XAccount("acct"), pictured)


def test_a_catalogue_of_adult_titles_keeps_its_pictures_behind_the_blur():
    """Its posts link to entries whose social image is the cover art."""
    from app.services.news.sources import X_ACCOUNTS
    acct = next(a for a in X_ACCOUNTS if a.handle.lower() == "moepedia_net")
    assert acct.nsfw_images and not acct.exclude_images
