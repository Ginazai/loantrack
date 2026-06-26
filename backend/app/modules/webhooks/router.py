from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.modules.webhooks.schemas import WebhookConfigCreate, WebhookConfigOut
from app.modules.webhooks.service import WebhookConfigService

router = APIRouter(prefix="/accounts/{account_id}/webhooks", tags=["webhooks"])


@router.get("", response_model=list[WebhookConfigOut])
async def list_webhooks(
    account_id: UUID,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    svc = WebhookConfigService(db)
    return await svc.list_for_account(account_id, current_user.id)


@router.post("", response_model=WebhookConfigOut, status_code=201)
async def create_webhook(
    account_id: UUID,
    data: WebhookConfigCreate,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    svc = WebhookConfigService(db)
    return await svc.create(account_id, current_user.id, data)


@router.delete("/{webhook_id}", status_code=204)
async def delete_webhook(
    account_id: UUID,
    webhook_id: UUID,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    svc = WebhookConfigService(db)
    await svc.delete(webhook_id, current_user.id)
