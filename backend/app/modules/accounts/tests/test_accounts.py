"""Unit tests — interest_engine (pure, no DB needed)."""
from datetime import date
from decimal import Decimal

import pytest

from app.modules.accounts.interest_engine import (
    advance_cycle,
    compute_current_balance,
    get_cycle_dates,
    get_next_due_date,
    next_cycle_date,
    project_ledger,
    upcoming_cycle_dates,
)


# ── next_cycle_date ──────────────────────────────────────────────────────────

class TestNextCycleDate:
    def test_before_15th_returns_15th(self):
        assert next_cycle_date(date(2026, 6, 3)) == date(2026, 6, 15)

    def test_on_15th_returns_same(self):
        assert next_cycle_date(date(2026, 6, 15)) == date(2026, 6, 15)

    def test_between_15_and_30_returns_30th(self):
        assert next_cycle_date(date(2026, 6, 20)) == date(2026, 6, 30)

    def test_on_30th_returns_same(self):
        assert next_cycle_date(date(2026, 6, 30)) == date(2026, 6, 30)

    def test_past_30th_returns_next_15th(self):
        assert next_cycle_date(date(2026, 7, 1)) == date(2026, 7, 15)

    def test_february_short_month(self):
        # Feb has no 30th — should return Feb 28 (2025 is not leap)
        assert next_cycle_date(date(2025, 2, 16)) == date(2025, 2, 28)

    def test_december_to_january(self):
        assert next_cycle_date(date(2026, 12, 31)) == date(2027, 1, 15)


# ── advance_cycle ─────────────────────────────────────────────────────────────

class TestAdvanceCycle:
    def test_15th_to_30th(self):
        assert advance_cycle(date(2026, 6, 15)) == date(2026, 6, 30)

    def test_30th_to_next_15th(self):
        assert advance_cycle(date(2026, 6, 30)) == date(2026, 7, 15)

    def test_december_30th_to_jan_15th(self):
        assert advance_cycle(date(2026, 12, 30)) == date(2027, 1, 15)

    def test_february_short_month(self):
        # Feb 28 (the "30th" equivalent) → Mar 15
        assert advance_cycle(date(2025, 2, 28)) == date(2025, 3, 15)


# ── get_next_due_date ─────────────────────────────────────────────────────────

class TestGetNextDueDate:
    def test_on_cycle_date_returns_next(self):
        # If reference IS a cycle date, next due is the following one
        assert get_next_due_date(date(2026, 6, 15)) == date(2026, 6, 30)

    def test_between_cycles_returns_upcoming(self):
        assert get_next_due_date(date(2026, 6, 20)) == date(2026, 6, 30)


# ── get_cycle_dates ───────────────────────────────────────────────────────────

class TestGetCycleDates:
    def test_two_cycles_in_june(self):
        dates = get_cycle_dates(date(2026, 6, 1), date(2026, 6, 30))
        assert dates == [date(2026, 6, 15), date(2026, 6, 30)]

    def test_empty_when_until_before_first_cycle(self):
        dates = get_cycle_dates(date(2026, 6, 14), date(2026, 6, 14))
        assert dates == []

    def test_start_on_cycle_date_excludes_it(self):
        # start_date is not a payment date itself; first cycle is the NEXT one after it
        dates = get_cycle_dates(date(2026, 6, 15), date(2026, 6, 30))
        assert dates == [date(2026, 6, 30)]


# ── project_ledger ────────────────────────────────────────────────────────────

class TestProjectLedger:
    def test_no_payments_accrues_interest_each_cycle(self):
        rows = project_ledger(
            borrow_amount=1000.0,
            rate=0.05,
            start_date=date(2026, 6, 1),
            payments=[],
            until=date(2026, 6, 30),
        )
        assert len(rows) == 2
        # Cycle 1: June 15 — interest on 1000 @ 5% = 50
        assert rows[0].interests_accrued == Decimal("50.00")
        assert rows[0].closing_balance == Decimal("1050.00")
        # Cycle 2: June 30 — interest on 1050 @ 5% = 52.50
        assert rows[1].interests_accrued == Decimal("52.50")
        assert rows[1].closing_balance == Decimal("1102.50")

    def test_payment_reduces_next_cycle_balance(self):
        rows = project_ledger(
            borrow_amount=1000.0,
            rate=0.05,
            start_date=date(2026, 6, 1),
            payments=[(date(2026, 6, 15), 200.0)],
            until=date(2026, 6, 30),
        )
        # Cycle 1 (June 15): 1000 * 5% = 50 interest, payment = 200 → closing = 850
        assert rows[0].closing_balance == Decimal("850.00")
        # Cycle 2 (June 30): 850 * 5% = 42.50 → closing = 892.50
        assert rows[1].closing_balance == Decimal("892.50")

    def test_empty_when_until_before_start(self):
        rows = project_ledger(
            borrow_amount=1000.0, rate=0.05,
            start_date=date(2026, 6, 15),
            payments=[],
            until=date(2026, 6, 14),
        )
        assert rows == []

    def test_payment_between_cycles_applied_to_correct_cycle(self):
        """Payment on June 20 (between June 15 and June 30 cycle dates)
        should reduce the June 30 cycle, not June 15."""
        rows = project_ledger(
            borrow_amount=1000.0,
            rate=0.05,
            start_date=date(2026, 6, 1),
            payments=[(date(2026, 6, 20), 100.0)],
            until=date(2026, 6, 30),
        )
        # June 15: no payment in period (June 20 > June 15) → closing = 1050
        assert rows[0].payments_in_period == Decimal("0")
        assert rows[0].closing_balance == Decimal("1050.00")
        # June 30: 100 payment applied → 1050 * 5% = 52.50 → 1050 + 52.50 - 100 = 1002.50
        assert rows[1].payments_in_period == Decimal("100")
        assert rows[1].closing_balance == Decimal("1002.50")


# ── compute_current_balance ───────────────────────────────────────────────────

class TestComputeCurrentBalance:
    def test_no_payments_returns_principal_when_no_cycles(self):
        bal = compute_current_balance(500.0, 0.05, date(2026, 6, 14), [])
        # No cycle dates before/on June 14 (start is June 14, next cycle is June 15)
        assert bal == Decimal("500")

    def test_with_full_payment_returns_zero(self):
        # Pay exactly principal + interest after one cycle
        bal = compute_current_balance(
            1000.0, 0.05,
            date(2026, 6, 1),
            [(date(2026, 6, 15), 1050.0)],
        )
        assert bal == Decimal("0.00")

    def test_overpayment_returns_negative(self):
        bal = compute_current_balance(
            1000.0, 0.05,
            date(2026, 6, 1),
            [(date(2026, 6, 15), 2000.0)],
        )
        assert bal < Decimal("0")


# ── upcoming_cycle_dates ──────────────────────────────────────────────────────

class TestUpcomingCycleDates:
    def test_returns_requested_count(self):
        dates = upcoming_cycle_dates(date(2026, 6, 1), count=4)
        assert len(dates) == 4

    def test_first_date_is_next_cycle(self):
        dates = upcoming_cycle_dates(date(2026, 6, 10), count=1)
        assert dates[0] == date(2026, 6, 15)

    def test_alternates_15th_and_30th(self):
        dates = upcoming_cycle_dates(date(2026, 6, 1), count=6)
        assert dates[0].day == 15
        assert dates[1].day == 30
        assert dates[2].day == 15
