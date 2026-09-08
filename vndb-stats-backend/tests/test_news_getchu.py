from datetime import datetime, timezone
from pathlib import Path

import pytest

from app.services.news.adapters.getchu import (
    decode_page,
    drafts_from_listings,
    parse_price_table,
    parse_ranking,
    ranking_entries,
)
from app.services.news.matching import MatchedVN

FIX = Path(__file__).parent / "fixtures" / "news"
NOW = datetime(2026, 9, 6, 12, 0, tzinfo=timezone.utc)
VN = MatchedVN("v1", "Title", "タイトル", "Title", "https://t.vndb.org/cv/01/1.jpg", 0.0, 18, ["Studio"], ["スタジオ"])


async def no_match(site, value):
    return None


async def match_preorder(site, value):
    return VN if (site, value) == ("getchu", "1000003") else None


def price_page() -> str:
    return decode_page((FIX / "getchu_price.html").read_bytes())


def rank_page() -> str:
    return decode_page((FIX / "getchu_rank.html").read_bytes())


def test_price_table_rows_with_and_without_discount():
    listings = parse_price_table(price_page(), 2026, 9)
    assert [l.soft_id for l in listings] == ["1000000", "1000001", "1000002", "1000003"]
    by_id = {l.soft_id: l for l in listings}
    console = by_id["1000001"]
    assert console.title == "Sample Work Nintendo Switch版" and console.brand == "Brand A"
    assert console.media is None and console.released == datetime(2026, 9, 3).date()
    # The tax-inclusive figure is the one kept when a cell prints both.
    assert console.list_price == "￥7,480" and console.sale_price == "￥7,100"
    assert console.bonus is None and console.in_stock
    plain = by_id["1000002"]
    assert plain.title == "Plain Work & More" and plain.media == "DVD-ROM"
    assert plain.list_price == "￥9,680" and plain.sale_price is None
    assert plain.bonus == "描き下ろし B2タペストリー" and not plain.in_stock


def test_price_table_bonus_pair_takes_the_plain_editions_price():
    listings = parse_price_table(price_page(), 2026, 9)
    pair = listings[-1]
    assert pair.soft_id == "1000003" and pair.released == datetime(2026, 9, 25).date()
    assert pair.list_price == "￥10,780" and pair.sale_price == "￥10,240"
    assert pair.bonus == "描き下ろし B2タペストリー" and pair.in_stock
    assert pair.image_url == "https://www.getchu.com/brandnew/1000003/c1000003package.jpg"


def test_price_table_leaves_another_months_rows_undated():
    listings = parse_price_table(price_page(), 2026, 10)
    assert len(listings) == 4 and all(l.released is None for l in listings)


@pytest.mark.asyncio
async def test_dates_decide_released_or_preorder():
    drafts = await drafts_from_listings(parse_price_table(price_page(), 2026, 9), no_match, NOW)
    assert [(d.key, d.tags) for d in drafts] == [
        ("1000000", ["released"]),
        ("1000001", ["released"]),
        ("1000002", ["released"]),
        ("1000003-preorder-2026-09-25", ["preorder"]),
    ]
    released = drafts[1]
    assert released.published_at.date() == datetime(2026, 9, 3).date()
    assert released.source == "getchu" and released.url == "https://www.getchu.com/soft.phtml?id=1000001"
    assert released.title == "Sample Work Nintendo Switch版" and released.summary == "Brand A"
    assert released.image_is_nsfw is True and released.extra["platforms"] == ["swi"]
    assert released.extra["final_price"] == "￥7,100" and released.extra["original_price"] == "￥7,480"
    assert drafts[2].extra["final_price"] == "￥9,680" and drafts[2].extra["in_stock"] is False
    preorder = drafts[3]
    assert preorder.published_at == NOW and preorder.extra["expected_date"] == "2026-09-25"
    assert preorder.extra["developers"] == ["Brand C"] and preorder.extra["minage"] == 18


@pytest.mark.asyncio
async def test_matched_listing_takes_the_catalogue_entry():
    drafts = await drafts_from_listings(
        parse_price_table(price_page(), 2026, 9), match_preorder, NOW
    )
    matched = drafts[-1]
    assert matched.vn_id == "v1" and matched.title == "Title"
    assert matched.summary == "Future Work 初回版" and matched.image_url == VN.image_url
    assert matched.image_is_nsfw is False and matched.extra["alttitle"] == "タイトル"
    assert matched.extra["store_title"] == "Future Work 初回版"


def test_ranking_parse_reads_both_badge_layouts_and_caps_the_list():
    listings = parse_ranking(rank_page())
    assert len(listings) == 20 and [l.rank for l in listings] == list(range(1, 21))
    first, second = listings[0], listings[1]
    assert first.soft_id == "1000003" and first.title == "Future Work 初回版"
    assert first.brand == "Brand C" and first.sale_price == "¥10,240" and first.adult
    assert first.released == datetime(2026, 9, 25).date()
    assert first.image_url == "https://www.getchu.com/brandnew/1000003/c1000003package_s.jpg"
    assert second.soft_id == "1000001" and second.title == "Sample Work Nintendo Switch版"
    assert second.sale_price == "¥7,100" and not second.adult
    assert listings[2].sale_price == "¥3,850"


@pytest.mark.asyncio
async def test_ranking_entries_shape():
    entries = await ranking_entries(parse_ranking(rank_page()), match_preorder)
    top = entries[0]
    assert top["rank"] == 1 and top["productId"] == "1000003" and top["site"] == "getchu"
    assert top["title"] == "Title" and top["storeTitle"] == "Future Work 初回版"
    assert top["vnId"] == "v1" and top["imageUrl"] == VN.image_url and top["imageIsNsfw"] is False
    assert top["url"] == "https://www.getchu.com/soft.phtml?id=1000003" and top["price"] == "¥10,240"
    second = entries[1]
    assert second["vnId"] is None and second["title"] == "Sample Work Nintendo Switch版"
    assert second["imageUrl"].endswith("c1000001package_s.jpg") and second["imageIsNsfw"] is False
    assert entries[2]["imageIsNsfw"] is True


def test_schedule_months_reach_back_into_the_previous_month():
    from app.services.news.adapters.getchu import _months

    assert _months(datetime(2026, 1, 2, 0, 0, tzinfo=timezone.utc)) == [(2025, 12), (2026, 1), (2026, 2)]
    # The store day is Japan's: late on the last day of a month in UTC is already the next month.
    assert _months(datetime(2026, 8, 31, 20, 0, tzinfo=timezone.utc)) == [(2026, 8), (2026, 9), (2026, 10)]
