from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import require_admin
from app.modules.webhooks.schemas import (
    WebhookConfigCreate,
    WebhookConfigCreated,
    WebhookConfigOut,
)
from app.modules.webhooks.service import WebhookConfigService

router = APIRouter(prefix="/accounts/{account_id}/webhooks", tags=["webhooks"])


@router.get("", response_model=list[WebhookConfigOut])
async def list_webhooks(
    account_id: UUID,
    current_user=Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    svc = WebhookConfigService(db)
    return await svc.list_for_account(
        account_id, current_user.id, is_admin=current_user.role == "admin"
    )


@router.post("", response_model=WebhookConfigCreated, status_code=201)
async def create_webhook(
    account_id: UUID,
    data: WebhookConfigCreate,
    current_user=Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    svc = WebhookConfigService(db)
    config = await svc.create(
        account_id, current_user.id, data, is_admin=current_user.role == "admin"
    )
    return WebhookConfigCreated.from_config(config)  # the one time the secret is shown


@router.post("/{webhook_id}/rotate-secret", response_model=WebhookConfigCreated)
async def rotate_webhook_secret(
    account_id: UUID,
    webhook_id: UUID,
    current_user=Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Issue a new signing secret (the old one stops verifying immediately)."""
    svc = WebhookConfigService(db)
    config = await svc.rotate_secret(
        account_id, webhook_id, current_user.id, is_admin=current_user.role == "admin"
    )
    return WebhookConfigCreated.from_config(config)


@router.delete("/{webhook_id}", status_code=204)
async def delete_webhook(
    account_id: UUID,
    webhook_id: UUID,
    current_user=Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    svc = WebhookConfigService(db)
    await svc.delete(webhook_id, current_user.id, is_admin=current_user.role == "admin")
