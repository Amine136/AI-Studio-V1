from __future__ import annotations

import time

import pytest

from app.services import admin_auth
from app.db.repositories import SecurityRepository
from app.db.session import session_scope
from app.services import postgres_security_store as store


def test_admin_login_success_resets_failed_login_buckets(test_db, monkeypatch):
    monkeypatch.setattr(admin_auth.settings, "admin_login_username_limit", 5)
    monkeypatch.setattr(admin_auth.settings, "admin_login_ip_limit", 10)
    monkeypatch.setattr(admin_auth.settings, "admin_login_username_ip_limit", 5)
    monkeypatch.setattr(admin_auth.settings, "admin_login_window_seconds", 15 * 60)
    monkeypatch.setattr(admin_auth.settings, "admin_login_lockout_threshold", 5)
    monkeypatch.setattr(admin_auth.settings, "admin_login_lockout_seconds", 15 * 60)
    monkeypatch.setattr(admin_auth.settings, "admin_session_secret", "test-secret")

    admin_auth.create_or_update_admin_account("admin-user", "StrongPass123!")
    for _ in range(2):
        with pytest.raises(ValueError):
            admin_auth.authenticate_admin("admin-user", "wrong-pass", ip_address="1.2.3.4")

    token, session = admin_auth.authenticate_admin("admin-user", "StrongPass123!", ip_address="1.2.3.4")

    assert token
    assert session["username"] == "admin-user"
    logs = store.list_admin_audit_logs(limit=20)
    assert any(log["action"] == "admin_login_success" for log in logs)
    with session_scope() as db:
        repo = SecurityRepository(db)
        assert repo.get_rate_limit_bucket(admin_auth._admin_login_username_key("admin-user")) is None
        assert repo.get_rate_limit_bucket(admin_auth._admin_login_ip_key("1.2.3.4")) is None
        assert repo.get_rate_limit_bucket(admin_auth._admin_login_username_ip_key("admin-user", "1.2.3.4")) is None
        assert repo.get_rate_limit_bucket(admin_auth._admin_login_lockout_key("admin-user")) is None


def test_admin_login_lockout_after_five_failed_attempts(test_db, monkeypatch):
    monkeypatch.setattr(admin_auth.settings, "admin_login_username_limit", 5)
    monkeypatch.setattr(admin_auth.settings, "admin_login_ip_limit", 10)
    monkeypatch.setattr(admin_auth.settings, "admin_login_username_ip_limit", 5)
    monkeypatch.setattr(admin_auth.settings, "admin_login_window_seconds", 15 * 60)
    monkeypatch.setattr(admin_auth.settings, "admin_login_lockout_threshold", 5)
    monkeypatch.setattr(admin_auth.settings, "admin_login_lockout_seconds", 15 * 60)
    monkeypatch.setattr(admin_auth.settings, "admin_session_secret", "test-secret")

    admin_auth.create_or_update_admin_account("locked-admin", "StrongPass123!")
    for _ in range(4):
        with pytest.raises(ValueError):
            admin_auth.authenticate_admin("locked-admin", "wrong-pass", ip_address="1.2.3.4")

    with pytest.raises(admin_auth.AdminAuthRateLimitError):
        admin_auth.authenticate_admin("locked-admin", "wrong-pass", ip_address="1.2.3.4")

    with pytest.raises(admin_auth.AdminAuthRateLimitError):
        admin_auth.authenticate_admin("locked-admin", "StrongPass123!", ip_address="1.2.3.4")

    logs = store.list_admin_audit_logs(limit=20, target_id="locked-admin")
    assert any(log["action"] == "admin_login_lockout" for log in logs)


def test_admin_login_ip_limit_blocks_after_ten_failed_attempts(test_db, monkeypatch):
    monkeypatch.setattr(admin_auth.settings, "admin_login_username_limit", 5)
    monkeypatch.setattr(admin_auth.settings, "admin_login_ip_limit", 10)
    monkeypatch.setattr(admin_auth.settings, "admin_login_username_ip_limit", 5)
    monkeypatch.setattr(admin_auth.settings, "admin_login_window_seconds", 15 * 60)
    monkeypatch.setattr(admin_auth.settings, "admin_login_lockout_threshold", 5)
    monkeypatch.setattr(admin_auth.settings, "admin_login_lockout_seconds", 15 * 60)
    monkeypatch.setattr(admin_auth.settings, "admin_session_secret", "test-secret")

    for idx in range(9):
        with pytest.raises(ValueError):
            admin_auth.authenticate_admin(f"missing-{idx}", "wrong-pass", ip_address="5.6.7.8")

    with pytest.raises(admin_auth.AdminAuthRateLimitError):
        admin_auth.authenticate_admin("missing-9", "wrong-pass", ip_address="5.6.7.8")

    logs = store.list_admin_audit_logs(limit=20, target_id="missing-9")
    assert any(log["action"] == "admin_login_lockout" for log in logs)


