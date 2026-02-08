"""Add comprehensive release fields and new release-related tables.

Revision ID: 002_add_comprehensive_release_fields
Revises: 001_add_staff_seiyuu_traits
Create Date: 2025-01-12

This migration adds:
- Extended fields to releases table (gtin, voiced, resolution, flags, etc.)
- rtype column to release_vn table (critical for filtering trials)
- New tables: release_platforms, release_media, release_extlinks
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '002_add_comprehensive_release_fields'
down_revision: Union[str, None] = '001_add_staff_seiyuu_traits'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add new columns to releases table
    op.add_column('releases', sa.Column('gtin', sa.BigInteger))
    op.add_column('releases', sa.Column('olang', sa.String(10)))
    op.add_column('releases', sa.Column('voiced', sa.SmallInteger))
    op.add_column('releases', sa.Column('reso_x', sa.SmallInteger))
    op.add_column('releases', sa.Column('reso_y', sa.SmallInteger))
    op.add_column('releases', sa.Column('has_ero', sa.Boolean, server_default='false'))
    op.add_column('releases', sa.Column('patch', sa.Boolean, server_default='false'))
    op.add_column('releases', sa.Column('freeware', sa.Boolean, server_default='false'))
    op.add_column('releases', sa.Column('doujin', sa.Boolean, server_default='false'))
    op.add_column('releases', sa.Column('uncensored', sa.Boolean, server_default='false'))
    op.add_column('releases', sa.Column('official', sa.Boolean, server_default='true'))
    op.add_column('releases', sa.Column('catalog', sa.String(100)))
    op.add_column('releases', sa.Column('notes', sa.Text))
    op.add_column('releases', sa.Column('engine', sa.String(100)))

    # Add indexes for frequently queried boolean fields
    op.create_index('idx_releases_patch', 'releases', ['patch'])
    op.create_index('idx_releases_freeware', 'releases', ['freeware'])

    # Add rtype column to release_vn table (critical for filtering trial/partial releases)
    op.add_column('release_vn', sa.Column('rtype', sa.String(20)))
    op.create_index('idx_release_vn_rtype', 'release_vn', ['rtype'])
    op.create_index('idx_release_vn_vn_rtype', 'release_vn', ['vn_id', 'rtype'])

    # Create release_platforms table
    op.create_table(
        'release_platforms',
        sa.Column('release_id', sa.String(10), sa.ForeignKey('releases.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('platform', sa.String(20), primary_key=True),
    )
    op.create_index('idx_release_platforms_release', 'release_platforms', ['release_id'])
    op.create_index('idx_release_platforms_platform', 'release_platforms', ['platform'])

    # Create release_media table
    op.create_table(
        'release_media',
        sa.Column('release_id', sa.String(10), sa.ForeignKey('releases.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('medium', sa.String(10), primary_key=True),
        sa.Column('quantity', sa.SmallInteger, server_default='1'),
    )
    op.create_index('idx_release_media_release', 'release_media', ['release_id'])
    op.create_index('idx_release_media_medium', 'release_media', ['medium'])

    # Create release_extlinks table
    op.create_table(
        'release_extlinks',
        sa.Column('release_id', sa.String(10), sa.ForeignKey('releases.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('site', sa.String(50), primary_key=True),
        sa.Column('url', sa.String(500)),
    )
    op.create_index('idx_release_extlinks_release', 'release_extlinks', ['release_id'])
    op.create_index('idx_release_extlinks_site', 'release_extlinks', ['site'])


def downgrade() -> None:
    # Drop new tables
    op.drop_table('release_extlinks')
    op.drop_table('release_media')
    op.drop_table('release_platforms')

    # Drop indexes on release_vn
    op.drop_index('idx_release_vn_vn_rtype', table_name='release_vn')
    op.drop_index('idx_release_vn_rtype', table_name='release_vn')
    op.drop_column('release_vn', 'rtype')

    # Drop indexes on releases
    op.drop_index('idx_releases_freeware', table_name='releases')
    op.drop_index('idx_releases_patch', table_name='releases')

    # Drop new columns from releases
    op.drop_column('releases', 'engine')
    op.drop_column('releases', 'notes')
    op.drop_column('releases', 'catalog')
    op.drop_column('releases', 'official')
    op.drop_column('releases', 'uncensored')
    op.drop_column('releases', 'doujin')
    op.drop_column('releases', 'freeware')
    op.drop_column('releases', 'patch')
    op.drop_column('releases', 'has_ero')
    op.drop_column('releases', 'reso_y')
    op.drop_column('releases', 'reso_x')
    op.drop_column('releases', 'voiced')
    op.drop_column('releases', 'olang')
    op.drop_column('releases', 'gtin')
