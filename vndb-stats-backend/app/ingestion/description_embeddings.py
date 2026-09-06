"""Build and maintain sentence embeddings of VN descriptions.

A description is the one dense content signal that does not depend on how many people
have played a title: it is written once, by whoever published the work. Tags, votes and
co-occurrence only accumulate with an audience, so a scorer resting on them can only
rank what is already popular. Embedding descriptions gives every entry with prose a
comparable position in the same space.

Two stores, deliberately:

* `vn_description_embeddings` in Postgres is the source of truth. It holds the digest of
  the exact text each vector was produced from, which is what makes the nightly top-up
  incremental: only entries whose cleaned text changed are re-encoded.
* A `.npy` matrix on the shared data volume is the read cache. Serving needs a dot
  product against every row at once, which is a BLAS call over one contiguous block,
  not 40,000 row lookups.

Nothing here is needed at request time. The encoder is imported lazily so a process that
only reads the matrix never loads the ONNX runtime.
"""

import json
import logging
import os
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from sqlalchemy import text

from app.ingestion.description_text import prepare_embedding_input, text_hash

logger = logging.getLogger(__name__)

ARTIFACT_ROOT = Path(os.getenv("REC_DESC_ARTIFACT_ROOT", "/app/data/rec"))

# Vectors are stored half precision. They are unit length, so the represented range is
# tiny and the rounding error stays several orders of magnitude below the differences
# that separate one neighbour from the next, at half the bytes on disk and in backups.
STORAGE_DTYPE = np.float16

# Shorter than this and a description is a label rather than prose; those entries are
# skipped so the matrix does not gain a cluster of near-identical near-empty rows.
MIN_DESCRIPTION_LENGTH = 50

# How many entries are encoded before the results are committed. Small enough that an
# interrupted run loses seconds of work, large enough to amortise the round trip.
CHUNK_SIZE = 512

_SOURCE_SQL = text(
    """
    SELECT id, title, description
    FROM visual_novels
    WHERE description IS NOT NULL
      AND length(description) > :min_len
    ORDER BY id
    """
)

# The job runs while the site is being served and the daily import may still be
# finishing. It touches only visual_novels (read) and its own table (write), neither of
# which the import renames, but a statement that cannot proceed promptly is a statement
# that should fail rather than queue behind, or ahead of, anything else.
_SESSION_GUARDS = (
    "SET LOCAL lock_timeout = '5s'",
    "SET LOCAL statement_timeout = '120s'",
    "SET LOCAL idle_in_transaction_session_timeout = '60s'",
)


def artifact_paths(model_version: str, root: Path | None = None) -> tuple[Path, Path]:
    """Return the (matrix, manifest) paths for a model version."""
    base = root or ARTIFACT_ROOT
    return base / f"desc_emb_{model_version}.npy", base / f"desc_emb_{model_version}.json"


async def _apply_guards(db) -> None:
    for statement in _SESSION_GUARDS:
        await db.execute(text(statement))


async def _load_source_rows(session_maker) -> dict[str, str]:
    """Return {vn_id: encoder input} for every entry with usable prose."""
    prepared: dict[str, str] = {}
    async with session_maker() as db:
        await _apply_guards(db)
        result = await db.stream(_SOURCE_SQL, {"min_len": MIN_DESCRIPTION_LENGTH})
        async for vn_id, title, description in result:
            composed = prepare_embedding_input(title, description)
            if composed:
                prepared[vn_id] = composed
        await db.rollback()
    return prepared


async def _load_stored_hashes(session_maker, model_version: str) -> dict[str, str]:
    async with session_maker() as db:
        await _apply_guards(db)
        result = await db.execute(
            text(
                "SELECT vn_id, text_hash FROM vn_description_embeddings "
                "WHERE model_version = :v"
            ),
            {"v": model_version},
        )
        stored = {row[0]: row[1] for row in result.all()}
        await db.rollback()
    return stored


