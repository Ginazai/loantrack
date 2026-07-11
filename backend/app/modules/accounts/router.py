from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.modules.accounts.schemas import (
    LoanAccountClose,
    LoanAccountCreate,
    LoanAccountFilter,
    LoanAccountOut,
    LoanAccountUpdate,
)
from app.modules.accounts.service import LoanAccountService

router = APIRouter(prefix="/accounts", tags=["accounts"])


@router.get("", response_model=list[LoanAccountOut])
async def list_accounts(
    status: list[str] | None = Query(None),
    search: str | None = Query(None),
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    svc = LoanAccountService(db)
    filters = LoanAccountFilter(status=status, search=search)
    if current_user.role == "admin":
        return await svc.list_all_accounts(filters)
    return await svc.list_accounts(current_user.id, filters)


@router.post("", response_model=LoanAccountOut, status_code=201)
async def create_account(
    request: Request,
    data: LoanAccountCreate,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    svc = LoanAccountService(db)
    ip = request.client.host if request.client else None
    target_user_id = (
        data.linked_user_id
        if (data.linked_user_id and current_user.role == "admin")
        else current_user.id
    )
    return await svc.create_account(data, target_user_id, ip=ip)


@router.get("/{account_id}", response_model=LoanAccountOut)
async def get_account(
    account_id: UUID,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    svc = LoanAccountService(db)
    is_admin = current_user.role == "admin"
    return await svc.get_account(account_id, current_user.id, is_admin=is_admin)


@router.patch("/{account_id}", response_model=LoanAccountOut)
async def update_account(
    request: Request,
    account_id: UUID,
    data: LoanAccountUpdate,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    svc = LoanAccountService(db)
    ip = request.client.host if request.client else None
    is_admin = current_user.role == "admin"
    return await svc.update_account(account_id, current_user.id, data, ip=ip, is_admin=is_admin)


@router.post("/{account_id}/close", response_model=LoanAccountOut)
async def close_account(
    request: Request,
    account_id: UUID,
    data: LoanAccountClose,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    svc = LoanAccountService(db)
    ip = request.client.host if request.client else None
    is_admin = current_user.role == "admin"
    return await svc.close_account(account_id, current_user.id, data, ip=ip, is_admin=is_admin)


@router.delete("/{account_id}", status_code=204)
async def purge_account(
    request: Request,
    account_id: UUID,
    force: bool = False,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    svc = LoanAccountService(db)
    ip = request.client.host if request.client else None
    is_admin = current_user.role == "admin"
    await svc.purge_account(
        account_id, current_user.id, ip=ip,
        force=is_admin and force, is_admin=is_admin,
    )


@router.get("/{account_id}/cycle-preview")
async def cycle_preview(
    account_id: UUID,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[date]:
    svc = LoanAccountService(db)
    is_admin = current_user.role == "admin"
    return await svc.get_cycle_preview(account_id, current_user.id, is_admin=is_admin)
