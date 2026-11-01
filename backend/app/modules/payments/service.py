from decimal import ROUND_HALF_UP, Decimal
from uuid import UUID

from fastapi import HTTPException, UploadFile, status
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.http import sanitize_filename
from app.core.repository import BaseRepository
from app.core.uploads import read_upload_capped
from app.modules.accounts.interest_engine import (
    advance_cycle,
    get_next_due_date,
    next_cycle_date,
    project_ledger,
)
from app.modules.accounts.models import LoanAccount
from app.modules.audit.service import AuditService
from app.modules.payments.models import Payment, PaymentAttachment
from app.modules.payments.schemas import (
    MAX_ATTACHMENT_SIZE_BYTES,
    PaymentCreate,
    sniff_attachment_type,
    validate_attachment,
)
from app.modules.webhooks.models import WebhookConfig, WebhookEvent


def _round2(v: Decimal) -> Decimal:
    return v.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


class PaymentService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.repo = BaseRepository(Payment, db)
        self.audit = AuditService(db)

    async def _get_account_or_404(
        self, account_id: UUID, user_id: UUID, is_admin: bool = False
    ) -> LoanAccount:
        if is_admin:
            result = await self.db.execute(select(LoanAccount).where(LoanAccount.id == account_id))
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

    async def _get_payment_or_404(self, account_id: UUID, payment_id: UUID) -> Payment:
        result = await self.db.execute(
            select(Payment)
            .options(selectinload(Payment.attachments))
            .where(and_(Payment.id == payment_id, Payment.account_id == account_id))
        )
        payment = result.scalar_one_or_none()
        if not payment:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Payment not found")
        return payment

    async def get_for_account(self, account_id: UUID) -> list[Payment]:
        result = await self.db.execute(
            select(Payment)
            .options(selectinload(Payment.attachments))
            .where(Payment.account_id == account_id)
            .order_by(Payment.payment_date)
        )
        payments = list(result.scalars().all())
        for p in payments:
            p.attachment_count = len(p.attachments)  # transient, not a mapped column
        return payments

    async def add_payment(
        self,
        account_id: UUID,
        user_id: UUID,
        data: PaymentCreate,
        ip: str | None = None,
        is_admin: bool = False,
    ) -> Payment:
        account = await self._get_account_or_404(account_id, user_id, is_admin)
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
            payment_tuples,  # existing payments only (not this new one)
            until=payment_date,  # include the payment's cycle
        )

        if rows and rows[-1].cycle_date == payment_date:
            # Payment lands on a cycle date — standard case
            current_row = rows[-1]
            balance_before = current_row.opening_balance  # before this cycle's interest
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
        payment.attachment_count = 0

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
            user_id,
            "payment",
            str(payment.id),
            "create",
            after={"amount": str(payment_amount), "balance_after": str(balance_after)},
            ip=ip,
        )

        # Fire per-account and global webhooks for payment.added.
        # NOTE: payments created via bulk import (method="import") never reach
        # this code path — the imports service inserts Payment rows directly
        # and deliberately skips webhook notification (see ADR-004).
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

    async def list_payments(
        self, account_id: UUID, user_id: UUID, is_admin: bool = False
    ) -> list[Payment]:
        await self._get_account_or_404(account_id, user_id, is_admin)
        return await self.get_for_account(account_id)

    async def delete_payment(self, account_id: UUID, payment_id: UUID, user_id: UUID) -> None:
        """Admin-only — see router.py. Deleting a payment changes the
        historical sequence of events for this account, so every payment
        after it (if any) needs its stored balance snapshot recomputed —
        see recalculate_ledger() for why this doesn't contradict payments
        being otherwise immutable.
        """
        payment = await self._get_payment_or_404(account_id, payment_id)
        deleted_snapshot = {
            "amount": str(payment.amount),
            "payment_date": str(payment.payment_date),
        }
        await self.db.delete(payment)
        await self.db.flush()

        await self.recalculate_ledger(account_id)

        await self.audit.log(
            user_id,
            "payment",
            str(payment_id),
            "delete",
            before=deleted_snapshot,
        )

    async def recalculate_ledger(self, account_id: UUID) -> None:
        """Re-derive balance_before/interests_accrued/balance_after/next_due_date
        for every remaining payment of an account, in date order, and correct
        the account's status to match.

        Payment snapshots are immutable with respect to *future* changes —
        e.g. today's rate changing doesn't retroactively rewrite old payments
        (ADR-003). But they are NOT immutable with respect to a change in the
        payment *history itself*. If a payment is deleted, every payment
        recorded after it was computed against a "balance so far" that no
        longer reflects what actually happened — those stored snapshots are
        now provably wrong, not merely stale. This replays the remaining
        history the same way add_payment() computes it live, and is the only
        way to keep the ledger internally consistent after a deletion.

        Call this inside the SAME transaction as whatever changed the
        payment history, before commit — see delete_payment in router.py.
        """
        account_result = await self.db.execute(
            select(LoanAccount).where(LoanAccount.id == account_id)
        )
        account = account_result.scalar_one_or_none()
        if not account:
            return

        result = await self.db.execute(
            select(Payment).where(Payment.account_id == account_id).order_by(Payment.payment_date)
        )
        payments = list(result.scalars().all())

        if not payments:
            # No history left at all — back to a fresh, unpaid account,
            # unless it was manually closed (a manual close is never
            # auto-reopened by a ledger recalculation).
            if account.status != "closed":
                account.status = "open"
            await self.db.flush()
            return

        history: list[tuple] = []  # (payment_date, amount) replayed so far
        final_balance = Decimal(str(account.borrow_amount))

        for payment in payments:
            rows = project_ledger(
                float(account.borrow_amount),
                float(account.rate),
                account.start_date,
                history,
                until=payment.payment_date,
            )
            if rows and rows[-1].cycle_date == payment.payment_date:
                balance_before = rows[-1].opening_balance
                interests_accrued = rows[-1].interests_accrued
            elif rows:
                balance_before = rows[-1].closing_balance
                interests_accrued = Decimal("0.00")
            else:
                balance_before = Decimal(str(account.borrow_amount))
                interests_accrued = Decimal("0.00")

            balance_after = _round2(balance_before + interests_accrued - payment.amount)

            payment.balance_before = balance_before
            payment.interests_accrued = interests_accrued
            payment.balance_after = balance_after
            payment.next_due_date = get_next_due_date(payment.payment_date)

            history.append((payment.payment_date, float(payment.amount)))
            final_balance = balance_after

        if account.status != "closed":
            account.status = "paid" if final_balance <= Decimal("0.00") else "active"

        await self.db.flush()

    # ── Attachments ──────────────────────────────────────────────────────────

    async def add_attachment(
        self,
        account_id: UUID,
        payment_id: UUID,
        user_id: UUID,
        file: UploadFile,
        is_admin: bool = False,
    ) -> PaymentAttachment:
        await self._get_account_or_404(account_id, user_id, is_admin)
        payment = await self._get_payment_or_404(account_id, payment_id)

        # Stream with a hard cap (an oversize upload is refused after one chunk past the
        # limit, not after it has all been loaded), then trust the bytes, not the label.
        data = await read_upload_capped(file, MAX_ATTACHMENT_SIZE_BYTES)
        content_type = sniff_attachment_type(data)
        if content_type is None:
            if not data:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "Empty file")
            raise HTTPException(
                status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                "File content is not a supported type (JPEG, PNG, WebP or PDF).",
            )
        try:
            validate_attachment(content_type, len(data))
        except ValueError as exc:  # unreachable in practice; kept as the single source of rules
            raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))

        attachment = PaymentAttachment(
            payment_id=payment.id,
            original_filename=sanitize_filename(file.filename, default="attachment"),
            content_type=content_type,
            size_bytes=len(data),
            content=data,
            uploaded_by=user_id,
        )
        self.db.add(attachment)
        await self.db.flush()
        await self.db.refresh(attachment)

        await self.audit.log(
            user_id,
            "payment_attachment",
            str(attachment.id),
            "create",
            after={"payment_id": str(payment_id), "filename": attachment.original_filename},
        )
        return attachment

    async def list_attachments(
        self, account_id: UUID, payment_id: UUID, user_id: UUID, is_admin: bool = False
    ) -> list[PaymentAttachment]:
        await self._get_account_or_404(account_id, user_id, is_admin)
        payment = await self._get_payment_or_404(account_id, payment_id)
        return payment.attachments

    async def get_attachment(
        self,
        account_id: UUID,
        payment_id: UUID,
        attachment_id: UUID,
        user_id: UUID,
        is_admin: bool = False,
    ) -> PaymentAttachment:
        await self._get_account_or_404(account_id, user_id, is_admin)
        await self._get_payment_or_404(account_id, payment_id)
        result = await self.db.execute(
            select(PaymentAttachment).where(
                and_(
                    PaymentAttachment.id == attachment_id,
                    PaymentAttachment.payment_id == payment_id,
                )
            )
        )
        attachment = result.scalar_one_or_none()
        if not attachment:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Attachment not found")
        return attachment

    async def delete_attachment(
        self,
        account_id: UUID,
        payment_id: UUID,
        attachment_id: UUID,
        user_id: UUID,
    ) -> None:
        """Admin-only — same policy as deleting a payment itself."""
        attachment = await self.get_attachment(
            account_id, payment_id, attachment_id, user_id, is_admin=True
        )
        await self.db.delete(attachment)
        await self.db.flush()
        await self.audit.log(
            user_id,
            "payment_attachment",
            str(attachment_id),
            "delete",
        )
