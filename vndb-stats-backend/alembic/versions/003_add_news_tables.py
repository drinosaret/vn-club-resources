"""Add news aggregation tables.

Revision ID: 003_add_news_tables
Revises: 002_add_comprehensive_release_fields
Create Date: 2026-01-15

This migration adds:
- news_items table for aggregated news from all sources
- announcements table for custom admin announcements
- rss_feed_configs table for configurable RSS feeds
- posted_items_tracker table for duplicate prevention
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic.
revision: str = '003_add_news_tables'
down_revision: Union[str, None] = '002_add_comprehensive_release_fields'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create news_items table
    op.create_table(
        'news_items',
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('source', sa.String(20), nullable=False),
        sa.Column('source_label', sa.String(100)),
        sa.Column('title', sa.String(500), nullable=False),
        sa.Column('summary', sa.Text),
        sa.Column('url', sa.String(500)),
        sa.Column('image_url', sa.String(500)),
        sa.Column('image_is_nsfw', sa.Boolean, server_default='false'),
        sa.Column('published_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('fetched_at', sa.DateTime(timezone=True)),
        sa.Column('tags', sa.ARRAY(sa.String(50))),
        sa.Column('extra_data', JSONB),
        sa.Column('is_hidden', sa.Boolean, server_default='false'),
    )
    op.create_index('idx_news_source', 'news_items', ['source'])
    op.create_index('idx_news_published', 'news_items', [sa.text('published_at DESC')])
    op.create_index('idx_news_hidden', 'news_items', ['is_hidden'])

    # Create announcements table
    op.create_table(
        'announcements',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('title', sa.String(500), nullable=False),
        sa.Column('content', sa.Text),
        sa.Column('url', sa.String(500)),
        sa.Column('image_url', sa.String(500)),
        sa.Column('published_at', sa.DateTime(timezone=True)),
        sa.Column('expires_at', sa.DateTime(timezone=True)),
        sa.Column('is_active', sa.Boolean, server_default='true'),
        sa.Column('created_by', sa.String(100)),
    )
    op.create_index('idx_announcements_active', 'announcements', ['is_active'])
    op.create_index('idx_announcements_expires', 'announcements', ['expires_at'])

    # Create rss_feed_configs table
    op.create_table(
        'rss_feed_configs',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('url', sa.String(500), nullable=False),
        sa.Column('keywords', sa.ARRAY(sa.Text)),
        sa.Column('exclude_keywords', sa.ARRAY(sa.Text)),
        sa.Column('is_active', sa.Boolean, server_default='true'),
        sa.Column('last_checked', sa.DateTime(timezone=True)),
        sa.Column('check_interval_minutes', sa.Integer, server_default='60'),
    )
    op.create_index('idx_rss_feeds_active', 'rss_feed_configs', ['is_active'])

    # Create posted_items_tracker table
    op.create_table(
        'posted_items_tracker',
        sa.Column('source', sa.String(20), primary_key=True),
        sa.Column('item_id', sa.String(100), primary_key=True),
        sa.Column('posted_at', sa.DateTime(timezone=True)),
    )
    op.create_index('idx_posted_items_date', 'posted_items_tracker', ['posted_at'])


def downgrade() -> None:
    op.drop_table('posted_items_tracker')
    op.drop_table('rss_feed_configs')
    op.drop_table('announcements')
    op.drop_table('news_items')
