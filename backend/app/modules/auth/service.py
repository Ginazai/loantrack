from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import and_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.repository import BaseRepository
from app.core.security import (
    create_access_token,
    create_refresh_token,
    hash_password,
    hash_token,
    verify_password,
)
from app.modules.auth.schemas import LoginRequest, TokenResponse
from app.modules.users.models import RefreshToken, User
from app.modules.users.schemas import UserCreate
from app.modules.users.service import UserService


class AuthService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.users = UserService(db)
        self.tokens = BaseRepository(RefreshToken, db)

    async def register(self, data: UserCreate) -> User:
        if await self.users.get_by_email(data.email):
            raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")
        user = User(
            email=data.email,
            password_hash=hash_password(data.password),
            full_name=data.full_name,
            role=data.role,
        )
        return await self.users.create(user)

    async def login(self, data: LoginRequest, ip: str | None = None) -> TokenResponse:
        user = await self.users.get_by_email(data.email)
        if not user or not verify_password(data.password, user.password_hash):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")
        if not user.is_active:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Account inactive")

        await self.users.update_last_login(user.id)
        return await self._issue_tokens(user, ip)

    async def refresh(self, raw_token: str, ip: str | None = None) -> TokenResponse:
        token_hash = hash_token(raw_token)
        result = await self.db.execute(
            select(RefreshToken).where(
                and_(RefreshToken.token_hash == token_hash, RefreshToken.revoked.is_(False))
            )
        )
        stored = result.scalar_one_or_none()
        if not stored or stored.expires_at < datetime.now(timezone.utc):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired refresh token")

        # Rotate: revoke old, issue new
        stored.revoked = True
        await self.db.flush()

        user = await self.users.get_by_id(stored.user_id)
        return await self._issue_tokens(user, ip)

    async def logout(self, user_id: UUID) -> None:
        await self.db.execute(
            update(RefreshToken)
            .where(and_(RefreshToken.user_id == user_id, RefreshToken.revoked.is_(False)))
            .values(revoked=True)
        )
        await self.db.flush()

    async def _issue_tokens(self, user: User, ip: str | None) -> TokenResponse:
        access = create_access_token(str(user.id), user.role)
        raw_refresh, expires_at = create_refresh_token(str(user.id))

        rt = RefreshToken(
            user_id=user.id,
            token_hash=hash_token(raw_refresh),
            expires_at=expires_at,
            ip_address=ip,
        )
        await self.tokens.create(rt)
        return TokenResponse(access_token=access, refresh_token=raw_refresh)
