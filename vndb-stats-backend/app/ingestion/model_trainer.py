"""Train recommendation models from imported data."""

import gc
import logging
import os
from datetime import datetime

# Prevent OpenBLAS threading issues with implicit library
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")

import numpy as np
from scipy import sparse
from sqlalchemy import Column, DateTime, Float, Integer, MetaData, String, Table, select, text
from sqlalchemy.dialects.postgresql import insert

from app.config import get_settings
from app.db.database import async_session
from app.db.models import (
    GlobalVote, Tag, VNTag, VisualNovel,
    CFUserFactors, CFVNFactors, TagVNVector, VNSimilarity, VNCoOccurrence,
)

# Staging table references for zero-downtime similarity updates.
# New data is written here, then atomically swapped to live via table renames.
_staging_meta = MetaData()

_vn_sim_staging = Table(
    'vn_similarities_staging', _staging_meta,
    Column('vn_id', String(10), primary_key=True),
    Column('similar_vn_id', String(10), primary_key=True),
    Column('similarity_score', Float, nullable=False),
    Column('computed_at', DateTime, nullable=False),
)

_vn_cooccur_staging = Table(
    'vn_cooccurrence_staging', _staging_meta,
    Column('vn_id', String(10), primary_key=True),
    Column('similar_vn_id', String(10), primary_key=True),
    Column('co_rating_score', Float, nullable=False),
    Column('user_count', Integer, nullable=False),
    Column('computed_at', DateTime, nullable=False),
)

logger = logging.getLogger(__name__)
settings = get_settings()


def _log_memory(label: str):
    """Log current process memory usage."""
    try:
        import psutil
        process = psutil.Process()
        mem = process.memory_info()
        logger.info(f"[MEMORY] {label}: RSS={mem.rss / (1024**2):.0f}MB, VMS={mem.vms / (1024**2):.0f}MB")
    except ImportError:
        pass


async def compute_tag_vectors():
    """
    Compute TF-IDF weighted tag vectors for all VNs.
    These are used for content-based recommendations.
    """
    logger.info("Computing tag vectors for all VNs")

    async with async_session() as db:
        # Get all tags
        result = await db.execute(
            select(Tag.id).where(Tag.applicable == True).order_by(Tag.id)
        )
        tag_ids = [r[0] for r in result.all()]
        tag_to_idx = {tid: idx for idx, tid in enumerate(tag_ids)}
        num_tags = len(tag_ids)

        logger.info(f"Found {num_tags} applicable tags")

        # Compute IDF (inverse document frequency)
        # IDF(t) = log(N / df(t)) where df(t) is number of VNs with tag t
        result = await db.execute(
            select(VNTag.tag_id, text("COUNT(DISTINCT vn_id)"))
            .group_by(VNTag.tag_id)
        )
        tag_doc_freq = {row[0]: row[1] for row in result.all()}

        result = await db.execute(select(text("COUNT(DISTINCT id)")).select_from(VisualNovel))
        total_vns = result.scalar() or 1

        idf = np.zeros(num_tags)
        for tag_id, df in tag_doc_freq.items():
            if tag_id in tag_to_idx:
                idf[tag_to_idx[tag_id]] = np.log(total_vns / (df + 1))

        # Get all VN IDs
        result = await db.execute(select(VisualNovel.id))
        vn_ids = [r[0] for r in result.all()]

        logger.info(f"Computing vectors for {len(vn_ids)} VNs")

        # Clear existing vectors
        await db.execute(text("TRUNCATE TABLE tag_vn_vectors"))

        batch = []
        for i, vn_id in enumerate(vn_ids):
            # Get tags for this VN (exclude 0.0 scores)
            result = await db.execute(
                select(VNTag.tag_id, VNTag.score)
                .where(VNTag.vn_id == vn_id)
                .where(VNTag.spoiler_level == 0)
                .where(VNTag.score > 0)
            )

            vector = np.zeros(num_tags)
            for tag_id, score in result.all():
                if tag_id in tag_to_idx:
                    idx = tag_to_idx[tag_id]
                    # TF-IDF: score * IDF
                    vector[idx] = score * idf[idx]

            # Normalize
            norm = np.linalg.norm(vector)
            if norm > 0:
                vector /= norm

            batch.append({
                "vn_id": vn_id,
                "tag_vector": vector.tolist(),
                "computed_at": datetime.utcnow(),
            })

            if len(batch) >= 1000:
                await _insert_tag_vectors(db, batch)
                batch = []

                if (i + 1) % 5000 == 0:
                    logger.info(f"Processed {i + 1}/{len(vn_ids)} VNs")

        if batch:
            await _insert_tag_vectors(db, batch)

        await db.commit()

    gc.collect()
    _log_memory("after tag vectors")
    logger.info("Tag vectors computed")


