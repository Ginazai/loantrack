"""add account_cycle_notifications table + cycle.closed webhook event

Revision ID: 004
Revises: 003
Create Date: 2026-09-23 00:05:00.000000
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "004"
down_revision = "003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "account_cycle_notifications",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "account_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("loan_accounts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("cycle_date", sa.Date, nullable=False),
        sa.Column("notified_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("account_id", "cycle_date", name="uq_account_cycle_notification"),
    )
    op.create_index(
        "ix_account_cycle_notifications_account_id", "account_cycle_notifications", ["account_id"]
    )


def downgrade() -> None:
    op.drop_table("account_cycle_notifications")
