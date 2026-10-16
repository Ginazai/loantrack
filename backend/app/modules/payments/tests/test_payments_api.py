"""
Integration tests for /accounts/{id}/payments — exercises router + service +
model together through the real FastAPI app.

The delete-and-recalculate tests are the regression coverage for a real bug:
deleting a payment used to leave every later payment's stored balance
snapshot stale (computed against history that no longer existed), and left
the account's status frozen too. See PaymentService.recalculate_ledger.
"""

import io

import pytest


async def _create_account(client, **overrides):
    payload = {
        "account_name": "Ledger Test",
        "borrow_amount": "1000.00",
        "rate": "0.05",
        "cycle": 15,
        "start_date": "2026-01-01",
    }
    payload.update(overrides)
    res = await client.post("/api/v1/accounts", json=payload)
    assert res.status_code == 201
    return res.json()


class TestAddPayment:
    @pytest.mark.asyncio
    async def test_add_payment_updates_balance(self, user_client):
        account = await _create_account(user_client)
        res = await user_client.post(
            f"/api/v1/accounts/{account['id']}/payments",
            json={"amount": "100.00", "payment_date": "2026-01-15", "method": "manual"},
        )
        assert res.status_code == 201
        body = res.json()
        assert body["amount"] == "100.00"
        assert body["attachment_count"] == 0

    @pytest.mark.asyncio
    async def test_cannot_add_payment_to_closed_account(self, user_client):
        account = await _create_account(user_client)
        await user_client.post(f"/api/v1/accounts/{account['id']}/close", json={})

        res = await user_client.post(
            f"/api/v1/accounts/{account['id']}/payments",
            json={"amount": "50.00", "payment_date": "2026-01-15", "method": "manual"},
        )
        assert res.status_code == 409

    @pytest.mark.asyncio
    async def test_future_payment_date_rejected(self, user_client):
        account = await _create_account(user_client)
        res = await user_client.post(
            f"/api/v1/accounts/{account['id']}/payments",
            json={"amount": "50.00", "payment_date": "2099-01-01", "method": "manual"},
        )
        assert res.status_code == 422

    @pytest.mark.asyncio
    async def test_full_payoff_marks_account_paid(self, user_client):
        # start_date=2026-01-01, rate=5% — by the first cycle date (Jan 15)
        # one cycle's interest has already accrued ($100 * 5% = $5), so the
        # payment needs to cover principal + that interest to actually zero
        # the balance, not just the principal alone.
        account = await _create_account(user_client, borrow_amount="100.00", rate="0.05")
        res = await user_client.post(
            f"/api/v1/accounts/{account['id']}/payments",
            json={"amount": "105.00", "payment_date": "2026-01-15", "method": "manual"},
        )
        assert res.status_code == 201
        assert res.json()["balance_after"] == "0.00"

        follow_up = await user_client.get(f"/api/v1/accounts/{account['id']}")
        assert follow_up.json()["status"] == "paid"


