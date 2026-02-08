"""
Heterogeneous Graph Attention Network for VN Recommendations.

This model learns embeddings for users and VNs by propagating information
through a heterogeneous knowledge graph that connects:
- Users to VNs (rated edges with scores)
- VNs to Tags (has_tag edges)
- VNs to Staff (created_by edges with role info)
- VNs to Seiyuu (voiced_by edges)
- VNs to Producers (produced_by edges)
- VNs to Characters (has_char edges)
- Characters to Traits (has_trait edges)
"""

import logging
from dataclasses import dataclass
from typing import Optional

import torch
import torch.nn as nn
import torch.nn.functional as F
from torch_geometric.data import HeteroData
from torch_geometric.nn import HGTConv, Linear, HeteroConv, SAGEConv

logger = logging.getLogger(__name__)


@dataclass
class HGATConfig:
    """Configuration for HGAT model."""

    # Model architecture
    hidden_dim: int = 128
    output_dim: int = 128
    num_heads: int = 4
    num_layers: int = 3
    dropout: float = 0.2

    # Training
    learning_rate: float = 0.001
    weight_decay: float = 1e-5
    batch_size: int = 1024
    num_epochs: int = 50
    early_stopping_patience: int = 10

    # Loss weights
    bpr_weight: float = 1.0
    rating_weight: float = 0.5
    contrastive_weight: float = 0.1

    # Node types in the graph
    node_types: tuple = ("user", "vn", "tag", "staff", "producer", "character", "trait")

    # Edge types (source, relation, target)
    edge_types: tuple = (
        ("user", "rated", "vn"),
        ("vn", "rev_rated", "user"),
        ("vn", "has_tag", "tag"),
        ("tag", "rev_has_tag", "vn"),
        ("vn", "created_by", "staff"),
        ("staff", "rev_created_by", "vn"),
        ("vn", "voiced_by", "staff"),
        ("staff", "rev_voiced_by", "vn"),
        ("vn", "produced_by", "producer"),
        ("producer", "rev_produced_by", "vn"),
        ("vn", "has_char", "character"),
        ("character", "rev_has_char", "vn"),
        ("character", "has_trait", "trait"),
        ("trait", "rev_has_trait", "character"),
    )


class HGATLayer(nn.Module):
    """
    Single layer of Heterogeneous Graph Attention.

    Uses HeteroConv with SAGEConv for each edge type, which is more
    memory-efficient than full attention while still being effective.
    """

    def __init__(
        self,
        in_dim: int,
        out_dim: int,
        edge_types: tuple,
        dropout: float = 0.2,
    ):
        super().__init__()

        # Create a SAGEConv for each edge type
        convs = {}
        for edge_type in edge_types:
            convs[edge_type] = SAGEConv(
                in_channels=in_dim,
                out_channels=out_dim,
                normalize=True,
            )

        self.conv = HeteroConv(convs, aggr="mean")
        self.dropout = nn.Dropout(dropout)
        self.layer_norm = nn.ModuleDict({
            node_type: nn.LayerNorm(out_dim)
            for node_type in set(
                [et[0] for et in edge_types] + [et[2] for et in edge_types]
            )
        })

    def forward(
        self,
        x_dict: dict[str, torch.Tensor],
        edge_index_dict: dict[tuple, torch.Tensor],
    ) -> dict[str, torch.Tensor]:
        # Message passing
        out_dict = self.conv(x_dict, edge_index_dict)

        # Residual connection + layer norm + dropout
        result = {}
        for node_type, x in out_dict.items():
            if node_type in x_dict and x_dict[node_type].shape[-1] == x.shape[-1]:
                x = x + x_dict[node_type]  # Residual
            x = self.layer_norm[node_type](x)
            x = F.relu(x)
            x = self.dropout(x)
            result[node_type] = x

        return result


