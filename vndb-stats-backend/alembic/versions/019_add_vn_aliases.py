"""Add aliases column to visual_novels table.

Revision ID: 019_add_vn_aliases
Revises: 018_enhance_blacklist_rules
Create Date: 2026-02-15

Note: Column may already exist if DB was created via ORM create_all.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "019_add_vn_aliases"
down_revision: Union[str, None] = "018_enhance_blacklist_rules"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Column may already exist if DB was initially created via ORM create_all
    conn = op.get_bind()
    result = conn.execute(sa.text(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_name = 'visual_novels' AND column_name = 'aliases'"
    ))
    if not result.fetchone():
        op.add_column("visual_novels", sa.Column("aliases", postgresql.ARRAY(sa.Text())))


def downgrade() -> None:
    op.drop_column("visual_novels", "aliases")
