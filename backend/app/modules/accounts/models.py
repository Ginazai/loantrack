import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class LoanAccount(Base):
    __tablename__ = "loan_accounts"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    account_name: Mapped[str] = mapped_column(String(255), nullable=False)
    borrower_name: Mapped[str] = mapped_column(String(255), nullable=False)

    # Financial
    borrow_amount: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    rate: Mapped[float] = mapped_column(Numeric(8, 4), nullable=False)  # e.g. 0.05 = 5%

    # Cycle: 15 = closes on 15th/30th bimonthly; 30 = closes on 30th monthly only
    # In practice we always use both 15th and 30th, so this column records the
    # agreed payment frequency for reporting purposes.
    cycle: Mapped[int] = mapped_column(nullable=False, default=15)  # 15 | 30

    # Status: open | active | paid | closed
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="open", index=True)
    close_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    # Relationships
    user: Mapped["User"] = relationship("User", back_populates="loan_accounts")  # noqa: F821
    payments: Mapped[list["Payment"]] = relationship(  # noqa: F821
        "Payment", back_populates="account", cascade="all, delete-orphan",
        order_by="Payment.payment_date"
    )
    webhook_configs: Mapped[list["WebhookConfig"]] = relationship(  # noqa: F821
        "WebhookConfig", back_populates="account", cascade="all, delete-orphan"
    )
