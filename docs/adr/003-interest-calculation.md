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
