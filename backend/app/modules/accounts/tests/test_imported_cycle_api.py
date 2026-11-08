"""An import's interest belongs to its *nearest* cycle, and what follows must respect that.

Regression for the ledger shown as:

    Sep 11  import   410.00  +20.50  -20.50  410.00   next due Sep 15
    Sep 26  import   410.00  +20.50  -20.50  410.00   next due Sep 30   <- should be Oct 15
    Oct 15  auto     430.50  +21.53  -20.50  431.53   <- should be 410.00 / 20.50 / 410.00

The Sep 26 row already carries the Sep 30 cycle's interest, so Sep 30 must not be charged
a second time, and the next cycle still owed is Oct 15.
"""

import io
from datetime import date
from decimal import Decimal
from uuid import UUID

import pytest

from app.modules.payments.models import Payment

# 5% per cycle on 410.00 is 20.50, and each import pays exactly that, so the balance holds.
LEDGER_CSV = (
    "Referencia,Fecha,Descripcion,Debito,Credito\n"
    '30,15/08/2026,"Prestamo de $410 otorgado",410,\n'
    '30,11/09/2026,"Intereses acomulados en la cuenta",20.5,\n'
    '30,11/09/2026,"pago por $20.5 realizado",,20.5\n'
    '30,26/09/2026,"Intereses acomulados en la cuenta",20.5,\n'
    '30,26/09/2026,"pago por $20.5 realizado",,20.5\n'
)


async def _import_account(admin_client, admin_user) -> str:
    files = {"file": ("ledger.csv", io.BytesIO(LEDGER_CSV.encode()), "text/csv")}
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
                    "rate": 0.05,
                }
            ]
        },
    )
    assert commit.status_code == 200, commit.text
    accounts = (await admin_client.get("/api/v1/accounts")).json()
    return next(a["id"] for a in accounts if a["account_name"] == "Imported")


async def _payments(admin_client, aid):
    return (await admin_client.get(f"/api/v1/accounts/{aid}/payments")).json()


async def _pay_auto(admin_client, aid, amount="20.50"):
    res = await admin_client.post(
        f"/api/v1/accounts/{aid}/payments", json={"amount": amount, "method": "auto"}
    )
    assert res.status_code == 201, res.text
    return res.json()


def _snapshot(p):
    return (
        Decimal(p["balance_before"]),
        Decimal(p["interests_accrued"]),
        Decimal(p["balance_after"]),
        p["next_due_date"],
    )


class TestImportedRowsPointAtTheCycleAfterTheirNearestOne:
    @pytest.mark.asyncio
    async def test_next_due_dates(self, admin_client, admin_user):
        aid = await _import_account(admin_client, admin_user)
        sep11, sep26 = await _payments(admin_client, aid)

        # Sep 11's interest is the Sep 15 cycle's, so Sep 30 is what's left to charge.
        assert sep11["next_due_date"] == "2026-09-30"
        # Sep 26's interest is the Sep 30 cycle's, so Oct 15 is next (it used to say Sep 30).
        assert sep26["next_due_date"] == "2026-10-15"

    @pytest.mark.asyncio
    async def test_import_snapshots_are_kept_as_recorded(self, admin_client, admin_user):
        aid = await _import_account(admin_client, admin_user)
        for p in await _payments(admin_client, aid):
            assert _snapshot(p)[:3] == (Decimal("410.00"), Decimal("20.50"), Decimal("410.00"))


