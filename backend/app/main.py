import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from app.core.config import get_settings
from app.core.database import AsyncSessionLocal, engine
from app.core.models_registry import *  # noqa: F401, F403 — ensures Alembic/SQLAlchemy see all models
from app.modules.accounts.router import router as accounts_router
from app.modules.admin.router import router as admin_router
from app.modules.auth.router import router as auth_router
from app.modules.loan_requests.router import router as loan_requests_router
from app.modules.payments.router import router as payments_router
from app.modules.webhooks.router import router as webhooks_router
from app.modules.webhooks.service import WebhookDeliveryService

settings = get_settings()
limiter = Limiter(key_func=get_remote_address, default_limits=[f"{settings.RATE_LIMIT_PER_MINUTE}/minute"])


async def _webhook_retry_loop() -> None:
    """Background task: attempt delivery of pending webhook events every 60s."""
    while True:
        await asyncio.sleep(settings.WEBHOOK_RETRY_DELAY_SECONDS)
        try:
            async with AsyncSessionLocal() as db:
                svc = WebhookDeliveryService(db)
                await svc.deliver_pending()
                await db.commit()
        except Exception as exc:
            print(f"[webhook-retry] Error: {exc}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(_webhook_retry_loop())
    yield
    task.cancel()


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    docs_url=f"{settings.API_V1_PREFIX}/docs",
    redoc_url=f"{settings.API_V1_PREFIX}/redoc",
    openapi_url=f"{settings.API_V1_PREFIX}/openapi.json",
    lifespan=lifespan,
)

# ── Middleware ────────────────────────────────────────────────────────────────

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ───────────────────────────────────────────────────────────────────

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
