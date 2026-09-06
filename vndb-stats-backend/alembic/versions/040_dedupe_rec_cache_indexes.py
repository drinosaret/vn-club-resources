"""Drop duplicate indexes on user_recommendation_cache.

The table was indexed twice under two naming schemes, so it carries two btrees on
`user_id` and two on `(user_id, combined_score)` on top of its primary key. On a row this
narrow the indexes cost more than the heap they point at, and every duplicate is also
written on each upsert of the cache.

What is kept and why:

- `idx_user_rec_user` and `idx_user_rec_score` are the pair declared in
  `models.py`, so they stay: an index the ORM declares but the database lacks would be
  recreated by `create_all` on a fresh database and diverge everywhere else.
- `idx_user_cache_updated` is the only index whose trailing column is `updated_at`, which
  the read path filters on alongside `user_id`. Its cost is small next to the risk of
  changing a plan on the live path.

A btree on `(user_id, combined_score DESC)` serves an ascending scan of the same columns
by reading backwards, so the ascending twin adds nothing. A btree on `(user_id, vn_id)`
already covers a lookup by `user_id`, which is why only one of the two single-column
indexes is worth keeping at all.

Revision ID: 040_dedupe_rec_cache_indexes
Revises: 039_add_vn_difficulty
"""

from typing import Union

from alembic import op
import sqlalchemy as sa

revision: str = "040_dedupe_rec_cache_indexes"
down_revision: Union[str, None] = "039_add_vn_difficulty"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    # Duplicate of idx_user_rec_user.
    op.execute(sa.text("DROP INDEX IF EXISTS idx_user_cache_user"))
    # Same columns as idx_user_rec_score, opposite sort direction.
    op.execute(sa.text("DROP INDEX IF EXISTS idx_user_cache_score"))


def downgrade() -> None:
    op.execute(
        sa.text(
            "CREATE INDEX IF NOT EXISTS idx_user_cache_user "
            "ON user_recommendation_cache (user_id)"
        )
    )
    op.execute(
        sa.text(
            "CREATE INDEX IF NOT EXISTS idx_user_cache_score "
            "ON user_recommendation_cache (user_id, combined_score)"
        )
    )
