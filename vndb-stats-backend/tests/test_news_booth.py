import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from app.services.news.adapters.booth import (
    BoothItem,
    apply_item_json,
    drafts_from_works,
    format_price,
    is_novel_like,
    parse_listing,
)
from app.services.news.matching import MatchedVN

FIX = Path(__file__).parent / "fixtures" / "news"
NOW = datetime(2026, 9, 6, 12, 0, tzinfo=timezone.utc)
VN = MatchedVN("v1", "Title", "タイトル", "Title", "https://t.vndb.org/cv/01/1.jpg", 0.0, 18, ["Studio"], ["スタジオ"])


async def no_match(site, value):
    return None


async def match_first(site, value):
    assert site == "booth"
    return VN if value == "8000001" else None


def _items():
    return parse_listing((FIX / "booth_browse.html").read_text(encoding="utf-8"))


def _item_json():
    return json.loads((FIX / "booth_item.json").read_text(encoding="utf-8"))


def test_listing_reads_cards_in_page_order():
    items = _items()
    assert [i.item_id for i in items] == ["8000001", "8000002", "8000003"]
    first = items[0]
    assert first.name == "First Novel & More" and first.shop == "Shop A" and first.price == 100
    assert first.image_url.startswith("https://booth.pximg.net/c/300x300_a2_g5/")
    assert first.tags == ["ノベル・アドベンチャー"] and first.adult is False
    assert items[1].price == 0


def test_listing_without_a_tag_carries_none():
    items = parse_listing((FIX / "booth_browse.html").read_text(encoding="utf-8"), tag=None)
    assert items[0].tags == []


def test_item_json_fills_adult_flag_date_and_tags():
    item = apply_item_json(_items()[2], _item_json())
    assert item.adult is True and item.price == 1650 and item.shop == "Shop C"
    assert item.published_at == datetime(2026, 9, 5, 14, 1, 4, tzinfo=timezone(timedelta(hours=9)))
    assert item.tags == ["ノベル・アドベンチャー", "Windows", "デジタルノベル"]
    assert item.description.startswith("A short adventure")
    # The listing picture stays; the item record only fills a missing one.
    assert "300x300" in item.image_url


def test_novel_filter_reads_tags_name_and_description():
    assert is_novel_like(BoothItem("1", "Some Title", None, tags=["ノベル・アドベンチャー"]))
    assert is_novel_like(BoothItem("2", "恋愛シミュレーション", None))
    assert is_novel_like(BoothItem("3", "Plain", None, description="短編ADVです"))
    assert not is_novel_like(BoothItem("4", "Coin Puzzle", None, tags=["パズル", "HTML"]))


def test_price_formatting():
    assert format_price(0) == "無料"
    assert format_price(100) == "¥100"
    assert format_price(1650) == "¥1,650"
    assert format_price(None) is None


@pytest.mark.asyncio
async def test_drafts_apply_the_filter_and_keep_the_window():
    items = parse_listing((FIX / "booth_browse.html").read_text(encoding="utf-8"), tag=None)
    items[0].tags = ["ノベル・アドベンチャー"]
    items[0].published_at = NOW - timedelta(days=1)
    items[1].tags = ["パズル"]
    apply_item_json(items[2], _item_json())
    drafts = await drafts_from_works(items, match_first, NOW)
    assert [d.key for d in drafts] == ["8000001", "8000003"]
    matched, own = drafts
    assert matched.vn_id == "v1" and matched.title == "Title" and matched.summary == "First Novel & More"
    assert matched.image_url == VN.image_url and matched.image_is_nsfw is False
    assert matched.extra["final_price"] == "¥100" and matched.extra["developers"] == ["Studio"]
    assert matched.url == "https://booth.pm/ja/items/8000001" and matched.tags == ["released"]
    assert own.vn_id is None and own.title == "Third Story" and own.summary == "Shop C"
    assert own.image_is_nsfw is True and own.extra["minage"] == 18
    assert own.extra["final_price"] == "¥1,650" and own.extra["developers"] == ["Shop C"]
    assert own.published_at.date() == datetime(2026, 9, 5).date()
    assert own.extra["released"] == "2026-09-05"


@pytest.mark.asyncio
async def test_old_items_are_not_filed_again_but_undated_ones_count_as_new():
    items = _items()
    items[0].published_at = NOW - timedelta(days=30)
    items[2].published_at = None
    drafts = await drafts_from_works(items, no_match, NOW)
    assert [d.key for d in drafts] == ["8000002", "8000003"]
    free = drafts[0]
    assert free.extra["final_price"] == "無料" and free.published_at == NOW
    assert free.image_is_nsfw is False
