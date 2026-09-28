"""add import_batches and import_rows tables

Revision ID: 005
Revises: 004
Create Date: 2026-09-23 00:10:00.000000
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "005"
down_revision = "004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "import_batches",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("source_filename", sa.String(255), nullable=False),
        sa.Column("format", sa.String(50), nullable=False),
        sa.Column("raw_content", sa.LargeBinary, nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="previewed"),
        sa.Column(
            "created_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("summary", postgresql.JSON, nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("committed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_import_batches_status", "import_batches", ["status"])

    op.create_table(
        "import_rows",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "batch_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("import_batches.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("row_number", sa.Integer, nullable=True),
        sa.Column("interpretation", sa.String(50), nullable=False),
        sa.Column("result", sa.String(20), nullable=False, server_default="ok"),
        sa.Column(
            "created_account_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("loan_accounts.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_payment_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("payments.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("error_message", sa.Text, nullable=True),
    )
    op.create_index("ix_import_rows_batch_id", "import_rows", ["batch_id"])


def downgrade() -> None:
    op.drop_table("import_rows")
    op.drop_table("import_batches")
