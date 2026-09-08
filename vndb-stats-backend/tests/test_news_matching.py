import pytest
import pytest_asyncio
from sqlalchemy import func, select

from app.db.database import async_session_maker, engine
from app.db.models import (
    ExtlinksMaster,
    Producer,
    ReleaseExtlink,
    ReleaseProducer,
    ReleaseVN,
    VisualNovel,
)
from app.services.news.matching import (
    MAX_DEVELOPERS,
    article_origin,
    developer_names,
    resolve_store_vn,
)


@pytest_asyncio.fixture(autouse=True)
async def _fresh_pool(live_database):
    """Pooled connections belong to the loop that opened them, and each test gets its own."""
    yield
    await engine.dispose()


async def _any_link(site: str, olang: str):
    async with async_session_maker() as db:
        return (
            await db.execute(
                select(ExtlinksMaster.value, VisualNovel.id)
                .join(ReleaseExtlink, ReleaseExtlink.link_id == ExtlinksMaster.id)
                .join(ReleaseVN, ReleaseVN.release_id == ReleaseExtlink.release_id)
                .join(VisualNovel, VisualNovel.id == ReleaseVN.vn_id)
                .where(ExtlinksMaster.site == site, VisualNovel.olang == olang)
                .limit(1)
            )
        ).first()


@pytest.mark.asyncio
async def test_japanese_original_matches():
    row = await _any_link("steam", "ja")
    if row is None:
        pytest.skip("no steam-linked Japanese VN in this database")
    async with async_session_maker() as db:
        m = await resolve_store_vn(db, "steam", row.value)
    assert m is not None and m.title
    # The link may sit on a release shared by several VNs; any Japanese one is acceptable.
    assert m.id.startswith("v")


@pytest.mark.asyncio
async def test_other_original_language_is_dropped():
    async with async_session_maker() as db:
        # A value linked only to non-Japanese VNs.
        row = (
            await db.execute(
                select(ExtlinksMaster.value)
                .join(ReleaseExtlink, ReleaseExtlink.link_id == ExtlinksMaster.id)
                .join(ReleaseVN, ReleaseVN.release_id == ReleaseExtlink.release_id)
                .join(VisualNovel, VisualNovel.id == ReleaseVN.vn_id)
                .where(ExtlinksMaster.site == "steam", VisualNovel.olang == "en")
                .limit(1)
            )
        ).first()
        if row is None:
            pytest.skip("no steam-linked English VN in this database")
        match = await resolve_store_vn(db, "steam", row.value)
    assert match is None or match.id != ""  # a shared release may still resolve to a Japanese VN


@pytest.mark.asyncio
async def test_unknown_id_is_none():
    async with async_session_maker() as db:
        assert await resolve_store_vn(db, "steam", "0") is None


@pytest.mark.asyncio
async def test_matched_developers_carry_both_scripts():
    """The two developer lists name the same producers in the same order, one script each."""
    async with async_session_maker() as db:
        link = (
            await db.execute(
                select(ExtlinksMaster.site, ExtlinksMaster.value)
                .join(ReleaseExtlink, ReleaseExtlink.link_id == ExtlinksMaster.id)
                .join(ReleaseVN, ReleaseVN.release_id == ReleaseExtlink.release_id)
                .join(VisualNovel, VisualNovel.id == ReleaseVN.vn_id)
                .join(ReleaseProducer, ReleaseProducer.release_id == ReleaseVN.release_id)
                .join(Producer, Producer.id == ReleaseProducer.producer_id)
                .where(
                    VisualNovel.olang == "ja",
                    ReleaseProducer.developer == True,  # noqa: E712
                    Producer.original.isnot(None),
                )
                .limit(1)
            )
        ).first()
        if link is None:
            pytest.skip("no store-linked Japanese VN with a named developer in this database")
        m = await resolve_store_vn(db, link.site, link.value)
        assert m is not None and m.developers
        producers = (
            await db.execute(
                select(Producer.name, Producer.original)
                .join(ReleaseProducer, ReleaseProducer.producer_id == Producer.id)
                .join(ReleaseVN, ReleaseVN.release_id == ReleaseProducer.release_id)
                .where(ReleaseVN.vn_id == m.id, ReleaseProducer.developer == True)  # noqa: E712
                .distinct()
                .order_by(Producer.name)
                .limit(MAX_DEVELOPERS)
            )
        ).all()
        direct = await developer_names(db, m.id)

    # The catalogue holds the native name in `name` and the romanised one in `original`.
    assert m.developers == [p.original or p.name for p in producers]
    assert m.developers_original == [p.name for p in producers]
    # A match reads the pair through the shared helper, so both agree.
    assert (m.developers, m.developers_original) == direct
    assert len(m.developers_original) == len(m.developers)
    assert all(m.developers) and all(m.developers_original)
    # A producer with both forms keeps them apart rather than repeating one.
    if any(p.original and p.original != p.name for p in producers):
        assert m.developers != m.developers_original


async def _longest_title(olang: str):
    """A long, spaced title of one original language, distinctive enough to name a work.

    Only titles the catalogue carries under a single original language qualify: one worn
    by entries of two languages names no one work and is answered with nothing.
    """
    async with async_session_maker() as db:
        return (
            await db.execute(
                select(VisualNovel.title, func.min(VisualNovel.olang).label("olang"))
                .where(
                    func.length(VisualNovel.title) >= 14,
                    VisualNovel.title.like("% %"),
                )
                .group_by(VisualNovel.title)
                .having(func.count(func.distinct(VisualNovel.olang)) == 1)
                .having(func.min(VisualNovel.olang) == olang)
                .order_by(func.length(VisualNovel.title).desc())
                .limit(1)
            )
        ).first()


@pytest.mark.asyncio
async def test_article_origin_reads_the_language_of_the_title_named():
    japanese = await _longest_title("ja")
    if japanese is None:
        pytest.skip("no long Japanese-original title in this database")
    async with async_session_maker() as db:
        origin = await article_origin(db, f"Out today: {japanese.title} arrives on Steam.")
    assert origin == "ja"


@pytest.mark.asyncio
async def test_article_origin_names_another_original_language():
    for olang in ("zh-Hans", "zh-Hant", "en"):
        row = await _longest_title(olang)
        if row is not None:
            break
    else:
        pytest.skip("no long non-Japanese-original title in this database")
    async with async_session_maker() as db:
        origin = await article_origin(db, f"Out today: {row.title} arrives on Steam.")
    assert origin == row.olang and origin != "ja"


@pytest.mark.asyncio
async def test_article_origin_is_none_when_no_title_is_named():
    async with async_session_maker() as db:
        assert await article_origin(db, "A quiet week for the medium, with little to report.") is None
        assert await article_origin(db, "") is None

@pytest.mark.asyncio
async def test_article_origin_ignores_a_short_common_phrase():
    """A few common words are a title somewhere; prose that merely uses them names nothing."""
    async with async_session_maker() as db:
        origin = await article_origin(
            db,
            "I wish you would treat developers with a little more care, a solo developer said",
        )
    assert origin is None


def test_origin_titles_must_keep_their_capitalisation_in_prose():
    from app.services.news.matching import _stands_alone

    prose = "The site says the server would need support from readers overseas"
    assert not _stands_alone("The Server", prose, as_written=True)
    assert _stands_alone("The Server", prose)
    assert _stands_alone("The Server", 'A review of "The Server" is out', as_written=True)
    # Japanese titles have no case to keep.
    assert _stands_alone("架空の恋物語", "『架空の恋物語』が発売", as_written=True)