async def _insert_tag_vectors(db, batch: list[dict]):
    """Insert tag vectors."""
    stmt = insert(TagVNVector).values(batch)
    stmt = stmt.on_conflict_do_update(
        index_elements=["vn_id"],
        set_={
            "tag_vector": stmt.excluded.tag_vector,
            "computed_at": stmt.excluded.computed_at,
        }
    )
    await db.execute(stmt)


async def train_collaborative_filter():
    """
    Train collaborative filtering model using ALS.
    Uses the global votes dump.
    """
    logger.info("Training collaborative filtering model")
    _log_memory("before CF training")

    try:
        from implicit.als import AlternatingLeastSquares
    except ImportError:
        logger.warning("implicit library not installed, skipping CF training")
        return

    async with async_session() as db:
        # Load votes into memory
        logger.info("Loading votes...")
        result = await db.execute(
            select(GlobalVote.user_hash, GlobalVote.vn_id, GlobalVote.vote)
        )
        votes = result.all()

        if not votes:
            logger.warning("No votes found, skipping CF training")
            return

        logger.info(f"Loaded {len(votes)} votes")

        # Build mappings
        user_ids: dict[str, int] = {}
        vn_ids: dict[str, int] = {}
        rows, cols, data = [], [], []

        for user_hash, vn_id, vote in votes:
            if user_hash not in user_ids:
                user_ids[user_hash] = len(user_ids)
            if vn_id not in vn_ids:
                vn_ids[vn_id] = len(vn_ids)

            # Confidence-weighted implicit feedback
            # Higher votes = more confidence
            confidence = 1 + 0.5 * (vote - 50) / 50

            rows.append(user_ids[user_hash])
            cols.append(vn_ids[vn_id])
            data.append(max(0.1, confidence))  # Ensure positive

        # Build sparse matrix
        interaction_matrix = sparse.csr_matrix(
            (data, (rows, cols)),
            shape=(len(user_ids), len(vn_ids)),
        )

        logger.info(f"Built matrix: {interaction_matrix.shape}")

        # Train model
        model = AlternatingLeastSquares(
            factors=settings.cf_factors,
            iterations=settings.cf_iterations,
            regularization=settings.cf_regularization,
            random_state=42,
        )

        logger.info("Training ALS model...")
        model.fit(interaction_matrix)

        # Save user factors
        logger.info("Saving user factors...")
        await db.execute(text("TRUNCATE TABLE cf_user_factors"))

        idx_to_user = {v: k for k, v in user_ids.items()}
        user_batch = []
        for idx in range(len(user_ids)):
            user_batch.append({
                "user_hash": idx_to_user[idx],
                "factors": model.user_factors[idx].tolist(),
                "computed_at": datetime.utcnow(),
            })

            if len(user_batch) >= 10000:
                await _insert_user_factors(db, user_batch)
                user_batch = []

        if user_batch:
            await _insert_user_factors(db, user_batch)

        # Save VN factors
        logger.info("Saving VN factors...")
        await db.execute(text("TRUNCATE TABLE cf_vn_factors"))

        idx_to_vn = {v: k for k, v in vn_ids.items()}
        vn_batch = []
        for idx in range(len(vn_ids)):
            vn_batch.append({
                "vn_id": idx_to_vn[idx],
                "factors": model.item_factors[idx].tolist(),
                "computed_at": datetime.utcnow(),
            })

            if len(vn_batch) >= 1000:
                await _insert_vn_factors(db, vn_batch)
                vn_batch = []

        if vn_batch:
            await _insert_vn_factors(db, vn_batch)

        await db.commit()

        # Free large objects before next phase
        del model, votes, interaction_matrix
        del user_ids, vn_ids, rows, cols, data
        del idx_to_user, idx_to_vn

    gc.collect()
    _log_memory("after CF training")
    logger.info("Collaborative filtering model trained")


