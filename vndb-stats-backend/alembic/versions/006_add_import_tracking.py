"""Add import tracking tables for admin monitoring.

Revision ID: 006_add_import_tracking
Revises: 005_add_recommendation_tables
Create Date: 2025-01-20

This migration adds:
- import_runs table for tracking each import pipeline execution
- import_logs table for detailed log entries during imports
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic.
revision: str = '006_add_import_tracking'
down_revision: Union[str, None] = '005_add_recommendation_tables'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create import_runs table for tracking import executions
    op.create_table(
        'import_runs',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('status', sa.String(20), nullable=False, server_default='pending'),
        sa.Column('phase', sa.String(100), nullable=True),
        sa.Column('current_step', sa.Integer, server_default='0'),
        sa.Column('total_steps', sa.Integer, server_default='21'),
        sa.Column('progress_percent', sa.Float, server_default='0.0'),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('ended_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('error_message', sa.Text, nullable=True),
        sa.Column('triggered_by', sa.String(50), server_default='scheduled'),
        sa.Column('stats_json', JSONB, nullable=True),
    )

    # Indexes for import_runs
    op.create_index('idx_import_runs_status', 'import_runs', ['status'])
    op.create_index('idx_import_runs_started', 'import_runs', [sa.text('started_at DESC')])

    # Create import_logs table for detailed logging
    op.create_table(
        'import_logs',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('run_id', sa.Integer, sa.ForeignKey('import_runs.id', ondelete='CASCADE'), nullable=False),
        sa.Column('timestamp', sa.DateTime(timezone=True), nullable=False),
        sa.Column('level', sa.String(10), nullable=False),
        sa.Column('message', sa.Text, nullable=False),
        sa.Column('phase', sa.String(100), nullable=True),
        sa.Column('extra_data', JSONB, nullable=True),
    )

    # Indexes for import_logs
    op.create_index('idx_import_logs_run', 'import_logs', ['run_id'])
    op.create_index('idx_import_logs_level', 'import_logs', ['level'])
    op.create_index('idx_import_logs_timestamp', 'import_logs', ['timestamp'])


def downgrade() -> None:
    op.drop_table('import_logs')
    op.drop_table('import_runs')
