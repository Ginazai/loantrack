import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class LoanRequest(Base):
    __tablename__ = "loan_requests"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    account_name: Mapped[str] = mapped_column(String(255), nullable=False)
    borrow_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    # Set by the admin at approval time, not by the borrower at request
    # time — null until the request is approved. See LoanRequestReview.
    rate: Mapped[Decimal | None] = mapped_column(Numeric(8, 4), nullable=True)
    cycle: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    # requested → under_review → approved | rejected
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="requested", index=True)
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped["User"] = relationship("User")  # noqa: F821
