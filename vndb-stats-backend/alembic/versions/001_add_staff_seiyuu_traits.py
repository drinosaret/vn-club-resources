"""Add staff, seiyuu, traits, and character tables.

Revision ID: 001_add_staff_seiyuu_traits
Revises:
Create Date: 2025-01-04

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '001_add_staff_seiyuu_traits'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create producers table
    op.create_table(
        'producers',
        sa.Column('id', sa.String(10), primary_key=True),
        sa.Column('name', sa.String(500), nullable=False),
        sa.Column('original', sa.String(500)),
        sa.Column('type', sa.String(50)),
        sa.Column('lang', sa.String(10)),
        sa.Column('description', sa.Text),
    )
    op.create_index('idx_producers_name', 'producers', ['name'])

    # Create staff table
    op.create_table(
        'staff',
        sa.Column('id', sa.String(10), primary_key=True),
        sa.Column('name', sa.String(500), nullable=False),
        sa.Column('original', sa.String(500)),
        sa.Column('lang', sa.String(10)),
        sa.Column('gender', sa.String(10)),
        sa.Column('description', sa.Text),
    )
    op.create_index('idx_staff_name', 'staff', ['name'])

    # Create vn_staff table
    op.create_table(
        'vn_staff',
        sa.Column('vn_id', sa.String(10), sa.ForeignKey('visual_novels.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('staff_id', sa.String(10), sa.ForeignKey('staff.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('aid', sa.Integer),
        sa.Column('role', sa.String(50), primary_key=True),
        sa.Column('note', sa.String(500)),
    )
    op.create_index('idx_vn_staff_vn', 'vn_staff', ['vn_id'])
    op.create_index('idx_vn_staff_staff', 'vn_staff', ['staff_id'])
    op.create_index('idx_vn_staff_role', 'vn_staff', ['role'])

    # Create vn_seiyuu table
    op.create_table(
        'vn_seiyuu',
        sa.Column('vn_id', sa.String(10), sa.ForeignKey('visual_novels.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('staff_id', sa.String(10), sa.ForeignKey('staff.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('aid', sa.Integer),
        sa.Column('character_id', sa.String(10), primary_key=True),
        sa.Column('note', sa.String(500)),
    )
    op.create_index('idx_vn_seiyuu_vn', 'vn_seiyuu', ['vn_id'])
    op.create_index('idx_vn_seiyuu_staff', 'vn_seiyuu', ['staff_id'])

    # Create traits table
    op.create_table(
        'traits',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('name', sa.String(200), nullable=False),
        sa.Column('description', sa.Text),
        sa.Column('group_id', sa.Integer),
        sa.Column('group_name', sa.String(200)),
        sa.Column('char_count', sa.Integer, default=0),
        sa.Column('aliases', postgresql.ARRAY(sa.Text)),
        sa.Column('searchable', sa.Boolean, default=True),
        sa.Column('applicable', sa.Boolean, default=True),
    )
    op.create_index('idx_traits_name', 'traits', ['name'])
    op.create_index('idx_traits_group', 'traits', ['group_id'])

    # Create characters table
    op.create_table(
        'characters',
        sa.Column('id', sa.String(10), primary_key=True),
        sa.Column('name', sa.String(500), nullable=False),
        sa.Column('original', sa.String(500)),
    )
    op.create_index('idx_characters_name', 'characters', ['name'])

    # Create character_vn table
    op.create_table(
        'character_vn',
        sa.Column('character_id', sa.String(10), sa.ForeignKey('characters.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('vn_id', sa.String(10), sa.ForeignKey('visual_novels.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('role', sa.String(20)),
        sa.Column('release_id', sa.String(10)),
    )
    op.create_index('idx_character_vn_vn', 'character_vn', ['vn_id'])
    op.create_index('idx_character_vn_char', 'character_vn', ['character_id'])

    # Create character_traits table
    op.create_table(
        'character_traits',
        sa.Column('character_id', sa.String(10), sa.ForeignKey('characters.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('trait_id', sa.Integer, sa.ForeignKey('traits.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('spoiler_level', sa.Integer, default=0),
    )
    op.create_index('idx_character_traits_char', 'character_traits', ['character_id'])
    op.create_index('idx_character_traits_trait', 'character_traits', ['trait_id'])


def downgrade() -> None:
    op.drop_table('character_traits')
    op.drop_table('character_vn')
    op.drop_table('characters')
    op.drop_table('traits')
    op.drop_table('vn_seiyuu')
    op.drop_table('vn_staff')
    op.drop_table('staff')
    op.drop_table('producers')
