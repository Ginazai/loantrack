"""Integration tests for /accounts/{id}/webhooks and CycleCloseScanService."""

from datetime import date

import pytest
from sqlalchemy import select

from app.modules.webhooks.models import AccountCycleNotification, WebhookEvent
from app.modules.webhooks.service import CycleCloseScanService


async def _create_account(client, **overrides):
    payload = {
        "account_name": "Webhook Test",
        "borrow_amount": "1000.00",
        "rate": "0.05",
        "cycle": 15,
        "start_date": "2026-01-01",
    }
    payload.update(overrides)
    res = await client.post("/api/v1/accounts", json=payload)
    assert res.status_code == 201
    return res.json()


class TestWebhookConfigCRUD:
    @pytest.mark.asyncio
    async def test_create_and_list_webhook(self, user_client):
        account = await _create_account(user_client)
        create = await user_client.post(
            f"/api/v1/accounts/{account['id']}/webhooks",
            json={"target_url": "https://example.com/hook", "events": ["payment.added"]},
        )
        assert create.status_code == 201
        assert create.json()["is_active"] is True

        listing = await user_client.get(f"/api/v1/accounts/{account['id']}/webhooks")
        assert len(listing.json()) == 1

    @pytest.mark.asyncio
    async def test_invalid_event_name_rejected(self, user_client):
        account = await _create_account(user_client)
        res = await user_client.post(
            f"/api/v1/accounts/{account['id']}/webhooks",
            json={"target_url": "https://example.com/hook", "events": ["not.a.real.event"]},
        )
        assert res.status_code == 422

    @pytest.mark.asyncio
    async def test_delete_webhook(self, user_client):
        account = await _create_account(user_client)
        create = await user_client.post(
            f"/api/v1/accounts/{account['id']}/webhooks",
            json={"target_url": "https://example.com/hook", "events": ["payment.added"]},
        )
        webhook_id = create.json()["id"]

        delete = await user_client.delete(f"/api/v1/accounts/{account['id']}/webhooks/{webhook_id}")
        assert delete.status_code == 204

        listing = await user_client.get(f"/api/v1/accounts/{account['id']}/webhooks")
        assert len(listing.json()) == 0

    @pytest.mark.asyncio
    async def test_user_cannot_manage_another_users_webhooks(self, user_client, admin_client):
        account = await _create_account(admin_client)
        res = await user_client.get(f"/api/v1/accounts/{account['id']}/webhooks")
        assert res.status_code == 404


class TestCycleCloseScan:
    @pytest.mark.asyncio
    async def test_scan_fires_event_for_elapsed_cycle(self, user_client, db):
        """An account started well in the past should have cycle.closed
        events queued for every cycle date up to today, each backed by a
        pending WebhookEvent ready for the existing delivery pipeline."""
        account = await _create_account(
            user_client, start_date="2020-01-01", account_name="Dormant"
        )
        await user_client.post(
            f"/api/v1/accounts/{account['id']}/webhooks",
            json={"target_url": "https://example.com/hook", "events": ["cycle.closed"]},
        )

        svc = CycleCloseScanService(db)
        enqueued = await svc.scan(today=date(2020, 2, 1))
        assert enqueued > 0

        events = await db.execute(
            select(WebhookEvent).where(WebhookEvent.event_type == "cycle.closed")
        )
        assert len(events.scalars().all()) == enqueued

        notifications = await db.execute(select(AccountCycleNotification))
        assert len(notifications.scalars().all()) == enqueued

    @pytest.mark.asyncio
    async def test_scan_is_idempotent_across_runs(self, user_client, db):
        account = await _create_account(user_client, start_date="2020-01-01")
        await user_client.post(
            f"/api/v1/accounts/{account['id']}/webhooks",
            json={"target_url": "https://example.com/hook", "events": ["cycle.closed"]},
        )

        svc = CycleCloseScanService(db)
        first_run = await svc.scan(today=date(2020, 3, 1))
        second_run = await svc.scan(today=date(2020, 3, 1))

        assert first_run > 0
        assert second_run == 0  # nothing new to notify

    @pytest.mark.asyncio
    async def test_scan_skips_closed_accounts(self, user_client, db):
        account = await _create_account(user_client, start_date="2020-01-01")
        await user_client.post(f"/api/v1/accounts/{account['id']}/close", json={})

        svc = CycleCloseScanService(db)
        enqueued = await svc.scan(today=date(2020, 3, 1))
        assert enqueued == 0
