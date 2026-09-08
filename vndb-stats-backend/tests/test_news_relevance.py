import pytest
import pytest_asyncio
from sqlalchemy import func, select

from app.db.database import async_session_maker, engine
from app.db.models import Producer, VisualNovel
from app.services.news.relevance import (
    is_vn_related,
    links_vn_host,
    names_catalogue_entry,
    names_vn_term,
)


@pytest_asyncio.fixture(autouse=True)
async def _fresh_pool(live_database):
    """Pooled connections belong to the loop that opened them, and each test gets its own."""
    yield
    await engine.dispose()


def test_a_short_term_is_a_word_not_a_fragment():
    assert not names_vn_term("[META] This subreddit needs to chill about advice")
    assert names_vn_term("Reading a VN tonight, any recommendations?")
    assert names_vn_term("An ADV with a good common route")
    assert not names_vn_term("The studio announced an advance payment")


def test_a_longer_term_still_matches_inside_a_word():
    assert names_vn_term("A list of visual novels worth reading")
    assert names_vn_term("otome picks for September")


def test_a_japanese_term_places_a_post():
    assert names_vn_term("新作エロゲの発売日が決まった")
    assert names_vn_term("ノベルゲームの話をしよう")
    assert not names_vn_term("今日は天気がいいですね")


def test_a_link_to_a_catalogue_or_a_store_places_a_post():
    assert links_vn_host(["https://vndb.org/v17"])
    assert links_vn_host(["https://www.dlsite.com/maniax/work/=/product_id/RJ01.html"])
    assert links_vn_host(["https://example.test/a", "https://booth.pm/en/items/1"])
    assert not links_vn_host(["https://example.test/a"])
    assert not links_vn_host([])
    assert not links_vn_host([None, 42])


@pytest.mark.asyncio
async def test_a_catalogue_title_places_a_post():
    async with async_session_maker() as db:
        row = (
            await db.execute(
                select(VisualNovel.title)
                .where(
                    VisualNovel.olang == "ja",
                    func.length(VisualNovel.title) >= 12,
                    VisualNovel.title.like("% %"),
                )
                .order_by(func.length(VisualNovel.title).desc())
                .limit(1)
            )
        ).first()
        if row is None:
            pytest.skip("no long Japanese-original title in this database")
        assert await names_catalogue_entry(db, f"Just finished {row.title} last night")


@pytest.mark.asyncio
async def test_a_producer_name_places_a_post():
    async with async_session_maker() as db:
        row = (
            await db.execute(
                select(Producer.name)
                .where(func.length(Producer.name) >= 6, Producer.name.op("~")("[぀-ヿ一-鿿]"))
                .order_by(func.length(Producer.name).desc())
                .limit(1)
            )
        ).first()
        if row is None:
            pytest.skip("no long Japanese producer name in this database")
        assert await names_catalogue_entry(db, f"{row.name}の新作が気になる")


@pytest.mark.asyncio
async def test_a_post_about_something_else_is_not_placed():
    async with async_session_maker() as db:
        assert not await is_vn_related(db, "【箱1】TES V:SKYRIM スカイリム エロネタ part81")
        assert not await is_vn_related(db, "[META] This subreddit needs to chill")
        assert not await is_vn_related(db, "")


@pytest.mark.asyncio
async def test_any_one_of_the_three_tests_is_enough():
    async with async_session_maker() as db:
        assert await is_vn_related(db, "Reading a VN tonight")
        assert await is_vn_related(db, "Look at this", links=["https://vndb.org/v17"])
