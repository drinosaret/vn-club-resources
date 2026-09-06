"""Switches introduced by the release pass, each pinned inert at its default."""

import asyncio

import pytest

pytest.importorskip("sqlalchemy")

from sqlalchemy.dialects import postgresql

from app.db.vn_filters import VNFilterSpec
from app.services import hybrid_recommender as engine
from app.services.hybrid_recommender import HybridRecommender, switch_settings


class _Row:
    def __init__(self, **columns):
        self.__dict__.update(columns)


class _Result:
    def __init__(self, rows):
        self._rows = list(rows)

    def all(self):
        return list(self._rows)


class _Session:
    def __init__(self, rows_per_call):
        self.rows_per_call = list(rows_per_call)
        self.statements = []

    async def execute(self, statement):
        self.statements.append(statement)
        rows = self.rows_per_call.pop(0) if self.rows_per_call else []
        return _Result(rows)


def _params(statement) -> dict:
    return statement.compile(dialect=postgresql.dialect()).params


def _param_values(params: dict) -> set:
    """Flattens every bound scalar and array element into one set, for membership checks."""
    values = set()
    for value in params.values():
        if isinstance(value, (list, tuple, set)):
            values.update(value)
        else:
            values.add(value)
    return values


def test_release_pass_switch_defaults():
    # Relation exclusion and the continuations shelf are a design decision; tag centring
    # earned its default on the paired holdout; the rest stay off until one does.
    settings = switch_settings()
    assert settings["REC_RELATION_EXCLUSION"] is True
    assert settings["REC_CONTINUATIONS"] is True
    assert settings["REC_TAG_CENTERING"] == 0.5
    assert settings["REC_ENTITY_PREFERENCE"] is False
    assert settings["REC_EXPLORATION_REQUIRE_EVIDENCE"] is False
    assert settings["REC_VOTE_HALF_LIFE_DAYS"] == 0.0


def test_exclusions_unchanged_while_relation_exclusion_is_off(monkeypatch):
    monkeypatch.setattr(engine, "RELATION_EXCLUSION", False)
    session = _Session([[_Row(related_vn_id="v9")]])
    recommender = HybridRecommender(db=session)
    votes = [{"vn_id": "v1", "score": 90}]
    out = asyncio.run(recommender._exclusions_with_relations(votes, {"v2"}))
    assert out == {"v2"}
    assert session.statements == []


def test_exclusions_grow_by_everything_related_to_the_read_set(monkeypatch):
    monkeypatch.setattr(engine, "RELATION_EXCLUSION", True)
    session = _Session([[_Row(related_vn_id="v9"), _Row(related_vn_id="v1")]])
    recommender = HybridRecommender(db=session)
    votes = [
        {"vn_id": "v1", "score": 90},
        {"id": "v3", "score": 80},
        {"score": 70},
    ]
    out = asyncio.run(recommender._exclusions_with_relations(votes, {"v2"}))
    # v1 is the reader's own title and was already excluded upstream; v9 is new.
    assert out == {"v2", "v9"}
    assert len(session.statements) == 1
    values = _param_values(_params(session.statements[0]))
    # v3 reaches the read set through the id fallback; the vote with neither key
    # contributes nothing, so no None value is bound alongside the other three.
    assert values == {"v1", "v2", "v3"}


def _sql(statement) -> str:
    return str(statement.compile(dialect=postgresql.dialect()))


def test_evidence_floor_predicate_asks_for_a_description_or_a_tag(monkeypatch):
    monkeypatch.setattr(engine, "EXPLORATION_REQUIRE_EVIDENCE", True)
    sql = _sql(engine.exploration_evidence_predicate())
    assert "description" in sql
    assert "vn_tags" in sql


def test_evidence_floor_is_absent_by_default(monkeypatch):
    monkeypatch.setattr(engine, "EXPLORATION_REQUIRE_EVIDENCE", False)
    assert engine.exploration_evidence_predicate() is None


def test_vote_weights_are_flat_without_a_half_life(monkeypatch):
    monkeypatch.setattr(engine, "VOTE_HALF_LIFE_DAYS", 0.0)
    votes = [{"vn_id": "v1", "score": 80, "vote_date": 0}, {"vn_id": "v2", "score": 80, "vote_date": 86400 * 365}]
    assert engine.vote_weights(votes) == {"v1": 1.0, "v2": 1.0}


def test_vote_weights_halve_per_half_life_from_the_newest_vote(monkeypatch):
    monkeypatch.setattr(engine, "VOTE_HALF_LIFE_DAYS", 365.0)
    day = 86400
    votes = [
        {"vn_id": "old", "score": 80, "vote_date": 0},
        {"vn_id": "new", "score": 80, "vote_date": 365 * day},
        {"vn_id": "undated", "score": 80},
    ]
    weights = engine.vote_weights(votes)
    assert weights["new"] == pytest.approx(1.0)
    assert weights["old"] == pytest.approx(0.5)
    # A vote without a date is not penalised for the dump not knowing when it was cast.
    assert weights["undated"] == pytest.approx(1.0)


