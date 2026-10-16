"""Smoke test for the `client`/`admin_client` HTTP fixtures themselves."""

import pytest


@pytest.mark.asyncio
async def test_admin_client_can_call_me_endpoint(admin_client, admin_user):
    res = await admin_client.get("/api/v1/auth/me")
    assert res.status_code == 200
    body = res.json()
    assert body["email"] == admin_user.email
    assert body["role"] == "admin"


@pytest.mark.asyncio
async def test_unauthenticated_request_is_rejected(client):
    res = await client.get("/api/v1/auth/me")
    assert res.status_code in (401, 403)


@pytest.mark.asyncio
async def test_regular_user_cannot_access_admin_endpoint(user_client):
    res = await user_client.get("/api/v1/admin/users")
    assert res.status_code == 403
