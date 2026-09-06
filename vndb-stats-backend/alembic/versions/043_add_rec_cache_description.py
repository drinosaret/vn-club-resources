"""Store the description signal on user_recommendation_cache.

The cache keeps a column per scored signal so a served page can show the same breakdown
whether it was computed for the request or read back. A signal with nowhere to be stored
would be shown as zero on every cache hit and as its real value on every miss, which
reads as the engine disagreeing with itself between two loads of the same page.

Nullable, and left null on the rows already in the table. Nothing recorded a description
score for them and it cannot be derived from what was stored, so backfilling would invent
a number. The read path renders a null as zero, and each row is replaced the next time
its reader is scored.

No index. The column is read alongside a reader's own rows, which the existing `user_id`
indexes already reach, and nothing filters or orders on it.

Revision ID: 043_add_rec_cache_desc
Revises: 042_add_desc_embeddings
"""

from typing import Union

from alembic import op
import sqlalchemy as sa

revision: str = "043_add_rec_cache_desc"
down_revision: Union[str, None] = "042_add_desc_embeddings"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    op.execute(
        sa.text(
            "ALTER TABLE user_recommendation_cache "
            "ADD COLUMN IF NOT EXISTS description_score DOUBLE PRECISION"
        )
    )


def downgrade() -> None:
    op.execute(
        sa.text(
            "ALTER TABLE user_recommendation_cache "
            "DROP COLUMN IF EXISTS description_score"
        )
    )
