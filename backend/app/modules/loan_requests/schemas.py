from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


class LoanRequestCreate(BaseModel):
    account_name: str = Field(min_length=1, max_length=255)
    borrow_amount: Decimal = Field(gt=0, decimal_places=2)
    rate: Decimal = Field(gt=0, le=1, decimal_places=4)
    cycle: Literal[15, 30] = 15
    reason: str | None = Field(None, max_length=1000)


class LoanRequestReview(BaseModel):
    status: Literal["approved", "rejected", "under_review"]
    rejection_reason: str | None = None


class LoanRequestOut(BaseModel):
    model_config = {"from_attributes": True}

    id: UUID
    user_id: UUID
    account_name: str
    borrow_amount: Decimal
    rate: Decimal
    cycle: int
    reason: str | None
    status: str
    rejection_reason: str | None
    created_at: datetime
    updated_at: datetime
    reviewed_at: datetime | None
