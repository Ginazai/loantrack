from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.core.repository import BaseRepository
from app.core.security import hash_password, generate_webhook_secret
from app.modules.accounts.models import LoanAccount
from app.modules.accounts.service import LoanAccountService
from app.modules.accounts.schemas import LoanAccountFilter
from app.modules.users.models import User
from app.modules.users.schemas import UserCreate, UserOut
from app.modules.webhooks.models import WebhookConfig
from app.modules.webhooks.schemas import WebhookConfigCreate, WebhookConfigOut

router = APIRouter(prefix="/admin", tags=["admin"])


def require_admin(current_user=Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin access required")
    return current_user


# ── Users ─────────────────────────────────────────────────────────────────────

@router.get("/users", response_model=list[UserOut])
async def list_users(
    _=Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).order_by(User.created_at.desc()))
    return list(result.scalars().all())


@router.post("/users", response_model=UserOut, status_code=201)
async def create_user(
    data: UserCreate,
    _=Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    # Check email unique
    existing = await db.execute(select(User).where(User.email == data.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")
    user = User(
        email=data.email,
        password_hash=hash_password(data.password),
        full_name=data.full_name,
        role=data.role,
    )
    db.add(user)
    await db.flush()
    await db.refresh(user)
    return user


@router.patch("/users/{user_id}", response_model=UserOut)
async def update_user(
    user_id: UUID,
    data: dict,
    _=Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    if "is_active" in data:
        user.is_active = data["is_active"]
    if "role" in data:
        user.role = data["role"]
    if "full_name" in data:
        user.full_name = data["full_name"]
    await db.flush()
    await db.refresh(user)
    return user


@router.get("/users/{user_id}/accounts")
async def get_user_accounts(
    user_id: UUID,
    _=Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    svc = LoanAccountService(db)
    return await svc.list_accounts(user_id, LoanAccountFilter())


# ── Global Webhooks ────────────────────────────────────────────────────────────

@router.get("/webhooks", response_model=list[WebhookConfigOut])
async def list_global_webhooks(
    current_user=Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(WebhookConfig).where(WebhookConfig.account_id.is_(None))
    )
    return list(result.scalars().all())


@router.post("/webhooks", response_model=WebhookConfigOut, status_code=201)
async def create_global_webhook(
    data: WebhookConfigCreate,
    _=Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    config = WebhookConfig(
        account_id=None,  # global — not tied to any account
        target_url=str(data.target_url),
        secret_hash=generate_webhook_secret(),
        events=data.events,
    )
    db.add(config)
    await db.flush()
    await db.refresh(config)
    return config


@router.delete("/webhooks/{webhook_id}", status_code=204)
async def delete_global_webhook(
    webhook_id: UUID,
    _=Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(WebhookConfig).where(
            WebhookConfig.id == webhook_id,
            WebhookConfig.account_id.is_(None),
        )
    )
    config = result.scalar_one_or_none()
    if not config:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Webhook not found")
    await db.delete(config)
    await db.flush()


@router.patch("/webhooks/{webhook_id}", response_model=WebhookConfigOut)
async def toggle_global_webhook(
    webhook_id: UUID,
    data: dict,
    _=Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(WebhookConfig).where(
            WebhookConfig.id == webhook_id,
            WebhookConfig.account_id.is_(None),
        )
    )
    config = result.scalar_one_or_none()
    if not config:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Webhook not found")
    if "is_active" in data:
        config.is_active = data["is_active"]
    await db.flush()
    await db.refresh(config)
    return config


# ── Delete user ────────────────────────────────────────────────────────────────

@router.delete("/users/{user_id}", status_code=204)
async def delete_user(
    user_id: UUID,
    current_user=Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    if str(user.id) == str(current_user.id):
        raise HTTPException(status.HTTP_409_CONFLICT, "Cannot delete your own account")
    await db.delete(user)
    await db.flush()


# ── Delete loan request ────────────────────────────────────────────────────────

@router.delete("/requests/{request_id}", status_code=204)
async def delete_loan_request(
    request_id: UUID,
    _=Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    from app.modules.loan_requests.models import LoanRequest
    result = await db.execute(select(LoanRequest).where(LoanRequest.id == request_id))
    req = result.scalar_one_or_none()
    if not req:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Request not found")
    await db.delete(req)
    await db.flush()


# ── CSV exports ────────────────────────────────────────────────────────────────

import csv, io
from fastapi.responses import StreamingResponse
from app.modules.payments.models import Payment as PaymentModel
from sqlalchemy import select as sql_select


@router.get("/export/accounts.csv")
async def export_accounts_csv(
    _=Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    from app.modules.accounts.service import LoanAccountService
    from app.modules.accounts.schemas import LoanAccountFilter
    svc = LoanAccountService(db)
    accounts = await svc.list_all_accounts(LoanAccountFilter())

    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["id", "account_name", "borrower_name", "borrow_amount", "rate",
                "cycle", "status", "current_balance", "next_due_date", "start_date", "created_at"])
    for a in accounts:
        w.writerow([a["id"], a["account_name"], a["borrower_name"], a["borrow_amount"],
                    a["rate"], a["cycle"], a["status"], a["current_balance"],
                    a["next_due_date"], a["start_date"], a["created_at"]])
    out.seek(0)
    return StreamingResponse(iter([out.getvalue()]),
                             media_type="text/csv",
                             headers={"Content-Disposition": "attachment; filename=accounts.csv"})


@router.get("/export/payments.csv")
async def export_payments_csv(
    _=Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        sql_select(PaymentModel).order_by(PaymentModel.payment_date)
    )
    payments = list(result.scalars().all())

    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["id", "account_id", "payment_date", "amount", "balance_before",
                "interests_accrued", "balance_after", "next_due_date", "method", "created_at"])
    for p in payments:
        w.writerow([p.id, p.account_id, p.payment_date, p.amount, p.balance_before,
                    p.interests_accrued, p.balance_after, p.next_due_date, p.method, p.created_at])
    out.seek(0)
    return StreamingResponse(iter([out.getvalue()]),
                             media_type="text/csv",
                             headers={"Content-Disposition": "attachment; filename=payments.csv"})


@router.get("/export/accounts/{account_id}/full.csv")
async def export_account_full_csv(
    account_id: UUID,
    _=Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Single account with all its payments as one flat CSV."""
    from app.modules.accounts.models import LoanAccount
    acc_r = await db.execute(sql_select(LoanAccount).where(LoanAccount.id == account_id))
    account = acc_r.scalar_one_or_none()
    if not account:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Account not found")

    pmt_r = await db.execute(
        sql_select(PaymentModel)
        .where(PaymentModel.account_id == account_id)
        .order_by(PaymentModel.payment_date)
    )
    payments = list(pmt_r.scalars().all())

    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["account_id", "account_name", "borrower_name", "borrow_amount",
                "rate", "cycle", "status", "start_date",
                "payment_#", "payment_date", "amount", "balance_before",
                "interests_accrued", "balance_after", "next_due_date", "method"])
    if payments:
        for i, p in enumerate(payments, 1):
            w.writerow([account.id, account.account_name, account.borrower_name,
                        account.borrow_amount, account.rate, account.cycle,
                        account.status, account.start_date,
                        i, p.payment_date, p.amount, p.balance_before,
                        p.interests_accrued, p.balance_after, p.next_due_date, p.method])
    else:
        w.writerow([account.id, account.account_name, account.borrower_name,
                    account.borrow_amount, account.rate, account.cycle,
                    account.status, account.start_date,
                    "", "", "", "", "", "", "", ""])
    out.seek(0)
    safe = account.account_name.replace(" ", "_")
    return StreamingResponse(iter([out.getvalue()]),
                             media_type="text/csv",
                             headers={"Content-Disposition": f"attachment; filename={safe}.csv"})
