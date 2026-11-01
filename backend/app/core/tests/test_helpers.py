"""Unit tests — client IP resolution, header/filename safety, CSV safety, upload cap."""

import io

import pytest
from fastapi import HTTPException, UploadFile
from starlette.requests import Request

from app.core.client_ip import client_ip
from app.core.config import get_settings
from app.core.csv_safety import restore_cell, sanitize_cell
from app.core.http import content_disposition, sanitize_filename
from app.core.uploads import read_upload_capped


def _req(peer, xff=None):
    headers = [(b"x-forwarded-for", v.encode()) for v in ([xff] if xff else [])]
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/",
        "headers": headers,
        "client": (peer, 1234) if peer else None,
    }
    return Request(scope)


@pytest.fixture
def trust_nginx(monkeypatch):
    monkeypatch.setattr(get_settings(), "TRUSTED_PROXIES", ["172.28.0.0/16", "::1"])


class TestClientIp:
    def test_no_trusted_proxies_means_the_peer_and_headers_are_ignored(self, monkeypatch):
        monkeypatch.setattr(get_settings(), "TRUSTED_PROXIES", [])
        assert client_ip(_req("172.28.0.5", "9.9.9.9")) == "172.28.0.5"

    def test_trusted_proxy_exposes_the_real_client(self, trust_nginx):
        assert client_ip(_req("172.28.0.5", "203.0.113.7")) == "203.0.113.7"

    def test_untrusted_peer_cannot_claim_an_address(self, trust_nginx):
        # Someone hitting the backend directly, bypassing nginx.
        assert client_ip(_req("198.51.100.9", "1.2.3.4")) == "198.51.100.9"

    def test_client_supplied_leading_entries_are_ignored(self, trust_nginx):
        # Attacker sent "X-Forwarded-For: 1.1.1.1"; nginx appended the real address.
        assert client_ip(_req("172.28.0.5", "1.1.1.1, 203.0.113.7")) == "203.0.113.7"

    def test_chain_through_two_trusted_hops(self, trust_nginx):
        assert client_ip(_req("172.28.0.5", "203.0.113.7, 172.28.0.9")) == "203.0.113.7"

    def test_trusted_peer_without_header_falls_back_to_peer(self, trust_nginx):
        assert client_ip(_req("172.28.0.5")) == "172.28.0.5"

    def test_garbage_in_header_is_not_believed(self, trust_nginx):
        assert client_ip(_req("172.28.0.5", "not-an-ip")) == "172.28.0.5"
        assert client_ip(_req("172.28.0.5", "1.1.1.1, <script>")) == "172.28.0.5"

    def test_ipv6_client(self, trust_nginx):
        assert client_ip(_req("::1", "2001:db8::7")) == "2001:db8::7"

    def test_no_peer(self, trust_nginx):
        assert client_ip(_req(None)) is None

    def test_catch_all_trust_is_refused_at_startup(self):
        from app.core.config import Settings

        with pytest.raises(ValueError, match="catch-all"):
            Settings(TRUSTED_PROXIES=["0.0.0.0/0"], SECRET_KEY="x" * 40, DEBUG=True)
        with pytest.raises(ValueError, match="not an IP"):
            Settings(TRUSTED_PROXIES=["nginx"], SECRET_KEY="x" * 40, DEBUG=True)


class TestFilenames:
    @pytest.mark.parametrize(
        "raw,expected",
        [
            ("receipt.png", "receipt.png"),
            ("../../etc/passwd", "passwd"),
            ("C:\\Users\\bob\\scan.pdf", "scan.pdf"),
            ("a\r\nSet-Cookie: x=1.png", "aSet-Cookie: x=1.png"),
            ("evil\u202egpj.exe", "evilgpj.exe"),  # bidi override removed
            ("   ..hidden", "hidden"),
            ("", "download"),
            (None, "download"),
            ("...", "download"),
        ],
    )
    def test_sanitize(self, raw, expected):
        assert sanitize_filename(raw) == expected

    def test_long_names_keep_their_extension(self):
        out = sanitize_filename("a" * 500 + ".pdf", max_len=50)
        assert len(out) == 50 and out.endswith(".pdf")

    def test_plain_name(self):
        assert content_disposition("receipt.png") == 'attachment; filename="receipt.png"'

    @pytest.mark.parametrize(
        "raw",
        ['x".png', "x;y=z.png", 'x"; filename="evil.exe', "a\r\nX-Evil: 1", "a\\b", "ñandú ✓.png"],
    )
    def test_header_cannot_be_broken_out_of(self, raw):
        h = content_disposition(raw)
        assert "\r" not in h and "\n" not in h
        h.encode("latin-1")  # a non-latin-1 header would crash the response (a 500)
        # The quoted fallback contains no quote/semicolon/backslash that could end it early.
        quoted = h.split('filename="', 1)[1].split('"', 1)[0]
        assert not set(quoted) & set('";\\')
        assert h.count('filename="') == 1

    def test_unicode_name_travels_percent_encoded(self):
        h = content_disposition("ñandú.png")
        assert "filename*=UTF-8''%C3%B1and%C3%BA.png" in h

    def test_inline_vs_attachment(self):
        assert content_disposition("a.pdf", "inline").startswith("inline;")
        with pytest.raises(ValueError):
            content_disposition("a.pdf", "evil")


class TestCsvSafety:
    @pytest.mark.parametrize("v", ["=1+1", "+1", "-1", "@SUM(A1)", "\tx", "\rx", '=HYPERLINK("u")'])
    def test_formula_text_is_neutralised(self, v):
        assert sanitize_cell(v) == "'" + v

    @pytest.mark.parametrize("v", ["Normal name", "O'Brien", "", "a=b", " =lead-space"])
    def test_ordinary_text_untouched(self, v):
        assert sanitize_cell(v) == v

    def test_non_strings_untouched(self):
        from decimal import Decimal

        assert sanitize_cell(Decimal("-5.00")) == Decimal("-5.00")
        assert sanitize_cell(-3) == -3 and sanitize_cell(None) is None

    @pytest.mark.parametrize("v", ["=1+1", "-x", "@a", "+9", "plain", "O'Brien", "'quoted", "'"])
    def test_restore_inverts_sanitize(self, v):
        assert restore_cell(sanitize_cell(v)) == v


class TestReadUploadCapped:
    async def test_under_limit(self):
        f = UploadFile(io.BytesIO(b"x" * 100), filename="a")
        assert await read_upload_capped(f, 100) == b"x" * 100

    async def test_over_limit_stops_early(self):
        class Spy(io.BytesIO):
            total = 0

            def read(self, n=-1):
                chunk = super().read(n)
                Spy.total += len(chunk)
                return chunk

        f = UploadFile(Spy(b"x" * 5_000_000), filename="a")
        f.size = None  # parser did not know the size
        with pytest.raises(HTTPException) as e:
            await read_upload_capped(f, 100_000)
        assert e.value.status_code == 413
        assert Spy.total < 300_000  # nowhere near the 5 MB offered

    async def test_declared_size_rejected_without_reading(self):
        f = UploadFile(io.BytesIO(b"x"), filename="a", size=10**9)
        with pytest.raises(HTTPException) as e:
            await read_upload_capped(f, 10)
        assert e.value.status_code == 413
