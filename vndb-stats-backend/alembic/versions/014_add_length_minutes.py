"""Add length_minutes column to visual_novels table.

Revision ID: 014_add_length_minutes
Revises: 013_add_character_vn_spoiler_level
Create Date: 2026-01-25

This migration adds length_minutes column to store the average playtime from
user votes. This matches VNDB website behavior where length filtering uses
vote-based averages rather than the original length category field.

The length_minutes field is populated by aggregating data from the
vn_length_votes dump table during import.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '014_add_length_minutes'
down_revision: Union[str, None] = '013_charvn_spoiler'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('visual_novels', sa.Column('length_minutes', sa.Integer, nullable=True))
    op.create_index('idx_vn_length_minutes', 'visual_novels', ['length_minutes'])


def downgrade() -> None:
    op.drop_index('idx_vn_length_minutes', table_name='visual_novels')
    op.drop_column('visual_novels', 'length_minutes')
