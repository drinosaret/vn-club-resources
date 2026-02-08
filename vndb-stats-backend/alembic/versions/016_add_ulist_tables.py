"""Add user list tables for dump data.

Revision ID: 016_add_ulist_tables
Revises: 015_add_cover_blacklist
Create Date: 2026-01-31

This migration adds:
- ulist_vns: User VN list entries from database dumps
- ulist_labels: User VN list labels from database dumps

These tables replace the VNDB API calls for user list data. All user list
data now comes from the daily VNDB database dumps, which is faster and
more reliable than API calls.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '016_add_ulist_tables'
down_revision: Union[str, None] = '015_add_cover_blacklist'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create ulist_vns table (user VN list entries from dumps)
    op.create_table(
        'ulist_vns',
        sa.Column('uid', sa.String(20), primary_key=True),  # User ID, e.g., "u12345"
        sa.Column('vid', sa.String(10), primary_key=True),  # VN ID, e.g., "v17"
        sa.Column('added', sa.BigInteger),  # Unix timestamp when added to list
        sa.Column('lastmod', sa.BigInteger),  # Unix timestamp of last modification
        sa.Column('vote_date', sa.BigInteger),  # Unix timestamp when voted
        sa.Column('vote', sa.SmallInteger),  # 10-100 scale, null if not voted
        sa.Column('started', sa.Date),  # Date user started reading
        sa.Column('finished', sa.Date),  # Date user finished reading
        sa.Column('notes', sa.Text),  # User notes
    )
    op.create_index('idx_ulist_vns_uid', 'ulist_vns', ['uid'])
    op.create_index('idx_ulist_vns_vid', 'ulist_vns', ['vid'])
    op.create_index('idx_ulist_vns_vote', 'ulist_vns', ['vote'])

    # Create ulist_labels table (user VN list labels from dumps)
    # Label IDs: 1=Playing, 2=Finished, 3=Stalled, 4=Dropped, 5=Wishlist, 6=Blacklist
    op.create_table(
        'ulist_labels',
        sa.Column('uid', sa.String(20), primary_key=True),  # User ID
        sa.Column('vid', sa.String(10), primary_key=True),  # VN ID
        sa.Column('label', sa.SmallInteger, primary_key=True),  # Label ID
    )
    op.create_index('idx_ulist_labels_uid', 'ulist_labels', ['uid'])
    op.create_index('idx_ulist_labels_uid_label', 'ulist_labels', ['uid', 'label'])


def downgrade() -> None:
    op.drop_table('ulist_labels')
    op.drop_table('ulist_vns')
