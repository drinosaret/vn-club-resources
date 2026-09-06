"""The v2 endpoint's own wiring of the relation helpers: the raw exclusion set reaches
the engine unchanged, the cache is checked against the widened one, and the continuation
strip rides along on the response without depending on which path served it.
"""

import asyncio
import inspect
from dataclasses import dataclass, field
from typing import Optional

from fastapi import params

import app.api.v1.recommendations as api


@dataclass
class _Result:
    """Stands in for RecommendationResult with just enough fields for a card to build."""

    vn_id: str = "v50"
    score: float = 5.2
    tag_score: float = 0.0
    similar_games_score: float = 0.0
    users_also_read_score: float = 0.0
    developer_score: float = 0.0
    staff_score: float = 0.0
    seiyuu_score: float = 0.0
    trait_score: float = 0.0
    quality_score: float = 0.0
    description_score: float = 0.0
    title: str = "title"
    title_jp: Optional[str] = None
    title_romaji: Optional[str] = None
    normalized_score: int = 50
    match_reasons: list = field(default_factory=list)
    image_url: Optional[str] = None
    image_sexual: float = 0.0
    rating: float = 7.0
    confidence: int = 0
    signals_ranked: int = 0
    predicted_rating: Optional[float] = None
    predicted_rating_low: Optional[float] = None
    predicted_rating_high: Optional[float] = None
    predicted_ratings: dict = field(default_factory=dict)


def _run_v2(monkeypatch, **overrides):
    """Drive the v2 endpoint with the cache, the engine and the two relation helpers all
    stood in for, and report what each one was called with.
    """
    traffic = {"reads": [], "recommend": []}

    async def _read(**kwargs):
        traffic["reads"].append(kwargs)
        return [], False

    def _write(user_id, results, reasons=None):
        async def _settled():
            return None

        return _settled()

    class _UserService:
        def __init__(self, db):
            pass

        async def get_user_list(self, vndb_uid):
            return {"labels": {"2": ["v1"]}, "votes": [{"vn_id": "v1", "score": 80}]}

    class _Recommender:
        last_pool: dict = {}
        last_signal_weights: dict = {}
        last_signal_rankings: dict = {}
        last_ranked_arms: dict = {}

        def __init__(self, db):
            pass

        async def recommend(self, **kwargs):
            traffic["recommend"].append(kwargs)
            return [_Result()]

    # The handler queries title facts for real on both paths; these tests hold no
    # session, so the lookup is stood in for like the rest of the collaborators here.
    async def _no_facts(db, vn_ids):
        return {}

    # Same reasoning as the facts lookup: the real query needs a session this test
    # does not hold.
    async def _no_last_import(db):
        return None

    # A single-signal list run reaches the Redis-backed list cache; stood in for so the
    # suite never depends on a live Redis and never leaves a key behind in one.
    class _NoListCache:
        async def get(self, key):
            return None

        async def set(self, key, value, ttl=None):
            traffic.setdefault("list_cache_writes", []).append((key, value))

    monkeypatch.setattr(api, "get_cached_recommendations", _read)
    monkeypatch.setattr(api, "cache_recommendations_async", _write)
    monkeypatch.setattr(api, "UserService", _UserService)
    monkeypatch.setattr(api, "HybridRecommender", _Recommender)
    monkeypatch.setattr(api, "title_facts", _no_facts)
    monkeypatch.setattr(api, "last_import_time", _no_last_import)
    # Relation exclusion and the continuations shelf are on by default and both read
    # the relation table; a test that has not stood them in for itself gets empty ones.
    async def _no_related(db, vn_ids):
        return set()

    async def _no_continuations(db, **kwargs):
        return []

    if api.related_to.__module__ == "app.services.recommendation_relations":
        monkeypatch.setattr(api, "related_to", _no_related)
    if api.continuations.__module__ == "app.services.recommendation_relations":
        monkeypatch.setattr(api, "continuations", _no_continuations)
    monkeypatch.setattr(api, "get_cache", lambda: _NoListCache())

    raw = inspect.unwrap(api.get_recommendations_v2)
    arguments = {
        name: parameter.default.default
        for name, parameter in inspect.signature(raw).parameters.items()
        if isinstance(parameter.default, params.Query)
    }
    arguments["limit"] = api.CACHED_PAGE_LIMIT
    arguments.update(overrides)
    response = asyncio.run(raw(request=None, vndb_uid="u1", db=None, **arguments))
    return response, traffic


def test_the_cache_read_is_widened_but_the_engine_gets_the_raw_set(monkeypatch):
    # The engine widens from the same read set on its own, so handing it an already
    # widened set would reach two hops of relations instead of one.
    async def _related_to(db, vn_ids):
        return {"v9"}

    monkeypatch.setattr(api.engine_switches, "RELATION_EXCLUSION", True)
    monkeypatch.setattr(api, "related_to", _related_to)

    _, traffic = _run_v2(monkeypatch)

    assert traffic["reads"][0]["exclude_vn_ids"] == {"v1", "v9"}
    assert traffic["recommend"][0]["exclude_vn_ids"] == {"v1"}


def test_continuations_ride_the_response_and_are_empty_off_the_combined_list(monkeypatch):
    entry = {"vn_id": "v9", "continues": {"vn_id": "v1"}}

    async def _continuations(db, **kwargs):
        return [entry]

    monkeypatch.setattr(api.engine_switches, "CONTINUATIONS", True)
    monkeypatch.setattr(api, "continuations", _continuations)

    response, _ = _run_v2(monkeypatch)
    assert response["continuations"] == [entry]

    single_signal, single_traffic = _run_v2(monkeypatch, list_name="tags")
    assert single_signal["continuations"] == []

    # The stored page is read back by requests that named no weights of their own, so
    # a block describing the request that wrote it must not ride along.
    writes = single_traffic["list_cache_writes"]
    assert len(writes) == 1
    _, stored = writes[0]
    assert "weights" not in stored
