from datetime import datetime, timezone
from pathlib import Path

import pytest

from app.services.news.adapters.melonbooks import (
    drafts_from_works,
    format_price,
    parse_detail,
    parse_listing,
)
from app.services.news.matching import MatchedVN

FIX = Path(__file__).parent / "fixtures" / "news"
NOW = datetime(2026, 9, 6, 12, 0, tzinfo=timezone.utc)
VN = MatchedVN("v1", "Title", "タイトル", "Title", "https://t.vndb.org/cv/01/1.jpg", 0.0, 18, ["Studio"], ["スタジオ"])


async def no_match(site, value):
    return None


async def match_first(site, value):
    assert site == "melonjp"
    return VN if value == "3000010" else None


def _works():
    return parse_listing((FIX / "melonbooks_list.html").read_text(encoding="utf-8"))


def test_listing_reads_preorder_and_arrival_sections_only():
    works = _works()
    assert [(w.product_id, w.kind) for w in works] == [
        ("3000010", "preorder"),
        ("3000011", "preorder"),
        ("3000020", "released"),
    ]
    first = works[0]
    assert first.name == "Reserve Work 限定版" and first.maker == "Studio A & B"
    assert first.price == 19330
    assert first.image_url == (
        "https://melonbooks.akamaized.net/user_data/packages/resize_image.php"
        "?width=450&height=450&image=214000000010.jpg&c=0&aa=1"
    )
    assert first.adult is None and first.released is None
    assert works[2].maker == "Studio C" and works[2].price == 7700


def test_detail_reads_rating_and_release_date():
    adult = parse_detail((FIX / "melonbooks_detail_adult.html").read_text(encoding="utf-8"))
    assert adult.adult is True and adult.work_type == "18禁"
    assert adult.released == datetime(2026, 10, 30).date()
    general = parse_detail((FIX / "melonbooks_detail_general.html").read_text(encoding="utf-8"))
    assert general.adult is False and general.work_type == "一般向け"
    assert general.released == datetime(2026, 9, 4).date()
    assert parse_detail("<html></html>").adult is None


def test_price_formatting():
    assert format_price(19330) == "¥19,330"
    assert format_price(0) == "無料"
    assert format_price(None) is None


@pytest.mark.asyncio
async def test_preorder_and_released_drafts():
    works = _works()
    adult = parse_detail((FIX / "melonbooks_detail_adult.html").read_text(encoding="utf-8"))
    works[0].adult, works[0].released = adult.adult, adult.released
    general = parse_detail((FIX / "melonbooks_detail_general.html").read_text(encoding="utf-8"))
    works[2].adult, works[2].released = general.adult, general.released
    drafts = await drafts_from_works(works, match_first, NOW)
    assert [d.key for d in drafts] == ["3000010-preorder", "3000011-preorder", "3000020"]
    matched, unread, arrived = drafts
    assert matched.vn_id == "v1" and matched.title == "Title" and matched.summary == "Reserve Work 限定版"
    assert matched.tags == ["preorder"] and matched.extra["kind"] == "preorder"
    assert matched.extra["expected"] == "2026-10-30" and matched.extra["expected_date"] == "2026-10-30"
    assert matched.extra["final_price"] == "¥19,330" and matched.extra["developers"] == ["Studio"]
    assert matched.image_url == VN.image_url and matched.image_is_nsfw is False
    assert matched.url == "https://www.melonbooks.co.jp/detail/detail.php?product_id=3000010"
    assert matched.published_at == NOW
    # No rating read: the category's balance makes the blur the default.
    assert unread.vn_id is None and unread.image_is_nsfw is True and unread.extra["minage"] == 18
    assert unread.extra["expected"] is None and unread.summary == "Studio A & B"
    assert arrived.tags == ["released"] and arrived.image_is_nsfw is False
    assert arrived.extra["minage"] is None and arrived.extra["released"] == "2026-09-04"
    assert arrived.published_at.date() == datetime(2026, 9, 4).date()
    assert "expected" not in arrived.extra
    assert arrived.image_url.startswith("https://melonbooks.akamaized.net/")


@pytest.mark.asyncio
async def test_arrivals_released_long_ago_are_stock_not_news():
    works = _works()
    works[2].released = datetime(2026, 6, 1).date()
    drafts = await drafts_from_works(works, no_match, NOW)
    assert [d.key for d in drafts] == ["3000010-preorder", "3000011-preorder"]


@pytest.mark.asyncio
async def test_unmatched_adult_work_keeps_the_store_picture_blurred():
    works = _works()
    works[0].adult = True
    drafts = await drafts_from_works(works[:1], no_match, NOW)
    d = drafts[0]
    assert d.title == "Reserve Work 限定版" and d.image_is_nsfw is True
    assert d.image_url.endswith("image=214000000010.jpg&c=0&aa=1")