async def _insert_user_factors(db, batch: list[dict]):
    """Insert user factors."""
    stmt = insert(CFUserFactors).values(batch)
    stmt = stmt.on_conflict_do_update(
        index_elements=["user_hash"],
        set_={
            "factors": stmt.excluded.factors,
            "computed_at": stmt.excluded.computed_at,
        }
    )
    await db.execute(stmt)


async def _insert_vn_factors(db, batch: list[dict]):
    """Insert VN factors."""
    stmt = insert(CFVNFactors).values(batch)
    stmt = stmt.on_conflict_do_update(
        index_elements=["vn_id"],
        set_={
            "factors": stmt.excluded.factors,
            "computed_at": stmt.excluded.computed_at,
        }
    )
    await db.execute(stmt)


async def compute_vn_similarities(top_k: int = 100):
    """
    Compute VN-VN similarity matrix using precomputed tag vectors.

    For each VN, stores the top-K most similar VNs based on cosine similarity.
    This enables O(1) similar novels lookup instead of O(n) computation per request.

    Memory-optimized: streams rows from DB and builds a float32 matrix directly,
    avoiding the intermediate dict + float64 copy that previously caused OOM in
    Docker containers (no swap, hard memory limit).

    Args:
        top_k: Number of similar VNs to store per VN (default 100)
    """
    logger.info("=" * 50)
    logger.info("COMPUTING CONTENT-BASED SIMILARITIES (tag vectors)")
    logger.info("=" * 50)
    logger.info(f"Settings: top-{top_k} similar VNs per entry")
    _log_memory("before content similarity")

    async with async_session() as db:
        # Step 1: Get VN IDs and vector dimension (lightweight query)
        logger.info("Loading tag vector metadata...")
        result = await db.execute(
            select(TagVNVector.vn_id).order_by(TagVNVector.vn_id)
        )
        vn_ids = [row[0] for row in result.all()]
        num_vns = len(vn_ids)

        if num_vns == 0:
            logger.warning("No tag vectors found, run compute_tag_vectors first")
            return

        # Get vector dimension from first row
        result = await db.execute(
            select(TagVNVector.tag_vector).limit(1)
        )
        sample_vector = result.scalar_one()
        vector_dim = len(sample_vector)

        logger.info(f"Found {num_vns} VNs with {vector_dim}-dim vectors")
        est_mb = num_vns * vector_dim * 4 / (1024 * 1024)
        logger.info(f"Estimated matrix size: {est_mb:.0f} MB (float32)")

        # Step 2: Build float32 matrix directly by streaming rows
        # This avoids materializing all rows as Python objects simultaneously
        vn_id_to_idx = {vn_id: i for i, vn_id in enumerate(vn_ids)}
        vectors_matrix = np.zeros((num_vns, vector_dim), dtype=np.float32)

        logger.info("Streaming tag vectors into matrix...")
        batch_load_size = 5000
        loaded = 0

        for offset in range(0, num_vns, batch_load_size):
            batch_ids = vn_ids[offset:offset + batch_load_size]
            result = await db.execute(
                select(TagVNVector.vn_id, TagVNVector.tag_vector)
                .where(TagVNVector.vn_id.in_(batch_ids))
            )
            for row in result.all():
                idx = vn_id_to_idx[row[0]]
                vectors_matrix[idx] = np.array(row[1], dtype=np.float32)
            loaded += len(batch_ids)
            if loaded % 20000 == 0 or loaded == num_vns:
                logger.info(f"Loaded {loaded}/{num_vns} vectors")

        # Clear staging table (live table stays untouched until swap)
        await db.execute(text("TRUNCATE TABLE vn_similarities_staging"))

        # Step 3: Compute similarities in batches
        batch_size = 500
        total_inserted = 0

        for batch_start in range(0, num_vns, batch_size):
            batch_end = min(batch_start + batch_size, num_vns)
            batch_vn_ids = vn_ids[batch_start:batch_end]
            batch_vectors = vectors_matrix[batch_start:batch_end]

            # Compute cosine similarity against all VNs
            # Since vectors are normalized, dot product = cosine similarity
            similarities = batch_vectors @ vectors_matrix.T

            similarity_records = []
            now = datetime.utcnow()

            for local_idx, vn_id in enumerate(batch_vn_ids):
                global_idx = batch_start + local_idx
                sims = similarities[local_idx]

                # Get top-K (excluding self)
                sims[global_idx] = -1
                top_indices = np.argpartition(sims, -top_k)[-top_k:]
                top_indices = top_indices[np.argsort(sims[top_indices])[::-1]]

                for sim_idx in top_indices:
                    if sims[sim_idx] > 0.1:  # Only store meaningful similarities
                        similarity_records.append({
                            "vn_id": vn_id,
                            "similar_vn_id": vn_ids[sim_idx],
                            "similarity_score": float(sims[sim_idx]),
                            "computed_at": now,
                        })

            if similarity_records:
                await _insert_vn_similarities_staging(db, similarity_records)
                total_inserted += len(similarity_records)

            if batch_end % 2000 == 0 or batch_end == num_vns:
                logger.info(f"Processed {batch_end}/{num_vns} VNs ({total_inserted} similarities)")

        await db.commit()

        # Free large matrix before next phase
        del vectors_matrix, vn_ids, vn_id_to_idx

    gc.collect()
    _log_memory("after content similarity")
    logger.info(f"Content-based similarities complete: {total_inserted} pairs stored")