def test_admin_auth_failure_summaries_aggregate_existing_admin_wrong_password_attempts(test_db, monkeypatch):
    monkeypatch.setattr(admin_auth.settings, "admin_login_username_limit", 100)
    monkeypatch.setattr(admin_auth.settings, "admin_login_ip_limit", 100)
    monkeypatch.setattr(admin_auth.settings, "admin_login_username_ip_limit", 100)
    monkeypatch.setattr(admin_auth.settings, "admin_login_window_seconds", 15 * 60)
    monkeypatch.setattr(admin_auth.settings, "admin_login_lockout_threshold", 5)
    monkeypatch.setattr(admin_auth.settings, "admin_login_lockout_seconds", 15 * 60)
    monkeypatch.setattr(admin_auth.settings, "admin_login_deactivate_threshold", 30)
    monkeypatch.setattr(admin_auth.settings, "admin_login_deactivate_window_seconds", 60 * 60)
    monkeypatch.setattr(admin_auth.settings, "admin_session_secret", "test-secret")

    admin_auth.create_or_update_admin_account("summary-admin", "StrongPass123!")
    for _ in range(3):
        with pytest.raises(ValueError):
            admin_auth.authenticate_admin("summary-admin", "wrong-pass", ip_address="2.2.2.2")

    summaries = admin_auth.list_admin_auth_failure_summaries()
    summary = next(item for item in summaries if item["username"] == "summary-admin")
    assert summary["wrongPasswordFailures"] == 3
    assert summary["isLockedOut"] is False
    assert summary["isActive"] is True


def test_admin_login_lockout_expires_after_window(test_db, monkeypatch):
    monkeypatch.setattr(admin_auth.settings, "admin_login_username_limit", 5)
    monkeypatch.setattr(admin_auth.settings, "admin_login_ip_limit", 10)
    monkeypatch.setattr(admin_auth.settings, "admin_login_username_ip_limit", 5)
    monkeypatch.setattr(admin_auth.settings, "admin_login_window_seconds", 15 * 60)
    monkeypatch.setattr(admin_auth.settings, "admin_login_lockout_threshold", 5)
    monkeypatch.setattr(admin_auth.settings, "admin_login_lockout_seconds", 15 * 60)
    monkeypatch.setattr(admin_auth.settings, "admin_session_secret", "test-secret")

    admin_auth.create_or_update_admin_account("time-admin", "StrongPass123!")
    for _ in range(5):
        try:
            admin_auth.authenticate_admin("time-admin", "wrong-pass", ip_address="9.9.9.9")
        except (ValueError, admin_auth.AdminAuthRateLimitError):
            pass

    with session_scope() as db:
        repo = SecurityRepository(db)
        lockout = repo.get_rate_limit_bucket(admin_auth._admin_login_lockout_key("time-admin"))
        assert lockout is not None
        lockout.reset_at = int(time.time()) - 1
        username_bucket = repo.get_rate_limit_bucket(admin_auth._admin_login_username_key("time-admin"))
        if username_bucket is not None:
            username_bucket.reset_at = int(time.time()) - 1
        username_ip_bucket = repo.get_rate_limit_bucket(admin_auth._admin_login_username_ip_key("time-admin", "9.9.9.9"))
        if username_ip_bucket is not None:
            username_ip_bucket.reset_at = int(time.time()) - 1
        ip_bucket = repo.get_rate_limit_bucket(admin_auth._admin_login_ip_key("9.9.9.9"))
        if ip_bucket is not None:
            ip_bucket.reset_at = int(time.time()) - 1
        db.flush()

    token, session = admin_auth.authenticate_admin("time-admin", "StrongPass123!", ip_address="9.9.9.9")
    assert token
    assert session["username"] == "time-admin"


def test_admin_account_is_deactivated_after_thirty_failed_attempts_in_one_hour(test_db, monkeypatch):
    monkeypatch.setattr(admin_auth.settings, "admin_login_username_limit", 100)
    monkeypatch.setattr(admin_auth.settings, "admin_login_ip_limit", 100)
    monkeypatch.setattr(admin_auth.settings, "admin_login_username_ip_limit", 100)
    monkeypatch.setattr(admin_auth.settings, "admin_login_window_seconds", 15 * 60)
    monkeypatch.setattr(admin_auth.settings, "admin_login_lockout_threshold", 100)
    monkeypatch.setattr(admin_auth.settings, "admin_login_lockout_seconds", 15 * 60)
    monkeypatch.setattr(admin_auth.settings, "admin_login_deactivate_threshold", 30)
    monkeypatch.setattr(admin_auth.settings, "admin_login_deactivate_window_seconds", 60 * 60)
    monkeypatch.setattr(admin_auth.settings, "admin_session_secret", "test-secret")

    admin_auth.create_or_update_admin_account("deactivate-admin", "StrongPass123!")
    for _ in range(29):
        with pytest.raises(ValueError):
            admin_auth.authenticate_admin("deactivate-admin", "wrong-pass", ip_address="7.7.7.7")

    with pytest.raises(admin_auth.AdminAuthRateLimitError):
        admin_auth.authenticate_admin("deactivate-admin", "wrong-pass", ip_address="7.7.7.7")

    with session_scope() as db:
        repo = SecurityRepository(db)
        account = repo.get_admin_account_by_username("deactivate-admin")
        assert account is not None
        assert account.is_active is False

    logs = store.list_admin_audit_logs(limit=50, target_id="deactivate-admin")
    assert any(log["action"] == "admin_login_admin_deactivated" for log in logs)


