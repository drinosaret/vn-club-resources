"""How the engine reads the description matrix, for scoring and for retrieval.

Serving must load no model and issue no query for either, and a title the matrix does not
cover must come back as absent rather than as a zero. The retrieval arm is the only source
that can name an unread title as related to something a reader liked, so what it collects
and what it refuses to collect are both pinned here.
"""

import asyncio

import numpy as np
import pytest

from app.services import hybrid_recommender as hr
from app.services.hybrid_recommender import HybridRecommender, description_affinity


class _StubVectors:
    """A tiny matrix in place of the built one, so these do not need a nightly job.

    Rows are unit length and laid out so the expected neighbour of each seed is known:
    a dot product between two rows is their cosine.
    """

    def __init__(self, rows: dict[str, list[float]]):
        self.ids = list(rows)
        self.row_of = {vn_id: index for index, vn_id in enumerate(self.ids)}
        matrix = np.asarray([rows[vn_id] for vn_id in self.ids], dtype=np.float32)
        norms = np.linalg.norm(matrix, axis=1, keepdims=True)
        self.matrix = matrix / np.where(norms == 0, 1.0, norms)

    def vector(self, vn_id):
        row = self.row_of.get(vn_id)
        return None if row is None else self.matrix[row]

    def rows_for(self, vn_ids):
        return np.fromiter(
            (r for r in (self.row_of.get(i) for i in vn_ids) if r is not None),
            dtype=np.int64,
        )

    def mean_vector(self, vn_ids, weights=None):
        rows = self.rows_for(vn_ids)
        if not len(rows):
            return None
        pooled = self.matrix[rows].mean(axis=0)
        norm = float(np.linalg.norm(pooled))
        return pooled / norm if norm > 1e-12 else None

    def _block(self, candidate_ids):
        rows, kept = [], []
        for vn_id in candidate_ids:
            row = self.row_of.get(vn_id)
            if row is not None:
                rows.append(row)
                kept.append(vn_id)
        if not rows:
            return None, []
        return self.matrix[np.asarray(rows, dtype=np.int64)], kept

    def score_candidates(self, candidate_ids, query):
        block, kept = self._block(candidate_ids)
        if block is None:
            return {}
        return dict(zip(kept, (block @ np.asarray(query, dtype=np.float32)).tolist()))

    def score_candidates_best_match(self, candidate_ids, query_rows):
        block, kept = self._block(candidate_ids)
        if block is None or not len(query_rows):
            return {}
        queries = self.matrix[query_rows]
        return dict(zip(kept, (block @ queries.T).max(axis=1).tolist()))


# Two clusters that share no direction, plus an entry the reader has read from each.
_ROWS = {
    "v1": [1.0, 0.0, 0.0],      # a seed
    "v2": [0.0, 1.0, 0.0],      # a seed pointing elsewhere
    "near1": [0.95, 0.05, 0.0],
    "near2": [0.05, 0.95, 0.0],
    "far": [0.0, 0.0, 1.0],
}


@pytest.fixture
def vectors(monkeypatch):
    stub = _StubVectors(_ROWS)
    monkeypatch.setattr(hr, "get_description_vectors", lambda: stub)
    return stub


class _NoSession:
    """Any query at all is a failure: this whole path reads a resident matrix."""

    async def execute(self, statement):
        raise AssertionError("the description signal must issue no query")


def _engine():
    return HybridRecommender(_NoSession())


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------


def test_a_title_outside_the_matrix_is_absent_rather_than_zero(vectors):
    scores = _engine()._description_scores(["near1", "unembedded"], ["v1"])
    assert "unembedded" not in scores
    assert scores["near1"] > 0


def test_absence_reads_as_no_signal_at_the_scoring_call(vectors):
    """The caller turns the same absence into presence, so the two have to agree."""
    engine = _engine()
    scores = engine._description_scores(["near1", "unembedded"], ["v1"])
    assert hr.present_signals(
        False, False, False, False, False, False, False, False,
        has_description="unembedded" in scores,
    ) == set()


