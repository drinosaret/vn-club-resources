#!/usr/bin/env python
"""Encode a description dump on whatever machine has the hardware for it.

Needs no database and no application config: it reads the JSON lines written by
`build_description_embeddings.py --dump-inputs`, runs the encoder, and writes an `.npz`
for `--load-vectors` to store. A first build over the whole catalogue is hours on a
small CPU and minutes on a GPU, so this exists to let the two happen in different places.

    # in the container
    python scripts/build_description_embeddings.py --dump-inputs /app/data/rec/pending.jsonl

    # wherever the hardware is, with onnxruntime installed
    python scripts/encode_description_dump.py pending.jsonl vectors.npz --provider cuda

    # back in the container
    python scripts/build_description_embeddings.py --load-vectors /app/data/rec/vectors.npz

Each row carries the digest of the text it was encoded from, so a vector produced against
a description that has since been edited is rejected on load rather than stored stale.
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import numpy as np


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dump", help="JSON lines from --dump-inputs")
    parser.add_argument("out", help="destination .npz")
    parser.add_argument("--model", default=None)
    parser.add_argument("--model-root", default=None, help="directory holding model assets")
    parser.add_argument("--batch-size", type=int, default=64)
    parser.add_argument("--threads", type=int, default=None)
    parser.add_argument(
        "--provider",
        default="cpu",
        choices=["cpu", "cuda"],
        help="cuda requires the onnxruntime-gpu build",
    )
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()

    if args.threads:
        os.environ["REC_DESC_THREADS"] = str(args.threads)
    if args.model_root:
        os.environ["REC_DESC_MODEL_ROOT"] = args.model_root

    from app.ingestion.description_encoder import DescriptionEncoder, get_model

    rows = [json.loads(line) for line in Path(args.dump).read_text(encoding="utf-8").splitlines() if line]
    if args.limit:
        rows = rows[: args.limit]
    if not rows:
        raise SystemExit(f"{args.dump} holds nothing to encode")

    providers = ["CPUExecutionProvider"]
    if args.provider == "cuda":
        import onnxruntime as ort

        # The CUDA libraries usually arrive as pip packages rather than on the library
        # path, and onnxruntime only finds them there once it has been asked to look.
        if hasattr(ort, "preload_dlls"):
            ort.preload_dlls()

        available = ort.get_available_providers()
        if "CUDAExecutionProvider" not in available:
            raise SystemExit(f"CUDA provider unavailable; onnxruntime offers {available}")
        providers = ["CUDAExecutionProvider", "CPUExecutionProvider"]

    model = get_model(args.model)
    encoder = DescriptionEncoder(model, providers=providers)
    print("running on", encoder.session.get_providers())

    print(f"encoding {len(rows)} entries with {model.key} on {args.provider}")
    started = time.perf_counter()
    vectors = encoder.encode([r["text"] for r in rows], batch_size=args.batch_size)
    elapsed = time.perf_counter() - started
    print(f"encoded in {elapsed:.1f}s ({len(rows) / elapsed:.1f}/s)")

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    np.savez(
        out,
        vn_ids=np.array([r["vn_id"] for r in rows]),
        text_hashes=np.array([r["text_hash"] for r in rows]),
        vectors=vectors.astype(np.float16),
    )
    print(f"wrote {out} ({out.stat().st_size / (1024 * 1024):.1f} MB)")


if __name__ == "__main__":
    main()
