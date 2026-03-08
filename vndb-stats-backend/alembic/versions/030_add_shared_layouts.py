"""Add shared_layouts table for shareable grid and tier list links.

Revision ID: 030_add_shared_layouts
Revises: 029_add_bot_config
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect
from sqlalchemy.dialects.postgresql import JSONB

revision = "030_add_shared_layouts"
down_revision = "029_add_bot_config"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = inspect(conn)
    if "shared_layouts" not in inspector.get_table_names():
        op.create_table(
            "shared_layouts",
            sa.Column("id", sa.String(12), primary_key=True),
            sa.Column("type", sa.String(10), nullable=False),
            sa.Column("data", JSONB, nullable=False),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                nullable=False,
            ),
            sa.Column("view_count", sa.Integer, server_default="0"),
            sa.CheckConstraint(
                "type IN ('grid', 'tierlist')", name="ck_shared_layouts_type"
            ),
        )
        op.create_index("idx_shared_layouts_type", "shared_layouts", ["type"])
        op.create_index("idx_shared_layouts_created", "shared_layouts", [sa.text("created_at DESC")])


def downgrade() -> None:
    op.drop_table("shared_layouts")
