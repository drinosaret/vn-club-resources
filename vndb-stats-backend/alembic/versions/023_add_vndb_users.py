"""Add vndb_users table for uid → username mapping.

Stores VNDB user accounts imported from the daily data dumps.
Used by the similar users feature to display usernames without
making external API calls.

Revision ID: 023_add_vndb_users
Revises: 022_create_missing_indexes
Create Date: 2026-02-09
"""

from alembic import op
import sqlalchemy as sa

revision = "023_add_vndb_users"
down_revision = "022_create_missing_indexes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS vndb_users (
            uid VARCHAR(20) PRIMARY KEY,
            username VARCHAR(100) NOT NULL
        )
    """)


def downgrade() -> None:
    op.drop_table("vndb_users")
