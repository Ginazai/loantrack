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
