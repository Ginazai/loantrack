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
    async def test_user_cannot_create_account_directly(self, user_client):
        """Borrowers ask for a loan via /loan-requests (amount only); only an admin
        creates accounts, because rate/cycle are the lender's terms."""
        res = await user_client.post("/api/v1/accounts", json=_account_payload())
        assert res.status_code == 403

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
    async def test_start_date_and_amount_are_bounded(self, admin_client):
        """Ancient start dates / absurd amounts used to make the ledger math blow up."""
        too_old = await admin_client.post(
            "/api/v1/accounts", json=_account_payload(start_date="0001-01-01")
        )
        assert too_old.status_code == 422
        too_big = await admin_client.post(
            "/api/v1/accounts", json=_account_payload(borrow_amount="99999999999999.00")
        )
        assert too_big.status_code == 422

    @pytest.mark.asyncio
    async def test_runaway_compounding_does_not_break_listing(self, admin_client):
        """rate=1 from 2021 overflows Decimal precision; that one account must degrade
        to an unknown balance instead of 500-ing every list/export for everyone."""
        bad = await admin_client.post(
            "/api/v1/accounts", json=_account_payload(rate="1", start_date="2021-01-01")
        )
        assert bad.status_code == 201
        assert bad.json()["current_balance"] is None
        listing = await admin_client.get("/api/v1/accounts")
        assert listing.status_code == 200

    @pytest.mark.asyncio
    async def test_invalid_rate_returns_422_not_500(self, admin_client):
        res = await admin_client.post("/api/v1/accounts", json=_account_payload(rate="5"))
        assert res.status_code == 422


class TestListAndGetAccount:
    @pytest.mark.asyncio
    async def test_user_only_sees_own_accounts(self, user_client, admin_client, regular_user):
        mine = await admin_client.post(
            "/api/v1/accounts", json=_account_payload(linked_user_id=str(regular_user.id))
        )
        await admin_client.post("/api/v1/accounts", json=_account_payload(account_name="Admin's"))

        res = await user_client.get("/api/v1/accounts")
        ids = [a["id"] for a in res.json()]
        assert mine.json()["id"] in ids
        assert len(res.json()) == 1

    @pytest.mark.asyncio
    async def test_admin_sees_all_accounts(self, admin_client):
        await admin_client.post("/api/v1/accounts", json=_account_payload())
        await admin_client.post("/api/v1/accounts", json=_account_payload(account_name="Admin's"))

        res = await admin_client.get("/api/v1/accounts")
        assert len(res.json()) >= 2

    @pytest.mark.asyncio
    async def test_get_single_account(self, admin_client):
        created = await admin_client.post("/api/v1/accounts", json=_account_payload())
        account_id = created.json()["id"]

        res = await admin_client.get(f"/api/v1/accounts/{account_id}")
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
    async def test_update_account_name(self, admin_client):
        created = await admin_client.post("/api/v1/accounts", json=_account_payload())
        account_id = created.json()["id"]

        res = await admin_client.patch(
            f"/api/v1/accounts/{account_id}", json={"account_name": "Renamed"}
        )
        assert res.status_code == 200
        assert res.json()["account_name"] == "Renamed"

    @pytest.mark.asyncio
    async def test_close_account(self, admin_client):
        created = await admin_client.post("/api/v1/accounts", json=_account_payload())
        account_id = created.json()["id"]

        res = await admin_client.post(
            f"/api/v1/accounts/{account_id}/close", json={"close_reason": "Paid off in cash"}
        )
        assert res.status_code == 200
        assert res.json()["status"] == "closed"
        assert res.json()["close_reason"] == "Paid off in cash"


class TestPurgeAccount:
    @pytest.mark.asyncio
    async def test_user_cannot_edit_terms_close_or_purge_own_account(
        self, user_client, admin_client, regular_user
    ):
        """A borrower must not be able to lower their own rate, mark the loan paid,
        close it, or delete it (erasing the debt)."""
        created = await admin_client.post(
            "/api/v1/accounts", json=_account_payload(linked_user_id=str(regular_user.id))
        )
        account_id = created.json()["id"]

        assert (
            await user_client.patch(f"/api/v1/accounts/{account_id}", json={"rate": "0.0001"})
        ).status_code == 403
        assert (
            await user_client.patch(f"/api/v1/accounts/{account_id}", json={"status": "paid"})
        ).status_code == 403
        assert (
            await user_client.post(f"/api/v1/accounts/{account_id}/close", json={})
        ).status_code == 403
        assert (await user_client.delete(f"/api/v1/accounts/{account_id}")).status_code == 403

        # Still intact, and still readable by its owner.
        still = await user_client.get(f"/api/v1/accounts/{account_id}")
        assert still.status_code == 200
        assert still.json()["status"] == "open"

    @pytest.mark.asyncio
    async def test_admin_cannot_purge_open_account_without_force(self, admin_client):
        created = await admin_client.post("/api/v1/accounts", json=_account_payload())
        account_id = created.json()["id"]

        res = await admin_client.delete(f"/api/v1/accounts/{account_id}")
        assert res.status_code == 409  # must be closed first unless force=true

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
    async def test_cycle_preview_returns_dates(self, admin_client):
        created = await admin_client.post(
            "/api/v1/accounts", json=_account_payload(start_date="2026-01-01")
        )
        account_id = created.json()["id"]

        res = await admin_client.get(f"/api/v1/accounts/{account_id}/cycle-preview")
        assert res.status_code == 200
        dates = res.json()
        assert isinstance(dates, list)
        assert len(dates) > 0
