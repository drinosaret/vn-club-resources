"""Ranking metrics shared by the offline recommendation evaluations.

Every evaluation script imports these rather than defining its own, so that
numbers produced by different scripts are comparable without re-deriving the formulas.

Each function takes the ranked list of recommended item ids, the set of relevant
(held-out) item ids, and the cutoff k. Items beyond position k are ignored.
"""

import numpy as np


def ndcg_at_k(recommended: list, relevant: set, k: int) -> float:
    """Calculate NDCG@K."""
    dcg = 0.0
    for i, item in enumerate(recommended[:k]):
        if item in relevant:
            dcg += 1.0 / np.log2(i + 2)  # i+2 because position starts at 1

    # Ideal DCG
    idcg = sum(1.0 / np.log2(i + 2) for i in range(min(len(relevant), k)))

    return dcg / idcg if idcg > 0 else 0.0


def hit_at_k(recommended: list, relevant: set, k: int) -> float:
    """Calculate Hit@K (1 if any relevant item in top K, else 0)."""
    return 1.0 if any(item in relevant for item in recommended[:k]) else 0.0


def recall_at_k(recommended: list, relevant: set, k: int) -> float:
    """Calculate Recall@K."""
    if not relevant:
        return 0.0
    hits = sum(1 for item in recommended[:k] if item in relevant)
    return hits / len(relevant)


def mrr_at_k(recommended: list, relevant: set, k: int) -> float:
    """Calculate MRR@K (Mean Reciprocal Rank)."""
    for i, item in enumerate(recommended[:k]):
        if item in relevant:
            return 1.0 / (i + 1)
    return 0.0


def precision_at_k(recommended: list, relevant: set, k: int) -> float:
    """Calculate Precision@K."""
    hits = sum(1 for item in recommended[:k] if item in relevant)
    return hits / k
