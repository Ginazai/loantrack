from datetime import date, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


class ParsedAccountOut(BaseModel):
    source_ref: str
    suggested_account_name: str
    borrow_amount: Decimal
    start_date: date
    rate: Decimal | None
    borrower_name: str | None
    payment_count: int
    # Best-effort suggestion only — the admin must still confirm (R1.4).
    suggested_existing_account_id: UUID | None = None


class ParseErrorOut(BaseModel):
    row_number: int | None
    message: str


class ImportPreviewOut(BaseModel):
    batch_id: UUID
    format: str
    accounts: list[ParsedAccountOut]
    unmatched_payment_refs: list[str] = Field(
        default_factory=list,
        description="source_ref values that have payments but no disbursement/account "
        "row in the file — must be mapped to an existing account or skipped.",
    )
    total_payments_parsed: int
    error_count: int
    errors: list[ParseErrorOut]


class AccountMappingIn(BaseModel):
    source_ref: str
    action: Literal["create", "existing", "skip"]

    # action == "existing"
    existing_account_id: UUID | None = None

    # action == "create" — the source file never carries enough to create an
    # account unattended (no owning user, and the legacy format has no rate
    # or borrower name either), so the admin supplies what's missing here.
    account_name: str | None = None
    borrower_name: str | None = None
    linked_user_id: UUID | None = None
    rate: Decimal | None = Field(default=None, ge=0, le=1)


class ImportCommitIn(BaseModel):
    mappings: list[AccountMappingIn] = Field(min_length=1)


class ImportRowOut(BaseModel):
    model_config = {"from_attributes": True}

    row_number: int | None
    interpretation: str
    result: str
    error_message: str | None


class ImportBatchOut(BaseModel):
    model_config = {"from_attributes": True}

    id: UUID
    source_filename: str
    format: str
    status: str
    summary: dict
    created_at: datetime
    committed_at: datetime | None


class ImportCommitOut(BaseModel):
    batch: ImportBatchOut
    rows: list[ImportRowOut]
