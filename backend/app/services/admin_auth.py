from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import time
from typing import Any

from app.config import settings
from app.db.session import session_scope
from app.db.repositories.security import SecurityRepository

PASSWORD_HASH_ITERATIONS = 600_000
ADMIN_AUTH_AUDIT_EMAIL = "security@vibecraft.local"


class AdminAuthRateLimitError(RuntimeError):
    pass


def normalize_admin_username(username: str) -> str:
    return username.strip().lower()


def _require_admin_session_secret() -> str:
    secret = settings.admin_session_secret.strip()
    if not secret:
        raise RuntimeError("ADMIN_SESSION_SECRET is not configured")
    return secret


def hash_admin_password(password: str, *, salt: bytes | None = None) -> str:
    normalized = password.encode("utf-8")
    password_salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", normalized, password_salt, PASSWORD_HASH_ITERATIONS)
    return "pbkdf2_sha256${iterations}${salt}${digest}".format(
        iterations=PASSWORD_HASH_ITERATIONS,
        salt=base64.b64encode(password_salt).decode("ascii"),
        digest=base64.b64encode(digest).decode("ascii"),
    )


def verify_admin_password(password: str, encoded_hash: str) -> bool:
    try:
        algorithm, iteration_text, salt_text, digest_text = encoded_hash.split("$", 3)
    except ValueError:
        return False
    if algorithm != "pbkdf2_sha256":
        return False

    try:
        iterations = int(iteration_text)
        salt = base64.b64decode(salt_text.encode("ascii"))
        expected_digest = base64.b64decode(digest_text.encode("ascii"))
    except Exception:
        return False

    actual_digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return hmac.compare_digest(actual_digest, expected_digest)


def _hash_admin_session_token(token: str) -> str:
    secret = _require_admin_session_secret().encode("utf-8")
    return hmac.new(secret, token.encode("utf-8"), hashlib.sha256).hexdigest()


def _admin_account_dict(account: Any) -> dict[str, Any]:
    return {
        "id": str(account.id),
        "username": str(account.username),
        "isActive": bool(account.is_active),
        "createdAt": int(account.created_at),
        "updatedAt": int(account.updated_at),
        "lastLoginAt": int(account.last_login_at) if account.last_login_at is not None else None,
    }


def _admin_session_dict(entry: Any, token: str | None = None) -> dict[str, Any]:
    account = entry.admin_account
    data = {
        "sessionId": str(entry.id),
        "username": str(account.username),
        "adminId": str(account.id),
        "createdAt": int(entry.created_at),
        "expiresAt": int(entry.expires_at),
        "account": _admin_account_dict(account),
    }
    if token:
        data["token"] = token
    return data


def create_or_update_admin_account(username: str, password: str) -> dict[str, Any]:
    normalized_username = normalize_admin_username(username)
    normalized_password = password.strip()
    if len(normalized_username) < 3:
        raise ValueError("Username must be at least 3 characters")
    if len(normalized_password) < 8:
        raise ValueError("Password must be at least 8 characters")

    encoded_hash = hash_admin_password(normalized_password)
    with session_scope() as session:
        repo = SecurityRepository(session)
        account = repo.get_admin_account_by_username_for_update(normalized_username)
        if account is None:
            account = repo.create_admin_account(normalized_username, encoded_hash)
        else:
            account = repo.update_admin_account_password(account, encoded_hash)
        return _admin_account_dict(account)


def create_admin_account(username: str, password: str) -> dict[str, Any]:
    normalized_username = normalize_admin_username(username)
    normalized_password = password.strip()
    if len(normalized_username) < 3:
        raise ValueError("Username must be at least 3 characters")
    if len(normalized_password) < 8:
        raise ValueError("Password must be at least 8 characters")

    encoded_hash = hash_admin_password(normalized_password)
    now = int(time.time())
    with session_scope() as session:
        repo = SecurityRepository(session)
        existing = repo.get_admin_account_by_username_for_update(normalized_username)
        if existing is not None:
            raise ValueError("Admin account already exists")
        account = repo.create_admin_account(normalized_username, encoded_hash)
        repo.add_admin_audit_log(
            admin_uid=None,
            admin_email=ADMIN_AUTH_AUDIT_EMAIL,
            action="admin_account_created",
            target_type="admin_account",
            target_id=str(account.username),
            reason="Admin account was created via the admin CLI.",
            metadata_json={
                "username": str(account.username),
                "admin_id": str(account.id),
            },
            created_at=now,
        )
        return _admin_account_dict(account)


