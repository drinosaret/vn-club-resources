from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest

from app.services.news.adapters import brandsites
from app.services.news.adapters.brandsites import (
    BRAND_SITES,
    BrandSite,
    candidate_urls,
    decode_page,
    fetch_site,
    parse_date,
    parse_site,
)

FIX = Path(__file__).parent / "fixtures" / "news" / "brandsites"
NOW = datetime(2026, 9, 6, 12, 0, tzinfo=timezone.utc)
SITES = {s.slug: s for s in BRAND_SITES}
OG_PAGE = '<html><head><meta property="og:image" content="https://brand.example.test/og.jpg"></head></html>'


def _page(name: str, site: BrandSite) -> str:
    return decode_page((FIX / f"{name}.html").read_bytes(), site)


def _parse(name: str, slug: str, page_url: str | None = None):
    site = SITES[slug]
    return parse_site(_page(name, site), site, NOW, page_url)


class FakeResponse:
    def __init__(self, status, body: bytes):
        self.status = status
        self.headers = {}
        self._body = body
        self.content = self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def read(self, limit=None):
        return self._body[:limit] if limit else self._body


class FakeSession:
    def __init__(self, route):
        self.route = route
        self.calls = []

    def get(self, url, **kwargs):
        self.calls.append(url)
        return FakeResponse(*self.route(url))


def test_parse_date_accepts_every_site_form():
    assert parse_date("2026.9.01") == date(2026, 9, 1)
    assert parse_date("2026/8/28") == date(2026, 8, 28)
    assert parse_date("2026-09-03") == date(2026, 9, 3)
    assert parse_date("2026-8-20") == date(2026, 8, 20)
    assert parse_date("2026年8月21日(金)") == date(2026, 8, 21)
    assert parse_date("■2026.07.24") == date(2026, 7, 24)
    assert parse_date("2026-09-04T10:00:00+09:00") == date(2026, 9, 4)
    assert parse_date("2026.13.01") is None
    assert parse_date("NEW") is None


def test_circus_dates_and_window():
    drafts = _parse("circus", "circus")
    assert [d.title for d in drafts] == ["「星降る夜のカフェテラス」サイト更新！", "「風待ちの島」予約開始"]
    d = drafts[0]
    assert d.source == "rss" and d.source_label == "CIRCUS" and d.tags == ["news"]
    assert d.url == "https://circus-co.jp/product/example-a/"
    # JST midnight, as UTC.
    assert d.published_at == datetime(2026, 9, 2, 15, 0, tzinfo=timezone.utc)
    assert d.extra == {"feed_name": "CIRCUS", "lang": "ja", "brand": True}
    assert d.key.startswith("circus-") and d.item_id.startswith("rss-circus-")
    assert not d.image_is_nsfw
    # A relative link is resolved against the page.
    assert drafts[1].url == "https://circus-co.jp/product/example-b/"


def test_asa_iso_attribute_and_several_links_per_day():
    drafts = _parse("asa", "asaproject")
    assert [d.title for d in drafts] == ["最新作『放課後シネマ』公式サイトを更新!!", "発売まであと３週！"]
    assert all(d.published_at.date() == date(2026, 9, 3) for d in drafts)
    assert len({d.key for d in drafts}) == 2


def test_hook_shift_jis_page_and_unclosed_paragraphs():
    raw = (FIX / "hook.html").read_bytes()
    with pytest.raises(UnicodeDecodeError):
        raw.decode("utf-8")
    drafts = _parse("hook", "hooksoft")
    assert [d.title for d in drafts] == ["『夕凪のプロムナード』公式WEB更新！"]
    assert drafts[0].url == "https://www.hook-net.jp/example/"


def test_eushully_slash_dates_and_line_items():
    drafts = _parse("eushully", "eushully")
    assert [d.title for d in drafts] == [
        "蒼穹の剣譚 廉価版を発売しました",
        "白霧の軍記 廉価版の予約受付を公式通販にて開始しました",
    ]
    assert drafts[0].url == "https://eukleia.co.jp/eushully/ex01.html"
    assert drafts[1].url == "https://eukleia.co.jp/eushully/ex02.html"