async def _write_chunk(session_maker, model_version: str, records: list[dict]) -> None:
    async with session_maker() as db:
        await _apply_guards(db)
        await db.execute(
            text(
                """
                INSERT INTO vn_description_embeddings
                    (vn_id, model_version, text_hash, dim, vector, updated_at)
                VALUES (:vn_id, :model_version, :text_hash, :dim, :vector, :updated_at)
                ON CONFLICT (vn_id, model_version) DO UPDATE SET
                    text_hash = EXCLUDED.text_hash,
                    dim = EXCLUDED.dim,
                    vector = EXCLUDED.vector,
                    updated_at = EXCLUDED.updated_at
                """
            ),
            records,
        )
        await db.commit()


async def _delete_ids(session_maker, model_version: str, vn_ids: list[str]) -> None:
    for start in range(0, len(vn_ids), 1000):
        batch = vn_ids[start : start + 1000]
        async with session_maker() as db:
            await _apply_guards(db)
            await db.execute(
                text(
                    "DELETE FROM vn_description_embeddings "
                    "WHERE model_version = :v AND vn_id = ANY(:ids)"
                ),
                {"v": model_version, "ids": batch},
            )
            await db.commit()


async def sync_description_embeddings(
    session_maker,
    model_key: str | None = None,
    limit: int | None = None,
    batch_size: int = 32,
    progress_every: int = 5000,
) -> dict:
    """Bring stored vectors in line with the current descriptions.

    Only entries whose cleaned text digest differs from the stored one are encoded, so a
    nightly run costs whatever the import actually changed. Each chunk is committed on
    its own, which makes an interrupted run resumable by simply running it again.

    `limit` caps how many entries are encoded in one run, for a first build that is being
    spread over several passes.
    """
    from app.ingestion.description_encoder import DescriptionEncoder, get_model

    model = get_model(model_key)
    started = time.perf_counter()

    prepared = await _load_source_rows(session_maker)
    stored = await _load_stored_hashes(session_maker, model.model_version)

    hashes = {vn_id: text_hash(t) for vn_id, t in prepared.items()}
    todo = sorted(vn_id for vn_id, h in hashes.items() if stored.get(vn_id) != h)
    obsolete = sorted(set(stored) - set(prepared))

    logger.info(
        "Description embeddings (%s): %d eligible, %d stored, %d to encode, %d obsolete",
        model.model_version, len(prepared), len(stored), len(todo), len(obsolete),
    )

    if obsolete:
        await _delete_ids(session_maker, model.model_version, obsolete)

    capped = todo[:limit] if limit else todo
    encoded = 0

    if capped:
        encoder = DescriptionEncoder(model)
        encode_started = time.perf_counter()

        for start in range(0, len(capped), CHUNK_SIZE):
            chunk = capped[start : start + CHUNK_SIZE]
            vectors = encoder.encode([prepared[i] for i in chunk], batch_size=batch_size)
            now = datetime.now(timezone.utc).replace(tzinfo=None)
            await _write_chunk(
                session_maker,
                model.model_version,
                [
                    {
                        "vn_id": vn_id,
                        "model_version": model.model_version,
                        "text_hash": hashes[vn_id],
                        "dim": model.dim,
                        "vector": vectors[row].astype(STORAGE_DTYPE).tobytes(),
                        "updated_at": now,
                    }
                    for row, vn_id in enumerate(chunk)
                ],
            )
            encoded += len(chunk)

            if progress_every and encoded % progress_every < CHUNK_SIZE:
                rate = encoded / max(time.perf_counter() - encode_started, 1e-9)
                remaining = (len(capped) - encoded) / rate if rate else 0
                logger.info(
                    "  encoded %d/%d at %.1f/s, ~%.0f min remaining",
                    encoded, len(capped), rate, remaining / 60,
                )

    return {
        "model_version": model.model_version,
        "eligible": len(prepared),
        "encoded": encoded,
        "pending": len(todo) - encoded,
        "deleted": len(obsolete),
        "seconds": round(time.perf_counter() - started, 1),
    }


