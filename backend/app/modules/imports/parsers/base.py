"""
Parser interface + shared data structures for the import feature (ADR-004).

An `ImportParser` turns raw file bytes into a `ParsedLedger` — a flat,
format-agnostic description of accounts-to-create-or-match and
payments-to-create. Nothing downstream (service.py, router.py) knows which
concrete format produced a `ParsedLedger`.

Adding a new format (e.g. JSON) means adding one parser module here and
registering it in `service.PARSERS` — no other file changes.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal


@dataclass
class ParsedPayment:
    """One payment, tied to a `ParsedAccount` via `source_ref`."""

    source_ref: str
    payment_date: date
    amount: Decimal
    interests_accrued: Decimal
    balance_before: Decimal | None = None
    balance_after: Decimal | None = None
    row_numbers: list[int] = field(default_factory=list)


@dataclass
class ParsedAccount:
    """One loan, as seen in the source file.

    `source_ref` is whatever the source format uses to group rows for this
    loan (a `Referencia` number for the legacy ledger, the exported `id`
    UUID for the native format) — it is never assumed to be a LoanTrack
    account id.
    """

    source_ref: str
    suggested_account_name: str
    borrow_amount: Decimal
    start_date: date
    rate: Decimal | None = None  # None when the source format doesn't carry it
    borrower_name: str | None = None  # None when the source format doesn't carry it
    row_number: int | None = None


@dataclass
class ParseError:
    row_number: int | None
    message: str
    raw: dict


@dataclass
class ParsedLedger:
    format_name: str
    accounts: list[ParsedAccount]
    payments: list[ParsedPayment]
    errors: list[ParseError]


class ImportParser(ABC):
    """One concrete file format. Stateless — both methods are static."""

    format_name: str

    @staticmethod
    @abstractmethod
    def sniff(raw: bytes) -> bool:
        """True if this parser recognizes the file's shape (usually: header row)."""

    @staticmethod
    @abstractmethod
    def parse(raw: bytes) -> ParsedLedger:
        """Parse the file. Must not raise on bad *rows* — collect them in
        `ParsedLedger.errors` instead, so one bad line doesn't sink the
        whole batch (R1.5)."""
