"""add loan_requests table

Revision ID: 002
Revises: 001
Create Date: 2026-06-15 00:00:00.000000
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "002"
down_revision = "001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "loan_requests",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("account_name", sa.String(255), nullable=False),
        sa.Column("borrow_amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("rate", sa.Numeric(8, 4), nullable=False),
        sa.Column("cycle", sa.Integer, nullable=False, server_default="15"),
        sa.Column("reason", sa.Text, nullable=True),
        sa.Column("status", sa.String(30), nullable=False, server_default="requested"),
        sa.Column("rejection_reason", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_loan_requests_user_id", "loan_requests", ["user_id"])
    op.create_index("ix_loan_requests_status", "loan_requests", ["status"])


def downgrade() -> None:
    op.drop_table("loan_requests")
