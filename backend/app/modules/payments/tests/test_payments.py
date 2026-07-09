"""Unit tests — payment calculation logic (no DB)."""
from datetime import date
from decimal import Decimal

import pytest

from app.modules.accounts.interest_engine import project_ledger, CycleRow


class TestPaymentInterestAccuracy:
    """Verify interest is applied exactly once per cycle — not compounded mid-cycle."""

    def test_payment_on_cycle_date_correct_interest(self):
        """Principal 15, rate 5%, one cycle — interest must be exactly 0.75."""
        rows = project_ledger(
            borrow_amount=15.0,
            rate=0.05,
            start_date=date(2026, 6, 14),
            payments=[(date(2026, 6, 15), 5.0)],
            until=date(2026, 6, 15),
        )
        assert len(rows) == 1
        row = rows[0]
        assert row.interests_accrued == Decimal("0.75")
        # 15.00 + 0.75 - 5.00 = 10.75
        assert row.closing_balance == Decimal("10.75")

    def test_multiple_payments_no_interest_duplication(self):
        """Two payments across two cycles — each cycle applies rate once."""
        rows = project_ledger(
            borrow_amount=100.0,
            rate=0.10,
            start_date=date(2026, 6, 1),
            payments=[
                (date(2026, 6, 15), 20.0),
                (date(2026, 6, 30), 20.0),
            ],
            until=date(2026, 6, 30),
        )
        assert len(rows) == 2
        # Cycle 1: 100 * 10% = 10, payment 20 → closing = 90
        assert rows[0].interests_accrued == Decimal("10.00")
        assert rows[0].closing_balance == Decimal("90.00")
        # Cycle 2: 90 * 10% = 9, payment 20 → closing = 79
        assert rows[1].interests_accrued == Decimal("9.00")
        assert rows[1].closing_balance == Decimal("79.00")

    def test_no_payment_balance_grows_with_interest(self):
        rows = project_ledger(
            borrow_amount=500.0,
            rate=0.05,
            start_date=date(2026, 6, 1),
            payments=[],
            until=date(2026, 6, 30),
        )
        # Cycle 1: 500 * 0.05 = 25 → 525
        assert rows[0].closing_balance == Decimal("525.00")
        # Cycle 2: 525 * 0.05 = 26.25 → 551.25
        assert rows[1].closing_balance == Decimal("551.25")

    def test_rounding_to_two_decimal_places(self):
        """Rate that produces repeating decimal — must round to 2dp."""
        rows = project_ledger(
            borrow_amount=10.0,
            rate=1 / 3,  # 33.333...%
            start_date=date(2026, 6, 1),
            payments=[],
            until=date(2026, 6, 15),
        )
        # 10 * 0.3333... = 3.333... → should round to 3.33
        assert rows[0].interests_accrued == Decimal("3.33")

    def test_payment_larger_than_balance_results_in_negative(self):
        rows = project_ledger(
            borrow_amount=100.0,
            rate=0.05,
            start_date=date(2026, 6, 1),
            payments=[(date(2026, 6, 15), 200.0)],
            until=date(2026, 6, 15),
        )
        # 100 + 5 - 200 = -95
        assert rows[0].closing_balance == Decimal("-95.00")


class TestCycleRowStructure:
    def test_row_fields_populated(self):
        rows = project_ledger(
            borrow_amount=1000.0,
            rate=0.05,
            start_date=date(2026, 6, 1),
            payments=[],
            until=date(2026, 6, 15),
        )
        row = rows[0]
        assert isinstance(row, CycleRow)
        assert row.cycle_date == date(2026, 6, 15)
        assert row.opening_balance == Decimal("1000.00")
        assert row.payments_in_period == Decimal("0")