def test_reset_admin_password_revokes_existing_sessions_and_logs_rotation(test_db, monkeypatch):
    monkeypatch.setattr(admin_auth.settings, "admin_session_secret", "test-secret")

    admin_auth.create_admin_account("rotate-admin", "StrongPass123!")
    token, session = admin_auth.authenticate_admin("rotate-admin", "StrongPass123!", ip_address="3.3.3.3")
    assert token
    assert session["username"] == "rotate-admin"

    rotated = admin_auth.reset_admin_password("rotate-admin", "NewStrongPass456!")
    assert rotated["username"] == "rotate-admin"

    assert admin_auth.get_admin_session(token) is None
    with pytest.raises(ValueError):
        admin_auth.authenticate_admin("rotate-admin", "StrongPass123!", ip_address="3.3.3.3")

    new_token, new_session = admin_auth.authenticate_admin("rotate-admin", "NewStrongPass456!", ip_address="3.3.3.3")
    assert new_token
    assert new_session["username"] == "rotate-admin"

    logs = store.list_admin_audit_logs(limit=20, target_id="rotate-admin")
    assert any(log["action"] == "admin_password_rotated" for log in logs)


def test_deactivate_admin_account_revokes_sessions_and_blocks_future_login(test_db, monkeypatch):
    monkeypatch.setattr(admin_auth.settings, "admin_session_secret", "test-secret")

    admin_auth.create_admin_account("cli-deactivate", "StrongPass123!")
    token, session = admin_auth.authenticate_admin("cli-deactivate", "StrongPass123!", ip_address="4.4.4.4")
    assert token
    assert session["username"] == "cli-deactivate"

    deactivated = admin_auth.deactivate_admin_account("cli-deactivate", reason="Manual CLI deactivation for MVP hardening.")
    assert deactivated["username"] == "cli-deactivate"
    assert deactivated["isActive"] is False

    assert admin_auth.get_admin_session(token) is None
    with pytest.raises(ValueError):
        admin_auth.authenticate_admin("cli-deactivate", "StrongPass123!", ip_address="4.4.4.4")

    logs = store.list_admin_audit_logs(limit=20, target_id="cli-deactivate")
    assert any(log["action"] == "admin_account_deactivated" for log in logs)


def test_admin_session_extends_expiry_on_activity(test_db, monkeypatch):
    monkeypatch.setattr(admin_auth.settings, "admin_session_secret", "test-secret")
    monkeypatch.setattr(admin_auth.settings, "admin_session_ttl_seconds", 900)

    admin_auth.create_admin_account("idle-admin", "StrongPass123!")
    token, _session = admin_auth.authenticate_admin("idle-admin", "StrongPass123!", ip_address="6.6.6.6")
    shortened_expires_at = int(time.time()) + 120

    with session_scope() as db:
        repo = SecurityRepository(db)
        entry = repo.get_admin_session(admin_auth._hash_admin_session_token(token))
        assert entry is not None
        entry.expires_at = shortened_expires_at
        db.flush()

    refreshed = admin_auth.get_admin_session(token)
    assert refreshed is not None
    assert int(refreshed["expiresAt"]) > shortened_expires_at


def test_admin_session_expires_after_idle_timeout(test_db, monkeypatch):
    monkeypatch.setattr(admin_auth.settings, "admin_session_secret", "test-secret")
    monkeypatch.setattr(admin_auth.settings, "admin_session_ttl_seconds", 900)

    admin_auth.create_admin_account("expired-admin", "StrongPass123!")
    token, _session = admin_auth.authenticate_admin("expired-admin", "StrongPass123!", ip_address="8.8.8.8")

    with session_scope() as db:
        repo = SecurityRepository(db)
        entry = repo.get_admin_session(admin_auth._hash_admin_session_token(token))
        assert entry is not None
        entry.expires_at = int(time.time()) - 1
        db.flush()

    assert admin_auth.get_admin_session(token) is None
