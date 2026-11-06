from functools import lru_cache
from pathlib import Path

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
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
