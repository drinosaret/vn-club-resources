"""Store the predicted rating on user_recommendation_cache.

The page shows the mark the signals expect a reader to give a title. It is computed from
the reader's profile and the title's neighbours, which the cached read does not hold, so
a page served from the cache showed no prediction while every other page showed one. The
mean and the range are stored with the row so both paths report what the run produced.

Nullable: rows written before the columns carry nothing, and so do runs made with the
prediction switched off. The read path leaves the block out for those.

Revision ID: 047_rec_cache_predicted_rating
Revises: 046_rec_cache_indexes
"""

from typing import Union

from alembic import op
import sqlalchemy as sa

revision: str = "047_rec_cache_predicted_rating"
down_revision: Union[str, None] = "046_rec_cache_indexes"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None

COLUMNS = ("predicted_rating", "predicted_low", "predicted_high")


def upgrade() -> None:
    for column in COLUMNS:
        op.execute(
            sa.text(
                "ALTER TABLE user_recommendation_cache "
                f"ADD COLUMN IF NOT EXISTS {column} DOUBLE PRECISION"
            )
        )


def downgrade() -> None:
    for column in COLUMNS:
        op.execute(
            sa.text(f"ALTER TABLE user_recommendation_cache DROP COLUMN IF EXISTS {column}")
        )
