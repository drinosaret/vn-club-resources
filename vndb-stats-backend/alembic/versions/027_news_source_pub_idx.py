"""Add composite index on news_items (source, published_at DESC).

Optimizes date+source filtering queries for the new date-based news pages.

Revision ID: 027_news_source_pub_idx
Revises: 026_add_extlinks_tables
"""

from alembic import op
import sqlalchemy as sa

revision = "027_news_source_pub_idx"
down_revision = "026_add_extlinks_tables"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "idx_news_source_published",
        "news_items",
        ["source", sa.text("published_at DESC")],
    )


def downgrade() -> None:
    op.drop_index("idx_news_source_published", table_name="news_items")
