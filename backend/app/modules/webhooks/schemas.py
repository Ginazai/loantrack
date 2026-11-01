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
    "cycle.closed",
]


class WebhookConfigCreate(BaseModel):
    target_url: HttpUrl
    events: list[str] = Field(min_length=1)

    @field_validator("events")
    @classmethod
    def valid_events(cls, v: list[str]) -> list[str]:
        allowed = {
            "payment.added",
            "status.changed",
            "account.created",
            "account.updated",
            "account.purged",
            "cycle.closed",
        }
        bad = [e for e in v if e not in allowed]
        if bad:
            raise ValueError(f"Unknown events: {bad}. Allowed: {allowed}")
        return v


class WebhookToggle(BaseModel):
    """Body of PATCH /admin/webhooks/{id}: pause or resume. Nothing else is editable."""

    model_config = {"extra": "forbid"}

    is_active: bool


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


class WebhookConfigCreated(WebhookConfigOut):
    """Returned by create and rotate-secret ONLY.

    The signing secret is what lets a receiver verify X-Webhook-Signature, so the person who
    sets the webhook up has to be able to see it. It is shown once: list/get responses never
    include it (WebhookConfigOut), the same way an API key is.
    """

    secret: str

    @classmethod
    def from_config(cls, config) -> "WebhookConfigCreated":
        base = WebhookConfigOut.model_validate(config).model_dump()
        return cls(**base, secret=config.secret_hash)


class WebhookEventOut(BaseModel):
    model_config = {"from_attributes": True}

    id: UUID
    webhook_id: UUID
    event_type: str
    status: str
    attempt_count: int
    last_attempt_at: datetime | None
    created_at: datetime
