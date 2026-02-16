"""Add staging tables for zero-downtime import swaps.

These staging tables allow import data to be loaded in the background, then
atomically swapped to live via table renames (same pattern as 024 for similarity
tables). If the import crashes at any point before the swap, the live table is
completely untouched.

Staging tables mirror live columns and PK but have NO foreign keys (they slow
COPY and complicate the rename swap) and NO non-PK indexes (created dynamically
before each swap).

Revision ID: 025_add_import_staging
Revises: 024_add_sim_staging
Create Date: 2026-02-16
"""

from alembic import op

revision = "025_add_import_staging"
down_revision = "024_add_sim_staging"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        CREATE TABLE IF NOT EXISTS global_votes_staging (
            vn_id VARCHAR(10) NOT NULL,
            user_hash VARCHAR(64) NOT NULL,
            vote INTEGER NOT NULL,
            date DATE,
            PRIMARY KEY (vn_id, user_hash)
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS vn_tags_staging (
            vn_id VARCHAR(10) NOT NULL,
            tag_id INTEGER NOT NULL,
            score FLOAT,
            spoiler_level INTEGER DEFAULT 0,
            lie BOOLEAN DEFAULT FALSE,
            PRIMARY KEY (vn_id, tag_id)
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS vn_staff_staging (
            vn_id VARCHAR(10) NOT NULL,
            staff_id VARCHAR(10) NOT NULL,
            aid INTEGER,
            role VARCHAR(50) NOT NULL,
            note VARCHAR(500),
            PRIMARY KEY (vn_id, staff_id, role)
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS vn_seiyuu_staging (
            vn_id VARCHAR(10) NOT NULL,
            staff_id VARCHAR(10) NOT NULL,
            aid INTEGER,
            character_id VARCHAR(10) NOT NULL,
            note VARCHAR(500),
            PRIMARY KEY (vn_id, staff_id, character_id)
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS vn_relations_staging (
            vn_id VARCHAR(10) NOT NULL,
            related_vn_id VARCHAR(10) NOT NULL,
            relation VARCHAR(10) NOT NULL,
            official BOOLEAN DEFAULT TRUE,
            PRIMARY KEY (vn_id, related_vn_id)
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS character_vn_staging (
            character_id VARCHAR(10) NOT NULL,
            vn_id VARCHAR(10) NOT NULL,
            role VARCHAR(20),
            spoiler_level INTEGER DEFAULT 0,
            release_id VARCHAR(10),
            PRIMARY KEY (character_id, vn_id)
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS character_traits_staging (
            character_id VARCHAR(10) NOT NULL,
            trait_id INTEGER NOT NULL,
            spoiler_level INTEGER DEFAULT 0,
            PRIMARY KEY (character_id, trait_id)
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS release_vn_staging (
            release_id VARCHAR(10) NOT NULL,
            vn_id VARCHAR(10) NOT NULL,
            rtype VARCHAR(20),
            PRIMARY KEY (release_id, vn_id)
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS release_producers_staging (
            release_id VARCHAR(10) NOT NULL,
            producer_id VARCHAR(10) NOT NULL,
            developer BOOLEAN DEFAULT FALSE,
            publisher BOOLEAN DEFAULT FALSE,
            PRIMARY KEY (release_id, producer_id)
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS release_platforms_staging (
            release_id VARCHAR(10) NOT NULL,
            platform VARCHAR(20) NOT NULL,
            PRIMARY KEY (release_id, platform)
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS release_media_staging (
            release_id VARCHAR(10) NOT NULL,
            medium VARCHAR(10) NOT NULL,
            quantity SMALLINT DEFAULT 1,
            PRIMARY KEY (release_id, medium)
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS release_extlinks_staging (
            release_id VARCHAR(10) NOT NULL,
            site VARCHAR(50) NOT NULL,
            url VARCHAR(500),
            PRIMARY KEY (release_id, site)
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS ulist_vns_staging (
            uid VARCHAR(20) NOT NULL,
            vid VARCHAR(10) NOT NULL,
            added BIGINT,
            lastmod BIGINT,
            vote_date BIGINT,
            vote SMALLINT,
            started DATE,
            finished DATE,
            notes TEXT,
            PRIMARY KEY (uid, vid)
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS ulist_labels_staging (
            uid VARCHAR(20) NOT NULL,
            vid VARCHAR(10) NOT NULL,
            label SMALLINT NOT NULL,
            PRIMARY KEY (uid, vid, label)
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS vndb_users_staging (
            uid VARCHAR(20) NOT NULL,
            username VARCHAR(100) NOT NULL,
            PRIMARY KEY (uid)
        )
    """)


def downgrade():
    for table in [
        'vndb_users_staging', 'ulist_labels_staging', 'ulist_vns_staging',
        'release_extlinks_staging', 'release_media_staging', 'release_platforms_staging',
        'release_producers_staging', 'release_vn_staging',
        'character_traits_staging', 'character_vn_staging',
        'vn_relations_staging', 'vn_seiyuu_staging', 'vn_staff_staging',
        'vn_tags_staging', 'global_votes_staging',
    ]:
        op.execute(f"DROP TABLE IF EXISTS {table}")
