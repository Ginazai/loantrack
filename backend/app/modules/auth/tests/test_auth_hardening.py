"""Refresh-cookie flow, reuse detection, deactivation, CSRF header, self-service PATCH /auth/me."""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, update

from app.core.database import get_db
from app.core.security import hash_password
from app.main import app
from app.modules.users.models import RefreshToken, User

CSRF = {"X-Requested-With": "XMLHttpRequest"}
PASSWORD = "CorrectHorse123!"
COOKIE = "lt_refresh"
AUTH = "/api/v1/auth"


async def _user(db, email="h@test.dev", role="user", active=True) -> User:
    u = User(
        id=uuid.uuid4(),
        email=email,
        password_hash=hash_password(PASSWORD),
        full_name="Hard Ening",
        role=role,
        is_active=active,
    )
    db.add(u)
    await db.flush()
    await db.refresh(u)
    return u


async def _login(c, email="h@test.dev"):
    r = await c.post(f"{AUTH}/login", json={"email": email, "password": PASSWORD})
    assert r.status_code == 200, r.text
    return r


def _set_cookie(c, value):
    c.cookies.set(COOKIE, value, path=f"{AUTH}")


async def _age_revocation(db, seconds):
    """Pretend rotated tokens were rotated `seconds` ago (to step outside the grace window)."""
    await db.execute(
        update(RefreshToken)
        .where(RefreshToken.revoked_reason == "rotated")
        .values(revoked_at=datetime.now(timezone.utc) - timedelta(seconds=seconds))
    )
    await db.flush()


class TestCookie:
    async def test_cookie_attributes(self, client, db):
        await _user(db)
        r = await _login(client)
        header = r.headers["set-cookie"].lower()
        assert f"{COOKIE}=" in header
        assert "httponly" in header
        assert "samesite=lax" in header
        assert "path=/api/v1/auth" in header  # not sent with ordinary API calls
        assert "max-age=" in header

    async def test_secure_flag_follows_setting(self, client, db, monkeypatch):
        from app.core.config import get_settings

        monkeypatch.setattr(get_settings(), "COOKIE_SECURE", True)
        await _user(db)
        r = await _login(client)
        assert "secure" in r.headers["set-cookie"].lower()

    async def test_refresh_token_never_in_any_body(self, client, db):
        await _user(db)
        login = await _login(client)
        refreshed = await client.post(f"{AUTH}/refresh", headers=CSRF)
        for res in (login, refreshed):
            assert "refresh_token" not in res.text
            assert client.cookies.get(COOKIE) not in res.text

    async def test_refresh_requires_csrf_header(self, client, db):
        await _user(db)
        await _login(client)
        r = await client.post(f"{AUTH}/refresh")  # cookie present, header missing
        assert r.status_code == 403

    async def test_logout_requires_csrf_header(self, client, db):
        await _user(db)
        await _login(client)
        assert (await client.post(f"{AUTH}/logout")).status_code == 403

    async def test_logout_works_without_valid_access_token_and_clears_cookie(self, client, db):
        await _user(db)
        await _login(client)
        stale = client.cookies.get(COOKIE)
        r = await client.post(f"{AUTH}/logout", headers={**CSRF, "Authorization": "Bearer expired"})
        assert r.status_code == 204
        assert (
            f'{COOKIE}=""' in r.headers["set-cookie"]
            or "max-age=0" in r.headers["set-cookie"].lower()
        )
        _set_cookie(client, stale)
        assert (await client.post(f"{AUTH}/refresh", headers=CSRF)).status_code == 401


