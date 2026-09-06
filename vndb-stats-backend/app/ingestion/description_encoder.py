"""ONNX sentence encoder for VNDB descriptions.

Inference runs on onnxruntime with a `tokenizers` tokenizer, so no deep learning
framework is required at any point. The same code path is used for the one-off full
build and for the nightly incremental top-up, which keeps the two from drifting.

Model assets live on the shared data volume rather than in the image, so the image
stays small and a model swap does not require a rebuild.
"""

import logging
import os
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np

logger = logging.getLogger(__name__)

DEFAULT_MODEL_ROOT = Path(os.getenv("REC_DESC_MODEL_ROOT", "/app/data/models"))


@dataclass(frozen=True)
class EncoderModel:
    """A model the description pipeline knows how to run.

    `version` is written alongside every vector: changing a model, its pooling or its
    prefix invalidates stored vectors, and the version string is what detects that.
    """

    key: str
    repo_id: str
    onnx_file: str
    tokenizer_file: str
    dim: int
    pooling: str  # "mean" or "cls"
    max_tokens: int
    prefix: str = ""
    version: str = ""

    @property
    def model_version(self) -> str:
        return self.version or self.key


MODELS: dict[str, EncoderModel] = {
    # Multilingual. Descriptions are mostly English prose but carry Japanese titles and
    # names inline, which a monolingual vocabulary shatters into unknown pieces.
    "e5-small": EncoderModel(
        key="e5-small",
        repo_id="intfloat/multilingual-e5-small",
        onnx_file="onnx/model.onnx",
        tokenizer_file="tokenizer.json",
        dim=384,
        pooling="mean",
        max_tokens=384,
        # This family is trained with a task prefix; symmetric similarity uses "query".
        prefix="query: ",
        version="e5s-v1",
    ),
    # Same weights quantised to int8: a quarter of the disk and appreciably faster on a
    # CPU, at a rounding error well inside the gap between neighbours.
    "e5-small-int8": EncoderModel(
        key="e5-small-int8",
        repo_id="intfloat/multilingual-e5-small",
        onnx_file="onnx/model_qint8_avx512_vnni.onnx",
        tokenizer_file="tokenizer.json",
        dim=384,
        pooling="mean",
        max_tokens=384,
        prefix="query: ",
        version="e5s-i8-v1",
    ),
    "bge-small-en": EncoderModel(
        key="bge-small-en",
        repo_id="BAAI/bge-small-en-v1.5",
        onnx_file="onnx/model.onnx",
        tokenizer_file="tokenizer.json",
        dim=384,
        pooling="cls",
        max_tokens=384,
        version="bge-s-en-v1",
    ),
    "minilm-l6": EncoderModel(
        key="minilm-l6",
        repo_id="sentence-transformers/all-MiniLM-L6-v2",
        onnx_file="onnx/model.onnx",
        tokenizer_file="tokenizer.json",
        dim=384,
        pooling="mean",
        max_tokens=256,
        version="minilm-l6-v1",
    ),
}

DEFAULT_MODEL_KEY = os.getenv("REC_DESC_MODEL", "e5-small")


def get_model(key: str | None = None) -> EncoderModel:
    key = key or DEFAULT_MODEL_KEY
    if key not in MODELS:
        raise KeyError(f"unknown description encoder {key!r}; known: {sorted(MODELS)}")
    return MODELS[key]


def model_dir(model: EncoderModel, root: Path | None = None) -> Path:
    return (root or DEFAULT_MODEL_ROOT) / model.key


def ensure_assets(model: EncoderModel, root: Path | None = None, allow_download: bool = True) -> Path:
    """Return the local directory holding the model, fetching it once if absent.

    The fetch is a deliberate one-off dependency download, not a runtime call: after the
    first success everything reads from the data volume.
    """
    target = model_dir(model, root)
    onnx_path = target / "model.onnx"
    tok_path = target / "tokenizer.json"
    external = target / "model.onnx_data"

    if onnx_path.exists() and tok_path.exists():
        return target

    if not allow_download:
        raise FileNotFoundError(
            f"description encoder assets missing at {target}; "
            f"run scripts/build_description_embeddings.py --download"
        )

    from huggingface_hub import hf_hub_download

    target.mkdir(parents=True, exist_ok=True)
    logger.info("Fetching encoder assets for %s from %s", model.key, model.repo_id)

    src = hf_hub_download(model.repo_id, model.onnx_file)
    _copy(Path(src), onnx_path)
    src = hf_hub_download(model.repo_id, model.tokenizer_file)
    _copy(Path(src), tok_path)

    # Larger exports keep their weights in a sidecar the graph references by name.
    try:
        src = hf_hub_download(model.repo_id, model.onnx_file + "_data")
        _copy(Path(src), external)
    except Exception:
        pass

    return target


