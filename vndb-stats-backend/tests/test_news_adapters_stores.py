from datetime import datetime, timezone
from pathlib import Path

import pytest

from app.services.news.adapters.moeaward import parse_news_list
from app.services.news.adapters.steam import drafts_from_listings, parse_results
from app.services.news.matching import MatchedVN

FIX = Path(__file__).parent / "fixtures" / "news"
NOW = datetime(2026, 9, 6, 12, 0, tzinfo=timezone.utc)
VN = MatchedVN("v1", "Title", "タイトル", "Title", "https://t.vndb.org/cv/01/1.jpg", 0.0, 18, ["Studio"], ["スタジオ"])


def test_steam_results_parse_price_and_release():
    listings = parse_results((FIX / "steam_results.html").read_text(encoding="utf-8"))
    assert [l.appid for l in listings] == ["111", "222"]
    assert listings[0].released == datetime(2026, 9, 5).date() and listings[0].discount == 0
    assert listings[1].discount == 40 and listings[1].final_price == "¥1,140"
    assert listings[1].title == "Second Title & More"
    assert listings[1].image_url.startswith("https://shared.") and "?" not in listings[1].image_url


@pytest.mark.asyncio
async def test_steam_drafts_only_for_matched_vns():
    async def match(site, value):
        return VN if value == "222" else None

    listings = parse_results((FIX / "steam_results.html").read_text(encoding="utf-8"))
    released = await drafts_from_listings(listings, "released", match, NOW)
    assert [d.vn_id for d in released] == ["v1"]
    assert released[0].source == "steam" and released[0].tags == ["released"]
    assert released[0].url == "https://store.steampowered.com/app/222/"
    assert released[0].image_is_nsfw is False
    # A matched row carries the developer names in both scripts, in the same order.
    assert released[0].extra["developers"] == VN.developers
    assert released[0].extra["developers_original"] == VN.developers_original
    sale = await drafts_from_listings(listings, "sale", match, NOW)
    assert sale[0].key == "222-sale-40" and sale[0].extra["discount"] == 40


@pytest.mark.asyncio
async def test_steam_released_window_drops_old_listings():
    async def match(site, value):
        return VN

    listings = parse_results((FIX / "steam_results.html").read_text(encoding="utf-8"))
    later = datetime(2026, 10, 1, tzinfo=timezone.utc)
    assert await drafts_from_listings(listings, "released", match, later) == []


def test_moeaward_list_items():
    drafts = parse_news_list((FIX / "moeaward.html").read_text(encoding="utf-8"), NOW)
    assert len(drafts) == 2
    assert drafts[0].url == "https://www.moe-gameaward.com/news/index.html?id=432"
    assert drafts[0].source == "rss" and drafts[0].source_label == "萌えゲーアワード"
    assert drafts[0].published_at.date() == datetime(2026, 9, 1).date()
    assert drafts[0].item_id == "rss-moeaward-432"
