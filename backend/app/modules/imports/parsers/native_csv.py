"""
Parser for LoanTrack's own export formats (`/admin/export/*.csv`), for
restoring or migrating data between instances. Three shapes are recognized
by header, matching exactly what `modules/admin/router.py` produces today:

- `accounts.csv`  — accounts only, no payments.
- `payments.csv`  — payments only; each row's `account_id` must already
  exist (it references the real LoanTrack UUID, not a mapping candidate).
- `full.csv`      — one account plus all its payments, self-contained.

Native export doesn't carry `user_id` or `linked user`, so — like the
legacy ledger format — creating a *new* account still requires the admin
to pick an owning user in the mapping step (see `imports/service.py`).
Re-importing over an account that already exists (matched by the
exported `id`) does not have this problem.
"""

import csv
import io
from datetime import datetime
from decimal import Decimal, InvalidOperation

from app.modules.imports.parsers.base import (
    ImportParser,
    ParseError,
    ParsedAccount,
    ParsedLedger,
    ParsedPayment,
)

ACCOUNTS_HEADER = {
    "id", "account_name", "borrower_name", "borrow_amount", "rate",
    "cycle", "status", "current_balance", "next_due_date", "start_date", "created_at",
}
PAYMENTS_HEADER = {
    "id", "account_id", "payment_date", "amount", "balance_before",
    "interests_accrued", "balance_after", "next_due_date", "method", "created_at",
}
FULL_HEADER = {
    "account_id", "account_name", "borrower_name", "borrow_amount", "rate",
    "cycle", "status", "start_date", "payment_#", "payment_date", "amount",
    "balance_before", "interests_accrued", "balance_after", "next_due_date", "method",
}


def _dec(raw: str | None) -> Decimal | None:
    raw = (raw or "").strip()
    if not raw:
        return None
    try:
        return Decimal(raw)
    except InvalidOperation:
        return None


def _date(raw: str | None):
    raw = (raw or "").strip()
    if not raw:
        return None
    try:
        return datetime.strptime(raw, "%Y-%m-%d").date()
    except ValueError:
        return None


class NativeCsvParser(ImportParser):
    format_name = "native_csv"

    @staticmethod
    def _shape(raw: bytes) -> str | None:
        try:
            text = raw.decode("utf-8-sig")
        except UnicodeDecodeError:
            return None
        reader = csv.reader(io.StringIO(text))
        try:
            header = set(h.strip() for h in next(reader))
        except StopIteration:
            return None
        if header == FULL_HEADER:
            return "full"
        if header == ACCOUNTS_HEADER:
            return "accounts"
        if header == PAYMENTS_HEADER:
            return "payments"
        return None

    @staticmethod
    def sniff(raw: bytes) -> bool:
        return NativeCsvParser._shape(raw) is not None

    @staticmethod
    def parse(raw: bytes) -> ParsedLedger:
        shape = NativeCsvParser._shape(raw)
        text = raw.decode("utf-8-sig")
        reader = csv.DictReader(io.StringIO(text))

        accounts: list[ParsedAccount] = []
        payments: list[ParsedPayment] = []
        errors: list[ParseError] = []

        for row_number, row in enumerate(reader, start=2):
            if shape in ("full", "accounts"):
                ref = (row.get("id") or row.get("account_id") or "").strip()
                borrow_amount = _dec(row.get("borrow_amount"))
                rate = _dec(row.get("rate"))
                start_date = _date(row.get("start_date"))
                if not ref or borrow_amount is None or rate is None or start_date is None:
                    errors.append(
                        ParseError(row_number, "Fila de cuenta incompleta", dict(row))
                    )
                else:
                    # full.csv repeats the account row per payment — only the
                    # first occurrence per account creates a ParsedAccount.
                    if not any(a.source_ref == ref for a in accounts):
                        accounts.append(
                            ParsedAccount(
                                source_ref=ref,
                                suggested_account_name=row.get("account_name") or f"Cuenta {ref}",
                                borrow_amount=borrow_amount,
                                start_date=start_date,
                                rate=rate,
                                borrower_name=row.get("borrower_name") or None,
                                row_number=row_number,
                            )
                        )

            if shape in ("full", "payments"):
                ref = (row.get("account_id") or "").strip()
                amount = _dec(row.get("amount"))
                payment_date = _date(row.get("payment_date"))
                if shape == "full" and not (row.get("payment_date") or "").strip():
                    continue  # account-only row in a full.csv with zero payments
                if not ref or amount is None or payment_date is None:
                    errors.append(
                        ParseError(row_number, "Fila de pago incompleta", dict(row))
                    )
                    continue
                payments.append(
                    ParsedPayment(
                        source_ref=ref,
                        payment_date=payment_date,
                        amount=amount,
                        interests_accrued=_dec(row.get("interests_accrued")) or Decimal("0"),
                        balance_before=_dec(row.get("balance_before")),
                        balance_after=_dec(row.get("balance_after")),
                        row_numbers=[row_number],
                    )
                )

        return ParsedLedger(
            format_name=NativeCsvParser.format_name,
            accounts=accounts,
            payments=payments,
            errors=errors,
        )
