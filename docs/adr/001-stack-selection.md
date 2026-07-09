# ADR-001: Stack Selection

**Status:** Accepted  
**Date:** 2026-06-15

## Context
Single-tenant internal loan tracking tool. Small team, no external customers, no compliance framework.

## Decision
- **Backend:** FastAPI + SQLAlchemy 2.0 async + Alembic + PostgreSQL  
- **Frontend:** React 18 + Vite + TypeScript + TanStack Query + Zustand  
- **Styling:** Tailwind CSS + DaisyUI (custom ledger theme)  
- **Auth:** JWT (access 15 min + refresh 7 days) + bcrypt  

## Rationale
FastAPI gives async-first API + auto-OpenAPI at minimal overhead. SQLAlchemy async avoids blocking I/O. React + Vite is fast to iterate. DaisyUI keeps CSS manageable without a component lib dependency.

## Consequences
- No multi-tenancy. One DB, one deployment.
- OpenAPI auto-generated at `/api/v1/openapi.json` — frontend types generated from it.
- Swapping DB requires only changing `DATABASE_URL` + migration driver.
