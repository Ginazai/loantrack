from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.modules.accounts.models import LoanAccount
from app.modules.payments.models import Payment
from app.modules.payments.schemas import PaymentCreate, PaymentOut
from app.modules.payments.service import PaymentService

router = APIRouter(prefix="/accounts/{account_id}/payments", tags=["payments"])


@router.get("", response_model=list[PaymentOut])
async def list_payments(
    account_id: UUID,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    svc = PaymentService(db)
    return await svc.list_payments(account_id, current_user.id, is_admin=current_user.role == "admin")


@router.post("", response_model=PaymentOut, status_code=201)
async def add_payment(
    request: Request,
    account_id: UUID,
    data: PaymentCreate,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    svc = PaymentService(db)
    ip = request.client.host if request.client else None
    return await svc.add_payment(
        account_id, current_user.id, data, ip=ip, is_admin=current_user.role == "admin"
    )


@router.delete("/{payment_id}", status_code=204)
async def delete_payment(
    account_id: UUID,
    payment_id: UUID,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin only")

    # Verify account exists and belongs to user's scope
    acc_result = await db.execute(select(LoanAccount).where(LoanAccount.id == account_id))
    account = acc_result.scalar_one_or_none()
    if not account:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Account not found")

    result = await db.execute(
        select(Payment).where(
            and_(Payment.id == payment_id, Payment.account_id == account_id)
        )
    )
    payment = result.scalar_one_or_none()
    if not payment:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Payment not found")

    await db.delete(payment)
    await db.flush()
