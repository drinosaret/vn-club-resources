from datetime import datetime, timezone

from app.services.news.drafts import NewsDraft, tracker_key
from app.services.news.text import clean_html, first_line, is_heading, matches_keywords, post_title


def _draft(**over):
    base = dict(
        source="rss", source_label="Feed", key="https://example.test/post/1",
        title="t", published_at=datetime(2026, 9, 6, tzinfo=timezone.utc),
    )
    base.update(over)
    return NewsDraft(**base)


def test_short_safe_key_is_kept_and_prefixed():
    d = _draft(source="vndb", key="v123")
    assert tracker_key(d) == "v123"
    assert d.item_id == "vndb-v123"


def test_unsafe_key_is_hashed_to_sixteen_hex():
    d = _draft(key="https://example.test/post/1")
    k = tracker_key(d)
    assert len(k) == 16 and all(c in "0123456789abcdef" for c in k)
    assert d.item_id == f"rss-{k}"


def test_overlong_key_is_hashed():
    d = _draft(source="bluesky", key="a" * 120)
    assert len(tracker_key(d)) == 16


def test_clean_html_strips_tags_bbcode_entities_and_whitespace():
    assert clean_html("<p>Hi&amp;  [url=x]there[/url]</p>\n[b]!") == "Hi& there !"


def test_matches_keywords_requires_include_and_rejects_exclude():
    assert matches_keywords("新作ノベルゲーム発表", ["ノベルゲーム"], ["アクション"])
    assert not matches_keywords("新作アクション", ["ノベルゲーム"], ["アクション"])
    assert not matches_keywords("ノベルゲームのアクション", ["ノベルゲーム"], ["アクション"])
    assert matches_keywords("anything", [], [])


def test_matches_keywords_reads_a_short_term_as_a_whole_word():
    # Two and three letter terms turn up inside ordinary words; longer ones may not.
    assert not matches_keywords("[META] chill with the advice", [" vn "], [])
    assert matches_keywords("reading a VN tonight", [" vn "], [])
    assert matches_keywords("an ADV with a long route", ["adv"], [])
    assert not matches_keywords("a big advance for the studio", ["adv"], [])
    assert matches_keywords("a list of visual novels", ["visual novel"], [])
    # As an exclude term it reads the same way: the word bars a text, a fragment does not.
    assert matches_keywords("a big advance for the studio", [], ["adv"])
    assert not matches_keywords("an ADV out today", [], ["adv"])


def test_matches_keywords_keeps_a_denial_of_the_excluded_term():
    # A post about works that have no translation is what the exclude term is not aimed at.
    assert matches_keywords("Untranslated Releases: August", [], ["translated"])
    assert matches_keywords("Still no translation announced", [], ["translation"])
    assert not matches_keywords("Translated and out today", [], ["translated"])
    # The denial does not excuse the rest of the text.
    assert not matches_keywords(
        "Untranslated picks, plus an english release this week", [], ["translated", "english release"]
    )


def test_first_line_cuts_at_newline_then_length():
    assert first_line("one\ntwo", 100) == "one"
    cut = first_line("x" * 120, 100)
    assert cut.endswith("…") and len(cut) == 100


NL = chr(10)


def test_a_heading_opens_a_post_rather_than_naming_it():
    assert is_heading("【定期】")
    assert is_heading("📢【定期】")
    assert is_heading("〖📣予約受付中！〗")
    assert is_heading("／")
    assert is_heading("━━━")
    assert not is_heading("新作ノベルゲームを発表しました")
    # A long bracketed line says something on its own.
    assert not is_heading("【" + "あ" * 30 + "】")


def test_post_title_joins_a_heading_to_the_line_beneath_it():
    text = NL.join(["【ご予約受付中！】", "予約が始まりました。"])
    assert post_title(text, 100) == "【ご予約受付中！】 予約が始まりました。"


def test_post_title_joins_a_line_of_marks_to_the_line_beneath_it():
    text = NL.join(["／", "本日発売！", "＼"])
    assert post_title(text, 100) == "／ 本日発売！"


def test_post_title_keeps_a_heading_that_stands_alone():
    assert post_title("【定期】", 100) == "【定期】"
    assert post_title("", 100) == ""