class TestReuseDetection:
    async def test_replaying_a_rotated_token_kills_the_whole_family(self, client, db):
        await _user(db)
        await _login(client)
        stolen = client.cookies.get(COOKIE)

        # Legitimate client rotates: now holds token 2.
        assert (await client.post(f"{AUTH}/refresh", headers=CSRF)).status_code == 200
        token2 = client.cookies.get(COOKIE)
        await _age_revocation(db, 60)  # well outside the grace window

        # Thief replays token 1 -> rejected, and the family is revoked...
        _set_cookie(client, stolen)
        assert (await client.post(f"{AUTH}/refresh", headers=CSRF)).status_code == 401

        # ...so even the legitimate holder's newest token no longer works.
        _set_cookie(client, token2)
        assert (await client.post(f"{AUTH}/refresh", headers=CSRF)).status_code == 401

    async def test_reuse_is_audited(self, client, db):
        from app.modules.audit.models import AuditLog

        await _user(db)
        await _login(client)
        stolen = client.cookies.get(COOKIE)
        await client.post(f"{AUTH}/refresh", headers=CSRF)
        await _age_revocation(db, 60)
        _set_cookie(client, stolen)
        await client.post(f"{AUTH}/refresh", headers=CSRF)

        rows = (
            (await db.execute(select(AuditLog).where(AuditLog.action == "reuse_detected")))
            .scalars()
            .all()
        )
        assert len(rows) == 1 and rows[0].entity_type == "refresh_token"

    async def test_immediate_double_submit_is_rejected_but_session_survives(self, client, db):
        """Two tabs / a retried request: the loser gets a 401 but must not nuke the session."""
        await _user(db)
        await _login(client)
        old = client.cookies.get(COOKIE)
        assert (await client.post(f"{AUTH}/refresh", headers=CSRF)).status_code == 200
        newest = client.cookies.get(COOKIE)

        _set_cookie(client, old)  # within the grace window
        assert (await client.post(f"{AUTH}/refresh", headers=CSRF)).status_code == 401

        _set_cookie(client, newest)
        assert (await client.post(f"{AUTH}/refresh", headers=CSRF)).status_code == 200

    async def test_replaying_a_logged_out_token_is_just_a_401(self, client, db):
        from app.modules.audit.models import AuditLog

        await _user(db)
        await _login(client)
        tok = client.cookies.get(COOKIE)
        await client.post(f"{AUTH}/logout", headers=CSRF)
        _set_cookie(client, tok)
        assert (await client.post(f"{AUTH}/refresh", headers=CSRF)).status_code == 401
        n = (
            (await db.execute(select(AuditLog).where(AuditLog.action == "reuse_detected")))
            .scalars()
            .all()
        )
        assert n == []  # a logout replay is not a theft signal

    async def test_separate_logins_are_separate_families(self, client, db):
        await _user(db)
        await _login(client)
        phone = client.cookies.get(COOKIE)
        await _login(client)
        laptop_old = client.cookies.get(COOKIE)
        await client.post(f"{AUTH}/refresh", headers=CSRF)
        await _age_revocation(db, 60)
        _set_cookie(client, laptop_old)  # replay on the laptop family
        await client.post(f"{AUTH}/refresh", headers=CSRF)
        _set_cookie(client, phone)  # the other device's family is untouched
        assert (await client.post(f"{AUTH}/refresh", headers=CSRF)).status_code == 200


@pytest_asyncio.fixture
async def strict_client(db):
    """Like production's get_db: commit on success, ROLLBACK when the request raises.

    The shared test override never rolls back, which would hide the bug where a revocation
    is undone by the rollback that follows the 401 it caused.
    """
    await db.commit()  # release the seed savepoint so a later rollback can't discard it

    async def _real_semantics():
        try:
            yield db
            await db.commit()
        except Exception:
            await db.rollback()
            raise

    app.dependency_overrides[get_db] = _real_semantics
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.pop(get_db, None)


class TestRevocationSurvivesTheRejection:
    async def test_family_revocation_is_committed_despite_the_401(self, strict_client, db):
        c = strict_client
        await _user(db)
        await db.commit()
        await _login(c)
        stolen = c.cookies.get(COOKIE)
        await c.post(f"{AUTH}/refresh", headers=CSRF)
        token2 = c.cookies.get(COOKIE)
        await _age_revocation(db, 60)
        await db.commit()

        _set_cookie(c, stolen)
        assert (await c.post(f"{AUTH}/refresh", headers=CSRF)).status_code == 401
        _set_cookie(c, token2)
        assert (await c.post(f"{AUTH}/refresh", headers=CSRF)).status_code == 401

    async def test_deactivated_users_tokens_are_committed_revoked(self, strict_client, db):
        c = strict_client
        u = await _user(db)
        await db.commit()
        await _login(c)
        u.is_active = False
        await db.commit()
        assert (await c.post(f"{AUTH}/refresh", headers=CSRF)).status_code == 401
        live = (
            (
                await db.execute(
                    select(RefreshToken).where(
                        RefreshToken.user_id == u.id, RefreshToken.revoked.is_(False)
                    )
                )
            )
            .scalars()
            .all()
        )
        assert live == []


