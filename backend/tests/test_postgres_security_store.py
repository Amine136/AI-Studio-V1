from __future__ import annotations

import time

import pytest
from sqlalchemy import select

from app.db.models import CreditCodeClaim
from app.db.repositories import SecurityRepository
from app.db.session import session_scope
from app.services import postgres_security_store as store


def test_credit_code_redeem_is_applied_once(test_db):
    store.ensure_user("user-1", "user@example.com", "User One")
    created = store.create_credit_code(credits=3, max_claims=1, created_by="user-1")

    first = store.redeem_credit_code(created["code"], "user-1")
    second = store.redeem_credit_code(created["code"], "user-1")
    profile = store.get_user("user-1")

    assert first["success"] is True
    assert first["balance"] == 3.0
    assert second["success"] is False
    assert "already used" in second["message"].lower()
    assert profile["credits"] == 3.0


def test_credit_code_redeem_daily_limit_is_enforced(test_db, monkeypatch):
    monkeypatch.setattr(store.settings, "max_redeemed_codes_per_day", 4)
    monkeypatch.setattr(store.settings, "max_redeemed_codes_per_week", 10)

    store.ensure_user("user-redeem-day", "redeem-day@example.com", "Redeem Day")
    for _ in range(4):
        created = store.create_credit_code(credits=1, max_claims=1, created_by="user-redeem-day")
        result = store.redeem_credit_code(created["code"], "user-redeem-day")
        assert result["success"] is True

    blocked = store.create_credit_code(credits=1, max_claims=1, created_by="user-redeem-day")
    result = store.redeem_credit_code(blocked["code"], "user-redeem-day")

    assert result["success"] is False
    assert "daily credit-code redemption limit" in result["message"].lower()


def test_credit_code_redeem_weekly_limit_is_enforced(test_db, monkeypatch):
    monkeypatch.setattr(store.settings, "max_redeemed_codes_per_day", 20)
    monkeypatch.setattr(store.settings, "max_redeemed_codes_per_week", 10)

    store.ensure_user("user-redeem-week", "redeem-week@example.com", "Redeem Week")
    claim_times: list[int] = []
    for _ in range(10):
        created = store.create_credit_code(credits=1, max_claims=1, created_by="user-redeem-week")
        result = store.redeem_credit_code(created["code"], "user-redeem-week")
        assert result["success"] is True
        claim_times.append(int(time.time()) - (2 * 24 * 60 * 60))

    with session_scope() as session:
        repo = SecurityRepository(session)
        claims = repo.session.execute(select(CreditCodeClaim).where(CreditCodeClaim.uid == "user-redeem-week")).scalars().all()
        assert len(claims) == 10
        for claim, claimed_at in zip(claims, claim_times):
            claim.claimed_at = claimed_at
        session.flush()

    blocked = store.create_credit_code(credits=1, max_claims=1, created_by="user-redeem-week")
    result = store.redeem_credit_code(blocked["code"], "user-redeem-week")

    assert result["success"] is False
    assert "weekly credit-code redemption limit" in result["message"].lower()


def test_failed_redeem_five_times_triggers_redeem_cooldown_only(test_db, monkeypatch):
    monkeypatch.setattr(store.settings, "redeem_failed_attempt_limit", 5)
    monkeypatch.setattr(store.settings, "redeem_failed_attempt_window_seconds", 5 * 60)
    monkeypatch.setattr(store.settings, "redeem_failed_cooldown_seconds", 5 * 60)
    monkeypatch.setattr(store.settings, "redeem_consecutive_suspend_threshold", 10)
    monkeypatch.setattr(store.settings, "redeem_consecutive_admin_threshold", 20)
    monkeypatch.setattr(store.settings, "redeem_consecutive_window_seconds", 24 * 60 * 60)
    monkeypatch.setattr(store.settings, "redeem_temp_suspension_seconds", 60 * 60)

    store.ensure_user("user-redeem-cooldown", "cooldown@example.com", "Cooldown User")
    for _ in range(4):
        result = store.redeem_credit_code("INVALID-CODE", "user-redeem-cooldown")
        assert result["success"] is False
        assert "invalid code" in result["message"].lower()

    fifth = store.redeem_credit_code("INVALID-CODE", "user-redeem-cooldown")
    blocked = store.redeem_credit_code("INVALID-CODE", "user-redeem-cooldown")

    assert "reached 5 failed credit code attempts" in fifth["message"].lower()
    assert "review the usage policy" in blocked["message"].lower()
    assert store.get_active_suspension("user-redeem-cooldown") is None


