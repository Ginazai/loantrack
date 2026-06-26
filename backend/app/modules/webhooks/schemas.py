from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, HttpUrl, field_validator

WEBHOOK_EVENTS = Literal[
    "payment.added",
    "status.changed",
    "account.created",
    "account.updated",
    "account.purged",
]


class WebhookConfigCreate(BaseModel):
    target_url: HttpUrl
    events: list[str] = Field(min_length=1)

    @field_validator("events")
    @classmethod
    def valid_events(cls, v: list[str]) -> list[str]:
        allowed = {
            "payment.added", "status.changed",
            "account.created", "account.updated", "account.purged",
        }
        bad = [e for e in v if e not in allowed]
        if bad:
            raise ValueError(f"Unknown events: {bad}. Allowed: {allowed}")
        return v


class WebhookConfigUpdate(BaseModel):
    target_url: HttpUrl | None = None
    events: list[str] | None = None
    is_active: bool | None = None


class WebhookConfigOut(BaseModel):
    model_config = {"from_attributes": True}

    id: UUID
    account_id: UUID | None
    target_url: str
    events: list[str]
    is_active: bool
    created_at: datetime


class WebhookEventOut(BaseModel):
    model_config = {"from_attributes": True}

    id: UUID
    webhook_id: UUID
    event_type: str
    status: str
    attempt_count: int
    last_attempt_at: datetime | None
    created_at: datetime
