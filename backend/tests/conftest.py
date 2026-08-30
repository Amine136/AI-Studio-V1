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

    # Accounts start with zero credits unless the test grants them.
    #
    # ensure_user() grants a one-time welcome bonus (SIGNUP_BONUS_CREDITS,
    # default 1.0) to every brand-new account. Tests that seed a balance and
    # assert on an exact figure were written before that existed, so the bonus
    # silently shifted every one of their expectations by +1.0 credit and made
    # usage-cap and insufficient-funds assertions unreachable.
    #
    # Zeroed here rather than patched in each test so a balance assertion means
    # what it says. Tests that care about the bonus set it explicitly --
    # see test_signup_bonus_* in test_postgres_security_store.py.
    previous_bonus = settings.signup_bonus_credits
    settings.signup_bonus_credits = 0.0

    reset_session_state()
    engine = get_engine()
    Base.metadata.create_all(bind=engine)
    try:
        yield db_path
    finally:
        settings.signup_bonus_credits = previous_bonus
        Base.metadata.drop_all(bind=engine)
        reset_session_state()
