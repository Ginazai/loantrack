"""HTTP tests — admin editing of user accounts (PATCH /admin/users/{id})."""

import pytest

URL = "/api/v1/admin/users"


@pytest.mark.asyncio
async def test_admin_can_edit_name_email_and_role(admin_client, regular_user):
    res = await admin_client.patch(
        f"{URL}/{regular_user.id}",
        json={"full_name": "New Name", "email": "new.address@test.dev", "role": "admin"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["full_name"] == "New Name"
    assert body["email"] == "new.address@test.dev"
    assert body["role"] == "admin"


@pytest.mark.asyncio
async def test_partial_update_leaves_other_fields_untouched(admin_client, regular_user):
    original_email = regular_user.email
    res = await admin_client.patch(f"{URL}/{regular_user.id}", json={"full_name": "Only Name"})
    assert res.status_code == 200
    assert res.json()["email"] == original_email


@pytest.mark.asyncio
async def test_email_must_be_valid(admin_client, regular_user):
    res = await admin_client.patch(f"{URL}/{regular_user.id}", json={"email": "not-an-email"})
    assert res.status_code == 422


@pytest.mark.asyncio
async def test_duplicate_email_is_rejected(admin_client, admin_user, regular_user):
    res = await admin_client.patch(f"{URL}/{regular_user.id}", json={"email": admin_user.email})
    assert res.status_code == 409


@pytest.mark.asyncio
async def test_resubmitting_own_email_is_not_a_conflict(admin_client, regular_user):
    res = await admin_client.patch(f"{URL}/{regular_user.id}", json={"email": regular_user.email})
    assert res.status_code == 200


@pytest.mark.asyncio
async def test_invalid_role_is_rejected(admin_client, regular_user):
    res = await admin_client.patch(f"{URL}/{regular_user.id}", json={"role": "superuser"})
    assert res.status_code == 422


@pytest.mark.asyncio
async def test_blank_name_is_rejected(admin_client, regular_user):
    res = await admin_client.patch(f"{URL}/{regular_user.id}", json={"full_name": ""})
    assert res.status_code == 422


@pytest.mark.asyncio
async def test_admin_cannot_demote_self(admin_client, admin_user):
    res = await admin_client.patch(f"{URL}/{admin_user.id}", json={"role": "user"})
    assert res.status_code == 409


@pytest.mark.asyncio
async def test_unknown_user_is_404(admin_client):
    res = await admin_client.patch(
        f"{URL}/00000000-0000-0000-0000-000000000000", json={"full_name": "x"}
    )
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_regular_user_cannot_edit_users(user_client, regular_user):
    res = await user_client.patch(f"{URL}/{regular_user.id}", json={"full_name": "Hax"})
    assert res.status_code == 403


@pytest.mark.asyncio
async def test_edited_email_is_the_one_used_to_log_in(admin_client, regular_user, client):
    old_email = regular_user.email  # session is shared with the app; capture before it mutates
    await admin_client.patch(f"{URL}/{regular_user.id}", json={"email": "moved@test.dev"})
    ok = await client.post(
        "/api/v1/auth/login", json={"email": "moved@test.dev", "password": "TestPassword123!"}
    )
    assert ok.status_code == 200
    old = await client.post(
        "/api/v1/auth/login", json={"email": old_email, "password": "TestPassword123!"}
    )
    assert old.status_code == 401


# ── Password reset ───────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_admin_can_reset_password(admin_client, regular_user, client):
    res = await admin_client.patch(f"{URL}/{regular_user.id}", json={"password": "BrandNewPass99!"})
    assert res.status_code == 200
    assert "password" not in res.json() and "password_hash" not in res.json()
    ok = await client.post(
        "/api/v1/auth/login", json={"email": regular_user.email, "password": "BrandNewPass99!"}
    )
    assert ok.status_code == 200
    old = await client.post(
        "/api/v1/auth/login", json={"email": regular_user.email, "password": "TestPassword123!"}
    )
    assert old.status_code == 401


@pytest.mark.asyncio
async def test_short_password_is_rejected(admin_client, regular_user):
    res = await admin_client.patch(f"{URL}/{regular_user.id}", json={"password": "short"})
    assert res.status_code == 422


@pytest.mark.asyncio
async def test_password_reset_revokes_refresh_tokens(admin_client, regular_user, client):
    login = await client.post(
        "/api/v1/auth/login", json={"email": regular_user.email, "password": "TestPassword123!"}
    )
    refresh = login.json()["refresh_token"]
    await admin_client.patch(f"{URL}/{regular_user.id}", json={"password": "BrandNewPass99!"})
    res = await client.post("/api/v1/auth/refresh", json={"refresh_token": refresh})
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_non_password_edit_keeps_refresh_tokens_valid(admin_client, regular_user, client):
    login = await client.post(
        "/api/v1/auth/login", json={"email": regular_user.email, "password": "TestPassword123!"}
    )
    refresh = login.json()["refresh_token"]
    await admin_client.patch(f"{URL}/{regular_user.id}", json={"full_name": "Renamed"})
    res = await client.post("/api/v1/auth/refresh", json={"refresh_token": refresh})
    assert res.status_code == 200
