from datetime import date, datetime, timezone
from uuid import UUID

import httpx
from fastapi import HTTPException, status
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.repository import BaseRepository
from app.core.security import generate_webhook_secret, sign_webhook_payload
from app.modules.accounts.interest_engine import get_cycle_dates, project_ledger
from app.modules.accounts.models import LoanAccount
from app.modules.webhooks.models import AccountCycleNotification, WebhookConfig, WebhookEvent
from app.modules.webhooks.schemas import WebhookConfigCreate

settings = get_settings()


class WebhookConfigService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.repo = BaseRepository(WebhookConfig, db)

    async def create(self, account_id: UUID, user_id: UUID, data: WebhookConfigCreate, is_admin: bool = False) -> WebhookConfig:
        account = await self._get_account_or_404(account_id, user_id, is_admin)
        config = WebhookConfig(
            account_id=account.id,
            target_url=str(data.target_url),
            secret_hash=generate_webhook_secret(),
            events=data.events,
        )
        return await self.repo.create(config)

    async def list_for_account(self, account_id: UUID, user_id: UUID, is_admin: bool = False) -> list[WebhookConfig]:
        await self._get_account_or_404(account_id, user_id, is_admin)
        result = await self.db.execute(
            select(WebhookConfig).where(WebhookConfig.account_id == account_id)
        )
        return list(result.scalars().all())

    async def delete(self, webhook_id: UUID, user_id: UUID, is_admin: bool = False) -> None:
        config = await self.repo.get_by_id(webhook_id)
        if not config:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Webhook not found")
        await self._get_account_or_404(config.account_id, user_id, is_admin)
        await self.repo.delete(config)

    async def _get_account_or_404(self, account_id: UUID, user_id: UUID, is_admin: bool = False) -> LoanAccount:
        if is_admin:
            result = await self.db.execute(
                select(LoanAccount).where(LoanAccount.id == account_id)
            )
        else:
            result = await self.db.execute(
                select(LoanAccount).where(
                    and_(LoanAccount.id == account_id, LoanAccount.user_id == user_id)
                )
            )
        account = result.scalar_one_or_none()
        if not account:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Account not found")
        return account


class WebhookDeliveryService:
    """Background retry-loop delivery for pending webhook events."""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def deliver_pending(self) -> None:
        result = await self.db.execute(
            select(WebhookEvent).where(
                and_(
                    WebhookEvent.status == "pending",
                    WebhookEvent.attempt_count < settings.WEBHOOK_MAX_RETRIES,
                )
            )
        )
        events = list(result.scalars().all())
        async with httpx.AsyncClient(timeout=settings.WEBHOOK_TIMEOUT_SECONDS) as client:
            for event in events:
                await self._deliver(client, event)

    async def _deliver(self, client: httpx.AsyncClient, event: WebhookEvent) -> None:
        result = await self.db.execute(
            select(WebhookConfig).where(WebhookConfig.id == event.webhook_id)
        )
        config = result.scalar_one_or_none()
        if not config:
            event.status = "failed"
            return

        signature = sign_webhook_payload(event.payload, config.secret_hash)
        event.attempt_count += 1
        event.last_attempt_at = datetime.now(timezone.utc)

        try:
            resp = await client.post(
                str(config.target_url),
                json=event.payload,
                headers={
                    "X-Webhook-Signature": signature,
                    "X-Webhook-Event": event.event_type,
                    "Content-Type": "application/json",
                },
            )
            event.status = "delivered" if resp.is_success else "pending"
        except Exception:
            event.status = (
                "failed" if event.attempt_count >= settings.WEBHOOK_MAX_RETRIES else "pending"
            )
        await self.db.flush()


def new_cycle_dates(
    start_date: date, already_notified: set[date], until: date
) -> list[date]:
    """Pure function (no DB, no I/O) — which cycle dates for an account,
    up to *until*, have not yet been notified. Reuses the same
    `get_cycle_dates` the rest of the ledger engine relies on, so a
    dormant account with several missed cycles returns all of them in
    date order (ADR-006: no worker, tolerant of infrequent scans).
    """
    return [d for d in get_cycle_dates(start_date, until) if d not in already_notified]


class CycleCloseScanService:
    """Detects cycle closes and enqueues `cycle.closed` webhook events.

    Runs as a periodic in-process asyncio task (see `main.py`,
    `_cycle_close_scan_loop`) — no external worker/queue (ADR-006).
    Delivery itself is unchanged: this only inserts `WebhookEvent` rows
    that `WebhookDeliveryService` already knows how to send/retry.
    """

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def scan(self, today: date | None = None) -> int:
        """Returns the number of `cycle.closed` events enqueued."""
        today = today or datetime.now(timezone.utc).date()

        accounts_result = await self.db.execute(
            select(LoanAccount).where(LoanAccount.status.in_(["open", "active"]))
        )
        accounts = list(accounts_result.scalars().all())
        if not accounts:
            return 0

        enqueued = 0
        for account in accounts:
            enqueued += await self._scan_account(account, today)
        await self.db.flush()
        return enqueued

    async def _scan_account(self, account: LoanAccount, today: date) -> int:
        notified_result = await self.db.execute(
            select(AccountCycleNotification.cycle_date).where(
                AccountCycleNotification.account_id == account.id
            )
        )
        already_notified = {row[0] for row in notified_result.all()}
        pending_dates = new_cycle_dates(account.start_date, already_notified, today)
        if not pending_dates:
            return 0

        configs_result = await self.db.execute(
            select(WebhookConfig).where(
                and_(
                    WebhookConfig.is_active.is_(True),
                    or_(
                        WebhookConfig.account_id == account.id,
                        WebhookConfig.account_id.is_(None),
                    ),
                )
            )
        )
        configs = [
            c for c in configs_result.scalars().all() if "cycle.closed" in (c.events or [])
        ]

        # Historical payments feed project_ledger so the payload carries a
        # real balance snapshot, not just "a cycle date passed".
        from app.modules.payments.models import Payment  # local import avoids a cycle

        payments_rows = await self.db.execute(
            select(Payment.payment_date, Payment.amount).where(Payment.account_id == account.id)
        )
        payment_tuples = [(row.payment_date, float(row.amount)) for row in payments_rows.all()]

        for cycle_date in pending_dates:
            self.db.add(
                AccountCycleNotification(account_id=account.id, cycle_date=cycle_date)
            )

            rows = project_ledger(
                float(account.borrow_amount),
                float(account.rate),
                account.start_date,
                payment_tuples,
                until=cycle_date,
            )
            row = next((r for r in rows if r.cycle_date == cycle_date), None)
            payload = {
                "event": "cycle.closed",
                "account_id": str(account.id),
                "cycle_date": str(cycle_date),
                "opening_balance": str(row.opening_balance) if row else None,
                "interests_accrued": str(row.interests_accrued) if row else None,
                "closing_balance": str(row.closing_balance) if row else None,
            }
            for config in configs:
                self.db.add(
                    WebhookEvent(
                        webhook_id=config.id,
                        event_type="cycle.closed",
                        payload=payload,
                        status="pending",
                    )
                )
        return len(pending_dates)
