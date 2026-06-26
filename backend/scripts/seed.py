"""
Seed script — insert an admin user for local testing.

Run via:
    docker compose run --rm seed

Or directly (with DATABASE_URL set):
    python -m scripts.seed

Environment variables (all optional, have safe defaults):
    SEED_ADMIN_EMAIL      default: admin@loantrack.dev
    SEED_ADMIN_PASSWORD   default: ChangeMe123!
    SEED_ADMIN_NAME       default: Admin User

The script is idempotent: if a user with that email already exists it prints
the existing user's details and exits without making any changes.
"""

import asyncio
import os
import sys

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

# ── Config from environment ───────────────────────────────────────────────────

DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    print("ERROR: DATABASE_URL is not set.", file=sys.stderr)
    sys.exit(1)

ADMIN_EMAIL    = os.environ.get("SEED_ADMIN_EMAIL",    "admin@loantrack.dev")
ADMIN_PASSWORD = os.environ.get("SEED_ADMIN_PASSWORD", "ChangeMe123!")
ADMIN_NAME     = os.environ.get("SEED_ADMIN_NAME",     "Admin User")

# ── Async engine ──────────────────────────────────────────────────────────────

engine = create_async_engine(DATABASE_URL, echo=False)
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _banner(msg: str) -> None:
    width = max(len(msg) + 4, 50)
    print("─" * width)
    print(f"  {msg}")
    print("─" * width)


async def _table_exists(session: AsyncSession, table: str) -> bool:
    result = await session.execute(
        text(
            "SELECT EXISTS (SELECT 1 FROM information_schema.tables "
            "WHERE table_name = :t)"
        ),
        {"t": table},
    )
    return result.scalar()


# ── Main ──────────────────────────────────────────────────────────────────────

async def seed() -> None:
    # Import the registry FIRST — this registers every ORM model so SQLAlchemy
    # can resolve cross-module relationship strings like "LoanAccount" on User.
    import app.core.models_registry  # noqa: F401
    from app.core.security import hash_password
    from app.modules.users.models import User

    async with AsyncSessionLocal() as session:
        # Guard: make sure migrations have been applied
        if not await _table_exists(session, "users"):
            print(
                "\nERROR: 'users' table not found — have you run Alembic migrations?\n"
                "       docker compose exec backend alembic upgrade head\n",
                file=sys.stderr,
            )
            sys.exit(1)

        # Idempotency check
        result = await session.execute(select(User).where(User.email == ADMIN_EMAIL))
        existing = result.scalar_one_or_none()

        if existing:
            _banner(f"Admin user already exists — no changes made")
            print(f"  Email : {existing.email}")
            print(f"  Name  : {existing.full_name}")
            print(f"  Role  : {existing.role}")
            print(f"  Active: {existing.is_active}")
            print()
            return

        # Create
        admin = User(
            email=ADMIN_EMAIL,
            password_hash=hash_password(ADMIN_PASSWORD),
            full_name=ADMIN_NAME,
            role="admin",
            is_active=True,
        )
        session.add(admin)
        await session.commit()
        await session.refresh(admin)

        _banner("Admin user created successfully")
        print(f"  ID       : {admin.id}")
        print(f"  Email    : {admin.email}")
        print(f"  Password : {ADMIN_PASSWORD}  ← change this after first login!")
        print(f"  Name     : {admin.full_name}")
        print(f"  Role     : {admin.role}")
        print()
        print("  Log in at http://localhost or the APP_PORT you configured.")
        print()


if __name__ == "__main__":
    asyncio.run(seed())
