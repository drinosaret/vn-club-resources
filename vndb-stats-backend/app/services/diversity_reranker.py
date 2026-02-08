"""
Diversity reranking for recommendations.

Uses Maximal Marginal Relevance (MMR) to balance relevance with diversity,
ensuring recommendations include variety in developers, eras, and genres.
"""

import logging
from dataclasses import dataclass
from typing import Optional

import numpy as np
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import VisualNovel, VNTag, Tag

logger = logging.getLogger(__name__)


@dataclass
class RerankedItem:
    """A recommendation item with diversity metadata."""

    vn_id: str
    original_score: float
    reranked_score: float
    title: str
    developers: list[str]
    release_year: Optional[int]
    popularity: int  # votecount
    tag_ids: set[int]


class DiversityReranker:
    """
    Rerank recommendations for diversity using MMR algorithm.

    MMR balances relevance (original score) with diversity (dissimilarity
    to already-selected items).
    """

    def __init__(self, db: AsyncSession):
        self.db = db

    async def rerank(
        self,
        candidates: list[dict],
        lambda_: float = 0.6,  # Higher = more relevance, lower = more diversity
        novelty_weight: float = 0.15,  # How much to penalize popular items
        min_developers: int = 3,  # Minimum unique developers in results
        top_k: int = 20,
        spoiler_level: int = 0,
    ) -> list[dict]:
        """
        Rerank candidates using MMR with diversity constraints.

        Args:
            candidates: List of {vn_id, score, ...} dicts from base recommender
            lambda_: Balance between relevance (1.0) and diversity (0.0)
            novelty_weight: Weight for novelty boost (penalize popular items)
            min_developers: Minimum number of unique developers to include
            top_k: Number of items to return

        Returns:
            Reranked list of candidates with diversity metadata
        """
        if not candidates or len(candidates) <= 1:
            return candidates

        # Load metadata for all candidates
        vn_ids = [c["vn_id"] for c in candidates]
        metadata = await self._load_vn_metadata(vn_ids, spoiler_level=spoiler_level)

        # Filter to candidates with metadata
        items = []
        for c in candidates:
            if c["vn_id"] in metadata:
                meta = metadata[c["vn_id"]]
                items.append(RerankedItem(
                    vn_id=c["vn_id"],
                    original_score=c.get("score", 0),
                    reranked_score=0,
                    title=meta["title"],
                    developers=meta["developers"],
                    release_year=meta["release_year"],
                    popularity=meta["popularity"],
                    tag_ids=meta["tag_ids"],
                ))

        if not items:
            return candidates

        # Apply novelty boost (reduce scores for very popular items)
        items = self._apply_novelty_boost(items, novelty_weight)

        # MMR reranking
        selected = []
        remaining = list(items)

        # Normalize scores for MMR
        max_score = max(item.original_score for item in remaining) or 1
        for item in remaining:
            item.original_score /= max_score

        while len(selected) < top_k and remaining:
            best_item = None
            best_mmr_score = float("-inf")

            for item in remaining:
                if not selected:
                    # First item: just use relevance
                    mmr_score = item.original_score
                else:
                    # MMR: λ * relevance - (1-λ) * max_similarity
                    max_sim = max(
                        self._compute_similarity(item, sel)
                        for sel in selected
                    )
                    mmr_score = lambda_ * item.original_score - (1 - lambda_) * max_sim

                if mmr_score > best_mmr_score:
                    best_mmr_score = mmr_score
                    best_item = item

            if best_item:
                best_item.reranked_score = best_mmr_score
                selected.append(best_item)
                remaining.remove(best_item)

        # Check developer coverage and potentially swap items
        selected = self._ensure_developer_coverage(selected, remaining, min_developers)

        # Convert back to dict format
        return [
            {
                "vn_id": item.vn_id,
                "score": item.reranked_score,
                "original_score": item.original_score * max_score,
                "diversity_applied": True,
            }
            for item in selected
        ]

    async def _load_vn_metadata(self, vn_ids: list[str], spoiler_level: int = 0) -> dict:
        """Load metadata needed for diversity calculation."""
        metadata = {}

        # Get basic VN info
        result = await self.db.execute(
            select(
                VisualNovel.id,
                VisualNovel.title,
                VisualNovel.released,
                VisualNovel.votecount,
                VisualNovel.developers,
            ).where(VisualNovel.id.in_(vn_ids))
        )

        for vn_id, title, released, votecount, developers in result.all():
            metadata[vn_id] = {
                "title": title,
                "release_year": released.year if released else None,
                "popularity": votecount or 0,
                "developers": developers or [],
                "tag_ids": set(),
            }

        # Get tags for similarity calculation
        result = await self.db.execute(
            select(VNTag.vn_id, VNTag.tag_id)
            .where(VNTag.vn_id.in_(vn_ids))
            .where(VNTag.spoiler_level <= spoiler_level)
            .where(VNTag.score >= 1.5)  # Only strong tags
            .where(VNTag.lie == False)  # exclude disputed/incorrect tags
        )

        for vn_id, tag_id in result.all():
            if vn_id in metadata:
                metadata[vn_id]["tag_ids"].add(tag_id)

        return metadata

    def _apply_novelty_boost(
        self,
        items: list[RerankedItem],
        weight: float,
    ) -> list[RerankedItem]:
        """
        Adjust scores to favor less popular items.

        Popular items get their scores slightly reduced.
        """
        if not items or weight <= 0:
            return items

        # Log-scale popularity for smoother distribution
        popularities = [np.log1p(item.popularity) for item in items]
        max_pop = max(popularities) or 1

        for item, pop in zip(items, popularities):
            # Penalty: 0 for least popular, weight for most popular
            penalty = weight * (pop / max_pop)
            item.original_score *= (1 - penalty)

        return items

    def _compute_similarity(
        self,
        item1: RerankedItem,
        item2: RerankedItem,
    ) -> float:
        """
        Compute similarity between two items for diversity calculation.

        Considers:
        - Developer overlap
        - Tag overlap (Jaccard similarity)
        - Era similarity
        """
        similarities = []

        # Developer overlap (high weight - we really want different developers)
        dev_overlap = len(set(item1.developers) & set(item2.developers))
        if dev_overlap > 0:
            similarities.append(1.0)  # Same developer = very similar
        else:
            similarities.append(0.0)

        # Tag Jaccard similarity
        if item1.tag_ids and item2.tag_ids:
            intersection = len(item1.tag_ids & item2.tag_ids)
            union = len(item1.tag_ids | item2.tag_ids)
            tag_sim = intersection / union if union > 0 else 0
            similarities.append(tag_sim)

        # Era similarity (same decade = similar)
        if item1.release_year and item2.release_year:
            year_diff = abs(item1.release_year - item2.release_year)
            era_sim = max(0, 1 - year_diff / 20)  # 20 years = 0 similarity
            similarities.append(era_sim * 0.3)  # Lower weight for era

        return np.mean(similarities) if similarities else 0

    def _ensure_developer_coverage(
        self,
        selected: list[RerankedItem],
        remaining: list[RerankedItem],
        min_developers: int,
    ) -> list[RerankedItem]:
        """
        Ensure minimum developer diversity by swapping if needed.

        If we have fewer than min_developers unique developers, try to
        swap lower-ranked items with items from new developers.
        """
        # Count current developers
        dev_count = {}
        for item in selected:
            for dev in item.developers:
                dev_count[dev] = dev_count.get(dev, 0) + 1

        unique_devs = len(dev_count)

        if unique_devs >= min_developers or not remaining:
            return selected

        # Find items from new developers in remaining
        existing_devs = set(dev_count.keys())
        new_dev_items = []

        for item in remaining:
            item_devs = set(item.developers)
            if item_devs and not (item_devs & existing_devs):
                new_dev_items.append(item)

        # Swap lowest-scored duplicates with new developer items
        if new_dev_items:
            # Find items where developer appears multiple times
            swappable = []
            for i, item in enumerate(selected):
                for dev in item.developers:
                    if dev_count.get(dev, 0) > 1:
                        swappable.append((i, item))
                        break

            # Sort by score (swap lowest first)
            swappable.sort(key=lambda x: x[1].reranked_score)

            # Do swaps
            swaps_done = 0
            max_swaps = min_developers - unique_devs

            for idx, old_item in swappable[:max_swaps]:
                if new_dev_items:
                    new_item = new_dev_items.pop(0)
                    new_item.reranked_score = old_item.reranked_score * 0.95
                    selected[idx] = new_item

                    # Update dev count
                    for dev in old_item.developers:
                        dev_count[dev] -= 1
                    for dev in new_item.developers:
                        dev_count[dev] = dev_count.get(dev, 0) + 1

                    swaps_done += 1

            if swaps_done > 0:
                logger.info(f"Swapped {swaps_done} items to improve developer diversity")

        return selected


async def apply_diversity_reranking(
    db: AsyncSession,
    candidates: list[dict],
    diversity_lambda: float = 0.6,
    novelty_weight: float = 0.15,
    top_k: int = 20,
    spoiler_level: int = 0,
) -> list[dict]:
    """
    Convenience function to apply diversity reranking.

    Args:
        db: Database session
        candidates: Raw recommendation candidates
        diversity_lambda: Balance between relevance and diversity
        novelty_weight: How much to penalize popular items
        top_k: Number of results to return
        spoiler_level: Max spoiler level for tag visibility (0=none, 1=minor, 2=major)

    Returns:
        Reranked candidates with improved diversity
    """
    reranker = DiversityReranker(db)
    return await reranker.rerank(
        candidates,
        lambda_=diversity_lambda,
        novelty_weight=novelty_weight,
        top_k=top_k,
        spoiler_level=spoiler_level,
    )
