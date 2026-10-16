"""Integration tests for /admin/imports — preview -> commit flow."""

import io

import pytest

LEGACY_CSV = (
    "Referencia,Fecha,Descripcion,Debito,Credito\n"
    '1,15/01/2026,"Prestamo de $1000 otorgado",1000,\n'
    '1,31/01/2026,"Intereses acomulados en la cuenta",50,\n'
    '1,31/01/2026,"pago por $200 realizado",,200\n'
)


class TestImportPreview:
    @pytest.mark.asyncio
    async def test_preview_legacy_csv(self, admin_client):
        files = {"file": ("ledger.csv", io.BytesIO(LEGACY_CSV.encode()), "text/csv")}
        res = await admin_client.post("/api/v1/admin/imports/preview", files=files)
        assert res.status_code == 201 or res.status_code == 200
        body = res.json()
        assert body["format"] == "legacy_ledger_csv"
        assert len(body["accounts"]) == 1
        assert body["accounts"][0]["source_ref"] == "1"
        assert body["total_payments_parsed"] == 1
        assert body["error_count"] == 0

    @pytest.mark.asyncio
    async def test_non_admin_cannot_preview(self, user_client):
        files = {"file": ("ledger.csv", io.BytesIO(LEGACY_CSV.encode()), "text/csv")}
        res = await user_client.post("/api/v1/admin/imports/preview", files=files)
        assert res.status_code == 403

    @pytest.mark.asyncio
    async def test_unrecognized_format_returns_400(self, admin_client):
        files = {"file": ("random.csv", io.BytesIO(b"foo,bar\n1,2\n"), "text/csv")}
        res = await admin_client.post("/api/v1/admin/imports/preview", files=files)
        assert res.status_code == 400

    @pytest.mark.asyncio
    async def test_empty_file_returns_400(self, admin_client):
        files = {"file": ("empty.csv", io.BytesIO(b""), "text/csv")}
        res = await admin_client.post("/api/v1/admin/imports/preview", files=files)
        assert res.status_code == 400


class TestImportCommit:
    @pytest.mark.asyncio
    async def test_commit_creates_account_and_payment(self, admin_client, admin_user):
        files = {"file": ("ledger.csv", io.BytesIO(LEGACY_CSV.encode()), "text/csv")}
        preview = await admin_client.post("/api/v1/admin/imports/preview", files=files)
        batch_id = preview.json()["batch_id"]

        commit = await admin_client.post(
            f"/api/v1/admin/imports/{batch_id}/commit",
            json={
                "mappings": [
                    {
                        "source_ref": "1",
                        "action": "create",
                        "account_name": "Imported Loan",
                        "borrower_name": "Imported Borrower",
                        "linked_user_id": str(admin_user.id),
                        "rate": 0.05,
                    }
                ]
            },
        )
        assert commit.status_code == 200
        body = commit.json()
        assert body["batch"]["status"] == "committed"
        assert body["batch"]["summary"]["accounts_created"] == 1
        assert body["batch"]["summary"]["payments_created"] == 1

        # Never fires payment.added — confirmed via no error, and via the
        # account actually existing with the imported payment attached.
        accounts = await admin_client.get("/api/v1/accounts")
        imported = next(a for a in accounts.json() if a["account_name"] == "Imported Loan")
        payments = await admin_client.get(f"/api/v1/accounts/{imported['id']}/payments")
        assert len(payments.json()) == 1
        assert payments.json()[0]["method"] == "import"

    @pytest.mark.asyncio
    async def test_commit_skip_action_creates_nothing(self, admin_client):
        files = {"file": ("ledger.csv", io.BytesIO(LEGACY_CSV.encode()), "text/csv")}
        preview = await admin_client.post("/api/v1/admin/imports/preview", files=files)
        batch_id = preview.json()["batch_id"]

        commit = await admin_client.post(
            f"/api/v1/admin/imports/{batch_id}/commit",
            json={"mappings": [{"source_ref": "1", "action": "skip"}]},
        )
        assert commit.status_code == 200
        assert commit.json()["batch"]["summary"]["accounts_skipped"] == 1
        assert commit.json()["batch"]["summary"]["payments_errored"] == 1

    @pytest.mark.asyncio
    async def test_commit_existing_account_without_required_fields_errors_cleanly(
        self, admin_client
    ):
        """action=create with no linked_user_id must fail gracefully (per
        row), not 500 — the source file never carries an owning user."""
        files = {"file": ("ledger.csv", io.BytesIO(LEGACY_CSV.encode()), "text/csv")}
        preview = await admin_client.post("/api/v1/admin/imports/preview", files=files)
        batch_id = preview.json()["batch_id"]

        commit = await admin_client.post(
            f"/api/v1/admin/imports/{batch_id}/commit",
            json={"mappings": [{"source_ref": "1", "action": "create"}]},
        )
        assert commit.status_code == 200
        rows = commit.json()["rows"]
        assert any(r["result"] == "error" for r in rows)

    @pytest.mark.asyncio
    async def test_double_commit_is_rejected(self, admin_client, admin_user):
        files = {"file": ("ledger.csv", io.BytesIO(LEGACY_CSV.encode()), "text/csv")}
        preview = await admin_client.post("/api/v1/admin/imports/preview", files=files)
        batch_id = preview.json()["batch_id"]
        mapping = {
            "mappings": [
                {
                    "source_ref": "1",
                    "action": "create",
                    "linked_user_id": str(admin_user.id),
                    "rate": 0.05,
                }
            ]
        }
        first = await admin_client.post(f"/api/v1/admin/imports/{batch_id}/commit", json=mapping)
        assert first.status_code == 200

        second = await admin_client.post(f"/api/v1/admin/imports/{batch_id}/commit", json=mapping)
        assert second.status_code == 409

    @pytest.mark.asyncio
    async def test_list_and_get_batch(self, admin_client):
        files = {"file": ("ledger.csv", io.BytesIO(LEGACY_CSV.encode()), "text/csv")}
        preview = await admin_client.post("/api/v1/admin/imports/preview", files=files)
        batch_id = preview.json()["batch_id"]

        listing = await admin_client.get("/api/v1/admin/imports")
        assert any(b["id"] == batch_id for b in listing.json())

        single = await admin_client.get(f"/api/v1/admin/imports/{batch_id}")
        assert single.json()["id"] == batch_id
