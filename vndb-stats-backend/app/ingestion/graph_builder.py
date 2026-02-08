"""
Build heterogeneous knowledge graph for HGAT recommendation model.

This module constructs a PyTorch Geometric HeteroData graph from the database,
connecting users, VNs, tags, staff, producers, characters, and traits.
"""

import logging
from datetime import datetime
from pathlib import Path
import pickle

import numpy as np
import torch
from sqlalchemy import select, text, func
from torch_geometric.data import HeteroData

from app.db.database import async_session
from app.db.models import (
    VisualNovel, Tag, VNTag, GlobalVote,
    Staff, VNStaff, VNSeiyuu,
    Producer, ReleaseProducer, ReleaseVN,
    Character, CharacterVN, CharacterTrait, Trait,
    CFVNFactors, TagVNVector,
)

logger = logging.getLogger(__name__)

# Graph save location
GRAPH_DIR = Path(__file__).parent.parent.parent / "data" / "graph"


async def build_node_mappings() -> dict:
    """
    Build ID-to-index mappings for all node types.
    Returns dict of {node_type: {original_id: index}}
    """
    mappings = {}

    async with async_session() as db:
        # Users (from GlobalVote user_hash)
        result = await db.execute(
            select(GlobalVote.user_hash).distinct()
        )
        user_hashes = [r[0] for r in result.all()]
        mappings['user'] = {h: i for i, h in enumerate(user_hashes)}
        logger.info(f"Users: {len(mappings['user']):,}")

        # VNs
        result = await db.execute(select(VisualNovel.id))
        vn_ids = [r[0] for r in result.all()]
        mappings['vn'] = {vid: i for i, vid in enumerate(vn_ids)}
        logger.info(f"VNs: {len(mappings['vn']):,}")

        # Tags
        result = await db.execute(
            select(Tag.id).where(Tag.applicable == True)
        )
        tag_ids = [r[0] for r in result.all()]
        mappings['tag'] = {tid: i for i, tid in enumerate(tag_ids)}
        logger.info(f"Tags: {len(mappings['tag']):,}")

        # Staff
        result = await db.execute(select(Staff.id))
        staff_ids = [r[0] for r in result.all()]
        mappings['staff'] = {sid: i for i, sid in enumerate(staff_ids)}
        logger.info(f"Staff: {len(mappings['staff']):,}")

        # Producers
        result = await db.execute(select(Producer.id))
        producer_ids = [r[0] for r in result.all()]
        mappings['producer'] = {pid: i for i, pid in enumerate(producer_ids)}
        logger.info(f"Producers: {len(mappings['producer']):,}")

        # Characters
        result = await db.execute(select(Character.id))
        char_ids = [r[0] for r in result.all()]
        mappings['character'] = {cid: i for i, cid in enumerate(char_ids)}
        logger.info(f"Characters: {len(mappings['character']):,}")

        # Traits
        result = await db.execute(
            select(Trait.id).where(Trait.applicable == True)
        )
        trait_ids = [r[0] for r in result.all()]
        mappings['trait'] = {tid: i for i, tid in enumerate(trait_ids)}
        logger.info(f"Traits: {len(mappings['trait']):,}")

    return mappings


