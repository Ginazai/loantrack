import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSON, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class WebhookConfig(Base):
    __tablename__ = "webhook_configs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    # Nullable: NULL = global webhook (admin-level, fires for all accounts)
    account_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("loan_accounts.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    target_url: Mapped[str] = mapped_column(Text, nullable=False)
    secret_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    events: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    account: Mapped["LoanAccount | None"] = relationship(  # noqa: F821
        "LoanAccount", back_populates="webhook_configs"
    )
    events_log: Mapped[list["WebhookEvent"]] = relationship(
        "WebhookEvent", back_populates="webhook", cascade="all, delete-orphan"
    )


class WebhookEvent(Base):
    __tablename__ = "webhook_events"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    webhook_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("webhook_configs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    event_type: Mapped[str] = mapped_column(String(50), nullable=False)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    attempt_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="pending", nullable=False, index=True)
    last_attempt_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    webhook: Mapped["WebhookConfig"] = relationship(
        "WebhookConfig", back_populates="events_log"
    )


class AccountCycleNotification(Base):
    """Idempotency ledger for the `cycle.closed` webhook (ADR-006).

    One row per (account_id, cycle_date) that has already been notified.
    The scan loop inserts a row here in the same transaction as the
    WebhookEvent it enqueues, so a re-run (or a backlog of several missed
    cycles on a dormant account) never double-fires.
    """

    __tablename__ = "account_cycle_notifications"
    __table_args__ = (
        UniqueConstraint("account_id", "cycle_date", name="uq_account_cycle_notification"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("loan_accounts.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    cycle_date: Mapped[date] = mapped_column(Date, nullable=False)
    notified_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
