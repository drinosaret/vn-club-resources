from datetime import datetime, timezone
from pathlib import Path

import pytest

from app.services.news.adapters.freem import drafts_from_works, parse_detail, parse_listing
from app.services.news.matching import MatchedVN

FIX = Path(__file__).parent / "fixtures" / "news"
NOW = datetime(2026, 9, 6, 12, 0, tzinfo=timezone.utc)
VN = MatchedVN("v1", "Title", "タイトル", "Title", "https://t.vndb.org/cv/01/1.jpg", 2.0, 0, ["Studio"], ["スタジオ"])


async def no_match(site, value):
    return None


async def match_first(site, value):
    assert site == "freem"
    return VN if value == "40000001" else None


def _games():
    return parse_listing((FIX / "freem_list.html").read_text(encoding="utf-8"))


def test_listing_reads_the_list_and_skips_the_recommendations():
    games = _games()
    assert [g.game_id for g in games] == ["40000001", "40000002", "40000003"]
    first = games[0]
    assert first.title == "First Free Novel" and first.circle == "Circle A"
    assert first.blurb == "A short story about a delivery at midnight."
    assert first.image_url == "https://fpiccdn.com/40000001s/w200/h150/mcrop/ejpg/?aaaa"
    assert games[1].title == "Second Free Novel & Co"
    assert games[2].blurb is None and games[2].circle == "Circle C"


def test_detail_reads_registration_day_and_picture():
    detail = parse_detail((FIX / "freem_game.html").read_text(encoding="utf-8"))
    assert detail.registered == datetime(2026, 9, 3).date()
    assert detail.image_url == "https://fpiccdn.com/40000001/w500/h0/mratio/ejpg/?aaaa"
    # The label is served in the request language.
    english = parse_detail("<tr><th>[Registered]</th><td>2026-09-02</td></tr>")
    assert english.registered == datetime(2026, 9, 2).date()
    assert parse_detail("<html></html>").registered is None


@pytest.mark.asyncio
async def test_drafts_are_free_all_ages_rows_dated_by_registration():
    games = _games()
    games[0].registered = datetime(2026, 9, 3).date()
    games[1].registered = datetime(2026, 8, 1).date()
    drafts = await drafts_from_works(games, match_first, NOW)
    assert [d.key for d in drafts] == ["40000001", "40000003"]
    matched, own = drafts
    assert matched.source == "freem" and matched.source_label == "ふりーむ！"
    assert matched.vn_id == "v1" and matched.title == "Title"
    assert matched.summary == "Circle A / A short story about a delivery at midnight."
    assert matched.url == "https://www.freem.ne.jp/win/game/40000001"
    assert matched.published_at.date() == datetime(2026, 9, 3).date()
    assert matched.extra["final_price"] == "無料" and matched.extra["released"] == "2026-09-03"
    assert matched.extra["developers"] == ["Studio"] and matched.tags == ["released"]
    # A catalogue cover carries its own rating.
    assert matched.image_url == VN.image_url and matched.image_is_nsfw is True
    assert own.vn_id is None and own.title == "Third Free Novel" and own.summary == "Circle C"
    assert own.image_is_nsfw is False and own.published_at == NOW
    assert own.image_url.startswith("https://fpiccdn.com/") and own.extra["developers"] == ["Circle C"]
