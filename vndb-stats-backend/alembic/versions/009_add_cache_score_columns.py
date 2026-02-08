"""Add score columns to user_recommendation_cache table.

Revision ID: 009_add_cache_score_columns
Revises: 008_add_average_rating
Create Date: 2025-01-21

This migration adds columns to store all 8 scoring signals in the cache:
- users_also_read_score
- developer_score
- seiyuu_score
- trait_score
- quality_score

These were previously hardcoded to 0 when serving from cache.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '009_add_cache_score_columns'
down_revision: Union[str, None] = '008_add_average_rating'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add score columns to user_recommendation_cache table
    op.add_column('user_recommendation_cache', sa.Column('users_also_read_score', sa.Float))
    op.add_column('user_recommendation_cache', sa.Column('developer_score', sa.Float))
    op.add_column('user_recommendation_cache', sa.Column('seiyuu_score', sa.Float))
    op.add_column('user_recommendation_cache', sa.Column('trait_score', sa.Float))
    op.add_column('user_recommendation_cache', sa.Column('quality_score', sa.Float))


def downgrade() -> None:
    op.drop_column('user_recommendation_cache', 'quality_score')
    op.drop_column('user_recommendation_cache', 'trait_score')
    op.drop_column('user_recommendation_cache', 'seiyuu_score')
    op.drop_column('user_recommendation_cache', 'developer_score')
    op.drop_column('user_recommendation_cache', 'users_also_read_score')