def test_best_match_serves_a_reader_with_two_unrelated_tastes(vectors, monkeypatch):
    """Against the average of two directions, a title close to one of them is a poor
    match; against the nearer of the two it is a good one."""
    # Read below the ceiling, where the two are still distinguishable: both cosines here
    # clear the published ceiling and would land on the same clamped value.
    monkeypatch.setattr(hr, "DESC_COSINE_CEILING", 1.0)
    monkeypatch.setattr(hr, "DESC_BEST_MATCH", True)
    best = _engine()._description_scores(["near2"], ["v1", "v2"])["near2"]
    monkeypatch.setattr(hr, "DESC_BEST_MATCH", False)
    mean = _engine()._description_scores(["near2"], ["v1", "v2"])["near2"]
    assert best > mean


def test_an_unrelated_title_scores_nothing(vectors):
    assert _engine()._description_scores(["far"], ["v1"])["far"] == 0.0


def test_the_signal_stands_down_when_it_is_switched_off(vectors, monkeypatch):
    monkeypatch.setattr(hr, "DESC_SIGNAL", False)
    assert _engine()._description_scores(["near1"], ["v1"]) == {}


def test_a_reader_with_no_embedded_favourites_gets_no_signal(vectors):
    assert _engine()._description_scores(["near1"], ["unembedded"]) == {}


def test_no_build_is_a_missing_signal_rather_than_an_error(monkeypatch):
    monkeypatch.setattr(hr, "get_description_vectors", lambda: None)
    assert _engine()._description_scores(["near1"], ["v1"]) == {}
    assert asyncio.run(
        _engine()._get_description_candidates(
            favourites=["v1"], exclude_vn_ids=set(), limit=10, per_seed=3
        )
    ) == []


# ---------------------------------------------------------------------------
# The explanation
# ---------------------------------------------------------------------------


def test_the_explanation_names_the_title_the_candidate_reads_closest_to(vectors):
    neighbours = _engine()._description_neighbours(["near2"], ["v1", "v2"])
    assert neighbours["near2"][0]["source_vn_id"] == "v2"


def test_a_candidate_that_matches_nothing_carries_no_explanation(vectors):
    assert "far" not in _engine()._description_neighbours(["far"], ["v1", "v2"])


def test_the_explanation_agrees_with_the_score(vectors):
    engine = _engine()
    scored = engine._description_scores(["near1"], ["v1", "v2"])["near1"]
    explained = engine._description_neighbours(["near1"], ["v1", "v2"])["near1"][0]
    assert explained["affinity"] == pytest.approx(round(scored, 3))


# ---------------------------------------------------------------------------
# Retrieval
# ---------------------------------------------------------------------------


def _collect_ranked(**kwargs):
    defaults = dict(favourites=["v1", "v2"], exclude_vn_ids=set(), limit=10, per_seed=2)
    defaults.update(kwargs)
    return asyncio.run(_engine()._get_description_candidates(**defaults))


def _collect(**kwargs):
    return set(hr.ranked_ids(_collect_ranked(**kwargs)))


def test_the_arm_collects_the_neighbours_of_every_favourite(vectors):
    # Per favourite rather than over the union, so a reader's second interest is not
    # crowded out by whichever of their tastes has the denser neighbourhood.
    assert {"near1", "near2"} <= _collect()


def test_the_arm_never_nominates_what_it_was_asked_about(vectors):
    # A title is its own nearest neighbour, and the reader has already read the seeds.
    assert not {"v1", "v2"} & _collect()


def test_the_arm_respects_the_exclusion_set(vectors):
    assert "near1" not in _collect(exclude_vn_ids={"near1"})


def test_the_arm_respects_its_budget(vectors):
    assert len(_collect(limit=1)) == 1
    assert _collect(limit=0) == set()


def test_the_arm_stands_down_when_it_is_switched_off(vectors, monkeypatch):
    monkeypatch.setattr(hr, "DESC_RETRIEVAL", False)
    assert _collect() == set()


def test_a_reader_with_no_favourites_collects_nothing(vectors):
    assert _collect(favourites=[]) == set()


def test_the_arm_reaches_titles_the_reader_would_never_be_offered_otherwise(vectors):
    """The point of the arm: a candidate named on its own prose, with no vote-derived
    table between it and the reader."""
    collected = _collect()
    assert collected
    for vn_id in collected:
        assert description_affinity(
            float(np.dot(vectors.matrix[vectors.row_of[vn_id]], vectors.matrix[0]))
        ) >= 0.0
