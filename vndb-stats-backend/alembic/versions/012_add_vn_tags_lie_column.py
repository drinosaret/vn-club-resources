"""Add lie column to vn_tags table.

Revision ID: 012_add_vn_tags_lie_column
Revises: 011_expand_character_model
Create Date: 2025-01-24

This migration adds:
- lie column to vn_tags table (boolean, True if tag is disputed/incorrect)
- index on (tag_id, lie) for filtering out lie tags
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '012_add_vn_tags_lie_column'
down_revision: Union[str, None] = '011_expand_character_model'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add lie column to vn_tags table
    op.add_column('vn_tags', sa.Column('lie', sa.Boolean, default=False))

    # Add index for filtering out lie tags
    op.create_index('idx_vn_tags_tag_lie', 'vn_tags', ['tag_id', 'lie'])


def downgrade() -> None:
    op.drop_index('idx_vn_tags_tag_lie', table_name='vn_tags')
    op.drop_column('vn_tags', 'lie')
