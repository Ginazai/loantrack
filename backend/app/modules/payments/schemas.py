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
    method: Literal["auto", "manual", "import"]
    created_at: datetime
    attachment_count: int = 0


# ── Attachments ──────────────────────────────────────────────────────────────

ALLOWED_ATTACHMENT_CONTENT_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "application/pdf",
}
MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB


def sniff_attachment_type(data: bytes) -> str | None:
    """Content type according to the file's own first bytes, or None if it isn't one we accept.

    The client-declared Content-Type and the filename extension are whatever the uploader
    typed; only the bytes say what the file is. Everything stored and later served is typed
    by this, never by the declaration.
    """
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if data.startswith(b"%PDF-"):
        return "application/pdf"
    return None


def validate_attachment(content_type: str, size_bytes: int) -> None:
    """Pure validation (no DB, no I/O) — raises ValueError on a bad
    attachment so it's testable in isolation from PaymentService."""
    if content_type not in ALLOWED_ATTACHMENT_CONTENT_TYPES:
        raise ValueError(
            f"File type '{content_type}' not allowed. "
            f"Allowed: {sorted(ALLOWED_ATTACHMENT_CONTENT_TYPES)}"
        )
    if size_bytes <= 0:
        raise ValueError("Empty file")
    if size_bytes > MAX_ATTACHMENT_SIZE_BYTES:
        raise ValueError(f"File exceeds the {MAX_ATTACHMENT_SIZE_BYTES // (1024 * 1024)} MB limit")


class PaymentAttachmentOut(BaseModel):
    model_config = {"from_attributes": True}

    id: UUID
    payment_id: UUID
    original_filename: str
    content_type: str
    size_bytes: int
    uploaded_by: UUID | None
    created_at: datetime
