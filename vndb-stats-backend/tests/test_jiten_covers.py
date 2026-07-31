import asyncio

import pytest

# Needs httpx and the redis-backed cache; the minimal unit venv omits both, so
# skip there. The full suite (Docker/CI) runs them.
pytest.importorskip("httpx")
pytest.importorskip("redis")

import httpx

from app.services import jiten_covers as jc


class _StubCache:
    """Stands in for the Redis cache so tests don't need a live server."""

    def __init__(self):
        self.store = {}

    async def get(self, key):
        return self.store.get(key)

    async def set(self, key, value, ttl=None):
        self.store[key] = value
        return True


@pytest.fixture(autouse=True)
def isolated(monkeypatch):
    """Fresh cache + locks per test; jiten_covers memoizes at module scope."""
    cache = _StubCache()
    monkeypatch.setattr(jc, "get_cache", lambda: cache)
    monkeypatch.setattr(jc, "_deck_locks", {})
    monkeypatch.setattr(jc, "_cover_locks", {})
    monkeypatch.setattr(jc, "_RETRY_DELAYS", ())  # no backoff sleeps in tests
    return cache


def _mock_http(monkeypatch, handler, counter=None):
    """Route jiten_covers' httpx calls to a handler, optionally counting them."""
    real_client = httpx.AsyncClient

    def factory(*args, **kwargs):
        def _handle(request):
            if counter is not None:
                counter.append(request.url.path)
            return handler(request)

        kwargs["transport"] = httpx.MockTransport(_handle)
        return real_client(*args, **kwargs)

    monkeypatch.setattr(jc.httpx, "AsyncClient", factory)


# ── resolve_deck_id ────────────────────────────────────────

def test_deck_lookup_returns_first_id(monkeypatch):
    _mock_http(monkeypatch, lambda r: httpx.Response(200, json=[42, 99]))
    assert asyncio.run(jc.resolve_deck_id("v17")) == 42


def test_4xx_means_not_on_jiten(monkeypatch):
    _mock_http(monkeypatch, lambda r: httpx.Response(404, json={}))
    assert asyncio.run(jc.resolve_deck_id("v17")) is None


def test_5xx_raises_rather_than_caching_a_false_negative(monkeypatch, isolated):
    _mock_http(monkeypatch, lambda r: httpx.Response(503, json={}))
    with pytest.raises(Exception):
        asyncio.run(jc.resolve_deck_id("v17"))
    # Nothing cached, so the next call retries instead of reporting "no deck"
    # for a full hour because jiten happened to be down.
    assert isolated.store == {}


def test_empty_id_list_is_a_negative(monkeypatch):
    _mock_http(monkeypatch, lambda r: httpx.Response(200, json=[]))
    assert asyncio.run(jc.resolve_deck_id("v17")) is None


@pytest.mark.parametrize(
    "bad", ["", "17", "v", "v1/../../etc", "v1?x=1", "v-1", "vv1", "v1 2", "v" + "9" * 20]
)
def test_malformed_vndb_id_never_reaches_the_network(monkeypatch, bad):
    """The id is spliced into a request path, so its shape is enforced rather
    than assumed from the caller."""
    calls = []
    _mock_http(monkeypatch, lambda r: httpx.Response(200, json=[1]), counter=calls)
    assert asyncio.run(jc.resolve_deck_id(bad)) is None
    assert calls == []


# ── get_sfw_cover_url ──────────────────────────────────────

def _deck_and_detail(cover_name):
    def handler(request):
        if "by-link-id" in request.url.path:
            return httpx.Response(200, json=[42])
        return httpx.Response(200, json={"data": {"mainDeck": {"coverName": cover_name}}})

    return handler


def test_cover_url_is_composed_from_the_deck_id(monkeypatch):
    _mock_http(monkeypatch, _deck_and_detail("cover.jpg"))
    assert asyncio.run(jc.get_sfw_cover_url("v17")) == "https://cdn.jiten.moe/42/cover.jpg"


def test_no_cover_art_means_no_url(monkeypatch):
    # A composed URL for a deck with no cover would 404 in the embed.
    _mock_http(monkeypatch, _deck_and_detail(None))
    assert asyncio.run(jc.get_sfw_cover_url("v17")) is None


def test_jiten_outage_degrades_to_none(monkeypatch):
    _mock_http(monkeypatch, lambda r: httpx.Response(500, json={}))
    assert asyncio.run(jc.get_sfw_cover_url("v17")) is None


def test_concurrent_lookups_make_one_request(monkeypatch):
    calls = []
    _mock_http(monkeypatch, _deck_and_detail("cover.jpg"), counter=calls)

    async def run():
        return await asyncio.gather(*[jc.get_sfw_cover_url("v17") for _ in range(5)])

    results = asyncio.run(run())
    assert results == ["https://cdn.jiten.moe/42/cover.jpg"] * 5
    assert calls.count("/api/media-deck/by-link-id/2/v17") == 1


# ── resolve_display_cover ──────────────────────────────────

VNDB = "https://t.vndb.org/cv/17/17.jpg"


def test_safe_cover_passes_through(monkeypatch):
    _mock_http(monkeypatch, _deck_and_detail("cover.jpg"))
    assert asyncio.run(jc.resolve_display_cover("v17", VNDB, 0.3)) == (VNDB, False, True)


def test_flagged_cover_swaps_to_jiten(monkeypatch):
    _mock_http(monkeypatch, _deck_and_detail("cover.jpg"))
    url, blur, show = asyncio.run(jc.resolve_display_cover("v17", VNDB, 0.9))
    assert (url, blur, show) == ("https://cdn.jiten.moe/42/cover.jpg", False, True)


def test_flagged_cover_without_a_deck_is_blurred(monkeypatch):
    _mock_http(monkeypatch, lambda r: httpx.Response(404, json={}))
    assert asyncio.run(jc.resolve_display_cover("v17", VNDB, 0.9)) == (VNDB, True, True)


def test_blurred_mode_blurs_the_real_art_not_the_swap(monkeypatch):
    _mock_http(monkeypatch, _deck_and_detail("cover.jpg"))
    out = asyncio.run(jc.resolve_display_cover("v17", VNDB, 0.9, mode="blurred"))
    assert out == (VNDB, True, True)


def test_blurred_mode_with_no_cover_does_not_claim_a_blur(monkeypatch):
    out = asyncio.run(jc.resolve_display_cover("v17", None, 0.9, mode="blurred"))
    assert out == (None, False, True)


def test_shown_mode_never_swaps(monkeypatch):
    out = asyncio.run(jc.resolve_display_cover("v17", VNDB, 1.9, mode="shown"))
    assert out == (VNDB, False, True)


def test_hidden_mode_drops_the_cover(monkeypatch):
    assert asyncio.run(jc.resolve_display_cover("v17", VNDB, 1.9, mode="hidden")) == (None, False, False)


def test_threshold_boundary_is_inclusive(monkeypatch):
    _mock_http(monkeypatch, lambda r: httpx.Response(404, json={}))
    at = asyncio.run(jc.resolve_display_cover("v17", VNDB, jc.COVER_BLUR_THRESHOLD))
    below = asyncio.run(jc.resolve_display_cover("v17", VNDB, jc.COVER_BLUR_THRESHOLD - 0.01))
    assert at == (VNDB, True, True)
    assert below == (VNDB, False, True)
