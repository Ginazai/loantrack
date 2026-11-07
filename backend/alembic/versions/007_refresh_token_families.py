"""refresh_tokens: token families + revocation reason (reuse detection)

Each login starts a *family*; every rotation of a refresh token stays in that family. If a
token that was already rotated away is presented again (after a short grace window) the whole
family is revoked: either the legitimate client or a thief is replaying it, and we cannot tell
which, so both are made to sign in again.

`revoked_reason` lets that check tell "rotated" (replay = suspicious) from "logout",
"password" or "deactivated" (replay = just an old token).

Existing rows: each becomes its own one-token family (family_id = id), which is safe because
reuse detection only ever *adds* revocations for tokens flagged "rotated"; legacy rows have no
reason and are only ever rejected.

Revision ID: 007
Revises: 006
Create Date: 2026-11-01 00:00:00.000000
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "007"
down_revision = "006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "refresh_tokens", sa.Column("family_id", postgresql.UUID(as_uuid=True), nullable=True)
    )
    op.execute("UPDATE refresh_tokens SET family_id = id")
    op.alter_column("refresh_tokens", "family_id", nullable=False)
    op.create_index("ix_refresh_tokens_family_id", "refresh_tokens", ["family_id"])
    op.add_column(
        "refresh_tokens", sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column("refresh_tokens", sa.Column("revoked_reason", sa.String(20), nullable=True))


def downgrade() -> None:
    op.drop_column("refresh_tokens", "revoked_reason")
    op.drop_column("refresh_tokens", "revoked_at")
    op.drop_index("ix_refresh_tokens_family_id", table_name="refresh_tokens")
    op.drop_column("refresh_tokens", "family_id")
