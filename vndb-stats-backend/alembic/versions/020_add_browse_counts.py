"""Add precomputed browse columns to staff and producers.

Revision ID: 020_add_browse_counts
Revises: 019_add_vn_relations
Create Date: 2026-02-07

Adds vn_count, roles, seiyuu counts to staff table and vn_count variants
to producers table. These precomputed columns eliminate expensive subquery
joins in browse endpoints, matching the pattern Tags (vn_count) and
Traits (char_count) already use.

Also adds missing indexes on filter columns (lang, gender, type).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '020_add_browse_counts'
down_revision: Union[str, None] = '019_add_vn_relations'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ---- Staff columns ----
    op.execute(sa.text(
        "ALTER TABLE staff ADD COLUMN IF NOT EXISTS vn_count INTEGER DEFAULT 0"
    ))
    op.execute(sa.text(
        "ALTER TABLE staff ADD COLUMN IF NOT EXISTS roles TEXT[]"
    ))
    op.execute(sa.text(
        "ALTER TABLE staff ADD COLUMN IF NOT EXISTS seiyuu_vn_count INTEGER DEFAULT 0"
    ))
    op.execute(sa.text(
        "ALTER TABLE staff ADD COLUMN IF NOT EXISTS seiyuu_char_count INTEGER DEFAULT 0"
    ))

    # ---- Producer columns ----
    op.execute(sa.text(
        "ALTER TABLE producers ADD COLUMN IF NOT EXISTS vn_count INTEGER DEFAULT 0"
    ))
    op.execute(sa.text(
        "ALTER TABLE producers ADD COLUMN IF NOT EXISTS dev_vn_count INTEGER DEFAULT 0"
    ))
    op.execute(sa.text(
        "ALTER TABLE producers ADD COLUMN IF NOT EXISTS pub_vn_count INTEGER DEFAULT 0"
    ))

    # ---- Staff indexes ----
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS idx_staff_lang ON staff (lang)"
    ))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS idx_staff_gender ON staff (gender)"
    ))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS idx_staff_vn_count ON staff (vn_count DESC NULLS LAST)"
    ))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS idx_staff_seiyuu_vn_count ON staff (seiyuu_vn_count DESC NULLS LAST)"
    ))

    # ---- Producer indexes ----
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS idx_producers_type ON producers (type)"
    ))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS idx_producers_lang ON producers (lang)"
    ))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS idx_producers_vn_count ON producers (vn_count DESC NULLS LAST)"
    ))


def downgrade() -> None:
    # Drop indexes
    op.execute(sa.text("DROP INDEX IF EXISTS idx_producers_vn_count"))
    op.execute(sa.text("DROP INDEX IF EXISTS idx_producers_lang"))
    op.execute(sa.text("DROP INDEX IF EXISTS idx_producers_type"))
    op.execute(sa.text("DROP INDEX IF EXISTS idx_staff_seiyuu_vn_count"))
    op.execute(sa.text("DROP INDEX IF EXISTS idx_staff_vn_count"))
    op.execute(sa.text("DROP INDEX IF EXISTS idx_staff_gender"))
    op.execute(sa.text("DROP INDEX IF EXISTS idx_staff_lang"))

    # Drop columns
    op.drop_column('producers', 'pub_vn_count')
    op.drop_column('producers', 'dev_vn_count')
    op.drop_column('producers', 'vn_count')
    op.drop_column('staff', 'seiyuu_char_count')
    op.drop_column('staff', 'seiyuu_vn_count')
    op.drop_column('staff', 'roles')
    op.drop_column('staff', 'vn_count')
