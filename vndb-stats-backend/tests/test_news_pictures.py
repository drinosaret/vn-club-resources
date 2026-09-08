import json
from pathlib import Path

from app.services.news.pictures import (
    candidate_url,
    first_status_id,
    parse_page_image,
    status_id,
    tweet_image,
)

FIX = Path(__file__).parent / "fixtures" / "news"

BASE = "https://example.test/news/article/"


def page(*metas: str) -> str:
    return "<html><head>" + "".join(metas) + "</head><body>text</body></html>"


def test_og_image_in_both_attribute_orders():
    forward = page('<meta property="og:image" content="https://cdn.example.test/a.jpg" />')
    reverse = page('<meta content="https://cdn.example.test/a.jpg" property="og:image" />')
    assert parse_page_image(forward, BASE) == "https://cdn.example.test/a.jpg"
    assert parse_page_image(reverse, BASE) == "https://cdn.example.test/a.jpg"


def test_name_attribute_is_accepted():
    assert (
        parse_page_image(page('<meta name="og:image" content="https://cdn.example.test/b.jpg">'), BASE)
        == "https://cdn.example.test/b.jpg"
    )


def test_other_attributes_on_the_tag_do_not_hide_the_value():
    forward = page(
        '<meta data-hint="ssr" data-hid="og:image" property="og:image" content="https://cdn.example.test/e.jpg" />'
    )
    reverse = page(
        '<meta data-hint="ssr" content="https://cdn.example.test/e.jpg" data-hid="og:image" property="og:image">'
    )
    assert parse_page_image(forward, BASE) == "https://cdn.example.test/e.jpg"
    assert parse_page_image(reverse, BASE) == "https://cdn.example.test/e.jpg"


def test_an_empty_first_tag_does_not_hide_a_later_one():
    markup = page(
        '<meta property="og:image" content="">',
        '<meta property="og:image" content="https://cdn.example.test/f.jpg">',
    )
    assert parse_page_image(markup, BASE) == "https://cdn.example.test/f.jpg"


def test_secure_url_is_used_when_og_image_is_absent():
    assert (
        parse_page_image(
            page('<meta property="og:image:secure_url" content="https://cdn.example.test/c.jpg">'), BASE
        )
        == "https://cdn.example.test/c.jpg"
    )


def test_twitter_image_is_the_fallback():
    both = page(
        '<meta name="twitter:image" content="https://cdn.example.test/t.jpg">',
        '<meta property="og:image" content="https://cdn.example.test/o.jpg">',
    )
    assert parse_page_image(both, BASE) == "https://cdn.example.test/o.jpg"
    only = page('<meta name="twitter:image" content="https://cdn.example.test/t.jpg">')
    assert parse_page_image(only, BASE) == "https://cdn.example.test/t.jpg"


def test_single_quoted_attributes_are_read():
    assert (
        parse_page_image(page("<meta property='og:image' content='https://cdn.example.test/g.jpg'>"), BASE)
        == "https://cdn.example.test/g.jpg"
    )
    assert (
        parse_page_image(page("<meta name='twitter:image' content='https://cdn.example.test/h.jpg'>"), BASE)
        == "https://cdn.example.test/h.jpg"
    )


def test_relative_values_resolve_against_the_page():
    assert (
        parse_page_image(page('<meta property="og:image" content="/img/cover.jpg">'), BASE)
        == "https://example.test/img/cover.jpg"
    )
    assert (
        parse_page_image(page('<meta property="og:image" content="thumb.png">'), BASE)
        == "https://example.test/news/article/thumb.png"
    )
    assert (
        parse_page_image(page('<meta property="og:image" content="//cdn.example.test/d.jpg">'), BASE)
        == "https://cdn.example.test/d.jpg"
    )


def test_entities_in_the_value_are_unescaped():
    assert (
        parse_page_image(page('<meta property="og:image" content="/img/a.jpg?w=1&amp;h=2">'), BASE)
        == "https://example.test/img/a.jpg?w=1&h=2"
    )


