"""Add vn_relations table for VN-to-VN relationships.

Revision ID: 019_add_vn_relations
Revises: 018_enhance_blacklist_rules
Create Date: 2026-02-05

Stores sequel, prequel, side story, shares characters, and other
VN-to-VN relationships imported from VNDB dumps.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '019_add_vn_relations'
down_revision: Union[str, None] = '018_enhance_blacklist_rules'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Use IF NOT EXISTS to handle cases where the table was already
    # created by Base.metadata.create_all in the entrypoint
    op.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS vn_relations (
            vn_id VARCHAR(10) NOT NULL REFERENCES visual_novels(id) ON DELETE CASCADE,
            related_vn_id VARCHAR(10) NOT NULL REFERENCES visual_novels(id) ON DELETE CASCADE,
            relation VARCHAR(10) NOT NULL,
            official BOOLEAN DEFAULT true,
            PRIMARY KEY (vn_id, related_vn_id)
        )
    """))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS idx_vn_relations_vn ON vn_relations (vn_id)"
    ))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS idx_vn_relations_related ON vn_relations (related_vn_id)"
    ))


def downgrade() -> None:
    op.drop_index('idx_vn_relations_related', 'vn_relations')
    op.drop_index('idx_vn_relations_vn', 'vn_relations')
    op.drop_table('vn_relations')
