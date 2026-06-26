"""
Importing this module registers every ORM model with SQLAlchemy's
declarative `Base`. Used by `app.main` (so the app's metadata is complete)
and `alembic/env.py` (so autogenerate sees every table).

Each domain module owns its own models.py; nothing else needs to know
about them individually.
"""

from app.modules.accounts.models import LoanAccount  # noqa: F401
from app.modules.audit.models import AuditLog  # noqa: F401
from app.modules.payments.models import Payment  # noqa: F401
from app.modules.users.models import RefreshToken, User  # noqa: F401
from app.modules.webhooks.models import WebhookConfig, WebhookEvent  # noqa: F401

__all__ = [
    "User",
    "RefreshToken",
    "LoanAccount",
    "Payment",
    "WebhookConfig",
    "WebhookEvent",
    "AuditLog",
]
