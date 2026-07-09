"""Unit tests — auth service (password hashing, JWT creation)."""
import pytest
from datetime import date, timedelta

from app.core.security import (
    create_access_token,
    hash_password,
    hash_token,
    verify_password,
)


class TestPasswordHashing:
    def test_hash_and_verify(self):
        raw = "SuperSecret123!"
        hashed = hash_password(raw)
        assert hashed != raw
        assert verify_password(raw, hashed)

    def test_wrong_password_fails(self):
        assert not verify_password("wrong", hash_password("correct"))

    def test_hash_is_deterministically_different(self):
        # bcrypt salts → two hashes of the same password differ
        h1 = hash_password("same")
        h2 = hash_password("same")
        assert h1 != h2

    def test_empty_password_hashes(self):
        hashed = hash_password("")
        assert verify_password("", hashed)


class TestTokenCreation:
    def test_access_token_is_string(self):
        token = create_access_token({"sub": "user-id-123"})
        assert isinstance(token, str)
        assert len(token) > 20

    def test_token_hash_is_hex_string(self):
        raw = "some-refresh-token"
        hashed = hash_token(raw)
        assert isinstance(hashed, str)
        # SHA-256 hex = 64 chars
        assert len(hashed) == 64

    def test_same_token_same_hash(self):
        raw = "consistent-token"
        assert hash_token(raw) == hash_token(raw)

    def test_different_tokens_different_hashes(self):
        assert hash_token("token-a") != hash_token("token-b")
