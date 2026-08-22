"""Persist the per-title statistics the leaderboard job already computes.

The nightly job derives a spread, a windowed count and a reputation shift for every title,
publishes the top rows of each board, and discards the rest. Without somewhere to keep them
the metrics are unusable wherever a reader supplies their own filters, because there is
nothing to sort by.
spread, a windowed count and a reputation shift for every title, publishes the top hundred
rows of each board, and discards the rest. That makes the metrics unusable anywhere a reader
supplies their own filters, because there is nothing to sort by.

A handful of nullable columns on visual_novels, on the same storage budget as 037.

Two things about where they live:

- `visual_novels` is not in STAGING_TABLES, so its indexes are not subject to the
  indexdef string-rewrite in swap_staging_to_live. Any index here is safe to shape freely,
  unlike one on global_votes.
- The columns are deliberately absent from `_upsert_vns`'s set_ clause, so the nightly VN
  upsert leaves them alone. This is the same arrangement the entry_meta and freeware columns
  already rely on; adding them to that clause would blank them every night.

`public_votes` is kept distinct from the existing `votecount`. That one is VNDB's own figure
and counts private votes, so it cannot be used as the denominator for anything derived from
the public vote dump without the two quietly disagreeing.

Every column is nullable, and NULL means "not yet derived" rather than zero. A title with no
list entries and a title the job has never seen are different states, and a sort that treats
them alike would rank the second group as though it had real data.

Revision ID: 038_add_vn_vote_aggregates
Revises: 037_add_entry_meta_facets
"""

from alembic import op
import sqlalchemy as sa

revision = "038_add_vn_vote_aggregates"
down_revision = "037_add_entry_meta_facets"
branch_labels = None
depends_on = None


_COLUMNS = (
    # Derived from the public vote dump.
    ("public_votes", sa.Integer()),
    ("public_mean", sa.Float()),
    ("vote_stddev", sa.Float()),
    ("votes_30d", sa.Integer()),
    ("votes_365d", sa.Integer()),
    ("reputation_shift", sa.Float()),
    # Derived from user list labels.
    ("list_playing", sa.Integer()),
    ("list_finished", sa.Integer()),
    ("list_stalled", sa.Integer()),
    ("list_dropped", sa.Integer()),
    ("list_wishlist", sa.Integer()),
)


def upgrade() -> None:
    for name, type_ in _COLUMNS:
        op.add_column("visual_novels", sa.Column(name, type_, nullable=True))

    # Only the two metrics whose unfiltered ranking is a page of its own. A tag-filtered
    # sort narrows to a few thousand rows and sorts them in memory, so further indexes
    # should follow a measurement rather than a guess.
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_vn_vote_stddev "
        "ON visual_novels (vote_stddev DESC NULLS LAST)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_vn_reputation_shift "
        "ON visual_novels (reputation_shift)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_vn_reputation_shift")
    op.execute("DROP INDEX IF EXISTS idx_vn_vote_stddev")

    for name, _type in reversed(_COLUMNS):
        op.drop_column("visual_novels", name)
