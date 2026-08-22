"""The catalogue is cached, so it can outlive the registry that built it."""

import asyncio

import pytest

pytest.importorskip("httpx")
pytest.importorskip("redis")

from fastapi import Response

from app.api.v1 import leaderboards as api
from app.leaderboards.registry import BOARDS
from app.leaderboards.spec import CATALOGUE_CACHE_KEY


class _StubCache:
    def __init__(self, store):
        self.store = store

    async def get(self, key):
        return self.store.get(key)

    async def set(self, key, value, ttl=None):
        self.store[key] = value
        return True


class _StubRequest:
    headers: dict = {}


def _entry(slug: str) -> dict:
    return {
        "slug": slug,
        "title": slug,
        "blurb": "",
        "subject": "vn",
        "metric": "votes",
        "window": "all",
        "facet_description": "",
        "total_ranked": 1,
    }


def _catalogue(monkeypatch, cached):
    monkeypatch.setattr(api, "get_cache", lambda: _StubCache({CATALOGUE_CACHE_KEY: cached}))
    return asyncio.run(api.get_catalogue(_StubRequest(), Response()))


def test_cached_catalogue_is_served_as_stored(monkeypatch):
    stored = {"boards": [_entry(board.slug) for board in BOARDS]}
    served = _catalogue(monkeypatch, stored)
    assert [b["slug"] for b in served["boards"]] == [board.slug for board in BOARDS]


def test_board_dropped_from_the_registry_is_not_advertised(monkeypatch):
    # A slug the registry no longer defines answers 404 on its own route, so listing it
    # here would put a card on the page that leads nowhere.
    stored = {"boards": [_entry(board.slug) for board in BOARDS] + [_entry("retired-board")]}
    served = _catalogue(monkeypatch, stored)
    slugs = [b["slug"] for b in served["boards"]]
    assert "retired-board" not in slugs
    assert len(slugs) == len(BOARDS)


def test_etag_covers_the_filtered_body(monkeypatch):
    # The etag is what a conditional request is answered against, so it has to describe
    # what was sent rather than what was stored.
    kept = {"boards": [_entry(board.slug) for board in BOARDS]}
    stale = {"boards": kept["boards"] + [_entry("retired-board")]}

    from_clean = Response()
    monkeypatch.setattr(api, "get_cache", lambda: _StubCache({CATALOGUE_CACHE_KEY: kept}))
    asyncio.run(api.get_catalogue(_StubRequest(), from_clean))

    from_stale = Response()
    monkeypatch.setattr(api, "get_cache", lambda: _StubCache({CATALOGUE_CACHE_KEY: stale}))
    asyncio.run(api.get_catalogue(_StubRequest(), from_stale))

    assert from_clean.headers["ETag"] == from_stale.headers["ETag"]


def test_empty_cache_falls_back_to_the_registry(monkeypatch):
    monkeypatch.setattr(api, "get_cache", lambda: _StubCache({}))
    served = asyncio.run(api.get_catalogue(_StubRequest(), Response()))
    assert len(served["boards"]) == len(BOARDS)
