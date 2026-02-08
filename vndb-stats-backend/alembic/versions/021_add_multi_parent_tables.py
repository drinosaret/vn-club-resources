"""Add multi-parent junction tables for tags and traits.

VNDB tags and traits can have multiple parents, but we previously only
stored the first parent. This adds tag_parents and trait_parents junction
tables to represent the full hierarchy.

Revision ID: 021_add_multi_parent_tables
Revises: 020_add_browse_counts
Create Date: 2026-02-07
"""
from typing import Union

from alembic import op
import sqlalchemy as sa

revision: str = '021_add_multi_parent_tables'
down_revision: Union[str, None] = '020_add_browse_counts'
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    # Tag parents junction table (IF NOT EXISTS for idempotency with ORM auto-create)
    op.execute("""
        CREATE TABLE IF NOT EXISTS tag_parents (
            tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
            parent_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
            PRIMARY KEY (tag_id, parent_id)
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_tag_parents_parent_id ON tag_parents (parent_id)
    """)

    # Trait parents junction table
    op.execute("""
        CREATE TABLE IF NOT EXISTS trait_parents (
            trait_id INTEGER NOT NULL REFERENCES traits(id) ON DELETE CASCADE,
            parent_id INTEGER NOT NULL REFERENCES traits(id) ON DELETE CASCADE,
            PRIMARY KEY (trait_id, parent_id)
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_trait_parents_parent_id ON trait_parents (parent_id)
    """)

    # Seed junction tables from existing single-parent columns
    op.execute("""
        INSERT INTO tag_parents (tag_id, parent_id)
        SELECT id, parent_id FROM tags WHERE parent_id IS NOT NULL
        ON CONFLICT DO NOTHING
    """)
    op.execute("""
        INSERT INTO trait_parents (trait_id, parent_id)
        SELECT id, group_id FROM traits WHERE group_id IS NOT NULL
        ON CONFLICT DO NOTHING
    """)


def downgrade() -> None:
    op.drop_index('idx_trait_parents_parent_id', table_name='trait_parents')
    op.drop_table('trait_parents')
    op.drop_index('idx_tag_parents_parent_id', table_name='tag_parents')
    op.drop_table('tag_parents')
