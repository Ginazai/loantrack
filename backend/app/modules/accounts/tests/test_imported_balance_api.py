"""An imported account's balance comes from its recorded ledger, everywhere.

Imported history carries the interest that was actually charged back then (ADR-004),
so it cannot be reproduced by applying the account's rate. These tests use rate 0 on
purpose: replaying from the disbursement gives 100 - 25 = 75, while the recorded
ledger says 80 (5 of interest was charged). Rate 0 also keeps the expected numbers
independent of today's date.
"""

import io

import pytest

ONE_PAYMENT_CSV = (
    "Referencia,Fecha,Descripcion,Debito,Credito\n"
    '30,15/04/2025,"Prestamo de $100 otorgado",100,\n'
    '30,30/04/2025,"Intereses acomulados en la cuenta",5,\n'
    '30,30/04/2025,"pago por $25 realizado",,25\n'
)

TWO_PAYMENTS_CSV = ONE_PAYMENT_CSV + (
    '30,15/05/2025,"Intereses acomulados en la cuenta",4,\n'
    '30,15/05/2025,"pago por $20 realizado",,20\n'
)


async def _import(admin_client, admin_user, csv: str) -> str:
    files = {"file": ("ledger.csv", io.BytesIO(csv.encode()), "text/csv")}
    preview = await admin_client.post("/api/v1/admin/imports/preview", files=files)
    commit = await admin_client.post(
        f"/api/v1/admin/imports/{preview.json()['batch_id']}/commit",
        json={
            "mappings": [
                {
                    "source_ref": "30",
                    "action": "create",
                    "account_name": "Imported",
                    "linked_user_id": str(admin_user.id),
                    "rate": 0,
                }
            ]
        },
    )
    assert commit.status_code == 200, commit.text
    accounts = (await admin_client.get("/api/v1/accounts")).json()
    return next(a["id"] for a in accounts if a["account_name"] == "Imported")


async def _account(admin_client, account_id):
    return (await admin_client.get(f"/api/v1/accounts/{account_id}")).json()


async def _payments(admin_client, account_id):
    return (await admin_client.get(f"/api/v1/accounts/{account_id}/payments")).json()


class TestListDetailAndLedgerAgree:
    @pytest.mark.asyncio
    async def test_active_imported_account_shows_its_recorded_balance(
        self, admin_client, admin_user
    ):
        aid = await _import(admin_client, admin_user, ONE_PAYMENT_CSV)
        listed = next(
            a for a in (await admin_client.get("/api/v1/accounts")).json() if a["id"] == aid
        )
        detail = await _account(admin_client, aid)
        ledger = (await _payments(admin_client, aid))[-1]

        assert listed["status"] == "active"
        assert float(ledger["balance_after"]) == 80  # 100 + 5 - 25
        assert float(listed["current_balance"]) == 80
        assert float(detail["current_balance"]) == 80


class TestPaymentsAddedAfterAnImport:
    @pytest.mark.asyncio
    async def test_new_payment_builds_on_the_recorded_balance(self, admin_client, admin_user):
        aid = await _import(admin_client, admin_user, ONE_PAYMENT_CSV)
        res = await admin_client.post(
            f"/api/v1/accounts/{aid}/payments",
            json={"amount": "30.00", "payment_date": "2025-06-15", "method": "manual"},
        )
        assert res.status_code == 201, res.text
        body = res.json()
        assert float(body["balance_before"]) == 80  # not 75, the replayed figure
        assert float(body["balance_after"]) == 50
        assert float((await _account(admin_client, aid))["current_balance"]) == 50

    @pytest.mark.asyncio
    @pytest.mark.parametrize("bad_date", ["2025-04-30", "2025-04-20"])
    async def test_payment_inside_the_imported_history_is_rejected(
        self, admin_client, admin_user, bad_date
    ):
        aid = await _import(admin_client, admin_user, ONE_PAYMENT_CSV)
        res = await admin_client.post(
            f"/api/v1/accounts/{aid}/payments",
            json={"amount": "10.00", "payment_date": bad_date, "method": "manual"},
        )
        assert res.status_code == 422
        assert "2025-04-30" in res.text


class TestDeletingPaymentsKeepsImportedHistoryIntact:
    @pytest.mark.asyncio
    async def test_deleting_a_native_payment_does_not_rewrite_imported_snapshots(
        self, admin_client, admin_user
    ):
        aid = await _import(admin_client, admin_user, ONE_PAYMENT_CSV)
        added = await admin_client.post(
            f"/api/v1/accounts/{aid}/payments",
            json={"amount": "30.00", "payment_date": "2025-06-15", "method": "manual"},
        )
        pid = added.json()["id"]

        res = await admin_client.delete(f"/api/v1/accounts/{aid}/payments/{pid}")
        assert res.status_code == 204

        remaining = await _payments(admin_client, aid)
        assert len(remaining) == 1
        assert float(remaining[0]["balance_after"]) == 80  # recalc must not make it 75
        assert float((await _account(admin_client, aid))["current_balance"]) == 80

    @pytest.mark.asyncio
    async def test_deleting_an_imported_payment_rechains_the_ones_after_it(
        self, admin_client, admin_user
    ):
        aid = await _import(admin_client, admin_user, TWO_PAYMENTS_CSV)
        first, second = await _payments(admin_client, aid)
        assert float(second["balance_after"]) == 64  # 80 + 4 - 20

        res = await admin_client.delete(f"/api/v1/accounts/{aid}/payments/{first['id']}")
        assert res.status_code == 204

        (only,) = await _payments(admin_client, aid)
        # Chained from the principal with the recorded interest: 100 + 4 - 20.
        # A replay at rate 0 would say 80.
        assert float(only["balance_before"]) == 100
        assert float(only["balance_after"]) == 84
        assert float((await _account(admin_client, aid))["current_balance"]) == 84