def test_weighted_support_and_mean():
    support, mean = engine.weighted_support({"v1": 8.0, "v2": 6.0}, ["v1", "v2"], {"v1": 1.0, "v2": 0.5})
    assert support == pytest.approx(1.5)
    assert mean == pytest.approx((8.0 * 1.0 + 6.0 * 0.5) / 1.5)


def test_finished_only_is_added_when_no_status_is_named():
    predicates = engine.status_predicates(VNFilterSpec(nsfw=True))
    assert len(predicates) == 1
    assert "devstatus" in _sql(predicates[0])


def test_a_named_status_is_left_alone():
    assert engine.status_predicates(VNFilterSpec(nsfw=True, devstatus=(1,))) == []
    assert engine.status_predicates(VNFilterSpec(nsfw=True, exclude_devstatus=(2,))) == []


def test_evidence_floor_shares_the_embedding_jobs_length_floor():
    from app.ingestion import description_embeddings

    assert engine.EVIDENCE_DESCRIPTION_LENGTH == description_embeddings.MIN_DESCRIPTION_LENGTH


def test_finished_only_reaches_the_cut_but_not_the_sources(monkeypatch):
    """The status clause must land where the title table is already joined.

    A source that reads a similarity, description or entity table has no title row to test
    a status against without joining one in, so the clause belongs at the cut downstream
    that already selects from the title table, not on the predicates a source is asked
    to apply to its own query.
    """
    captured = {}

    async def fake_collect(self, *, predicates, **kwargs):
        captured["collect_predicates"] = predicates
        return {"v1"}, set(), []

    async def fake_fetch(self, *, predicates, **kwargs):
        captured["fetch_predicates"] = predicates
        return []

    monkeypatch.setattr(HybridRecommender, "_collect_candidate_ids", fake_collect)
    monkeypatch.setattr(HybridRecommender, "_fetch_candidate_details", fake_fetch)

    recommender = HybridRecommender(db=_Session([]))
    asyncio.run(
        recommender._get_candidates(
            exclude_vn_ids=set(),
            min_rating=None,
            min_length=None,
            max_length=None,
            include_tags=None,
            exclude_tags=None,
            include_traits=None,
            exclude_traits=None,
            limit=10,
            high_rated_vns=["v1"],
            elite_tag_ids=set(),
            japanese_only=True,
            spoiler_level=0,
            filters=None,
        )
    )

    collect_sql = " ".join(_sql(p) for p in captured["collect_predicates"])
    fetch_sql = " ".join(_sql(p) for p in captured["fetch_predicates"])
    assert "devstatus" not in collect_sql
    assert "devstatus" in fetch_sql


import numpy as np


def test_cf_scores_are_min_max_over_the_pool():
    user = np.array([1.0, 0.0])
    items = {"a": np.array([1.0, 0.0]), "b": np.array([0.0, 1.0]), "c": np.array([0.5, 0.0])}
    scores = engine.collaborative_scores(user, items)
    assert scores["a"] == pytest.approx(1.0)
    assert scores["b"] == pytest.approx(0.0)
    assert scores["c"] == pytest.approx(0.5)


def test_cf_scores_are_empty_without_a_reader_vector():
    assert engine.collaborative_scores(None, {"a": np.array([1.0])}) == {}


def test_cf_signal_absent_from_the_weight_total_by_default():
    # Outside the vector: the vector is what readers tune and what the published
    # percentages divide by, and an unmeasured signal has no place in it.
    assert "collaborative" not in engine.SIGNAL_WEIGHTS
    assert "collaborative" not in engine.SIGNAL_SUM_ORDER
    assert switch_settings()["REC_CF_SIGNAL_WEIGHT"] == 0.0


def _scored(vn_id: str, collaborative: float):
    from app.services.hybrid_recommender import RecommendationResult

    result = RecommendationResult(vn_id=vn_id, title=vn_id, score=1.0, match_reasons=[])
    result.collaborative_score = collaborative
    return result


def test_cf_term_joins_the_fusion_only_while_weighted(monkeypatch):
    recommender = HybridRecommender(db=None)
    weights = dict(engine.SIGNAL_WEIGHTS)

    monkeypatch.setattr(engine, "CF_SIGNAL_WEIGHT", 1.2)
    recommender._apply_rank_agreement(
        [_scored("v1", 0.9), _scored("v2", 0.1)], engine.MAX_WEIGHTED_SCORE, weights
    )
    assert "collaborative" in recommender.last_signal_rankings

    monkeypatch.setattr(engine, "CF_SIGNAL_WEIGHT", 0.0)
    recommender._apply_rank_agreement(
        [_scored("v1", 0.9), _scored("v2", 0.1)], engine.MAX_WEIGHTED_SCORE, weights
    )
    assert "collaborative" not in recommender.last_signal_rankings
