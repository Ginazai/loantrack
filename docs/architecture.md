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

- Login returns an access JWT (15 min, `type=access`, carries `role`) in the response body, and sets a refresh JWT (7 days) as an **httpOnly cookie** (`lt_refresh`; `Secure`, `SameSite=lax`, path `/api/v1/auth`). The refresh token never appears in a response body. Refresh tokens are stored **hashed** (SHA-256).
- The frontend keeps the access token **in memory only**; nothing is written to `localStorage`/`sessionStorage`. On page load the SPA calls `POST /auth/refresh` (the browser attaches the cookie) to get a new access token, and the axios interceptor in `frontend/src/api/client.ts` does the same once on a 401 ([ADR-002](adr/002-auth-strategy.md)). Concurrent refreshes share one call, and a Web Lock serialises them across tabs.
- `POST /auth/refresh` and `POST /auth/logout` are cookie-authenticated, so they require an `X-Requested-With: XMLHttpRequest` header (CSRF defence in addition to `SameSite`). `logout` does not need a valid access token: the cookie identifies the session, and the cookie is cleared.
- **Rotation and reuse detection.** Every refresh spends the presented token and issues a new one in the same *family* (one family per login). If a token that was already rotated is presented again more than `REFRESH_REUSE_GRACE_SECONDS` (10) later, the whole family is revoked and a `reuse_detected` audit row is written: whoever replays it and the real holder both have to sign in again. Inside the grace window (two tabs, a retried request) the replay just gets a 401 and the session survives. Logout, password change and deactivation revoke tokens with their own reason and are *not* treated as reuse.
- **Sessions end when they should.** Deactivating a user (admin) or changing/resetting a password revokes that user's refresh tokens immediately; a refresh by a deactivated user is refused. Access tokens already issued die on their own within 15 minutes (`get_current_user` also checks `is_active` on every request, so a deactivated user is locked out at once).
- `PATCH /auth/me` takes a closed schema: `full_name`, and `current_password` + `new_password` together. Anything else (role, email, `is_active`…) is a 422. A wrong `current_password` is a 403 (not 401, which the SPA reads as "token expired"). Changing the password signs out every other session and keeps the current device signed in. Admins cannot edit **their own** account through `PATCH /admin/users/{id}` (409): they use Account Settings, which asks for the current password.
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
- `X-Webhook-Signature`: hex HMAC-SHA256 of the **raw request body**, keyed with the webhook's secret. The body sent is exactly the bytes that were signed (compact JSON, keys sorted), so a receiver can verify what it received without re-serialising anything.
- `X-Webhook-Id`: the event's id, stable across retries; use it to ignore a delivery you already handled.

The secret (`whsec_…`) is returned **once**, in the response to creating the webhook (`POST /accounts/{id}/webhooks`, `POST /admin/webhooks`), and shown once in the UI. List/get responses never include it. A lost secret is replaced with `POST …/webhooks/{id}/rotate-secret` (admin), which invalidates the old one immediately. It is stored in the `secret_hash` column in plaintext, because the HMAC needs the key itself; the name is a leftover.

