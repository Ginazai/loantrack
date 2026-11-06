"""Regression tests: a settled (paid / closed) account must not look like it
still owes anything.

Bugs covered (reported from the accounts table + dashboard):
  1. A `paid` account still carried a `next_due_date`.
  2. That stale date was in the past, so the account was flagged overdue; and
     the list `current_balance` was a projection at *today's* rate that kept
     compounding after payoff (the detail page, which reads the last payment's
     `balance_after`, correctly showed 0).

The scenario is built through the real import path, because imported ledgers
are where the projection and the recorded history disagree: the imported
interest is historical fact, not `rate` applied per cycle.
"""

import io

import pytest

# Loan of 40 on 15 Apr 2025. On 30 Apr: interest 4 and a payment of 44 -> the
# recorded ledger lands on exactly 0.00 and the account is fully paid.
PAID_OFF_CSV = (
    "Referencia,Fecha,Descripcion,Debito,Credito\n"
    '10,15/04/2025,"Prestamo de $40 otorgado",40,\n'
    '10,30/04/2025,"Intereses acomulados en la cuenta",4,\n'
    '10,30/04/2025,"pago por $44 realizado",,44\n'
)

# Same shape, but only part of it is repaid -> stays active, still owes money.
PARTIALLY_PAID_CSV = (
    "Referencia,Fecha,Descripcion,Debito,Credito\n"
    '11,15/04/2025,"Prestamo de $40 otorgado",40,\n'
    '11,30/04/2025,"Intereses acomulados en la cuenta",4,\n'
    '11,30/04/2025,"pago por $10 realizado",,10\n'
)


async def _import(admin_client, admin_user, csv: str, ref: str, name: str) -> dict:
    files = {"file": ("ledger.csv", io.BytesIO(csv.encode()), "text/csv")}
    preview = await admin_client.post("/api/v1/admin/imports/preview", files=files)
    assert preview.status_code == 200, preview.text
    commit = await admin_client.post(
        f"/api/v1/admin/imports/{preview.json()['batch_id']}/commit",
        json={
            "mappings": [
                {
                    "source_ref": ref,
                    "action": "create",
                    "account_name": name,
                    "linked_user_id": str(admin_user.id),
                    "rate": 0.10,
                }
            ]
        },
    )
    assert commit.status_code == 200, commit.text
    accounts = (await admin_client.get("/api/v1/accounts")).json()
    return next(a for a in accounts if a["account_name"] == name)


class TestPaidAccount:
    @pytest.mark.asyncio
    async def test_paid_account_has_no_next_due_date(self, admin_client, admin_user):
        acct = await _import(admin_client, admin_user, PAID_OFF_CSV, "10", "Paid loan")
        assert acct["status"] == "paid"
        assert acct["next_due_date"] is None

    @pytest.mark.asyncio
    async def test_paid_account_balance_matches_the_ledger_not_a_projection(
        self, admin_client, admin_user
    ):
        acct = await _import(admin_client, admin_user, PAID_OFF_CSV, "10", "Paid loan")
        payments = (await admin_client.get(f"/api/v1/accounts/{acct['id']}/payments")).json()
        # What the detail page shows ...
        assert float(payments[-1]["balance_after"]) == 0
        # ... must be what the list (and dashboard) show.
        assert float(acct["current_balance"]) == 0

    @pytest.mark.asyncio
    async def test_detail_endpoint_agrees_with_list(self, admin_client, admin_user):
        acct = await _import(admin_client, admin_user, PAID_OFF_CSV, "10", "Paid loan")
        detail = (await admin_client.get(f"/api/v1/accounts/{acct['id']}")).json()
        assert detail["next_due_date"] is None
        assert float(detail["current_balance"]) == 0


class TestClosedAccount:
    @pytest.mark.asyncio
    async def test_closed_account_has_no_next_due_date(self, admin_client, admin_user):
        acct = await _import(admin_client, admin_user, PARTIALLY_PAID_CSV, "11", "Closed loan")
        assert acct["next_due_date"] is not None  # sanity: active loans do have one
        closed = await admin_client.post(
            f"/api/v1/accounts/{acct['id']}/close", json={"close_reason": "written off"}
        )
        assert closed.status_code == 200, closed.text
        assert closed.json()["next_due_date"] is None


class TestActiveAccountUnchanged:
    @pytest.mark.asyncio
    async def test_active_account_still_reports_next_due_date(self, admin_client, admin_user):
        acct = await _import(admin_client, admin_user, PARTIALLY_PAID_CSV, "11", "Active loan")
        assert acct["status"] == "active"
        assert acct["next_due_date"] == "2025-05-15"
