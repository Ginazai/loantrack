"""Smoke test for the `db` fixture itself — not app logic."""

import uuid

import pytest
from sqlalchemy import select

from app.modules.users.models import User


@pytest.mark.asyncio
async def test_db_fixture_can_insert_and_query(db):
    user = User(
        id=uuid.uuid4(),
        email="smoke@test.dev",
        full_name="Smoke Test",
        password_hash="x",
        role="user",
    )
    db.add(user)
    await db.flush()

    result = await db.execute(select(User).where(User.email == "smoke@test.dev"))
    found = result.scalar_one_or_none()
    assert found is not None
    assert found.full_name == "Smoke Test"


@pytest.mark.asyncio
async def test_db_fixture_rolls_back_between_tests(db):
    """If isolation works, the user from the previous test must be gone."""
    result = await db.execute(select(User).where(User.email == "smoke@test.dev"))
    assert result.scalar_one_or_none() is None
