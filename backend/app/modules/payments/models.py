import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Integer, LargeBinary, Numeric, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Payment(Base):
    __tablename__ = "payments"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("loan_accounts.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Ledger snapshot — computed at insert time, never recalculated
    amount: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    balance_before: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    interests_accrued: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    balance_after: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)

    payment_date: Mapped[date] = mapped_column(Date, nullable=False)
    next_due_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # auto = system picked the next 15th or 30th; manual = user chose the date;
    # import = created by a bulk data import (see modules/imports)
    method: Mapped[str] = mapped_column(String(10), nullable=False, default="auto")

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Relationships
    account: Mapped["LoanAccount"] = relationship(  # noqa: F821
        "LoanAccount", back_populates="payments"
    )
    attachments: Mapped[list["PaymentAttachment"]] = relationship(
        "PaymentAttachment", back_populates="payment", cascade="all, delete-orphan",
        order_by="PaymentAttachment.created_at",
    )


class PaymentAttachment(Base):
    """A receipt/proof file attached to a payment.

    Stored as `content: bytea` inside PostgreSQL (see ADR-005) — no local
    disk volume, no external object storage. Deliberate for a single-tenant
    tool at this scale: it rides along with normal DB backups for free and
    keeps the deployment target (including a managed Postgres like
    Supabase's) unconstrained by container-local disk.
    """

    __tablename__ = "payment_attachments"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    payment_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("payments.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str] = mapped_column(String(100), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    uploaded_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    payment: Mapped["Payment"] = relationship("Payment", back_populates="attachments")

