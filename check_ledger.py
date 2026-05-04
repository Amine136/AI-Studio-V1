import os
import sys

sys.path.insert(0, "/home/ouni/AI-Studio-V1-staging/backend")
from app.db.session import session_scope
from app.db.repositories.security import SecurityRepository
from app.db.models import CreditLedgerEntry

with session_scope() as session:
    repo = SecurityRepository(session)
    entries = session.query(CreditLedgerEntry).order_by(CreditLedgerEntry.id.desc()).limit(10).all()
    for e in entries:
        print(f"Reason: {e.reason}, Delta: {e.delta_minor / 100}, Meta: {e.metadata_json}")
