from __future__ import annotations

import concurrent.futures
import time
from unittest import mock

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import postgres_security_store as store
from app.config import settings

client = TestClient(app)

def test_reserve_generation_insufficient_balance(test_db):
    uid = "user-no-funds"
    store.ensure_user(uid, "nofunds@example.com", "No Funds")
    
    with pytest.raises(ValueError, match="INSUFFICIENT_CREDITS"):
        store.reserve_generation_credits(
            uid,
            prompt="Make me art",
            requested_outputs=["image"],
            request_payload={},
            estimated_cost=0.05,
        )

def test_overlapping_analyze_sessions(test_db, monkeypatch):
    monkeypatch.setattr(settings, "max_pending_analyze_sessions_per_user", 1)
    uid = "user-smart"
    store.ensure_user(uid, "smart@example.com", "Smart User")
    store.adjust_credits(uid, 5.0, "grant", allow_negative=False)

    # First session should succeed
    res1 = store.create_analyze_session_with_charge(uid, "Test 1", analysis_fee=0.05)
    assert res1["analysisFee"] == 0.05

    user = store.get_user(uid)
    assert user["credits"] == 4.95  # 5.0 - 0.05

    # Second session should fail due to pending limit
    with pytest.raises(ValueError, match="TOO_MANY_PENDING_ANALYZE_SESSIONS"):
        store.create_analyze_session_with_charge(uid, "Test 2", analysis_fee=0.05)

    user = store.get_user(uid)
    assert user["credits"] == 4.95  # no additional charge

def test_analyze_session_refund_on_failure(test_db):
    uid = "user-fail"
    store.ensure_user(uid, "fail@example.com", "Fail User")
    store.adjust_credits(uid, 1.0, "grant", allow_negative=False)

    res = store.create_analyze_session_with_charge(uid, "Test Fail", analysis_fee=0.05)
    session_id = res["id"]

    user = store.get_user(uid)
    assert user["credits"] == 0.95  # 1.0 - 0.05

    # Suppose upstream failed, refund!
    store.refund_analyze_session(session_id, uid)
    
    user = store.get_user(uid)
    # The 0.05 analysis fee is refunded.
    assert user["credits"] == 1.0
