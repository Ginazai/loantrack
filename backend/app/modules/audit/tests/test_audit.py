"""Tests — audit module (structural checks only; DB tests run in CI)."""
import pytest
from app.modules.audit.models import AuditLog


class TestAuditLogModel:
    def test_model_tablename(self):
        assert AuditLog.__tablename__ == "audit_logs"

    def test_required_columns_exist(self):
        cols = {c.key for c in AuditLog.__table__.columns}
        for required in ("id", "user_id", "resource", "action", "created_at"):
            assert required in cols, f"Missing column: {required}"