class HGATEncoder(nn.Module):
    """
    Heterogeneous Graph Attention Encoder.

    Transforms node features through multiple HGAT layers to produce
    rich embeddings that capture graph structure.
    """

    def __init__(
        self,
        config: HGATConfig,
        node_feature_dims: dict[str, int],
        edge_types: tuple = None,
    ):
        super().__init__()
        self.config = config
        # Use provided edge types or fall back to config
        self.edge_types = edge_types if edge_types is not None else config.edge_types

        # Input projection for each node type
        self.input_proj = nn.ModuleDict({
            node_type: Linear(feat_dim, config.hidden_dim)
            for node_type, feat_dim in node_feature_dims.items()
        })

        # HGAT layers
        self.layers = nn.ModuleList([
            HGATLayer(
                in_dim=config.hidden_dim,
                out_dim=config.hidden_dim,
                edge_types=self.edge_types,
                dropout=config.dropout,
            )
            for _ in range(config.num_layers)
        ])

        # Output projection for user and VN embeddings
        self.user_output = Linear(config.hidden_dim, config.output_dim)
        self.vn_output = Linear(config.hidden_dim, config.output_dim)

    def forward(
        self,
        x_dict: dict[str, torch.Tensor],
        edge_index_dict: dict[tuple, torch.Tensor],
    ) -> tuple[torch.Tensor, torch.Tensor]:
        """
        Forward pass through the encoder.

        Returns:
            user_embeddings: (num_users, output_dim)
            vn_embeddings: (num_vns, output_dim)
        """
        # Project input features
        h_dict = {
            node_type: self.input_proj[node_type](x)
            for node_type, x in x_dict.items()
            if node_type in self.input_proj
        }

        # Message passing layers
        for layer in self.layers:
            h_dict = layer(h_dict, edge_index_dict)

        # Extract user and VN embeddings
        user_emb = self.user_output(h_dict["user"])
        vn_emb = self.vn_output(h_dict["vn"])

        # L2 normalize for cosine similarity
        user_emb = F.normalize(user_emb, p=2, dim=-1)
        vn_emb = F.normalize(vn_emb, p=2, dim=-1)

        return user_emb, vn_emb


