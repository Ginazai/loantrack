"""Integration tests for /loan-requests — submission -> admin review -> account."""

import pytest


class TestSubmitRequest:
    @pytest.mark.asyncio
    async def test_submit_request_has_no_rate_or_cycle_yet(self, user_client):
        res = await user_client.post(
            "/api/v1/loan-requests",
            json={"account_name": "New Roof", "borrow_amount": "5000.00", "reason": "Storm damage"},
        )
        assert res.status_code == 201
        body = res.json()
        assert body["status"] == "requested"
        assert body["rate"] is None
        assert body["cycle"] is None

    @pytest.mark.asyncio
    async def test_submitting_rate_or_cycle_is_silently_ignored(self, user_client):
        """A borrower cannot set their own rate even by crafting the
        request body directly — the field doesn't exist on the schema."""
        res = await user_client.post(
            "/api/v1/loan-requests",
            json={
                "account_name": "Test",
                "borrow_amount": "1000.00",
                "rate": "0.01",
                "cycle": 30,
            },
        )
        assert res.status_code == 201
        assert res.json()["rate"] is None

    @pytest.mark.asyncio
    async def test_fourth_active_request_rejected(self, user_client):
        for _ in range(3):
            res = await user_client.post(
                "/api/v1/loan-requests",
                json={"account_name": "Loan", "borrow_amount": "100.00"},
            )
            assert res.status_code == 201

        fourth = await user_client.post(
            "/api/v1/loan-requests", json={"account_name": "Loan", "borrow_amount": "100.00"}
        )
        assert fourth.status_code == 409


class TestAdminReview:
    @pytest.mark.asyncio
    async def test_approve_without_rate_or_cycle_is_rejected(self, user_client, admin_client):
        submitted = await user_client.post(
            "/api/v1/loan-requests", json={"account_name": "Loan", "borrow_amount": "1000.00"}
        )
        request_id = submitted.json()["id"]

        res = await admin_client.patch(
            f"/api/v1/loan-requests/admin/{request_id}", json={"status": "approved"}
        )
        assert res.status_code == 422

    @pytest.mark.asyncio
    async def test_approve_with_rate_and_cycle_creates_account(
        self, user_client, admin_client, regular_user
    ):
        submitted = await user_client.post(
            "/api/v1/loan-requests",
            json={"account_name": "Approved Loan", "borrow_amount": "1000.00"},
        )
        request_id = submitted.json()["id"]

        res = await admin_client.patch(
            f"/api/v1/loan-requests/admin/{request_id}",
            json={"status": "approved", "rate": "0.05", "cycle": 15},
        )
        assert res.status_code == 200
        body = res.json()
        assert body["rate"] == "0.0500"
        assert body["cycle"] == 15

        # The lender's terms (rate/cycle) actually made it onto the
        # resulting account, not whatever the borrower might have hoped for.
        accounts = await user_client.get("/api/v1/accounts")
        created = next(a for a in accounts.json() if a["account_name"] == "Approved Loan")
        assert created["rate"] == "0.0500"
        assert created["cycle"] == 15

    @pytest.mark.asyncio
    async def test_reject_needs_no_rate_or_cycle(self, user_client, admin_client):
        submitted = await user_client.post(
            "/api/v1/loan-requests", json={"account_name": "Loan", "borrow_amount": "1000.00"}
        )
        request_id = submitted.json()["id"]

        res = await admin_client.patch(
            f"/api/v1/loan-requests/admin/{request_id}",
            json={"status": "rejected", "rejection_reason": "Not enough history"},
        )
        assert res.status_code == 200
        assert res.json()["status"] == "rejected"

    @pytest.mark.asyncio
    async def test_non_admin_cannot_review(self, user_client):
        submitted = await user_client.post(
            "/api/v1/loan-requests", json={"account_name": "Loan", "borrow_amount": "1000.00"}
        )
        request_id = submitted.json()["id"]

        res = await user_client.patch(
            f"/api/v1/loan-requests/admin/{request_id}",
            json={"status": "approved", "rate": "0.05", "cycle": 15},
        )
        assert res.status_code == 403


class TestCancelRequest:
    @pytest.mark.asyncio
    async def test_user_can_cancel_their_own_pending_request(self, user_client):
        submitted = await user_client.post(
            "/api/v1/loan-requests", json={"account_name": "Loan", "borrow_amount": "1000.00"}
        )
        request_id = submitted.json()["id"]

        res = await user_client.delete(f"/api/v1/loan-requests/{request_id}")
        assert res.status_code == 204

    @pytest.mark.asyncio
    async def test_cannot_cancel_already_approved_request(self, user_client, admin_client):
        submitted = await user_client.post(
            "/api/v1/loan-requests", json={"account_name": "Loan", "borrow_amount": "1000.00"}
        )
        request_id = submitted.json()["id"]
        await admin_client.patch(
            f"/api/v1/loan-requests/admin/{request_id}",
            json={"status": "approved", "rate": "0.05", "cycle": 15},
        )

        res = await user_client.delete(f"/api/v1/loan-requests/{request_id}")
        assert res.status_code == 409
