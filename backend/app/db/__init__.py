"""Database foundation for the PostgreSQL migration."""

from app.db.base import Base
from app.db.models import (
    AdminAccount,
    AdminAuditLog,
    AdminSession,
    AnalyzeSession,
    CreditCode,
    CreditCodeClaim,
    CreditLedgerEntry,
    ChatConversation,
    ChatMessage,
    GenerationJob,
    HistoryEntry,
    RateLimitBucket,
    User,
    UserFile,
)
from app.db.session import (
    create_engine_from_settings,
    create_session_factory,
    get_database_url,
    get_engine,
    get_session_factory,
    new_session,
    session_scope,
)

__all__ = [
    "AnalyzeSession",
    "AdminAccount",
    "AdminAuditLog",
    "AdminSession",
    "Base",
    "ChatConversation",
    "ChatMessage",
    "CreditCode",
    "CreditCodeClaim",
    "CreditLedgerEntry",
    "GenerationJob",
    "HistoryEntry",
    "RateLimitBucket",
    "User",
    "UserFile",
    "create_engine_from_settings",
    "create_session_factory",
    "get_database_url",
    "get_engine",
    "get_session_factory",
    "new_session",
    "session_scope",
]
