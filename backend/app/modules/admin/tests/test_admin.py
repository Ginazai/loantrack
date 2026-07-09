"""Tests — admin module."""
import pytest
from app.core.security import hash_password, verify_password


class TestAdminSecurity:
    def test_admin_password_roundtrip(self):
        pw = "AdminSecure99!"
        assert verify_password(pw, hash_password(pw))

    def test_non_admin_password_rejected(self):
        assert not verify_password("wrong", hash_password("AdminSecure99!"))
