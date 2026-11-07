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

# The refresh/logout endpoints are cookie-authenticated and demand this header (CSRF defence).
CSRF = {"X-Requested-With": "XMLHttpRequest"}


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
        assert "access_token" in body
        # The refresh token must never be readable by page JavaScript.
        assert "refresh_token" not in body
        assert "lt_refresh" in res.headers["set-cookie"]

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
    @staticmethod
    async def _login(client):
        res = await client.post(
            "/api/v1/auth/login",
            json={"email": "login-test@test.dev", "password": "CorrectHorse123!"},
        )
        assert res.status_code == 200, res.text
        return res

    @pytest.mark.asyncio
    async def test_refresh_rotates_token(self, client, db):
        await _seed_user(db)
        await self._login(client)
        old_refresh = client.cookies.get("lt_refresh")

        refreshed = await client.post("/api/v1/auth/refresh", headers=CSRF)
        assert refreshed.status_code == 200
        assert "refresh_token" not in refreshed.json()
        assert client.cookies.get("lt_refresh") != old_refresh

        # Old refresh token is spent — presenting it again must fail.
        client.cookies.set("lt_refresh", old_refresh, path="/api/v1/auth")
        reused = await client.post("/api/v1/auth/refresh", headers=CSRF)
        assert reused.status_code == 401

    @pytest.mark.asyncio
    async def test_refresh_with_garbage_token_returns_401_not_500(self, client):
        client.cookies.set("lt_refresh", "garbage", path="/api/v1/auth")
        res = await client.post("/api/v1/auth/refresh", headers=CSRF)
        assert res.status_code == 401

    @pytest.mark.asyncio
    async def test_refresh_without_cookie_returns_401(self, client):
        res = await client.post("/api/v1/auth/refresh", headers=CSRF)
        assert res.status_code == 401

    @pytest.mark.asyncio
    async def test_logout_revokes_refresh_token(self, client, db):
        await _seed_user(db)
        login = await self._login(client)
        access = login.json()["access_token"]
        refresh = client.cookies.get("lt_refresh")

        logout_res = await client.post(
            "/api/v1/auth/logout", headers={**CSRF, "Authorization": f"Bearer {access}"}
        )
        assert logout_res.status_code == 204

        client.cookies.set("lt_refresh", refresh, path="/api/v1/auth")
        after_logout = await client.post("/api/v1/auth/refresh", headers=CSRF)
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
            json={"current_password": "CorrectHorse123!", "new_password": "NewPassword456!"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert update.status_code == 200

        relogin = await client.post(
            "/api/v1/auth/login",
            json={"email": "login-test@test.dev", "password": "NewPassword456!"},
        )
        assert relogin.status_code == 200


class TestRegister:
    """POST /auth/register must not be a public way to mint accounts.

    Regression coverage for a privilege-escalation hole: the endpoint used to
    be unauthenticated and honoured a caller-supplied ``role``, so anyone who
    could reach the API could create an admin. It is now admin-only (the same
    rule as POST /admin/users).
    """

    PAYLOAD = {
        "email": "new-person@test.dev",
        "password": "CorrectHorse123!",
        "full_name": "New Person",
    }

    @pytest.mark.asyncio
    async def test_anonymous_cannot_register_anyone(self, client):
        res = await client.post("/api/v1/auth/register", json=self.PAYLOAD)
        assert res.status_code in (401, 403), res.text

    @pytest.mark.asyncio
    async def test_anonymous_cannot_self_register_as_admin(self, client, db):
        from sqlalchemy import select

        from app.modules.users.models import User

        res = await client.post("/api/v1/auth/register", json={**self.PAYLOAD, "role": "admin"})
        assert res.status_code in (401, 403), res.text
        created = await db.execute(select(User).where(User.email == self.PAYLOAD["email"]))
        assert created.scalar_one_or_none() is None

    @pytest.mark.asyncio
    async def test_regular_user_cannot_register(self, user_client):
        res = await user_client.post(
            "/api/v1/auth/register", json={**self.PAYLOAD, "role": "admin"}
        )
        assert res.status_code == 403, res.text

    @pytest.mark.asyncio
    async def test_admin_can_register_and_choose_role(self, admin_client):
        res = await admin_client.post(
            "/api/v1/auth/register", json={**self.PAYLOAD, "role": "admin"}
        )
        assert res.status_code == 201, res.text
        assert res.json()["role"] == "admin"

    @pytest.mark.asyncio
    async def test_admin_register_defaults_to_user_role(self, admin_client):
        res = await admin_client.post("/api/v1/auth/register", json=self.PAYLOAD)
        assert res.status_code == 201, res.text
        assert res.json()["role"] == "user"


class TestLoginRateLimit:
    @pytest.mark.asyncio
    async def test_login_limit_follows_AUTH_RATE_LIMIT_PER_MINUTE(self, client, db):
        """The limit comes from settings, not a number hard-coded in the router."""
        from app.core.config import get_settings

        await _seed_user(db, email="rl@test.dev")
        limit = get_settings().AUTH_RATE_LIMIT_PER_MINUTE
        bad = {"email": "rl@test.dev", "password": "wrong"}

        codes = [
            (await client.post("/api/v1/auth/login", json=bad)).status_code
            for _ in range(limit + 1)
        ]

        assert codes[:limit] == [401] * limit
        assert codes[limit] == 429
