from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.repository import BaseRepository
from app.modules.users.models import RefreshToken, User


class UserService:
    """User lookups and account-level operations (queries inlined, no per-entity repo)."""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.repo = BaseRepository(User, db)

    async def get_by_id(self, user_id: UUID | str) -> User | None:
        return await self.repo.get_by_id(user_id)

    async def get_by_email(self, email: str) -> User | None:
        result = await self.db.execute(select(User).where(User.email == email))
        return result.scalar_one_or_none()

    async def create(self, user: User) -> User:
        return await self.repo.create(user)

    async def update_last_login(self, user_id: UUID) -> None:
        await self.db.execute(
            update(User).where(User.id == user_id).values(last_login=datetime.now(timezone.utc))
        )
        await self.db.flush()

    async def revoke_refresh_tokens(self, user_id: UUID, reason: str) -> None:
        """Invalidate every live refresh token of a user (their sessions end at the next
        refresh; access tokens die on their own within minutes)."""
        await self.db.execute(
            update(RefreshToken)
            .where(RefreshToken.user_id == user_id, RefreshToken.revoked.is_(False))
            .values(revoked=True, revoked_at=datetime.now(timezone.utc), revoked_reason=reason)
        )
        await self.db.flush()
