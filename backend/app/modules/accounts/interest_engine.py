"""
Interest calculation engine.

Rules:
- Cycle dates are the 15th and 30th of every month.
  Months with fewer than 30 days use the last day instead of the 30th.
- Interest accrues only on cycle dates, applied to the opening balance.
- ``rate`` is a fraction applied *per cycle* (twice a month), not per year,
  and interest compounds: each cycle's opening balance is the previous
  closing balance, unpaid interest included.
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
from datetime import date, timedelta
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
    Return all cycle dates from the first one on or after *start_date* up to
    *until* (inclusive).

    If *start_date* is itself the 15th or 30th, it is included, so that cycle's
    interest accrues on day zero. This is intentional (see
    ``test_start_on_cycle_date_includes_it``); approving a loan request on a
    cycle date relies on it too.
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


# (date, balance): a recorded balance that replay starts from instead of the loan's
# disbursement. See ``ledger_anchor``.
Anchor = tuple[date, "Decimal | float"]


def ledger_anchor(payments) -> Anchor | None:
    """Return the replay anchor for an account, or None if it has none.

    Imported history (ADR-004) carries the interest that was actually charged back
    then; it cannot be reproduced by applying today's ``rate`` per cycle, so replaying
    it from the disbursement gives a different (and, after payoff, ever-growing)
    balance. The recorded ``balance_after`` of the *last imported payment* is therefore
    taken as fact and replay continues from there under the normal rules.

    ``payments`` is any iterable of objects with ``payment_date``, ``method`` and
    ``balance_after`` (ORM rows or query rows), in chronological order. Payments dated
    on or before the anchor are considered already reflected in it.
    """
    last = None
    for p in payments:
        if p.method == "import":
            last = p
    if last is None:
        return None
    return (last.payment_date, last.balance_after)


def project_ledger(
    borrow_amount: float,
    rate: float,
    start_date: date,
    payments: list[tuple[date, float]],  # (payment_date, amount)
    until: date | None = None,
    anchor: Anchor | None = None,
) -> list[CycleRow]:
    """
    Project the full ledger from start_date to *until* (defaults to today).

    Each CycleRow represents one billing cycle. Payments are bucketed into
    the period whose cycle_date is the first cycle date >= payment_date.
    A payment that falls exactly on a cycle date is attributed to that cycle,
    and a payment on *start_date* is attributed to the first cycle.

    With an *anchor* ``(date, balance)`` replay starts from that recorded balance
    instead of from ``borrow_amount`` at ``start_date``. Interest through the anchor
    date is already inside the balance, so the first row is the first cycle strictly
    after it, and payments dated on or before it are ignored. (An off-cycle anchor
    means the next cycle charges interest on the post-payment balance: imported
    history does not say what the period opened at.)
    """
    if until is None:
        until = date.today()

    if anchor is not None:
        origin, balance = anchor[0], _dec(anchor[1])
        cycle_from = origin + timedelta(days=1)
        payments = [p for p in payments if p[0] > origin]
    else:
        origin, balance = start_date, _dec(borrow_amount)
        cycle_from = start_date

    cycle_dates = get_cycle_dates(cycle_from, until)
    if not cycle_dates:
        return []

    # prev_boundaries[i] = the cycle date before cycle_dates[i], or the origin for i=0
    prev_boundaries: list[date] = [origin] + cycle_dates[:-1]

    sorted_payments = sorted(payments, key=lambda p: p[0])

    rows: list[CycleRow] = []

    for i, cycle_date in enumerate(cycle_dates):
        prev = prev_boundaries[i]

        # Periods are (prev, cycle_date]. The first one starts at the origin itself, so
        # it is closed on the left: a payment made on the disbursement date belongs to
        # it. Otherwise it would match no period at all and vanish from the balance.
        period_payments = _dec(
            sum(
                amt
                for pdate, amt in sorted_payments
                if (prev <= pdate if i == 0 else prev < pdate) and pdate <= cycle_date
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
    *,
    anchor: Anchor | None = None,
    as_of: date | None = None,
) -> Decimal:
    """Return the outstanding balance as of *as_of* (default: today).

    This is the one definition of "current balance" shared by the list, the dashboard
    and the detail page: the closing balance of the last cycle that has closed, minus
    any payment made since. Per ADR-003 a payment does not reduce the interest of the
    cycle it falls in, but the borrower owes less the moment they pay, so it comes off
    the outstanding balance immediately rather than only when the cycle closes.
    """
    today = as_of if as_of is not None else date.today()
    rows = project_ledger(borrow_amount, rate, start_date, payments, until=today, anchor=anchor)

    if anchor is not None:
        live = [(d, a) for d, a in payments if d > anchor[0]]
        base = _dec(anchor[1])
    else:
        live = [(d, a) for d, a in payments if d >= start_date]
        base = _dec(borrow_amount)

    if rows:
        balance = rows[-1].closing_balance
        pending = [a for d, a in live if rows[-1].cycle_date < d <= today]
    else:
        balance = base
        pending = [a for d, a in live if d <= today]

    return _round2(balance - _dec(sum(pending)))


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

    NOTE: nothing in the app or its tests calls this function. Payment
    snapshots come from ``project_ledger`` (see ADR-003), which is the source of
    truth; prefer that for new code.

    Interest is accrued once if *payment_date* is on or after the first cycle
    date following *last_cycle_date* (or *start_date*). A payment made several
    cycles later still accrues only one cycle of interest here.

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
