"""Record the page order on user_recommendation_cache.

The order a recommendation page is served in is not a sort of its scores. It is settled
after scoring, by a diversity pass over the scored set and, where it is switched on, by a
popularity pass, and neither is recoverable from `combined_score`. Without somewhere to
put it, a cache hit could only re-sort the selected titles by relevance and serve an order
the engine never produced.

`rank` holds the zero-based position the engine returned the row at. It is nullable
because rows already in the table have no position to backfill: nothing recorded which
order they were computed in, and re-deriving one from the score would invent the very
ordering this column exists to preserve. Those rows keep NULL and the read path sorts them
last, on score; each is replaced the next time its reader is scored, and any reader who is
never scored again falls out under the retention sweep.

No index is added. The ordering is applied to one reader's rows, which the existing
`user_id` indexes already reach.

Revision ID: 041_add_rec_cache_rank
Revises: 040_dedupe_rec_cache_indexes
"""

from typing import Union

from alembic import op
import sqlalchemy as sa

revision: str = "041_add_rec_cache_rank"
down_revision: Union[str, None] = "040_dedupe_rec_cache_indexes"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    op.execute(
        sa.text(
            "ALTER TABLE user_recommendation_cache ADD COLUMN IF NOT EXISTS rank INTEGER"
        )
    )


def downgrade() -> None:
    op.execute(
        sa.text("ALTER TABLE user_recommendation_cache DROP COLUMN IF EXISTS rank")
    )
