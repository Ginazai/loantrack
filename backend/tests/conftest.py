"""Shared pytest fixtures."""
import pytest


@pytest.fixture
def sample_payment_history():
    """Reusable payment tuple list for ledger tests."""
    from datetime import date
    return [
        (date(2026, 6, 15), 100.0),
        (date(2026, 6, 30), 150.0),
        (date(2026, 7, 15), 200.0),
    ]
