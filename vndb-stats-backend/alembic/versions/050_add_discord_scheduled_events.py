"""Map calendar items to the native Discord scheduled events that mirror them.

A table of its own rather than a column on events: the weekly session
placeholders are computed at read time and have no events row, and they are
exactly the items the mirror publishes first.

Guarded on the table already being there, because a container whose ORM
create_all runs before the migration reaches this point with the table built.

Revision ID: 050_add_discord_scheduled_events
Revises: 049_news_lang_backfill
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "050_add_discord_scheduled_events"
down_revision = "049_news_lang_backfill"
branch_labels = None
depends_on = None

TABLE = "discord_scheduled_events"
INDEX = "idx_discord_events_guild_key"


def upgrade() -> None:
    inspector = inspect(op.get_bind())
    if TABLE not in inspector.get_table_names():
        op.create_table(
            TABLE,
            sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
            sa.Column("guild_id", sa.BigInteger, nullable=False),
            sa.Column("sync_key", sa.String(200), nullable=False),
            sa.Column("discord_event_id", sa.BigInteger, nullable=False),
            sa.Column("content_hash", sa.String(64), nullable=False, server_default=""),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )
    # One mirrored event per calendar item per guild. The reconcile leans on the
    # constraint to settle a race between two ticks.
    if INDEX not in {ix["name"] for ix in inspector.get_indexes(TABLE)}:
        op.create_index(INDEX, TABLE, ["guild_id", "sync_key"], unique=True)


def downgrade() -> None:
    op.drop_index(INDEX, table_name=TABLE)
    op.drop_table(TABLE)
