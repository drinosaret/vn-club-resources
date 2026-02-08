"""Add app_logs table for general application logging.

Revision ID: 007_add_app_logs
Revises: 006_add_import_tracking
Create Date: 2025-01-20

This migration adds:
- app_logs table for storing backend and frontend application logs
- Indexes for efficient querying by timestamp, level, source, and error_hash
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic.
revision: str = '007_add_app_logs'
down_revision: Union[str, None] = '006_add_import_tracking'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create app_logs table for general application logging
    op.create_table(
        'app_logs',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('timestamp', sa.DateTime(timezone=True), nullable=False),
        sa.Column('level', sa.String(10), nullable=False),  # DEBUG, INFO, WARNING, ERROR
        sa.Column('source', sa.String(20), nullable=False),  # backend, frontend
        sa.Column('module', sa.String(200), nullable=True),  # Logger name / component
        sa.Column('message', sa.Text, nullable=False),

        # Frontend-specific fields
        sa.Column('url', sa.String(500), nullable=True),
        sa.Column('user_agent', sa.String(500), nullable=True),
        sa.Column('stack_trace', sa.Text, nullable=True),

        # Error grouping for deduplication
        sa.Column('error_hash', sa.String(64), nullable=True),
        sa.Column('occurrence_count', sa.Integer, server_default='1'),
        sa.Column('first_seen', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_seen', sa.DateTime(timezone=True), nullable=True),

        # Extra context
        sa.Column('extra_data', JSONB, nullable=True),
    )

    # Indexes for efficient querying
    op.create_index('idx_app_logs_timestamp', 'app_logs', [sa.text('timestamp DESC')])
    op.create_index('idx_app_logs_source_level', 'app_logs', ['source', 'level'])
    op.create_index('idx_app_logs_level', 'app_logs', ['level'])
    op.create_index('idx_app_logs_source', 'app_logs', ['source'])
    op.create_index('idx_app_logs_error_hash', 'app_logs', ['error_hash'])


def downgrade() -> None:
    op.drop_table('app_logs')
