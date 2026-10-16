from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


class LoanRequestCreate(BaseModel):
    """What a borrower provides when asking for a loan.

    Deliberately does NOT include rate or payment cycle — those are terms
    the lender sets, not something the borrower should be choosing for
    themselves. See LoanRequestReview below for where they're actually
    decided (at approval time).
    """

    account_name: str = Field(min_length=1, max_length=255)
    borrow_amount: Decimal = Field(gt=0, decimal_places=2)
    reason: str | None = Field(None, max_length=1000, description="Details about the loan request")


class LoanRequestReview(BaseModel):
    status: Literal["approved", "rejected", "under_review"]
    rejection_reason: str | None = None
    # Required when status == "approved" — the admin sets these at approval
    # time, not the borrower at request time (validated in the router,
    # since whether they're required depends on `status`).
    rate: Decimal | None = Field(None, gt=0, le=1, decimal_places=4)
    cycle: Literal[15, 30] | None = None


class LoanRequestOut(BaseModel):
    model_config = {"from_attributes": True}

    id: UUID
    user_id: UUID
    account_name: str
    borrow_amount: Decimal
    rate: Decimal | None  # set only once approved
    cycle: int | None  # set only once approved
    reason: str | None
    status: str
    rejection_reason: str | None
    created_at: datetime
    updated_at: datetime
    reviewed_at: datetime | None
