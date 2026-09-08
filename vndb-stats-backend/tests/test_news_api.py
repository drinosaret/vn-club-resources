import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.db.database import engine
from app.main import app


@pytest_asyncio.fixture(autouse=True)
async def _fresh_pool(live_database):
    """Pooled connections belong to the loop that opened them, and each test gets its own."""
    yield
    await engine.dispose()


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://t")


@pytest.mark.asyncio
async def test_feed_pages_without_repeating():
    async with _client() as c:
        first = (await c.get("/api/v1/news/feed?section=headlines&limit=5")).json()
        assert "items" in first
        if first.get("nextCursor"):
            second = (
                await c.get(
                    f"/api/v1/news/feed?section=headlines&limit=5&before={first['nextCursor']}"
                )
            ).json()
            assert not {i["id"] for i in first["items"]} & {i["id"] for i in second["items"]}


@pytest.mark.asyncio
async def test_feed_rejects_unknown_section_and_bad_cursor():
    async with _client() as c:
        assert (await c.get("/api/v1/news/feed?section=nope")).status_code == 404
        assert (await c.get("/api/v1/news/feed?section=headlines&before=%25%25")).status_code == 400


@pytest.mark.asyncio
async def test_front_has_every_bucket():
    async with _client() as c:
        res = await c.get("/api/v1/news/front")
        assert res.status_code == 200
        body = res.json()
        for key in (
            "releasesToday", "releasesTomorrow", "catalogue", "trailers", "sale", "announcements",
            "dlsiteRanking", "reviews",
        ):
            assert isinstance(body[key], list)


@pytest.mark.asyncio
async def test_feed_language_filter_keeps_untagged_rows():
    async with _client() as c:
        ja = (await c.get("/api/v1/news/feed?section=headlines&limit=40&lang=ja")).json()["items"]
        en = (await c.get("/api/v1/news/feed?section=headlines&limit=40&lang=en")).json()["items"]
        assert all((i["extraData"] or {}).get("lang") in (None, "ja") for i in ja)
        assert all((i["extraData"] or {}).get("lang") in (None, "en") for i in en)
        assert (await c.get("/api/v1/news/feed?section=headlines&lang=xx")).status_code == 200


@pytest.mark.asyncio
async def test_dlsite_rankings_and_no_store_section():
    async with _client() as c:
        # The store's rows file under releases; the store has no section slug of its own.
        assert (await c.get("/api/v1/news/feed?section=dlsite&limit=5")).status_code == 404
        assert (await c.get("/api/v1/news/feed?section=releases&limit=5")).status_code == 200
        body = (await c.get("/api/v1/news/dlsite")).json()
        assert isinstance(body["pro"], list) and isinstance(body["maniax"], list)


@pytest.mark.asyncio
async def test_releases_page_has_every_block():
    async with _client() as c:
        res = await c.get("/api/v1/news/releases")
        assert res.status_code == 200
        body = res.json()
        for key in ("outNow", "comingUp", "onSale", "doujin"):
            assert isinstance(body[key], list)
        assert isinstance(body["dlsite"], dict) and isinstance(body["getchu"], dict)
        # A discount sorts before a smaller one, and listings ahead keep their date order.
        cuts = [(i.get("extraData") or {}).get("discount") or 0 for i in body["onSale"]]
        assert cuts == sorted(cuts, reverse=True)


@pytest.mark.asyncio
async def test_feed_after_returns_only_newer_rows():
    async with _client() as c:
        first = (await c.get("/api/v1/news/feed?section=headlines&limit=2")).json()
        assert "newestCursor" in first
        if not first.get("nextCursor"):
            return
        # The page cursor names its last row; what is newer than that is the row above it.
        newer = (
            await c.get(f"/api/v1/news/feed?section=headlines&limit=5&after={first['nextCursor']}")
        ).json()
        assert [i["id"] for i in newer["items"]] == [first["items"][0]["id"]]
        assert newer["nextCursor"] is None
        assert newer["newestCursor"] == first["newestCursor"]


@pytest.mark.asyncio
async def test_feed_after_empty_echoes_cursor():
    async with _client() as c:
        page = (await c.get("/api/v1/news/feed?section=headlines&limit=1")).json()
        cursor = page.get("newestCursor")
        if not cursor:
            return
        newer = (await c.get(f"/api/v1/news/feed?section=headlines&after={cursor}")).json()
        assert newer["items"] == []
        assert newer["newestCursor"] == cursor