class TestDeactivation:
    async def test_admin_deactivation_revokes_sessions_immediately(
        self, client, admin_client, db, regular_user
    ):
        r = await client.post(
            f"{AUTH}/login", json={"email": regular_user.email, "password": "TestPassword123!"}
        )
        assert r.status_code == 200
        res = await admin_client.patch(
            f"/api/v1/admin/users/{regular_user.id}", json={"is_active": False}
        )
        assert res.status_code == 200
        live = (
            (
                await db.execute(
                    select(RefreshToken).where(
                        RefreshToken.user_id == regular_user.id, RefreshToken.revoked.is_(False)
                    )
                )
            )
            .scalars()
            .all()
        )
        assert live == []
        assert (await client.post(f"{AUTH}/refresh", headers=CSRF)).status_code == 401

    async def test_reactivation_does_not_resurrect_old_sessions(
        self, client, admin_client, regular_user
    ):
        await client.post(
            f"{AUTH}/login", json={"email": regular_user.email, "password": "TestPassword123!"}
        )
        url = f"/api/v1/admin/users/{regular_user.id}"
        await admin_client.patch(url, json={"is_active": False})
        await admin_client.patch(url, json={"is_active": True})
        assert (await client.post(f"{AUTH}/refresh", headers=CSRF)).status_code == 401

    async def test_deactivated_user_with_valid_token_cannot_refresh(self, client, db):
        u = await _user(db)
        await _login(client)
        u.is_active = False  # flipped without going through the admin endpoint
        await db.flush()
        assert (await client.post(f"{AUTH}/refresh", headers=CSRF)).status_code == 401

    async def test_deleted_user_does_not_500(self, client, db):
        u = await _user(db)
        await _login(client)
        await db.delete(u)
        await db.flush()
        assert (await client.post(f"{AUTH}/refresh", headers=CSRF)).status_code == 401


class TestSelfUpdate:
    URL = f"{AUTH}/me"

    async def test_rename_needs_no_password(self, user_client):
        r = await user_client.patch(self.URL, json={"full_name": "  Ada  "})
        assert r.status_code == 200 and r.json()["full_name"] == "Ada"

    @pytest.mark.parametrize(
        "body",
        [
            {"role": "admin"},
            {"is_active": False},
            {"email": "x@y.dev"},
            {"password": "NewPassword456!"},  # old field name is gone, not silently ignored
            {"password_hash": "x"},
            {"id": str(uuid.uuid4())},
        ],
    )
    async def test_unknown_or_privileged_fields_are_rejected(self, user_client, body):
        r = await user_client.patch(self.URL, json=body)
        assert r.status_code == 422, r.text

    async def test_role_escalation_attempt_changes_nothing(self, user_client, regular_user):
        await user_client.patch(self.URL, json={"role": "admin", "full_name": "Sneaky"})
        me = await user_client.get(self.URL)
        assert me.json()["role"] == "user" and me.json()["full_name"] == "Test User"

    async def test_new_password_requires_current_password_field(self, user_client):
        r = await user_client.patch(self.URL, json={"new_password": "NewPassword456!"})
        assert r.status_code == 422

    async def test_wrong_current_password_is_403_and_changes_nothing(self, client, db):
        u = await _user(db)
        await _login(client)
        from app.core.security import create_access_token

        h = {"Authorization": f"Bearer {create_access_token(str(u.id), u.role)}"}
        r = await client.patch(
            self.URL,
            json={"current_password": "nope-nope", "new_password": "NewPassword456!"},
            headers=h,
        )
        assert r.status_code == 403  # not 401: the SPA treats 401 as "token expired"
        again = await client.post(f"{AUTH}/login", json={"email": u.email, "password": PASSWORD})
        assert again.status_code == 200

    async def test_password_change_signs_out_other_sessions_but_not_this_one(self, client, db):
        from app.core.security import create_access_token

        u = await _user(db)
        await _login(client)
        other_device = client.cookies.get(COOKIE)
        await _login(client)  # this device
        h = {"Authorization": f"Bearer {create_access_token(str(u.id), u.role)}"}
        r = await client.patch(
            self.URL,
            json={"current_password": PASSWORD, "new_password": "NewPassword456!"},
            headers=h,
        )
        assert r.status_code == 200
        assert (await client.post(f"{AUTH}/refresh", headers=CSRF)).status_code == 200  # this one

        _set_cookie(client, other_device)
        assert (await client.post(f"{AUTH}/refresh", headers=CSRF)).status_code == 401

    async def test_new_password_over_72_bytes_rejected(self, user_client):
        r = await user_client.patch(
            self.URL, json={"current_password": "TestPassword123!", "new_password": "x" * 73}
        )
        assert r.status_code == 422
