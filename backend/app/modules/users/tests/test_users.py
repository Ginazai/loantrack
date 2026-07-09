"""Unit tests — user schema validation."""
import pytest
from pydantic import ValidationError

from app.modules.users.schemas import UserCreate


class TestUserCreate:
    def test_valid_user(self):
        u = UserCreate(
            email="alice@example.com",
            password="SecurePass1!",
            full_name="Alice Smith",
        )
        assert u.role == "user"  # default

    def test_invalid_email_rejected(self):
        with pytest.raises(ValidationError):
            UserCreate(email="not-email", password="pass12345", full_name="Bob")

    def test_short_password_rejected(self):
        with pytest.raises(ValidationError):
            UserCreate(email="a@b.com", password="short", full_name="Bob")

    def test_empty_name_rejected(self):
        with pytest.raises(ValidationError):
            UserCreate(email="a@b.com", password="longpassword", full_name="")

    def test_admin_role_accepted(self):
        u = UserCreate(
            email="admin@example.com",
            password="adminpass123",
            full_name="Admin",
            role="admin",
        )
        assert u.role == "admin"

    def test_invalid_role_rejected(self):
        with pytest.raises(ValidationError):
            UserCreate(
                email="a@b.com", password="pass12345",
                full_name="Bob", role="superuser",
            )
