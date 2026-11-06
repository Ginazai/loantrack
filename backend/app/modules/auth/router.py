from fastapi import APIRouter, Depends, Request
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import get_db
from app.core.dependencies import get_current_user, require_admin
from app.modules.auth.schemas import LoginRequest, RefreshRequest, TokenResponse
from app.modules.auth.service import AuthService
from app.modules.users.schemas import UserCreate, UserOut

settings = get_settings()

# The only rate limiter in the app: it applies to the routes decorated below.
# Counters are in memory per worker process and keyed by the client address the
# backend sees (see docs/architecture.md, "Rate limiting").
limiter = Limiter(key_func=get_remote_address)
router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=UserOut, status_code=201)
@limiter.limit("10/minute")
async def register(
    request: Request,
    data: UserCreate,
    _admin=Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Create a user (admin only; equivalent to POST /admin/users).

    This used to be public and trusted the ``role`` in the body, which let
    anyone create an admin. Accounts are provisioned by admins only.
    """
    svc = AuthService(db)
    return await svc.register(data)


@router.post("/login", response_model=TokenResponse)
@limiter.limit(f"{settings.AUTH_RATE_LIMIT_PER_MINUTE}/minute")
async def login(request: Request, data: LoginRequest, db: AsyncSession = Depends(get_db)):
    svc = AuthService(db)
    ip = request.client.host if request.client else None
    return await svc.login(data, ip=ip)


@router.post("/refresh", response_model=TokenResponse)
@limiter.limit("20/minute")
async def refresh(request: Request, data: RefreshRequest, db: AsyncSession = Depends(get_db)):
    svc = AuthService(db)
    ip = request.client.host if request.client else None
    return await svc.refresh(data.refresh_token, ip=ip)


@router.post("/logout", status_code=204)
async def logout(
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    svc = AuthService(db)
    await svc.logout(current_user.id)


@router.get("/me", response_model=UserOut)
async def me(current_user=Depends(get_current_user)):
    return current_user


@router.patch("/me", response_model=UserOut)
async def update_me(
    data: dict,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy import select

    from app.core.security import hash_password
    from app.modules.users.models import User

    result = await db.execute(select(User).where(User.id == current_user.id))
    user = result.scalar_one()
    if "full_name" in data and data["full_name"]:
        user.full_name = data["full_name"]
    if "password" in data and data["password"]:
        user.password_hash = hash_password(data["password"])
    await db.flush()
    await db.refresh(user)
    return user