async def build_node_features(mappings: dict) -> dict:
    """
    Build feature tensors for each node type.
    Returns dict of {node_type: torch.Tensor}
    """
    features = {}

    async with async_session() as db:
        # VN features: [rating, votecount_log, length, release_year_norm]
        num_vns = len(mappings['vn'])
        vn_features = np.zeros((num_vns, 4), dtype=np.float32)

        result = await db.execute(
            select(
                VisualNovel.id,
                VisualNovel.rating,
                VisualNovel.votecount,
                VisualNovel.length,
                VisualNovel.released,
            )
        )
        for vn_id, rating, votecount, length, released in result.all():
            if vn_id not in mappings['vn']:
                continue
            idx = mappings['vn'][vn_id]
            vn_features[idx, 0] = (rating or 0) / 10.0  # Normalize to 0-1
            vn_features[idx, 1] = np.log1p(votecount or 0) / 10.0  # Log scale
            vn_features[idx, 2] = (length or 3) / 5.0  # Normalize 1-5 to 0.2-1
            if released:
                # Normalize year: 1990-2026 -> 0-1
                vn_features[idx, 3] = (released.year - 1990) / 36.0
            else:
                vn_features[idx, 3] = 0.5  # Default to middle

        features['vn'] = torch.tensor(vn_features, dtype=torch.float32)
        logger.info(f"VN features shape: {features['vn'].shape}")

        # Tag features: [category_onehot (3)] - content, technical, sexual
        num_tags = len(mappings['tag'])
        tag_features = np.zeros((num_tags, 3), dtype=np.float32)
        category_map = {'cont': 0, 'tech': 1, 'ero': 2}

        result = await db.execute(
            select(Tag.id, Tag.category).where(Tag.applicable == True)
        )
        for tag_id, category in result.all():
            if tag_id not in mappings['tag']:
                continue
            idx = mappings['tag'][tag_id]
            cat_idx = category_map.get(category, 0)
            tag_features[idx, cat_idx] = 1.0

        features['tag'] = torch.tensor(tag_features, dtype=torch.float32)
        logger.info(f"Tag features shape: {features['tag'].shape}")

        # Staff features: [gender_onehot (3)] - male, female, unknown
        num_staff = len(mappings['staff'])
        staff_features = np.zeros((num_staff, 3), dtype=np.float32)
        gender_map = {'m': 0, 'f': 1}

        result = await db.execute(select(Staff.id, Staff.gender))
        for staff_id, gender in result.all():
            if staff_id not in mappings['staff']:
                continue
            idx = mappings['staff'][staff_id]
            if gender in gender_map:
                staff_features[idx, gender_map[gender]] = 1.0
            else:
                staff_features[idx, 2] = 1.0  # Unknown

        features['staff'] = torch.tensor(staff_features, dtype=torch.float32)
        logger.info(f"Staff features shape: {features['staff'].shape}")

        # Producer features: [type_onehot (3)] - company, individual, amateur
        num_producers = len(mappings['producer'])
        producer_features = np.zeros((num_producers, 3), dtype=np.float32)
        type_map = {'co': 0, 'in': 1, 'ng': 2}

        result = await db.execute(select(Producer.id, Producer.type))
        for producer_id, ptype in result.all():
            if producer_id not in mappings['producer']:
                continue
            idx = mappings['producer'][producer_id]
            if ptype in type_map:
                producer_features[idx, type_map[ptype]] = 1.0
            else:
                producer_features[idx, 0] = 1.0  # Default to company

        features['producer'] = torch.tensor(producer_features, dtype=torch.float32)
        logger.info(f"Producer features shape: {features['producer'].shape}")

        # User, Character, Trait: minimal features (just indices, learned embeddings)
        features['user'] = torch.zeros((len(mappings['user']), 1), dtype=torch.float32)
        features['character'] = torch.zeros((len(mappings['character']), 1), dtype=torch.float32)
        features['trait'] = torch.zeros((len(mappings['trait']), 1), dtype=torch.float32)

        logger.info(f"User features shape: {features['user'].shape}")
        logger.info(f"Character features shape: {features['character'].shape}")
        logger.info(f"Trait features shape: {features['trait'].shape}")

    return features


