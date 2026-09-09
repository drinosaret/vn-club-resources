from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
import pytest_asyncio
from sqlalchemy import delete, select

from app.db.database import async_session_maker, engine
from app.db.models import NewsItem, PostedItemsTracker, VisualNovel
from app.services.news import store
from app.services.news.drafts import NewsDraft

NOW = datetime.now(timezone.utc)


@pytest_asyncio.fixture(autouse=True)
async def _fresh_pool(live_database):
    """Pooled connections belong to the loop that opened them, and each test gets its own."""
    yield
    await engine.dispose()


def _draft(key="k1", **over):
    base = dict(source="rss", source_label="T", key=key, title="title", published_at=NOW)
    base.update(over)
    return NewsDraft(**base)


async def _purge(source: str, *ids: str):
    async with async_session_maker() as db:
        await db.execute(delete(NewsItem).where(NewsItem.id.in_(ids)))
        await db.execute(
            delete(PostedItemsTracker).where(
                PostedItemsTracker.source == source,
                PostedItemsTracker.item_id.in_([i[len(source) + 1 :] for i in ids]),
            )
        )
        await db.commit()


@pytest.mark.asyncio
async def test_save_drafts_skips_duplicates_and_respects_cap():
    d1, d2, d3 = _draft("test-t1"), _draft("test-t2"), _draft("test-t3")
    try:
        async with async_session_maker() as db:
            assert await store.save_drafts(db, [d1, d2, d3], cap=2) == 2
            assert await store.save_drafts(db, [d1, d2, d3]) == 1
            assert await store.save_drafts(db, [d1]) == 0
    finally:
        await _purge("rss", d1.item_id, d2.item_id, d3.item_id)


@pytest.mark.asyncio
async def test_refresh_existing_updates_last_seen():
    d = _draft("test-sale1", source="steam", tags=["sale"], extra={"discount": 10})
    try:
        async with async_session_maker() as db:
            await store.save_drafts(db, [d])
            d.extra = {"discount": 20}
            assert await store.save_drafts(db, [d], refresh_existing=True) == 0
        async with async_session_maker() as db:
            row = await db.get(NewsItem, d.item_id)
            assert row.extra_data["discount"] == 20
            assert "last_seen" in row.extra_data
    finally:
        await _purge("steam", d.item_id)


@pytest.mark.asyncio
async def test_reconcile_removes_rows_and_cover_files_of_missing_vns(tmp_path: Path):
    old = NOW - timedelta(days=5)
    async with async_session_maker() as db:
        real_id = (await db.execute(select(VisualNovel.id).limit(1))).scalar_one_or_none()
    if real_id is None:
        pytest.skip("empty catalogue")
    missing = _draft(
        "v99999901", source="vndb", vn_id="v99999901",
        image_url="https://t.vndb.org/cv/01/999901.jpg", published_at=old,
    )
    present = _draft(
        real_id, source="vndb", vn_id=real_id,
        image_url="https://t.vndb.org/cv/02/999902.jpg", published_at=old,
    )
    fresh = _draft("v99999903", source="vndb", vn_id="v99999903", published_at=NOW)
    for stem in ("cv/01/999901", "cv/02/999902"):
        for suffix in (".jpg", ".webp", "-w128.webp", "-w512.webp"):
            p = tmp_path / (stem + suffix)
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(b"x")
    try:
        async with async_session_maker() as db:
            await store.save_drafts(db, [missing, present, fresh])
            result = await store.reconcile_deleted_vns(db, tmp_path)
        if result.skipped:
            pytest.skip("catalogue too small to reconcile against")
        # Other rows in a shared database may point at missing entries too; only the files
        # under the temporary cache are countable exactly.
        assert result.rows_deleted >= 1 and result.files_deleted == 4
        assert not (tmp_path / "cv/01/999901.jpg").exists()
        assert (tmp_path / "cv/02/999902.jpg").exists()
        async with async_session_maker() as db:
            assert await db.get(NewsItem, missing.item_id) is None
            assert await db.get(NewsItem, present.item_id) is not None
            assert await db.get(NewsItem, fresh.item_id) is not None
    finally:
        await _purge("vndb", missing.item_id, present.item_id, fresh.item_id)


@pytest.mark.asyncio
async def test_post_repeating_a_filed_article_is_skipped():
    article = _draft("test-article", url="https://example.test/news/xyz")
    post = _draft("test-post", source="twitter", extra={"expanded_urls": ["https://example.test/news/xyz"]})
    try:
        async with async_session_maker() as db:
            assert await store.save_drafts(db, [article]) == 1
            assert await store.save_drafts(db, [post]) == 0
    finally:
        await _purge("rss", article.item_id)
        await _purge("twitter", post.item_id)


@pytest.mark.asyncio
async def test_save_drafts_collapses_duplicates_within_a_batch():
    a, b = _draft("test-dup"), _draft("test-dup", title="second copy")
    try:
        async with async_session_maker() as db:
            assert await store.save_drafts(db, [a, b]) == 1
    finally:
        await _purge("rss", a.item_id)


