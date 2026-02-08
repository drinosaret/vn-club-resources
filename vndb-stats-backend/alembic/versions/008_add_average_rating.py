"""Add average_rating column to visual_novels table.

Revision ID: 008_add_average_rating
Revises: 007_add_app_logs
Create Date: 2025-01-21

This migration adds:
- average_rating column to visual_novels table (raw average from global_votes, not Bayesian-adjusted)
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '008_add_average_rating'
down_revision: Union[str, None] = '007_add_app_logs'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add average_rating column to visual_novels table
    op.add_column('visual_novels', sa.Column('average_rating', sa.Float))


def downgrade() -> None:
    op.drop_column('visual_novels', 'average_rating')
