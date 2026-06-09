"""Add events table for the unified club calendar.

Holds every calendar event: VN of the Month, VN of the Season, Movie Night,
and ad-hoc custom events. external_key gives bot-pushed rows a stable identity
so re-pushes upsert instead of duplicating.

Revision ID: 034_add_events
Revises: 033_add_word_of_the_day
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "034_add_events"
down_revision = "033_add_word_of_the_day"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "events",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("event_type", sa.String(30), nullable=False),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("description", sa.Text),
        sa.Column("start_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("end_at", sa.DateTime(timezone=True)),
        sa.Column("all_day", sa.Boolean, server_default=sa.text("false"), nullable=False),
        sa.Column("image_url", sa.String(500)),
        sa.Column("url", sa.String(500)),
        sa.Column("location", sa.String(200)),
        sa.Column("is_active", sa.Boolean, server_default=sa.text("true"), nullable=False),
        sa.Column("external_key", sa.String(200)),
        sa.Column("created_by", sa.String(100)),
        sa.Column("extra_data", JSONB),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("idx_events_start", "events", ["start_at"])
    op.create_index("idx_events_type_start", "events", ["event_type", "start_at"])
    op.create_index("idx_events_active", "events", ["is_active"])
    op.create_index("idx_events_external_key", "events", ["external_key"], unique=True)


def downgrade() -> None:
    op.drop_index("idx_events_external_key", table_name="events")
    op.drop_index("idx_events_active", table_name="events")
    op.drop_index("idx_events_type_start", table_name="events")
    op.drop_index("idx_events_start", table_name="events")
    op.drop_table("events")
