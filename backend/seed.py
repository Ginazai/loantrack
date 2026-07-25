"""
Idempotent seed — creates the first admin user if no users exist.
Safe to run on every startup; does nothing if the DB already has users.
"""
import asyncio
import sys

from sqlalchemy import select

from app.core.config import get_settings
from app.core.database import AsyncSessionLocal
from app.core.security import hash_password
from app.modules.users.models import User


async def seed() -> None:
    settings = get_settings()

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).limit(1))
        if result.scalar_one_or_none() is not None:
            print("seed: users already exist, skipping")
            return

        admin = User(
            email=settings.SEED_ADMIN_EMAIL,
            password_hash=hash_password(settings.SEED_ADMIN_PASSWORD),
            full_name=settings.SEED_ADMIN_NAME,
            role="admin",
            is_active=True,
        )
        db.add(admin)
        await db.commit()
        print(f"seed: created admin → {settings.SEED_ADMIN_EMAIL}")


if __name__ == "__main__":
    asyncio.run(seed())
