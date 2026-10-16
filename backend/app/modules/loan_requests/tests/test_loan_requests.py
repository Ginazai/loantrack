"""
Unit tests — loan request schema validation.

Borrowers submit account_name/borrow_amount/reason only — rate and payment
cycle are lender terms set by the admin at approval time (LoanRequestReview),
not something the borrower chooses. See the router's review_request for the
"rate/cycle required when approving" rule, since that's conditional on
`status` and therefore not expressible as a pure schema constraint — that
behavior is covered in test_loan_requests_api.py instead.
"""

from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.modules.loan_requests.schemas import LoanRequestCreate, LoanRequestReview


class TestLoanRequestCreate:
    def test_valid_request(self):
        req = LoanRequestCreate(account_name="Home Reno", borrow_amount=Decimal("5000.00"))
        assert req.account_name == "Home Reno"
        assert req.borrow_amount == Decimal("5000.00")

    def test_rate_and_cycle_are_not_fields(self):
        """The borrower cannot set these even if they try — Pydantic
        silently drops unknown kwargs by default, so this also confirms
        they don't accidentally end up readable somewhere."""
        req = LoanRequestCreate(account_name="Test", borrow_amount=Decimal("1000"))
        assert not hasattr(req, "rate")
        assert not hasattr(req, "cycle")

    def test_zero_amount_rejected(self):
        with pytest.raises(ValidationError):
            LoanRequestCreate(account_name="Test", borrow_amount=Decimal("0"))

    def test_negative_amount_rejected(self):
        with pytest.raises(ValidationError):
            LoanRequestCreate(account_name="Test", borrow_amount=Decimal("-100"))

    def test_reason_is_optional(self):
        req = LoanRequestCreate(account_name="Test", borrow_amount=Decimal("500"))
        assert req.reason is None

    def test_reason_over_1000_chars_rejected(self):
        with pytest.raises(ValidationError):
            LoanRequestCreate(account_name="Test", borrow_amount=Decimal("500"), reason="x" * 1001)

    def test_blank_account_name_rejected(self):
        with pytest.raises(ValidationError):
            LoanRequestCreate(account_name="", borrow_amount=Decimal("500"))


class TestLoanRequestReview:
    def test_approval_with_rate_and_cycle(self):
        review = LoanRequestReview(status="approved", rate=Decimal("0.05"), cycle=15)
        assert review.rate == Decimal("0.05")
        assert review.cycle == 15

    def test_rejection_needs_no_rate_or_cycle(self):
        review = LoanRequestReview(status="rejected", rejection_reason="Insufficient info")
        assert review.rate is None
        assert review.cycle is None

    def test_invalid_cycle_rejected(self):
        with pytest.raises(ValidationError):
            LoanRequestReview(status="approved", rate=Decimal("0.05"), cycle=20)

    def test_rate_above_one_rejected(self):
        with pytest.raises(ValidationError):
            LoanRequestReview(status="approved", rate=Decimal("1.50"), cycle=15)
