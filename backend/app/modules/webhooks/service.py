from datetime import datetime, timezone
from uuid import UUID

import httpx
from fastapi import HTTPException, status
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.repository import BaseRepository
from app.core.security import generate_webhook_secret, sign_webhook_payload
from app.modules.accounts.models import LoanAccount
from app.modules.webhooks.models import WebhookConfig, WebhookEvent
from app.modules.webhooks.schemas import WebhookConfigCreate

settings = get_settings()


class WebhookConfigService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.repo = BaseRepository(WebhookConfig, db)

    async def create(self, account_id: UUID, user_id: UUID, data: WebhookConfigCreate, is_admin: bool = False) -> WebhookConfig:
        account = await self._get_account_or_404(account_id, user_id, is_admin)
        config = WebhookConfig(
            account_id=account.id,
            target_url=str(data.target_url),
            secret_hash=generate_webhook_secret(),
            events=data.events,
        )
        return await self.repo.create(config)

    async def list_for_account(self, account_id: UUID, user_id: UUID, is_admin: bool = False) -> list[WebhookConfig]:
        await self._get_account_or_404(account_id, user_id, is_admin)
        result = await self.db.execute(
            select(WebhookConfig).where(WebhookConfig.account_id == account_id)
        )
        return list(result.scalars().all())

    async def delete(self, webhook_id: UUID, user_id: UUID, is_admin: bool = False) -> None:
        config = await self.repo.get_by_id(webhook_id)
        if not config:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Webhook not found")
        await self._get_account_or_404(config.account_id, user_id, is_admin)
        await self.repo.delete(config)

    async def _get_account_or_404(self, account_id: UUID, user_id: UUID, is_admin: bool = False) -> LoanAccount:
        if is_admin:
            result = await self.db.execute(
                select(LoanAccount).where(LoanAccount.id == account_id)
            )
        else:
            result = await self.db.execute(
                select(LoanAccount).where(
                    and_(LoanAccount.id == account_id, LoanAccount.user_id == user_id)
                )
            )
        account = result.scalar_one_or_none()
        if not account:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Account not found")
        return account


class WebhookDeliveryService:
    """Background retry-loop delivery for pending webhook events."""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def deliver_pending(self) -> None:
        result = await self.db.execute(
            select(WebhookEvent).where(
                and_(
                    WebhookEvent.status == "pending",
                    WebhookEvent.attempt_count < settings.WEBHOOK_MAX_RETRIES,
                )
            )
        )
        events = list(result.scalars().all())
        async with httpx.AsyncClient(timeout=settings.WEBHOOK_TIMEOUT_SECONDS) as client:
            for event in events:
                await self._deliver(client, event)

    async def _deliver(self, client: httpx.AsyncClient, event: WebhookEvent) -> None:
        result = await self.db.execute(
            select(WebhookConfig).where(WebhookConfig.id == event.webhook_id)
        )
        config = result.scalar_one_or_none()
        if not config:
            event.status = "failed"
            return

        signature = sign_webhook_payload(event.payload, config.secret_hash)
        event.attempt_count += 1
        event.last_attempt_at = datetime.now(timezone.utc)

        try:
            resp = await client.post(
                str(config.target_url),
                json=event.payload,
                headers={
                    "X-Webhook-Signature": signature,
                    "X-Webhook-Event": event.event_type,
                    "Content-Type": "application/json",
                },
            )
            event.status = "delivered" if resp.is_success else "pending"
        except Exception:
            event.status = (
                "failed" if event.attempt_count >= settings.WEBHOOK_MAX_RETRIES else "pending"
            )
        await self.db.flush()
