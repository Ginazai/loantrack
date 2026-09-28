# LoanTrack — Internal Loan Ledger

Single-tenant loan tracking tool for managing private loans, payment schedules, and interest calculations.

## Stack

| Layer | Technology |
|---|---|
| Backend | FastAPI + SQLAlchemy 2.0 (async) + Alembic |
| Database | PostgreSQL 16 |
| Auth | JWT access (15 min) + refresh (7 days) + bcrypt |
| Rate limiting | slowapi |
| Frontend | React 18 + Vite + TypeScript |
| Styling | Tailwind CSS + DaisyUI (custom ledger theme) |
| State | Zustand + TanStack Query |
| Forms | React Hook Form + Zod |

## Prerequisites

- Docker + Docker Compose v2
- Node 20+ (local frontend dev only)
- Python 3.12+ (local backend dev only)

## Quick Start

```bash
cp .env.example .env
# Edit .env — set SECRET_KEY and POSTGRES_PASSWORD at minimum

docker compose up --build
```

App: http://localhost  
API docs: http://localhost/api/v1/docs  
pgAdmin: http://localhost:5050

### Seed admin user

```bash
docker compose run --rm seed
# Default: admin@loantrack.dev / ChangeMe123!
# Override via SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD in .env
```

## Local Development

### Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
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

Run this after any schema changes. CI validates the build still compiles.

## Testing

```bash
# Backend (from backend/)
pytest tests/ app/modules/*/tests/ --cov=app --cov-fail-under=60

# Frontend type check
cd frontend && npx tsc --noEmit
```

## Architecture

```
app/
├── backend/
│   ├── app/
│   │   ├── core/           # Config, security, logging, exceptions, DB session
│   │   └── modules/        # Feature modules (accounts, payments, auth, ...)
│   │       └── <module>/
│   │           ├── models.py, schemas.py, service.py, router.py, tests/
│   └── alembic/            # Migrations
├── frontend/
│   └── src/
│       ├── api/            # Typed API client + OpenAPI types
│       ├── components/     # ui/ feedback/ forms/ layout/
│       ├── features/       # Page-level feature components
│       ├── hooks/          # Shared hooks
│       ├── stores/         # Zustand stores
│       └── types/          # App-wide TypeScript types
├── docs/adr/               # Architecture Decision Records
└── .github/workflows/      # CI pipeline
```

See `docs/adr/` for architectural decisions.

## Environment Variables

Three `.env.example` files, each scoped to how you're running that piece:

- `.env.example` (repo root) — feeds `docker compose up`; copy to `.env` here for the normal Docker workflow.
- `backend/.env.example` — for running the backend directly (`uvicorn`, pytest, alembic), outside Docker.
- `frontend/.env.example` — for running the frontend directly (`npm run dev`), outside Docker.

Each file documents only the variables that path actually reads — see the comments at the top of each for how they relate to the other two.

Key required variables (root `.env.example`):
- `SECRET_KEY` — JWT signing secret (min 32 chars, random)
- `POSTGRES_PASSWORD` — DB password

## Roles

| Role | Access |
|------|--------|
| `admin` | Full access — accounts, users, webhooks, requests, CSV exports |
| `user` | Own loans view, loan request submission (max 3 active) |
