# Architecture

How LoanTrack works, beyond what the code structure shows. Decisions and their reasoning are in [`adr/`](adr/); this page describes current behaviour. Statements were checked against the code on 2026-10-24. Anything not exercised at runtime is marked *(from code reading)*.

- [Domain model and interest rules](#domain-model-and-interest-rules)
- [Auth and permissions](#auth-and-permissions)
- [API surface](#api-surface)
- [Webhooks](#webhooks)
- [Background tasks](#background-tasks)
- [Cold starts on Render](#cold-starts-on-render)
- [Imports](#imports)
- [Known gaps](#known-gaps)

## Domain model and interest rules

Interest logic is pure and lives in `backend/app/modules/accounts/interest_engine.py` (rationale: [ADR-003](adr/003-interest-calculation.md)).

**Cycles.** A cycle closes on the **15th** and the **30th** of each month; in months shorter than 30 days the last day is used instead (Feb 28/29). The `cycle` column on `loan_accounts` (`15` or `30`) is stored and sent in webhook payloads, but the engine ignores it: every account uses both dates.

**Rate.** `rate` is a fraction applied **per cycle**, not per year: `0.05` means 5% on each of the two cycles every month. Valid range is `0 < rate ≤ 1`, four decimal places.

**Interest compounds.** At each cycle, `interest = round2(opening_balance × rate)` and `closing = opening + interest − payments_in_period`. Because the closing balance becomes the next opening balance, unpaid interest earns interest. Example, 1000.00 at 0.05 with no payments: 1050.00 → 1102.50 → 1157.63 → 1215.51.

**Payments and cycles.** A payment belongs to the first cycle whose date is on or after the payment date. It reduces that cycle's *closing* balance but does **not** reduce that cycle's interest, which is computed on the opening balance. A payment made on a cycle date therefore does not avoid that day's interest.

**A loan that starts on a cycle date accrues that cycle's interest immediately.** `get_cycle_dates` includes `start_date` itself when it falls on the 15th or 30th, so an account with `start_date = 2026-06-15` shows a full cycle of interest on day zero. This is intentional and tested (`test_start_on_cycle_date_includes_it`). It matters in one place in particular: approving a loan request creates the account with `start_date = today`, so approving on the 15th or 30th charges a cycle straight away.

**Balances are derived, never stored.** `project_ledger()` replays the borrowed amount, rate, start date and the *complete* payment list to produce one row per cycle. Passing a partial payment list gives wrong balances. `Payment` rows are append-only (create and delete, no update).

**Payment methods:** `auto` always dates the payment to the next cycle date after the account's most recent payment (or after `start_date` if none), **ignoring any `payment_date` sent with it**; `manual` uses the caller's date; `import` is created only by the import flow (the API does not accept it as input). Each payment stores a `balance_before` / `interests_accrued` / `balance_after` snapshot computed from `project_ledger` when it is recorded; deleting a payment triggers `recalculate_ledger`, which recomputes the snapshots of the remaining payments.

**Account status:** `open | active | paid | closed`. Only `closed` accounts can be purged by their owner; admins can force-purge any account (`DELETE /accounts/{id}?force=true`). Purging cascades to payments, attachments, webhooks and notifications.

**Payment attachments** (`jpg/png/webp/pdf`, ≤10 MB) are stored as `bytea` in Postgres and streamed through the API with the same access control as the payment ([ADR-005](adr/005-payment-attachment-storage.md)).

## Auth and permissions

- Login returns an access JWT (15 min, `type=access`, carries `role`) and a refresh JWT (7 days). Refresh tokens are stored **hashed** (SHA-256) and can be revoked; `POST /auth/logout` revokes **all** of the caller's unrevoked refresh tokens (every session, not just the current one).
- The frontend keeps both tokens in `localStorage` (Zustand `persist`, key `auth`). The axios interceptor in `frontend/src/api/client.ts` refreshes once on a 401 and redirects to login if that fails ([ADR-002](adr/002-auth-strategy.md)).
- Roles are `admin` and `user`. Admin-only routes use the `require_admin` dependency; everything else scopes data by owner (`user_id`) unless the caller is an admin.
- `POST /auth/register` requires an **admin** token (it is equivalent to `POST /admin/users`) and its body includes `role` (`admin` or `user`, default `user`). There is no self-service sign-up. Until 2026-10-24 this endpoint was public and trusted the `role` in the body, so anyone who could reach the API could create an admin.

## API surface

All paths are under `/api/v1`. Interactive docs: `/api/v1/docs`. "Owner" = the account's owning user; admins can act on any account.

| Area | Endpoints | Who |
|---|---|---|
| Health | `GET /health` | public |
| Auth | `POST /auth/register` (10/min), `POST /auth/login` (`AUTH_RATE_LIMIT_PER_MINUTE`, default 5/min), `POST /auth/refresh` (20/min), `POST /auth/logout`, `GET/PATCH /auth/me` | login/refresh public; **register admin-only**; rest any user |
| Accounts | `GET/POST /accounts`, `GET/PATCH /accounts/{id}`, `POST /accounts/{id}/close`, `DELETE /accounts/{id}`, `GET /accounts/{id}/cycle-preview` | owner or admin (`linked_user_id` on create is honoured for admins only) |
| Payments | `GET/POST /accounts/{id}/payments`, `DELETE …/{payment_id}` | owner or admin |
| Attachments | `GET/POST /accounts/{id}/payments/{pid}/attachments`, `GET/DELETE …/{attachment_id}` | owner or admin |
| Account webhooks | `GET/POST /accounts/{id}/webhooks`, `DELETE …/{webhook_id}` | owner or admin |
| Loan requests | `GET/POST /loan-requests`, `DELETE /loan-requests/{id}` | the requesting user (max 3 active; delete cancels, and only while the request is still pending) |
| Loan-request review | `GET /loan-requests/admin/all`, `GET …/admin/{id}/open`, `PATCH …/admin/{id}` | admin. Approving requires `rate` and `cycle` and creates the account. |
| Users | `GET/POST /admin/users`, `PATCH/DELETE /admin/users/{id}`, `GET /admin/users/{id}/accounts` | admin |
| Global webhooks | `GET/POST /admin/webhooks`, `PATCH/DELETE /admin/webhooks/{id}` | admin |
| Exports | `GET /admin/export/accounts.csv`, `…/payments.csv`, `…/accounts/{id}/full.csv` | admin |
| Imports | `POST /admin/imports/preview`, `GET /admin/imports`, `GET /admin/imports/{id}`, `POST /admin/imports/{id}/commit` | admin |
| Requests (admin) | `DELETE /admin/requests/{id}` | admin |

The generated OpenAPI spec is the source of truth for request/response shapes.

## Webhooks

A webhook config has a `target_url`, a list of `events`, and is either **per-account** (`account_id` set) or **global** (`account_id` null, admin-created, receives matching events for every account).

### Events

| Event | Emitted when | Payload fields |
|---|---|---|
| `account.created` / `account.updated` / `status.changed` / `account.purged` | the corresponding account action | `event, account_id, account_name, borrower_name, user_id, status, borrow_amount, rate, cycle, start_date` plus action-specific extras |
| `payment.added` | a payment is recorded through the API | `event, account_id, payment_id, amount, balance_before, interests_accrued, balance_after, payment_date` |
| `cycle.closed` | the background scan sees a cycle date that has not been notified yet | `event, account_id, cycle_date, opening_balance, interests_accrued, closing_balance` |

Amounts are decimal **strings**. Payments created by CSV import never emit `payment.added` or any other event ([ADR-004](adr/004-import-parser-strategy.md)).

### Request format

`POST` with a JSON body and these headers:

- `X-Webhook-Event`: the event name
- `X-Webhook-Signature`: hex HMAC-SHA256 of the body, keyed with the webhook's secret. The signed string is the payload serialized as `json.dumps(payload, separators=(",", ":"), sort_keys=True)`: compact, keys sorted. A receiver must re-serialize the parsed JSON that way; hashing the raw bytes it received can differ.

```python
import hashlib, hmac, json

def verify(payload: dict, secret: str, signature: str) -> bool:
    body = json.dumps(payload, separators=(",", ":"), sort_keys=True)
    expected = hmac.new(secret.encode(), body.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)
```

### Delivery and retries

Events are stored as `webhook_events` rows with status `pending` and delivered by `_webhook_retry_loop` every `WEBHOOK_RETRY_DELAY_SECONDS` (default 60), so first delivery happens up to a minute after the event, not inline. Each attempt has a `WEBHOOK_TIMEOUT_SECONDS` (10) timeout.

- 2xx response → `delivered`.
- Non-2xx response → stays `pending`, retried on the next tick.
- Network error/timeout → `pending`, or `failed` once `WEBHOOK_MAX_RETRIES` (3) attempts are used.
- The config was deleted → `failed`.

Once an event has used its attempts it is no longer selected. **An event whose attempts all ended in non-2xx responses stays `pending` forever** (only the error path sets `failed`). Treat `pending` with `attempt_count >= WEBHOOK_MAX_RETRIES` as failed. *(from code reading)*

Receivers should be idempotent: delivery is at-least-once, and with more than one backend worker the same event can be sent twice (see [Background tasks](#background-tasks)).

## Background tasks

Two `asyncio` tasks are started in the FastAPI `lifespan` (`backend/app/main.py`). There is no worker or queue ([ADR-006](adr/006-cycle-close-detection-without-worker.md)).

| Task | Interval setting (default) | Does |
|---|---|---|
| `_webhook_retry_loop` | `WEBHOOK_RETRY_DELAY_SECONDS` (60 s) | Delivers pending `webhook_events` |
| `_cycle_close_scan_loop` | `CYCLE_SCAN_INTERVAL_SECONDS` (3600 s) | For each `open`/`active` account, finds cycle dates with no `account_cycle_notifications` row, inserts the row and one `cycle.closed` event per subscribed webhook |

Both sleep first and then run, so nothing fires in the first interval after a restart.

**Each uvicorn worker runs its own copy of both loops, and `UVICORN_WORKERS` defaults to 2.** *(from code reading; not reproduced at runtime)*

- *Cycle scan:* two workers can compute the same pending dates. `UNIQUE(account_id, cycle_date)` stops duplicates, so one worker's transaction fails and rolls back, and it logs `cycle_close_scan_error`. Events are not duplicated, but expect that error in the logs.
- *Webhook delivery:* `deliver_pending` selects pending rows without locking, so two workers can deliver the same event.

Running with `UVICORN_WORKERS=1` avoids both. A real fix is row locking (`FOR UPDATE SKIP LOCKED`) or running the loops in one process only.

## Imports

Admin-only, two steps, never touches `loan_accounts` or `payments` until commit ([ADR-004](adr/004-import-parser-strategy.md), diagrams in [`diagrams/import-attachments-cycle-webhooks.md`](diagrams/import-attachments-cycle-webhooks.md)):

1. `POST /admin/imports/preview` uploads a CSV. Parsers in `modules/imports/parsers/` are tried in order via `sniff()`: `native_csv` (LoanTrack's own export) and `legacy_ledger_csv` (Spanish ledger: `Referencia, Fecha, Descripcion, Debito, Credito`). Only `ImportBatch`/`ImportRow` are saved.
2. `POST /admin/imports/{id}/commit` with the admin's `Referencia → account` mapping creates payments with `method="import"`. Interest amounts are taken from the CSV as-is, not recomputed.

There is no "undo import".

## Cold starts on Render

On Render's free tier an idle service is spun down and the next request has to wake it, which takes tens of seconds (the container also runs `alembic upgrade head` and the seed script before uvicorn starts). While it wakes, the proxy in front of it answers with errors instead of the app (**502 and 429** were reported; 503/504 are handled too), so the SPA used to fail until someone opened the backend URL by hand. Now ([ADR-009](adr/009-cold-start-handling.md)):

- **Wake-up ping.** `main.tsx` calls `GET /api/v1/health` as soon as the app loads, so the backend starts waking while the login page is still on screen.
- **Automatic retry** (`frontend/src/api/client.ts` + `coldStart.ts`). A failed request is resent up to 8 times over about a minute (2, 3, 5, 8, then 10 s steps; a `Retry-After` header can lengthen a step, up to 15 s). After that the real error is shown.
  - Counted as cold-start symptoms: 502/503/504, a **429 that did not come from this API**, and "no response" network errors.
  - A 429 from this API's own limiter (`{"error": "Rate limit exceeded: ..."}`) is **not** retried, so lock-outs show up immediately.
  - Reads (GET/HEAD/OPTIONS) and login/refresh are always resent. Other writes (e.g. recording a payment) are resent only after **503 or a proxy 429**, where the request is known not to have been processed. After a 502/504 or a dropped connection the user retries by hand, because the first attempt might have been recorded.
  - The token-refresh call gets the same patience, so a 502 during refresh does not log the user out.
- **Banner.** While retrying, `ServerWakingNotice` shows "Connecting to the server".
- **nginx** (`frontend/nginx.conf*`) waits up to 120 s for the backend instead of failing at its 60 s default.
- **Optional keep-alive.** `.github/workflows/keep-alive.yml` pings the backend every 10 minutes when the repository variable `KEEP_ALIVE_URL` is set. See [CI/CD](ci-cd.md#4-keep-alive-optional) for the caveats.

**Background loops stop while the service sleeps.** The webhook retry and cycle-close scan ([Background tasks](#background-tasks)) run inside the web process, so while the service is asleep no `cycle.closed` events are detected and no webhooks are retried. After waking, each loop sleeps one full interval first (the scan waits an hour), so notifications arrive late. If those notifications matter, keep the backend awake (keep-alive workflow or a paid always-on instance).

## Known gaps

Things the code does today that the docs elsewhere might lead you to assume otherwise.

1. **Rate limiting is partial.** Only `register` (10/min), `login` (`AUTH_RATE_LIMIT_PER_MINUTE`, default 5/min) and `refresh` (20/min) are limited. `RATE_LIMIT_PER_MINUTE` is **unused**: a global per-IP limit would count every user behind the shared proxy address together. Counters are in memory per worker process, so with 2 workers the effective limit can be up to double. Behind the nginx proxy the client address the backend sees may be the proxy's rather than the real client's *(from code reading: uvicorn only trusts forwarded headers from 127.0.0.1 unless `FORWARDED_ALLOW_IPS` is set)*, in which case all users share one login bucket. Only set `FORWARDED_ALLOW_IPS` if the backend is reachable solely through proxies you trust, otherwise clients can spoof their address.
2. **Webhook secrets are never shown.** A signing secret is generated on creation and stored in `secret_hash` (it is the HMAC key, so it is not actually a hash), but no API response or UI includes it, so receivers cannot verify signatures without reading the database.
3. **ADR-002's CSP mitigation covers API responses only.** The CSP header is set by FastAPI; the nginx container serving the SPA sets none. The policy also allows `'unsafe-inline'` scripts.
4. **Duplicate engine file.** `backend/app/core/interest_engine.py` is byte-identical to `backend/app/modules/accounts/interest_engine.py` and nothing imports it. Edits made to it have no effect.
5. **Unused dependencies** in `pyproject.toml` / `requirements.in`: `sendgrid`, `twilio`, `azure-storage-blob`, and a direct `cryptography` pin (a comment mentions a HubSpot integration and AES per-record encryption; no such code exists). The two files also disagree on version ranges (e.g. `fastapi <0.160` vs `<0.112`), and CI installs from the hashed `requirements-ci.txt`, compiled from `requirements.in`.
6. **Naming leftovers:** `APP_NAME` defaults to "Interests Calculator" and the database to `interests_db`; the package and frontend are named `interests-calculator`.
7. **Webhook events that keep failing with an HTTP error stay `pending`** instead of becoming `failed` (see [Webhooks](#delivery-and-retries)).
