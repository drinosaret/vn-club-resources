"""Add vn_of_the_day table for daily VN spotlight feature.

Revision ID: 028_add_vn_of_the_day
Revises: 027_news_source_pub_idx
"""

from alembic import op
import sqlalchemy as sa

revision = "028_add_vn_of_the_day"
down_revision = "027_news_source_pub_idx"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "vn_of_the_day",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column(
            "vn_id",
            sa.String(10),
            sa.ForeignKey("visual_novels.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("date", sa.Date, nullable=False, unique=True),
        sa.Column("is_override", sa.Boolean, default=False),
        sa.Column("override_by", sa.String(100)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("idx_votd_date", "vn_of_the_day", [sa.text("date DESC")])
    op.create_index("idx_votd_vn_id", "vn_of_the_day", ["vn_id"])


def downgrade() -> None:
    op.drop_index("idx_votd_vn_id", table_name="vn_of_the_day")
    op.drop_index("idx_votd_date", table_name="vn_of_the_day")
    op.drop_table("vn_of_the_day")