async def dump_pending_inputs(
    session_maker, path: Path, model_key: str | None = None, limit: int | None = None
) -> dict:
    """Write the entries awaiting encoding as JSON lines.

    A first build over the whole catalogue is hours of CPU and minutes on a machine with
    a GPU. Splitting it lets the encoding happen wherever there is hardware for it, with
    the digest travelling alongside each text so the result can only be loaded back
    against the text it was actually produced from.
    """
    from app.ingestion.description_encoder import get_model

    model = get_model(model_key)
    prepared = await _load_source_rows(session_maker)
    stored = await _load_stored_hashes(session_maker, model.model_version)

    hashes = {vn_id: text_hash(t) for vn_id, t in prepared.items()}
    todo = sorted(vn_id for vn_id, h in hashes.items() if stored.get(vn_id) != h)
    if limit:
        todo = todo[:limit]

    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for vn_id in todo:
            handle.write(
                json.dumps(
                    {"vn_id": vn_id, "text_hash": hashes[vn_id], "text": prepared[vn_id]},
                    ensure_ascii=False,
                )
                + "\n"
            )

    return {"model_version": model.model_version, "pending": len(todo), "path": str(path)}


async def load_encoded_vectors(
    session_maker, path: Path, model_key: str | None = None
) -> dict:
    """Store vectors produced by an out-of-band encode.

    Expects an `.npz` holding `vn_ids`, `text_hashes` and a float `vectors` matrix, as
    written by `scripts/encode_description_dump.py`. Entries whose text has since changed
    are dropped rather than stored against a digest that no longer describes them.
    """
    from app.ingestion.description_encoder import get_model

    model = get_model(model_key)
    payload = np.load(path, allow_pickle=False)
    vn_ids = [str(v) for v in payload["vn_ids"]]
    hashes = [str(v) for v in payload["text_hashes"]]
    vectors = payload["vectors"]

    if not (len(vn_ids) == len(hashes) == vectors.shape[0]):
        raise ValueError("vn_ids, text_hashes and vectors disagree on length")
    if vectors.shape[1] != model.dim:
        raise ValueError(f"vectors are {vectors.shape[1]} wide, {model.key} is {model.dim}")

    prepared = await _load_source_rows(session_maker)
    current = {vn_id: text_hash(t) for vn_id, t in prepared.items()}

    stored = 0
    stale = 0
    for start in range(0, len(vn_ids), CHUNK_SIZE):
        records = []
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        for offset in range(start, min(start + CHUNK_SIZE, len(vn_ids))):
            vn_id = vn_ids[offset]
            if current.get(vn_id) != hashes[offset]:
                stale += 1
                continue
            row = vectors[offset].astype(np.float32)
            row /= max(float(np.linalg.norm(row)), 1e-12)
            records.append(
                {
                    "vn_id": vn_id,
                    "model_version": model.model_version,
                    "text_hash": hashes[offset],
                    "dim": model.dim,
                    "vector": row.astype(STORAGE_DTYPE).tobytes(),
                    "updated_at": now,
                }
            )
        if records:
            await _write_chunk(session_maker, model.model_version, records)
            stored += len(records)

    logger.info("Loaded %d vectors from %s (%d stale, skipped)", stored, path, stale)
    return {"model_version": model.model_version, "stored": stored, "stale": stale}