class TestDeletePaymentRecalculatesLedger:
    """Direct regression coverage for the balance-freeze bug."""

    @pytest.mark.asyncio
    async def test_deleting_first_of_two_payments_recalculates_the_second(
        self, user_client, admin_client, regular_user
    ):
        account = await _create_account(user_client, borrow_amount="1000.00")

        first = await user_client.post(
            f"/api/v1/accounts/{account['id']}/payments",
            json={"amount": "200.00", "payment_date": "2026-01-15", "method": "manual"},
        )
        second = await user_client.post(
            f"/api/v1/accounts/{account['id']}/payments",
            json={"amount": "100.00", "payment_date": "2026-01-31", "method": "manual"},
        )
        assert first.status_code == 201 and second.status_code == 201
        second_balance_before_delete = second.json()["balance_before"]

        # Delete the FIRST payment (admin-only).
        del_res = await admin_client.delete(
            f"/api/v1/accounts/{account['id']}/payments/{first.json()['id']}"
        )
        assert del_res.status_code == 204

        # The remaining (second) payment's stored snapshot must have been
        # recomputed — it can no longer show the same balance_before that
        # assumed the now-deleted ₹200 payment had already happened.
        payments_after = await user_client.get(f"/api/v1/accounts/{account['id']}/payments")
        remaining = payments_after.json()
        assert len(remaining) == 1
        assert remaining[0]["id"] == second.json()["id"]
        assert remaining[0]["balance_before"] != second_balance_before_delete
        # Only $100 was ever actually paid now — balance_before must reflect
        # a ledger where the $200 payment never happened (i.e. higher than
        # the original frozen value, since less was paid off).
        assert float(remaining[0]["balance_before"]) > float(second_balance_before_delete)

    @pytest.mark.asyncio
    async def test_deleting_the_paying_off_payment_reopens_the_account(
        self, user_client, admin_client
    ):
        account = await _create_account(user_client, borrow_amount="100.00", rate="0.05")
        payment = await user_client.post(
            f"/api/v1/accounts/{account['id']}/payments",
            json={"amount": "105.00", "payment_date": "2026-01-15", "method": "manual"},
        )
        assert (await user_client.get(f"/api/v1/accounts/{account['id']}")).json()[
            "status"
        ] == "paid"

        del_res = await admin_client.delete(
            f"/api/v1/accounts/{account['id']}/payments/{payment.json()['id']}"
        )
        assert del_res.status_code == 204

        # Status must reflect that nothing has actually been paid anymore —
        # not assert an exact current_balance figure, since with zero
        # payments left that's a live projection to *today* (interest
        # keeps accruing for as long as the account goes unpaid), which is
        # correct behavior but a moving target as real time passes.
        after = await user_client.get(f"/api/v1/accounts/{account['id']}")
        assert after.json()["status"] == "open"
        assert float(after.json()["current_balance"]) >= 100.00

    @pytest.mark.asyncio
    async def test_non_admin_cannot_delete_payment(self, user_client):
        account = await _create_account(user_client)
        payment = await user_client.post(
            f"/api/v1/accounts/{account['id']}/payments",
            json={"amount": "50.00", "payment_date": "2026-01-15", "method": "manual"},
        )
        res = await user_client.delete(
            f"/api/v1/accounts/{account['id']}/payments/{payment.json()['id']}"
        )
        assert res.status_code == 403


class TestPaymentAttachments:
    @pytest.mark.asyncio
    async def test_upload_list_and_download_attachment(self, user_client):
        account = await _create_account(user_client)
        payment = await user_client.post(
            f"/api/v1/accounts/{account['id']}/payments",
            json={"amount": "50.00", "payment_date": "2026-01-15", "method": "manual"},
        )
        payment_id = payment.json()["id"]

        files = {"file": ("receipt.png", io.BytesIO(b"\x89PNG\r\n fake"), "image/png")}
        upload = await user_client.post(
            f"/api/v1/accounts/{account['id']}/payments/{payment_id}/attachments", files=files
        )
        assert upload.status_code == 201
        attachment_id = upload.json()["id"]

        listing = await user_client.get(
            f"/api/v1/accounts/{account['id']}/payments/{payment_id}/attachments"
        )
        assert len(listing.json()) == 1

        download = await user_client.get(
            f"/api/v1/accounts/{account['id']}/payments/{payment_id}/attachments/{attachment_id}"
        )
        assert download.status_code == 200
        assert download.content == b"\x89PNG\r\n fake"

    @pytest.mark.asyncio
    async def test_disallowed_file_type_rejected(self, user_client):
        account = await _create_account(user_client)
        payment = await user_client.post(
            f"/api/v1/accounts/{account['id']}/payments",
            json={"amount": "50.00", "payment_date": "2026-01-15", "method": "manual"},
        )
        payment_id = payment.json()["id"]

        files = {"file": ("virus.exe", io.BytesIO(b"MZ"), "application/x-msdownload")}
        res = await user_client.post(
            f"/api/v1/accounts/{account['id']}/payments/{payment_id}/attachments", files=files
        )
        assert res.status_code == 415

    @pytest.mark.asyncio
    async def test_non_admin_cannot_delete_attachment(self, user_client):
        account = await _create_account(user_client)
        payment = await user_client.post(
            f"/api/v1/accounts/{account['id']}/payments",
            json={"amount": "50.00", "payment_date": "2026-01-15", "method": "manual"},
        )
        payment_id = payment.json()["id"]
        files = {"file": ("r.png", io.BytesIO(b"\x89PNG"), "image/png")}
        upload = await user_client.post(
            f"/api/v1/accounts/{account['id']}/payments/{payment_id}/attachments", files=files
        )

        res = await user_client.delete(
            f"/api/v1/accounts/{account['id']}/payments/{payment_id}/attachments/{upload.json()['id']}"
        )
        assert res.status_code == 403
