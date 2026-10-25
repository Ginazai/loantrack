# LoanTrack — Internal Loan Ledger

Single-tenant loan tracking tool for managing private loans, payment history, and interest that accrues on a fixed twice-monthly cycle (the 15th and the 30th). Admins manage everything (accounts, users, imports, webhooks, loan requests); regular users manage their own loans and can submit loan requests.

## Stack

| Layer | Technology |
|---|---|
| Backend | FastAPI + SQLAlchemy 2.0 (async, asyncpg) + Alembic, Python 3.12 |
| Database | PostgreSQL 16 |
| Auth | JWT access (15 min) + refresh (7 days) + bcrypt — see [ADR-002](docs/adr/002-auth-strategy.md) |
| Rate limiting | slowapi on login, register and token refresh only — see [Architecture](docs/architecture.md#known-gaps) |
| Frontend | React 19 + Vite 7 + TypeScript, React Router 7 |
| Styling | IBM Carbon Design System (`@carbon/react`, IBM Plex, SCSS) — see [ADR-007](docs/adr/007-carbon-design-system.md) |
| State / data | Zustand + TanStack Query |
| Forms | React Hook Form + Zod |

## Prerequisites

- Docker + Docker Compose v2
- Node 22+ (local frontend dev only)
- Python 3.12 (local backend dev only; `pyproject.toml` allows ≥3.11, but the Docker image and CI use 3.12)

## Quick Start

```bash
cp .env.example .env
# Edit .env — SECRET_KEY and POSTGRES_PASSWORD are required (compose refuses to start without them)

docker compose up --build
```

App: http://localhost  
API docs: http://localhost/api/v1/docs  
pgAdmin: http://localhost:5050

### Admin user

On every start the backend container runs `alembic upgrade head` and then `backend/seed.py`, which creates the first admin **only if the `users` table is empty**. You do not need to run anything extra on a fresh database.

There is no public sign-up: further users are created by an admin (Users page, or `POST /admin/users`).

Default credentials: `admin@loantrack.dev` / `ChangeMe123!` — override with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` / `SEED_ADMIN_NAME` in `.env` **before the first start**, and change the password after first login.

`docker compose run --rm seed` runs a second, manual script (`backend/scripts/seed.py`) that creates an admin with the configured email if that email doesn't exist yet. Use it to add an admin to a database that already has other users.

## Local Development

### Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -e . -r requirements-dev.txt   # `pip install -e ".[dev]"` does NOT work: pyproject is Poetry-format
cp .env.example .env  # edit DATABASE_URL to point at local Postgres
alembic upgrade head
uvicorn app.main:app --reload
```

### Frontend

```bash
cd frontend
npm install
cp .env.example .env.local  # optional — the dev server already proxies /api
                             # to localhost:8000 on its own (vite.config.ts);
                             # only edit this if your backend runs elsewhere
npm run dev
```

## OpenAPI Type Generation

The frontend type contract is generated from the backend OpenAPI spec:

```bash
# Backend must be running
npx openapi-typescript http://localhost:8000/api/v1/openapi.json \
  -o frontend/src/api/openapi.ts
```

Run this after any schema changes. CI only checks that the frontend still compiles; it does not check that `openapi.ts` is up to date.

## Testing

```bash
# Backend (from backend/, needs a reachable Postgres via DATABASE_URL)
pytest tests/ app/modules/*/tests/ --cov=app --cov-fail-under=80

# Frontend (from frontend/)
npm run typecheck   # tsc -b
npm test            # vitest run
npm run test:coverage
```

`npm run lint` is defined but ESLint is not installed or configured yet, so it currently fails; CI skips the step with a warning. See [CI/CD](docs/ci-cd.md#gates-that-start-warn-only-ratchets).

## Architecture

```
.
├── backend/
│   ├── app/
│   │   ├── main.py         # FastAPI app, middleware, and the two background loops
│   │   ├── core/           # config, security, logging, exceptions, DB session, repository base
│   │   └── modules/        # one folder per feature; each has models, schemas, service, router, tests/
│   │       ├── accounts/   # loan accounts + interest_engine.py (pure ledger math)
│   │       ├── payments/   # payments + attachments (stored as bytea in Postgres)
│   │       ├── webhooks/   # webhook configs, delivery/retry, cycle-close scan
│   │       ├── imports/    # CSV import: pluggable parsers, preview → commit
│   │       ├── loan_requests/, auth/, users/, admin/, audit/
│   ├── alembic/versions/   # migrations 001–006
│   ├── scripts/seed.py     # manual admin seed (docker compose run --rm seed)
│   └── seed.py             # idempotent first-boot seed, run by entrypoint.sh
├── frontend/src/
│   ├── api/                # axios client (token refresh interceptor) + generated OpenAPI types
│   ├── components/         # ui/ feedback/ forms/ layout/ common/
│   ├── features/           # one folder per page/feature (accounts, payments, admin, user, ...)
│   ├── hooks/ stores/ utils/ types/
├── deploy/production.yml   # the image tag production runs (changed only via promotion PR)
├── docs/                   # architecture, CI/CD, ADRs, requirements, diagrams
└── .github/workflows/      # ci, cd, deploy-production, deploy-render
```

Start with **[docs/architecture.md](docs/architecture.md)** for how interest is calculated, the permission model, the API surface, the webhook contract and the background tasks. Decisions and their reasoning live in [`docs/adr/`](docs/adr/).

## Hosting on Render's free tier

Idle services sleep, and the first request wakes them (30–60+ seconds). The app handles this itself: it pings the backend on load, retries failed requests for about a minute and shows a "Connecting to the server" banner, so you no longer have to open the backend URL by hand. Details and limits: [Architecture → Cold starts](docs/architecture.md#cold-starts-on-render). To avoid the wait entirely, enable the optional [keep-alive workflow](docs/ci-cd.md#4-keep-alive-optional) or use an always-on instance. Note that background webhook/cycle notifications pause while the backend sleeps.

## Environment Variables

Three `.env.example` files, each scoped to how you're running that piece:

- `.env.example` (repo root) — feeds `docker compose up`; copy to `.env` here for the normal Docker workflow.
- `backend/.env.example` — for running the backend directly (`uvicorn`, pytest, alembic), outside Docker.
- `frontend/.env.example` — for running the frontend directly (`npm run dev`), outside Docker.

Each file documents only the variables that path actually reads — see the comments at the top of each for how they relate to the other two. The full list of backend settings is `Settings` in `backend/app/core/config.py`.

Required (root `.env.example`):
- `SECRET_KEY` — JWT signing secret (random, ≥32 chars). The in-code default is a placeholder; always set your own.
- `POSTGRES_PASSWORD` — DB password

Worth knowing:
- `UVICORN_WORKERS` (default 2) — each worker process runs its own copy of the background loops; see [Architecture → Background tasks](docs/architecture.md#background-tasks).
- `RATE_LIMIT_PER_MINUTE` is currently unused; `AUTH_RATE_LIMIT_PER_MINUTE` (default 5) limits logins per minute per client address.
- `ALLOWED_ORIGINS` is hardcoded to `["http://localhost"]` in `docker-compose.yml`; change it there if you serve the app from another origin.

## Roles

| Role | Access |
|------|--------|
| `admin` | Everything: all accounts and payments, users, global webhooks, CSV imports/exports, loan-request review, force-purge of non-closed accounts |
| `user` | Own accounts (create, edit, close, purge once closed), own payments and attachments, per-account webhooks, loan-request submission (max 3 active at once) |

Full per-endpoint breakdown: [Architecture → API surface](docs/architecture.md#api-surface).
