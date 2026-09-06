"""Catalogue-wide facts are computed once per process per day, not once per request."""

import asyncio

from app.services import catalogue_cache


def test_daily_value_is_computed_once_until_it_expires(monkeypatch):
    calls = []

    async def build():
        calls.append(1)
        return {"x": 1}

    clock = [1000.0]
    monkeypatch.setattr(catalogue_cache.time, "monotonic", lambda: clock[0])
    store = catalogue_cache.DailyValue(build)

    assert asyncio.run(store.get()) == {"x": 1}
    assert asyncio.run(store.get()) == {"x": 1}
    assert calls == [1]

    clock[0] += catalogue_cache.TTL_SECONDS + 1
    assert asyncio.run(store.get()) == {"x": 1}
    assert calls == [1, 1]


def test_a_failed_build_is_not_cached(monkeypatch):
    attempts = []

    async def build():
        attempts.append(1)
        if len(attempts) == 1:
            raise RuntimeError("down")
        return 7

    store = catalogue_cache.DailyValue(build)
    try:
        asyncio.run(store.get())
    except RuntimeError:
        pass
    assert asyncio.run(store.get()) == 7


def test_concurrent_first_readers_share_one_build():
    calls = []

    async def build():
        calls.append(1)
        await asyncio.sleep(0.01)
        return "v"

    store = catalogue_cache.DailyValue(build)

    async def both():
        return await asyncio.gather(store.get(), store.get())

    assert asyncio.run(both()) == ["v", "v"]
    assert calls == [1]
