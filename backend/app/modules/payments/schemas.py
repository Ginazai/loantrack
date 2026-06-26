from datetime import date, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


class PaymentCreate(BaseModel):
    amount: Decimal = Field(gt=0, decimal_places=2)
    payment_date: date | None = None  # None = auto (next cycle date)
    method: Literal["auto", "manual"] = "auto"

    @field_validator("payment_date")
    @classmethod
    def date_not_future(cls, v: date | None) -> date | None:
        if v and v > date.today():
            raise ValueError("Payment date cannot be in the future")
        return v


class PaymentOut(BaseModel):
    model_config = {"from_attributes": True}

    id: UUID
    account_id: UUID
    amount: Decimal
    balance_before: Decimal
    interests_accrued: Decimal
    balance_after: Decimal
    payment_date: date
    next_due_date: date | None
    method: str
    created_at: datetime
