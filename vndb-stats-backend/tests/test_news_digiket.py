from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from app.services.news.adapters.digiket import (
    catalogue_id,
    drafts_from_works,
    parse_works,
)
from app.services.news.matching import MatchedVN

FIX = Path(__file__).parent / "fixtures" / "news"
NOW = datetime(2026, 9, 6, 12, 0, tzinfo=timezone.utc)
VN = MatchedVN("v1", "Title", "タイトル", "Title", "https://t.vndb.org/cv/01/1.jpg", 2.0, 18, ["Studio"], ["スタジオ"])


async def no_match(site, value):
    return None


async def match_detective(site, value):
    return VN if (site, value) == ("digiket", "348641") else None


def works():
    return parse_works((FIX / "digiket.json").read_bytes())


def test_cp932_payload_decodes_and_genre_filter_keeps_adventure_and_novels():
    parsed = works()
    assert [w.trade_id for w in parsed] == [
        "ITM0348900", "ITM0348641", "ITM0348045", "ITM0348601", "ITM0348602",
    ]
    detective = parsed[1]
    assert detective.title == "Detective & Friends" and detective.maker == "Circle B"
    assert detective.genre == "アドベンチャーゲーム" and detective.tags == ["恋愛", "コメディ", "ミステリー"]
    assert detective.price == "￥756" and detective.target == "doujin"
    assert detective.image_url == "https://img.digiket.net/cg/348/ITM0348641_2.jpg"
    # Registration stamps are Japanese local time.
    assert detective.registered == datetime(2026, 9, 4, 15, 0, tzinfo=timezone.utc)
    assert parsed[3].price is None and parsed[3].genre == "サウンドノベル"


def test_parse_works_accepts_text_and_rejects_other_shapes():
    text = (FIX / "digiket.json").read_bytes().decode("cp932")
    assert len(parse_works(text, "commercial")) == 5
    assert parse_works(text, "commercial")[0].target == "commercial"
    assert parse_works(b"not json") == [] and parse_works('{"a": 1}') == []


def test_catalogue_id_strips_prefix_and_padding():
    assert catalogue_id("ITM0348641") == "348641"
    assert catalogue_id("ITM0000012") == "12"


@pytest.mark.asyncio
async def test_age_window_and_future_stamps():
    drafts = await drafts_from_works(works(), no_match, NOW)
    assert [d.key for d in drafts] == ["ITM0348900", "ITM0348641", "ITM0348601", "ITM0348602"]
    ahead = drafts[0]
    # Stamped past the clock, so the row takes the current time rather than a future one.
    assert ahead.published_at == NOW and ahead.extra["released"] == "2026-09-07"
    assert drafts[1].published_at == datetime(2026, 9, 4, 15, 0, tzinfo=timezone.utc)
    later = await drafts_from_works(works(), no_match, NOW + timedelta(days=3))
    assert [d.key for d in later] == ["ITM0348900", "ITM0348641", "ITM0348601", "ITM0348602"]
    much_later = await drafts_from_works(works(), no_match, NOW + timedelta(days=10))
    assert much_later == []


@pytest.mark.asyncio
async def test_unmatched_work_is_its_own_row_with_the_store_picture():
    drafts = await drafts_from_works(works(), no_match, NOW)
    d = drafts[1]
    assert d.source == "digiket" and d.source_label == "DiGiket" and d.vn_id is None
    assert d.title == "Detective & Friends" and d.tags == ["released"]
    assert d.summary == "Circle B · アドベンチャーゲーム · 恋愛, コメディ, ミステリー"
    assert d.url == "https://www.digiket.com/work/show/_data/ID=ITM0348641/"
    assert d.image_url == "https://img.digiket.net/cg/348/ITM0348641_2.jpg" and d.image_is_nsfw
    assert d.extra["final_price"] == "￥756" and d.extra["original_price"] is None
    assert d.extra["developers"] == ["Circle B"] and d.extra["minage"] == 18
    assert d.extra["store_tags"] == ["恋愛", "コメディ", "ミステリー"]
    marked = drafts[3]
    assert marked.tags == ["preorder"] and marked.extra["kind"] == "preorder"
    assert marked.key == "ITM0348602" and marked.extra["final_price"] == "￥3,208"


@pytest.mark.asyncio
async def test_matched_work_takes_the_catalogue_entry():
    drafts = await drafts_from_works(works(), match_detective, NOW)
    d = drafts[1]
    assert d.vn_id == "v1" and d.title == "Title" and d.image_url == VN.image_url
    assert d.image_is_nsfw is True and d.extra["image_sexual"] == 2.0
    assert d.extra["store_title"] == "Detective & Friends" and d.extra["developers"] == ["Studio"]
    assert drafts[0].vn_id is None
