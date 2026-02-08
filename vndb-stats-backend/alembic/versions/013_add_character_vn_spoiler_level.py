"""Add spoiler_level column to character_vn table.

Revision ID: 013_charvn_spoiler
Revises: 012_add_vn_tags_lie_column
Create Date: 2025-01-24

This migration adds:
- spoiler_level column to character_vn table (0=none, 1=minor, 2=major)
  This indicates if the character's presence in the VN is itself a spoiler.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '013_charvn_spoiler'
down_revision: Union[str, None] = '012_add_vn_tags_lie_column'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add spoiler_level column to character_vn table
    op.add_column('character_vn', sa.Column('spoiler_level', sa.Integer, default=0))


def downgrade() -> None:
    op.drop_column('character_vn', 'spoiler_level')
