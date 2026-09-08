from datetime import datetime, timezone
from pathlib import Path

import pytest

from app.services.news.adapters import kadokawa
from app.services.news.adapters.kadokawa import OUTLETS, fetch_all, fetch_outlet, parse_page

FIX = Path(__file__).parent / "fixtures" / "news"
NOW = datetime(2026, 9, 6, 12, 0, tzinfo=timezone.utc)
FAMITSU, DENGEKI = OUTLETS


class FakeResponse:
    def __init__(self, status, body):
        self.status = status
        self._body = body

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def text(self):
        return self._body


class FakeSession:
    def __init__(self, pages):
        self.pages = pages
        self.calls = []

    def get(self, url, **kwargs):
        self.calls.append(url)
        status, body = self.pages.get(url, (404, ""))
        return FakeResponse(status, body)


def _page(name):
    return (FIX / name).read_text(encoding="utf-8")


def test_famitsu_keeps_matching_recent_articles_only():
    drafts = parse_page(_page("kadokawa_famitsu.html"), FAMITSU, NOW)
    assert [d.extra["original_id"] for d in drafts] == ["90001", "90006", "90007"]
    d = drafts[0]
    assert d.source == "rss" and d.source_label == "ファミ通.com"
    assert d.key == "famitsu-90001"
    assert d.url == "https://www.famitsu.com/article/202609/90001"
    assert d.image_url == "https://img.example.test/files/90001/thumbnail.jpg"
    assert d.summary == "架空の街を舞台にした新作が発表された。発売日は未定。"
    assert d.published_at == datetime(2026, 9, 5, 9, 0, tzinfo=timezone.utc)
    assert d.tags == ["news"] and d.extra["lang"] == "ja" and d.extra["feed_name"] == "ファミ通.com"


def test_famitsu_description_match_and_entities():
    drafts = parse_page(_page("kadokawa_famitsu.html"), FAMITSU, NOW)
    d = next(x for x in drafts if x.key == "famitsu-90006")
    assert d.title == "『架空の恋物語』体験版が配信開始 & 主題歌を公開"
    assert d.image_url is None


def test_famitsu_article_month_follows_publication_date():
    drafts = parse_page(_page("kadokawa_famitsu.html"), FAMITSU, NOW)
    d = next(x for x in drafts if x.key == "famitsu-90007")
    assert d.url == "https://www.famitsu.com/article/202608/90007"


def test_dengeki_skips_banner_rows_and_pr():
    drafts = parse_page(_page("kadokawa_dengeki.html"), DENGEKI, NOW)
    assert [d.extra["original_id"] for d in drafts] == ["80001", "80002"]
    d = drafts[0]
    assert d.source_label == "電撃オンライン" and d.key == "dengeki-80001"
    assert d.url == "https://dengekionline.com/article/202609/80001"


def test_dengeki_redirect_row_keys_on_target():
    drafts = parse_page(_page("kadokawa_dengeki.html"), DENGEKI, NOW)
    d = next(x for x in drafts if x.extra["original_id"] == "80002")
    assert d.url == "https://dengekionline.com/article/202608/79990"
    assert d.key == "dengeki-79990"


def test_page_without_embedded_data_yields_nothing():
    assert parse_page("<html><body>maintenance</body></html>", FAMITSU, NOW) == []
    assert parse_page('<script id="__NEXT_DATA__" type="application/json">{"props":{}}</script>', DENGEKI, NOW) == []


def test_recent_window_is_relative_to_now():
    later = datetime(2026, 9, 20, 12, 0, tzinfo=timezone.utc)
    assert parse_page(_page("kadokawa_famitsu.html"), FAMITSU, later) == []


@pytest.mark.asyncio
async def test_fetch_outlet_returns_nothing_on_error_status():
    session = FakeSession({FAMITSU.url: (503, "")})
    assert await fetch_outlet(session, FAMITSU, NOW) == []


@pytest.mark.asyncio
async def test_fetch_all_survives_one_outlet_failing(monkeypatch):
    session = FakeSession({FAMITSU.url: (200, _page("kadokawa_famitsu.html"))})

    async def boom(session, outlet, now):
        if outlet is DENGEKI:
            raise RuntimeError("down")
        return parse_page(session.pages[outlet.url][1], outlet, now)

    monkeypatch.setattr(kadokawa, "fetch_outlet", boom)
    drafts = await fetch_all(session, NOW)
    assert {d.source_label for d in drafts} == {"ファミ通.com"}
    assert len(drafts) == 3
