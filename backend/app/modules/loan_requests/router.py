from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.modules.accounts.models import LoanAccount
from app.modules.accounts.schemas import LoanAccountCreate
from app.modules.accounts.service import LoanAccountService
from app.modules.loan_requests.models import LoanRequest
from app.modules.loan_requests.schemas import LoanRequestCreate, LoanRequestOut, LoanRequestReview
from app.modules.users.models import User

router = APIRouter(prefix="/loan-requests", tags=["loan-requests"])

MAX_ACTIVE_REQUESTS = 3
ACTIVE_STATUSES = {"requested", "under_review"}


# ── User endpoints ─────────────────────────────────────────────────────────────

@router.get("", response_model=list[LoanRequestOut])
async def list_my_requests(
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(LoanRequest)
        .where(LoanRequest.user_id == current_user.id)
        .order_by(LoanRequest.created_at.desc())
    )
    return list(result.scalars().all())


@router.post("", response_model=LoanRequestOut, status_code=201)
async def create_request(
    data: LoanRequestCreate,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Count active requests
    result = await db.execute(
        select(LoanRequest).where(
            LoanRequest.user_id == current_user.id,
            LoanRequest.status.in_(ACTIVE_STATUSES),
        )
    )
    active = list(result.scalars().all())
    if len(active) >= MAX_ACTIVE_REQUESTS:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"You already have {MAX_ACTIVE_REQUESTS} active requests. Wait for them to be reviewed.",
        )

    req = LoanRequest(
        user_id=current_user.id,
        account_name=data.account_name,
        borrow_amount=data.borrow_amount,
        rate=data.rate,
        cycle=data.cycle,
        reason=data.reason,
        status="requested",
    )
    db.add(req)
    await db.flush()
    await db.refresh(req)
    return req


@router.delete("/{request_id}", status_code=204)
async def cancel_request(
    request_id: UUID,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(LoanRequest).where(
            LoanRequest.id == request_id,
            LoanRequest.user_id == current_user.id,
        )
    )
    req = result.scalar_one_or_none()
    if not req:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Request not found")
    if req.status not in ACTIVE_STATUSES:
        raise HTTPException(status.HTTP_409_CONFLICT, "Only pending requests can be cancelled")
    await db.delete(req)
    await db.flush()


# ── Admin endpoints ────────────────────────────────────────────────────────────

@router.get("/admin/all", response_model=list[LoanRequestOut])
async def list_all_requests(
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin only")
    result = await db.execute(
        select(LoanRequest).order_by(LoanRequest.created_at.desc())
    )
    return list(result.scalars().all())


@router.patch("/admin/{request_id}", response_model=LoanRequestOut)
async def review_request(
    request_id: UUID,
    data: LoanRequestReview,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin only")

    result = await db.execute(select(LoanRequest).where(LoanRequest.id == request_id))
    req = result.scalar_one_or_none()
    if not req:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Request not found")

    req.status = data.status
    req.reviewed_at = datetime.now(timezone.utc)
    if data.status == "rejected":
        req.rejection_reason = data.rejection_reason

    # Auto-create loan account when approved
    if data.status == "approved":
        # Fetch the user to get their full name for borrower_name
        user_result = await db.execute(select(User).where(User.id == req.user_id))
        user = user_result.scalar_one_or_none()
        borrower_name = user.full_name if user else req.account_name

        from datetime import date
        account_data = LoanAccountCreate(
            account_name=req.account_name,
            borrower_name=borrower_name,
            borrow_amount=req.borrow_amount,
            rate=req.rate,
            cycle=req.cycle,
            start_date=date.today(),
            linked_user_id=req.user_id,
        )
        svc = LoanAccountService(db)
        await svc.create_account(account_data, req.user_id)

    await db.flush()
    await db.refresh(req)
    return req


@router.get("/admin/{request_id}/open", response_model=LoanRequestOut)
async def open_request(
    request_id: UUID,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Auto-transition to under_review when an admin opens a request."""
    if current_user.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin only")

    result = await db.execute(select(LoanRequest).where(LoanRequest.id == request_id))
    req = result.scalar_one_or_none()
    if not req:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Request not found")

    if req.status == "requested":
        req.status = "under_review"
        req.reviewed_at = datetime.now(timezone.utc)
        await db.flush()
        await db.refresh(req)
    return req
