"""Drop admin_users table.

Revision ID: 017_drop_admin_users
Revises: 016_add_ulist_tables
Create Date: 2026-02-04

Admin functionality has been moved to a Discord bot that accesses the
database directly. The admin_users table and JWT auth system are no longer
needed.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "017_drop_admin_users"
down_revision: Union[str, None] = "016_add_ulist_tables"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Table may not exist if DB was freshly created after auth removal
    op.execute(sa.text("DROP TABLE IF EXISTS admin_users"))



def downgrade() -> None:
    op.create_table(
        "admin_users",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("username", sa.String(50), unique=True, nullable=False),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("is_active", sa.Boolean(), default=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("last_login", sa.DateTime(timezone=True), nullable=True),
    )
