"""Read access to the VN description embedding matrix.

Serving needs no model. Similarity is only ever measured between entries that were both
embedded by the nightly job, so a request does a dot product against a matrix that is
already on disk. Nothing here imports the ONNX runtime, and nothing here touches the
database.

The matrix is memory mapped, so the three API workers share one copy through the page
cache instead of each holding its own. Rows are float32 and unit length: a dot product is
already a cosine.

Usage:

    vectors = get_description_vectors()
    if vectors:
        taste = vectors.mean_vector(read_vn_ids)   # None if none of them were embedded
        scores = vectors.score_candidates(candidate_ids, taste)   # {vn_id: cosine}

Prefer `score_candidates` over `similarities`: scoring a retrieved candidate set touches
a few thousand rows where a full scan touches every one, which on the deployed hardware
is the difference between a couple of milliseconds and around thirty.

An id absent from the result was never embedded. Treat that as "this signal does not
apply here", not as a score of zero: an entry with no usable prose has said nothing about
itself, and ranking it below one that scored badly reads a silence as a rejection.

Scores are cosines between mean-centred unit vectors, so they run roughly -0.3 to 1.0
rather than filling 0 to 1. Two parts of the same work land around 0.6 to 0.95, a genuine
thematic neighbour around 0.3 to 0.5, and an unrelated pair near 0. Anything rescaling
them into a weight should be calibrated against that spread rather than assuming 0 to 1.
"""

import json
import logging
import os
import threading
from pathlib import Path

import numpy as np

logger = logging.getLogger(__name__)

ARTIFACT_ROOT = Path(os.getenv("REC_DESC_ARTIFACT_ROOT", "/app/data/rec"))
DEFAULT_MODEL_VERSION = os.getenv("REC_DESC_MODEL_VERSION", "e5s-v1")

_lock = threading.Lock()
_cached: "DescriptionVectors | None" = None
_cached_stamp: tuple[str, float] | None = None


