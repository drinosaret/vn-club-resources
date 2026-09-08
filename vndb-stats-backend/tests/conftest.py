import os
import sys

# Ensure the backend root is on sys.path so `app.*` imports work when running pytest.
BACKEND_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if BACKEND_ROOT not in sys.path:
    sys.path.insert(0, BACKEND_ROOT)

import pytest


@pytest.fixture(autouse=True)
def _profile_cache_off(monkeypatch):
    """Keep the reader-profile cache out of every test.

    The engine reads a built profile back from the shared store before computing one, so
    a test that counts the rows a build loads, or that changes a loader between two
    builds, would otherwise see whatever an earlier test left behind.
    """
    from app.services import hybrid_recommender

    async def _miss(key):
        return None

    async def _drop(key, profile):
        return None

    monkeypatch.setattr(hybrid_recommender, "read_profile", _miss)
    monkeypatch.setattr(hybrid_recommender, "write_profile", _drop)


def _database_reachable() -> bool:
    import socket

    from sqlalchemy.engine import make_url

    from app.config import get_settings

    url = make_url(get_settings().database_url)
    try:
        with socket.create_connection((url.host or "localhost", url.port or 5432), timeout=3):
            return True
    except OSError:
        return False


@pytest.fixture(scope="session")
def live_database():
    """Tests that read the catalogue skip where no database answers, so the suite also
    passes on a bare runner."""
    if not _database_reachable():
        pytest.skip("no database reachable")
