"""Round trip through the cache's storage format."""

import json
import zlib

import pytest

from app.core import cache as cache_module
from app.core.cache import CacheService, _deflate, _inflate


def test_small_payloads_are_stored_as_plain_json():
    payload = json.dumps({"a": 1}).encode("utf-8")
    assert _deflate(payload) == payload
    assert _inflate(payload) == payload


def test_large_payloads_round_trip():
    value = {"rows": [{"rank": n, "label": f"entry {n}"} for n in range(4000)]}
    payload = json.dumps(value).encode("utf-8")
    stored = _deflate(payload)

    assert len(stored) < len(payload)
    assert json.loads(_inflate(stored)) == value


def test_plain_json_values_are_readable_as_stored():
    payload = json.dumps({"rows": ["x" * 8000]}).encode("utf-8")
    assert json.loads(_inflate(payload)) == {"rows": ["x" * 8000]}


def test_stored_form_never_begins_like_json():
    payload = json.dumps({"rows": ["x" * 8000]}).encode("utf-8")
    stored = _deflate(payload)
    assert stored[:1] not in (b"{", b"[", b'"')


@pytest.mark.parametrize("size", [0, 1, 2047, 2048, 2049, 200_000])
def test_every_size_round_trips(size):
    payload = b"x" * size
    assert _inflate(_deflate(payload)) == payload


class _FakeRedis:
    def __init__(self):
        self.store: dict[str, bytes] = {}

    async def setex(self, key, ttl, value):
        self.store[key] = value

    async def set(self, key, value):
        self.store[key] = value

    async def get(self, key):
        return self.store.get(key)


@pytest.mark.asyncio
async def test_service_round_trips_a_board_sized_payload(monkeypatch):
    fake = _FakeRedis()
    service = CacheService()
    monkeypatch.setattr(service, "_get_redis", lambda: _resolved(fake))

    board = {"rows": [{"rank": n, "label": f"title {n}"} for n in range(200)]}
    assert await service.set("lb:v1:slug:example", board, ttl=60)
    assert await service.get("lb:v1:slug:example") == board

    raw = fake.store["lb:v1:slug:example"]
    assert raw.startswith(cache_module._COMPRESSED_PREFIX)
    assert len(raw) < len(json.dumps(board).encode("utf-8"))


@pytest.mark.asyncio
async def test_service_reads_a_value_stored_as_plain_json(monkeypatch):
    fake = _FakeRedis()
    fake.store["plain"] = json.dumps({"kept": True}).encode("utf-8")
    service = CacheService()
    monkeypatch.setattr(service, "_get_redis", lambda: _resolved(fake))

    assert await service.get("plain") == {"kept": True}


async def _resolved(value):
    return value


def test_marker_cannot_be_produced_by_the_compressor():
    """The marker is prepended, so a deflate stream must not be mistaken for one."""
    stream = zlib.compress(b"x" * 10_000, 6)
    assert not stream.startswith(cache_module._COMPRESSED_PREFIX)