def _copy(src: Path, dst: Path) -> None:
    import shutil

    shutil.copyfile(src, dst)


class DescriptionEncoder:
    """Batched ONNX encoder producing L2-normalized float32 vectors."""

    def __init__(
        self,
        model: EncoderModel | None = None,
        root: Path | None = None,
        threads: int | None = None,
        allow_download: bool = True,
        providers: list[str] | None = None,
    ):
        import onnxruntime as ort
        from tokenizers import Tokenizer

        self.model = model or get_model()
        directory = ensure_assets(self.model, root, allow_download=allow_download)

        opts = ort.SessionOptions()
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        # The worker shares a small host with the API and Postgres, so the encoder is
        # held to an explicit thread budget rather than claiming every core.
        n = threads or int(os.getenv("REC_DESC_THREADS", "2"))
        opts.intra_op_num_threads = n
        opts.inter_op_num_threads = 1
        # Serving never runs the encoder, so the deployed path is CPU by definition. An
        # offline build names its own provider.
        self.session = ort.InferenceSession(
            str(directory / "model.onnx"), opts, providers=providers or ["CPUExecutionProvider"]
        )
        self.input_names = {i.name for i in self.session.get_inputs()}

        self.tokenizer = Tokenizer.from_file(str(directory / "tokenizer.json"))
        self.tokenizer.enable_truncation(max_length=self.model.max_tokens)
        self.tokenizer.enable_padding(pad_id=self._pad_id(), pad_token=self._pad_token())

    def _pad_token(self) -> str:
        for candidate in ("<pad>", "[PAD]"):
            if self.tokenizer.token_to_id(candidate) is not None:
                return candidate
        return "[PAD]"

    def _pad_id(self) -> int:
        return self.tokenizer.token_to_id(self._pad_token()) or 0

    def encode(self, texts: list[str], batch_size: int = 32) -> np.ndarray:
        """Encode texts in input order.

        Batches are formed over length-sorted input so that padding follows the longest
        member of a batch rather than the longest of the corpus.
        """
        if not texts:
            return np.zeros((0, self.model.dim), dtype=np.float32)

        prefixed = [self.model.prefix + t for t in texts]
        order = sorted(range(len(prefixed)), key=lambda i: len(prefixed[i]))
        out = np.zeros((len(prefixed), self.model.dim), dtype=np.float32)

        for start in range(0, len(order), batch_size):
            idx = order[start : start + batch_size]
            out[idx] = self._encode_batch([prefixed[i] for i in idx])

        return out

    def _encode_batch(self, batch: list[str]) -> np.ndarray:
        encodings = self.tokenizer.encode_batch(batch)
        ids = np.array([e.ids for e in encodings], dtype=np.int64)
        mask = np.array([e.attention_mask for e in encodings], dtype=np.int64)

        feed = {"input_ids": ids, "attention_mask": mask}
        if "token_type_ids" in self.input_names:
            feed["token_type_ids"] = np.zeros_like(ids)
        feed = {k: v for k, v in feed.items() if k in self.input_names}

        hidden = self.session.run(None, feed)[0]

        if self.model.pooling == "cls":
            pooled = hidden[:, 0]
        else:
            m = mask.astype(np.float32)[:, :, None]
            pooled = (hidden * m).sum(axis=1) / np.clip(m.sum(axis=1), 1e-9, None)

        norms = np.linalg.norm(pooled, axis=1, keepdims=True)
        return (pooled / np.clip(norms, 1e-12, None)).astype(np.float32)


def measure_rate(encoder: DescriptionEncoder, texts: list[str], batch_size: int = 32) -> float:
    """Encode a sample and return texts per second."""
    started = time.perf_counter()
    encoder.encode(texts, batch_size=batch_size)
    elapsed = time.perf_counter() - started
    return len(texts) / elapsed if elapsed else 0.0
