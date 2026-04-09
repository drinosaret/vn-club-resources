"""Add word_of_the_day table for daily vocabulary spotlight feature.

Revision ID: 033_add_word_of_the_day
Revises: 032_add_trgm_indexes
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "033_add_word_of_the_day"
down_revision = "032_add_trgm_indexes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "word_of_the_day",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("word_id", sa.Integer, nullable=False),
        sa.Column("reading_index", sa.Integer, nullable=False, server_default="0"),
        sa.Column("date", sa.Date, nullable=False, unique=True),
        sa.Column("cached_data", JSONB, nullable=False),
        sa.Column("is_override", sa.Boolean, server_default=sa.text("false")),
        sa.Column("override_by", sa.String(100)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("idx_wotd_date", "word_of_the_day", [sa.text("date DESC")])
    op.create_index("idx_wotd_word_id", "word_of_the_day", ["word_id"])


def downgrade() -> None:
    op.drop_index("idx_wotd_word_id", table_name="word_of_the_day")
    op.drop_index("idx_wotd_date", table_name="word_of_the_day")
    op.drop_table("word_of_the_day")
