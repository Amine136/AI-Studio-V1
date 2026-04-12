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
    return hashlib.sha256(secret + token.encode("utf-8")).hexdigest()


def _admin_account_dict(account: Any) -> dict[str, Any]:
    return {
        "id": str(account.id),
        "username": str(account.username),
        "isActive": bool(account.is_active),
        "createdAt": int(account.created_at),
        "updatedAt": int(account.updated_at),
        "lastLoginAt": int(account.last_login_at) if account.last_login_at is not None else None,
    }


def _admin_session_dict(entry: Any) -> dict[str, Any]:
    account = entry.admin_account
    return {
        "sessionId": str(entry.id),
        "username": str(account.username),
        "adminId": str(account.id),
        "createdAt": int(entry.created_at),
        "expiresAt": int(entry.expires_at),
        "account": _admin_account_dict(account),
    }


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


def authenticate_admin(username: str, password: str) -> tuple[str, dict[str, Any]]:
    normalized_username = normalize_admin_username(username)
    if not normalized_username or not password:
        raise ValueError("Invalid username or password")

    now = int(time.time())
    with session_scope() as session:
        repo = SecurityRepository(session)
        account = repo.get_admin_account_by_username_for_update(normalized_username)
        if account is None or not bool(account.is_active):
            raise ValueError("Invalid username or password")
        if not verify_admin_password(password, account.password_hash):
            raise ValueError("Invalid username or password")

        account.last_login_at = now
        account.updated_at = now
        token = secrets.token_urlsafe(48)
        entry = repo.create_admin_session(
            account.id,
            _hash_admin_session_token(token),
            now + settings.admin_session_ttl_seconds,
        )
        entry.admin_account = account
        return token, _admin_session_dict(entry)


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

        repo.touch_admin_session(entry, refreshed_at=now)
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
