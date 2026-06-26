from datetime import date, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

AccountStatus = Literal["open", "active", "paid", "closed"]


class LoanAccountCreate(BaseModel):
    account_name: str = Field(min_length=1, max_length=255)
    borrow_amount: Decimal = Field(gt=0, decimal_places=2)
    rate: Decimal = Field(gt=0, le=1, decimal_places=4)
    cycle: Literal[15, 30] = 15
    start_date: date
    linked_user_id: UUID | None = None  # Admin-only: assign to a specific user


class LoanAccountUpdate(BaseModel):
    account_name: str | None = Field(None, min_length=1, max_length=255)
    rate: Decimal | None = Field(None, gt=0, le=1, decimal_places=4)


class LoanAccountClose(BaseModel):
    close_reason: str | None = Field(None, max_length=1000)


class LoanAccountOut(BaseModel):
    model_config = {"from_attributes": True}

    id: UUID
    account_name: str
    borrower_name: str
    borrow_amount: Decimal
    rate: Decimal
    cycle: int
    status: str
    close_reason: str | None
    start_date: date
    created_at: datetime
    updated_at: datetime

    # Computed fields added by the service layer
    current_balance: Decimal | None = None
    next_due_date: date | None = None


class LoanAccountFilter(BaseModel):
    status: list[AccountStatus] | None = None
    search: str | None = None


class CycleDatePreview(BaseModel):
    cycle_date: date
    is_upcoming: bool