async def compute_item_item_similarity(top_k: int = 50, min_users: int = 20):
    """
    Compute item-item collaborative filtering similarity using PMI.

    Uses Pointwise Mutual Information (PMI) to find VN pairs that are read
    together MORE than expected by chance. This avoids the "popular items
    recommend popular items" problem of raw co-occurrence or Jaccard.

    PMI(a,b) = log2( P(a,b) / (P(a) * P(b)) )
             = log2( common_users * total_users / (users_a * users_b) )

    PMI > 0 means the pair is read together more than expected.
    PMI = 0 means they're independent.
    PMI < 0 means they're read together less than expected.

    OPTIMIZED: Uses inverted index to avoid O(n²) comparisons.

    Args:
        top_k: Number of similar VNs to store per VN (default 50)
        min_users: Minimum number of common users for a pair (default 20)
    """
    import math
    from collections import defaultdict

    logger.info("=" * 50)
    logger.info("COMPUTING COLLABORATIVE FILTERING SIMILARITIES (PMI)")
    logger.info("=" * 50)
    logger.info(f"Settings: top-{top_k}, min_users={min_users}")
    _log_memory("before collaborative similarity")

    async with async_session() as db:
        # Load ALL votes - any rating means user read the VN
        logger.info("Loading global votes...")
        result = await db.execute(
            select(GlobalVote.vn_id, GlobalVote.user_hash)
        )
        votes = result.all()

        if not votes:
            logger.warning("No votes found for item-item similarity")
            return

        logger.info(f"Loaded {len(votes)} votes")

        # Build VN -> set of users mapping
        vn_users: dict[str, set[str]] = defaultdict(set)
        # Build inverted index: user -> set of VNs they read
        user_vns: dict[str, set[str]] = defaultdict(set)

        for vn_id, user_hash in votes:
            vn_users[vn_id].add(user_hash)
            user_vns[user_hash].add(vn_id)

        total_users = len(user_vns)
        num_vns = len(vn_users)
        logger.info(f"Found {num_vns} VNs with votes, {total_users} users")

        # Pre-compute candidate pairs using inverted index
        # Only consider pairs that share at least min_users
        logger.info("Building candidate pairs using inverted index...")
        candidate_counts: dict[tuple[str, str], int] = defaultdict(int)

        processed_users = 0
        for user_hash, user_vn_set in user_vns.items():
            # For each user, increment count for all VN pairs they read
            vn_list = list(user_vn_set)
            for i, vn_a in enumerate(vn_list):
                for vn_b in vn_list[i + 1:]:
                    # Use sorted tuple as key to avoid duplicates
                    pair = (vn_a, vn_b) if vn_a < vn_b else (vn_b, vn_a)
                    candidate_counts[pair] += 1

            processed_users += 1
            if processed_users % 10000 == 0:
                logger.info(f"Processed {processed_users}/{total_users} users for candidate pairs")

        # Filter to pairs with >= min_users common users
        valid_pairs = [(pair, count) for pair, count in candidate_counts.items() if count >= min_users]
        logger.info(f"Found {len(valid_pairs)} valid candidate pairs (>={min_users} common users)")

        # Free raw votes (no longer needed, vn_users/user_vns have the data)
        del votes
        _log_memory("after candidate pairs")

        # Clear candidate_counts to free memory
        del candidate_counts
        gc.collect()
        _log_memory("after freeing candidate_counts")

        # Clear staging table (live table stays untouched until swap)
        await db.execute(text("TRUNCATE TABLE vn_cooccurrence_staging"))

        # Compute PMI for valid pairs
        now = datetime.utcnow()
        total_inserted = 0

        # Track top-K per VN: (pmi_score, other_vn_id, user_count)
        vn_top_similar: dict[str, list[tuple[float, str, int]]] = defaultdict(list)

        for idx, ((vn_a, vn_b), common_count) in enumerate(valid_pairs):
            count_a = len(vn_users[vn_a])
            count_b = len(vn_users[vn_b])

            # PMI = log2( P(a,b) / (P(a) * P(b)) )
            # P(a,b) = common_count / total_users
            # P(a) = count_a / total_users
            # P(b) = count_b / total_users
            # PMI = log2( common_count * total_users / (count_a * count_b) )
            expected = (count_a * count_b) / total_users
            pmi = math.log2(common_count / expected) if expected > 0 else 0

            # Only keep positive PMI (read together more than expected)
            if pmi > 0:
                # Add to both VNs' top-K lists
                vn_top_similar[vn_a].append((pmi, vn_b, common_count))
                vn_top_similar[vn_b].append((pmi, vn_a, common_count))

            if (idx + 1) % 100000 == 0:
                logger.info(f"Computed PMI for {idx + 1}/{len(valid_pairs)} pairs")

        # Keep only top-K per VN and build insert records
        logger.info("Keeping top-K similar VNs per VN...")
        cooccurrence_records = []

        for vn_id, similar_list in vn_top_similar.items():
            # Sort by PMI descending, keep top-K
            similar_list.sort(key=lambda x: x[0], reverse=True)
            for pmi, other_id, user_count in similar_list[:top_k]:
                cooccurrence_records.append({
                    "vn_id": vn_id,
                    "similar_vn_id": other_id,
                    "co_rating_score": float(pmi),
                    "user_count": user_count,
                    "computed_at": now,
                })

        # Batch insert
        batch_size = 5000
        for i in range(0, len(cooccurrence_records), batch_size):
            batch = cooccurrence_records[i:i + batch_size]
            await _insert_vn_cooccurrence_staging(db, batch)
            total_inserted += len(batch)
            if (i + batch_size) % 50000 == 0 or i + batch_size >= len(cooccurrence_records):
                logger.info(f"Inserted {total_inserted} co-occurrence records")

        await db.commit()

        # Free remaining large objects
        del vn_users, user_vns, valid_pairs, vn_top_similar, cooccurrence_records

    gc.collect()
    _log_memory("after collaborative similarity")
    logger.info(f"Collaborative filtering complete: {total_inserted} pairs stored")


