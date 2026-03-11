"""Add pg_trgm GIN indexes for fast ILIKE substring search.

Before: ILIKE '%query%' forces sequential scan on every row (~50K+ VNs, ~100K+ characters).
After:  GIN trigram indexes allow PostgreSQL to use index scans for ILIKE patterns.

Includes both direct column indexes and expression indexes for normalized matching
(stripped punctuation). Aliases use array_to_string which is STABLE (not IMMUTABLE),
so it cannot be used in expression indexes - aliases search remains unindexed but
still functional via OR with indexed title conditions.

Expected improvement: 10-50x faster search queries (sequential scan -> index scan).

Revision ID: 032_add_trgm_indexes
Revises: 031_add_last_viewed_at
Create Date: 2026-03-10
"""

from alembic import op

revision = "032_add_trgm_indexes"
down_revision = "031_add_last_viewed_at"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Enable pg_trgm extension (required for GIN trigram indexes)
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")

    # --- VN direct column indexes (for ILIKE '%query%') ---
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_vn_title_trgm "
        "ON visual_novels USING gin (title gin_trgm_ops)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_vn_title_jp_trgm "
        "ON visual_novels USING gin (title_jp gin_trgm_ops)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_vn_title_romaji_trgm "
        "ON visual_novels USING gin (title_romaji gin_trgm_ops)"
    )

    # --- VN expression indexes for normalized matching ---
    # These let PostgreSQL use index scans for queries like:
    #   regexp_replace(title, '[^a-zA-Z0-9]', '', 'g') ILIKE '%muvluv%'
    # The query expression must match the index expression exactly.
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_vn_title_norm_trgm "
        "ON visual_novels USING gin ("
        "lower(regexp_replace(title, '[^a-zA-Z0-9]', '', 'g')) gin_trgm_ops)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_vn_title_romaji_norm_trgm "
        "ON visual_novels USING gin ("
        "lower(regexp_replace(COALESCE(title_romaji, ''), '[^a-zA-Z0-9]', '', 'g')) gin_trgm_ops)"
    )

    # NOTE: Aliases indexes are NOT possible because array_to_string() is STABLE,
    # not IMMUTABLE, so PostgreSQL rejects it in expression indexes.
    # Aliases search still works via OR with the indexed title conditions above.

    # --- Character search indexes ---
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_characters_name_trgm "
        "ON characters USING gin (name gin_trgm_ops)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_characters_original_trgm "
        "ON characters USING gin (original gin_trgm_ops)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_vn_title_romaji_norm_trgm")
    op.execute("DROP INDEX IF EXISTS idx_vn_title_norm_trgm")
    op.execute("DROP INDEX IF EXISTS idx_characters_original_trgm")
    op.execute("DROP INDEX IF EXISTS idx_characters_name_trgm")
    op.execute("DROP INDEX IF EXISTS idx_vn_title_romaji_trgm")
    op.execute("DROP INDEX IF EXISTS idx_vn_title_jp_trgm")
    op.execute("DROP INDEX IF EXISTS idx_vn_title_trgm")
    # Don't drop the extension - other things might use it
