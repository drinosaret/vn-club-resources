"""Add bot_config key-value table for Discord bot settings.

Revision ID: 029_add_bot_config
Revises: 028_add_vn_of_the_day
"""

from alembic import op
import sqlalchemy as sa

revision = "029_add_bot_config"
down_revision = "028_add_vn_of_the_day"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "bot_config",
        sa.Column("key", sa.String(100), primary_key=True),
        sa.Column("value", sa.Text, nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_table("bot_config")
