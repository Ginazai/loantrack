"""
Shared fixtures for DB-backed tests.

Models use Postgres-specific types (dialects.postgresql.UUID, JSON,
LargeBinary/bytea) throughout, so these fixtures run against a real
Postgres instance rather than SQLite — SQLite can't compile those dialect
types, and a fake would let real constraint/type bugs through untested.

Requires DATABASE_URL to point at a throwaway Postgres database before
pytest starts (see CI: .github/workflows/ci.yml spins one up as a service
container). Locally:
    createdb loantrack_test
    export DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/loantrack_test
    export SECRET_KEY=test-secret-key
    pytest
"""

import asyncio
import os

import pytest
import pytest_asyncio

os.environ.setdefault(
    "DATABASE_URL", "postgresql+asyncpg://postgres:postgres@localhost:5432/loantrack_test"
)
os.environ.setdefault("SECRET_KEY", "test-secret-key-do-not-use-in-prod")
# The test client talks http://test; a Secure cookie would never be sent back over http.
os.environ.setdefault("COOKIE_SECURE", "false")

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import get_settings
from app.core.database import Base
from app.core.models_registry import *  # noqa: F401,F403,E402 — registers all models on Base

settings = get_settings()


@pytest.fixture(scope="session", autouse=True)
def _create_schema():
    """Creates every table once before the test session, drops them once
    after. Uses its own throwaway event loop via asyncio.run() rather than
    a pytest-asyncio fixture, specifically so this doesn't get entangled
    with pytest-asyncio's per-test loop lifecycle — sharing an engine
    (and the connections/loop-bound state it holds) across tests that each
    get their own fresh loop is what causes "Event loop is closed" errors
    on teardown. This way schema setup is a completely separate, self-
    contained async run that finishes (and cleans up) before any test's
    own loop even exists.
    """

    async def _setup():
        engine = create_async_engine(settings.DATABASE_URL)
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
            await conn.run_sync(Base.metadata.create_all)
        await engine.dispose()

    asyncio.run(_setup())
    yield

    async def _teardown():
        engine = create_async_engine(settings.DATABASE_URL)
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
        await engine.dispose()

    asyncio.run(_teardown())


@pytest_asyncio.fixture
async def db() -> AsyncSession:
    """One isolated session per test: a fresh engine (cheap — just a
    connection pool, no DDL) bound to whatever event loop pytest-asyncio
    hands this specific test, wrapped in a transaction that's rolled back
    afterward so tests never see each other's data."""
    engine = create_async_engine(settings.DATABASE_URL)
    async with engine.connect() as conn:
        trans = await conn.begin()
        session_factory = async_sessionmaker(
            bind=conn,
            class_=AsyncSession,
            expire_on_commit=False,
            join_transaction_mode="create_savepoint",
        )
        session = session_factory()
        try:
            yield session
        finally:
            await session.close()
            await trans.rollback()
    await engine.dispose()


@pytest.fixture(autouse=True)
def _reset_rate_limits():
    """auth/router.py's rate limiter (5/min on login, etc.) is an in-memory,
    process-wide counter keyed by caller IP — which the test client always
    presents as the same address. Without resetting it, the Nth auth test in
    a run (not just in a single file — the whole session) starts failing
    with 429 regardless of what it's actually testing. Reset before every
    test rather than once per session, since test order isn't guaranteed.
    """
    from app.modules.auth.router import limiter as auth_limiter

    auth_limiter.reset()
    yield


# ── HTTP-level fixtures ──────────────────────────────────────────────────────
# One httpx client wired straight into the real FastAPI `app`, with the
# get_db dependency overridden to the same transactional `db` session above
# (so a request's own session.commit() lands on a SAVEPOINT, not the real
# transaction — the outer rollback in `db` above still discards everything).
# This lets one test exercise router -> service -> model in a single call,
# instead of needing separate unit tests for each layer.

import uuid  # noqa: E402

from httpx import ASGITransport, AsyncClient  # noqa: E402

from app.core.database import get_db  # noqa: E402
from app.core.security import create_access_token, hash_password  # noqa: E402
from app.main import app  # noqa: E402
from app.modules.users.models import User  # noqa: E402


@pytest_asyncio.fixture
async def client(db: AsyncSession) -> AsyncClient:
    async def _override_get_db():
        yield db

    app.dependency_overrides[get_db] = _override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.pop(get_db, None)


async def _make_user(db: AsyncSession, *, role: str, email: str | None = None) -> User:
    user = User(
        id=uuid.uuid4(),
        email=email or f"{role}-{uuid.uuid4().hex[:8]}@test.dev",
        password_hash=hash_password("TestPassword123!"),
        full_name=f"Test {role.capitalize()}",
        role=role,
        is_active=True,
    )
    db.add(user)
    await db.flush()
    await db.refresh(user)
    return user


@pytest_asyncio.fixture
async def admin_user(db: AsyncSession) -> User:
    return await _make_user(db, role="admin")


@pytest_asyncio.fixture
async def regular_user(db: AsyncSession) -> User:
    return await _make_user(db, role="user")


async def _authed_client(db: AsyncSession, user: User) -> AsyncClient:
    """Own ASGITransport + own AsyncClient per role — deliberately NOT
    sharing a client (and therefore its mutable header dict) with any other
    authenticated fixture. A test requesting both admin_client and
    user_client needs two independent identities making two independent
    requests; sharing one client's headers means whichever fixture resolves
    last silently wins for the *entire* test, which looks exactly like a
    real authorization bug (both "users" see the same data) without being
    one — caught this the hard way while writing these tests."""

    async def _override_get_db():
        yield db

    app.dependency_overrides[get_db] = _override_get_db
    token = create_access_token(str(user.id), user.role)
    transport = ASGITransport(app=app)
    return AsyncClient(
        transport=transport, base_url="http://test", headers={"Authorization": f"Bearer {token}"}
    )


@pytest_asyncio.fixture
async def admin_client(db: AsyncSession, admin_user: User):
    async with await _authed_client(db, admin_user) as c:
        yield c
    app.dependency_overrides.pop(get_db, None)


@pytest_asyncio.fixture
async def user_client(db: AsyncSession, regular_user: User):
    async with await _authed_client(db, regular_user) as c:
        yield c
    app.dependency_overrides.pop(get_db, None)