def reset_admin_password(username: str, new_password: str) -> dict[str, Any]:
    normalized_username = normalize_admin_username(username)
    normalized_password = new_password.strip()
    if len(normalized_username) < 3:
        raise ValueError("Username must be at least 3 characters")
    if len(normalized_password) < 8:
        raise ValueError("Password must be at least 8 characters")

    encoded_hash = hash_admin_password(normalized_password)
    now = int(time.time())
    with session_scope() as session:
        repo = SecurityRepository(session)
        account = repo.get_admin_account_by_username_for_update(normalized_username)
        if account is None:
            raise ValueError("Admin account not found")
        account = repo.update_admin_account_password(account, encoded_hash)
        revoked_sessions = repo.revoke_admin_sessions_for_admin(str(account.id), revoked_at=now)
        _clear_failed_admin_login_state(repo, normalized_username, "")
        repo.add_admin_audit_log(
            admin_uid=None,
            admin_email=ADMIN_AUTH_AUDIT_EMAIL,
            action="admin_password_rotated",
            target_type="admin_account",
            target_id=str(account.username),
            reason="Admin password was rotated and active sessions were revoked.",
            metadata_json={
                "username": str(account.username),
                "admin_id": str(account.id),
                "revoked_sessions": revoked_sessions,
            },
            created_at=now,
        )
        return _admin_account_dict(account)


def deactivate_admin_account(username: str, *, reason: str = "Admin account deactivated via the admin CLI.") -> dict[str, Any]:
    normalized_username = normalize_admin_username(username)
    if len(normalized_username) < 3:
        raise ValueError("Username must be at least 3 characters")

    clean_reason = reason.strip() or "Admin account deactivated via the admin CLI."
    now = int(time.time())
    with session_scope() as session:
        repo = SecurityRepository(session)
        account = repo.get_admin_account_by_username_for_update(normalized_username)
        if account is None:
            raise ValueError("Admin account not found")
        if account.is_active:
            repo.set_admin_account_active(account, False)
        revoked_sessions = repo.revoke_admin_sessions_for_admin(str(account.id), revoked_at=now)
        _clear_failed_admin_login_state(repo, normalized_username, "")
        repo.add_admin_audit_log(
            admin_uid=None,
            admin_email=ADMIN_AUTH_AUDIT_EMAIL,
            action="admin_account_deactivated",
            target_type="admin_account",
            target_id=str(account.username),
            reason=clean_reason,
            metadata_json={
                "username": str(account.username),
                "admin_id": str(account.id),
                "revoked_sessions": revoked_sessions,
                "is_active": False,
            },
            created_at=now,
        )
        return _admin_account_dict(account)


def _send_discord_alert(message: str) -> None:
    webhook_url = getattr(settings, 'discord_webhook_url', None)
    if not webhook_url:
        return
    import httpx
    try:
        httpx.post(webhook_url, json={'content': message}, timeout=3.0)
    except Exception as exc:
        logger.warning("[discord_alert] Failed to post alert: %s", exc)


def authenticate_admin(username: str, password: str, *, ip_address: str) -> tuple[str, dict[str, Any]]:
    normalized_username = normalize_admin_username(username)
    if not normalized_username or not password:
        raise ValueError("Invalid username or password")

    now = int(time.time())
    failure_error: Exception | None = None
    with session_scope() as session:
        repo = SecurityRepository(session)
        _ensure_admin_login_not_limited(repo, normalized_username, ip_address, now=now)
        account = repo.get_admin_account_by_username_for_update(normalized_username)
        if account is None or not bool(account.is_active):
            failure_error = _record_failed_admin_login(repo, normalized_username, ip_address, now=now, account=account)
        elif not verify_admin_password(password, account.password_hash):
            failure_error = _record_failed_admin_login(repo, normalized_username, ip_address, now=now, account=account)
        else:
            _clear_failed_admin_login_state(repo, normalized_username, ip_address)
            account.last_login_at = now
            account.updated_at = now
            token = secrets.token_urlsafe(48)
            entry = repo.create_admin_session(
                account.id,
                _hash_admin_session_token(token),
                now + settings.admin_session_ttl_seconds,
            )
            entry.admin_account = account
            repo.add_admin_audit_log(
                admin_uid=None,
                admin_email=str(account.username),
                action="admin_login_success",
                target_type="admin_account",
                target_id=str(account.username),
                reason="Admin login succeeded.",
                metadata_json={
                    "admin_id": str(account.id),
                    "username": str(account.username),
                    "ip": ip_address.strip() or "unknown",
                    "session_id": str(entry.id),
                },
                created_at=now,
            )
            _send_discord_alert(
                f":lock: [Vibecraft] Admin login\nAdmin: {account.username}\nIP: {ip_address.strip() or 'unknown'}"
            )
            return token, _admin_session_dict(entry, token=token)

    if failure_error is not None:
        raise failure_error

    raise ValueError("Invalid username or password")