async def _insert_vn_similarities_staging(db, batch: list[dict]):
    """Insert VN similarities into staging table (plain INSERT, no conflict handling)."""
    chunk_size = 5000
    for i in range(0, len(batch), chunk_size):
        chunk = batch[i:i + chunk_size]
        await db.execute(_vn_sim_staging.insert().values(chunk))


async def _insert_vn_cooccurrence_staging(db, batch: list[dict]):
    """Insert VN co-occurrence records into staging table."""
    await db.execute(_vn_cooccur_staging.insert().values(batch))


async def swap_similarity_tables():
    """Atomically swap staging similarity tables to live (zero downtime).

    Steps:
    1. Create indexes on staging (so reads are fast immediately after swap)
    2. Triple-rename swap: live→old, staging→live, old→staging
    3. Cleanup: truncate staging, normalize index names, ANALYZE
    """
    import time

    logger.info("=" * 50)
    logger.info("SWAPPING STAGING TABLES TO LIVE")
    logger.info("=" * 50)

    async with async_session() as db:
        # Guard: refuse to swap empty staging tables (protects against silent early-returns
        # in compute_vn_similarities / compute_item_item_similarity wiping live data)
        for table in ['vn_similarities_staging', 'vn_cooccurrence_staging']:
            result = await db.execute(text(f"SELECT EXISTS (SELECT 1 FROM {table})"))
            has_data = result.scalar_one()
            if not has_data:
                logger.error(f"ABORTING SWAP: {table} is empty — refusing to replace live data with nothing")
                return

        # 1. Create indexes on staging BEFORE swap (live stays indexed throughout).
        # Drop stale _new indexes first — if a previous cleanup crashed, these names
        # may still exist on the old live table. Index names are database-global, so
        # CREATE INDEX IF NOT EXISTS would silently skip, leaving staging unindexed.
        logger.info("Creating indexes on staging tables...")
        for idx in ['idx_vn_sim_vn_new', 'idx_vn_sim_score_new',
                     'idx_vn_cooccur_vn_new', 'idx_vn_cooccur_score_new']:
            await db.execute(text(f'DROP INDEX IF EXISTS {idx}'))
        await db.execute(text(
            "CREATE INDEX idx_vn_sim_vn_new ON vn_similarities_staging (vn_id)"
        ))
        await db.execute(text(
            "CREATE INDEX idx_vn_sim_score_new ON vn_similarities_staging (vn_id, similarity_score DESC)"
        ))
        await db.execute(text(
            "CREATE INDEX idx_vn_cooccur_vn_new ON vn_cooccurrence_staging (vn_id)"
        ))
        await db.execute(text(
            "CREATE INDEX idx_vn_cooccur_score_new ON vn_cooccurrence_staging (vn_id, co_rating_score DESC)"
        ))
        await db.commit()

        # 2. Atomic triple-rename swap (PostgreSQL DDL is transactional).
        # Both tables swap in a single transaction so content-based and
        # collaborative similarity data stay in sync. Safe because only
        # the daily worker mutates these tables — no concurrent DDL expected.
        logger.info("Swapping staging tables to live...")
        t0 = time.monotonic()
        _SWAPPABLE_TABLES = ('vn_similarities', 'vn_cooccurrence')  # hardcoded — never from user input
        for table in _SWAPPABLE_TABLES:
            await db.execute(text(f'ALTER TABLE {table} RENAME TO {table}_old'))
            await db.execute(text(f'ALTER TABLE {table}_staging RENAME TO {table}'))
            await db.execute(text(f'ALTER TABLE {table}_old RENAME TO {table}_staging'))
        await db.commit()
        swap_ms = (time.monotonic() - t0) * 1000
        logger.info(f"Swap committed in {swap_ms:.1f}ms — new similarity data is now live")

        # 3-4. Post-swap housekeeping: ANALYZE + cleanup.
        # If anything here fails, live data is already correct — treat as warning.
        try:
            logger.info("Running ANALYZE on new live tables...")
            await db.execute(text("ANALYZE vn_similarities"))
            await db.execute(text("ANALYZE vn_cooccurrence"))
            await db.execute(text("TRUNCATE TABLE vn_similarities_staging"))
            await db.execute(text("TRUNCATE TABLE vn_cooccurrence_staging"))

            # Drop FK constraints inherited from old live tables (staging must be FK-free)
            # After swap, the staging tables are the old live tables which had FKs.
            # Query pg_constraint to find and drop any FK constraints on staging tables.
            for staging_table in ['vn_similarities_staging', 'vn_cooccurrence_staging']:
                result = await db.execute(text(f"""
                    SELECT conname FROM pg_constraint
                    WHERE conrelid = '{staging_table}'::regclass
                    AND contype = 'f'
                """))
                fk_names = [row[0] for row in result.fetchall()]
                for fk_name in fk_names:
                    logger.info(f"Dropping inherited FK {fk_name} from {staging_table}")
                    await db.execute(text(
                        f'ALTER TABLE {staging_table} DROP CONSTRAINT {fk_name}'
                    ))

            # Drop old indexes (inherited from previous live tables, now on staging)
            for idx in ['idx_vn_sim_vn', 'idx_vn_sim_score',
                         'idx_vn_cooccur_vn', 'idx_vn_cooccur_score']:
                await db.execute(text(f'DROP INDEX IF EXISTS {idx}'))
            # Rename new indexes to canonical names (for next cycle)
            await db.execute(text("ALTER INDEX idx_vn_sim_vn_new RENAME TO idx_vn_sim_vn"))
            await db.execute(text("ALTER INDEX idx_vn_sim_score_new RENAME TO idx_vn_sim_score"))
            await db.execute(text("ALTER INDEX idx_vn_cooccur_vn_new RENAME TO idx_vn_cooccur_vn"))
            await db.execute(text("ALTER INDEX idx_vn_cooccur_score_new RENAME TO idx_vn_cooccur_score"))
            await db.commit()
            logger.info("Staging tables cleaned up for next run")
        except Exception as e:
            logger.warning(f"Post-swap cleanup failed (live data is serving correctly): {e}")
            await db.rollback()


