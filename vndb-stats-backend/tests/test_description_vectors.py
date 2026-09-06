"""Reading the published description embedding matrix.

The engine has to cope with a machine where no build has run, with a title that has no
usable prose, and with a matrix that was replaced under it, so those are what is pinned
here rather than the numeric output of any particular model.
"""

import json

import numpy as np
import pytest

from app.services import description_vectors as dv


@pytest.fixture
def published(tmp_path):
    """Write a small matrix and manifest the way the export job does."""

    def _write(ids, matrix, version="test-v1"):
        matrix = np.asarray(matrix, dtype=np.float32)
        matrix = matrix / np.clip(np.linalg.norm(matrix, axis=1, keepdims=True), 1e-12, None)
        np.save(tmp_path / f"desc_emb_{version}.npy", matrix)
        (tmp_path / f"desc_emb_{version}.json").write_text(
            json.dumps(
                {
                    "model_version": version,
                    "dim": matrix.shape[1],
                    "count": len(ids),
                    "centered": True,
                    "built_at": "2020-01-01T00:00:00+00:00",
                    "ids": list(ids),
                }
            ),
            encoding="utf-8",
        )
        return tmp_path

    return _write


@pytest.fixture(autouse=True)
def _clear_cache():
    dv._cached = None
    dv._cached_stamp = None
    yield
    dv._cached = None
    dv._cached_stamp = None


def test_missing_build_reads_as_absent(tmp_path):
    assert dv.get_description_vectors("test-v1", tmp_path) is None


def test_ids_map_to_their_rows(published):
    root = published(["v1", "v2", "v3"], [[1, 0], [0, 1], [1, 1]])
    vectors = dv.get_description_vectors("test-v1", root)
    assert len(vectors) == 3
    assert vectors.dim == 2
    assert vectors.row_of == {"v1": 0, "v2": 1, "v3": 2}


def test_unknown_id_has_no_vector(published):
    root = published(["v1", "v2"], [[1, 0], [0, 1]])
    vectors = dv.get_description_vectors("test-v1", root)
    assert vectors.vector("v999") is None
    assert vectors.similarity("v999", np.array([1.0, 0.0], dtype=np.float32)) is None


def test_similarities_are_cosines_in_id_order(published):
    root = published(["v1", "v2", "v3"], [[1, 0], [0, 1], [1, 1]])
    vectors = dv.get_description_vectors("test-v1", root)
    scores = vectors.similarities(np.array([1.0, 0.0], dtype=np.float32))
    assert scores.shape == (3,)
    assert scores[0] == pytest.approx(1.0, abs=1e-6)
    assert scores[1] == pytest.approx(0.0, abs=1e-6)
    assert scores[2] == pytest.approx(0.70710678, abs=1e-6)


def test_mean_vector_ignores_ids_that_were_never_embedded(published):
    root = published(["v1", "v2"], [[1, 0], [0, 1]])
    vectors = dv.get_description_vectors("test-v1", root)
    pooled = vectors.mean_vector(["v1", "v999"])
    assert pooled == pytest.approx([1.0, 0.0], abs=1e-6)


def test_mean_vector_is_absent_when_nothing_was_embedded(published):
    """None is the caller's cue that this signal does not apply to the reader, which is
    not the same as it scoring zero."""
    root = published(["v1"], [[1, 0]])
    vectors = dv.get_description_vectors("test-v1", root)
    assert vectors.mean_vector(["v999", "v998"]) is None


def test_mean_vector_honours_weights(published):
    root = published(["v1", "v2"], [[1, 0], [0, 1]])
    vectors = dv.get_description_vectors("test-v1", root)
    pooled = vectors.mean_vector(["v1", "v2"], weights=[3.0, 1.0])
    assert pooled[0] > pooled[1]
    assert float(np.linalg.norm(pooled)) == pytest.approx(1.0, abs=1e-6)


def test_best_match_takes_the_closest_read_title_not_the_average(published):
    """A reader with two unrelated tastes should still rank a title close to one of
    them, where the average of the two points somewhere neither is."""
    root = published(["a", "b", "near_a"], [[1, 0], [0, 1], [0.98, 0.2]])
    vectors = dv.get_description_vectors("test-v1", root)
    scores = vectors.best_match(["a", "b"], vectors.rows_for(["a", "b"]))
    assert scores[2] > 0.9


def test_a_republished_matrix_is_picked_up(published):
    root = published(["v1"], [[1, 0]])
    assert len(dv.get_description_vectors("test-v1", root)) == 1

    published(["v1", "v2"], [[1, 0], [0, 1]])
    assert len(dv.get_description_vectors("test-v1", root)) == 2


def test_matrix_and_manifest_disagreeing_reads_as_absent(published, tmp_path):
    published(["v1", "v2"], [[1, 0], [0, 1]])
    manifest = json.loads((tmp_path / "desc_emb_test-v1.json").read_text(encoding="utf-8"))
    manifest["ids"] = ["v1", "v2", "v3"]
    (tmp_path / "desc_emb_test-v1.json").write_text(json.dumps(manifest), encoding="utf-8")
    assert dv.get_description_vectors("test-v1", tmp_path) is None


def test_score_candidates_covers_only_the_embedded_ones(published):
    root = published(["v1", "v2", "v3"], [[1, 0], [0, 1], [1, 1]])
    vectors = dv.get_description_vectors("test-v1", root)
    scores = vectors.score_candidates(
        ["v1", "v2", "v999"], np.array([1.0, 0.0], dtype=np.float32)
    )
    assert set(scores) == {"v1", "v2"}
    assert scores["v1"] == pytest.approx(1.0, abs=1e-6)
    assert scores["v2"] == pytest.approx(0.0, abs=1e-6)


def test_score_candidates_agrees_with_a_full_scan(published):
    root = published(
        ["v1", "v2", "v3", "v4"], [[1, 0], [0, 1], [1, 1], [-1, 0.5]]
    )
    vectors = dv.get_description_vectors("test-v1", root)
    query = np.array([0.6, 0.8], dtype=np.float32)
    full = vectors.similarities(query)
    scoped = vectors.score_candidates(vectors.ids, query)
    for i, vn_id in enumerate(vectors.ids):
        assert scoped[vn_id] == pytest.approx(float(full[i]), abs=1e-6)


def test_score_candidates_with_nothing_embedded_is_empty(published):
    root = published(["v1"], [[1, 0]])
    vectors = dv.get_description_vectors("test-v1", root)
    assert vectors.score_candidates(["v9"], np.array([1.0, 0.0], dtype=np.float32)) == {}


def test_best_match_scoping_matches_the_unscoped_form(published):
    root = published(["a", "b", "c"], [[1, 0], [0, 1], [0.98, 0.2]])
    vectors = dv.get_description_vectors("test-v1", root)
    rows = vectors.rows_for(["a", "b"])
    scoped = vectors.score_candidates_best_match(["c"], rows)
    unscoped = vectors.best_match(["a", "b"], rows)
    assert scoped["c"] == pytest.approx(float(unscoped[2]), abs=1e-6)
