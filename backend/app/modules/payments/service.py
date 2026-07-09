from decimal import ROUND_HALF_UP, Decimal
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.accounts.interest_engine import (
    advance_cycle,
    get_next_due_date,
    next_cycle_date,
    project_ledger,
)
from app.core.repository import BaseRepository
from app.modules.accounts.models import LoanAccount
from app.modules.audit.service import AuditService
from app.modules.payments.models import Payment
from app.modules.payments.schemas import PaymentCreate
from app.modules.webhooks.models import WebhookConfig, WebhookEvent


def _round2(v: Decimal) -> Decimal:
    return v.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


class PaymentService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.repo = BaseRepository(Payment, db)
        self.audit = AuditService(db)

    async def get_for_account(self, account_id: UUID) -> list[Payment]:
        result = await self.db.execute(
            select(Payment)
            .where(Payment.account_id == account_id)
            .order_by(Payment.payment_date)
        )
        return list(result.scalars().all())

    async def add_payment(
        self,
        account_id: UUID,
        user_id: UUID,
        data: PaymentCreate,
        ip: str | None = None,
    ) -> Payment:
        result = await self.db.execute(
            select(LoanAccount).where(
                and_(LoanAccount.id == account_id, LoanAccount.user_id == user_id)
            )
        )
        account = result.scalar_one_or_none()
        if not account:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Account not found")
        if account.status in ("paid", "closed"):
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"Cannot add payment to a {account.status} account",
            )

        existing = await self.get_for_account(account_id)
        payment_tuples = [(p.payment_date, float(p.amount)) for p in existing]
        last = existing[-1] if existing else None
        last_cycle = last.payment_date if last else None

        # Resolve payment date: auto picks the next cycle date
        payment_date = data.payment_date
        if payment_date is None or data.method == "auto":
            ref = last_cycle if last_cycle else account.start_date
            payment_date = next_cycle_date(ref)
            if payment_date <= (last_cycle or account.start_date):
                payment_date = advance_cycle(payment_date)

        # ── Correct interest calculation ──────────────────────────────────────
        # Use project_ledger to get the authoritative balance at payment_date.
        # This avoids double-counting interest: project_ledger applies interest
        # once per cycle in the correct order rather than adding it on top of a
        # balance that already includes this cycle's interest.
        rows = project_ledger(
            float(account.borrow_amount),
            float(account.rate),
            account.start_date,
            payment_tuples,        # existing payments only (not this new one)
            until=payment_date,    # include the payment's cycle
        )

        if rows and rows[-1].cycle_date == payment_date:
            # Payment lands on a cycle date — standard case
            current_row = rows[-1]
            balance_before = current_row.opening_balance   # before this cycle's interest
            interests_accrued = current_row.interests_accrued
        elif rows:
            # Between cycles — no interest accrues until the next cycle date
            balance_before = rows[-1].closing_balance
            interests_accrued = Decimal("0.00")
        else:
            # Before any cycle — no interest yet
            balance_before = Decimal(str(account.borrow_amount))
            interests_accrued = Decimal("0.00")

        payment_amount = _round2(Decimal(str(data.amount)))
        balance_after = _round2(balance_before + interests_accrued - payment_amount)
        next_due = get_next_due_date(payment_date)

        payment = Payment(
            account_id=account_id,
            amount=payment_amount,
            balance_before=balance_before,
            interests_accrued=interests_accrued,
            balance_after=balance_after,
            payment_date=payment_date,
            next_due_date=next_due,
            method=data.method,
        )
        payment = await self.repo.create(payment)

        # Status transitions
        new_status = account.status
        if account.status == "open":
            new_status = "active"
        if balance_after <= Decimal("0.00"):
            new_status = "paid"

        if new_status != account.status:
            account.status = new_status
            await self.repo.flush()

        await self.audit.log(
            user_id, "payment", str(payment.id), "create",
            after={"amount": str(payment_amount), "balance_after": str(balance_after)},
            ip=ip,
        )

        # Fire per-account and global webhooks for payment.added
        wh_result = await self.db.execute(
            select(WebhookConfig).where(
                and_(
                    WebhookConfig.is_active.is_(True),
                    or_(
                        WebhookConfig.account_id == account_id,
                        WebhookConfig.account_id.is_(None),
                    ),
                )
            )
        )
        configs = [c for c in wh_result.scalars().all() if "payment.added" in (c.events or [])]
        for config in configs:
            ev = WebhookEvent(
                webhook_id=config.id,
                event_type="payment.added",
                payload={
                    "event": "payment.added",
                    "account_id": str(account_id),
                    "payment_id": str(payment.id),
                    "amount": str(payment_amount),
                    "balance_before": str(balance_before),
                    "interests_accrued": str(interests_accrued),
                    "balance_after": str(balance_after),
                    "payment_date": str(payment_date),
                },
                status="pending",
            )
            self.db.add(ev)
        await self.db.flush()

        return payment

    async def list_payments(self, account_id: UUID, user_id: UUID) -> list[Payment]:
        result = await self.db.execute(
            select(LoanAccount).where(
                and_(LoanAccount.id == account_id, LoanAccount.user_id == user_id)
            )
        )
        account = result.scalar_one_or_none()
        if not account:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Account not found")
        return await self.get_for_account(account_id)