def get_admin_session(token: str) -> dict[str, Any] | None:
    if not token:
        return None
    token_hash = _hash_admin_session_token(token)
    now = int(time.time())
    with session_scope() as session:
        repo = SecurityRepository(session)
        entry = repo.get_admin_session_for_update(token_hash)
        if entry is None:
            return None
        if entry.revoked_at is not None or int(entry.expires_at) <= now:
            if entry.revoked_at is None:
                repo.revoke_admin_session(entry, revoked_at=now)
            return None

        repo.touch_admin_session(
            entry,
            refreshed_at=now,
            expires_at=now + settings.admin_session_ttl_seconds,
        )
        account = entry.admin_account
        if account is None or not bool(account.is_active):
            repo.revoke_admin_session(entry, revoked_at=now)
            return None
        return _admin_session_dict(entry)


def revoke_admin_session(token: str) -> None:
    if not token:
        return
    token_hash = _hash_admin_session_token(token)
    with session_scope() as session:
        repo = SecurityRepository(session)
        entry = repo.get_admin_session_for_update(token_hash)
        if entry is None or entry.revoked_at is not None:
            return
        repo.revoke_admin_session(entry)


def list_admin_auth_failure_summaries() -> list[dict[str, Any]]:
    now = int(time.time())
    with session_scope() as session:
        repo = SecurityRepository(session)
        summaries: list[dict[str, Any]] = []
        for account in repo.list_admin_accounts():
            failure_bucket = repo.get_rate_limit_bucket(_admin_login_existing_username_hour_key(account.username))
            wrong_password_failures = 0
            if failure_bucket is not None and int(failure_bucket.reset_at) > now:
                wrong_password_failures = int(failure_bucket.count)

            lockout_bucket = repo.get_rate_limit_bucket(_admin_login_lockout_key(account.username))
            is_locked_out = bool(lockout_bucket is not None and int(lockout_bucket.reset_at) > now)

            summaries.append(
                {
                    "username": str(account.username),
                    "isActive": bool(account.is_active),
                    "wrongPasswordFailures": wrong_password_failures,
                    "windowSeconds": settings.admin_login_deactivate_window_seconds,
                    "lockoutThreshold": settings.admin_login_lockout_threshold,
                    "deactivationThreshold": settings.admin_login_deactivate_threshold,
                    "isLockedOut": is_locked_out,
                }
            )

        return summaries


def _admin_login_username_key(username: str) -> str:
    return f"admin_login_failed:username:{normalize_admin_username(username)}"


def _admin_login_ip_key(ip_address: str) -> str:
    return f"admin_login_failed:ip:{ip_address.strip() or 'unknown'}"


def _admin_login_username_ip_key(username: str, ip_address: str) -> str:
    return f"admin_login_failed:username_ip:{normalize_admin_username(username)}:{ip_address.strip() or 'unknown'}"


def _admin_login_lockout_key(username: str) -> str:
    return f"admin_login_lockout:{normalize_admin_username(username)}"


def _admin_login_existing_username_hour_key(username: str) -> str:
    return f"admin_login_existing_username_hour:{normalize_admin_username(username)}"


def _ensure_admin_login_not_limited(repo: SecurityRepository, username: str, ip_address: str, *, now: int) -> None:
    username_lockout = repo.get_rate_limit_bucket(_admin_login_lockout_key(username))
    if username_lockout is not None and int(username_lockout.reset_at) > now:
        raise AdminAuthRateLimitError("Too many login attempts. Please try again later.")

    username_ip_bucket = repo.get_rate_limit_bucket(_admin_login_username_ip_key(username, ip_address))
    if username_ip_bucket is not None and int(username_ip_bucket.reset_at) > now and int(username_ip_bucket.count) >= settings.admin_login_username_ip_limit:
        raise AdminAuthRateLimitError("Too many login attempts. Please try again later.")

    ip_bucket = repo.get_rate_limit_bucket(_admin_login_ip_key(ip_address))
    if ip_bucket is not None and int(ip_bucket.reset_at) > now and int(ip_bucket.count) >= settings.admin_login_ip_limit:
        raise AdminAuthRateLimitError("Too many login attempts. Please try again later.")


