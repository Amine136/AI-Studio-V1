from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.config import settings
from app.db import Base
from app.db.session import get_engine, reset_session_state


@pytest.fixture()
def test_db(tmp_path):
    db_path = tmp_path / "test_security_store.sqlite3"
    settings.database_url = f"sqlite+pysqlite:///{db_path}"
    settings.database_echo = False
    settings.database_pool_pre_ping = False
    reset_session_state()
    engine = get_engine()
    Base.metadata.create_all(bind=engine)
    try:
        yield db_path
    finally:
        Base.metadata.drop_all(bind=engine)
        reset_session_state()