async def train_hybrid_embeddings(n_components: int = 64, epochs: int = 30):
    """
    Train feature-weighted hybrid embeddings using NumPy/SciPy.

    Combines collaborative filtering embeddings (from ALS) with tag-based
    content features using weighted blending and dimensionality reduction.

    The resulting embeddings capture both:
    - User behavior patterns (from CF factors, weight: 60%)
    - Content similarity (from tag vectors, weight: 40%)

    Args:
        n_components: Embedding dimension (default 64)
        epochs: Not used (kept for API compatibility with scheduler)
    """
    from sklearn.decomposition import TruncatedSVD

    logger.info(f"Training feature-weighted hybrid model (components={n_components})")

    async with async_session() as db:
        # Load CF factors (from ALS training) — typically ~30K VNs * 64 floats, small enough
        logger.info("Loading CF factors...")
        cf_result = await db.execute(
            select(CFVNFactors.vn_id, CFVNFactors.factors)
        )
        cf_factors = {row[0]: np.array(row[1], dtype=np.float32) for row in cf_result.all()}

        # Load tag vectors in batches to avoid OOM
        logger.info("Loading tag vectors...")
        tag_id_result = await db.execute(
            select(TagVNVector.vn_id).order_by(TagVNVector.vn_id)
        )
        tag_vn_ids = [row[0] for row in tag_id_result.all()]
        tag_vectors: dict[str, np.ndarray] = {}

        batch_load_size = 5000
        for offset in range(0, len(tag_vn_ids), batch_load_size):
            batch_ids = tag_vn_ids[offset:offset + batch_load_size]
            result = await db.execute(
                select(TagVNVector.vn_id, TagVNVector.tag_vector)
                .where(TagVNVector.vn_id.in_(batch_ids))
            )
            for row in result.all():
                tag_vectors[row[0]] = np.array(row[1], dtype=np.float32)

        logger.info(f"Loaded {len(tag_vectors)} tag vectors")

        if not cf_factors:
            logger.warning("No CF factors found, run train_collaborative_filter first")
            return

        if not tag_vectors:
            logger.warning("No tag vectors found, run compute_tag_vectors first")
            return

        # Get VNs that have both CF and tag data
        common_vns = list(set(cf_factors.keys()) & set(tag_vectors.keys()))
        logger.info(f"Found {len(common_vns)} VNs with both CF and tag data")

        if len(common_vns) < 100:
            logger.warning("Too few VNs with both data sources")
            return

        # Build combined feature matrix
        # Strategy: Concatenate CF factors and compressed tag vectors, then reduce
        cf_dim = len(next(iter(cf_factors.values())))
        tag_dim = len(next(iter(tag_vectors.values())))

        logger.info(f"CF dim: {cf_dim}, Tag dim: {tag_dim}")

        # Compress tag vectors to match CF dimension using SVD
        logger.info("Compressing tag vectors with SVD...")
        tag_matrix = np.zeros((len(common_vns), tag_dim), dtype=np.float32)
        for i, vn_id in enumerate(common_vns):
            tag_matrix[i] = tag_vectors[vn_id]

        # Use TruncatedSVD for dimensionality reduction
        target_tag_dim = min(cf_dim, tag_dim, 32)
        svd = TruncatedSVD(n_components=target_tag_dim, random_state=42)
        compressed_tags = svd.fit_transform(tag_matrix)
        logger.info(f"Compressed tags to {target_tag_dim} dimensions (explained variance: {svd.explained_variance_ratio_.sum():.2%})")

        # Combine: weighted average of CF and content signals
        # CF weight: 0.6, Content weight: 0.4 (CF usually stronger signal)
        cf_weight = 0.6
        content_weight = 0.4

        hybrid_embeddings = {}
        now = datetime.utcnow()

        for i, vn_id in enumerate(common_vns):
            cf_vec = cf_factors[vn_id]
            tag_vec = compressed_tags[i]

            # Normalize both vectors
            cf_norm = np.linalg.norm(cf_vec)
            tag_norm = np.linalg.norm(tag_vec)

            if cf_norm > 0:
                cf_vec = cf_vec / cf_norm
            if tag_norm > 0:
                tag_vec = tag_vec / tag_norm

            # Pad tag_vec to match cf_vec dimension if needed
            if len(tag_vec) < len(cf_vec):
                tag_vec = np.pad(tag_vec, (0, len(cf_vec) - len(tag_vec)))
            elif len(tag_vec) > len(cf_vec):
                tag_vec = tag_vec[:len(cf_vec)]

            # Weighted combination
            hybrid = cf_weight * cf_vec + content_weight * tag_vec

            # Normalize final embedding
            hybrid_norm = np.linalg.norm(hybrid)
            if hybrid_norm > 0:
                hybrid = hybrid / hybrid_norm

            hybrid_embeddings[vn_id] = hybrid

        # Also create embeddings for VNs with only tag data (cold start)
        tag_only_vns = set(tag_vectors.keys()) - set(cf_factors.keys())
        logger.info(f"Creating content-only embeddings for {len(tag_only_vns)} cold-start VNs")

        # Fit SVD on remaining tag vectors
        if tag_only_vns:
            tag_only_matrix = np.zeros((len(tag_only_vns), tag_dim), dtype=np.float32)
            tag_only_list = list(tag_only_vns)
            for i, vn_id in enumerate(tag_only_list):
                tag_only_matrix[i] = tag_vectors[vn_id]

            compressed_cold = svd.transform(tag_only_matrix)

            for i, vn_id in enumerate(tag_only_list):
                tag_vec = compressed_cold[i]
                tag_norm = np.linalg.norm(tag_vec)
                if tag_norm > 0:
                    tag_vec = tag_vec / tag_norm

                # Pad to CF dimension
                if len(tag_vec) < cf_dim:
                    tag_vec = np.pad(tag_vec, (0, cf_dim - len(tag_vec)))

                hybrid_embeddings[vn_id] = tag_vec

        # Store hybrid embeddings
        logger.info(f"Storing {len(hybrid_embeddings)} hybrid embeddings...")

        # We'll store these in VNGraphEmbedding table with model_version="hybrid_v1"
        from app.db.models import VNGraphEmbedding

        # Clear existing hybrid embeddings
        await db.execute(
            text("DELETE FROM vn_graph_embeddings WHERE model_version = 'hybrid_v1'")
        )

        batch = []
        for vn_id, embedding in hybrid_embeddings.items():
            batch.append({
                "vn_id": vn_id,
                "embedding": embedding.tolist(),
                "model_version": "hybrid_v1",
                "computed_at": now,
            })

            if len(batch) >= 1000:
                await _insert_hybrid_embeddings(db, batch)
                batch = []

        if batch:
            await _insert_hybrid_embeddings(db, batch)

        await db.commit()

    logger.info(f"Feature-weighted hybrid model trained: {len(hybrid_embeddings)} VN embeddings")


async def _insert_hybrid_embeddings(db, batch: list[dict]):
    """Insert hybrid VN embeddings."""
    from app.db.models import VNGraphEmbedding

    stmt = insert(VNGraphEmbedding).values(batch)
    stmt = stmt.on_conflict_do_update(
        index_elements=["vn_id", "model_version"],
        set_={
            "embedding": stmt.excluded.embedding,
            "computed_at": stmt.excluded.computed_at,
        }
    )
    await db.execute(stmt)


# Backwards-compatible alias (deprecated name)
train_lightfm = train_hybrid_embeddings