```python
import hashlib, hmac

def verify(raw_body: bytes, secret: str, signature: str) -> bool:
    expected = hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
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

On Render's free tier an idle service is spun down (after about 15 minutes without inbound traffic) and the next request has to start it, which takes about a minute. Our backend container also runs `alembic upgrade head` and the seed script before uvicorn listens, so it can take longer.

**A sleeping backend is not woken by the frontend's nginx proxy.** Per community reports of the free tier *(not stated in Render's own docs; confirmed by the symptoms here, not by us against Render)*, a request that comes from another Render service gets an instant 502 from Render's proxy and never starts the target. Only a request from **outside Render**, such as the user's browser or a GitHub Actions job, wakes it. That is why the SPA used to fail with 502 (or 429) until someone opened the backend URL by hand, and why simply retrying through nginx cannot fix it ([ADR-009](adr/009-cold-start-handling.md)).

What the app does now:

- **Direct wake ping from the browser.** nginx publishes the backend's public URL at `/runtime-config.json` (from `BACKEND_URL`). On page load and before every retry, the SPA sends a `no-cors` `GET {backend}/api/v1/health` straight to that URL (`frontend/src/api/coldStart.ts`, `wakeBackend`). The answer is never read; the request only has to arrive. At most one ping is in flight at a time.
- **Retry through the proxy** (`client.ts`). The failed request is resent up to 14 times over about two minutes (2, 3, 5, 8 s, then 10 s steps; a `Retry-After` header can lengthen a step, up to 15 s) while the backend boots. After that the real error is shown.
  - Counted as cold-start symptoms: 502/503/504, a **429 that did not come from this API**, and "no response" network errors.
  - A 429 from this API's own limiter (`{"error": "Rate limit exceeded: ..."}`) is **not** retried, so lock-outs show up immediately.
  - Reads (GET/HEAD/OPTIONS) and login/refresh are always resent. Other writes (e.g. recording a payment) are resent only after **503 or a proxy 429**, where the request is known not to have been processed. After a 502/504 or a dropped connection the user retries by hand, because the first attempt might have been recorded.
  - The token-refresh call gets the same treatment, so a 502 during refresh does not log the user out.
- **Banner.** While retrying, `ServerWakingNotice` shows "Connecting to the server".
- **nginx** (`frontend/nginx.conf*`) waits up to 120 s for the backend instead of failing at its 60 s default.
- **Optional keep-alive.** `.github/workflows/keep-alive.yml` pings the backend every 10 minutes when the repository variable `KEEP_ALIVE_URL` is set, so it rarely sleeps at all. See [CI/CD](ci-cd.md#4-keep-alive-optional) for the caveats.

Requirements and limits:

- `BACKEND_URL` on the **frontend** service must be the backend's **public** `https://` URL. It is what the browser pings, and an internal Render address can neither be reached by the browser nor wake anything (free services also cannot receive private-network traffic).
- If the browser cannot reach that URL (blocked by a network, ad blocker or extension), nothing wakes the backend and requests fail after about two minutes.
- In local `docker compose` nginx does not publish `runtime-config.json`, so no wake ping is sent. The backend never sleeps there.
- A cold start longer than the retry window still ends in an error; reloading tries again.

**Background loops stop while the service sleeps.** The webhook retry and cycle-close scan ([Background tasks](#background-tasks)) run inside the web process, so while the service is asleep no `cycle.closed` events are detected and no webhooks are retried. After waking, each loop sleeps one full interval first (the scan waits an hour), so notifications arrive late. If those notifications matter, keep the backend awake (keep-alive workflow or a paid always-on instance).

## Known gaps

Things the code does today that the docs elsewhere might lead you to assume otherwise.

1. **Rate limiting is partial.** Only `register` (10/min), `login` (`AUTH_RATE_LIMIT_PER_MINUTE`, default 5/min), `refresh` (20/min) and `PATCH /auth/me` (10/min) are limited. `RATE_LIMIT_PER_MINUTE` is **unused**. Counters are in memory per worker process, so with 2 workers the effective limit can be up to double, and the limit is per address, not per account (a distributed attack on one account is not slowed).
2. **The login limit is per real client only if `TRUSTED_PROXIES` is right.** The key is the client address resolved by `app/core/client_ip.py`: the TCP peer, unless the peer is in `TRUSTED_PROXIES`, in which case the rightmost `X-Forwarded-For` entry that is not itself a trusted proxy. `docker-compose.yml` sets it to the compose network (nginx is the only way in). Empty (the default) trusts no one, which behind a proxy puts all users in one bucket. Never include a catch-all range (startup refuses `0.0.0.0/0`). uvicorn runs with `--no-proxy-headers`, so this is the only place forwarded headers are interpreted. If another load balancer sits in front of the frontend nginx (e.g. Render), set the frontend's `REAL_IP_FROM` to that balancer's address range so nginx sees the visitor instead of the balancer; I could not verify Render's ranges from the repo, so that value is deployment-specific.
3. **ADR-002's CSP mitigation covers API responses only.** The CSP header is set by FastAPI; the nginx container serving the SPA sets none. The policy also allows `'unsafe-inline'` scripts.
4. **Duplicate engine file.** `backend/app/core/interest_engine.py` is byte-identical to `backend/app/modules/accounts/interest_engine.py` and nothing imports it. Edits made to it have no effect.
5. **Unused dependencies** in `pyproject.toml` / `requirements.in`: `sendgrid`, `twilio`, `azure-storage-blob`, and a direct `cryptography` pin (a comment mentions a HubSpot integration and AES per-record encryption; no such code exists). The two files also disagree on version ranges (e.g. `fastapi <0.160` vs `<0.112`), and CI installs from the hashed `requirements-ci.txt`, compiled from `requirements.in`.
6. **Naming leftovers:** `APP_NAME` defaults to "Interests Calculator" and the database to `interests_db`; the package and frontend are named `interests-calculator`.
7. **Webhook events that keep failing with an HTTP error stay `pending`** instead of becoming `failed` (see [Webhooks](#delivery-and-retries)).