def test_cuffs_one_row_per_dated_repost():
    drafts = _parse("cuffs", "cuffs")
    assert [d.title for d in drafts] == ["「残暑通販」注文受付中です！", "ひだまりの約束", "ひだまりの約束"]
    # The same page reported on two dates is two rows.
    assert drafts[1].url == drafts[2].url and drafts[1].key != drafts[2].key
    assert drafts[0].url == "https://www.cuffs.co.jp/main/store/example/"


def test_lilith_marks_pictures_and_skips_script_links():
    drafts = _parse("lilith", "lilith")
    assert [d.title for d in drafts] == ["【新作】「例の特設ページ」を公開しました！", "～休業のお知らせ～"]
    assert all(d.image_is_nsfw for d in drafts)
    assert drafts[0].url == "https://www.lilith-soft.com/event/example"
    # No link: the row points at the news page itself.
    assert drafts[1].url == "https://www.lilith-soft.com/news"


def test_escude_kanji_dates_and_commented_template():
    drafts = _parse("escude", "escude")
    assert [d.title for d in drafts] == ["『廃校の少女 外伝』更新！"]
    assert drafts[0].url == "https://www.escude.co.jp/product/example_fd/top.html"
    assert drafts[0].published_at.date() == date(2026, 8, 31)


def test_silkys_heading_with_first_bullet():
    drafts = _parse("silkys", "silkysplus")
    assert [d.title for d in drafts] == [
        "『冬のあとさき』 Steam版『Winter Example』9月10日(木)発売です。",
        "『海の見える駅』 普及版10月30日(金)発売です。",
    ]
    assert drafts[0].url == "http://www.silkysplus.jp/game/example/index.html"


def test_guilty_items_under_one_date_heading():
    drafts = _parse("guilty", "guilty", "https://guilty-soft.com/news2026.html")
    assert [d.title for d in drafts] == ["『例題の桜 ～体験版公開～』", "『例題の焔』"]
    assert drafts[0].url == "https://guilty-soft.com/product/example_a/"
    assert all(d.image_is_nsfw for d in drafts)


def test_waffle_ignores_commented_entries_and_keeps_picture_links():
    drafts = _parse("waffle", "waffle")
    assert [d.title for d in drafts] == ["『例のぬいぐるみ』 9月11日情報公開！", "『例のファンタジー』 キャンペーン開催"]
    assert drafts[0].image_url == drafts[0].url == "http://www.waffle1999.com/official/img/notice/example.jpg"
    assert drafts[1].image_url is None


def test_marmalade_unpadded_datetime_attribute():
    drafts = _parse("marmalade", "marmalade")
    assert [d.title for d in drafts] == ["『例題コンプリートパック』HPを公開しました。"]
    assert drafts[0].published_at.date() == date(2026, 9, 1)
    assert drafts[0].url == "http://www.web-marmalade.com/products/example_comp/index.html"


def test_innocent_grey_text_only_rows():
    drafts = _parse("innocentgrey", "innocentgrey")
    assert [d.title for d in drafts] == ["サウンドドラマ「祝いの庭」特設サイトを公開"]
    assert drafts[0].url == "http://www.gungnir.co.jp/innocentgrey/news.html"


def test_minato_shift_jis_date_headings():
    drafts = _parse("minato", "minatosoft")
    assert [d.title for d in drafts] == ["コラボカフェイベントは9月6日（日）迄！", "スタッフ日記を更新"]
    assert drafts[1].url == "http://minatosoft.com/staff.php"


def test_decode_prefers_declared_charset_over_trial():
    site = SITES["hooksoft"]
    text = '<meta charset="Shift_JIS"><p class="life"><strong>2026.09.04 表示</strong>'
    assert decode_page(text.encode("cp932"), site) == text
    # Without a declaration, trial order still lands on the right one.
    assert decode_page("日本語".encode("euc_jp"), site) == "日本語"
    assert decode_page("日本語".encode("utf-8"), site) == "日本語"