class TestPaymentAfterASep26Import:
    @pytest.mark.asyncio
    async def test_auto_payment_charges_oct_15_once_on_the_recorded_balance(
        self, admin_client, admin_user
    ):
        aid = await _import_account(admin_client, admin_user)

        oct15 = await _pay_auto(admin_client, aid)

        assert oct15["payment_date"] == "2026-10-15"
        # Not 430.50 / 21.53 / 431.53: Sep 30 was already charged by the Sep 26 import.
        assert _snapshot(oct15) == (
            Decimal("410.00"),
            Decimal("20.50"),
            Decimal("410.00"),
            "2026-10-30",
        )

    @pytest.mark.asyncio
    async def test_the_following_auto_payment_is_the_next_cycle(self, admin_client, admin_user):
        aid = await _import_account(admin_client, admin_user)
        await _pay_auto(admin_client, aid)

        oct30 = await _pay_auto(admin_client, aid)

        assert oct30["payment_date"] == "2026-10-30"
        assert _snapshot(oct30) == (
            Decimal("410.00"),
            Decimal("20.50"),
            Decimal("410.00"),
            "2026-11-15",
        )


class TestRecalculationHealsRowsWrittenBeforeTheFix:
    @pytest.mark.asyncio
    async def test_a_stale_snapshot_is_rederived_when_history_is_recalculated(
        self, admin_client, admin_user, db
    ):
        aid = await _import_account(admin_client, admin_user)
        oct15 = await _pay_auto(admin_client, aid)
        oct30 = await _pay_auto(admin_client, aid)

        # Put row 14 back into the state shown in the bug report, and the Sep 26 import's
        # due date back to what the importer used to store.
        stale = await db.get(Payment, UUID(oct15["id"]))
        stale.balance_before = Decimal("430.50")
        stale.interests_accrued = Decimal("21.53")
        stale.balance_after = Decimal("431.53")
        sep26 = await db.get(Payment, UUID((await _payments(admin_client, aid))[1]["id"]))
        sep26.next_due_date = date(2026, 9, 30)
        await db.flush()

        # Deleting any payment re-derives every remaining one (PaymentService.recalculate_ledger).
        res = await admin_client.delete(f"/api/v1/accounts/{aid}/payments/{oct30['id']}")
        assert res.status_code == 204

        sep11, sep26_row, oct15_row = await _payments(admin_client, aid)
        assert sep26_row["next_due_date"] == "2026-10-15"
        assert _snapshot(oct15_row) == (
            Decimal("410.00"),
            Decimal("20.50"),
            Decimal("410.00"),
            "2026-10-30",
        )


class TestRepairScript:
    @pytest.mark.asyncio
    async def test_reports_and_repairs_only_the_stale_values_and_is_idempotent(
        self, admin_client, admin_user, db
    ):
        from scripts.recalculate_ledgers import recalculate_accounts

        aid = await _import_account(admin_client, admin_user)
        oct15 = await _pay_auto(admin_client, aid)

        # An untouched account has nothing to report.
        assert await recalculate_accounts(db) == []

        # The state from the bug report: the Oct 15 row double-charged Sep 30, and the
        # Sep 26 import still points at Sep 30.
        stale = await db.get(Payment, UUID(oct15["id"]))
        stale.balance_before = Decimal("430.50")
        stale.interests_accrued = Decimal("21.53")
        stale.balance_after = Decimal("431.53")
        sep26 = await db.get(Payment, UUID((await _payments(admin_client, aid))[1]["id"]))
        sep26.next_due_date = date(2026, 9, 30)
        await db.flush()

        lines = await recalculate_accounts(db, [UUID(aid)])

        assert len(lines) == 4
        assert any(
            "(import)" in ln and "next_due_date: 2026-09-30 -> 2026-10-15" in ln for ln in lines
        )
        assert any("balance_before: 430.50 -> 410.00" in ln for ln in lines)
        assert any("interests_accrued: 21.53 -> 20.50" in ln for ln in lines)
        assert any("balance_after: 431.53 -> 410.00" in ln for ln in lines)

        _, sep26_row, oct15_row = await _payments(admin_client, aid)
        assert sep26_row["next_due_date"] == "2026-10-15"
        assert _snapshot(oct15_row) == (
            Decimal("410.00"),
            Decimal("20.50"),
            Decimal("410.00"),
            "2026-10-30",
        )
        # Running it again finds nothing left to fix.
        assert await recalculate_accounts(db, [UUID(aid)]) == []
