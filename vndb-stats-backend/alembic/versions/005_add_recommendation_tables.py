"""Add recommendation tables for item-item CF and user cache.

Revision ID: 005_add_recommendation_tables
Revises: 004_add_image_sexual
Create Date: 2025-01-19

This migration adds:
- vn_cooccurrence table for item-item collaborative filtering
- user_recommendation_cache table for caching combined recommendations
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '005_add_recommendation_tables'
down_revision: Union[str, None] = '004_add_image_sexual'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create vn_cooccurrence table for item-item CF
    op.create_table(
        'vn_cooccurrence',
        sa.Column('vn_id', sa.String(10), sa.ForeignKey('visual_novels.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('similar_vn_id', sa.String(10), sa.ForeignKey('visual_novels.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('co_rating_score', sa.Float, nullable=False),
        sa.Column('user_count', sa.Integer, nullable=False),
        sa.Column('computed_at', sa.DateTime, nullable=False),
    )

    # Indexes for vn_cooccurrence
    op.create_index('idx_vn_cooccur_vn', 'vn_cooccurrence', ['vn_id'])
    op.create_index('idx_vn_cooccur_score', 'vn_cooccurrence', ['vn_id', 'co_rating_score'])

    # Create user_recommendation_cache table
    op.create_table(
        'user_recommendation_cache',
        sa.Column('user_id', sa.String(20), primary_key=True),
        sa.Column('vn_id', sa.String(10), sa.ForeignKey('visual_novels.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('combined_score', sa.Float, nullable=False),
        sa.Column('tag_score', sa.Float, nullable=True),
        sa.Column('cf_score', sa.Float, nullable=True),
        sa.Column('hgat_score', sa.Float, nullable=True),
        sa.Column('updated_at', sa.DateTime, nullable=False),
    )

    # Indexes for user_recommendation_cache
    op.create_index('idx_user_cache_user', 'user_recommendation_cache', ['user_id'])
    op.create_index('idx_user_cache_score', 'user_recommendation_cache', ['user_id', 'combined_score'])
    op.create_index('idx_user_cache_updated', 'user_recommendation_cache', ['user_id', 'updated_at'])


def downgrade() -> None:
    op.drop_table('user_recommendation_cache')
    op.drop_table('vn_cooccurrence')
