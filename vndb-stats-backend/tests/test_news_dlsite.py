from datetime import datetime, timezone
from pathlib import Path

import pytest

from app.services.news.adapters.dlsite import (
    drafts_from_announced,
    drafts_from_discounts,
    drafts_from_preorders,
    drafts_from_works,
    parse_announce_list,
    parse_day_page,
    parse_expected_date,
    parse_fsr_list,
    parse_ranking,
    ranking_entries,
)
from app.services.news.matching import MatchedVN

FIX = Path(__file__).parent / "fixtures" / "news"
NOW = datetime(2026, 9, 6, 12, 0, tzinfo=timezone.utc)
VN = MatchedVN("v1", "Title", "タイトル", "Title", "https://t.vndb.org/cv/01/1.jpg", 0.0, 18, ["Studio"], ["スタジオ"])


async def no_match(site, value):
    return None


async def match_first(site, value):
    return VN if value == "VJ01000010" else None


def test_day_page_keeps_adventure_and_novel_games_only():
    day, works = parse_day_page((FIX / "dlsite_day.html").read_text(encoding="utf-8"), "pro")
    assert day == datetime(2026, 9, 4).date()
    assert [w.product_id for w in works] == ["VJ01000001"]
    assert works[0].maker == "Studio" and works[0].work_type == "ADV"


def test_fsr_list_reads_type_adult_flag_and_prices():
    works = parse_fsr_list((FIX / "dlsite_fsr.html").read_text(encoding="utf-8"), "pro")
    assert [w.product_id for w in works] == ["VJ01000010", "VJ01000012"]
    first = works[0]
    assert first.name == "Reserve Work" and first.maker == "Studio A"
    assert first.adult is True and first.price == "7,920" and first.original_price == "8,800"
    assert first.discount == 10
    assert first.image_url.endswith("VJ01000010_img_main_240x240.jpg")
    assert works[1].adult is False and works[1].work_type == "DNV" and works[1].discount is None


def test_announce_list_reads_expected_dates():
    works = parse_announce_list((FIX / "dlsite_announce.html").read_text(encoding="utf-8"))
    assert [w.product_id for w in works] == ["RJ01000020", "RJ01000022"]
    assert works[0].expected == "2026年09月21日" and works[0].adult
    # The doujin storefront marks nothing individually, so every work there counts as adult.
    assert works[1].expected == "2026年10月上旬" and works[1].adult
    assert parse_expected_date(works[0].expected) == "2026-09-21"
    assert parse_expected_date(works[1].expected) == "2026年10月上旬"


def test_ranking_rows_in_order():
    works = parse_ranking((FIX / "dlsite_ranking.html").read_text(encoding="utf-8"), "pro")
    assert [(w.rank, w.product_id, w.name) for w in works] == [
        (1, "VJ01000030", "Top Work"), (2, "VJ01000031", "Second Work"),
    ]
    assert works[0].adult and not works[1].adult and works[1].maker == "Studio B"


@pytest.mark.asyncio
async def test_unmatched_release_becomes_its_own_row():
    day, works = parse_day_page((FIX / "dlsite_day.html").read_text(encoding="utf-8"), "pro")
    drafts = await drafts_from_works(day, works, no_match, NOW, "pro")
    d = drafts[0]
    assert d.vn_id is None and d.title == "First Work" and d.summary == "Studio"
    assert d.url.endswith("/pro/work/=/product_id/VJ01000001.html")
    assert d.tags == ["released"] and d.extra["kind"] == "released"
    assert d.image_url.endswith("VJ01000001_img_sam_240x240.jpg")


@pytest.mark.asyncio
async def test_matched_release_takes_the_catalogue_entry():
    works = parse_fsr_list((FIX / "dlsite_fsr.html").read_text(encoding="utf-8"), "pro")
    drafts = await drafts_from_preorders(works, match_first, NOW)
    assert drafts[0].vn_id == "v1" and drafts[0].title == "Title"
    assert drafts[0].key == "VJ01000010-preorder" and drafts[0].tags == ["preorder"]
    assert drafts[1].vn_id is None and drafts[1].image_is_nsfw is False


@pytest.mark.asyncio
async def test_discounts_only_for_discounted_works():
    works = parse_fsr_list((FIX / "dlsite_fsr.html").read_text(encoding="utf-8"), "pro")
    drafts = await drafts_from_discounts(works, no_match, NOW)
    assert [d.key for d in drafts] == ["VJ01000010-sale-10"]
    assert drafts[0].extra["discount"] == 10 and drafts[0].extra["original_price"] == "8,800"
    assert drafts[0].image_is_nsfw is True


@pytest.mark.asyncio
async def test_announced_drafts_carry_expected_date():
    works = parse_announce_list((FIX / "dlsite_announce.html").read_text(encoding="utf-8"))
    drafts = await drafts_from_announced(datetime(2026, 9, 5).date(), works, no_match, NOW)
    assert drafts[0].key == "RJ01000020-announced"
    assert drafts[0].extra["expected"] == "2026-09-21"
    assert drafts[0].url.endswith("/maniax/announce/=/product_id/RJ01000020.html")
    assert drafts[0].published_at.date() == datetime(2026, 9, 5).date()


@pytest.mark.asyncio
async def test_ranking_entries_shape():
    works = parse_ranking((FIX / "dlsite_ranking.html").read_text(encoding="utf-8"), "pro")
    entries = await ranking_entries(works, no_match)
    assert entries[0]["rank"] == 1 and entries[0]["title"] == "Top Work" and entries[0]["imageIsNsfw"]
    assert entries[0]["url"].endswith("VJ01000030.html") and entries[0]["vnId"] is None
