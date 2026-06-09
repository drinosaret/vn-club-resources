"""Add Movie Night tables (one long-lived, always-open pool + vote).

Cycle -> nominations (TMDB films) -> votes. Single vote per user per cycle
(composite PK). One film is flagged as the pick (winner_nomination_id) and
published to the events table by the cog. Pausing is the only thing that stops voting.

Revision ID: 035_add_movie_night
Revises: 034_add_events
"""

from alembic import op
import sqlalchemy as sa

revision = "035_add_movie_night"
down_revision = "034_add_events"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "movie_night_cycles",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("phase", sa.String(20), nullable=False, server_default="voting"),
        sa.Column("channel_id", sa.BigInteger),
        sa.Column("message_id", sa.BigInteger),  # vote message
        sa.Column("nominate_message_id", sa.BigInteger),
        sa.Column("scheduled_for", sa.DateTime(timezone=True)),  # showtime
        sa.Column("voting_opens_at", sa.DateTime(timezone=True)),
        sa.Column("closes_at", sa.DateTime(timezone=True)),
        sa.Column("winner_nomination_id", sa.Integer),  # no FK: cycle predates nominations
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("closed_at", sa.DateTime(timezone=True)),
    )
    op.create_index("idx_movie_cycles_phase", "movie_night_cycles", ["phase"])

    op.create_table(
        "movie_nominations",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column(
            "cycle_id",
            sa.Integer,
            sa.ForeignKey("movie_night_cycles.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("tmdb_id", sa.Integer, nullable=False),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("release_year", sa.Integer),
        sa.Column("poster_url", sa.String(500)),
        sa.Column("overview", sa.Text),
        sa.Column("nominated_by", sa.BigInteger, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("cycle_id", "tmdb_id", name="uq_movie_nom_cycle_tmdb"),
    )
    op.create_index("idx_movie_noms_cycle", "movie_nominations", ["cycle_id"])

    op.create_table(
        "movie_votes",
        sa.Column(
            "cycle_id",
            sa.Integer,
            sa.ForeignKey("movie_night_cycles.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("user_id", sa.BigInteger, nullable=False),
        sa.Column(
            "nomination_id",
            sa.Integer,
            sa.ForeignKey("movie_nominations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("cycle_id", "user_id", name="pk_movie_votes"),
    )


def downgrade() -> None:
    op.drop_table("movie_votes")
    op.drop_index("idx_movie_noms_cycle", table_name="movie_nominations")
    op.drop_table("movie_nominations")
    op.drop_index("idx_movie_cycles_phase", table_name="movie_night_cycles")
    op.drop_table("movie_night_cycles")
