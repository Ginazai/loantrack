"""Unit tests — loan request schema validation."""
from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.modules.loan_requests.schemas import LoanRequestCreate


class TestLoanRequestCreate:
    def test_valid_request(self):
        req = LoanRequestCreate(
            account_name="Home Reno",
            borrow_amount=Decimal("5000.00"),
            rate=Decimal("0.0500"),
            cycle=15,
        )
        assert req.account_name == "Home Reno"
        assert req.cycle == 15

    def test_invalid_cycle_rejected(self):
        with pytest.raises(ValidationError):
            LoanRequestCreate(
                account_name="Test",
                borrow_amount=Decimal("1000"),
                rate=Decimal("0.05"),
                cycle=20,  # only 15 or 30 are valid
            )

    def test_zero_amount_rejected(self):
        with pytest.raises(ValidationError):
            LoanRequestCreate(
                account_name="Test",
                borrow_amount=Decimal("0"),
                rate=Decimal("0.05"),
                cycle=15,
            )

    def test_rate_above_one_rejected(self):
        with pytest.raises(ValidationError):
            LoanRequestCreate(
                account_name="Test",
                borrow_amount=Decimal("1000"),
                rate=Decimal("1.50"),  # > 1
                cycle=15,
            )

    def test_reason_is_optional(self):
        req = LoanRequestCreate(
            account_name="Test",
            borrow_amount=Decimal("500"),
            rate=Decimal("0.05"),
            cycle=30,
        )
        assert req.reason is None

    def test_reason_truncated_at_1000_chars(self):
        with pytest.raises(ValidationError):
            LoanRequestCreate(
                account_name="Test",
                borrow_amount=Decimal("500"),
                rate=Decimal("0.05"),
                cycle=15,
                reason="x" * 1001,
            )
