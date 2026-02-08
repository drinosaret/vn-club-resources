"""Add title_jp column to visual_novels table.

Revision ID: 010_add_title_jp
Revises: 009_add_cache_score_columns
Create Date: 2026-01-22

This migration adds title_jp column to store the original Japanese title
(kanji/kana) for visual novels, enabling the frontend to display Japanese
titles when users prefer them over English/romanized titles.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '010_add_title_jp'
down_revision: Union[str, None] = '009_add_cache_score_columns'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('visual_novels', sa.Column('title_jp', sa.String(500)))


def downgrade() -> None:
    op.drop_column('visual_novels', 'title_jp')
