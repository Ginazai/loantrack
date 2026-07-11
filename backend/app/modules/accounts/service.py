from datetime import date
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.accounts.interest_engine import compute_current_balance, next_cycle_date, upcoming_cycle_dates
from app.core.repository import BaseRepository
from app.modules.accounts.models import LoanAccount
from app.modules.accounts.schemas import (
    LoanAccountClose,
    LoanAccountCreate,
    LoanAccountFilter,
    LoanAccountUpdate,
)
from app.modules.audit.service import AuditService
from app.modules.payments.service import PaymentService
from app.modules.webhooks.models import WebhookConfig, WebhookEvent


class LoanAccountService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.repo = BaseRepository(LoanAccount, db)
        self.payments = PaymentService(db)
        self.audit = AuditService(db)

    async def list_accounts(self, user_id: UUID, filters: LoanAccountFilter) -> list[dict]:
        q = select(LoanAccount).where(LoanAccount.user_id == user_id)
        if filters.status:
            q = q.where(LoanAccount.status.in_(filters.status))
        if filters.search:
            term = f"%{filters.search}%"
            q = q.where(
                or_(
                    LoanAccount.account_name.ilike(term),
                    LoanAccount.borrower_name.ilike(term),
                )
            )
        q = q.order_by(LoanAccount.created_at.desc())
        result = await self.db.execute(q)
        accounts = list(result.scalars().all())
        return [await self._enrich(a) for a in accounts]

    async def get_account(self, account_id: UUID, user_id: UUID, is_admin: bool = False) -> dict:
        account = await self._get_or_404(account_id, user_id, is_admin)
        return await self._enrich(account)

    async def create_account(
        self, data: LoanAccountCreate, user_id: UUID, ip: str | None = None
    ) -> dict:
        # Auto-fill borrower name from the linked user's full_name
        from sqlalchemy import select as sql_select
        from app.modules.users.models import User
        user_result = await self.db.execute(sql_select(User).where(User.id == user_id))
        user = user_result.scalar_one_or_none()
        borrower_name = user.full_name if user else str(user_id)

        account = LoanAccount(
            user_id=user_id,
            account_name=data.account_name,
            borrower_name=borrower_name,
            borrow_amount=data.borrow_amount,
            rate=data.rate,
            cycle=data.cycle,
            start_date=data.start_date,
            status="open",
        )
        account = await self.repo.create(account)
        await self.db.refresh(account)
        await self.audit.log(
            user_id, "loan_account", str(account.id), "create",
            after={"name": data.account_name, "amount": str(data.borrow_amount)},
            ip=ip,
        )
        enriched = await self._enrich(account)
        await self._fire_webhook(account, "account.created", enriched)
        return enriched

    async def update_account(
        self, account_id: UUID, user_id: UUID, data: LoanAccountUpdate,
        ip: str | None = None, is_admin: bool = False
    ) -> dict:
        account = await self._get_or_404(account_id, user_id, is_admin)
        before = {"name": account.account_name, "rate": str(account.rate)}
        if data.account_name is not None:
            account.account_name = data.account_name
        if data.rate is not None:
            account.rate = data.rate
        if data.status is not None:
            account.status = data.status
        await self.repo.flush()
        await self.db.refresh(account)
        await self.audit.log(
            user_id, "loan_account", str(account_id), "update",
            before=before, after={"name": account.account_name, "rate": str(account.rate)},
            ip=ip,
        )
        enriched = await self._enrich(account)
        await self._fire_webhook(account, "account.updated", enriched)
        return enriched

    async def close_account(
        self, account_id: UUID, user_id: UUID, data: LoanAccountClose,
        ip: str | None = None, is_admin: bool = False
    ) -> dict:
        account = await self._get_or_404(account_id, user_id, is_admin)
        if account.status == "closed":
            raise HTTPException(status.HTTP_409_CONFLICT, "Account already closed")
        before = {"status": account.status}
        account.status = "closed"
        account.close_reason = data.close_reason
        await self.repo.flush()
        await self.db.refresh(account)
        await self.audit.log(
            user_id, "loan_account", str(account_id), "update",
            before=before, after={"status": "closed", "reason": data.close_reason}, ip=ip,
        )
        enriched = await self._enrich(account)
        await self._fire_webhook(account, "status.changed", enriched)
        return enriched

    async def purge_account(
        self, account_id: UUID, user_id: UUID,
        ip: str | None = None, force: bool = False, is_admin: bool = False
    ) -> None:
        account = await self._get_or_404(account_id, user_id, is_admin or force)
        if not force and account.status != "closed":
            raise HTTPException(
                status.HTTP_409_CONFLICT, "Only closed accounts can be purged (use force=true as admin)"
            )
        enriched = await self._enrich(account)
        await self._fire_webhook(account, "account.purged", enriched)
        await self.audit.log(
            user_id, "loan_account", str(account_id), "delete",
            before={"name": account.account_name, "status": account.status}, ip=ip,
        )
        await self.repo.delete(account)

    async def get_cycle_preview(self, account_id: UUID, user_id: UUID, is_admin: bool = False) -> list[date]:
        await self._get_or_404(account_id, user_id, is_admin)
        return upcoming_cycle_dates(date.today(), count=6)

    # ── Admin helpers ─────────────────────────────────────────────────────────

    async def get_account_any(self, account_id: UUID) -> dict:
        """Admin: get any account regardless of owner."""
        from sqlalchemy import select as sql_select
        result = await self.db.execute(
            sql_select(LoanAccount).where(LoanAccount.id == account_id)
        )
        account = result.scalar_one_or_none()
        if not account:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Account not found")
        return await self._enrich(account)

    async def update_account_any(
        self, account_id: UUID, admin_id: UUID, data: LoanAccountUpdate, ip: str | None = None
    ) -> dict:
        """Admin: update any account regardless of owner, including status."""
        from sqlalchemy import select as sql_select
        result = await self.db.execute(
            sql_select(LoanAccount).where(LoanAccount.id == account_id)
        )
        account = result.scalar_one_or_none()
        if not account:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Account not found")
        before = {"name": account.account_name, "rate": str(account.rate), "status": account.status}
        if data.account_name is not None:
            account.account_name = data.account_name
        if data.rate is not None:
            account.rate = data.rate
        if data.status is not None:
            account.status = data.status
        await self.repo.flush()
        await self.db.refresh(account)
        await self.audit.log(
            admin_id, "loan_account", str(account_id), "update",
            before=before,
            after={"name": account.account_name, "rate": str(account.rate), "status": account.status},
            ip=ip,
        )
        enriched = await self._enrich(account)
        await self._fire_webhook(account, "account.updated", enriched)
        return enriched

    async def list_all_accounts(self, filters: LoanAccountFilter) -> list[dict]:
        """Admin: list all accounts across all users."""
        q = select(LoanAccount)
        if filters.status:
            q = q.where(LoanAccount.status.in_(filters.status))
        if filters.search:
            term = f"%{filters.search}%"
            q = q.where(
                or_(
                    LoanAccount.account_name.ilike(term),
                    LoanAccount.borrower_name.ilike(term),
                )
            )
        q = q.order_by(LoanAccount.created_at.desc())
        result = await self.db.execute(q)
        accounts = list(result.scalars().all())
        return [await self._enrich(a) for a in accounts]

    # ── Helpers ───────────────────────────────────────────────────────────────

    async def _get_or_404(
        self, account_id: UUID, user_id: UUID, is_admin: bool = False
    ) -> LoanAccount:
        from sqlalchemy import select as sql_select
        if is_admin:
            result = await self.db.execute(
                sql_select(LoanAccount).where(LoanAccount.id == account_id)
            )
        else:
            result = await self.db.execute(
                sql_select(LoanAccount).where(
                    and_(LoanAccount.id == account_id, LoanAccount.user_id == user_id)
                )
            )
        account = result.scalar_one_or_none()
        if not account:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Account not found")
        return account

    async def _enrich(self, account: LoanAccount) -> dict:
        payments = await self.payments.get_for_account(account.id)
        payment_tuples = [(p.payment_date, float(p.amount)) for p in payments]

        current_balance = compute_current_balance(
            float(account.borrow_amount),
            float(account.rate),
            account.start_date,
            payment_tuples,
        )

        last = payments[-1] if payments else None
        ndd = last.next_due_date if last else next_cycle_date(account.start_date)

        result = {
            **account.__dict__,
            "current_balance": current_balance,
            "next_due_date": ndd,
        }
        result.pop("_sa_instance_state", None)
        return result

    async def _fire_webhook(self, account: LoanAccount, event: str, payload: dict) -> None:
        """Fire both per-account webhooks and global webhooks that match the event."""
        from sqlalchemy import or_ as sql_or
        result = await self.db.execute(
            select(WebhookConfig).where(
                and_(
                    WebhookConfig.is_active.is_(True),
                    sql_or(
                        WebhookConfig.account_id == account.id,
                        WebhookConfig.account_id.is_(None),  # global webhooks
                    ),
                )
            )
        )
        configs = [c for c in result.scalars().all() if event in (c.events or [])]

        # Build rich payload with full account + event info
        serializable_payload = {}
        for k, v in payload.items():
            if hasattr(v, '__str__') and not isinstance(v, (str, int, float, bool, type(None))):
                serializable_payload[k] = str(v)
            else:
                serializable_payload[k] = v

        full_payload = {
            "event": event,
            "account_id": str(account.id),
            "account_name": account.account_name,
            "borrower_name": account.borrower_name,
            "user_id": str(account.user_id),
            "status": account.status,
            "borrow_amount": str(account.borrow_amount),
            "rate": str(account.rate),
            "cycle": account.cycle,
            "start_date": str(account.start_date),
            **{k: v for k, v in serializable_payload.items()
               if k not in ("event", "account_id", "account_name", "borrower_name",
                            "user_id", "status", "borrow_amount", "rate", "cycle", "start_date")},
        }

        for config in configs:
            ev = WebhookEvent(
                webhook_id=config.id,
                event_type=event,
                payload=full_payload,
                status="pending",
            )
            self.db.add(ev)
        await self.db.flush()