def test_successful_redeem_resets_consecutive_failed_redeem_streak(test_db, monkeypatch):
    monkeypatch.setattr(store.settings, "redeem_failed_attempt_limit", 50)
    monkeypatch.setattr(store.settings, "redeem_consecutive_suspend_threshold", 5)
    monkeypatch.setattr(store.settings, "redeem_consecutive_admin_threshold", 20)
    monkeypatch.setattr(store.settings, "redeem_consecutive_window_seconds", 24 * 60 * 60)
    monkeypatch.setattr(store.settings, "redeem_temp_suspension_seconds", 60 * 60)

    store.ensure_user("user-redeem-reset", "reset@example.com", "Reset User")
    for _ in range(3):
        result = store.redeem_credit_code("INVALID-CODE", "user-redeem-reset")
        assert result["success"] is False

    created = store.create_credit_code(credits=1, max_claims=1, created_by="user-redeem-reset")
    success = store.redeem_credit_code(created["code"], "user-redeem-reset")
    assert success["success"] is True

    for _ in range(4):
        result = store.redeem_credit_code("INVALID-CODE-2", "user-redeem-reset")
        assert result["success"] is False

    assert store.get_active_suspension("user-redeem-reset") is None


def test_ten_consecutive_failed_redeems_trigger_one_hour_suspension(test_db, monkeypatch):
    monkeypatch.setattr(store.settings, "redeem_failed_attempt_limit", 5)
    monkeypatch.setattr(store.settings, "redeem_failed_attempt_window_seconds", 5 * 60)
    monkeypatch.setattr(store.settings, "redeem_failed_cooldown_seconds", 5 * 60)
    monkeypatch.setattr(store.settings, "redeem_consecutive_suspend_threshold", 10)
    monkeypatch.setattr(store.settings, "redeem_consecutive_admin_threshold", 20)
    monkeypatch.setattr(store.settings, "redeem_consecutive_window_seconds", 24 * 60 * 60)
    monkeypatch.setattr(store.settings, "redeem_temp_suspension_seconds", 60 * 60)

    store.ensure_user("user-redeem-10", "redeem10@example.com", "Redeem Ten")
    for attempt in range(10):
        result = store.redeem_credit_code(f"INVALID-{attempt}", "user-redeem-10")
        if attempt in {4}:
            with session_scope() as session:
                repo = SecurityRepository(session)
                cooldown_bucket = repo.get_rate_limit_bucket(store._redeem_cooldown_key("user-redeem-10"))
                assert cooldown_bucket is not None
                cooldown_bucket.reset_at = int(time.time()) - 1
                failed_window_bucket = repo.get_rate_limit_bucket(store._redeem_failed_window_key("user-redeem-10"))
                assert failed_window_bucket is not None
                failed_window_bucket.reset_at = int(time.time()) - 1
                session.flush()

    suspension = store.get_active_suspension("user-redeem-10")
    logs = store.list_admin_audit_logs(limit=20, target_id="user-redeem-10")

    assert suspension is not None
    assert "1 hour" in (suspension.get("reason") or "").lower()
    assert any(log["action"] == "user_auto_suspend" for log in logs)


def test_twenty_consecutive_failed_redeems_trigger_admin_review_suspension(test_db, monkeypatch):
    monkeypatch.setattr(store.settings, "redeem_failed_attempt_limit", 5)
    monkeypatch.setattr(store.settings, "redeem_failed_attempt_window_seconds", 5 * 60)
    monkeypatch.setattr(store.settings, "redeem_failed_cooldown_seconds", 5 * 60)
    monkeypatch.setattr(store.settings, "redeem_consecutive_suspend_threshold", 10)
    monkeypatch.setattr(store.settings, "redeem_consecutive_admin_threshold", 20)
    monkeypatch.setattr(store.settings, "redeem_consecutive_window_seconds", 24 * 60 * 60)
    monkeypatch.setattr(store.settings, "redeem_temp_suspension_seconds", 60 * 60)

    store.ensure_user("user-redeem-20", "redeem20@example.com", "Redeem Twenty")
    for attempt in range(20):
        result = store.redeem_credit_code(f"INVALID-{attempt}", "user-redeem-20")
        if attempt in {4, 9, 14}:
            with session_scope() as session:
                repo = SecurityRepository(session)
                cooldown_bucket = repo.get_rate_limit_bucket(store._redeem_cooldown_key("user-redeem-20"))
                if cooldown_bucket is not None:
                    cooldown_bucket.reset_at = int(time.time()) - 1
                failed_window_bucket = repo.get_rate_limit_bucket(store._redeem_failed_window_key("user-redeem-20"))
                if failed_window_bucket is not None:
                    failed_window_bucket.reset_at = int(time.time()) - 1
                temp_suspension_bucket = repo.get_rate_limit_bucket(store._redeem_temp_suspension_key("user-redeem-20"))
                if temp_suspension_bucket is not None:
                    temp_suspension_bucket.reset_at = int(time.time()) - 1
                session.flush()

    profile = store.get_user("user-redeem-20")
    logs = store.list_admin_audit_logs(limit=20, target_id="user-redeem-20")

    assert profile["isSuspended"] is True
    assert "admin review" in profile["suspensionReason"].lower()
    assert any(log["action"] == "user_auto_suspend" for log in logs)


