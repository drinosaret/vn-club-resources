"""Add Weekly Roudoku tables (weekly VN reading club: one long-lived pool + vote).

Cycle -> nominations (VNs from the local dump) -> votes. Single vote per user
per cycle (composite PK). One VN is flagged as the pick (winner_nomination_id)
and published to the events table by the cog. Pausing is the only thing that
stops voting. Same shape as Movie Night (035), minus its two unused columns.

roudoku_nominations.vndb_id deliberately has NO foreign key to visual_novels.id.
The daily dump import rewrites that table, so ON DELETE CASCADE would silently
delete a live nomination (or the live pick) mid-week, and RESTRICT would break
the import. The VN's title/cover/length are snapshotted onto the row instead,
so the pool still renders when the VN row moves underneath it.

Revision ID: 036_add_roudoku
Revises: 035_add_movie_night
"""

from alembic import op
import sqlalchemy as sa

revision = "036_add_roudoku"
down_revision = "035_add_movie_night"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "roudoku_cycles",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("phase", sa.String(20), nullable=False, server_default="voting"),
        sa.Column("channel_id", sa.BigInteger),
        sa.Column("message_id", sa.BigInteger),  # vote message
        sa.Column("scheduled_for", sa.DateTime(timezone=True)),  # session start
        sa.Column("closes_at", sa.DateTime(timezone=True)),
        sa.Column("winner_nomination_id", sa.Integer),  # no FK: cycle predates nominations
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("closed_at", sa.DateTime(timezone=True)),
    )
    op.create_index("idx_roudoku_cycles_phase", "roudoku_cycles", ["phase"])

    op.create_table(
        "roudoku_nominations",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column(
            "cycle_id",
            sa.Integer,
            sa.ForeignKey("roudoku_cycles.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("vndb_id", sa.String(10), nullable=False),  # no FK, see the module docstring
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("title_jp", sa.String(500)),
        sa.Column("title_romaji", sa.String(500)),
        sa.Column("released", sa.Date),
        sa.Column("image_url", sa.String(500)),
        sa.Column("image_sexual", sa.Float),
        sa.Column("length", sa.Integer),  # VNDB 1-5 category
        sa.Column("length_minutes", sa.Integer),  # vote-based average
        sa.Column("description", sa.Text),
        sa.Column("cover_mode", sa.String(10), nullable=False, server_default="auto"),
        sa.Column("nominated_by", sa.BigInteger, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("cycle_id", "vndb_id", name="uq_roudoku_nom_cycle_vn"),
    )
    op.create_index("idx_roudoku_noms_cycle", "roudoku_nominations", ["cycle_id"])

    op.create_table(
        "roudoku_votes",
        sa.Column(
            "cycle_id",
            sa.Integer,
            sa.ForeignKey("roudoku_cycles.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("user_id", sa.BigInteger, nullable=False),
        sa.Column(
            "nomination_id",
            sa.Integer,
            sa.ForeignKey("roudoku_nominations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        # Unnamed on purpose: create_all (fresh DBs) names this roudoku_votes_pkey,
        # so naming it here would make the two paths disagree.
        sa.PrimaryKeyConstraint("cycle_id", "user_id"),
    )


def downgrade() -> None:
    op.drop_table("roudoku_votes")
    op.drop_index("idx_roudoku_noms_cycle", table_name="roudoku_nominations")
    op.drop_table("roudoku_nominations")
    op.drop_index("idx_roudoku_cycles_phase", table_name="roudoku_cycles")
    op.drop_table("roudoku_cycles")
