"""Store Japanese reading difficulty for the titles jiten.moe has analysed.

Difficulty is not part of the VNDB dump. It comes from a third party whose responses fail
intermittently. Holding it locally makes it a filter and a sort rather than a panel that
sometimes fails to load.

A table of its own rather than more columns on visual_novels: a different source, a different
refresh cadence, and coverage of only a small fraction of titles.

The importer must upsert and must never truncate. A sweep that fails halfway has to leave
yesterday's rows in place, because the alternative is a filter that silently matches nothing
whenever the upstream is down.

Revision ID: 039_add_vn_difficulty
Revises: 038_add_vn_vote_aggregates
"""

from alembic import op
import sqlalchemy as sa

revision = "039_add_vn_difficulty"
down_revision = "038_add_vn_vote_aggregates"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "vn_difficulty",
        sa.Column("vn_id", sa.String(10), primary_key=True),
        sa.Column("jiten_deck_id", sa.Integer(), nullable=False),
        # The published bucket, and the continuous value it was derived from. Both are kept:
        # the bucket is what a reader picks, the raw value is what an ordering needs.
        sa.Column("difficulty", sa.Integer()),
        sa.Column("difficulty_raw", sa.Float()),
        sa.Column("character_count", sa.Integer()),
        sa.Column("word_count", sa.Integer()),
        sa.Column("unique_word_count", sa.Integer()),
        sa.Column("unique_kanji_count", sa.Integer()),
        sa.Column("sentence_count", sa.Integer()),
        sa.Column("average_sentence_length", sa.Float()),
        sa.Column("dialogue_percentage", sa.Float()),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["vn_id"], ["visual_novels.id"], ondelete="CASCADE"),
    )

    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_vn_difficulty_raw "
        "ON vn_difficulty (difficulty_raw)"
    )
    # One deck maps to one title, so a duplicate indicates the link data changed upstream
    # rather than that two titles share a deck.
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_vn_difficulty_deck "
        "ON vn_difficulty (jiten_deck_id)"
    )


def downgrade() -> None:
    op.drop_table("vn_difficulty")
