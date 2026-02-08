"""Enhance blacklist rules with multi-tag and age conditions.

Revision ID: 018_enhance_blacklist_rules
Revises: 017_drop_admin_users
Create Date: 2026-02-05

This migration:
- Makes tag_id nullable (allows age-only rules)
- Adds tag_id_2, tag_id_3 for multi-tag AND logic
- Adds age_condition column for 18+ filtering
- Adds CHECK constraint requiring at least one condition
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '018_enhance_blacklist_rules'
down_revision: Union[str, None] = '017_drop_admin_users'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Make tag_id nullable (for age-only rules)
    op.alter_column(
        'cover_blacklist_config',
        'tag_id',
        existing_type=sa.Integer(),
        nullable=True,
    )

    # 2. Add tag_id_2 column with FK
    op.add_column(
        'cover_blacklist_config',
        sa.Column('tag_id_2', sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        'fk_blacklist_config_tag2',
        'cover_blacklist_config',
        'tags',
        ['tag_id_2'],
        ['id'],
        ondelete='CASCADE',
    )

    # 3. Add tag_id_3 column with FK
    op.add_column(
        'cover_blacklist_config',
        sa.Column('tag_id_3', sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        'fk_blacklist_config_tag3',
        'cover_blacklist_config',
        'tags',
        ['tag_id_3'],
        ['id'],
        ondelete='CASCADE',
    )

    # 4. Add age_condition column
    op.add_column(
        'cover_blacklist_config',
        sa.Column('age_condition', sa.String(20), nullable=True),
    )

    # 5. Add CHECK constraint: at least one condition required
    op.create_check_constraint(
        'ck_blacklist_config_has_condition',
        'cover_blacklist_config',
        'tag_id IS NOT NULL OR age_condition IS NOT NULL',
    )


def downgrade() -> None:
    # Remove CHECK constraint
    op.drop_constraint('ck_blacklist_config_has_condition', 'cover_blacklist_config')

    # Remove new columns
    op.drop_column('cover_blacklist_config', 'age_condition')
    op.drop_constraint('fk_blacklist_config_tag3', 'cover_blacklist_config', type_='foreignkey')
    op.drop_column('cover_blacklist_config', 'tag_id_3')
    op.drop_constraint('fk_blacklist_config_tag2', 'cover_blacklist_config', type_='foreignkey')
    op.drop_column('cover_blacklist_config', 'tag_id_2')

    # Restore tag_id NOT NULL (first remove any age-only rules that have NULL tag_id)
    op.execute(sa.text(
        "DELETE FROM cover_blacklist_config WHERE tag_id IS NULL"
    ))
    op.alter_column(
        'cover_blacklist_config',
        'tag_id',
        existing_type=sa.Integer(),
        nullable=False,
    )
