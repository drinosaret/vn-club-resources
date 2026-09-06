"""Retire the redundant reader index on user_recommendation_cache and index its age.

The primary key on (user_id, vn_id) already answers a lookup by reader, so a second
btree on user_id alone is written on every upsert and read by nothing. The retention
sweep filters on updated_at alone and had no index to do it with, so it was batched to
keep each scan short; the index lets it seek instead.

Revision ID: 046_rec_cache_indexes
Revises: 045_add_rec_cache_confidence
"""

from typing import Union

from alembic import op
import sqlalchemy as sa

revision: str = "046_rec_cache_indexes"
down_revision: Union[str, None] = "045_add_rec_cache_confidence"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    op.execute(sa.text("DROP INDEX IF EXISTS idx_user_rec_user"))
    op.execute(
        sa.text(
            "CREATE INDEX IF NOT EXISTS idx_user_rec_updated "
            "ON user_recommendation_cache (updated_at)"
        )
    )


def downgrade() -> None:
    op.execute(sa.text("DROP INDEX IF EXISTS idx_user_rec_updated"))
    op.execute(
        sa.text(
            "CREATE INDEX IF NOT EXISTS idx_user_rec_user ON user_recommendation_cache (user_id)"
        )
    )
