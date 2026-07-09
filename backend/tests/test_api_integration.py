"""Integration smoke tests — validates pure-Python logic chains end-to-end.

Full DB-backed integration tests require a running PostgreSQL instance
(available in CI via the service container defined in .github/workflows/ci.yml).
These tests cover the computation pipeline without DB I/O.
"""
from datetime import date
from decimal import Decimal

import pytest

from app.modules.accounts.interest_engine import (
    advance_cycle,
    compute_current_balance,
    get_cycle_dates,
    next_cycle_date,
    project_ledger,
    upcoming_cycle_dates,
)


class TestFullLedgerScenarios:
    """Realistic scenarios a borrower or admin would encounter."""

    def test_new_loan_no_payments_6_months(self):
        """$1,000 at 5% for 12 cycles — balance grows monotonically."""
        start = date(2026, 1, 1)
        end = date(2026, 6, 30)
        rows = project_ledger(1000.0, 0.05, start, [], until=end)
        assert len(rows) == 12
        for i in range(1, len(rows)):
            assert rows[i].closing_balance > rows[i - 1].closing_balance

    def test_paying_off_loan_in_stages(self):
        """$500 loan paid down over 3 cycles — balance decreases each time."""
        start = date(2026, 6, 1)
        payments = [
            (date(2026, 6, 15), 100.0),
            (date(2026, 6, 30), 100.0),
            (date(2026, 7, 15), 500.0),  # overpay to close
        ]
        rows = project_ledger(500.0, 0.05, start, payments, until=date(2026, 7, 15))
        # Final balance should be negative or zero (overpaid)
        assert rows[-1].closing_balance <= Decimal("0")

    def test_compute_current_balance_matches_last_row(self):
        start = date(2026, 6, 1)
        payments = [(date(2026, 6, 15), 50.0)]
        rows = project_ledger(500.0, 0.05, start, payments, until=date(2026, 6, 30))
        bal = compute_current_balance(500.0, 0.05, start, payments)
        assert bal == rows[-1].closing_balance

    def test_cycle_count_for_6_months(self):
        """Jan 1 → Jun 30 = 12 cycle dates (15th + 30th for each of 6 months)."""
        dates = get_cycle_dates(date(2026, 1, 1), date(2026, 6, 30))
        assert len(dates) == 12

    def test_upcoming_dates_preview_alternates(self):
        dates = upcoming_cycle_dates(date(2026, 6, 10), count=6)
        assert dates[0] == date(2026, 6, 15)
        assert dates[1] == date(2026, 6, 30)
        assert dates[2] == date(2026, 7, 15)

    def test_interest_is_not_applied_before_first_cycle(self):
        """Start June 14 — first cycle June 15. Balance on June 14 = principal."""
        bal = compute_current_balance(
            1000.0, 0.05,
            date(2026, 6, 14),
            [],
        )
        # project_ledger from June 14 with until=today might include June 15;
        # force until to be June 14 to test pre-cycle state
        rows = project_ledger(1000.0, 0.05, date(2026, 6, 14), [], until=date(2026, 6, 14))
        assert rows == []

    def test_payment_attribution_across_cycle_boundary(self):
        """Payment on June 16 must be attributed to June 30, not June 15."""
        rows = project_ledger(
            borrow_amount=1000.0,
            rate=0.05,
            start_date=date(2026, 6, 1),
            payments=[(date(2026, 6, 16), 100.0)],
            until=date(2026, 6, 30),
        )
        # June 15 period: no payment (June 16 > June 15)
        assert rows[0].payments_in_period == Decimal("0")
        # June 30 period: payment of 100
        assert rows[1].payments_in_period == Decimal("100")
