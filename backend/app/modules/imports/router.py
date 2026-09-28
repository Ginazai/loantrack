from uuid import UUID

from fastapi import APIRouter, Depends, File, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import require_admin
from app.modules.imports.schemas import (
    ImportBatchOut,
    ImportCommitIn,
    ImportCommitOut,
    ImportPreviewOut,
)
from app.modules.imports.service import ImportService

router = APIRouter(prefix="/admin/imports", tags=["imports"])


@router.post("/preview", response_model=ImportPreviewOut)
async def preview_import(
    file: UploadFile = File(...),
    current_user=Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    svc = ImportService(db)
    return await svc.preview(file, current_user.id)


@router.get("", response_model=list[ImportBatchOut])
async def list_imports(
    current_user=Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    svc = ImportService(db)
    return await svc.list_batches()


@router.get("/{batch_id}", response_model=ImportBatchOut)
async def get_import(
    batch_id: UUID,
    current_user=Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    svc = ImportService(db)
    return await svc.get_batch(batch_id)


@router.post("/{batch_id}/commit", response_model=ImportCommitOut)
async def commit_import(
    batch_id: UUID,
    data: ImportCommitIn,
    current_user=Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    svc = ImportService(db)
    return await svc.commit(batch_id, data.mappings, current_user.id)
