from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.repository import BaseRepository
from app.modules.audit.models import AuditLog


class AuditService:
    """Thin wrapper for writing audit trail entries."""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.repo = BaseRepository(AuditLog, db)

    async def log(
        self,
        user_id: UUID | None,
        entity_type: str,
        entity_id: str,
        action: str,
        before: dict | None = None,
        after: dict | None = None,
        ip: str | None = None,
    ) -> AuditLog:
        entry = AuditLog(
            user_id=user_id,
            entity_type=entity_type,
            entity_id=entity_id,
            action=action,
            before_state=before,
            after_state=after,
            ip_address=ip,
        )
        return await self.repo.create(entry)
