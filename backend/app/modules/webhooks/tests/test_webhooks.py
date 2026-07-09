"""Unit tests — webhook config schema validation."""
from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.modules.webhooks.schemas import WebhookConfigCreate


class TestWebhookConfigCreate:
    def test_valid_config(self):
        cfg = WebhookConfigCreate(
            target_url="https://eodh8xkd7f2op7r.m.pipedream.net",
            events=["account.created", "payment.added"],
        )
        assert len(cfg.events) == 2

    def test_empty_events_rejected(self):
        with pytest.raises(ValidationError):
            WebhookConfigCreate(
                target_url="https://example.com/hook",
                events=[],
            )

    def test_invalid_url_rejected(self):
        with pytest.raises(ValidationError):
            WebhookConfigCreate(
                target_url="not-a-url",
                events=["payment.added"],
            )

    def test_invalid_event_type_rejected(self):
        with pytest.raises(ValidationError):
            WebhookConfigCreate(
                target_url="https://example.com/hook",
                events=["payment.added", "invalid.event"],
            )
