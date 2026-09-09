"""Which cover addresses the mirror is willing to ask for.

The address comes from a calendar row, which carries third-party catalogue links
and hand-typed ones, and the renderer runs beside the database and the cache on
the same network.
"""

import pytest

from app.services import event_banner
from app.services.event_banner import is_public_url


@pytest.mark.parametrize(
    "url",
    [
        "https://t.vndb.org/cv/68/93368.jpg",
        "https://image.tmdb.org/t/p/w500/poster.jpg",
        "https://cdn.jiten.moe/1234/cover.webp",
        "http://example.com/a.png",
    ],
)
def test_a_public_catalogue_address_is_fetched(url):
    assert is_public_url(url)


@pytest.mark.parametrize(
    "url",
    [
        "http://db:5432/",
        "http://redis/",
        "http://api:8000/x.png",
        "http://localhost/x.png",
        "http://127.0.0.1/x.png",
        "http://[::1]/x.png",
        "http://10.0.0.5/x.png",
        "http://192.168.1.9/a.png",
        "http://172.16.4.4/a.png",
        "http://169.254.169.254/latest/meta-data",
    ],
)
def test_an_address_inside_this_network_is_refused(url):
    """A single-label name is how the services beside this one are addressed, and
    a literal address in a private range is the same request spelled
    differently."""
    assert not is_public_url(url)


@pytest.mark.parametrize("url", ["file:///etc/passwd", "ftp://example.com/a.png", "", "not a url"])
def test_a_non_web_address_is_refused(url):
    assert not is_public_url(url)


def test_a_trailing_dot_does_not_smuggle_a_local_name_through():
    assert not is_public_url("http://db./x.png")


@pytest.mark.parametrize("url", ["http://127.1/x.png", "http://0x7f.1/x.png", "http://172.18.1/x.png", "http://0177.0.0.1/x.png", "http://2130706433/x.png"])
def test_an_address_in_shorthand_or_hexadecimal_form_is_refused(url):
    """The system resolver reads these as addresses even though the address parser
    does not."""
    assert not is_public_url(url)


def _answer(*addresses):
    def fake(host, port, **kw):
        return [(None, None, None, None, (a, 0)) for a in addresses]
    return fake


@pytest.mark.asyncio
async def test_a_name_answering_with_a_private_address_is_refused(monkeypatch):
    """The name is what was checked; the address is what gets connected to."""
    monkeypatch.setattr(event_banner.socket, "getaddrinfo", _answer("10.0.0.5"))
    assert not await event_banner._resolves_public("https://images.example.test/a.png")


@pytest.mark.asyncio
async def test_a_name_answering_publicly_is_fetched(monkeypatch):
    monkeypatch.setattr(event_banner.socket, "getaddrinfo", _answer("93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"))
    assert await event_banner._resolves_public("https://images.example.test/a.png")


@pytest.mark.asyncio
async def test_a_name_with_one_private_answer_among_public_ones_is_refused(monkeypatch):
    monkeypatch.setattr(event_banner.socket, "getaddrinfo", _answer("93.184.216.34", "127.0.0.1"))
    assert not await event_banner._resolves_public("https://images.example.test/a.png")


@pytest.mark.asyncio
async def test_a_name_that_does_not_resolve_is_refused(monkeypatch):
    def fail(host, port, **kw):
        raise event_banner.socket.gaierror("no such host")
    monkeypatch.setattr(event_banner.socket, "getaddrinfo", fail)
    assert not await event_banner._resolves_public("https://nowhere.example.test/a.png")


def test_an_all_day_marker_shows_only_its_date():
    from datetime import datetime, timezone
    from app.services.event_banner import when_label
    start = datetime(2026, 10, 1, tzinfo=timezone.utc)
    assert when_label(start, start.replace(hour=23, minute=59)) == "Thu 01 Oct"
    assert "to" in when_label(start, datetime(2026, 10, 7, 23, 59, tzinfo=timezone.utc))
    assert "19:00 UTC" in when_label(start.replace(hour=19), start.replace(hour=22))
