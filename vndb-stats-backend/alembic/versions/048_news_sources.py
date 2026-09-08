"""News sources: wider source column, vn_id on news items.

Revision ID: 048_news_sources
Revises: 047_rec_cache_predicted_rating
"""

from typing import Union

import sqlalchemy as sa
from alembic import op

revision: str = "048_news_sources"
down_revision: Union[str, None] = "047_rec_cache_predicted_rating"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("news_items", "source", type_=sa.String(32), existing_type=sa.String(20))
    op.alter_column(
        "posted_items_tracker", "source", type_=sa.String(32), existing_type=sa.String(20)
    )
    op.add_column("news_items", sa.Column("vn_id", sa.String(16), nullable=True))
    op.create_index("idx_news_vn_id", "news_items", ["vn_id"])
    # Rows written before the column existed carry the id in the free-form bag.
    op.execute(
        "UPDATE news_items SET vn_id = extra_data->>'vn_id' "
        "WHERE vn_id IS NULL AND extra_data ? 'vn_id'"
    )


def downgrade() -> None:
    op.drop_index("idx_news_vn_id", table_name="news_items")
    op.drop_column("news_items", "vn_id")
    op.alter_column(
        "posted_items_tracker", "source", type_=sa.String(20), existing_type=sa.String(32)
    )
    op.alter_column("news_items", "source", type_=sa.String(20), existing_type=sa.String(32))
