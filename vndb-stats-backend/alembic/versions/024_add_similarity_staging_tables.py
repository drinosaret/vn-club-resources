"""Add staging tables for zero-downtime similarity updates.

During the daily import, vn_similarities and vn_cooccurrence are truncated
and recomputed over ~1 hour. This leaves "Similar Games" and "Users Also Read"
empty during that window.

These staging tables allow new similarity data to be computed in the background,
then atomically swapped to live via table renames.

Revision ID: 024_add_sim_staging
Revises: 023_add_vndb_users
Create Date: 2026-02-14
"""

from alembic import op

revision = "024_add_sim_staging"
down_revision = "023_add_vndb_users"
branch_labels = None
depends_on = None


def upgrade():
    # Staging tables mirror the live tables but without foreign keys
    # (FKs would slow bulk inserts and complicate the rename swap)
    op.execute("""
        CREATE TABLE vn_similarities_staging (
            vn_id VARCHAR(10) NOT NULL,
            similar_vn_id VARCHAR(10) NOT NULL,
            similarity_score FLOAT NOT NULL,
            computed_at TIMESTAMP NOT NULL,
            PRIMARY KEY (vn_id, similar_vn_id)
        )
    """)

    op.execute("""
        CREATE TABLE vn_cooccurrence_staging (
            vn_id VARCHAR(10) NOT NULL,
            similar_vn_id VARCHAR(10) NOT NULL,
            co_rating_score FLOAT NOT NULL,
            user_count INTEGER NOT NULL,
            computed_at TIMESTAMP NOT NULL,
            PRIMARY KEY (vn_id, similar_vn_id)
        )
    """)


def downgrade():
    op.execute("DROP TABLE IF EXISTS vn_cooccurrence_staging")
    op.execute("DROP TABLE IF EXISTS vn_similarities_staging")
