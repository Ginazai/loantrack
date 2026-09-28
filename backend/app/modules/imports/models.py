import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, LargeBinary, String, Text, func
from sqlalchemy.dialects.postgresql import JSON, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class ImportBatch(Base):
    """One upload, previewed and/or committed. See ADR-004."""

    __tablename__ = "import_batches"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    source_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    format: Mapped[str] = mapped_column(String(50), nullable=False)
    # Raw upload, kept so `commit()` re-parses from the source of truth
    # instead of trusting whatever the client echoes back with its mapping
    # choices — same bytea approach as payment attachments (ADR-005).
    raw_content: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    # previewed -> committed | failed
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="previewed", index=True)
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    summary: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    committed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    rows: Mapped[list["ImportRow"]] = relationship(
        "ImportRow", back_populates="batch", cascade="all, delete-orphan"
    )


class ImportRow(Base):
    """Row-level detail — what a source row was interpreted as, and what
    happened to it on commit. Kept even for error rows (R1.5/R1.7): this is
    the audit trail for "why did this line not get imported"."""

    __tablename__ = "import_rows"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    batch_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("import_batches.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    row_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    interpretation: Mapped[str] = mapped_column(String(50), nullable=False)
    # ok | error | skipped
    result: Mapped[str] = mapped_column(String(20), nullable=False, default="ok")
    created_account_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("loan_accounts.id", ondelete="SET NULL"), nullable=True
    )
    created_payment_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("payments.id", ondelete="SET NULL"), nullable=True
    )
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    batch: Mapped["ImportBatch"] = relationship("ImportBatch", back_populates="rows")