@pytest.mark.asyncio
async def test_feed_rejects_both_cursors():
    async with _client() as c:
        page = (await c.get("/api/v1/news/feed?section=headlines&limit=1")).json()
        cursor = page.get("nextCursor") or page.get("newestCursor")
        if not cursor:
            return
        res = await c.get(f"/api/v1/news/feed?section=headlines&before={cursor}&after={cursor}")
        assert res.status_code == 400


@pytest.mark.asyncio
async def test_ticker_is_newest_first_and_one_row_per_vn():
    async with _client() as c:
        res = await c.get("/api/v1/news/ticker")
        assert res.status_code == 200
        items = res.json()["items"]
        assert len(items) <= 20
        stamps = [i["publishedAt"] for i in items]
        assert stamps == sorted(stamps, reverse=True)
        vn_ids = [i["vnId"] for i in items if i["vnId"] and i["source"] != "vndb_review"]
        assert len(vn_ids) == len(set(vn_ids))
        ja = (await c.get("/api/v1/news/ticker?lang=ja")).json()["items"]
        assert all((i.get("extraData") or {}).get("lang") in (None, "ja") for i in ja)


@pytest.mark.asyncio
async def test_ticker_caps_rows_per_source_label():
    async with _client() as c:
        res = await c.get("/api/v1/news/ticker")
        assert res.status_code == 200
        items = res.json()["items"]
        labels = [i["sourceLabel"] for i in items]
        counts: dict[str, int] = {}
        for label in labels:
            counts[label] = counts.get(label, 0) + 1
        assert all(count <= 3 for count in counts.values())
        stamps = [i["publishedAt"] for i in items]
        assert stamps == sorted(stamps, reverse=True)


@pytest.mark.asyncio
async def test_rail_unknown_section_is_404():
    async with _client() as c:
        assert (await c.get("/api/v1/news/rail/nope")).status_code == 404


@pytest.mark.asyncio
async def test_rail_elsewhere_skips_own_section_and_keeps_tab_order():
    async with _client() as c:
        body = (await c.get("/api/v1/news/rail/reviews")).json()
        slugs = [s["section"] for s in body["elsewhere"]]
        assert "reviews" not in slugs
        assert slugs == [
            "headlines", "releases", "community", "creators", "recently-added", "trailers",
        ]
        assert all(len(s["items"]) <= 4 for s in body["elsewhere"])
        releases = next(s for s in body["elsewhere"] if s["section"] == "releases")
        stamps = [i["publishedAt"] for i in releases["items"]]
        assert stamps == sorted(stamps, reverse=True)
        for key in ("boards", "creators", "mostReviewed", "reviewers", "trailers", "covers", "reviews"):
            assert isinstance(body[key], list)


@pytest.mark.asyncio
async def test_rail_boards_sort_by_replies_and_counts_are_ordered():
    async with _client() as c:
        body = (await c.get("/api/v1/news/rail/front")).json()
        replies = [(i.get("extraData") or {}).get("replies") for i in body["boards"]]
        known = [r for r in replies if isinstance(r, int)]
        assert known == sorted(known, reverse=True)
        counts = [v["count"] for v in body["mostReviewed"]]
        assert counts == sorted(counts, reverse=True)
        assert all(v["count"] >= 1 and v["vnId"] for v in body["mostReviewed"])
        names = [r["count"] for r in body["reviewers"]]
        assert names == sorted(names, reverse=True)
        # Each reviewer carries their catalogue page, or nothing where none was read.
        assert all("url" in r and r["name"] for r in body["reviewers"])
        assert all(
            r["url"] is None or r["url"].startswith("https://vndb.org/u")
            for r in body["reviewers"]
        )


@pytest.mark.asyncio
async def test_releases_rows_carry_the_catalogue_figures():
    async with _client() as c:
        body = (await c.get("/api/v1/news/releases")).json()
    named = [
        row
        for key in ("outNow", "comingUp", "onSale", "doujin")
        for row in body[key]
        if row.get("vnId")
    ]
    if not named:
        pytest.skip("no release row is tied to a catalogue title in this database")
    for row in named:
        extra = row.get("extraData") or {}
        # The keys are always there; a title the catalogue does not hold carries nothing.
        assert "rating" in extra and "votecount" in extra and "length_minutes" in extra
        assert extra["rating"] is None or isinstance(extra["rating"], (int, float))
        assert extra["votecount"] is None or isinstance(extra["votecount"], int)


@pytest.mark.asyncio
async def test_front_day_releases_carry_the_catalogue_figures():
    async with _client() as c:
        body = (await c.get("/api/v1/news/front")).json()
    for key in ("releasesToday", "releasesTomorrow"):
        for row in body[key]:
            if row.get("vnId"):
                assert "rating" in (row.get("extraData") or {})
