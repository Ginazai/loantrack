"""Unit tests — interest_engine (pure, no DB needed)."""

from datetime import date
from decimal import Decimal

import pytest

from app.modules.accounts.interest_engine import (
    advance_cycle,
    balance_as_of,
    compute_current_balance,
    get_cycle_dates,
    get_next_due_date,
    ledger_anchor,
    nearest_cycle_date,
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

    def test_start_on_cycle_date_includes_it(self):
        # next_cycle_date is documented as "on or after" (see its docstring:
        # "June 15 -> June 15, same day counts") — add_payment's own auto-date
        # logic relies on this and explicitly guards against it staying put
        # (advancing again if payment_date <= last_cycle), so this is
        # intentional behavior to preserve, not a bug to "fix" by excluding it.
        dates = get_cycle_dates(date(2026, 6, 15), date(2026, 6, 30))
        assert dates == [date(2026, 6, 15), date(2026, 6, 30)]


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
            borrow_amount=1000.0,
            rate=0.05,
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


class TestPaymentOnStartDate:
    def test_payment_on_the_start_date_reduces_the_balance(self):
        # Start on a cycle date and pay the same day: the payment belongs to the
        # first period. It used to fall outside every period (prev < pdate was
        # false for the first one) and was silently ignored.
        rows = project_ledger(
            100.0, 0.0, date(2026, 1, 15), [(date(2026, 1, 15), 30.0)], until=date(2026, 1, 30)
        )
        assert rows[0].payments_in_period == Decimal("30")
        assert rows[-1].closing_balance == Decimal("70.00")

    def test_payment_on_start_date_off_cycle_counts_toward_first_cycle(self):
        rows = project_ledger(
            100.0, 0.0, date(2026, 1, 3), [(date(2026, 1, 3), 30.0)], until=date(2026, 1, 15)
        )
        assert rows[-1].closing_balance == Decimal("70.00")

    def test_payment_is_not_counted_twice_across_periods(self):
        rows = project_ledger(
            100.0, 0.0, date(2026, 1, 15), [(date(2026, 1, 15), 30.0)], until=date(2026, 3, 15)
        )
        assert sum(r.payments_in_period for r in rows) == Decimal("30")


class TestComputeCurrentBalance:
    def test_no_payments_returns_principal_when_no_cycles(self):
        # compute_current_balance has no explicit `until` — it always
        # projects to *today* — so the start_date here must stay in the
        # future relative to whenever this test actually runs, or interest
        # accrues on every cycle between a fixed past date and today and
        # this assertion goes stale. A fixed far-future date sidesteps that
        # without needing to mock "today".
        bal = compute_current_balance(500.0, 0.05, date(2099, 6, 14), [])
        assert bal == Decimal("500")

    def test_with_full_payment_returns_zero(self):
        # Pay exactly principal + interest after one cycle
        bal = compute_current_balance(
            1000.0,
            0.05,
            date(2026, 6, 1),
            [(date(2026, 6, 15), 1050.0)],
        )
        assert bal == Decimal("0.00")

    def test_overpayment_returns_negative(self):
        bal = compute_current_balance(
            1000.0,
            0.05,
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


# ── Current balance: one definition, native numbers pinned ───────────────────


class TestNativeBalancesAreUnchanged:
    """The rewrite of compute_current_balance must not move any native account's
    number when every payment sits on a cycle date (the only case where the old and new
    definitions can differ is a payment inside a still-open period)."""

    def test_matches_the_replayed_closing_balance(self):
        payments = [
            (date(2025, 1, 30), 100.0),
            (date(2025, 2, 15), 50.0),
            (date(2025, 4, 15), 80.0),
        ]
        for as_of in (date(2025, 3, 1), date(2025, 3, 15), date(2025, 4, 20), date(2025, 6, 30)):
            expected = project_ledger(1000.0, 0.05, date(2025, 1, 1), payments, until=as_of)[
                -1
            ].closing_balance
            got = compute_current_balance(1000.0, 0.05, date(2025, 1, 1), payments, as_of=as_of)
            assert got == expected, as_of

    def test_no_payments_is_pure_compounding(self):
        # 1000 -> 1050 (Jan 15) -> 1102.50 (Jan 30)
        got = compute_current_balance(1000.0, 0.05, date(2025, 1, 1), [], as_of=date(2025, 1, 30))
        assert got == Decimal("1102.50")


class TestPaymentInAnOpenPeriod:
    START = date(2025, 1, 1)  # first cycle closes Jan 15: 1000 -> 1050.00

    def test_payment_reduces_the_balance_immediately(self):
        got = compute_current_balance(
            1000.0, 0.05, self.START, [(date(2025, 1, 20), 40.0)], as_of=date(2025, 1, 25)
        )
        assert got == Decimal("1010.00")  # 1050 - 40, not 1050 until Jan 30

    def test_it_does_not_reduce_that_cycles_interest(self):
        # ADR-003: when the cycle closes, interest is still charged on the 1050
        # opening balance: 1050 + 52.50 - 40
        got = compute_current_balance(
            1000.0, 0.05, self.START, [(date(2025, 1, 20), 40.0)], as_of=date(2025, 1, 30)
        )
        assert got == Decimal("1062.50")

    def test_before_the_first_cycle_closes(self):
        got = compute_current_balance(
            100.0, 0.05, date(2025, 1, 20), [(date(2025, 1, 20), 30.0)], as_of=date(2025, 1, 25)
        )
        assert got == Decimal("70.00")


class TestAnchoredLedger:
    ANCHOR = (date(2025, 2, 15), Decimal("500.00"))  # an imported, recorded balance

    def test_replay_starts_at_the_anchor_not_the_disbursement(self):
        rows = project_ledger(
            1000.0, 0.05, date(2025, 1, 1), [], until=date(2025, 3, 15), anchor=self.ANCHOR
        )
        assert [r.cycle_date for r in rows] == [date(2025, 2, 28), date(2025, 3, 15)]
        assert rows[0].opening_balance == Decimal("500.00")
        assert rows[0].closing_balance == Decimal("525.00")

    def test_anchor_on_a_cycle_date_is_not_charged_interest_twice(self):
        rows = project_ledger(
            1000.0, 0.05, date(2025, 1, 1), [], until=date(2025, 2, 15), anchor=self.ANCHOR
        )
        assert rows == []  # Feb 15's interest is already inside the recorded balance

    def test_payments_inside_the_recorded_history_are_ignored(self):
        payments = [
            (date(2025, 1, 30), 100.0),
            (date(2025, 2, 15), 70.0),
            (date(2025, 2, 20), 25.0),
        ]
        got = compute_current_balance(
            1000.0, 0.05, date(2025, 1, 1), payments, anchor=self.ANCHOR, as_of=date(2025, 2, 28)
        )
        assert got == Decimal("500.00")  # 500 + 25.00 interest - 25 paid Feb 20

    def test_balance_grows_from_the_anchor_at_the_current_rate(self):
        got = compute_current_balance(
            1000.0, 0.05, date(2025, 1, 1), [], anchor=self.ANCHOR, as_of=date(2025, 3, 15)
        )
        assert got == Decimal("551.25")  # 500 -> 525 -> 551.25

    def test_without_an_anchor_the_same_inputs_give_a_different_answer(self):
        # This is the imported-account bug: replaying from the disbursement.
        plain = compute_current_balance(1000.0, 0.05, date(2025, 1, 1), [], as_of=date(2025, 3, 15))
        assert plain != Decimal("551.25")


@pytest.mark.parametrize(
    "d, expected",
    [
        (date(2026, 9, 11), date(2026, 9, 15)),
        (date(2026, 9, 15), date(2026, 9, 15)),  # on a cycle date
        (date(2026, 9, 20), date(2026, 9, 15)),
        (date(2026, 9, 26), date(2026, 9, 30)),
        (date(2026, 10, 31), date(2026, 10, 30)),  # past the 30th, still nearest to it
        (date(2026, 1, 3), date(2025, 12, 30)),  # year wrap: Dec 30 is 4 days away, Jan 15 is 12
        (date(2026, 2, 7), date(2026, 2, 15)),  # Jan 30 / Feb 15 tie goes to the later cycle
        (date(2026, 2, 6), date(2026, 1, 30)),
        (date(2026, 3, 2), date(2026, 2, 28)),  # short month: Feb 28 is its "30th"
    ],
)
def test_nearest_cycle_date(d, expected):
    assert nearest_cycle_date(d) == expected


class _P:
    def __init__(self, d, method, after):
        self.payment_date, self.method, self.balance_after = d, method, after


class TestLedgerAnchor:
    def test_none_when_nothing_was_imported(self):
        assert ledger_anchor([_P(date(2025, 1, 15), "auto", Decimal("1"))]) is None
        assert ledger_anchor([]) is None

    def test_is_the_last_imported_payment(self):
        ps = [
            _P(date(2025, 1, 15), "import", Decimal("90.00")),
            _P(date(2025, 2, 15), "import", Decimal("80.00")),
            _P(date(2025, 3, 15), "manual", Decimal("70.00")),
        ]
        assert ledger_anchor(ps) == (date(2025, 2, 15), Decimal("80.00"))

    def test_import_nearer_the_later_cycle_is_anchored_at_that_cycle(self):
        # Sep 26 is closer to Sep 30 than Sep 15, and the imported row's balance_after
        # already carries that cycle's interest.
        ps = [_P(date(2026, 9, 26), "import", Decimal("410.00"))]
        assert ledger_anchor(ps) == (date(2026, 9, 30), Decimal("410.00"))

    def test_import_nearer_the_earlier_cycle_keeps_its_own_date(self):
        # Sep 20 is closer to Sep 15; anchoring at Sep 15 would re-apply the payment, so
        # the anchor stays on Sep 20 and Sep 30 is the next cycle charged.
        ps = [_P(date(2026, 9, 20), "import", Decimal("410.00"))]
        assert ledger_anchor(ps) == (date(2026, 9, 20), Decimal("410.00"))
        rows = project_ledger(
            410.0, 0.05, date(2026, 1, 1), [], until=date(2026, 9, 30), anchor=ledger_anchor(ps)
        )
        assert [(r.cycle_date, r.interests_accrued) for r in rows] == [
            (date(2026, 9, 30), Decimal("20.50"))
        ]

    def test_off_cycle_import_does_not_charge_its_cycle_twice(self):
        # Regression: Oct 15 opened at 430.50 and charged 21.53 instead of 410 / 20.50.
        anchor = ledger_anchor([_P(date(2026, 9, 26), "import", Decimal("410.00"))])
        rows = project_ledger(
            410.0,
            0.05,
            date(2026, 1, 1),
            [(date(2026, 10, 15), 20.5)],
            until=date(2026, 10, 15),
            anchor=anchor,
        )
        assert [r.cycle_date for r in rows] == [date(2026, 10, 15)]
        assert rows[0].opening_balance == Decimal("410.00")
        assert rows[0].interests_accrued == Decimal("20.50")
        assert rows[0].closing_balance == Decimal("410.00")

class TestFutureDatedPayments:
    START = date(2026, 11, 1)
    TODAY = date(2026, 11, 6)
    PAYMENTS = [(date(2026, 11, 15), 25.0), (date(2026, 11, 30), 130.0)]

    def test_balance_as_of_today_alone_ignores_future_payments(self):
        got = compute_current_balance(150.0, 0.05, self.START, self.PAYMENTS, as_of=self.TODAY)
        assert got == Decimal("150.00")

    def test_balance_matches_ledger_last_balance_after(self):
        as_of = balance_as_of([d for d, _ in self.PAYMENTS], today=self.TODAY)
        assert as_of == date(2026, 11, 30)
        got = compute_current_balance(150.0, 0.05, self.START, self.PAYMENTS, as_of=as_of)
        assert got == Decimal("9.13")

    def test_single_future_payment(self):
        as_of = balance_as_of([date(2026, 11, 15)], today=self.TODAY)
        got = compute_current_balance(
            150.0, 0.05, self.START, [(date(2026, 11, 15), 25.0)], as_of=as_of
        )
        assert got == Decimal("132.50")

    def test_past_payments_do_not_move_the_evaluation_date(self):
        today = date(2026, 12, 20)
        assert balance_as_of([date(2026, 11, 15), date(2026, 11, 30)], today=today) == today

    def test_no_payments_evaluates_as_of_today(self):
        assert balance_as_of([], today=self.TODAY) == self.TODAY
