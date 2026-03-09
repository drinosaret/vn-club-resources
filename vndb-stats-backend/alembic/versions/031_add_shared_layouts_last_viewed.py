"""Add last_viewed_at column to shared_layouts.

Revision ID: 031_add_last_viewed_at
Revises: 030_add_shared_layouts
"""

from alembic import op
import sqlalchemy as sa

revision = "031_add_last_viewed_at"
down_revision = "030_add_shared_layouts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "shared_layouts",
        sa.Column("last_viewed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "idx_shared_layouts_last_viewed", "shared_layouts", ["last_viewed_at"]
    )


def downgrade() -> None:
    op.drop_index("idx_shared_layouts_last_viewed", table_name="shared_layouts")
    op.drop_column("shared_layouts", "last_viewed_at")