async def build_edges(mappings: dict) -> dict:
    """
    Build edge index tensors for each edge type.
    Returns dict of {(src_type, edge_type, dst_type): (edge_index, edge_attr)}
    """
    edges = {}

    async with async_session() as db:
        # 1. User -rated-> VN (with vote as edge weight)
        logger.info("Loading user-vn edges...")
        result = await db.execute(
            select(GlobalVote.user_hash, GlobalVote.vn_id, GlobalVote.vote)
        )
        src_indices = []
        dst_indices = []
        edge_weights = []

        for user_hash, vn_id, vote in result.all():
            if user_hash not in mappings['user'] or vn_id not in mappings['vn']:
                continue
            src_indices.append(mappings['user'][user_hash])
            dst_indices.append(mappings['vn'][vn_id])
            edge_weights.append(vote / 100.0)  # Normalize to 0-1

        edges[('user', 'rated', 'vn')] = (
            torch.tensor([src_indices, dst_indices], dtype=torch.long),
            torch.tensor(edge_weights, dtype=torch.float32),
        )
        logger.info(f"User-rated-VN edges: {len(src_indices):,}")

        # Reverse edge for message passing
        edges[('vn', 'rated_by', 'user')] = (
            torch.tensor([dst_indices, src_indices], dtype=torch.long),
            torch.tensor(edge_weights, dtype=torch.float32),
        )

        # 2. VN -has_tag-> Tag (with tag score as weight)
        logger.info("Loading vn-tag edges...")
        result = await db.execute(
            select(VNTag.vn_id, VNTag.tag_id, VNTag.score)
            .where(VNTag.spoiler_level == 0)
            .where(VNTag.score > 0)
        )
        src_indices = []
        dst_indices = []
        edge_weights = []

        for vn_id, tag_id, score in result.all():
            if vn_id not in mappings['vn'] or tag_id not in mappings['tag']:
                continue
            src_indices.append(mappings['vn'][vn_id])
            dst_indices.append(mappings['tag'][tag_id])
            edge_weights.append(score / 3.0)  # Normalize 0-3 to 0-1

        edges[('vn', 'has_tag', 'tag')] = (
            torch.tensor([src_indices, dst_indices], dtype=torch.long),
            torch.tensor(edge_weights, dtype=torch.float32),
        )
        edges[('tag', 'tag_of', 'vn')] = (
            torch.tensor([dst_indices, src_indices], dtype=torch.long),
            torch.tensor(edge_weights, dtype=torch.float32),
        )
        logger.info(f"VN-has_tag-Tag edges: {len(src_indices):,}")

        # 3. VN -written_by-> Staff (role-based weights)
        logger.info("Loading vn-staff edges...")
        role_weights = {
            'scenario': 1.0,
            'director': 0.9,
            'art': 0.8,
            'music': 0.6,
            'songs': 0.5,
        }
        result = await db.execute(
            select(VNStaff.vn_id, VNStaff.staff_id, VNStaff.role)
        )
        src_indices = []
        dst_indices = []
        edge_weights = []

        for vn_id, staff_id, role in result.all():
            if vn_id not in mappings['vn'] or staff_id not in mappings['staff']:
                continue
            src_indices.append(mappings['vn'][vn_id])
            dst_indices.append(mappings['staff'][staff_id])
            edge_weights.append(role_weights.get(role, 0.5))

        edges[('vn', 'created_by', 'staff')] = (
            torch.tensor([src_indices, dst_indices], dtype=torch.long),
            torch.tensor(edge_weights, dtype=torch.float32),
        )
        edges[('staff', 'created', 'vn')] = (
            torch.tensor([dst_indices, src_indices], dtype=torch.long),
            torch.tensor(edge_weights, dtype=torch.float32),
        )
        logger.info(f"VN-created_by-Staff edges: {len(src_indices):,}")

        # 4. VN -voiced_by-> Staff (seiyuu)
        logger.info("Loading vn-seiyuu edges...")
        result = await db.execute(
            select(VNSeiyuu.vn_id, VNSeiyuu.staff_id).distinct()
        )
        src_indices = []
        dst_indices = []

        for vn_id, staff_id in result.all():
            if vn_id not in mappings['vn'] or staff_id not in mappings['staff']:
                continue
            src_indices.append(mappings['vn'][vn_id])
            dst_indices.append(mappings['staff'][staff_id])

        edge_weights = [1.0] * len(src_indices)
        edges[('vn', 'voiced_by', 'staff')] = (
            torch.tensor([src_indices, dst_indices], dtype=torch.long),
            torch.tensor(edge_weights, dtype=torch.float32),
        )
        edges[('staff', 'voiced', 'vn')] = (
            torch.tensor([dst_indices, src_indices], dtype=torch.long),
            torch.tensor(edge_weights, dtype=torch.float32),
        )
        logger.info(f"VN-voiced_by-Staff edges: {len(src_indices):,}")

        # 5. VN -developed_by-> Producer (via Release)
        logger.info("Loading vn-producer edges...")
        result = await db.execute(
            text("""
                SELECT DISTINCT rv.vn_id, rp.producer_id, rp.developer, rp.publisher
                FROM release_vn rv
                JOIN release_producers rp ON rv.release_id = rp.release_id
            """)
        )
        src_indices = []
        dst_indices = []
        edge_weights = []

        for vn_id, producer_id, is_developer, is_publisher in result.all():
            if vn_id not in mappings['vn'] or producer_id not in mappings['producer']:
                continue
            src_indices.append(mappings['vn'][vn_id])
            dst_indices.append(mappings['producer'][producer_id])
            # Weight: developer=1.0, publisher=0.5, both=1.0
            weight = 1.0 if is_developer else 0.5
            edge_weights.append(weight)

        edges[('vn', 'produced_by', 'producer')] = (
            torch.tensor([src_indices, dst_indices], dtype=torch.long),
            torch.tensor(edge_weights, dtype=torch.float32),
        )
        edges[('producer', 'produced', 'vn')] = (
            torch.tensor([dst_indices, src_indices], dtype=torch.long),
            torch.tensor(edge_weights, dtype=torch.float32),
        )
        logger.info(f"VN-produced_by-Producer edges: {len(src_indices):,}")

        # 6. VN -has_character-> Character (role-based weights)
        logger.info("Loading vn-character edges...")
        char_role_weights = {
            'main': 1.0,
            'primary': 0.8,
            'side': 0.5,
            'appears': 0.3,
        }
        result = await db.execute(
            select(CharacterVN.vn_id, CharacterVN.character_id, CharacterVN.role)
        )
        src_indices = []
        dst_indices = []
        edge_weights = []

        for vn_id, char_id, role in result.all():
            if vn_id not in mappings['vn'] or char_id not in mappings['character']:
                continue
            src_indices.append(mappings['vn'][vn_id])
            dst_indices.append(mappings['character'][char_id])
            edge_weights.append(char_role_weights.get(role, 0.5))

        edges[('vn', 'has_char', 'character')] = (
            torch.tensor([src_indices, dst_indices], dtype=torch.long),
            torch.tensor(edge_weights, dtype=torch.float32),
        )
        edges[('character', 'in_vn', 'vn')] = (
            torch.tensor([dst_indices, src_indices], dtype=torch.long),
            torch.tensor(edge_weights, dtype=torch.float32),
        )
        logger.info(f"VN-has_char-Character edges: {len(src_indices):,}")

        # 7. Character -has_trait-> Trait (non-spoiler only)
        logger.info("Loading character-trait edges...")
        result = await db.execute(
            select(CharacterTrait.character_id, CharacterTrait.trait_id)
            .where(CharacterTrait.spoiler_level == 0)
        )
        src_indices = []
        dst_indices = []

        for char_id, trait_id in result.all():
            if char_id not in mappings['character'] or trait_id not in mappings['trait']:
                continue
            src_indices.append(mappings['character'][char_id])
            dst_indices.append(mappings['trait'][trait_id])

        edge_weights = [1.0] * len(src_indices)
        edges[('character', 'has_trait', 'trait')] = (
            torch.tensor([src_indices, dst_indices], dtype=torch.long),
            torch.tensor(edge_weights, dtype=torch.float32),
        )
        edges[('trait', 'trait_of', 'character')] = (
            torch.tensor([dst_indices, src_indices], dtype=torch.long),
            torch.tensor(edge_weights, dtype=torch.float32),
        )
        logger.info(f"Character-has_trait-Trait edges: {len(src_indices):,}")

    return edges


