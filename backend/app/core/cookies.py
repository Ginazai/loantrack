"""The refresh-token cookie.

httpOnly (JavaScript cannot read it, so an XSS cannot steal the long-lived credential),
Secure (HTTPS only), SameSite (not sent on cross-site requests: the CSRF defence), and scoped
to /auth so the browser attaches it to refresh/logout only, not to every API call.
"""

from __future__ import annotations

from fastapi import Response

from app.core.config import get_settings


def _path() -> str:
    return f"{get_settings().API_V1_PREFIX}/auth"


def set_refresh_cookie(response: Response, token: str) -> None:
    s = get_settings()
    response.set_cookie(
        key=s.REFRESH_COOKIE_NAME,
        value=token,
        max_age=s.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 3600,
        path=_path(),
        httponly=True,
        secure=s.COOKIE_SECURE,
        samesite=s.COOKIE_SAMESITE,
    )


def clear_refresh_cookie(response: Response) -> None:
    s = get_settings()
    response.delete_cookie(
        key=s.REFRESH_COOKIE_NAME,
        path=_path(),
        httponly=True,
        secure=s.COOKIE_SECURE,
        samesite=s.COOKIE_SAMESITE,
    )