async def export_matrix(
    session_maker, model_key: str | None = None, root: Path | None = None
) -> dict:
    """Write the stored vectors out as a single matrix plus an id manifest.

    Rows are float32 and unit length, so a cosine ranking is one `matrix @ vector`. The
    files are written beside their targets and moved into place, so a reader either sees
    the previous pair or the new one and never a half-written matrix.
    """
    from app.ingestion.description_encoder import get_model

    model = get_model(model_key)
    matrix_path, manifest_path = artifact_paths(model.model_version, root)
    matrix_path.parent.mkdir(parents=True, exist_ok=True)

    async with session_maker() as db:
        await _apply_guards(db)
        result = await db.execute(
            text(
                "SELECT vn_id, dim, vector FROM vn_description_embeddings "
                "WHERE model_version = :v ORDER BY vn_id"
            ),
            {"v": model.model_version},
        )
        rows = result.all()
        await db.rollback()

    if not rows:
        raise RuntimeError(f"no stored vectors for model version {model.model_version}")

    ids = [r[0] for r in rows]
    dim = rows[0][1]
    matrix = np.empty((len(rows), dim), dtype=np.float32)
    for i, (_, row_dim, blob) in enumerate(rows):
        if row_dim != dim:
            raise RuntimeError(f"mixed vector widths for {model.model_version}")
        matrix[i] = np.frombuffer(blob, dtype=STORAGE_DTYPE)

    # Half precision rounding leaves lengths a hair off one.
    matrix /= np.clip(np.linalg.norm(matrix, axis=1, keepdims=True), 1e-12, None)
    raw_spread = float(np.mean(matrix @ (matrix.mean(axis=0) / np.linalg.norm(matrix.mean(axis=0)))))

    # Raw output from this family of encoders occupies a narrow cone: every pair of
    # descriptions scores high, and what separates a real neighbour from an unrelated
    # entry is a fraction of that. Subtracting the corpus mean removes the shared
    # direction and leaves only what distinguishes one entry from the average one, which
    # is the whole of the signal a ranker can use.
    #
    # The mean is recomputed here from every stored vector rather than saved and reused,
    # so it tracks the catalogue as it grows. Vectors are stored uncentred for exactly
    # that reason: a shifting mean must never mean re-encoding.
    center = matrix.mean(axis=0)
    matrix -= center
    matrix /= np.clip(np.linalg.norm(matrix, axis=1, keepdims=True), 1e-12, None)
    centered_spread = float(np.mean(matrix @ (center / np.linalg.norm(center))))

    tmp_matrix = matrix_path.with_name(matrix_path.name + ".tmp")
    tmp_manifest = manifest_path.with_name(manifest_path.name + ".tmp")
    # Written through a handle because np.save appends its own extension to a path whose
    # name does not already end in .npy, which a temporary name does not.
    with tmp_matrix.open("wb") as handle:
        np.save(handle, matrix)
    tmp_manifest.write_text(
        json.dumps(
            {
                "model_version": model.model_version,
                "model_key": model.key,
                "dim": dim,
                "count": len(ids),
                "dtype": "float32",
                "centered": True,
                # Kept so anything embedded outside this build can be placed in the same
                # space: subtract this, then renormalise.
                "center": center.tolist(),
                "built_at": datetime.now(timezone.utc).isoformat(),
                "ids": ids,
            }
        ),
        encoding="utf-8",
    )
    os.replace(tmp_matrix, matrix_path)
    os.replace(tmp_manifest, manifest_path)

    return {
        "model_version": model.model_version,
        "count": len(ids),
        "dim": dim,
        "mean_cos_before_centering": round(raw_spread, 3),
        "mean_cos_after_centering": round(centered_spread, 3),
        "matrix_mb": round(matrix_path.stat().st_size / (1024 * 1024), 1),
        "manifest_mb": round(manifest_path.stat().st_size / (1024 * 1024), 1),
        "path": str(matrix_path),
    }


async def purge_other_versions(session_maker, model_key: str | None = None) -> int:
    """Drop vectors left over from a superseded model.

    Only safe once the active version covers everything, so the caller is expected to
    have run a sync to completion first.
    """
    from app.ingestion.description_encoder import get_model

    model = get_model(model_key)
    async with session_maker() as db:
        await _apply_guards(db)
        result = await db.execute(
            text(
                "DELETE FROM vn_description_embeddings WHERE model_version <> :v"
            ),
            {"v": model.model_version},
        )
        await db.commit()
    return result.rowcount or 0


async def run_nightly(session_maker, model_key: str | None = None) -> dict:
    """Top up changed descriptions, then refresh the served matrix.

    The matrix is only rewritten when something moved, so an unchanged day costs one
    query and no disk writes.
    """
    stats = await sync_description_embeddings(session_maker, model_key)

    from app.ingestion.description_encoder import get_model

    model = get_model(model_key)
    matrix_path, _ = artifact_paths(model.model_version)
    changed = stats["encoded"] or stats["deleted"] or not matrix_path.exists()

    if changed:
        stats["artifact"] = await export_matrix(session_maker, model_key)
    else:
        stats["artifact"] = None

    logger.info("Description embedding run: %s", stats)
    return stats