def test_generation_reserve_then_capture_moves_credits_without_refund(test_db, monkeypatch):
    monkeypatch.setattr(store.settings, "new_account_usage_cap_first_24h", 100.0)
    monkeypatch.setattr(store.settings, "daily_usage_cap", 100.0)
    store.ensure_user("user-2", "user2@example.com", "User Two")
    store.adjust_credits("user-2", 10.0, "seed", actor_uid="system", allow_negative=True)

    reservation = store.reserve_generation_credits(
        "user-2",
        "prompt",
        ["image"],
        {"image_model": "x"},
        estimated_cost=2.5,
    )
    profile_after_reserve = reservation["balance"]
    job_id = reservation["job"]["id"]

    captured = store.capture_generation_credits(job_id)
    profile_after_capture = captured["balance"]

    assert profile_after_reserve["credits"] == 7.5
    assert profile_after_reserve["reservedCredits"] == 2.5
    assert captured["job"]["status"] == "completed"
    assert captured["job"]["capturedCost"] == 2.5
    assert profile_after_capture["credits"] == 7.5
    assert profile_after_capture["reservedCredits"] == 0.0


def test_generation_release_returns_reserved_credits(test_db, monkeypatch):
    monkeypatch.setattr(store.settings, "new_account_usage_cap_first_24h", 100.0)
    monkeypatch.setattr(store.settings, "daily_usage_cap", 100.0)
    store.ensure_user("user-3", "user3@example.com", "User Three")
    store.adjust_credits("user-3", 8.0, "seed", actor_uid="system", allow_negative=True)

    reservation = store.reserve_generation_credits(
        "user-3",
        "prompt",
        ["caption"],
        {"caption_model": "x"},
        estimated_cost=1.75,
    )
    job_id = reservation["job"]["id"]

    released = store.release_generation_credits(job_id, "provider_failed")
    profile = released["balance"]

    assert released["job"]["status"] == "failed"
    assert released["job"]["refundedCost"] == 1.75
    assert profile["credits"] == 8.0
    assert profile["reservedCredits"] == 0.0


def test_new_account_first_day_usage_cap_blocks_additional_charge(test_db, monkeypatch):
    monkeypatch.setattr(store.settings, "new_account_usage_cap_first_24h", 1.0)
    monkeypatch.setattr(store.settings, "daily_usage_cap", 5.0)

    store.ensure_user("user-cap-new", "new@example.com", "New User")
    store.adjust_credits("user-cap-new", 5.0, "seed", actor_uid="system", allow_negative=True)
    charged = store.create_analyze_session_with_charge("user-cap-new", "prompt", 0.2, 1.0)

    assert charged["analysisFee"] == 1.0
    with pytest.raises(ValueError, match="USAGE_CAP_REACHED"):
        store.reserve_generation_credits(
            "user-cap-new",
            "prompt",
            ["image"],
            {"image_model": "x"},
            estimated_cost=0.1,
        )


