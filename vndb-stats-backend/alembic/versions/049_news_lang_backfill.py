"""News rows: the language of the source, for rows written before it was recorded.

Revision ID: 049_news_lang_backfill
Revises: 048_news_sources
"""

from typing import Union

from alembic import op

revision: str = "049_news_lang_backfill"
down_revision: Union[str, None] = "048_news_sources"
branch_labels = None
depends_on = None

# The one English-language source among those that existed before the language was
# recorded; every other press, social and video source wrote in Japanese.
_ENGLISH_LABELS = ("@ErogeAreAlive", "VNDB")


def upgrade() -> None:
    op.execute(
        "UPDATE news_items SET extra_data = coalesce(extra_data, '{}'::jsonb) || '{\"lang\": \"en\"}'::jsonb "
        "WHERE source IN ('rss', 'twitter', 'bluesky', 'youtube') "
        "AND NOT (coalesce(extra_data, '{}'::jsonb) ? 'lang') "
        "AND source_label IN ('@ErogeAreAlive', 'VNDB')"
    )
    op.execute(
        "UPDATE news_items SET extra_data = coalesce(extra_data, '{}'::jsonb) || '{\"lang\": \"ja\"}'::jsonb "
        "WHERE source IN ('rss', 'twitter', 'bluesky', 'youtube') "
        "AND NOT (coalesce(extra_data, '{}'::jsonb) ? 'lang')"
    )


def downgrade() -> None:
    op.execute("UPDATE news_items SET extra_data = extra_data - 'lang' WHERE extra_data ? 'lang'")