def test_data_uris_and_svgs_are_refused():
    assert parse_page_image(page('<meta property="og:image" content="data:image/png;base64,AAAA">'), BASE) is None
    assert parse_page_image(page('<meta property="og:image" content="/logo.svg">'), BASE) is None
    assert parse_page_image(page('<meta property="og:image" content="/logo.SVG?v=2">'), BASE) is None
    assert parse_page_image(page('<meta property="og:image" content="ftp://example.test/a.jpg">'), BASE) is None
    assert parse_page_image(page('<meta property="og:image" content="">'), BASE) is None
    assert parse_page_image(page(), BASE) is None


def test_a_plain_article_address_is_read():
    assert candidate_url("https://example.test/a/1", None) == "https://example.test/a/1"


def test_the_search_relay_is_skipped():
    assert candidate_url("https://news.google.com/rss/articles/ABC", None) is None
    assert candidate_url("https://news.google.com/articles/ABC", ["https://news.google.com/x"]) is None
    # A relayed row carries the outlet's own site, not the article, so it is passed over.
    assert candidate_url("https://news.google.com/rss/articles/ABC", ["https://outlet.test/"]) is None


def test_post_addresses_are_skipped():
    for url in (
        "https://x.com/handle/status/1",
        "https://twitter.com/handle/status/1",
        "https://www.x.com/handle/status/1",
        "https://bsky.app/profile/handle/post/abc",
    ):
        assert candidate_url(url, None) is None


def test_a_post_takes_the_address_it_links_to():
    assert (
        candidate_url("https://x.com/handle/status/1", ["https://example.test/a/1", "https://example.test/a/2"])
        == "https://example.test/a/1"
    )
    assert candidate_url("https://x.com/handle/status/1", ["https://bsky.app/profile/h/post/a"]) is None


def test_unusable_link_values_are_ignored():
    assert candidate_url(None, None) is None
    assert candidate_url("mailto:someone@example.test", None) is None
    assert candidate_url("https://example.test/a/1", [42, ""]) == "https://example.test/a/1"


def _status(name):
    return json.loads((FIX / f"fxtwitter_status_{name}.json").read_text(encoding="utf-8"))


def test_a_post_address_yields_its_id():
    assert status_id("https://x.com/brand/status/2000000000000000001") == "2000000000000000001"
    assert status_id("https://www.twitter.com/brand/status/12") == "12"
    assert status_id("https://x.com/brand") is None
    assert status_id("https://example.test/a/1") is None
    assert status_id(None) is None
    assert first_status_id(["https://example.test/a", "https://x.com/b/status/9"]) == "9"
    assert first_status_id([]) is None


def test_a_relayed_post_gives_up_its_photo():
    url, author = tweet_image(_status("photo"))
    assert url == "https://pbs.twimg.com/media/AAAA.jpg?name=orig"
    assert author == "brand"


def test_a_post_with_only_a_moving_picture_gives_up_its_still():
    url, _ = tweet_image(_status("video"))
    assert url == "https://pbs.twimg.com/tweet_video_thumb/CCCC.jpg"


def test_a_card_stands_in_where_the_post_carries_no_media():
    url, author = tweet_image(_status("card"))
    assert url == "https://pbs.twimg.com/card_img/BBBB.jpg" and author == "brand"


def test_a_post_carrying_nothing_yields_no_picture():
    assert tweet_image(_status("bare")) == (None, "brand")
    assert tweet_image({}) == (None, None)


def test_local_and_literal_hosts_are_not_read():
    from app.services.news.pictures import _readable_page, _clean_image_url

    assert not _readable_page("http://10.0.0.5/admin")
    assert not _readable_page("http://127.0.0.1:8000/")
    assert not _readable_page("http://[::1]/")
    assert not _readable_page("http://intranet/")
    assert not _readable_page("http://box.internal/page")
    assert not _readable_page("http://example.com:8080/page")
    assert _readable_page("https://example.com/article")
    assert _clean_image_url("http://192.168.1.1/x.jpg", "https://example.com/") is None
    assert _clean_image_url("/x.jpg", "https://example.com/") == "https://example.com/x.jpg"
