from functools import lru_cache
from ipaddress import ip_network
from pathlib import Path
from typing import Literal

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/app/core/config.py -> backend/  (three .parent hops)
# Anchored to this file's own location, not the process's cwd — env_file
# below is otherwise resolved relative to wherever the process happened to
# be launched from, which silently finds nothing (falling back to the
# hardcoded defaults with no error) if uvicorn/pytest/alembic isn't started
# from inside backend/ specifically.
BASE_DIR = Path(__file__).resolve().parent.parent.parent


_PLACEHOLDER_SECRET = "change-this-secret-key-in-production"
KNOWN_DEFAULT_SEED_PASSWORD = "ChangeMe123!"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BASE_DIR / ".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    # Seed admin user (created on first boot if no users exist)
    SEED_ADMIN_EMAIL: str = "admin@loantrack.dev"
    SEED_ADMIN_PASSWORD: str = "ChangeMe123!"
    SEED_ADMIN_NAME: str = "Admin User"

    APP_NAME: str = "Interests Calculator"
    APP_VERSION: str = "2.0.0"
    DEBUG: bool = False
    API_V1_PREFIX: str = "/api/v1"

    DATABASE_URL: str = "postgresql+asyncpg://user:password@localhost:5432/interests_db"

    SECRET_KEY: str = _PLACEHOLDER_SECRET
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # The refresh token lives only in an httpOnly cookie (never in a response body or in
    # browser storage). The cookie is scoped to the auth routes so it is not sent on every
    # API call.
    REFRESH_COOKIE_NAME: str = "lt_refresh"
    # Secure = HTTPS only. Browsers also accept it on http://localhost; set false only for
    # plain-HTTP setups that are not localhost (e.g. a LAN IP), never in production.
    COOKIE_SECURE: bool = True
    # lax is right when the SPA and API share an origin (nginx proxies /api/). Use "none"
    # only for a split-origin deployment (it requires COOKIE_SECURE=true).
    COOKIE_SAMESITE: Literal["lax", "strict", "none"] = "lax"
    # A refresh token that was rotated away this recently and is presented again is treated
    # as a benign double-submit (two tabs, a retried request), not as theft: it is rejected
    # but the session survives. Outside this window a rotated token being replayed revokes
    # the whole token family.
    REFRESH_REUSE_GRACE_SECONDS: int = 10

    # Reverse proxies whose X-Forwarded-For we believe (IPs or CIDRs). Empty = trust no one:
    # the client address is the TCP peer. Behind nginx set this to the proxy's address or
    # network, otherwise every user shares the proxy's address (and one login rate-limit
    # bucket). Never put "0.0.0.0/0" here: that lets any client choose its own address.
    TRUSTED_PROXIES: list[str] = []

    # Upload caps (bytes). Enforced while the body streams in, before it is parsed.
    MAX_IMPORT_SIZE_BYTES: int = 5 * 1024 * 1024

    LOG_LEVEL: str = "INFO"
    # NOT USED. Kept so existing .env files that set it still load. A global per-IP
    # limit would count every user behind the shared proxy address together.
    RATE_LIMIT_PER_MINUTE: int = 60
    # Login attempts per minute per client address (per worker process).
    AUTH_RATE_LIMIT_PER_MINUTE: int = 5

    ALLOWED_ORIGINS: list[str] = ["http://localhost:5173"]

    WEBHOOK_TIMEOUT_SECONDS: int = 10
    WEBHOOK_MAX_RETRIES: int = 3
    WEBHOOK_RETRY_DELAY_SECONDS: int = 60

    # How often the in-process cycle-close scan runs (ADR-006) — no worker,
    # just a second asyncio task alongside the webhook retry loop.
    CYCLE_SCAN_INTERVAL_SECONDS: int = 3600

    @model_validator(mode="after")
    def _reject_insecure_defaults(self) -> "Settings":
        """Fail closed: refuse to boot outside DEBUG with a placeholder/short JWT secret
        (anyone could forge tokens, including admin ones)."""
        if not self.DEBUG:
            if self.SECRET_KEY == _PLACEHOLDER_SECRET or len(self.SECRET_KEY) < 32:
                raise ValueError(
                    "SECRET_KEY must be set to a random value of at least 32 characters "
                    "(e.g. `openssl rand -hex 32`). The built-in placeholder is only "
                    "allowed when DEBUG=true."
                )
        if self.COOKIE_SAMESITE == "none" and not self.COOKIE_SECURE:
            raise ValueError("COOKIE_SAMESITE=none requires COOKIE_SECURE=true")
        for entry in self.TRUSTED_PROXIES:
            try:
                net = ip_network(entry, strict=False)
            except ValueError as exc:
                raise ValueError(f"TRUSTED_PROXIES: {entry!r} is not an IP or CIDR") from exc
            if net.prefixlen == 0:
                raise ValueError(
                    "TRUSTED_PROXIES must not contain a catch-all network "
                    f"({entry!r}): clients could then spoof their address."
                )
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