def test_window_and_per_site_cap():
    rows = "".join(
        f"<dt>{(NOW - timedelta(days=i)).strftime('%Y.%m.%d')}</dt><dd><a href='http://clockup.net/p{i}/'>title {i}</a></dd>"
        for i in range(0, 20, 2)
    )
    page = f'<section class="top_news"><dl>{rows}</dl></section>'
    drafts = parse_site(page, SITES["clockup"], NOW)
    assert len(drafts) == brandsites.MAX_ITEMS
    assert all(NOW - d.published_at <= brandsites.MAX_AGE for d in drafts)
    assert drafts == sorted(drafts, key=lambda d: d.published_at, reverse=True)


def test_year_suffixed_url_tries_current_then_previous_year():
    assert candidate_urls(SITES["guilty"], NOW) == [
        "https://guilty-soft.com/news2026.html",
        "https://guilty-soft.com/news2025.html",
    ]
    # The JST year is what counts on New Year's Eve in UTC.
    eve = datetime(2026, 12, 31, 20, 0, tzinfo=timezone.utc)
    assert candidate_urls(SITES["guilty"], eve)[0].endswith("news2027.html")
    assert candidate_urls(SITES["circus"], NOW) == ["https://circus-co.jp/information/"]


@pytest.mark.asyncio
async def test_fetch_site_falls_back_to_previous_year_and_takes_page_images(monkeypatch):
    monkeypatch.setattr(brandsites, "PAGE_PAUSE", 0)
    page = (FIX / "guilty.html").read_bytes()

    def route(url):
        if url.endswith("news2026.html"):
            return 404, b""
        if url.endswith("news2025.html"):
            return 200, page
        return 200, OG_PAGE.encode("utf-8")

    session = FakeSession(route)
    drafts = await fetch_site(session, SITES["guilty"], NOW)
    assert [d.title for d in drafts] == ["『例題の桜 ～体験版公開～』", "『例題の焔』"]
    assert session.calls[:2] == ["https://guilty-soft.com/news2026.html", "https://guilty-soft.com/news2025.html"]
    assert all(d.image_url == "https://brand.example.test/og.jpg" for d in drafts)
    assert all(d.image_is_nsfw for d in drafts)


@pytest.mark.asyncio
async def test_fetch_site_skips_page_images_off_host_and_for_the_list_page(monkeypatch):
    monkeypatch.setattr(brandsites, "PAGE_PAUSE", 0)
    page = (FIX / "silkys.html").read_bytes().replace(
        b'href="/game/example2/index.html"', b'href="https://store.example.test/x/"'
    )
    session = FakeSession(lambda url: (200, page if url == SITES["silkysplus"].url else OG_PAGE.encode("utf-8")))
    drafts = await fetch_site(session, SITES["silkysplus"], NOW)
    assert drafts[0].image_url == "https://brand.example.test/og.jpg"
    assert drafts[1].image_url is None
    assert session.calls == [SITES["silkysplus"].url, "http://www.silkysplus.jp/game/example/index.html"]


@pytest.mark.asyncio
async def test_fetch_all_survives_a_failing_site(monkeypatch):
    monkeypatch.setattr(brandsites, "FETCH_STAGGER", 0)
    monkeypatch.setattr(brandsites, "BRAND_SITES", [SITES["circus"], SITES["clockup"]])
    circus = (FIX / "circus.html").read_bytes()

    def route(url):
        if url == SITES["clockup"].url:
            raise ConnectionError("refused")
        return (200, circus) if url == SITES["circus"].url else (404, b"")

    drafts = await brandsites.fetch_all(FakeSession(route), NOW)
    assert {d.source_label for d in drafts} == {"CIRCUS"}


def test_every_site_has_a_distinct_slug_and_label():
    assert len({s.slug for s in BRAND_SITES}) == len(BRAND_SITES)
    assert len({s.name for s in BRAND_SITES}) == len(BRAND_SITES)
