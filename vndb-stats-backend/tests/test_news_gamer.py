from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

import pytest

from app.services.news.adapters.gamer import OG_IMAGE_LIMIT, SEARCH_TERMS, SEARCH_URL, fetch_all, parse_search

FIX = Path(__file__).parent / "fixtures" / "news"
NOW = datetime(2026, 9, 6, 12, 0, tzinfo=timezone.utc)
OG_PAGE = '<html><head><meta property="og:image" content="https://image.example.test/og.jpg"></head></html>'


class FakeResponse:
    def __init__(self, status, body):
        self.status = status
        self.headers = {}
        self._body = body
        self.content = self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def text(self):
        return self._body

    async def read(self, limit=None):
        raw = self._body.encode("utf-8")
        return raw[:limit] if limit else raw


class FakeSession:
    def __init__(self, route):
        self.route = route
        self.calls = []

    def get(self, url, **kwargs):
        self.calls.append(url)
        return FakeResponse(*self.route(url))


def _page():
    return (FIX / "gamer_search.html").read_text(encoding="utf-8")


def _item(news_id, stamp, title):
    return (
        '<div class="c-news-list__item"><div class="c-news-list__text">'
        f'<h3 class="c-news-list__title"><a href="/news/{news_id}/">{title}</a></h3>'
        f"<div class=\"c-news-meta\"><div class=\"c-news-date\"><time>{stamp}</time></div></div>"
        '</div><div class="c-news-list__image"></div></div>'
    )


def test_parse_keeps_recent_items_with_their_pictures():
    drafts = parse_search(_page(), NOW)
    assert [d.key for d in drafts] == ["gamer-202609050010", "gamer-202609040020"]
    d = drafts[0]
    assert d.source == "rss" and d.source_label == "Gamer"
    assert d.title == "美少女ゲーム『架空の庭』の発売日が決定 & 予約開始"
    assert d.url == "https://www.gamer.ne.jp/news/202609050010/"
    assert d.image_url == "https://image.example.test/news/2026/20260905/0010/x/i.jpg"
    assert d.published_at == datetime(2026, 9, 5, 5, 0, tzinfo=timezone.utc)
    assert d.extra == {"feed_name": "Gamer", "lang": "ja", "original_id": "202609050010", "category": "PC"}
    assert drafts[1].image_url is None and "category" not in drafts[1].extra


def test_parse_empty_list():
    assert parse_search("<html><body><div class=\"c-news-list\"></div></body></html>", NOW) == []


@pytest.mark.asyncio
async def test_fetch_all_dedupes_across_searches_and_fills_missing_pictures():
    def route(url):
        if url.startswith("https://www.gamer.ne.jp/news/?word="):
            return 200, _page()
        return 200, OG_PAGE

    session = FakeSession(route)
    drafts = await fetch_all(session, NOW)
    assert [d.key for d in drafts] == ["gamer-202609050010", "gamer-202609040020"]
    searched = [u for u in session.calls if "?word=" in u]
    assert searched == [SEARCH_URL.format(word=quote(w)) for w in SEARCH_TERMS]
    # Only the item the list left without a thumbnail needed a page fetch.
    assert session.calls.count("https://www.gamer.ne.jp/news/202609040020/") == 1
    assert drafts[1].image_url == "https://image.example.test/og.jpg"
    assert drafts[0].image_url.endswith("/0010/x/i.jpg")


@pytest.mark.asyncio
async def test_fetch_all_bounds_picture_lookups():
    items = "".join(_item(f"2026090500{i:02d}", f"2026.09.05 {i:02d}:00", f"ノベルゲーム {i}") for i in range(8))
    page = f'<html><body><div class="c-news-list">{items}</div></body></html>'

    def route(url):
        return (200, page) if "?word=" in url else (200, OG_PAGE)

    session = FakeSession(route)
    drafts = await fetch_all(session, NOW)
    assert len(drafts) == 8
    assert sum(1 for d in drafts if d.image_url) == OG_IMAGE_LIMIT
    assert len([u for u in session.calls if "?word=" not in u]) == OG_IMAGE_LIMIT
    # Newest first, so the lookups go to the freshest items.
    assert all(d.image_url for d in drafts[:OG_IMAGE_LIMIT])


@pytest.mark.asyncio
async def test_fetch_all_survives_a_failed_search():
    def route(url):
        if quote(SEARCH_TERMS[0]) in url:
            return 500, ""
        if "?word=" in url:
            return 200, _page()
        return 404, ""

    session = FakeSession(route)
    drafts = await fetch_all(session, NOW)
    assert len(drafts) == 2 and drafts[1].image_url is None
