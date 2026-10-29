from datetime import date, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

AccountStatus = Literal["open", "active", "paid", "closed"]

# Bounds that keep the ledger math (one row per cycle, compounding) finite and cheap.
# Numeric(12, 2) in the DB caps the amount; an ancient start_date would mean tens of
# thousands of cycles per account on every list call.
MIN_START_DATE = date(2000, 1, 1)
MAX_BORROW_AMOUNT = Decimal("9999999999.99")


class LoanAccountCreate(BaseModel):
    account_name: str = Field(min_length=1, max_length=255)
    borrow_amount: Decimal = Field(gt=0, le=MAX_BORROW_AMOUNT, decimal_places=2)
    rate: Decimal = Field(gt=0, le=1, decimal_places=4)
    cycle: Literal[15, 30] = 15
    start_date: date
    linked_user_id: UUID | None = None  # Admin-only: assign to a specific user

    @field_validator("start_date")
    @classmethod
    def _start_date_in_range(cls, v: date) -> date:
        if v < MIN_START_DATE:
            raise ValueError(f"start_date cannot be before {MIN_START_DATE.isoformat()}")
        if v > date.today().replace(year=date.today().year + 1):
            raise ValueError("start_date cannot be more than a year in the future")
        return v


class LoanAccountUpdate(BaseModel):
    account_name: str | None = Field(None, min_length=1, max_length=255)
    rate: Decimal | None = Field(None, gt=0, le=1, decimal_places=4)
    status: Literal["open", "active", "paid", "closed"] | None = None


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
