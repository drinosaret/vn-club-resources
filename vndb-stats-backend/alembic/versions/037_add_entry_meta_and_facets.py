"""Add VN entry metadata, release facet flags, ignored-voter flag, and leaderboard indexes.

Columns rather than tables, to keep the storage cost small. The index on global_votes is the
only sizeable item, and it is what turns a windowed leaderboard from a full scan of the vote
table into a range scan over the votes cast in the period.

entry_created / entry_lastmod come from the dump's entry_meta file, filtered to VN entries.
Nothing else in the schema records when a database entry was made: visual_novels.released
is the game's release date, which says nothing about when someone catalogued it. Without
these there is no way to chart database growth or surface recently-updated entries.

has_free_release and jp_freeware are precomputed because both need releases joined to
release_vn with an rtype filter, which is too expensive to evaluate per leaderboard query.
They differ deliberately: has_free_release is the broad "can be obtained for free" facet,
while jp_freeware reproduces VNDB's stricter reading, where every Japanese release must be
free rather than merely one of them.

vndb_users.ign_votes marks accounts whose votes VNDB excludes from public aggregates. The
votes dump already omits them, so vote-derived boards are unaffected; the flag matters for
boards built from ulist_labels, which does include them.

The index on global_votes must stay a plain column btree. swap_staging_to_live recreates
indexes by string-rewriting pg_indexes.indexdef, and a partial or expression index does not
survive that rewrite intact.

Revision ID: 037_add_entry_meta_facets
Revises: 036_add_roudoku
"""

from alembic import op
import sqlalchemy as sa

revision = "037_add_entry_meta_facets"
down_revision = "036_add_roudoku"
branch_labels = None
depends_on = None


# entry_meta stores dates, not timestamps; DATE is half the width of TIMESTAMP.
_VN_COLUMNS = (
    ("entry_created", sa.Date(), None),
    ("entry_lastmod", sa.Date(), None),
    ("entry_num_edits", sa.Integer(), None),
    ("entry_num_users", sa.Integer(), None),
    ("has_free_release", sa.Boolean(), sa.false()),
    ("jp_freeware", sa.Boolean(), sa.false()),
)


def upgrade() -> None:
    for name, type_, default in _VN_COLUMNS:
        op.add_column(
            "visual_novels",
            sa.Column(
                name,
                type_,
                nullable=default is None,
                server_default=default,
            ),
        )

    # vndb_users uses the staging + atomic swap pattern. The staging twin must gain the
    # column too, or the next import's swap fails on a column mismatch.
    for table in ("vndb_users", "vndb_users_staging"):
        op.add_column(
            table,
            sa.Column("ign_votes", sa.Boolean(), nullable=False, server_default=sa.false()),
        )

    # Leading column is the one every window filters on; user_hash trails it so the common
    # "count votes per user in period" aggregate can be answered from the index alone.
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_global_votes_date "
        "ON global_votes (date, user_hash)"
    )

    # No index on `platforms` or `languages`. Every query that filters on them resolves the
    # facet in memory against the loaded title set rather than in SQL, so a GIN index here
    # would cost disk and add maintenance to each nightly rewrite of visual_novels without a
    # reader. Add one alongside the first query that can actually use containment.

    # The database growth curve range-scans this. Release-year facets already have
    # idx_vn_released from the original schema.
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_vn_entry_created "
        "ON visual_novels (entry_created)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_vn_entry_created")
    op.execute("DROP INDEX IF EXISTS idx_global_votes_date")

    for table in ("vndb_users_staging", "vndb_users"):
        op.drop_column(table, "ign_votes")

    for name, _type, _default in reversed(_VN_COLUMNS):
        op.drop_column("visual_novels", name)