def test_daily_usage_cap_blocks_after_five_credits(test_db, monkeypatch):
    monkeypatch.setattr(store.settings, "new_account_usage_cap_first_24h", 1.0)
    monkeypatch.setattr(store.settings, "daily_usage_cap", 5.0)

    store.ensure_user("user-cap-daily", "daily@example.com", "Daily User")
    store.adjust_credits("user-cap-daily", 10.0, "seed", actor_uid="system", allow_negative=True)

    with session_scope() as session:
        repo = SecurityRepository(session)
        user = repo.get_user_for_update("user-cap-daily")
        assert user is not None
        user.created_at = int(time.time()) - (2 * 24 * 60 * 60)
        session.flush()

    reservation = store.reserve_generation_credits(
        "user-cap-daily",
        "prompt",
        ["image"],
        {"image_model": "x"},
        estimated_cost=5.0,
    )
    store.capture_generation_credits(reservation["job"]["id"])

    with pytest.raises(ValueError, match="USAGE_CAP_REACHED"):
        store.create_analyze_session_with_charge("user-cap-daily", "prompt-2", 0.2, 0.05)


def test_consume_rate_limit_blocks_after_max_count(test_db):
    key = "user:test-rate-limit"
    assert store.consume_rate_limit(key, max_count=2, window_seconds=60) is True
    assert store.consume_rate_limit(key, max_count=2, window_seconds=60) is True
    assert store.consume_rate_limit(key, max_count=2, window_seconds=60) is False


def test_analyze_sessions_are_capped_per_user(test_db, monkeypatch):
    monkeypatch.setattr(store.settings, "max_pending_analyze_sessions_per_user", 2)
    monkeypatch.setattr(store.settings, "pending_analyze_session_ttl_seconds", 900)

    store.ensure_user("user-analyze-cap", "cap@example.com", "Cap User")
    first = store.create_analyze_session("user-analyze-cap", "prompt 1", 0.2)
    second = store.create_analyze_session("user-analyze-cap", "prompt 2", 0.2)

    assert first["status"] == "pending"
    assert second["status"] == "pending"
    with pytest.raises(ValueError, match="TOO_MANY_PENDING_ANALYZE_SESSIONS"):
        store.create_analyze_session("user-analyze-cap", "prompt 3", 0.2)


def test_stale_pending_analyze_sessions_are_expired_before_new_one(test_db, monkeypatch):
    monkeypatch.setattr(store.settings, "max_pending_analyze_sessions_per_user", 1)
    monkeypatch.setattr(store.settings, "pending_analyze_session_ttl_seconds", 60)

    store.ensure_user("user-analyze-stale", "stale@example.com", "Stale User")
    created = store.create_analyze_session("user-analyze-stale", "prompt 1", 0.2)
    stale_created_at = int(time.time()) - 120

    with session_scope() as session:
        repo = SecurityRepository(session)
        analyze_session = repo.get_analyze_session_for_update(created["id"])
        assert analyze_session is not None
        analyze_session.created_at = stale_created_at
        session.flush()

    next_session = store.create_analyze_session("user-analyze-stale", "prompt 2", 0.2)

    assert next_session["status"] == "pending"
    with session_scope() as session:
        repo = SecurityRepository(session)
        expired_session = repo.get_analyze_session_for_update(created["id"])
        assert expired_session is not None
        assert expired_session.status == "failed"
        assert expired_session.resolved_at is not None


def test_admin_audit_log_write_and_read(test_db):
    store.ensure_user("admin-1", "admin@example.com", "Admin One")

    created = store.add_admin_audit_log(
        admin_uid="admin-1",
        admin_email="admin@example.com",
        action="user_suspend",
        target_type="user",
        target_id="user-42",
        reason="abusive activity review",
        metadata={"source": "admin_panel"},
    )
    logs = store.list_admin_audit_logs(limit=10)

    assert created["action"] == "user_suspend"
    assert created["targetType"] == "user"
    assert created["targetId"] == "user-42"
    assert created["reason"] == "abusive activity review"
    assert logs[0]["id"] == created["id"]
    assert logs[0]["adminEmail"] == "admin@example.com"


def test_admin_audit_log_filters_by_admin_action_and_target(test_db):
    store.add_admin_audit_log(
        admin_uid="admin-a",
        admin_email="a@example.com",
        action="user_suspend",
        target_type="user",
        target_id="user-1",
        reason="first action",
        metadata={"scope": "alpha"},
    )
    store.add_admin_audit_log(
        admin_uid="admin-b",
        admin_email="b@example.com",
        action="credit_code_disable",
        target_type="credit_code",
        target_id="code-1",
        reason="second action",
        metadata={"scope": "beta"},
    )

    by_admin = store.list_admin_audit_logs(limit=10, admin_uid="admin-a")
    by_action = store.list_admin_audit_logs(limit=10, action="credit_code_disable")
    by_target = store.list_admin_audit_logs(limit=10, target_type="user", target_id="user-1")

    assert len(by_admin) == 1
    assert by_admin[0]["adminUid"] == "admin-a"
    assert by_admin[0]["action"] == "user_suspend"
    assert len(by_action) == 1
    assert by_action[0]["targetType"] == "credit_code"
    assert by_action[0]["targetId"] == "code-1"
    assert len(by_target) == 1
    assert by_target[0]["reason"] == "first action"


