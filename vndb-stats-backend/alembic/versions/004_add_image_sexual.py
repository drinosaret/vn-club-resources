"""Add image_sexual column to visual_novels table.

Revision ID: 004_add_image_sexual
Revises: 003_add_news_tables
Create Date: 2025-01-17

This migration adds:
- image_sexual column to visual_novels table (0=safe, 1=suggestive, 2=explicit)
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '004_add_image_sexual'
down_revision: Union[str, None] = '003_add_news_tables'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add image_sexual column to visual_novels table
    op.add_column('visual_novels', sa.Column('image_sexual', sa.Float))


def downgrade() -> None:
    op.drop_column('visual_novels', 'image_sexual')