async def build_knowledge_graph() -> HeteroData:
    """
    Build the complete heterogeneous knowledge graph.
    Returns a PyTorch Geometric HeteroData object.
    """
    logger.info("Building VN knowledge graph...")

    # Step 1: Build node ID mappings
    logger.info("Step 1: Building node mappings...")
    mappings = await build_node_mappings()

    # Step 2: Build node features
    logger.info("Step 2: Building node features...")
    features = await build_node_features(mappings)

    # Step 3: Build edges
    logger.info("Step 3: Building edges...")
    edges = await build_edges(mappings)

    # Step 4: Create HeteroData object
    logger.info("Step 4: Creating HeteroData...")
    data = HeteroData()

    # Add node features
    for node_type, feat in features.items():
        data[node_type].x = feat
        data[node_type].num_nodes = feat.shape[0]

    # Add edges
    for edge_type, (edge_index, edge_attr) in edges.items():
        data[edge_type].edge_index = edge_index
        data[edge_type].edge_attr = edge_attr

    # Store mappings for later use
    data.mappings = mappings

    logger.info("Knowledge graph built successfully!")
    logger.info(f"Node types: {data.node_types}")
    logger.info(f"Edge types: {data.edge_types}")

    return data


async def save_graph(data: HeteroData, path: Path = None):
    """Save the graph to disk."""
    if path is None:
        path = GRAPH_DIR / "vn_knowledge_graph.pt"

    path.parent.mkdir(parents=True, exist_ok=True)

    # Save graph
    torch.save(data, path)
    logger.info(f"Graph saved to {path}")

    # Save mappings separately for easy access
    mappings_path = path.parent / "mappings.pkl"
    with open(mappings_path, 'wb') as f:
        pickle.dump(data.mappings, f)
    logger.info(f"Mappings saved to {mappings_path}")


def load_graph(path: Path = None) -> HeteroData:
    """Load the graph from disk."""
    if path is None:
        path = GRAPH_DIR / "vn_knowledge_graph.pt"

    # Handle PyTorch 2.6+ weights_only default change
    data = torch.load(path, weights_only=False)

    # Load mappings if not in graph
    if not hasattr(data, 'mappings'):
        mappings_path = path.parent / "mappings.pkl"
        with open(mappings_path, 'rb') as f:
            data.mappings = pickle.load(f)

    return data


async def main():
    """Build and save the knowledge graph."""
    import logging
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    )

    data = await build_knowledge_graph()
    await save_graph(data)

    # Print summary
    print("\n" + "=" * 60)
    print("KNOWLEDGE GRAPH SUMMARY")
    print("=" * 60)
    for node_type in data.node_types:
        print(f"{node_type}: {data[node_type].num_nodes:,} nodes, features shape {data[node_type].x.shape}")
    print()
    for edge_type in data.edge_types:
        num_edges = data[edge_type].edge_index.shape[1]
        print(f"{edge_type}: {num_edges:,} edges")
    print("=" * 60)


if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