def _record_failed_admin_login(
    repo: SecurityRepository,
    username: str,
    ip_address: str,
    *,
    now: int,
    account: Any | None = None,
) -> Exception:
    username_count = _increment_failure_bucket(
        repo,
        _admin_login_username_key(username),
        now=now,
        window_seconds=settings.admin_login_window_seconds,
    )
    ip_count = _increment_failure_bucket(
        repo,
        _admin_login_ip_key(ip_address),
        now=now,
        window_seconds=settings.admin_login_window_seconds,
    )
    username_ip_count = _increment_failure_bucket(
        repo,
        _admin_login_username_ip_key(username, ip_address),
        now=now,
        window_seconds=settings.admin_login_window_seconds,
    )
    existing_username_hour_count: int | None = None
    if account is not None and bool(account.is_active):
        existing_username_hour_count = _increment_failure_bucket(
            repo,
            _admin_login_existing_username_hour_key(username),
            now=now,
            window_seconds=settings.admin_login_deactivate_window_seconds,
        )
    if (
        account is not None
        and bool(account.is_active)
        and existing_username_hour_count is not None
        and existing_username_hour_count >= settings.admin_login_deactivate_threshold
    ):
        account.is_active = False
        account.updated_at = now
        repo.add_admin_audit_log(
            admin_uid=None,
            admin_email=ADMIN_AUTH_AUDIT_EMAIL,
            action="admin_login_admin_deactivated",
            target_type="admin_account",
            target_id=username,
            reason="Admin account was deactivated after 30 failed login attempts within 1 hour.",
            metadata_json={
                "username": username,
                "ip": ip_address.strip() or "unknown",
                "existing_username_hour_failures": existing_username_hour_count,
                "window_seconds": settings.admin_login_deactivate_window_seconds,
                "deactivated": True,
            },
            created_at=now,
        )
        return AdminAuthRateLimitError("Too many login attempts. Please try again later.")
    if (
        username_count >= settings.admin_login_lockout_threshold
        or username_ip_count >= settings.admin_login_username_ip_limit
    ):
        repo.upsert_rate_limit_bucket(
            _admin_login_lockout_key(username),
            username_count,
            now + settings.admin_login_lockout_seconds,
        )
        repo.add_admin_audit_log(
            admin_uid=None,
            admin_email=ADMIN_AUTH_AUDIT_EMAIL,
            action="admin_login_lockout",
            target_type="admin_account",
            target_id=username,
            reason="Admin login lockout triggered after repeated failed attempts.",
            metadata_json={
                "username": username,
                "ip": ip_address.strip() or "unknown",
                "username_failures": username_count,
                "username_ip_failures": username_ip_count,
                "lockout_seconds": settings.admin_login_lockout_seconds,
            },
            created_at=now,
        )
        return AdminAuthRateLimitError("Too many login attempts. Please try again later.")
    if ip_count >= settings.admin_login_ip_limit:
        repo.add_admin_audit_log(
            admin_uid=None,
            admin_email=ADMIN_AUTH_AUDIT_EMAIL,
            action="admin_login_lockout",
            target_type="admin_account",
            target_id=username,
            reason="Admin login IP limit triggered after repeated failed attempts.",
            metadata_json={
                "username": username,
                "ip": ip_address.strip() or "unknown",
                "ip_failures": ip_count,
                "lockout_seconds": settings.admin_login_window_seconds,
            },
            created_at=now,
        )
        return AdminAuthRateLimitError("Too many login attempts. Please try again later.")
    return ValueError("Invalid username or password")


def _clear_failed_admin_login_state(repo: SecurityRepository, username: str, ip_address: str) -> None:
    repo.delete_rate_limit_bucket(_admin_login_username_key(username))
    if ip_address.strip():
        repo.delete_rate_limit_bucket(_admin_login_ip_key(ip_address))
        repo.delete_rate_limit_bucket(_admin_login_username_ip_key(username, ip_address))
    else:
        repo.delete_rate_limit_buckets_by_prefix(f"admin_login_failed:username_ip:{normalize_admin_username(username)}:")
    repo.delete_rate_limit_bucket(_admin_login_lockout_key(username))
    repo.delete_rate_limit_bucket(_admin_login_existing_username_hour_key(username))


def _increment_failure_bucket(repo: SecurityRepository, key: str, *, now: int, window_seconds: int) -> int:
    bucket = repo.get_rate_limit_bucket_for_update(key)
    if bucket is None or int(bucket.reset_at) <= now:
        repo.upsert_rate_limit_bucket(key, 1, now + window_seconds)
        return 1

    bucket.count += 1
    bucket.updated_at = now
    repo.session.flush()
    return int(bucket.count)
