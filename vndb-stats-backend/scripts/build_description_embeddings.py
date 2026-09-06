#!/usr/bin/env python
"""Build, top up and inspect the VN description embedding matrix.

Typical use:

    # one-off: fetch the model onto the data volume
    python scripts/build_description_embeddings.py --download

    # full build, resumable: run again after an interruption and it picks up
    python scripts/build_description_embeddings.py --threads 4

    # spread a first build over several passes
    python scripts/build_description_embeddings.py --limit 10000

    # rewrite the served matrix from what is already stored
    python scripts/build_description_embeddings.py --export-only

    # read the result: nearest neighbours of a few known entries
    python scripts/build_description_embeddings.py --neighbours v97,v11,v2002
"""

import argparse
import asyncio
import logging
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import numpy as np

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("build_description_embeddings")


async def _neighbours(model_key: str | None, seeds: list[str], top_k: int) -> None:
    import json

    from sqlalchemy import text

    from app.db.database import async_session_maker
    from app.ingestion.description_embeddings import artifact_paths
    from app.ingestion.description_encoder import get_model

    model = get_model(model_key)
    matrix_path, manifest_path = artifact_paths(model.model_version)
    if not matrix_path.exists():
        raise SystemExit(f"no matrix at {matrix_path}; run a build first")

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    matrix = np.load(matrix_path, mmap_mode="r")
    ids: list[str] = manifest["ids"]
    row_of = {vn_id: i for i, vn_id in enumerate(ids)}
    print(f"matrix {matrix.shape} {matrix.dtype} from {matrix_path}")

    async with async_session_maker() as db:
        result = await db.execute(
            text(
                "SELECT id, title, coalesce(votecount, 0) FROM visual_novels "
                "WHERE id = ANY(:ids)"
            ),
            {"ids": ids},
        )
        meta = {r[0]: (r[1], r[2]) for r in result.all()}

    for seed in seeds:
        if seed not in row_of:
            print(f"\n[{seed}] not in the matrix")
            continue
        i = row_of[seed]
        started = time.perf_counter()
        sims = np.asarray(matrix) @ np.asarray(matrix[i])
        elapsed_ms = (time.perf_counter() - started) * 1000
        order = np.argpartition(-sims, top_k + 1)[: top_k + 1]
        order = order[np.argsort(-sims[order])]
        title, votes = meta.get(seed, ("?", 0))
        print(f"\n[{seed}] {title}  ({votes} votes)   scan {elapsed_ms:.1f} ms")
        for j in order:
            if j == i:
                continue
            n_title, n_votes = meta.get(ids[j], ("?", 0))
            print(f"   {sims[j]:.3f}  {ids[j]:>7}  {n_votes:>6} votes  {n_title[:70]}")


async def _run(args: argparse.Namespace) -> None:
    from app.db.database import async_session_maker, init_db
    from app.ingestion.description_embeddings import (
        dump_pending_inputs,
        export_matrix,
        load_encoded_vectors,
        purge_other_versions,
        sync_description_embeddings,
    )
    from app.ingestion.description_encoder import ensure_assets, get_model

    model = get_model(args.model)

    if args.download:
        directory = ensure_assets(model)
        total = sum(p.stat().st_size for p in directory.iterdir() if p.is_file())
        print(f"{model.key} assets at {directory} ({total / (1024 * 1024):.0f} MB)")
        return

    await init_db()

    if args.neighbours:
        await _neighbours(args.model, args.neighbours.split(","), args.top_k)
        return

    if args.dump_inputs:
        print(
            await dump_pending_inputs(
                async_session_maker, Path(args.dump_inputs), args.model, args.limit
            )
        )
        return

    if args.load_vectors:
        print(await load_encoded_vectors(async_session_maker, Path(args.load_vectors), args.model))
        print(await export_matrix(async_session_maker, model_key=args.model))
        return

    if not args.export_only:
        stats = await sync_description_embeddings(
            async_session_maker,
            model_key=args.model,
            limit=args.limit,
            batch_size=args.batch_size,
        )
        print(stats)
        if stats["pending"]:
            print(f"{stats['pending']} entries still pending; run again to continue")
            if not args.export_partial:
                return

    print(await export_matrix(async_session_maker, model_key=args.model))

    if args.purge_other_versions:
        print(f"purged {await purge_other_versions(async_session_maker, args.model)} superseded rows")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default=None, help="encoder key (default: REC_DESC_MODEL)")
    parser.add_argument("--download", action="store_true", help="fetch model assets and exit")
    parser.add_argument("--limit", type=int, default=None, help="cap entries encoded this run")
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--threads", type=int, default=None, help="ONNX intra-op threads")
    parser.add_argument("--export-only", action="store_true", help="rewrite the matrix, encode nothing")
    parser.add_argument(
        "--export-partial",
        action="store_true",
        help="write the matrix even when entries remain unencoded",
    )
    parser.add_argument(
        "--dump-inputs",
        default=None,
        help="write pending entries as JSON lines for encoding on another machine",
    )
    parser.add_argument(
        "--load-vectors",
        default=None,
        help="store an .npz from scripts/encode_description_dump.py, then export",
    )
    parser.add_argument("--purge-other-versions", action="store_true")
    parser.add_argument("--neighbours", default=None, help="comma-separated vn ids to inspect")
    parser.add_argument("--top-k", type=int, default=10)
    args = parser.parse_args()

    if args.threads:
        os.environ["REC_DESC_THREADS"] = str(args.threads)

    asyncio.run(_run(args))


if __name__ == "__main__":
    main()
