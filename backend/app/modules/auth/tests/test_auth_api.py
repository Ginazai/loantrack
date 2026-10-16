"""Integration tests for /auth — login, refresh, logout, me, update_me.

The login tests are the regression coverage for the "login failure causes a
hard reload instead of showing an error" bug: that was a frontend axios
interceptor issue (a 401 from /auth/login triggered a token-refresh attempt
with no refresh token, which itself 401'd and force-redirected). These
tests confirm the backend side of that contract: a bad login must return a
clean 401 with a plain-string detail, never anything that could cascade.
"""

import pytest

from app.core.security import hash_password


async def _seed_user(db, *, email="login-test@test.dev", password="CorrectHorse123!", role="user"):
    import uuid

    from app.modules.users.models import User

    user = User(
        id=uuid.uuid4(),
        email=email,
        password_hash=hash_password(password),
        full_name="Login Test",
        role=role,
        is_active=True,
    )
    db.add(user)
    await db.flush()
    await db.refresh(user)
    return user


class TestLogin:
    @pytest.mark.asyncio
    async def test_correct_credentials_returns_tokens(self, client, db):
        await _seed_user(db)
        res = await client.post(
            "/api/v1/auth/login",
            json={"email": "login-test@test.dev", "password": "CorrectHorse123!"},
        )
        assert res.status_code == 200, res.text
        body = res.json()
        assert "access_token" in body and "refresh_token" in body

    @pytest.mark.asyncio
    async def test_wrong_password_returns_clean_401(self, client, db):
        await _seed_user(db)
        res = await client.post(
            "/api/v1/auth/login",
            json={"email": "login-test@test.dev", "password": "wrong-password"},
        )
        assert res.status_code == 401
        # Must be a plain string, not a validation-error-shaped array — a
        # frontend rendering this directly as `{error}` must not crash.
        assert isinstance(res.json()["detail"], str)

    @pytest.mark.asyncio
    async def test_unknown_email_returns_401_not_404(self, client):
        """Doesn't leak which emails exist."""
        res = await client.post(
            "/api/v1/auth/login",
            json={"email": "nobody@test.dev", "password": "whatever123"},
        )
        assert res.status_code == 401

    @pytest.mark.asyncio
    async def test_malformed_email_returns_422_not_500(self, client):
        res = await client.post(
            "/api/v1/auth/login", json={"email": "not-an-email", "password": "x"}
        )
        assert res.status_code == 422

    @pytest.mark.asyncio
    async def test_inactive_user_cannot_login(self, client, db):
        user = await _seed_user(db, email="inactive@test.dev")
        user.is_active = False
        await db.flush()

        res = await client.post(
            "/api/v1/auth/login",
            json={"email": "inactive@test.dev", "password": "CorrectHorse123!"},
        )
        assert res.status_code == 403


class TestRefreshAndLogout:
    @pytest.mark.asyncio
    async def test_refresh_rotates_token(self, client, db):
        await _seed_user(db)
        login = await client.post(
            "/api/v1/auth/login",
            json={"email": "login-test@test.dev", "password": "CorrectHorse123!"},
        )
        old_refresh = login.json()["refresh_token"]

        refreshed = await client.post("/api/v1/auth/refresh", json={"refresh_token": old_refresh})
        assert refreshed.status_code == 200
        assert refreshed.json()["refresh_token"] != old_refresh

        # Old refresh token is revoked — reusing it must fail. (Not
        # asserting the *access* token differs from the original: it's a
        # JWT of {sub, role, exp} with no nonce, so re-issuing it for the
        # same user within the same second is legitimately byte-identical
        # — that's an artifact of deterministic signing, not a bug.)
        reused = await client.post("/api/v1/auth/refresh", json={"refresh_token": old_refresh})
        assert reused.status_code == 401

    @pytest.mark.asyncio
    async def test_refresh_with_garbage_token_returns_401_not_500(self, client):
        res = await client.post("/api/v1/auth/refresh", json={"refresh_token": "garbage"})
        assert res.status_code == 401

    @pytest.mark.asyncio
    async def test_logout_revokes_refresh_token(self, client, db):
        await _seed_user(db)
        login = await client.post(
            "/api/v1/auth/login",
            json={"email": "login-test@test.dev", "password": "CorrectHorse123!"},
        )
        access = login.json()["access_token"]
        refresh = login.json()["refresh_token"]

        logout_res = await client.post(
            "/api/v1/auth/logout", headers={"Authorization": f"Bearer {access}"}
        )
        assert logout_res.status_code == 204

        after_logout = await client.post("/api/v1/auth/refresh", json={"refresh_token": refresh})
        assert after_logout.status_code == 401


class TestMeAndUpdateMe:
    @pytest.mark.asyncio
    async def test_update_full_name(self, user_client, regular_user):
        res = await user_client.patch("/api/v1/auth/me", json={"full_name": "New Name"})
        assert res.status_code == 200
        assert res.json()["full_name"] == "New Name"

    @pytest.mark.asyncio
    async def test_update_password_allows_relogin(self, client, db):
        user = await _seed_user(db)
        from app.core.security import create_access_token

        token = create_access_token(str(user.id), user.role)
        update = await client.patch(
            "/api/v1/auth/me",
            json={"password": "NewPassword456!"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert update.status_code == 200

        relogin = await client.post(
            "/api/v1/auth/login",
            json={"email": "login-test@test.dev", "password": "NewPassword456!"},
        )
        assert relogin.status_code == 200
