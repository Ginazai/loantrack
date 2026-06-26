# LoanTrack — Interests Calculator v2

A full-stack loan tracking and interest management platform.

## Stack

| Layer | Technology |
|---|---|
| Backend | FastAPI + SQLAlchemy 2.0 (async) + Alembic |
| Database | PostgreSQL |
| Auth | JWT (access + refresh) + bcrypt |
| Rate Limiting | slowapi |
| Webhooks | httpx + background retry loop |
| Frontend | React 18 + Vite + TypeScript |
| Styling | Tailwind CSS + DaisyUI |
| Data Grid | AG Grid Community |
| Charts | Recharts |
| State | Zustand + TanStack Query |
| Forms | React Hook Form + Zod |

---

## Project Structure

```
interests-calculator/
├── backend/
│   ├── app/
│   │   ├── core/          # Config, DB engine, security, dependencies
│   │   ├── models/        # SQLAlchemy ORM models
│   │   ├── schemas/       # Pydantic v2 request/response schemas
│   │   ├── repositories/  # DB access layer (no business logic)
│   │   ├── services/      # Business logic + interest engine
│   │   └── routers/       # HTTP endpoints (thin, call services)
│   └── alembic/           # Migrations
└── frontend/
    └── src/
        ├── api/            # Axios API calls per domain
        ├── components/     # Reusable UI (layout, common, accounts, charts)
        ├── pages/          # Route-level components
        ├── stores/         # Zustand (auth, UI/theme)
        ├── utils/          # Date/cycle utilities (mirrors backend logic)
        └── types/          # TypeScript interfaces
```

---

## Running with Docker (recommended)

### Prerequisites
- Docker 25+
- Docker Compose v2

### Start

```bash
cp .env.example .env
# Edit .env — set POSTGRES_PASSWORD and SECRET_KEY at minimum
```

Generate a secret key:
```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

```bash
docker compose up --build
```

That's it. The compose file:
1. Starts PostgreSQL and waits for it to be healthy
2. Starts the backend, runs `alembic upgrade head` automatically, then starts uvicorn
3. Builds the React app and serves it via nginx on port 80
4. nginx proxies `/api/*` internally to the backend — the backend is never exposed to the host

App available at: `http://localhost`  
API docs available at: `http://localhost/api/v1/docs`

### Useful commands

```bash
docker compose up -d            # run in background
docker compose logs -f backend  # stream backend logs
docker compose exec backend alembic upgrade head  # run migrations manually
docker compose down             # stop everything
docker compose down -v          # stop + delete the postgres volume
```

---

## Local Development (without Docker)

### Backend

Requires [uv](https://docs.astral.sh/uv/getting-started/installation/) and PostgreSQL 15+.

```bash
cd backend
uv sync                        # installs all deps into .venv automatically
cp .env.example .env           # set DATABASE_URL, SECRET_KEY
createdb interests_db
uv run alembic upgrade head
uv run uvicorn app.main:app --reload
```

Add dev dependencies (pytest, ruff, mypy):
```bash
uv sync --dev
uv run pytest
```

API docs: `http://localhost:8000/api/v1/docs`

### Frontend

Requires Node.js 20+.

```bash
cd frontend
npm install
npm run dev
```

App: `http://localhost:5173` — Vite proxies `/api` to `http://localhost:8000`.

---

## Interest Engine

Cycle dates are the **15th and 30th of every month**. For months shorter than 30 days, the 30th falls on the last day of the month (e.g. Feb 28/29).

**Rules:**
1. Interest accrues only on cycle dates, applied to the opening balance: `interest = balance × rate`
2. Payments between cycle dates are attributed to the next cycle — they reduce the balance that feeds the next cycle's calculation
3. Auto mode picks the next upcoming cycle date; manual lets the user pick any date
4. Status transitions: `open → active` (first payment), `active → paid` (balance ≤ 0), `active/open → closed` (manual), `closed → purged` (hard delete, irreversible)

The engine is implemented in `backend/app/services/interest_service.py` and mirrored for frontend previews in `frontend/src/utils/dateUtils.ts`.

---

## Webhooks

Webhooks fire on: `payment.added`, `status.changed`, `account.created`, `account.updated`, `account.purged`.

Each request includes an `X-Webhook-Signature` header (HMAC-SHA256). Verify it in your n8n/Pipedream workflow:

```javascript
// n8n Code node example
const crypto = require('crypto');
const body = JSON.stringify($input.first().json);
const sig = crypto.createHmac('sha256', $vars.WEBHOOK_SECRET)
  .update(body).digest('hex');
if (sig !== $input.first().headers['x-webhook-signature']) {
  throw new Error('Invalid signature');
}
```

Failed deliveries are retried up to `WEBHOOK_MAX_RETRIES` times with a `WEBHOOK_RETRY_DELAY_SECONDS` interval via a background loop.

---

## Auth Flow

- `POST /api/v1/auth/login` → returns `access_token` (15 min) + `refresh_token` (7 days)
- `POST /api/v1/auth/refresh` → rotates refresh token, issues new pair
- `POST /api/v1/auth/logout` → revokes all refresh tokens for the user
- The frontend Axios interceptor auto-refreshes on `401` and retries the original request transparently

---

## API Reference

Full interactive docs at `/api/v1/docs` (Swagger UI) or `/api/v1/redoc`.

| Method | Endpoint | Description |
|---|---|---|
| POST | `/auth/register` | Create user |
| POST | `/auth/login` | Login |
| POST | `/auth/refresh` | Refresh tokens |
| POST | `/auth/logout` | Revoke tokens |
| GET | `/auth/me` | Current user |
| GET | `/accounts` | List accounts (filterable) |
| POST | `/accounts` | Create account |
| GET | `/accounts/{id}` | Get account + balance |
| PATCH | `/accounts/{id}` | Update account |
| POST | `/accounts/{id}/close` | Close account |
| DELETE | `/accounts/{id}` | Purge (closed only) |
| GET | `/accounts/{id}/cycle-preview` | Next 6 cycle dates |
| GET | `/accounts/{id}/payments` | Payment ledger |
| POST | `/accounts/{id}/payments` | Record payment |
| GET | `/accounts/{id}/webhooks` | List webhooks |
| POST | `/accounts/{id}/webhooks` | Add webhook |
| DELETE | `/accounts/{id}/webhooks/{wid}` | Remove webhook |

---

## Roles

| Role | Access |
|---|---|
| `user` | Own accounts + payments only |
| `admin` | All endpoints + user management (extend as needed) |

---

## Extending

**Add a new router:** create `app/routers/yourrouter.py`, add a service + repository, then register in `app/main.py`.

**Add a new webhook event:** add the event name to `WEBHOOK_EVENTS` in `app/schemas/__init__.py` and call `_fire_webhook(account, "your.event", payload)` from the relevant service method.

**Add a new frontend page:** create `src/pages/YourPage.tsx`, add a route in `App.tsx`, add a nav item in `DashboardLayout.tsx`.