def test_post_title_leaves_an_ordinary_opening_line_alone():
    text = NL.join(["新作ノベルゲームを発表しました", "詳しくは公式サイトへ"])
    assert post_title(text, 100) == "新作ノベルゲームを発表しました"
    assert first_line(text, 100) == "新作ノベルゲームを発表しました"


def test_post_title_cuts_the_joined_line_at_the_limit():
    cut = post_title(NL.join(["【お知らせ】", "あ" * 200]), 100)
    assert len(cut) == 100 and cut.endswith("…")


def test_public_web_url_refuses_local_addresses():
    from app.services.news.text import public_web_url

    for bad in (
        "http://10.0.0.5/admin", "http://127.0.0.1:8000/", "http://[::1]/", "http://intranet/",
        "http://box.internal/page", "http://example.com:8080/page", "ftp://example.com/x", "http://169.254.169.254/",
    ):
        assert not public_web_url(bad), bad
    for good in ("https://example.com/article", "http://news.example.co.jp:80/a", "https://example.com:443/"):
        assert public_web_url(good), good


import pytest


class _FakeResponse:
    def __init__(self, status, body=b"", headers=None):
        self.status = status
        self.headers = headers or {}
        self._body = body
        self.content = self

    async def read(self, limit):
        return self._body[:limit]

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


class _FakeSession:
    def __init__(self, routes):
        self.routes = routes
        self.opened = []

    def get(self, url, **kwargs):
        self.opened.append(url)
        return self.routes[url]


@pytest.mark.asyncio
async def test_read_public_page_follows_only_public_redirects():
    from app.services.news.text import read_public_page

    session = _FakeSession(
        {
            "https://example.com/a": _FakeResponse(302, headers={"Location": "/b"}),
            "https://example.com/b": _FakeResponse(200, b"<html>b</html>"),
            "https://example.com/in": _FakeResponse(302, headers={"Location": "http://10.0.0.5/admin"}),
            "https://example.com/gone": _FakeResponse(404),
        }
    )
    assert await read_public_page(session, "https://example.com/a") == (b"<html>b</html>", "https://example.com/b")
    assert await read_public_page(session, "https://example.com/in") is None
    assert await read_public_page(session, "http://127.0.0.1/") is None
    assert await read_public_page(session, "https://example.com/gone") is None
    assert "http://10.0.0.5/admin" not in session.opened
    assert "http://127.0.0.1/" not in session.opened


@pytest.mark.asyncio
async def test_read_public_page_cuts_a_long_body_and_leaves_a_redirect_loop():
    from app.services.news.text import MAX_PAGE_BYTES, read_public_page

    session = _FakeSession(
        {
            "https://example.com/big": _FakeResponse(200, b"x" * (MAX_PAGE_BYTES + 10)),
            "https://example.com/loop": _FakeResponse(301, headers={"Location": "https://example.com/loop"}),
        }
    )
    got = await read_public_page(session, "https://example.com/big")
    assert got is not None and len(got[0]) == MAX_PAGE_BYTES
    assert await read_public_page(session, "https://example.com/loop") is None


@pytest.mark.asyncio
async def test_og_image_outside_the_open_web_is_not_kept():
    from app.services.news.text import extract_og_image

    session = _FakeSession(
        {
            "https://example.com/p": _FakeResponse(
                200, b'<meta property="og:image" content="http://192.168.0.9/x.jpg">'
            ),
            "https://example.com/q": _FakeResponse(
                200, b'<meta property="og:image" content="/pic.jpg">'
            ),
        }
    )
    assert await extract_og_image(session, "https://example.com/p") is None
    assert await extract_og_image(session, "https://example.com/q") == "https://example.com/pic.jpg"


def test_a_draft_time_without_a_zone_is_taken_as_utc():
    from datetime import datetime, timezone

    from app.services.news.drafts import NewsDraft

    naive = NewsDraft(source="s", source_label="l", key="k", title="t", published_at=datetime(2026, 1, 2, 3, 4))
    aware = NewsDraft(
        source="s", source_label="l", key="k2", title="t", published_at=datetime(2026, 1, 2, 3, 5, tzinfo=timezone.utc)
    )
    assert naive.published_at.tzinfo is timezone.utc
    assert sorted([aware, naive], key=lambda d: d.published_at)[0] is naive
