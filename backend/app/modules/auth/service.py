import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException, status
from jose import JWTError
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.repository import BaseRepository
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    hash_token,
    verify_password,
)
from app.modules.audit.service import AuditService
from app.modules.auth.schemas import LoginRequest
from app.modules.users.models import RefreshToken, User
from app.modules.users.schemas import SelfUpdate, UserCreate
from app.modules.users.service import UserService

_INVALID_REFRESH = "Invalid or expired refresh token"


@dataclass
class IssuedSession:
    """What a successful login/refresh hands back to the router."""

    access_token: str
    refresh_token: str  # goes into the httpOnly cookie, never into a response body


class AuthService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.users = UserService(db)
        self.tokens = BaseRepository(RefreshToken, db)
        self.audit = AuditService(db)

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

    async def login(self, data: LoginRequest, ip: str | None = None) -> IssuedSession:
        user = await self.users.get_by_email(data.email)
        if not user or not verify_password(data.password, user.password_hash):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")
        if not user.is_active:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Account inactive")

        await self.users.update_last_login(user.id)
        return await self._issue_tokens(user, ip)  # a login starts a new token family

    async def refresh(self, raw_token: str | None, ip: str | None = None) -> IssuedSession:
        """Rotate a refresh token: the presented one is spent, a new one in the same family
        is issued.

        Reuse detection: a token that was already rotated away should never come back. If it
        does (outside a short grace window for benign double-submits) the holder of the newer
        token and whoever sent the old one both think they own the session, so the whole
        family is revoked and both must sign in again.
        """
        stored = await self._find_valid_structure(raw_token)
        now = datetime.now(timezone.utc)

        if stored.revoked:
            if stored.revoked_reason == "rotated" and not self._in_grace(stored, now):
                await self._revoke_family(stored.family_id, "reuse")
                await self.audit.log(
                    stored.user_id,
                    "refresh_token",
                    str(stored.family_id),
                    "reuse_detected",
                    ip=ip,
                )
                await self._commit_then_reject()
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, _INVALID_REFRESH)

        if stored.expires_at <= now:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, _INVALID_REFRESH)

        user = await self.users.get_by_id(stored.user_id)
        if not user or not user.is_active:
            # A deactivated account must not be able to mint new access tokens. (Admin
            # deactivation also revokes eagerly; this covers any path that doesn't.)
            await self.users.revoke_refresh_tokens(stored.user_id, "deactivated")
            await self._commit_then_reject()

        # Claim the token atomically. Two requests racing with the same token both pass the
        # checks above; only one UPDATE can flip revoked false -> true.
        claimed = await self.db.execute(
            update(RefreshToken)
            .where(RefreshToken.id == stored.id, RefreshToken.revoked.is_(False))
            .values(revoked=True, revoked_at=now, revoked_reason="rotated")
            .returning(RefreshToken.id)
        )
        if claimed.scalar_one_or_none() is None:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, _INVALID_REFRESH)

        return await self._issue_tokens(user, ip, family_id=stored.family_id)

    async def logout(self, raw_token: str | None, user_id: UUID | None) -> None:
        """End the caller's sessions. Works from the cookie alone, so a user whose access
        token has already expired can still sign out (and the cookie is cleared by the
        router either way)."""
        user_ids: set[UUID] = {user_id} if user_id else set()
        if raw_token:
            result = await self.db.execute(
                select(RefreshToken.user_id).where(RefreshToken.token_hash == hash_token(raw_token))
            )
            owner = result.scalar_one_or_none()
            if owner:
                user_ids.add(owner)
        for uid in user_ids:
            await self.users.revoke_refresh_tokens(uid, "logout")

    async def update_self(
        self, user: User, data: SelfUpdate, ip: str | None = None
    ) -> tuple[User, IssuedSession | None]:
        """Apply a self-service profile change. Returns the user and, when the password
        changed, a fresh session for the device that changed it (every other session is
        signed out)."""
        session: IssuedSession | None = None

        if data.new_password is not None:
            if not verify_password(data.current_password or "", user.password_hash):
                # 403, not 401: the frontend treats any 401 as "access token expired".
                raise HTTPException(status.HTTP_403_FORBIDDEN, "Current password is incorrect")
            user.password_hash = hash_password(data.new_password)
            await self.users.revoke_refresh_tokens(user.id, "password")
            session = await self._issue_tokens(user, ip)
            await self.audit.log(user.id, "user", str(user.id), "password_change", ip=ip)

        if data.full_name is not None:
            user.full_name = data.full_name

        await self.db.flush()
        await self.db.refresh(user)
        return user, session

    # ── internals ────────────────────────────────────────────────────────────

    async def _find_valid_structure(self, raw_token: str | None) -> RefreshToken:
        """The stored row for a structurally valid refresh JWT, else 401. Rejecting garbage
        before touching the database keeps junk requests cheap."""
        if not raw_token:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, _INVALID_REFRESH)
        try:
            payload = decode_token(raw_token)
        except JWTError:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, _INVALID_REFRESH)
        if payload.get("type") != "refresh":
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, _INVALID_REFRESH)

        result = await self.db.execute(
            select(RefreshToken).where(RefreshToken.token_hash == hash_token(raw_token))
        )
        stored = result.scalar_one_or_none()
        if stored is None:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, _INVALID_REFRESH)
        return stored

    @staticmethod
    def _in_grace(stored: RefreshToken, now: datetime) -> bool:
        if stored.revoked_at is None:
            return False
        age = (now - stored.revoked_at).total_seconds()
        return age <= get_settings().REFRESH_REUSE_GRACE_SECONDS

    async def _revoke_family(self, family_id: UUID, reason: str) -> None:
        await self.db.execute(
            update(RefreshToken)
            .where(RefreshToken.family_id == family_id, RefreshToken.revoked.is_(False))
            .values(revoked=True, revoked_at=datetime.now(timezone.utc), revoked_reason=reason)
        )
        await self.db.flush()

    async def _commit_then_reject(self) -> None:
        """Persist the revocation, THEN answer 401.

        ``get_db`` rolls the session back when a request raises, which would silently undo the
        very revocation we are rejecting the request for. Commit first so it sticks.
        """
        await self.db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, _INVALID_REFRESH)

    async def _issue_tokens(
        self, user: User, ip: str | None, family_id: UUID | None = None
    ) -> IssuedSession:
        access = create_access_token(str(user.id), user.role)
        raw_refresh, expires_at = create_refresh_token(str(user.id))

        rt = RefreshToken(
            user_id=user.id,
            family_id=family_id or uuid.uuid4(),
            token_hash=hash_token(raw_refresh),
            expires_at=expires_at,
            ip_address=ip,
        )
        await self.tokens.create(rt)
        return IssuedSession(access_token=access, refresh_token=raw_refresh)