def test_search_users_filters_by_email_name_and_uid(test_db):
    store.ensure_user("user-alpha", "alpha@example.com", "Alpha One")
    store.ensure_user("user-beta", "beta@example.com", "Beta Two")

    by_email = store.search_users("alpha@", limit=10)
    by_name = store.search_users("beta two", limit=10)
    by_uid = store.search_users("user-alpha", limit=10)

    assert len(by_email) == 1
    assert by_email[0]["uid"] == "user-alpha"
    assert len(by_name) == 1
    assert by_name[0]["uid"] == "user-beta"
    assert len(by_uid) == 1
    assert by_uid[0]["email"] == "alpha@example.com"


def test_get_admin_user_detail_returns_none_for_missing_user(test_db):
    store.ensure_user("user-detail", "detail@example.com", "Detail User")

    found = store.get_admin_user_detail("user-detail")
    missing = store.get_admin_user_detail("missing-user")

    assert found is not None
    assert found["uid"] == "user-detail"
    assert found["email"] == "detail@example.com"
    assert missing is None


def test_suspend_and_unsuspend_user_write_audit_logs(test_db):
    store.ensure_user("admin-2", "admin2@example.com", "Admin Two")
    store.ensure_user("user-suspend", "target@example.com", "Target User")

    suspended = store.suspend_user(
        "user-suspend",
        reason="terms of use violation",
        admin_uid="admin-2",
        admin_email="admin2@example.com",
    )
    unsuspended = store.unsuspend_user(
        "user-suspend",
        reason="appeal accepted",
        admin_uid="admin-2",
        admin_email="admin2@example.com",
    )
    logs = store.list_admin_audit_logs(limit=10)

    assert suspended["isSuspended"] is True
    assert suspended["suspensionReason"] == "terms of use violation"
    assert unsuspended["isSuspended"] is False
    assert unsuspended["suspensionReason"] == ""
    assert logs[0]["action"] == "user_unsuspend"
    assert logs[1]["action"] == "user_suspend"
    assert logs[0]["targetId"] == "user-suspend"
    assert logs[1]["targetId"] == "user-suspend"


def test_disable_and_enable_credit_code_update_status_and_logs(test_db):
    store.ensure_user("admin-3", "admin3@example.com", "Admin Three")
    created = store.create_credit_code(credits=5, max_claims=2, created_by="admin-3")
    code_hash = store.hash_credit_code(created["code"])

    disabled = store.disable_credit_code(
        code_hash,
        reason="campaign paused",
        admin_uid="admin-3",
        admin_email="admin3@example.com",
    )
    enabled = store.enable_credit_code(
        code_hash,
        reason="campaign resumed",
        admin_uid="admin-3",
        admin_email="admin3@example.com",
    )
    logs = store.list_admin_audit_logs(limit=10)

    assert disabled["isActive"] is False
    assert disabled["status"] == "inactive"
    assert enabled["isActive"] is True
    assert enabled["status"] == "active"
    assert logs[0]["action"] == "credit_code_enable"
    assert logs[1]["action"] == "credit_code_disable"


def test_list_admin_generation_jobs_filters_by_status(test_db):
    store.ensure_user("user-jobs", "jobs@example.com", "Jobs User")
    pending = store.create_generation_job("user-jobs", "prompt one", ["image"], {}, status="processing")
    failed = store.create_generation_job("user-jobs", "prompt two", ["caption"], {}, status="failed")

    processing_jobs = store.list_admin_generation_jobs("processing", limit=10)
    all_jobs = store.list_admin_generation_jobs("", limit=10)
    failed_job = store.get_admin_generation_job(failed["id"])

    assert any(job["id"] == pending["id"] for job in processing_jobs)
    assert all(job["status"] == "processing" for job in processing_jobs)
    assert len(all_jobs) >= 2
    assert failed_job is not None
    assert failed_job["id"] == failed["id"]
    assert failed_job["status"] == "failed"
