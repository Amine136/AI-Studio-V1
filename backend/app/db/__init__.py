"""Database foundation for the PostgreSQL migration."""

from app.db.base import Base
from app.db.models import (
    AnalyzeSession,
    CreditCode,
    CreditCodeClaim,
    CreditLedgerEntry,
    GenerationJob,
    HistoryEntry,
    RateLimitBucket,
    User,
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
    "Base",
    "CreditCode",
    "CreditCodeClaim",
    "CreditLedgerEntry",
    "GenerationJob",
    "HistoryEntry",
    "RateLimitBucket",
    "User",
    "create_engine_from_settings",
    "create_session_factory",
    "get_database_url",
    "get_engine",
    "get_session_factory",
    "new_session",
    "session_scope",
]
