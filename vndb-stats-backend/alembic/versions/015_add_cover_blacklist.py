"""Add cover blacklist tables.

Revision ID: 015_add_cover_blacklist
Revises: 014_add_length_minutes
Create Date: 2026-01-30

This migration adds:
- cover_blacklist table for tracking blacklisted VN covers (manual and auto)
- cover_blacklist_config table for auto-blacklist rules based on tags
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '015_add_cover_blacklist'
down_revision: Union[str, None] = '014_add_length_minutes'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create cover_blacklist_config table (rules for auto-blacklisting)
    op.create_table(
        'cover_blacklist_config',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('tag_id', sa.Integer, sa.ForeignKey('tags.id', ondelete='CASCADE'), nullable=False),
        sa.Column('votecount_threshold', sa.Integer, nullable=False),
        sa.Column('min_tag_score', sa.Float, server_default='1.5'),
        sa.Column('is_active', sa.Boolean, server_default='true'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('idx_blacklist_config_tag', 'cover_blacklist_config', ['tag_id'])
    op.create_index('idx_blacklist_config_active', 'cover_blacklist_config', ['is_active'])

    # Create cover_blacklist table (actual blacklisted entries)
    op.create_table(
        'cover_blacklist',
        sa.Column('vn_id', sa.String(10), sa.ForeignKey('visual_novels.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('reason', sa.String(50), nullable=False),
        sa.Column('tag_ids', sa.ARRAY(sa.Integer)),
        sa.Column('added_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('added_by', sa.String(100)),
        sa.Column('notes', sa.Text),
    )
    op.create_index('idx_cover_blacklist_reason', 'cover_blacklist', ['reason'])


def downgrade() -> None:
    op.drop_table('cover_blacklist')
    op.drop_table('cover_blacklist_config')
