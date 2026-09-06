"""Store the agreement figure on user_recommendation_cache.

The page shows one match percentage. On a page computed for the request it is how far
the signals agree on the title, which is a property of the pool the run scored; a page
read back from the cache has no pool and rebuilt the figure from the stored score on a
different scale, so the same title showed two numbers depending on whether the cache was
warm. The figure is stored with the row so both paths report the one the run produced.

Nullable: rows written before the column carry nothing, and the read path falls back to
the score-derived figure for them until the reader is next scored.

Revision ID: 045_add_rec_cache_confidence
Revises: 044_add_rec_cache_reason
"""

from typing import Union

from alembic import op
import sqlalchemy as sa

revision: str = "045_add_rec_cache_confidence"
down_revision: Union[str, None] = "044_add_rec_cache_reason"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    op.execute(
        sa.text(
            "ALTER TABLE user_recommendation_cache "
            "ADD COLUMN IF NOT EXISTS confidence INTEGER"
        )
    )


def downgrade() -> None:
    op.execute(
        sa.text("ALTER TABLE user_recommendation_cache DROP COLUMN IF EXISTS confidence")
    )