class DescriptionVectors:
    """A loaded matrix plus the id order its rows are in."""

    __slots__ = ("matrix", "ids", "row_of", "model_version", "built_at")

    def __init__(self, matrix: np.ndarray, manifest: dict):
        self.matrix = matrix
        self.ids: list[str] = manifest["ids"]
        self.row_of: dict[str, int] = {vn_id: i for i, vn_id in enumerate(self.ids)}
        self.model_version: str = manifest["model_version"]
        self.built_at: str = manifest.get("built_at", "")

    def __len__(self) -> int:
        return len(self.ids)

    @property
    def dim(self) -> int:
        return int(self.matrix.shape[1])

    def vector(self, vn_id: str) -> np.ndarray | None:
        row = self.row_of.get(vn_id)
        return None if row is None else np.asarray(self.matrix[row])

    def rows_for(self, vn_ids) -> np.ndarray:
        """Row indices for the ids that were embedded, in the order given."""
        return np.fromiter(
            (r for r in (self.row_of.get(i) for i in vn_ids) if r is not None),
            dtype=np.int64,
        )

    def mean_vector(self, vn_ids, weights=None) -> np.ndarray | None:
        """Unit-length average of the embedded entries among `vn_ids`.

        A reader's taste as one vector. Returns None when none of the ids were embedded,
        which is the caller's signal that this signal is unavailable for that reader
        rather than that it scored zero.
        """
        kept, kept_weights = [], []
        for position, vn_id in enumerate(vn_ids):
            row = self.row_of.get(vn_id)
            if row is None:
                continue
            kept.append(row)
            kept_weights.append(1.0 if weights is None else float(weights[position]))

        if not kept:
            return None

        block = np.asarray(self.matrix[np.asarray(kept, dtype=np.int64)], dtype=np.float32)
        w = np.asarray(kept_weights, dtype=np.float32)
        total = w.sum()
        if total <= 0:
            return None

        pooled = (block * w[:, None]).sum(axis=0) / total
        norm = float(np.linalg.norm(pooled))
        return pooled / norm if norm > 1e-12 else None

    def similarities(self, query: np.ndarray) -> np.ndarray:
        """Cosine of `query` against every row, in `ids` order."""
        return np.asarray(self.matrix) @ np.asarray(query, dtype=np.float32)

    def similarity(self, vn_id: str, query: np.ndarray) -> float | None:
        row = self.row_of.get(vn_id)
        if row is None:
            return None
        return float(np.dot(self.matrix[row], query))

    def best_match(self, vn_ids, query_rows: np.ndarray) -> np.ndarray:
        """For every row, its highest cosine against any of `query_rows`.

        A reader who likes two unrelated things is served better by "close to something
        you read" than by "close to the average of everything you read", which for a
        broad reader points at the middle of nowhere.
        """
        block = np.asarray(self.matrix[query_rows], dtype=np.float32)
        return (np.asarray(self.matrix) @ block.T).max(axis=1)

    def score_candidates(self, candidate_ids, query: np.ndarray) -> dict[str, float]:
        """Cosines for just the candidates that were embedded.

        Scoring a retrieved candidate set means touching a few thousand rows, not all of
        them, which is an order of magnitude less work than a full scan. Ids absent from
        the result were never embedded: treat that as no signal rather than as zero.
        """
        rows, kept = [], []
        for vn_id in candidate_ids:
            row = self.row_of.get(vn_id)
            if row is not None:
                rows.append(row)
                kept.append(vn_id)
        if not rows:
            return {}
        block = np.asarray(self.matrix[np.asarray(rows, dtype=np.int64)], dtype=np.float32)
        scores = block @ np.asarray(query, dtype=np.float32)
        return dict(zip(kept, scores.tolist()))

    def score_candidates_best_match(
        self, candidate_ids, query_rows: np.ndarray
    ) -> dict[str, float]:
        """As `score_candidates`, scored against the nearest of several query rows."""
        rows, kept = [], []
        for vn_id in candidate_ids:
            row = self.row_of.get(vn_id)
            if row is not None:
                rows.append(row)
                kept.append(vn_id)
        if not rows or not len(query_rows):
            return {}
        block = np.asarray(self.matrix[np.asarray(rows, dtype=np.int64)], dtype=np.float32)
        queries = np.asarray(self.matrix[query_rows], dtype=np.float32)
        return dict(zip(kept, (block @ queries.T).max(axis=1).tolist()))


def _paths(model_version: str, root: Path | None = None) -> tuple[Path, Path]:
    base = root or ARTIFACT_ROOT
    return base / f"desc_emb_{model_version}.npy", base / f"desc_emb_{model_version}.json"


def get_description_vectors(
    model_version: str | None = None, root: Path | None = None
) -> DescriptionVectors | None:
    """Return the loaded matrix, or None when no build has been published yet.

    Cached per process and reloaded when the nightly job publishes a new matrix. Callers
    must handle None: the site has to serve recommendations on a machine where the build
    has not run.
    """
    global _cached, _cached_stamp

    version = model_version or DEFAULT_MODEL_VERSION
    matrix_path, manifest_path = _paths(version, root)

    try:
        stamp = (version, manifest_path.stat().st_mtime)
    except OSError:
        return None

    if _cached is not None and _cached_stamp == stamp:
        return _cached

    with _lock:
        if _cached is not None and _cached_stamp == stamp:
            return _cached
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            matrix = np.load(matrix_path, mmap_mode="r")
        except Exception:
            logger.exception("Could not load description vectors from %s", matrix_path)
            return None

        if matrix.shape[0] != len(manifest["ids"]):
            logger.error(
                "Description matrix has %d rows but the manifest lists %d ids",
                matrix.shape[0], len(manifest["ids"]),
            )
            return None

        _cached = DescriptionVectors(matrix, manifest)
        _cached_stamp = stamp
        logger.info(
            "Loaded %d description vectors (%s, dim %d)",
            len(_cached), _cached.model_version, _cached.dim,
        )
        return _cached
