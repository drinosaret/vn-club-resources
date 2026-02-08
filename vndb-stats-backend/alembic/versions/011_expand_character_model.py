"""Expand character model with detailed metadata.

Revision ID: 011_expand_character_model
Revises: 010_add_title_jp
Create Date: 2026-01-23

This migration adds additional columns to the characters table to store
full character metadata from VNDB dumps, including description, image,
physical attributes, and biographical data.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '011_expand_character_model'
down_revision: Union[str, None] = '010_add_title_jp'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add new columns to characters table
    op.add_column('characters', sa.Column('aliases', postgresql.ARRAY(sa.Text())))
    op.add_column('characters', sa.Column('description', sa.Text()))
    op.add_column('characters', sa.Column('image_url', sa.String(500)))
    op.add_column('characters', sa.Column('image_sexual', sa.Float()))
    op.add_column('characters', sa.Column('sex', sa.String(10)))
    op.add_column('characters', sa.Column('blood_type', sa.String(5)))
    op.add_column('characters', sa.Column('height', sa.Integer()))
    op.add_column('characters', sa.Column('weight', sa.Integer()))
    op.add_column('characters', sa.Column('bust', sa.Integer()))
    op.add_column('characters', sa.Column('waist', sa.Integer()))
    op.add_column('characters', sa.Column('hips', sa.Integer()))
    op.add_column('characters', sa.Column('cup', sa.String(5)))
    op.add_column('characters', sa.Column('age', sa.Integer()))
    op.add_column('characters', sa.Column('birthday_month', sa.Integer()))
    op.add_column('characters', sa.Column('birthday_day', sa.Integer()))


def downgrade() -> None:
    op.drop_column('characters', 'birthday_day')
    op.drop_column('characters', 'birthday_month')
    op.drop_column('characters', 'age')
    op.drop_column('characters', 'cup')
    op.drop_column('characters', 'hips')
    op.drop_column('characters', 'waist')
    op.drop_column('characters', 'bust')
    op.drop_column('characters', 'weight')
    op.drop_column('characters', 'height')
    op.drop_column('characters', 'blood_type')
    op.drop_column('characters', 'sex')
    op.drop_column('characters', 'image_sexual')
    op.drop_column('characters', 'image_url')
    op.drop_column('characters', 'description')
    op.drop_column('characters', 'aliases')