class HGATRecommender(nn.Module):
    """
    Full HGAT Recommender model with training losses.

    Combines:
    1. BPR loss for ranking (learn to rank positives above negatives)
    2. Rating prediction loss (optional, for rating prediction)
    3. Contrastive loss (optional, for better representations)
    """

    def __init__(
        self,
        config: HGATConfig,
        node_feature_dims: dict[str, int],
        edge_types: tuple = None,
    ):
        super().__init__()
        self.config = config
        self.encoder = HGATEncoder(config, node_feature_dims, edge_types)

        # Rating prediction head (optional)
        self.rating_head = nn.Sequential(
            Linear(config.output_dim * 2, config.hidden_dim),
            nn.ReLU(),
            nn.Dropout(config.dropout),
            Linear(config.hidden_dim, 1),
        )

    def forward(
        self,
        data: HeteroData,
    ) -> tuple[torch.Tensor, torch.Tensor]:
        """
        Forward pass to get embeddings.

        Args:
            data: HeteroData with node features and edge indices

        Returns:
            user_embeddings, vn_embeddings
        """
        x_dict = {key: data[key].x for key in data.node_types if hasattr(data[key], 'x')}
        edge_index_dict = {
            key: data[key].edge_index
            for key in data.edge_types
            if hasattr(data[key], 'edge_index')
        }

        return self.encoder(x_dict, edge_index_dict)

    def predict_ratings(
        self,
        user_emb: torch.Tensor,
        vn_emb: torch.Tensor,
        user_indices: torch.Tensor,
        vn_indices: torch.Tensor,
    ) -> torch.Tensor:
        """Predict ratings for user-VN pairs."""
        u = user_emb[user_indices]
        v = vn_emb[vn_indices]
        concat = torch.cat([u, v], dim=-1)
        return self.rating_head(concat).squeeze(-1)

    def bpr_loss(
        self,
        user_emb: torch.Tensor,
        vn_emb: torch.Tensor,
        pos_user_idx: torch.Tensor,
        pos_vn_idx: torch.Tensor,
        neg_vn_idx: torch.Tensor,
    ) -> torch.Tensor:
        """
        BPR (Bayesian Personalized Ranking) loss.

        Encourages positive pairs to have higher scores than negative pairs.
        """
        user_emb_batch = user_emb[pos_user_idx]
        pos_vn_emb = vn_emb[pos_vn_idx]
        neg_vn_emb = vn_emb[neg_vn_idx]

        # Dot product scores
        pos_scores = (user_emb_batch * pos_vn_emb).sum(dim=-1)
        neg_scores = (user_emb_batch * neg_vn_emb).sum(dim=-1)

        # BPR loss: -log(sigmoid(pos - neg))
        loss = -F.logsigmoid(pos_scores - neg_scores).mean()

        return loss

    def rating_loss(
        self,
        user_emb: torch.Tensor,
        vn_emb: torch.Tensor,
        user_indices: torch.Tensor,
        vn_indices: torch.Tensor,
        ratings: torch.Tensor,
    ) -> torch.Tensor:
        """MSE loss for rating prediction."""
        pred_ratings = self.predict_ratings(user_emb, vn_emb, user_indices, vn_indices)
        # Normalize ratings to [0, 1] (original is 10-100)
        normalized_ratings = (ratings - 10) / 90
        return F.mse_loss(torch.sigmoid(pred_ratings), normalized_ratings)

    def contrastive_loss(
        self,
        user_emb: torch.Tensor,
        vn_emb: torch.Tensor,
        pos_user_idx: torch.Tensor,
        pos_vn_idx: torch.Tensor,
        temperature: float = 0.1,
    ) -> torch.Tensor:
        """
        InfoNCE contrastive loss for better representations.

        Treats other items in the batch as negatives.
        """
        user_batch = user_emb[pos_user_idx]
        vn_batch = vn_emb[pos_vn_idx]

        # Similarity matrix
        sim = torch.matmul(user_batch, vn_batch.T) / temperature

        # Labels: diagonal elements are positives
        labels = torch.arange(sim.size(0), device=sim.device)

        # Cross entropy loss
        loss = F.cross_entropy(sim, labels)

        return loss

    def compute_loss(
        self,
        data: HeteroData,
        pos_edges: tuple[torch.Tensor, torch.Tensor],
        neg_vn_idx: torch.Tensor,
        ratings: Optional[torch.Tensor] = None,
    ) -> dict[str, torch.Tensor]:
        """
        Compute all losses.

        Args:
            data: HeteroData graph
            pos_edges: (user_indices, vn_indices) for positive pairs
            neg_vn_idx: Negative VN indices (sampled)
            ratings: Optional ratings for supervision

        Returns:
            Dict with individual losses and total loss
        """
        user_emb, vn_emb = self.forward(data)

        pos_user_idx, pos_vn_idx = pos_edges

        losses = {}

        # BPR ranking loss
        losses["bpr"] = self.bpr_loss(
            user_emb, vn_emb, pos_user_idx, pos_vn_idx, neg_vn_idx
        )

        # Rating prediction loss (if ratings available)
        if ratings is not None and self.config.rating_weight > 0:
            losses["rating"] = self.rating_loss(
                user_emb, vn_emb, pos_user_idx, pos_vn_idx, ratings
            )
        else:
            losses["rating"] = torch.tensor(0.0, device=user_emb.device)

        # Contrastive loss
        if self.config.contrastive_weight > 0:
            losses["contrastive"] = self.contrastive_loss(
                user_emb, vn_emb, pos_user_idx, pos_vn_idx
            )
        else:
            losses["contrastive"] = torch.tensor(0.0, device=user_emb.device)

        # Total weighted loss
        losses["total"] = (
            self.config.bpr_weight * losses["bpr"]
            + self.config.rating_weight * losses["rating"]
            + self.config.contrastive_weight * losses["contrastive"]
        )

        return losses

    @torch.no_grad()
    def get_recommendations(
        self,
        data: HeteroData,
        user_idx: int,
        exclude_vn_ids: set[int],
        top_k: int = 50,
    ) -> list[tuple[int, float]]:
        """
        Get top-K VN recommendations for a user.

        Args:
            data: HeteroData graph
            user_idx: User index in the graph
            exclude_vn_ids: VN indices to exclude (already seen)
            top_k: Number of recommendations

        Returns:
            List of (vn_idx, score) tuples
        """
        self.eval()
        user_emb, vn_emb = self.forward(data)

        # Compute scores for all VNs
        user_vec = user_emb[user_idx]
        scores = torch.matmul(vn_emb, user_vec)

        # Mask excluded VNs
        for vn_idx in exclude_vn_ids:
            scores[vn_idx] = float("-inf")

        # Get top-K
        top_scores, top_indices = torch.topk(scores, min(top_k, len(scores)))

        return [
            (idx.item(), score.item())
            for idx, score in zip(top_indices, top_scores)
        ]


def create_model(
    data: HeteroData,
    config: Optional[HGATConfig] = None,
) -> HGATRecommender:
    """
    Create HGAT model from graph data.

    Args:
        data: HeteroData with node features
        config: Model configuration (uses defaults if not provided)

    Returns:
        Initialized HGATRecommender
    """
    if config is None:
        config = HGATConfig()

    # Get feature dimensions from data
    node_feature_dims = {}
    for node_type in data.node_types:
        if hasattr(data[node_type], 'x'):
            node_feature_dims[node_type] = data[node_type].x.shape[1]

    # Get edge types from data
    edge_types = tuple(data.edge_types)

    logger.info(f"Creating HGAT model with feature dims: {node_feature_dims}")
    logger.info(f"Edge types: {edge_types}")

    model = HGATRecommender(config, node_feature_dims, edge_types)

    # Count parameters
    num_params = sum(p.numel() for p in model.parameters())
    logger.info(f"Model created with {num_params:,} parameters")

    return model
