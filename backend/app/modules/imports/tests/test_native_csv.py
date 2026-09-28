"""Unit tests — native (round-trip) CSV parser (no DB)."""
from datetime import date
from decimal import Decimal

from app.modules.imports.parsers.native_csv import NativeCsvParser

ACCOUNTS_HEADER = (
    "id,account_name,borrower_name,borrow_amount,rate,cycle,status,"
    "current_balance,next_due_date,start_date,created_at\n"
)
PAYMENTS_HEADER = (
    "id,account_id,payment_date,amount,balance_before,interests_accrued,"
    "balance_after,next_due_date,method,created_at\n"
)
FULL_HEADER = (
    "account_id,account_name,borrower_name,borrow_amount,rate,cycle,status,"
    "start_date,payment_#,payment_date,amount,balance_before,"
    "interests_accrued,balance_after,next_due_date,method\n"
)

ACCOUNT_ID = "11111111-1111-1111-1111-111111111111"


class TestSniff:
    def test_recognizes_accounts_shape(self):
        assert NativeCsvParser.sniff(ACCOUNTS_HEADER.encode())

    def test_recognizes_payments_shape(self):
        assert NativeCsvParser.sniff(PAYMENTS_HEADER.encode())

    def test_recognizes_full_shape(self):
        assert NativeCsvParser.sniff(FULL_HEADER.encode())

    def test_rejects_legacy_ledger_shape(self):
        raw = b"Referencia,Fecha,Descripcion,Debito,Credito\n"
        assert not NativeCsvParser.sniff(raw)

    def test_rejects_unrelated_csv(self):
        assert not NativeCsvParser.sniff(b"foo,bar,baz\n1,2,3\n")


class TestParseAccountsOnly:
    def test_single_account_row(self):
        raw = (
            ACCOUNTS_HEADER
            + f"{ACCOUNT_ID},Loan A,Jane Doe,1000.00,0.05,15,open,"
              f"1000.00,,2026-01-01,2026-01-01T00:00:00\n"
        ).encode()
        parsed = NativeCsvParser.parse(raw)
        assert len(parsed.accounts) == 1
        acc = parsed.accounts[0]
        assert acc.source_ref == ACCOUNT_ID
        assert acc.borrow_amount == Decimal("1000.00")
        assert acc.rate == Decimal("0.05")
        assert acc.borrower_name == "Jane Doe"
        assert acc.start_date == date(2026, 1, 1)
        assert parsed.payments == []


class TestParsePaymentsOnly:
    def test_single_payment_row(self):
        raw = (
            PAYMENTS_HEADER
            + f"p1,{ACCOUNT_ID},2026-01-15,50.00,1000.00,5.00,955.00,,manual,"
              f"2026-01-15T00:00:00\n"
        ).encode()
        parsed = NativeCsvParser.parse(raw)
        assert parsed.accounts == []
        assert len(parsed.payments) == 1
        p = parsed.payments[0]
        assert p.source_ref == ACCOUNT_ID
        assert p.amount == Decimal("50.00")
        assert p.interests_accrued == Decimal("5.00")
        assert p.payment_date == date(2026, 1, 15)


class TestParseFullRoundTrip:
    def test_account_with_two_payments(self):
        raw = (
            FULL_HEADER
            + f"{ACCOUNT_ID},Loan A,Jane Doe,1000.00,0.05,15,active,2026-01-01,"
              f"1,2026-01-15,50.00,1000.00,5.00,955.00,2026-01-31,manual\n"
            + f"{ACCOUNT_ID},Loan A,Jane Doe,1000.00,0.05,15,active,2026-01-01,"
              f"2,2026-01-31,50.00,955.00,4.78,909.78,2026-02-15,manual\n"
        ).encode()
        parsed = NativeCsvParser.parse(raw)
        assert len(parsed.accounts) == 1  # deduplicated across the two rows
        assert len(parsed.payments) == 2
        assert parsed.errors == []

    def test_account_with_no_payments_yet(self):
        raw = (
            FULL_HEADER
            + f"{ACCOUNT_ID},Loan A,Jane Doe,1000.00,0.05,15,open,2026-01-01,"
              f",,,,,,,\n"
        ).encode()
        parsed = NativeCsvParser.parse(raw)
        assert len(parsed.accounts) == 1
        assert parsed.payments == []
        assert parsed.errors == []


class TestMalformedRows:
    def test_missing_required_account_fields_is_an_error(self):
        raw = (
            ACCOUNTS_HEADER
            + ",Loan A,Jane Doe,,,15,open,,,,2026-01-01T00:00:00\n"  # no id, no amount
        ).encode()
        parsed = NativeCsvParser.parse(raw)
        assert parsed.accounts == []
        assert len(parsed.errors) == 1
