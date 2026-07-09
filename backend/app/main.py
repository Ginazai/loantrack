import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from app.core.config import get_settings
from app.core.database import AsyncSessionLocal, engine
from app.core.exceptions import register_exception_handlers
from app.core.logging import configure_logging, get_logger
from app.core.models_registry import *  # noqa: F401, F403
from app.modules.accounts.router import router as accounts_router
from app.modules.admin.router import router as admin_router
from app.modules.auth.router import router as auth_router
from app.modules.loan_requests.router import router as loan_requests_router
from app.modules.payments.router import router as payments_router
from app.modules.webhooks.router import router as webhooks_router
from app.modules.webhooks.service import WebhookDeliveryService

settings = get_settings()
configure_logging(settings.LOG_LEVEL if hasattr(settings, "LOG_LEVEL") else "INFO")
logger = get_logger(__name__)

limiter = Limiter(key_func=get_remote_address, default_limits=[f"{settings.RATE_LIMIT_PER_MINUTE}/minute"])


class _SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Adds CSP and other security headers to every response."""
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline'; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src 'self' https://fonts.gstatic.com; "
            "img-src 'self' data:; "
            "connect-src 'self'"
        )
        return response


async def _webhook_retry_loop() -> None:
    while True:
        await asyncio.sleep(settings.WEBHOOK_RETRY_DELAY_SECONDS)
        try:
            async with AsyncSessionLocal() as db:
                svc = WebhookDeliveryService(db)
                await svc.deliver_pending()
                await db.commit()
        except Exception as exc:
            logger.exception("webhook_retry_error", extra={"error": str(exc)})


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("startup", extra={"version": settings.APP_VERSION})
    task = asyncio.create_task(_webhook_retry_loop())
    yield
    task.cancel()
    logger.info("shutdown")


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    docs_url=f"{settings.API_V1_PREFIX}/docs",
    redoc_url=f"{settings.API_V1_PREFIX}/redoc",
    openapi_url=f"{settings.API_V1_PREFIX}/openapi.json",
    lifespan=lifespan,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
register_exception_handlers(app)

app.add_middleware(_SecurityHeadersMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

prefix = settings.API_V1_PREFIX
app.include_router(auth_router, prefix=prefix)
app.include_router(accounts_router, prefix=prefix)
app.include_router(payments_router, prefix=prefix)
app.include_router(webhooks_router, prefix=prefix)
app.include_router(admin_router, prefix=prefix)
app.include_router(loan_requests_router, prefix=prefix)


@app.get(f"{prefix}/health", tags=["health"])
async def health():
    return {"status": "ok", "version": settings.APP_VERSION}
