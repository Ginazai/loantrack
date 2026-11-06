from uuid import UUID

from fastapi import APIRouter, Cookie, Depends, Header, HTTPException, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from slowapi import Limiter
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.client_ip import client_ip, rate_limit_key
from app.core.config import get_settings
from app.core.cookies import clear_refresh_cookie, set_refresh_cookie
from app.core.database import get_db
from app.core.dependencies import get_current_user, require_admin
from app.core.security import decode_token
from app.modules.auth.schemas import LoginRequest, TokenResponse
from app.modules.auth.service import AuthService
from app.modules.users.schemas import SelfUpdate, UserCreate, UserOut

settings = get_settings()

# The only rate limiter in the app: it applies to the routes decorated below.
# Counters are in memory per worker process. The key is the real client address, which
# behind a reverse proxy means honouring X-Forwarded-For from TRUSTED_PROXIES only
# (app/core/client_ip.py); otherwise every user would share the proxy's bucket.
limiter = Limiter(key_func=rate_limit_key)
router = APIRouter(prefix="/auth", tags=["auth"])

_optional_bearer = HTTPBearer(auto_error=False)


def require_csrf_header(x_requested_with: str | None = Header(default=None)) -> None:
    """The cookie-authenticated endpoints (refresh, logout) demand a custom header.

    A cross-site page can make the browser send our cookie, but it cannot add a custom header
    to a request without a CORS preflight, and the preflight is only granted to ALLOWED_ORIGINS.
    SameSite=lax already stops the cookie from being sent cross-site; this is the second layer
    (and the only one if COOKIE_SAMESITE=none is used for a split-origin deployment).
    """
    if x_requested_with != "XMLHttpRequest":
        raise HTTPException(403, "Missing X-Requested-With header")


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
async def login(
    request: Request, response: Response, data: LoginRequest, db: AsyncSession = Depends(get_db)
):
    svc = AuthService(db)
    session = await svc.login(data, ip=client_ip(request))
    set_refresh_cookie(response, session.refresh_token)
    return TokenResponse(access_token=session.access_token)


@router.post("/refresh", response_model=TokenResponse)
@limiter.limit("20/minute")
async def refresh(
    request: Request,
    response: Response,
    _csrf: None = Depends(require_csrf_header),
    refresh_cookie: str | None = Cookie(default=None, alias=settings.REFRESH_COOKIE_NAME),
    db: AsyncSession = Depends(get_db),
):
    svc = AuthService(db)
    # On failure the cookie is left alone on purpose: with two tabs racing, the loser's 401
    # arriving after the winner's Set-Cookie would otherwise delete the new, valid cookie.
    session = await svc.refresh(refresh_cookie, ip=client_ip(request))
    set_refresh_cookie(response, session.refresh_token)
    return TokenResponse(access_token=session.access_token)


@router.post("/logout", status_code=204)
async def logout(
    _csrf: None = Depends(require_csrf_header),
    refresh_cookie: str | None = Cookie(default=None, alias=settings.REFRESH_COOKIE_NAME),
    credentials: HTTPAuthorizationCredentials | None = Depends(_optional_bearer),
    db: AsyncSession = Depends(get_db),
):
    # Deliberately does not require a *valid* access token: someone whose 15-minute token just
    # expired must still be able to sign out. The refresh cookie identifies the session.
    user_id = None
    if credentials:
        try:
            payload = decode_token(credentials.credentials)
            if payload.get("type") == "access":
                user_id = UUID(payload["sub"])
        except (JWTError, KeyError, ValueError):
            pass
    await AuthService(db).logout(refresh_cookie, user_id)
    response = Response(status_code=204)
    clear_refresh_cookie(response)
    return response


@router.get("/me", response_model=UserOut)
async def me(current_user=Depends(get_current_user)):
    return current_user


@router.patch("/me", response_model=UserOut)
@limiter.limit("10/minute")
async def update_me(
    request: Request,
    response: Response,
    data: SelfUpdate,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    svc = AuthService(db)
    user, session = await svc.update_self(current_user, data, ip=client_ip(request))
    if session:  # password changed: other sessions are gone, this device gets a fresh one
        set_refresh_cookie(response, session.refresh_token)
    return user
