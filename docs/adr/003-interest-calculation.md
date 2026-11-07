# ADR-003: Interest Calculation Engine

**Status:** Accepted  
**Date:** 2026-06-15

## Context
Loan interest must be calculated consistently across account creation, payment recording, and balance display. Off-by-one errors in cycle counting cause incorrect balances.

## Decision
`interest_engine.py` lives in `modules/accounts/` — it is domain logic, not infrastructure. `project_ledger()` is the single source of truth: it replays the full payment history to derive the authoritative balance at any point in time.

## Rationale
Keeping a running balance in the DB invites drift when payments are deleted or backdated. Replaying from immutable payment records is slower but always correct. For the scale of this tool (hundreds of payments, not millions), replay cost is negligible.

## Consequences
- Deleting a payment automatically corrects subsequent balances on next query.
- `project_ledger()` must be called with the complete payment history — partial lists give wrong results.

## Update (2026-10-24)
Behaviour the decision implies but the original text did not state (details and examples in [architecture.md](../architecture.md#domain-model-and-interest-rules)):
- `rate` is applied **per cycle** (twice a month) and **compounds**: each cycle's interest is computed on the previous closing balance, including unpaid interest.
- A payment reduces the closing balance of its cycle but not that cycle's interest.
- An account whose `start_date` is itself the 15th or 30th accrues that cycle's interest immediately. This is intentional (covered by a test).
- `PaymentService.add_payment` and `recalculate_ledger` both derive balances from `project_ledger`, as this ADR requires. `compute_payment_ledger_entry` in the engine has no callers (not even tests) and is a candidate for removal; do not use it for new code.
- `backend/app/core/interest_engine.py` is an unused, byte-identical copy of `modules/accounts/interest_engine.py`. Only the latter is imported; keep edits there.

## Update (2026-11-05): one definition of "current balance", and imported history as an anchor
- **Current balance** (`compute_current_balance`, the single source for the accounts list, dashboard and detail page) is the closing balance of the last cycle that has closed, minus any payment made since. Per the rule above a payment still does not reduce the interest of the cycle it falls in, but the borrower owes less the moment they pay, so it comes off the outstanding balance immediately. The detail page no longer derives its own figure from the last payment's `balance_after`.
- **Imported history is an anchor, not something to replay.** Imported payments carry the interest that was actually charged (ADR-004); applying today's `rate` per cycle from the disbursement cannot reproduce it, and after payoff keeps compounding. `ledger_anchor()` returns the last imported payment's recorded `balance_after`, and `project_ledger(..., anchor=...)` / `compute_current_balance(..., anchor=...)` continue from there under the normal rules. Payments dated on or before the anchor are treated as already reflected in it. An imported row's interest belongs to the *nearest* cycle (a tie goes to the later one), so the anchor date is that cycle when it is not before the payment: an import dated Sep 26 anchors at Sep 30 and replay resumes at Oct 15 instead of charging Sep 30 twice. When the nearest cycle is the earlier one (Sep 20 → Sep 15) the anchor stays on the payment's own date, so Sep 30 is the next cycle charged, on the recorded balance.
- The anchor is used everywhere the ledger is replayed: balance display, `add_payment`, `recalculate_ledger` and the `cycle.closed` webhook. `recalculate_ledger` re-chains imported payments from their recorded interest instead of replaying them through `project_ledger`, which would overwrite imported history.
- `add_payment` rejects (422) a payment dated on or before the last imported payment, mirroring the importer's own refusal to insert before existing history.
- Known and not changed here: a payment's *stored* `balance_before`/`balance_after` ignores earlier payments in the same still-open period (e.g. two payments between the same two cycle dates), so the per-payment table can disagree with the current balance in that case. The current balance itself is correct.
