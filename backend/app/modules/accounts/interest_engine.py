"""
Interest calculation engine.

Rules:
- Cycle dates are the 15th and 30th of every month.
  Months with fewer than 30 days use the last day instead of the 30th.
- Interest accrues only on cycle dates, applied to the opening balance.
- Payments between cycle dates are recorded with their actual date but
  only reduce the balance that feeds the *next* cycle's interest calculation.
- The reference point for the first cycle is account.start_date, not
  the first payment date.
- Auto payments default to the next upcoming cycle date.

This module is pure (no DB, no FastAPI imports) so it can be imported by
both the accounts and payments modules without creating circular imports.
"""

import calendar
from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_UP, Decimal


# ── Cycle date primitives ───────────────────────────────────────────────────

def _month_thirtieth(year: int, month: int) -> date:
    """Return the 30th of a month, or its last day if the month is shorter."""
    last_day = calendar.monthrange(year, month)[1]
    return date(year, month, min(30, last_day))


def next_cycle_date(from_date: date) -> date:
    """
    Return the next cycle date (15th or 30th) on or after *from_date*.

    Examples:
        June 3  → June 15
        June 15 → June 15   (same day counts)
        June 16 → June 30
        June 30 → June 30   (same day counts)
        July 1  → July 15
        Feb 16  → Feb 28 (non-leap) / Feb 29 (leap)
        Jan 31  → Feb 15   (past the thirtieth, advance to next 15th)
    """
    y, m, d = from_date.year, from_date.month, from_date.day

    if d <= 15:
        return date(y, m, 15)

    thirtieth = _month_thirtieth(y, m)
    if from_date <= thirtieth:
        return thirtieth

    # Past the thirtieth: move to the 15th of the next month
    if m == 12:
        return date(y + 1, 1, 15)
    return date(y, m + 1, 15)


def advance_cycle(current: date) -> date:
    """
    Given a cycle date, return the following cycle date.

    15th → 30th of same month
    30th → 15th of next month
    """
    if current.day == 15:
        return _month_thirtieth(current.year, current.month)

    # current is a "thirtieth" (could be 28/29 in short months)
    if current.month == 12:
        return date(current.year + 1, 1, 15)
    return date(current.year, current.month + 1, 15)


def get_cycle_dates(start_date: date, until: date) -> list[date]:
    """
    Return all cycle dates from the first one after *start_date* up to *until*.
    """
    cycles: list[date] = []
    current = next_cycle_date(start_date)
    while current <= until:
        cycles.append(current)
        current = advance_cycle(current)
    return cycles


def get_next_due_date(reference: date) -> date:
    """
    Return the next cycle date strictly *after* reference.
    Used to compute next_due_date when recording a payment.
    """
    candidate = next_cycle_date(reference)
    if candidate == reference:
        return advance_cycle(candidate)
    return candidate


def upcoming_cycle_dates(from_date: date, count: int = 6) -> list[date]:
    """Return the next *count* upcoming cycle dates for frontend preview."""
    dates: list[date] = []
    current = next_cycle_date(from_date)
    for _ in range(count):
        dates.append(current)
        current = advance_cycle(current)
    return dates


# ── Ledger calculation ──────────────────────────────────────────────────────

@dataclass
class CycleRow:
    cycle_date: date
    opening_balance: Decimal
    interests_accrued: Decimal
    payments_in_period: Decimal
    closing_balance: Decimal


def _dec(value) -> Decimal:
    return Decimal(str(value))


def _round2(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def project_ledger(
    borrow_amount: float,
    rate: float,
    start_date: date,
    payments: list[tuple[date, float]],  # (payment_date, amount)
    until: date | None = None,
) -> list[CycleRow]:
    """
    Project the full ledger from start_date to *until* (defaults to today).

    Each CycleRow represents one billing cycle. Payments are bucketed into
    the period whose cycle_date is the first cycle date >= payment_date.
    A payment that falls exactly on a cycle date is attributed to that cycle.
    """
    if until is None:
        until = date.today()

    cycle_dates = get_cycle_dates(start_date, until)
    if not cycle_dates:
        return []

    # prev_boundaries[i] = the cycle date before cycle_dates[i], or start_date for i=0
    prev_boundaries: list[date] = [start_date] + cycle_dates[:-1]

    sorted_payments = sorted(payments, key=lambda p: p[0])

    rows: list[CycleRow] = []
    balance = _dec(borrow_amount)

    for i, cycle_date in enumerate(cycle_dates):
        prev = prev_boundaries[i]

        period_payments = _dec(
            sum(
                amt
                for pdate, amt in sorted_payments
                if prev < pdate <= cycle_date
            )
        )

        interest = _round2(balance * _dec(rate))
        closing = _round2(balance + interest - period_payments)

        rows.append(
            CycleRow(
                cycle_date=cycle_date,
                opening_balance=_round2(balance),
                interests_accrued=interest,
                payments_in_period=period_payments,
                closing_balance=closing,
            )
        )

        balance = closing

    return rows


def compute_current_balance(
    borrow_amount: float,
    rate: float,
    start_date: date,
    payments: list[tuple[date, float]],
) -> Decimal:
    """Return the current outstanding balance."""
    rows = project_ledger(borrow_amount, rate, start_date, payments)
    if not rows:
        return _dec(borrow_amount)
    return rows[-1].closing_balance


def compute_payment_ledger_entry(
    balance_before: Decimal,
    rate: Decimal,
    payment_amount: Decimal,
    payment_date: date,
    last_cycle_date: date | None,
    start_date: date,
) -> dict:
    """
    Compute the ledger snapshot for a single incoming payment.

    Interest is only accrued if *payment_date* lands on a cycle date AND
    that cycle date has not already been processed (i.e., it's after the
    last recorded cycle).

    Returns a dict with keys: balance_before, interests_accrued, balance_after
    """
    reference = last_cycle_date if last_cycle_date else start_date
    cycle = next_cycle_date(reference)

    on_cycle = payment_date >= cycle
    interest = _round2(balance_before * _dec(rate)) if on_cycle else Decimal("0.00")

    balance_after = _round2(balance_before + interest - payment_amount)

    return {
        "balance_before": _round2(balance_before),
        "interests_accrued": interest,
        "balance_after": balance_after,
    }
