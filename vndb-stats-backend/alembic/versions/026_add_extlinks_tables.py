"""Add extlinks master, VN extlinks, and wikidata tables.

Replaces the old release_extlinks schema (release_id, site, url) with a
normalized junction-table design:

  extlinks_master   — master lookup of (site, value) pairs
  vn_extlinks       — VN ↔ extlinks_master junction
  release_extlinks  — Release ↔ extlinks_master junction (replaces old table)
  wikidata_entries  — pre-resolved Wikidata properties from VNDB dump

Each live table has a corresponding *_staging twin for zero-downtime import
swaps. Staging tables mirror columns and PK but have NO foreign keys and NO
non-PK indexes.

Revision ID: 026_add_extlinks_tables
Revises: 025_add_import_staging
Create Date: 2026-02-17
"""

from alembic import op

revision = "026_add_extlinks_tables"
down_revision = "025_add_import_staging"
branch_labels = None
depends_on = None


def upgrade():
    # ── extlinks_master (live + staging) ──────────────────────────────
    op.execute("""
        CREATE TABLE IF NOT EXISTS extlinks_master (
            id INTEGER PRIMARY KEY,
            site VARCHAR(50) NOT NULL,
            value TEXT NOT NULL
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_extlinks_master_site
            ON extlinks_master (site)
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS extlinks_master_staging (
            id INTEGER PRIMARY KEY,
            site VARCHAR(50) NOT NULL,
            value TEXT NOT NULL
        )
    """)

    # ── vn_extlinks (live + staging) ──────────────────────────────────
    op.execute("""
        CREATE TABLE IF NOT EXISTS vn_extlinks (
            vn_id VARCHAR(10) NOT NULL,
            link_id INTEGER NOT NULL,
            PRIMARY KEY (vn_id, link_id)
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_vn_extlinks_vn
            ON vn_extlinks (vn_id)
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS vn_extlinks_staging (
            vn_id VARCHAR(10) NOT NULL,
            link_id INTEGER NOT NULL,
            PRIMARY KEY (vn_id, link_id)
        )
    """)

    # ── wikidata_entries (live + staging) ─────────────────────────────
    op.execute("""
        CREATE TABLE IF NOT EXISTS wikidata_entries (
            id INTEGER PRIMARY KEY,
            enwiki TEXT,
            jawiki TEXT,
            website TEXT,
            vndb TEXT,
            mobygames TEXT,
            mobygames_game TEXT,
            gamefaqs_game TEXT,
            gamefaqs_company TEXT,
            howlongtobeat TEXT,
            igdb_game TEXT,
            pcgamingwiki TEXT,
            giantbomb TEXT,
            steam TEXT,
            gog TEXT,
            lutris TEXT,
            wine TEXT,
            anidb_anime TEXT,
            ann_anime TEXT,
            acdb_source TEXT
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS wikidata_entries_staging (
            id INTEGER PRIMARY KEY,
            enwiki TEXT,
            jawiki TEXT,
            website TEXT,
            vndb TEXT,
            mobygames TEXT,
            mobygames_game TEXT,
            gamefaqs_game TEXT,
            gamefaqs_company TEXT,
            howlongtobeat TEXT,
            igdb_game TEXT,
            pcgamingwiki TEXT,
            giantbomb TEXT,
            steam TEXT,
            gog TEXT,
            lutris TEXT,
            wine TEXT,
            anidb_anime TEXT,
            ann_anime TEXT,
            acdb_source TEXT
        )
    """)

    # ── release_extlinks — drop old schema, create new junction ──────
    op.execute("DROP TABLE IF EXISTS release_extlinks")
    op.execute("DROP TABLE IF EXISTS release_extlinks_staging")

    op.execute("""
        CREATE TABLE IF NOT EXISTS release_extlinks (
            release_id VARCHAR(10) NOT NULL,
            link_id INTEGER NOT NULL,
            PRIMARY KEY (release_id, link_id)
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_release_extlinks_release
            ON release_extlinks (release_id)
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS release_extlinks_staging (
            release_id VARCHAR(10) NOT NULL,
            link_id INTEGER NOT NULL,
            PRIMARY KEY (release_id, link_id)
        )
    """)


def downgrade():
    # Drop all new tables
    for table in [
        "release_extlinks_staging",
        "release_extlinks",
        "wikidata_entries_staging",
        "wikidata_entries",
        "vn_extlinks_staging",
        "vn_extlinks",
        "extlinks_master_staging",
        "extlinks_master",
    ]:
        op.execute(f"DROP TABLE IF EXISTS {table}")

    # Recreate old release_extlinks schema
    op.execute("""
        CREATE TABLE IF NOT EXISTS release_extlinks (
            release_id VARCHAR(10) NOT NULL,
            site VARCHAR(50) NOT NULL,
            url VARCHAR(500),
            PRIMARY KEY (release_id, site)
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_release_extlinks_release
            ON release_extlinks (release_id)
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS release_extlinks_staging (
            release_id VARCHAR(10) NOT NULL,
            site VARCHAR(50) NOT NULL,
            url VARCHAR(500),
            PRIMARY KEY (release_id, site)
        )
    """)
