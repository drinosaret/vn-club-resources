"""Store a card's reason on user_recommendation_cache.

The page shows why each title is on it, and that answer is made of the reader's whole
profile against the candidate's tags, studios, staff, voice actors and traits. Nothing in
the stored row can rebuild it, and recomputing it per request is the expensive half of
scoring, so a page read back from the cache would carry every score and no reason while a
page computed for the request carried both.

One JSONB column rather than a column per entity kind: the shape is a signal name, a
count and a few names, it is written and read whole, and nothing filters or orders on it.
It holds on the order of a hundred bytes, so it stays in the row rather than reaching the
overflow table.

Nullable, and left null on the rows already in the table. A writer that scores without
computing details has nothing to put here, and the read path omits the field rather than
inventing one. Each row is replaced the next time its reader is scored.

No index, for the same reason the score columns carry none: it is read alongside a
reader's own rows, which the existing user_id indexes already reach.

Revision ID: 044_add_rec_cache_reason
Revises: 043_add_rec_cache_desc
"""

from typing import Union

from alembic import op
import sqlalchemy as sa

revision: str = "044_add_rec_cache_reason"
down_revision: Union[str, None] = "043_add_rec_cache_desc"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    op.execute(
        sa.text(
            "ALTER TABLE user_recommendation_cache "
            "ADD COLUMN IF NOT EXISTS reason JSONB"
        )
    )


def downgrade() -> None:
    op.execute(
        sa.text("ALTER TABLE user_recommendation_cache DROP COLUMN IF EXISTS reason")
    )