@pytest.mark.asyncio
async def test_same_address_is_filed_once_across_sources():
    ids = ("review-url1", "note-url2")
    await _purge("review", ids[0])
    await _purge("note", ids[1])
    try:
        async with async_session_maker() as db:
            first = _draft("url1", source="review", url="https://example.test/post/1")
            second = _draft("url2", source="note", url="https://example.test/post/1", title="other")
            assert await store.save_drafts(db, [first]) == 1
            assert await store.save_drafts(db, [second]) == 0
    finally:
        await _purge("review", ids[0])
        await _purge("note", ids[1])


@pytest.mark.asyncio
async def test_unknown_keys_skips_what_the_tracker_holds():
    await _purge("vndb_review", "vndb_review-wk1")
    try:
        async with async_session_maker() as db:
            await store.save_drafts(db, [_draft("wk1", source="vndb_review")])
            assert await store.unknown_keys(db, "vndb_review", ["wk1", "wk2"]) == ["wk2"]
            assert await store.unknown_keys(db, "vndb_review", []) == []
    finally:
        await _purge("vndb_review", "vndb_review-wk1")


# One article as three relays printed it: bare, with the outlet named, with a picture count.
_RELAYED = "PC向けビジュアルノベル『架空の星図』、コンソール版が発売決定！ 「非常に好評」なSFミステリーがPS/スイッチでも遊べるように"
_RELAYED_WITH_OUTLET = _RELAYED + " (インサイド)"
_RELAYED_WITH_COUNT = _RELAYED + " 6枚目の写真・画像"


def test_relays_of_one_article_share_a_normalised_title():
    key = store.normalise_title(_RELAYED)
    assert key
    assert store.normalise_title(_RELAYED_WITH_OUTLET) == key
    assert store.normalise_title(_RELAYED_WITH_COUNT) == key
    # The full-width brackets a Japanese relay uses read the same as the plain ones.
    assert store.normalise_title(_RELAYED + " （インサイド）") == key


def test_two_different_headlines_keep_their_own_titles():
    assert store.normalise_title("新作ノベルゲームを発表") != store.normalise_title(
        "新作アクションゲームを発表"
    )
    assert store.normalise_title("") == ""


@pytest.mark.asyncio
async def test_a_post_crossposted_to_another_network_is_filed_once():
    """A brand that posts the same text to Bluesky and X gives each copy its own address,
    so the text has to be the identity."""
    text = "Today is the birthday of a heroine from a well known title, celebrate with us!"
    first = _draft("xpost-a", source="bluesky", title=text, url="https://bsky.app/profile/x/post/1")
    second = _draft("xpost-b", source="twitter", title=text, url="https://x.com/x/status/2")
    try:
        async with async_session_maker() as db:
            assert await store.save_drafts(db, [first]) == 1
            assert await store.save_drafts(db, [second]) == 0
            assert await store.save_drafts(db, [first, second]) == 0
    finally:
        await _purge("bluesky", first.item_id)
        await _purge("twitter", second.item_id)


@pytest.mark.asyncio
async def test_a_post_is_not_dropped_for_matching_an_article_headline():
    """The cross-post rule is judged among social posts only; a brand quoting a press
    headline is still its own row."""
    text = "A studio announces a new title for the coming winter season"
    article = _draft("xpost-art", source="rss", title=text, url="https://example.test/n/1")
    post = _draft("xpost-post", source="twitter", title=text, url="https://x.com/x/status/3")
    try:
        async with async_session_maker() as db:
            assert await store.save_drafts(db, [article]) == 1
            assert await store.save_drafts(db, [post]) == 1
    finally:
        await _purge("rss", article.item_id)
        await _purge("twitter", post.item_id)


@pytest.mark.asyncio
async def test_two_posts_sharing_an_opening_line_are_both_filed():
    """A brand opens many posts the same way; the whole post is the identity."""
    first = _draft("xpost-o1", source="twitter", title="[Title] Character introduction (A)",
                   summary="Meet the first heroine.", url="https://x.com/x/status/11")
    second = _draft("xpost-o2", source="twitter", title="[Title] Character introduction (B)",
                    summary="Meet the second heroine.", url="https://x.com/x/status/12")
    try:
        async with async_session_maker() as db:
            assert await store.save_drafts(db, [first]) == 1
            assert await store.save_drafts(db, [second]) == 1
    finally:
        await _purge("twitter", first.item_id, second.item_id)


def test_the_crosspost_key_keeps_the_trailing_parenthetical():
    """Relays drop the outlet a headline names in brackets; a post keeps its own."""
    assert store.crosspost_key("Intro (A)", None) != store.crosspost_key("Intro (B)", None)
    assert store.crosspost_key("Same  text!", "") == store.crosspost_key("same text", None)
