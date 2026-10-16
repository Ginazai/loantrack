"""
Integration tests for /accounts — exercises router + service + model
together through the real FastAPI app (see conftest.py's `admin_client`/
`user_client` fixtures).
"""

import pytest


def _account_payload(**overrides):
    payload = {
        "account_name": "Test Loan",
        "borrow_amount": "1000.00",
        "rate": "0.05",
        "cycle": 15,
        "start_date": "2026-01-01",
    }
    payload.update(overrides)
    return payload


class TestCreateAccount:
    @pytest.mark.asyncio
    async def test_user_creates_account_linked_to_self(self, user_client, regular_user):
        res = await user_client.post("/api/v1/accounts", json=_account_payload())
        assert res.status_code == 201
        body = res.json()
        assert body["account_name"] == "Test Loan"
        assert body["status"] == "open"
        assert body["borrower_name"] == regular_user.full_name

    @pytest.mark.asyncio
    async def test_admin_links_account_to_specified_user(self, admin_client, regular_user):
        """Regression test for the "creates account with no linked user" bug:
        an admin-created account with linked_user_id must actually belong to
        that user, not to the admin who created it."""
        res = await admin_client.post(
            "/api/v1/accounts",
            json=_account_payload(linked_user_id=str(regular_user.id)),
        )
        assert res.status_code == 201
        body = res.json()
        assert body["borrower_name"] == regular_user.full_name

        # Confirm from the user's own side too: it should show up in their list.
        list_res = await admin_client.get("/api/v1/accounts")
        assert any(a["id"] == body["id"] for a in list_res.json())

    @pytest.mark.asyncio
    async def test_non_admin_cannot_assign_linked_user_id(self, user_client, admin_user):
        """A regular user passing linked_user_id should NOT be able to assign
        the account to someone else (the router ignores it unless admin)."""
        res = await user_client.post(
            "/api/v1/accounts",
            json=_account_payload(linked_user_id=str(admin_user.id)),
        )
        assert res.status_code == 201
        # Belongs to the caller regardless of what they requested.
        assert res.json()["borrower_name"] != admin_user.full_name

    @pytest.mark.asyncio
    async def test_invalid_rate_returns_422_not_500(self, user_client):
        res = await user_client.post("/api/v1/accounts", json=_account_payload(rate="5"))
        assert res.status_code == 422


class TestListAndGetAccount:
    @pytest.mark.asyncio
    async def test_user_only_sees_own_accounts(self, user_client, admin_client):
        mine = await user_client.post("/api/v1/accounts", json=_account_payload())
        await admin_client.post("/api/v1/accounts", json=_account_payload(account_name="Admin's"))

        res = await user_client.get("/api/v1/accounts")
        ids = [a["id"] for a in res.json()]
        assert mine.json()["id"] in ids
        assert len(res.json()) == 1

    @pytest.mark.asyncio
    async def test_admin_sees_all_accounts(self, user_client, admin_client):
        await user_client.post("/api/v1/accounts", json=_account_payload())
        await admin_client.post("/api/v1/accounts", json=_account_payload(account_name="Admin's"))

        res = await admin_client.get("/api/v1/accounts")
        assert len(res.json()) >= 2

    @pytest.mark.asyncio
    async def test_get_single_account(self, user_client):
        created = await user_client.post("/api/v1/accounts", json=_account_payload())
        account_id = created.json()["id"]

        res = await user_client.get(f"/api/v1/accounts/{account_id}")
        assert res.status_code == 200
        assert res.json()["id"] == account_id

    @pytest.mark.asyncio
    async def test_user_cannot_get_another_users_account(self, user_client, admin_client):
        created = await admin_client.post("/api/v1/accounts", json=_account_payload())
        account_id = created.json()["id"]

        res = await user_client.get(f"/api/v1/accounts/{account_id}")
        assert res.status_code == 404  # not leaked as 403 — existence isn't confirmed either


class TestUpdateAndCloseAccount:
    @pytest.mark.asyncio
    async def test_update_account_name(self, user_client):
        created = await user_client.post("/api/v1/accounts", json=_account_payload())
        account_id = created.json()["id"]

        res = await user_client.patch(
            f"/api/v1/accounts/{account_id}", json={"account_name": "Renamed"}
        )
        assert res.status_code == 200
        assert res.json()["account_name"] == "Renamed"

    @pytest.mark.asyncio
    async def test_close_account(self, user_client):
        created = await user_client.post("/api/v1/accounts", json=_account_payload())
        account_id = created.json()["id"]

        res = await user_client.post(
            f"/api/v1/accounts/{account_id}/close", json={"close_reason": "Paid off in cash"}
        )
        assert res.status_code == 200
        assert res.json()["status"] == "closed"
        assert res.json()["close_reason"] == "Paid off in cash"


class TestPurgeAccount:
    @pytest.mark.asyncio
    async def test_user_can_purge_their_own_closed_account(self, user_client):
        """Self-service deletion of a closed account is intentionally
        allowed without admin/force — force only bypasses the "must be
        closed first" rule below, it's not a general permission gate."""
        created = await user_client.post("/api/v1/accounts", json=_account_payload())
        account_id = created.json()["id"]
        await user_client.post(f"/api/v1/accounts/{account_id}/close", json={})

        res = await user_client.delete(f"/api/v1/accounts/{account_id}")
        assert res.status_code == 204

    @pytest.mark.asyncio
    async def test_user_cannot_purge_a_still_open_account(self, user_client):
        created = await user_client.post("/api/v1/accounts", json=_account_payload())
        account_id = created.json()["id"]

        res = await user_client.delete(f"/api/v1/accounts/{account_id}")
        assert res.status_code == 409  # must be closed first (not force=true-able by a non-admin)

    @pytest.mark.asyncio
    async def test_admin_can_purge_closed_account_with_force(self, admin_client):
        created = await admin_client.post("/api/v1/accounts", json=_account_payload())
        account_id = created.json()["id"]
        await admin_client.post(f"/api/v1/accounts/{account_id}/close", json={})

        res = await admin_client.delete(f"/api/v1/accounts/{account_id}?force=true")
        assert res.status_code == 204

        follow_up = await admin_client.get(f"/api/v1/accounts/{account_id}")
        assert follow_up.status_code == 404


class TestCyclePreview:
    @pytest.mark.asyncio
    async def test_cycle_preview_returns_dates(self, user_client):
        created = await user_client.post(
            "/api/v1/accounts", json=_account_payload(start_date="2026-01-01")
        )
        account_id = created.json()["id"]

        res = await user_client.get(f"/api/v1/accounts/{account_id}/cycle-preview")
        assert res.status_code == 200
        dates = res.json()
        assert isinstance(dates, list)
        assert len(dates) > 0
