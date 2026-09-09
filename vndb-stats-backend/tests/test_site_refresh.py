"""The rebuild asks the site to drop its cached feed, and only when it can."""

import pytest

from app.services import site_refresh


class _Response:
    def __init__(self, status_code):
        self.status_code = status_code


class _Client:
    sent = []

    def __init__(self, *a, **k):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def post(self, url, headers=None, json=None):
        _Client.sent.append((url, headers, json))
        return _Response(200)


@pytest.mark.asyncio
async def test_nothing_is_sent_without_a_shared_secret(monkeypatch):
    monkeypatch.setenv("BLACKLIST_REFRESH_SECRET", "")
    _Client.sent.clear()
    monkeypatch.setattr(site_refresh.httpx, "AsyncClient", _Client)
    assert await site_refresh.revalidate_site(["trend-feed"]) is False
    assert _Client.sent == []


@pytest.mark.asyncio
async def test_the_site_is_asked_with_the_secret_and_the_tags(monkeypatch):
    monkeypatch.setenv("BLACKLIST_REFRESH_SECRET", "s3")
    monkeypatch.setenv("FRONTEND_URL", "https://site.example.test/")
    _Client.sent.clear()
    monkeypatch.setattr(site_refresh.httpx, "AsyncClient", _Client)
    assert await site_refresh.revalidate_site(["trend-feed"]) is True
    assert _Client.sent == [
        ("https://site.example.test/api/revalidate", {"x-refresh-token": "s3"}, {"tags": ["trend-feed"]})
    ]


@pytest.mark.asyncio
async def test_a_refusal_is_reported_as_not_done(monkeypatch):
    monkeypatch.setenv("BLACKLIST_REFRESH_SECRET", "s3")
    monkeypatch.setattr(site_refresh.httpx, "AsyncClient", _Client)

    async def refused(self, url, headers=None, json=None):
        return _Response(401)

    monkeypatch.setattr(_Client, "post", refused)
    assert await site_refresh.revalidate_site(["trend-feed"]) is False


@pytest.mark.asyncio
async def test_a_secret_without_a_site_address_goes_nowhere(monkeypatch):
    """A deployment that names no site must not send its secret to a default one."""
    monkeypatch.setenv("BLACKLIST_REFRESH_SECRET", "s3")
    monkeypatch.delenv("FRONTEND_URL", raising=False)
    _Client.sent.clear()
    monkeypatch.setattr(site_refresh.httpx, "AsyncClient", _Client)
    assert await site_refresh.revalidate_site(["trend-feed"]) is False
    assert _Client.sent == []
