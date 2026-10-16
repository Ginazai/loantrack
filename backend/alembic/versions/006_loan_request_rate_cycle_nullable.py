"""loan_requests.rate/cycle become nullable — set at approval, not request

Borrowers no longer submit a rate or payment cycle when requesting a loan;
the admin sets both at approval time (see LoanRequestReview). A pending/
rejected request now legitimately has no rate or cycle at all.

Revision ID: 006
Revises: 005
Create Date: 2026-10-04 00:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

revision = "006"
down_revision = "005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("loan_requests", "rate", existing_type=sa.Numeric(8, 4), nullable=True)
    op.alter_column("loan_requests", "cycle", existing_type=sa.Integer(), nullable=True)


def downgrade() -> None:
    # Any existing NULL rows would violate the NOT NULL constraint being
    # restored — this only matters for a downgrade applied to a database
    # that already has approved-with-nulls-filled vs. still-pending rows;
    # left as a manual cleanup step rather than guessing a default here.
    op.alter_column("loan_requests", "rate", existing_type=sa.Numeric(8, 4), nullable=False)
    op.alter_column("loan_requests", "cycle", existing_type=sa.Integer(), nullable=False)
