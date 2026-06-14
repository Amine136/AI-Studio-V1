from __future__ import annotations

import hashlib
import secrets
import time
import uuid
import re
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy.exc import IntegrityError

from app.config import settings
from app.db.repositories import SecurityRepository
from app.db.session import session_scope

CREDIT_SCALE = 100
CHAT_COST_SCALE = 1_000_000
CODE_PREFIX = "VC-"
CODE_BODY_LENGTH = 30
SYSTEM_AUDIT_EMAIL = "system@vibecraft.local"
AUTO_SUSPEND_AUDIT_EMAIL = "policy@vibecraft.local"
USAGE_CAP_REASONS = ["smart_analysis_charge", "smart_analysis_reserve"]
PROFILE_USERNAME_ALLOWED_RE = re.compile(r"[^a-z0-9._-]+")
PROFILE_USERNAME_MAX_LENGTH = 15
PROFILE_BIO_MAX_LENGTH = 500
PROFILE_CHANGE_LIMIT_PER_MONTH = 2
PROFILE_SAVE_ATTEMPT_LIMIT_PER_DAY = 10


def preload_postgres() -> None:
    # Opening and closing a session eagerly verifies that DATABASE_URL is usable.
    with session_scope():
        return


def ensure_user(uid: str, email: str, display_name: str) -> dict[str, Any]:
    with session_scope() as session:
        repo = SecurityRepository(session)
        user = repo.ensure_user(uid, email, display_name)
        return _user_dict_from_model(user)


def is_email_deactivated(email: str) -> dict[str, Any] | None:
    normalized = str(email or "").strip().lower()
    if not normalized:
        return None
    with session_scope() as session:
        repo = SecurityRepository(session)
        entry = repo.get_deactivated_email(normalized)
        if entry is None:
            return None
        return {
            "email": entry.email,
            "originalUid": entry.original_uid,
            "deactivatedAt": entry.deactivated_at,
            "reason": entry.reason or "",
        }


def get_user(uid: str) -> dict[str, Any]:
    now = int(time.time())
    with session_scope() as session:
        repo = SecurityRepository(session)
        user = repo.get_user(uid)
        if user is None:
            return {
                "uid": uid,
                "email": "",
                "displayName": "",
                "username": "",
                "bio": "",
                "credits": 0.0,
                "profileChangesRemaining": PROFILE_CHANGE_LIMIT_PER_MONTH,
                "profileChangesResetAt": None,
            }
        # Read-only fast path: only take a row lock + write a sweep when there is
        # actually something due to expire. Keeps this hot GET lock/write-free
        # in the common case (and un-spammable as a side-effecting endpoint).
        if repo.has_due_expiry(uid, now):
            user = repo.get_user_for_update(uid)
            _sweep_user_lots(repo, user, now)
            session.flush()
        return _user_dict_from_model(user)


def get_credit_breakdown(uid: str) -> dict[str, Any]:
    """Per-lot view of a user's spendable balance for the credits page: total
    available, own (non-expiring) credits, and each gift lot with its expiry.
    Sweeps expired lots first so the numbers match the displayed balance."""
    now = int(time.time())
    with session_scope() as session:
        repo = SecurityRepository(session)
        user = repo.get_user(uid)
        if user is None:
            return {"available": 0.0, "own": 0.0, "reserved": 0.0, "gifts": []}
        # Read-only unless something is actually due to expire (see get_user).
        if repo.has_due_expiry(uid, now):
            user = repo.get_user_for_update(uid)
            _sweep_user_lots(repo, user, now)
            session.flush()

        own_minor = 0
        gifts: list[dict[str, Any]] = []
        for lot in repo.list_spendable_lots(uid):
            if lot.expires_at is None:
                own_minor += int(lot.remaining_minor)
            else:
                gifts.append(
                    {
                        "credits": _minor_to_credits(int(lot.remaining_minor)),
                        "expiresAt": int(lot.expires_at),
                        "source": lot.source,
                    }
                )
        gifts.sort(key=lambda g: g["expiresAt"])
        return {
            "available": _minor_to_credits(int(user.credits_minor)),
            "own": _minor_to_credits(own_minor),
            "reserved": _minor_to_credits(int(user.reserved_credits_minor)),
            "gifts": gifts,
        }


def sweep_user_expired_credits(uid: str) -> int:
    """Expire any past-due gift lots for a single user. Returns minor expired."""
    now = int(time.time())
    with session_scope() as session:
        repo = SecurityRepository(session)
        user = repo.get_user_for_update(uid)
        if user is None:
            return 0
        expired = _sweep_user_lots(repo, user, now)
        session.flush()
        return expired


def sweep_all_expired_credits(limit: int = 1000) -> dict[str, int]:
    """Expire past-due gift lots across all users (nightly hygiene / reporting).
    Each user is swept in its own transaction to keep locks short."""
    now = int(time.time())
    with session_scope() as session:
        repo = SecurityRepository(session)
        uids = list(repo.list_uids_with_expired_lots(now, limit=limit))

    total_expired = 0
    users_affected = 0
    for uid in uids:
        expired = sweep_user_expired_credits(uid)
        if expired > 0:
            users_affected += 1
            total_expired += expired
    return {"scanned": len(uids), "users": users_affected, "expired_minor": total_expired}


def get_profile_change_status(uid: str) -> dict[str, Any]:
    now = int(time.time())
    key, reset_at = _profile_change_bucket_key(uid, now)
    with session_scope() as session:
        repo = SecurityRepository(session)
        bucket = repo.get_rate_limit_bucket(key)
        if bucket is None or int(bucket.reset_at) <= now:
            used = 0
        else:
            used = max(0, int(bucket.count))
            reset_at = int(bucket.reset_at)
    return {
        "profileChangesRemaining": max(0, PROFILE_CHANGE_LIMIT_PER_MONTH - used),
        "profileChangesResetAt": reset_at,
    }


def update_user_profile(uid: str, *, username: str, bio: str) -> dict[str, Any]:
    normalized_username = _normalize_profile_username(username)
    normalized_bio = _normalize_profile_bio(bio)
    if not normalized_username:
        raise ValueError("PROFILE_USERNAME_REQUIRED")

    now = int(time.time())
    key, reset_at = _profile_change_bucket_key(uid, now)

    _record_profile_save_attempt(uid, now)

    with session_scope() as session:
        repo = SecurityRepository(session)
        user = repo.get_user_for_update(uid)
        if user is None:
            user = repo.ensure_user(uid, "", "")
            session.flush()

        if normalized_username == str(user.username or "") and normalized_bio == str(user.bio or ""):
            result = _user_dict_from_model(user)
            result.update(_profile_change_status_from_bucket(repo.get_rate_limit_bucket(key), now, reset_at))
            return result

        existing_user = repo.get_user_by_username(normalized_username)
        if existing_user is not None and str(existing_user.uid) != str(uid):
            raise ValueError("PROFILE_USERNAME_TAKEN")

        bucket = repo.get_rate_limit_bucket_for_update(key)
        if bucket is None or int(bucket.reset_at) <= now:
            repo.upsert_rate_limit_bucket(key, 1, reset_at)
            used = 1
        else:
            if int(bucket.count) >= PROFILE_CHANGE_LIMIT_PER_MONTH:
                raise ValueError("PROFILE_UPDATE_LIMIT")
            bucket.count += 1
            bucket.updated_at = now
            session.flush()
            used = int(bucket.count)

        try:
            repo.update_user_profile(user, username=normalized_username, bio=normalized_bio, updated_at=now)
        except IntegrityError as exc:
            raise ValueError("PROFILE_USERNAME_TAKEN") from exc
        result = _user_dict_from_model(user)
        result.update(
            {
                "profileChangesRemaining": max(0, PROFILE_CHANGE_LIMIT_PER_MONTH - used),
                "profileChangesResetAt": reset_at,
            }
        )
        return result


def update_user_notification_preferences(
    uid: str,
    *,
    email_general_news_enabled: bool,
    email_platform_updates_enabled: bool,
) -> dict[str, Any]:
    now = int(time.time())
    with session_scope() as session:
        repo = SecurityRepository(session)
        user = repo.get_user_for_update(uid)
        if user is None:
            user = repo.ensure_user(uid, "", "")
            session.flush()
        repo.update_user_notification_preferences(
            user,
            email_general_news_enabled=email_general_news_enabled,
            email_platform_updates_enabled=email_platform_updates_enabled,
            updated_at=now,
        )
        result = _user_dict_from_model(user)
        result.update(get_profile_change_status(uid))
        return result


def deactivate_user_account(uid: str) -> dict[str, Any]:
    now = int(time.time())
    reason = "Account deactivated by the user. Access has been permanently disabled."
    with session_scope() as session:
        repo = SecurityRepository(session)
        user = repo.get_user_for_update(uid)
        if user is None:
            user = repo.ensure_user(uid, "", "")
            session.flush()
        if bool(user.is_deactivated):
            return _user_dict_from_model(user)
        repo.deactivate_user(user, reason=reason, updated_at=now)
        if str(user.email or "").strip():
            repo.upsert_deactivated_email(
                email=str(user.email),
                original_uid=user.uid,
                deactivated_at=now,
                reason=reason,
            )
        repo.add_admin_audit_log(
            admin_uid=uid,
            admin_email=user.email or SYSTEM_AUDIT_EMAIL,
            action="user_self_deactivate",
            target_type="user",
            target_id=uid,
            reason=reason,
            metadata_json={"uid": uid, "self_serve": True},
            created_at=now,
        )
        return _user_dict_from_model(user)


def list_users() -> list[dict[str, Any]]:
    with session_scope() as session:
        repo = SecurityRepository(session)
        return [_user_dict_from_model(user) for user in repo.list_users()]


def search_users(query: str = "", limit: int = 100) -> list[dict[str, Any]]:
    users, _total = search_users_with_total(query, limit)
    return users


def search_users_with_total(query: str = "", limit: int = 100) -> tuple[list[dict[str, Any]], int]:
    normalized_query = query.strip().lower()
    bounded_limit = min(max(int(limit), 1), 200)
    users = [_with_active_suspension_state(user) for user in list_users()]
    if normalized_query:
        users = [
            user
            for user in users
            if normalized_query in str(user.get("email", "")).lower()
            or normalized_query in str(user.get("displayName", "")).lower()
            or normalized_query in str(user.get("uid", "")).lower()
        ]
    return users[:bounded_limit], len(users)


def get_admin_user_detail(uid: str) -> dict[str, Any] | None:
    with session_scope() as session:
        repo = SecurityRepository(session)
        user = repo.get_user(uid)
        if user is None:
            return None
        return _with_active_suspension_state(_user_dict_from_model(user))


def suspend_user(
    uid: str,
    *,
    reason: str,
    admin_uid: str | None,
    admin_email: str,
) -> dict[str, Any]:
    normalized_reason = reason.strip()
    if not normalized_reason:
        raise ValueError("Reason is required")

    now = int(time.time())
    with session_scope() as session:
        repo = SecurityRepository(session)
        user = repo.get_user_for_update(uid)
        if user is None:
            raise ValueError("USER_NOT_FOUND")

        user.is_suspended = True
        user.suspension_reason = normalized_reason
        user.updated_at = now

        repo.add_admin_audit_log(
            admin_uid=admin_uid,
            admin_email=admin_email.strip(),
            action="user_suspend",
            target_type="user",
            target_id=uid,
            reason=normalized_reason,
            metadata_json={"suspension_reason": normalized_reason},
            created_at=now,
        )
        session.flush()
        return _user_dict_from_model(user)


def unsuspend_user(
    uid: str,
    *,
    reason: str,
    admin_uid: str | None,
    admin_email: str,
) -> dict[str, Any]:
    normalized_reason = reason.strip()
    if not normalized_reason:
        raise ValueError("Reason is required")

    now = int(time.time())
    with session_scope() as session:
        repo = SecurityRepository(session)
        user = repo.get_user_for_update(uid)
        if user is None:
            raise ValueError("USER_NOT_FOUND")

        previous_reason = user.suspension_reason or ""
        user.is_suspended = False
        user.suspension_reason = None
        user.updated_at = now
        repo.delete_rate_limit_bucket(_redeem_temp_suspension_key(uid))
        repo.delete_rate_limit_bucket(_redeem_failed_window_key(uid))
        repo.delete_rate_limit_bucket(_redeem_cooldown_key(uid))
        repo.delete_rate_limit_bucket(_redeem_consecutive_failures_key(uid))

        repo.add_admin_audit_log(
            admin_uid=admin_uid,
            admin_email=admin_email.strip(),
            action="user_unsuspend",
            target_type="user",
            target_id=uid,
            reason=normalized_reason,
            metadata_json={"previous_suspension_reason": previous_reason},
            created_at=now,
        )
        session.flush()
        result = _user_dict_from_model(user)
        result["activeSuspensionUntil"] = None
        result["activeSuspensionIsPermanent"] = False
        return result


def add_admin_audit_log(
    *,
    admin_uid: str | None,
    admin_email: str,
    action: str,
    target_type: str,
    target_id: str,
    reason: str,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    normalized_reason = reason.strip()
    if not normalized_reason:
        raise ValueError("Reason is required")

    with session_scope() as session:
        repo = SecurityRepository(session)
        entry = repo.add_admin_audit_log(
            admin_uid=admin_uid,
            admin_email=admin_email.strip(),
            action=action.strip(),
            target_type=target_type.strip(),
            target_id=target_id.strip(),
            reason=normalized_reason,
            metadata_json=metadata or {},
        )
        return _admin_audit_log_dict_from_model(entry)


def list_admin_audit_logs(
    limit: int = 50,
    *,
    admin_uid: str = "",
    action: str = "",
    target_type: str = "",
    target_id: str = "",
) -> list[dict[str, Any]]:
    bounded_limit = min(max(int(limit), 1), 200)
    normalized_admin_uid = admin_uid.strip() or None
    normalized_action = action.strip() or None
    normalized_target_type = target_type.strip() or None
    normalized_target_id = target_id.strip() or None
    with session_scope() as session:
        repo = SecurityRepository(session)
        return [
            _admin_audit_log_dict_from_model(entry)
            for entry in repo.list_admin_audit_logs(
                bounded_limit,
                admin_uid=normalized_admin_uid,
                action=normalized_action,
                target_type=normalized_target_type,
                target_id=normalized_target_id,
                exclude_admin_email=SYSTEM_AUDIT_EMAIL,
            )
        ]


def list_dashboard_news_items(*, active_only: bool = False) -> list[dict[str, Any]]:
    with session_scope() as session:
        repo = SecurityRepository(session)
        return [_dashboard_news_dict_from_model(item) for item in repo.list_dashboard_news_items(active_only=active_only)]


def create_dashboard_news_item(
    *,
    badge: str,
    when_label: str,
    title: str,
    title_fr: str = "",
    title_ar: str = "",
    description: str,
    description_fr: str = "",
    description_ar: str = "",
    link_label: str,
    link_label_fr: str = "",
    link_label_ar: str = "",
    link_href: str,
    tone: str,
    sort_order: int,
    is_active: bool,
    admin_uid: str | None,
    admin_email: str,
) -> dict[str, Any]:
    now = int(time.time())
    with session_scope() as session:
        repo = SecurityRepository(session)
        item = repo.create_dashboard_news_item(
            badge=badge,
            when_label=when_label,
            title=title,
            title_fr=title_fr,
            title_ar=title_ar,
            description=description,
            description_fr=description_fr,
            description_ar=description_ar,
            link_label=link_label,
            link_label_fr=link_label_fr,
            link_label_ar=link_label_ar,
            link_href=link_href,
            tone=tone,
            sort_order=sort_order,
            is_active=is_active,
        )
        repo.add_admin_audit_log(
            admin_uid=admin_uid,
            admin_email=admin_email.strip(),
            action="dashboard_news_create",
            target_type="dashboard_news",
            target_id=item.id,
            reason=f"Created dashboard news item '{title}'.",
            metadata_json={"title": title, "tone": tone, "is_active": bool(is_active), "sort_order": int(sort_order)},
            created_at=now,
        )
        return _dashboard_news_dict_from_model(item)


def update_dashboard_news_item(
    item_id: str,
    *,
    badge: str,
    when_label: str,
    title: str,
    title_fr: str = "",
    title_ar: str = "",
    description: str,
    description_fr: str = "",
    description_ar: str = "",
    link_label: str,
    link_label_fr: str = "",
    link_label_ar: str = "",
    link_href: str,
    tone: str,
    sort_order: int,
    is_active: bool,
    admin_uid: str | None,
    admin_email: str,
) -> dict[str, Any]:
    now = int(time.time())
    with session_scope() as session:
        repo = SecurityRepository(session)
        item = repo.get_dashboard_news_item_for_update(item_id)
        if item is None:
            raise ValueError("DASHBOARD_NEWS_NOT_FOUND")
        repo.update_dashboard_news_item(
            item,
            badge=badge,
            when_label=when_label,
            title=title,
            title_fr=title_fr,
            title_ar=title_ar,
            description=description,
            description_fr=description_fr,
            description_ar=description_ar,
            link_label=link_label,
            link_label_fr=link_label_fr,
            link_label_ar=link_label_ar,
            link_href=link_href,
            tone=tone,
            sort_order=sort_order,
            is_active=is_active,
        )
        repo.add_admin_audit_log(
            admin_uid=admin_uid,
            admin_email=admin_email.strip(),
            action="dashboard_news_update",
            target_type="dashboard_news",
            target_id=item.id,
            reason=f"Updated dashboard news item '{title}'.",
            metadata_json={"title": title, "tone": tone, "is_active": bool(is_active), "sort_order": int(sort_order)},
            created_at=now,
        )
        return _dashboard_news_dict_from_model(item)


def delete_dashboard_news_item(
    item_id: str,
    *,
    admin_uid: str | None,
    admin_email: str,
) -> None:
    now = int(time.time())
    with session_scope() as session:
        repo = SecurityRepository(session)
        item = repo.get_dashboard_news_item_for_update(item_id)
        if item is None:
            raise ValueError("DASHBOARD_NEWS_NOT_FOUND")
        title = item.title
        repo.delete_dashboard_news_item(item)
        repo.add_admin_audit_log(
            admin_uid=admin_uid,
            admin_email=admin_email.strip(),
            action="dashboard_news_delete",
            target_type="dashboard_news",
            target_id=item_id,
            reason=f"Deleted dashboard news item '{title}'.",
            metadata_json={"title": title},
            created_at=now,
        )


def adjust_credits(
    uid: str,
    delta: float,
    reason: str,
    actor_uid: str | None = None,
    metadata: dict[str, Any] | None = None,
    allow_negative: bool = False,
) -> dict[str, Any]:
    delta_minor = _credits_to_minor(delta)
    now = int(time.time())

    with session_scope() as session:
        repo = SecurityRepository(session)
        user = repo.get_user_for_update(uid)
        if user is None:
            user = repo.ensure_user(uid, "", "")
            session.flush()
        _sweep_user_lots(repo, user, now)

        # Positive adjustments create a non-expiring lot (admin grants / top-ups).
        # Negative adjustments (incl. plain-chat charges) consume gift-first.
        # `allow_negative` can no longer drive the balance below zero (lots can't
        # be negative); it instead floors the charge at the available balance.
        if delta_minor > 0:
            _credit_lot(repo, user, delta_minor, now, source="admin_grant", expires_at=None)
            applied_delta_minor = delta_minor
        elif delta_minor < 0:
            debited, _funding = _debit_across_lots(
                repo, user, -delta_minor, now, floor_at_zero=allow_negative
            )
            applied_delta_minor = -debited
        else:
            applied_delta_minor = 0

        user.updated_at = now
        user.last_seen_at = now

        ledger_metadata = dict(metadata or {})
        if not ledger_metadata.get("activity_id"):
            ledger_metadata = _with_activity_metadata(
                ledger_metadata,
                activity_id=f"{reason}:{uuid.uuid4()}",
                activity_type=str(reason or "credit_adjustment"),
                activity_label=str(reason or "Credit Adjustment").replace("_", " ").title(),
            )

        repo.add_ledger_entry(
            uid=uid,
            delta_minor=applied_delta_minor,
            reason=reason,
            actor_uid=actor_uid,
            metadata_json=ledger_metadata,
            created_at=now,
        )
        session.flush()
        return _user_dict_from_model(user)


def _normalize_validity_seconds(validity_seconds: int | None) -> int | None:
    """Coerce an admin-supplied validity window to a positive int or None."""
    if validity_seconds is None:
        return None
    value = int(validity_seconds)
    return value if value > 0 else None


def create_credit_code(
    credits: float,
    max_claims: int,
    created_by: str,
    validity_seconds: int | None = None,
) -> dict[str, Any]:
    credits_minor = _credits_to_minor(credits)
    if credits_minor <= 0:
        raise ValueError("Credits must be positive")
    if max_claims <= 0:
        raise ValueError("Max claims must be positive")
    validity = _normalize_validity_seconds(validity_seconds)

    raw_code = _generate_code()
    code_hash = hash_credit_code(raw_code)
    code_preview = _preview_code(raw_code)

    with session_scope() as session:
        repo = SecurityRepository(session)
        code = repo.create_credit_code(
            code_hash, code_preview, credits_minor, max_claims, created_by,
            validity_seconds=validity,
        )
        return {
            "code": raw_code,
            "codePreview": code.code_preview,
            "credits": _minor_to_credits(code.credits_minor),
            "maxClaims": code.max_claims,
            "claimedCount": code.claimed_count,
            "createdAt": code.created_at,
            "createdBy": code.created_by,
            "validitySeconds": code.validity_seconds,
        }


def create_credit_code_batch(quantity: int, credits: float, created_by: str) -> list[dict[str, Any]]:
    return create_credit_code_batch_with_title(quantity, credits, created_by, "")


def create_credit_code_batch_with_title(
    quantity: int,
    credits: float,
    created_by: str,
    title: str,
    validity_seconds: int | None = None,
) -> list[dict[str, Any]]:
    bounded_quantity = int(quantity)
    credits_minor = _credits_to_minor(credits)
    normalized_title = title.strip()
    if bounded_quantity <= 0:
        raise ValueError("Quantity must be positive")
    if credits_minor <= 0:
        raise ValueError("Credits must be positive")
    validity = _normalize_validity_seconds(validity_seconds)
    batch_id = str(uuid.uuid4()) if normalized_title else None

    with session_scope() as session:
        repo = SecurityRepository(session)
        created_codes: list[dict[str, Any]] = []
        for _ in range(bounded_quantity):
            raw_code = _generate_code()
            code_hash = hash_credit_code(raw_code)
            code_preview = _preview_code(raw_code)
            code = repo.create_credit_code_with_batch(
                code_hash,
                code_preview,
                credits_minor,
                1,
                created_by,
                batch_id=batch_id,
                batch_title=normalized_title or None,
                validity_seconds=validity,
            )
            created_codes.append(
                {
                    "code": raw_code,
                    "codePreview": code.code_preview,
                    "credits": _minor_to_credits(code.credits_minor),
                    "maxClaims": code.max_claims,
                    "claimedCount": code.claimed_count,
                    "createdAt": code.created_at,
                    "createdBy": code.created_by,
                    "batchId": code.batch_id,
                    "batchTitle": code.batch_title,
                    "validitySeconds": code.validity_seconds,
                }
            )
        return created_codes


def list_credit_codes() -> list[dict[str, Any]]:
    with session_scope() as session:
        repo = SecurityRepository(session)
        return [_credit_code_dict_from_model(code) for code in repo.list_credit_codes()]


def list_gift_code_status_summaries() -> list[dict[str, Any]]:
    with session_scope() as session:
        repo = SecurityRepository(session)
        rows = repo.summarize_gift_codes_by_status(int(time.time()))
        return [
            {
                "status": str(row.get("status") or "active"),
                "codeCount": int(row.get("code_count") or 0),
                "totalCredits": _minor_to_credits(int(row.get("total_credits_minor") or 0)),
                "averageCredits": _minor_to_credits(int(round(float(row.get("average_credits_minor") or 0)))),
            }
            for row in rows
        ]


def list_credit_code_batches() -> list[dict[str, Any]]:
    batches: dict[str, dict[str, Any]] = {}
    for code in list_credit_codes():
        batch_id = str(code.get("batchId") or "").strip()
        if not batch_id:
            continue

        batch = batches.get(batch_id)
        if batch is None:
            batch = {
                "batchId": batch_id,
                "title": code.get("batchTitle") or "Untitled batch",
                "credits": code.get("credits", 0.0),
                "totalCodes": 0,
                "claimedCodes": 0,
                "activeCodes": 0,
                "status": "active",
                "createdAt": code.get("createdAt"),
            }
            batches[batch_id] = batch

        batch["totalCodes"] += 1
        if int(code.get("claimedCount", 0)) > 0:
            batch["claimedCodes"] += 1
        if str(code.get("status", "")) == "active":
            batch["activeCodes"] += 1
        created_at = code.get("createdAt")
        if batch["createdAt"] is None or (created_at is not None and int(created_at) < int(batch["createdAt"])):
            batch["createdAt"] = created_at

    for batch in batches.values():
        if int(batch["claimedCodes"]) >= int(batch["totalCodes"]):
            batch["status"] = "claimed"
        elif int(batch["activeCodes"]) == 0:
            batch["status"] = "inactive"
        else:
            batch["status"] = "active"

    return sorted(batches.values(), key=lambda item: int(item.get("createdAt") or 0), reverse=True)


def list_credit_code_batch_status_summaries() -> list[dict[str, Any]]:
    summaries: dict[str, dict[str, Any]] = {}
    for batch in list_credit_code_batches():
        status = str(batch.get("status") or "active")
        summary = summaries.get(status)
        if summary is None:
            summary = {
                "status": status,
                "codeCount": 0,
                "totalCredits": 0.0,
            }
            summaries[status] = summary

        batch_code_count = int(batch.get("totalCodes") or 0)
        batch_credits = float(batch.get("credits") or 0.0)
        summary["codeCount"] += batch_code_count
        summary["totalCredits"] += batch_credits * batch_code_count

    results: list[dict[str, Any]] = []
    for status, summary in summaries.items():
        code_count = int(summary.get("codeCount") or 0)
        total_credits = float(summary.get("totalCredits") or 0.0)
        results.append(
            {
                "status": status,
                "codeCount": code_count,
                "totalCredits": round(total_credits, 2),
                "averageCredits": round(total_credits / code_count, 2) if code_count > 0 else 0.0,
            }
        )
    return results


def get_credit_code(code: str) -> dict[str, Any] | None:
    with session_scope() as session:
        repo = SecurityRepository(session)
        credit_code = repo.get_credit_code(hash_credit_code(code))
        if credit_code is None:
            return None
        return _credit_code_dict_from_model(credit_code)


def disable_credit_code(
    code_hash: str,
    *,
    reason: str,
    admin_uid: str | None,
    admin_email: str,
) -> dict[str, Any]:
    normalized_reason = reason.strip()
    if not normalized_reason:
        raise ValueError("Reason is required")

    now = int(time.time())
    with session_scope() as session:
        repo = SecurityRepository(session)
        credit_code = repo.get_credit_code_for_update(code_hash)
        if credit_code is None:
            raise ValueError("CODE_NOT_FOUND")

        credit_code.is_active = False
        repo.add_admin_audit_log(
            admin_uid=admin_uid,
            admin_email=admin_email.strip(),
            action="credit_code_disable",
            target_type="credit_code",
            target_id=code_hash,
            reason=normalized_reason,
            metadata_json={"code_preview": credit_code.code_preview},
            created_at=now,
        )
        session.flush()
        return _credit_code_dict_from_model(credit_code)


def enable_credit_code(
    code_hash: str,
    *,
    reason: str,
    admin_uid: str | None,
    admin_email: str,
) -> dict[str, Any]:
    normalized_reason = reason.strip()
    if not normalized_reason:
        raise ValueError("Reason is required")

    now = int(time.time())
    with session_scope() as session:
        repo = SecurityRepository(session)
        credit_code = repo.get_credit_code_for_update(code_hash)
        if credit_code is None:
            raise ValueError("CODE_NOT_FOUND")

        credit_code.is_active = True
        repo.add_admin_audit_log(
            admin_uid=admin_uid,
            admin_email=admin_email.strip(),
            action="credit_code_enable",
            target_type="credit_code",
            target_id=code_hash,
            reason=normalized_reason,
            metadata_json={"code_preview": credit_code.code_preview},
            created_at=now,
        )
        session.flush()
        return _credit_code_dict_from_model(credit_code)


def disable_credit_code_batch(
    batch_id: str,
    *,
    reason: str,
    admin_uid: str | None,
    admin_email: str,
) -> dict[str, Any]:
    normalized_reason = reason.strip()
    if not normalized_reason:
        raise ValueError("Reason is required")

    now = int(time.time())
    with session_scope() as session:
        repo = SecurityRepository(session)
        credit_codes = repo.list_credit_codes_by_batch_for_update(batch_id)
        if not credit_codes:
            raise ValueError("BATCH_NOT_FOUND")

        for credit_code in credit_codes:
            credit_code.is_active = False

        repo.add_admin_audit_log(
            admin_uid=admin_uid,
            admin_email=admin_email.strip(),
            action="credit_code_batch_disable",
            target_type="credit_code_batch",
            target_id=batch_id,
            reason=normalized_reason,
            metadata_json={
                "batch_title": credit_codes[0].batch_title,
                "code_count": len(credit_codes),
            },
            created_at=now,
        )
        session.flush()
    return next((batch for batch in list_credit_code_batches() if batch.get("batchId") == batch_id), {
        "batchId": batch_id,
        "status": "inactive",
    })


def enable_credit_code_batch(
    batch_id: str,
    *,
    reason: str,
    admin_uid: str | None,
    admin_email: str,
) -> dict[str, Any]:
    normalized_reason = reason.strip()
    if not normalized_reason:
        raise ValueError("Reason is required")

    now = int(time.time())
    with session_scope() as session:
        repo = SecurityRepository(session)
        credit_codes = repo.list_credit_codes_by_batch_for_update(batch_id)
        if not credit_codes:
            raise ValueError("BATCH_NOT_FOUND")

        for credit_code in credit_codes:
            credit_code.is_active = True

        repo.add_admin_audit_log(
            admin_uid=admin_uid,
            admin_email=admin_email.strip(),
            action="credit_code_batch_enable",
            target_type="credit_code_batch",
            target_id=batch_id,
            reason=normalized_reason,
            metadata_json={
                "batch_title": credit_codes[0].batch_title,
                "code_count": len(credit_codes),
            },
            created_at=now,
        )
        session.flush()
    return next((batch for batch in list_credit_code_batches() if batch.get("batchId") == batch_id), {
        "batchId": batch_id,
        "status": "active",
    })


def redeem_credit_code(code: str, uid: str) -> dict[str, Any]:
    normalized = code.strip().upper()
    code_hash = hash_credit_code(normalized)
    now = int(time.time())

    with session_scope() as session:
        repo = SecurityRepository(session)
        cooldown_bucket = repo.get_rate_limit_bucket(_redeem_cooldown_key(uid))
        if cooldown_bucket is not None and int(cooldown_bucket.reset_at) > now:
            return {
                "success": False,
                "message": (
                    f"This account reached {settings.redeem_failed_attempt_limit} failed credit code attempts in "
                    f"{_minutes_label(settings.redeem_failed_attempt_window_seconds)}. Please wait about "
                    f"{_minutes_label(settings.redeem_failed_cooldown_seconds)} before trying again and review the usage policy."
                ),
            }
        credit_code = repo.get_credit_code_for_update(code_hash)
        if credit_code is None:
            return _handle_failed_redeem_attempt(repo, uid, now, "Invalid code. Please check and try again.")
        if not credit_code.is_active:
            return _handle_failed_redeem_attempt(repo, uid, now, "This code is no longer active.")
        if credit_code.expires_at is not None and int(credit_code.expires_at) <= now:
            return _handle_failed_redeem_attempt(repo, uid, now, "This code has expired.")
        if repo.get_credit_claim(code_hash, uid) is not None:
            return _handle_failed_redeem_attempt(repo, uid, now, "You have already used this code.")
        if credit_code.claimed_count >= credit_code.max_claims:
            return _handle_failed_redeem_attempt(repo, uid, now, "This code has expired (max claims reached).")
        day_claims = repo.count_credit_claims_since(uid, since_ts=now - (24 * 60 * 60))
        if day_claims >= settings.max_redeemed_codes_per_day:
            return {
                "success": False,
                "message": "This account reached the daily credit-code redemption limit. Please try again tomorrow.",
            }
        week_claims = repo.count_credit_claims_since(uid, since_ts=now - (7 * 24 * 60 * 60))
        if week_claims >= settings.max_redeemed_codes_per_week:
            return {
                "success": False,
                "message": "This account reached the weekly credit-code redemption limit. Please try again later.",
            }

        user = repo.get_user_for_update(uid)
        if user is None:
            user = repo.ensure_user(uid, "", "")
        _sweep_user_lots(repo, user, now)

        # Validity window for the redeemed credits. The code's own
        # validity_seconds wins; otherwise fall back to the (optional) global
        # default. NULL/0 => the gift credits never expire.
        validity_seconds = credit_code.validity_seconds
        if validity_seconds is None:
            default_validity = int(getattr(settings, "default_gift_validity_seconds", 0) or 0)
            validity_seconds = default_validity if default_validity > 0 else None
        gift_expires_at = (now + int(validity_seconds)) if validity_seconds else None

        credit_code.claimed_count += 1
        lot = _credit_lot(
            repo,
            user,
            credit_code.credits_minor,
            now,
            source="gift",
            expires_at=gift_expires_at,
            code_hash=code_hash,
        )
        user.updated_at = now
        user.last_seen_at = now

        repo.add_credit_claim(code_hash, uid, claimed_at=now)
        repo.add_ledger_entry(
            uid=uid,
            delta_minor=credit_code.credits_minor,
            reason="credit_code_redeem",
            actor_uid=uid,
            metadata_json=_with_activity_metadata(
                {
                    "code_preview": credit_code.code_preview,
                    "lot_id": lot.id,
                    "expires_at": gift_expires_at,
                    "validity_seconds": validity_seconds,
                },
                activity_id=f"credit_code_redeem:{code_hash}:{uid}",
                activity_type="credit_code_redeem",
                activity_label="Credit Redeem",
            ),
            code_hash=code_hash,
            created_at=now,
        )
        repo.delete_rate_limit_bucket(_redeem_failed_window_key(uid))
        repo.delete_rate_limit_bucket(_redeem_cooldown_key(uid))
        repo.delete_rate_limit_bucket(_redeem_consecutive_failures_key(uid))
        session.flush()

        credits = _minor_to_credits(credit_code.credits_minor)
        message = f"+{credits:g} credit{'s' if credits != 1 else ''} added to your account!"
        if validity_seconds:
            message += (
                f" These gift credits are valid for {_format_duration(int(validity_seconds))}"
                " — use them before they expire."
            )
        return {
            "success": True,
            "message": message,
            "credits": credits,
            "balance": _minor_to_credits(user.credits_minor),
            "expiresAt": gift_expires_at,
            "validitySeconds": validity_seconds,
        }


def get_active_suspension(uid: str) -> dict[str, Any] | None:
    now = int(time.time())
    with session_scope() as session:
        repo = SecurityRepository(session)
        user = repo.get_user(uid)
        if user is not None and bool(user.is_suspended):
            return {
                "isPermanent": True,
                "reason": user.suspension_reason or "Account suspended by system policy.",
                "until": None,
            }

        temp_bucket = repo.get_rate_limit_bucket(_redeem_temp_suspension_key(uid))
        if temp_bucket is None or int(temp_bucket.reset_at) <= now:
            return None

        return {
            "isPermanent": False,
            "reason": _temporary_redeem_ban_reason(int(temp_bucket.count)),
            "until": int(temp_bucket.reset_at),
        }


def _with_active_suspension_state(user: dict[str, Any]) -> dict[str, Any]:
    suspension = get_active_suspension(str(user.get("uid", "")))
    if not suspension:
        user["activeSuspensionUntil"] = None
        user["activeSuspensionIsPermanent"] = False
        return user

    user["isSuspended"] = True
    user["suspensionReason"] = str(suspension.get("reason") or user.get("suspensionReason") or "")
    user["activeSuspensionUntil"] = suspension.get("until")
    user["activeSuspensionIsPermanent"] = bool(suspension.get("isPermanent"))
    return user


def add_history_entry(uid: str, image_url: str | None, caption: str | None, prompt: str, model: str) -> dict[str, Any]:
    with session_scope() as session:
        repo = SecurityRepository(session)
        entry = repo.add_history_entry(uid, image_url, caption, prompt, model)
        return _history_dict_from_model(entry)


def get_history(uid: str, max_items: int = 20) -> list[dict[str, Any]]:
    with session_scope() as session:
        repo = SecurityRepository(session)
        return [_history_dict_from_model(entry) for entry in repo.get_history(uid, max_items)]


def count_history(uid: str) -> int:
    with session_scope() as session:
        repo = SecurityRepository(session)
        return repo.count_history(uid)


def delete_history_entries_by_image_urls(uid: str, image_urls: set[str]) -> int:
    with session_scope() as session:
        repo = SecurityRepository(session)
        return repo.delete_history_entries_by_image_urls(uid, image_urls)


def list_credit_ledger_entries(uid: str, max_items: int = 20) -> list[dict[str, Any]]:
    with session_scope() as session:
        repo = SecurityRepository(session)
        return [_credit_ledger_dict_from_model(entry) for entry in repo.list_credit_ledger_entries(uid, max_items)]


def list_credit_activity_entries(uid: str, max_items: int = 20) -> list[dict[str, Any]]:
    visible_limit = max(1, min(int(max_items), 50))
    raw_limit = max(200, visible_limit * 10)
    raw_limit = min(raw_limit, 500)

    with session_scope() as session:
        repo = SecurityRepository(session)
        ledger_entries = [_credit_ledger_dict_from_model(entry) for entry in repo.list_credit_ledger_entries(uid, raw_limit)]

    groups: dict[str, dict[str, Any]] = {}
    group_order: list[str] = []

    for entry in ledger_entries:
        activity = _credit_activity_from_ledger_entry(entry)
        activity_id = activity["id"]
        if activity_id not in groups:
            groups[activity_id] = activity
            group_order.append(activity_id)
            continue

        groups[activity_id]["deltaMinor"] += activity["deltaMinor"]
        groups[activity_id]["entryCount"] = int(groups[activity_id].get("entryCount") or 1) + 1
        if activity["createdAt"] > groups[activity_id]["createdAt"]:
            groups[activity_id]["createdAt"] = activity["createdAt"]
            groups[activity_id]["activity"] = activity["activity"]
            groups[activity_id]["activityType"] = activity["activityType"]

    ordered = [groups[key] for key in group_order]
    ordered.sort(key=lambda item: int(item.get("createdAt") or 0), reverse=True)

    merged: list[dict[str, Any]] = []
    index = 0
    while index < len(ordered):
        current = ordered[index]
        next_item = ordered[index + 1] if index + 1 < len(ordered) else None
        current_id = str(current.get("id") or "")

        if current.get("activityType") == "chat":
            chat_group = dict(current)
            index += 1
            while index < len(ordered):
                candidate = ordered[index]
                if (
                    candidate.get("activityType") != "chat"
                    or not chat_group.get("conversationId")
                    or chat_group.get("conversationId") != candidate.get("conversationId")
                ):
                    break
                chat_group["id"] = f"{candidate['id']}+{chat_group['id']}"
                chat_group["deltaMinor"] = int(chat_group.get("deltaMinor") or 0) + int(candidate.get("deltaMinor") or 0)
                chat_group["entryCount"] = int(chat_group.get("entryCount") or 1) + int(candidate.get("entryCount") or 1)
                if int(candidate.get("createdAt") or 0) > int(chat_group.get("createdAt") or 0):
                    chat_group["createdAt"] = candidate["createdAt"]
                    chat_group["activity"] = candidate["activity"]
                index += 1
            merged.append(chat_group)
            continue

        if (
            current_id.startswith("generation_job:")
            and next_item is not None
            and str(next_item.get("id") or "").startswith("smart_generation:")
            and abs(int(current.get("createdAt") or 0) - int(next_item.get("createdAt") or 0)) < 3600
        ):
            merged.append({
                **current,
                "id": f"{current_id}+{next_item['id']}",
                "activityType": "smart_generation",
                "activity": "Smart Content Creation",
                "deltaMinor": int(current.get("deltaMinor") or 0) + int(next_item.get("deltaMinor") or 0),
            })
            index += 2
            continue

        merged.append(current)
        index += 1

    return merged[:visible_limit]


def create_chat_conversation(uid: str, model: str, system_parts: list[dict[str, Any]], title: str = "New Chat") -> dict[str, Any]:
    with session_scope() as session:
        repo = SecurityRepository(session)
        entry = repo.create_chat_conversation(uid, model, system_parts, title)
        return _chat_conversation_dict_from_model(entry)


def list_chat_conversations(uid: str, max_items: int = 20) -> list[dict[str, Any]]:
    with session_scope() as session:
        repo = SecurityRepository(session)
        return [_chat_conversation_dict_from_model(entry) for entry in repo.list_chat_conversations(uid, max_items)]


def get_chat_conversation(uid: str, conversation_id: str) -> dict[str, Any] | None:
    with session_scope() as session:
        repo = SecurityRepository(session)
        entry = repo.get_chat_conversation(uid, conversation_id)
        if entry is None:
            return None
        return _chat_conversation_dict_from_model(entry)


def update_chat_conversation_title(uid: str, conversation_id: str, title: str) -> dict[str, Any]:
    with session_scope() as session:
        repo = SecurityRepository(session)
        conversation = repo.get_chat_conversation_for_update(uid, conversation_id)
        if conversation is None:
            raise ValueError("CHAT_CONVERSATION_NOT_FOUND")
        entry = repo.update_chat_conversation_title(conversation, title)
        return _chat_conversation_dict_from_model(entry)


def delete_chat_conversation(uid: str, conversation_id: str) -> bool:
    with session_scope() as session:
        repo = SecurityRepository(session)
        conversation = repo.get_chat_conversation_for_update(uid, conversation_id)
        if conversation is None:
            return False
        repo.delete_chat_conversation(conversation)
        return True


def add_chat_message(uid: str, conversation_id: str, role: str, parts: list[dict[str, Any]]) -> dict[str, Any]:
    with session_scope() as session:
        repo = SecurityRepository(session)
        conversation = repo.get_chat_conversation_for_update(uid, conversation_id)
        if conversation is None:
            raise ValueError("CHAT_CONVERSATION_NOT_FOUND")
        created_at = int(time.time())
        entry = repo.add_chat_message(uid, conversation_id, role, parts, created_at=created_at)
        repo.touch_chat_conversation(conversation, touched_at=created_at)
        return _chat_message_dict_from_model(entry)


def add_chat_turn(
    uid: str,
    conversation_id: str,
    *,
    user_parts: list[dict[str, Any]],
    assistant_parts: list[dict[str, Any]],
    title: str | None = None,
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
    charged_cost: float = 0,
) -> dict[str, dict[str, Any]]:
    with session_scope() as session:
        repo = SecurityRepository(session)
        conversation = repo.get_chat_conversation_for_update(uid, conversation_id)
        if conversation is None:
            raise ValueError("CHAT_CONVERSATION_NOT_FOUND")
        previous_total_cost_minor = int(conversation.total_cost_minor or 0)
        charged_cost_micro = _credits_to_chat_cost_micro(charged_cost)
        next_total_cost_micro = max(int(conversation.total_cost_micro or 0) + charged_cost_micro, 0)
        next_total_cost_minor = _chat_cost_micro_to_minor(next_total_cost_micro)
        total_cost_minor_delta = next_total_cost_minor - previous_total_cost_minor
        created_at = int(time.time())
        user_entry = repo.add_chat_message(uid, conversation_id, "user", user_parts, created_at=created_at)
        assistant_entry = repo.add_chat_message(uid, conversation_id, "assistant", assistant_parts, created_at=created_at)
        repo.touch_chat_conversation(
            conversation,
            touched_at=created_at,
            title=title,
            prompt_tokens_delta=prompt_tokens,
            completion_tokens_delta=completion_tokens,
            total_cost_micro_delta=charged_cost_micro,
            total_cost_minor=next_total_cost_minor,
        )
        return {
            "user": _chat_message_dict_from_model(user_entry),
            "assistant": _chat_message_dict_from_model(assistant_entry),
            "costDeltaMinor": total_cost_minor_delta,
            "chargedCostMicro": charged_cost_micro,
            "totalCostMicro": next_total_cost_micro,
            "totalCostMinor": next_total_cost_minor,
        }


def get_chat_messages(uid: str, conversation_id: str, max_items: int = 100) -> list[dict[str, Any]]:
    with session_scope() as session:
        repo = SecurityRepository(session)
        conversation = repo.get_chat_conversation(uid, conversation_id)
        if conversation is None:
            raise ValueError("CHAT_CONVERSATION_NOT_FOUND")
        return [_chat_message_dict_from_model(entry) for entry in repo.get_chat_messages(uid, conversation_id, max_items)]


def _expire_stale_pending_analyze_sessions(repo: SecurityRepository, uid: str, *, now: int) -> int:
    ttl_seconds = max(int(settings.pending_analyze_session_ttl_seconds), 0)
    if ttl_seconds <= 0:
        return 0

    expired_count = 0
    cutoff = now - ttl_seconds
    for analyze_session in repo.list_pending_analyze_sessions_for_update(uid):
        if int(analyze_session.created_at) > cutoff:
            continue
        analyze_session.status = "failed"
        analyze_session.resolved_at = now
        expired_count += 1
    if expired_count:
        repo.session.flush()
    return expired_count


def _enforce_pending_analyze_session_limit(repo: SecurityRepository, uid: str, *, now: int) -> None:
    _expire_stale_pending_analyze_sessions(repo, uid, now=now)
    max_pending = max(int(settings.max_pending_analyze_sessions_per_user), 1)
    pending_sessions = repo.list_pending_analyze_sessions_for_update(uid)
    if len(pending_sessions) >= max_pending:
        raise ValueError("TOO_MANY_PENDING_ANALYZE_SESSIONS")


def _current_usage_cap_minor(user_created_at: int, *, now: int) -> tuple[int, int]:
    return _credits_to_minor(settings.daily_usage_cap), now - (24 * 60 * 60)


def _enforce_usage_cap(repo: SecurityRepository, user: Any, *, projected_charge_minor: int, now: int) -> None:
    if projected_charge_minor <= 0:
        return
    cap_minor, since_ts = _current_usage_cap_minor(int(user.created_at), now=now)
    consumed_minor = repo.sum_user_usage_minor(user.uid, since_ts=since_ts, reasons=USAGE_CAP_REASONS)
    consumed_minor += repo.sum_user_captured_generation_minor(user.uid, since_ts=since_ts)
    if consumed_minor + projected_charge_minor > cap_minor:
        raise ValueError("USAGE_CAP_REACHED")


def create_analyze_session(uid: str, prompt: str, analysis_fee: float = 0.0) -> dict[str, Any]:
    fee_minor = _credits_to_minor(analysis_fee)
    with session_scope() as session:
        repo = SecurityRepository(session)
        user = repo.get_user_for_update(uid)
        if user is None:
            user = repo.ensure_user(uid, "", "")
            session.flush()
        _enforce_pending_analyze_session_limit(repo, uid, now=int(time.time()))
        analyze_session = repo.create_analyze_session(uid, fee_minor, prompt)
        return {
            "id": analyze_session.id,
            "analysisFee": _minor_to_credits(analyze_session.fee_minor),
            "status": analyze_session.status,
            "createdAt": analyze_session.created_at,
        }


def create_analyze_session_with_charge(uid: str, prompt: str, analysis_fee: float) -> dict[str, Any]:
    analysis_fee_minor = _credits_to_minor(analysis_fee)
    now = int(time.time())

    with session_scope() as session:
        repo = SecurityRepository(session)
        user = repo.get_user_for_update(uid)
        if user is None:
            user = repo.ensure_user(uid, "", "")
            session.flush()
        _sweep_user_lots(repo, user, now)
        _enforce_pending_analyze_session_limit(repo, uid, now=now)
        _enforce_usage_cap(repo, user, projected_charge_minor=analysis_fee_minor, now=now)

        if analysis_fee_minor < 0:
            raise ValueError("Fee must be non-negative")
        if user.credits_minor < analysis_fee_minor:
            raise ValueError("INSUFFICIENT_CREDITS")

        analyze_session = repo.create_analyze_session(uid, analysis_fee_minor, prompt)

        if analysis_fee_minor > 0:
            # Charge gift-first; remember which lots funded it so an abandonment
            # refund returns the fee to those exact lots (preserving their expiry).
            _debited, funding = _debit_across_lots(repo, user, analysis_fee_minor, now, floor_at_zero=False)
            user.updated_at = now
            user.last_seen_at = now
            repo.add_ledger_entry(
                uid=uid,
                delta_minor=-analysis_fee_minor,
                reason="smart_analysis_charge",
                actor_uid=uid,
                metadata_json=_analyze_activity_metadata(
                    analyze_session.id,
                    {"analysis_fee": _minor_to_credits(analysis_fee_minor), "lot_funding": funding},
                ),
                analyze_session_id=analyze_session.id,
                created_at=now,
            )
            repo.add_admin_audit_log(
                admin_uid=None,
                admin_email=SYSTEM_AUDIT_EMAIL,
                action="smart_analysis_charge",
                target_type="user",
                target_id=uid,
                reason=f"Smart analysis charged {_minor_to_credits(analysis_fee_minor):.2f} credits.",
                metadata_json={
                    "uid": uid,
                    "analyze_session_id": analyze_session.id,
                    "charged_credits": _minor_to_credits(analysis_fee_minor),
                    "remaining_balance": _minor_to_credits(user.credits_minor),
                },
                created_at=now,
            )

        session.flush()
        return {
            "id": analyze_session.id,
            "analysisFee": _minor_to_credits(analyze_session.fee_minor),
            "status": analyze_session.status,
            "createdAt": analyze_session.created_at,
            "balance": _minor_to_credits(user.credits_minor),
        }


def complete_analyze_session(session_id: str, uid: str) -> dict[str, Any]:
    with session_scope() as session:
        repo = SecurityRepository(session)
        analyze_session = repo.get_analyze_session_for_update(session_id)
        if analyze_session is None or analyze_session.uid != uid:
            raise ValueError("SESSION_NOT_FOUND")

        fee = _minor_to_credits(analyze_session.fee_minor)
        if analyze_session.status in {"completed", "abandoned"}:
            return {"id": session_id, "status": analyze_session.status, "fee": fee}

        analyze_session.status = "completed"
        analyze_session.resolved_at = int(time.time())
        session.flush()
        return {"id": session_id, "status": "completed", "fee": fee}


def abandon_analyze_session(session_id: str, uid: str) -> dict[str, Any]:
    now = int(time.time())
    with session_scope() as session:
        repo = SecurityRepository(session)
        analyze_session = repo.get_analyze_session_for_update(session_id)
        if analyze_session is None or analyze_session.uid != uid:
            raise ValueError("SESSION_NOT_FOUND")

        user = repo.get_user_for_update(uid)
        if user is None:
            user = repo.ensure_user(uid, "", "")

        analysis_fee = _minor_to_credits(analyze_session.fee_minor)
        if analyze_session.status in {"abandoned", "completed", "failed"}:
            return {"id": session_id, "status": analyze_session.status, "analysisFee": analysis_fee, "balance": _minor_to_credits(user.credits_minor)}

        analyze_session.status = "abandoned"
        analyze_session.resolved_at = now
        session.flush()
        return {"id": session_id, "status": "abandoned", "analysisFee": analysis_fee, "balance": _minor_to_credits(user.credits_minor)}

def refund_analyze_session(session_id: str, uid: str) -> dict[str, Any]:
    now = int(time.time())
    with session_scope() as session:
        repo = SecurityRepository(session)
        analyze_session = repo.get_analyze_session_for_update(session_id)
        if analyze_session is None or analyze_session.uid != uid:
            raise ValueError("SESSION_NOT_FOUND")

        user = repo.get_user_for_update(uid)
        if user is None:
            user = repo.ensure_user(uid, "", "")

        analysis_fee = _minor_to_credits(analyze_session.fee_minor)
        if analyze_session.status in {"abandoned", "completed", "failed"}:
            return {"id": session_id, "status": analyze_session.status, "analysisFee": analysis_fee, "balance": _minor_to_credits(user.credits_minor)}

        analyze_session.status = "failed"
        analyze_session.resolved_at = now

        # Return the fee to the lots that funded the original charge (preserving
        # their expiry); any lot whose window has since closed expires instead.
        charge_entry = repo.get_ledger_entry_by_analyze_session(session_id, "smart_analysis_charge")
        funding = list((charge_entry.metadata_json or {}).get("lot_funding") or []) if charge_entry else []
        if funding:
            returned_minor, expired_minor = _return_funding_to_lots(repo, user, funding, now)
        elif int(analyze_session.fee_minor) > 0:
            # Legacy charge predating lot tracking -> return as a non-expiring lot.
            _credit_lot(repo, user, int(analyze_session.fee_minor), now, source="refund", expires_at=None)
            returned_minor, expired_minor = int(analyze_session.fee_minor), 0
        else:
            returned_minor, expired_minor = 0, 0

        user.updated_at = now

        repo.add_ledger_entry(
            uid=uid,
            delta_minor=returned_minor,
            reason="analyze_abandon_refund",
            actor_uid=uid,
            metadata_json=_analyze_activity_metadata(session_id, {"expired_minor": expired_minor}),
            analyze_session_id=session_id,
            created_at=now,
        )
        session.flush()
        return {"id": session_id, "status": "failed", "analysisFee": analysis_fee, "balance": _minor_to_credits(user.credits_minor)}


def create_generation_job(
    uid: str,
    prompt: str,
    requested_outputs: list[str],
    request_payload: dict[str, Any],
    reserved_cost: float = 0.0,
    status: str = "pending",
) -> dict[str, Any]:
    reserved_minor = _credits_to_minor(reserved_cost)
    with session_scope() as session:
        repo = SecurityRepository(session)
        job = repo.create_generation_job(uid, prompt, requested_outputs, request_payload, reserved_minor, status)
        return _generation_job_dict_from_model(job)


def update_generation_job(
    job_id: str,
    *,
    status: str,
    reserved_cost: float | None = None,
    captured_cost: float | None = None,
    refunded_cost: float | None = None,
    failure_reason: str | None = None,
    completed_at: int | None = None,
) -> dict[str, Any]:
    with session_scope() as session:
        repo = SecurityRepository(session)
        job = repo.get_generation_job(job_id)
        if job is None:
            raise ValueError("JOB_NOT_FOUND")
        repo.update_generation_job(
            job,
            status=status,
            reserved_minor=_credits_to_minor(reserved_cost) if reserved_cost is not None else None,
            captured_minor=_credits_to_minor(captured_cost) if captured_cost is not None else None,
            refunded_minor=_credits_to_minor(refunded_cost) if refunded_cost is not None else None,
            failure_reason=failure_reason,
            completed_at=completed_at,
        )
        return _generation_job_dict_from_model(job)


def list_admin_generation_jobs(status: str = "", limit: int = 100) -> list[dict[str, Any]]:
    normalized_status = status.strip().lower()
    bounded_limit = min(max(int(limit), 1), 200)
    with session_scope() as session:
        repo = SecurityRepository(session)
        jobs = repo.list_generation_jobs(normalized_status or None, bounded_limit)
        return [_generation_job_dict_from_model(job) for job in jobs]


def get_admin_generation_job(job_id: str) -> dict[str, Any] | None:
    with session_scope() as session:
        repo = SecurityRepository(session)
        job = repo.get_generation_job(job_id)
        if job is None:
            return None
        return _generation_job_dict_from_model(job)


def consume_rate_limit(key: str, max_count: int, window_seconds: int) -> bool:
    now = int(time.time())
    reset_at = now + window_seconds
    with session_scope() as session:
        repo = SecurityRepository(session)
        bucket = repo.get_rate_limit_bucket_for_update(key)
        if bucket is None:
            repo.upsert_rate_limit_bucket(key, 1, reset_at)
            return True
        if int(bucket.reset_at) <= now:
            repo.upsert_rate_limit_bucket(key, 1, reset_at)
            return True
        if int(bucket.count) >= max_count:
            return False
        bucket.count += 1
        bucket.updated_at = now
        session.flush()
        return True


def hash_credit_code(code: str) -> str:
    normalized = code.strip().upper()
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def _generate_code() -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return CODE_PREFIX + "".join(secrets.choice(alphabet) for _ in range(CODE_BODY_LENGTH))


def _preview_code(code: str) -> str:
    normalized = code.strip().upper()
    return f"{normalized[:6]}...{normalized[-4:]}"


def _credits_to_minor(value: float) -> int:
    return int(round(float(value) * CREDIT_SCALE))


def _minor_to_credits(value: int) -> float:
    return round(int(value) / CREDIT_SCALE, 2)


def _format_duration(seconds: int) -> str:
    """Human-friendly duration, e.g. '2 days 12 hours', '7 days', '3 hours'."""
    seconds = max(0, int(seconds))
    days = seconds // 86400
    hours = (seconds % 86400) // 3600
    minutes = (seconds % 3600) // 60
    parts: list[str] = []
    if days:
        parts.append(f"{days} day{'s' if days != 1 else ''}")
    if hours:
        parts.append(f"{hours} hour{'s' if hours != 1 else ''}")
    if not parts and minutes:
        parts.append(f"{minutes} minute{'s' if minutes != 1 else ''}")
    return " ".join(parts) or "0 minutes"


def _credits_to_chat_cost_micro(value: float) -> int:
    return int(round(float(value) * CHAT_COST_SCALE))


def _chat_cost_micro_to_minor(value: int) -> int:
    return int(round((int(value) / CHAT_COST_SCALE) * CREDIT_SCALE))


# --------------------------------------------------------------------------- #
# Credit-lot accounting (expiry-aware balances)
#
# Every credit a user holds lives in a `credit_lots` row with an optional
# `expires_at`. `users.credits_minor` / `reserved_credits_minor` are caches equal
# to SUM(remaining_minor) / SUM(reserved_minor) over a user's lots. All spending
# drains lots gift-first / soonest-expiry first; gift credits that go unused by
# their deadline are expired with a `gift_credit_expired` ledger entry.
# --------------------------------------------------------------------------- #
def _gift_expired_metadata(lot: Any, amount_minor: int) -> dict[str, Any]:
    return _with_activity_metadata(
        {
            "lot_id": lot.id,
            "code_hash": lot.code_hash,
            "source": lot.source,
            "expired_minor": amount_minor,
            "expired_credits": _minor_to_credits(amount_minor),
        },
        activity_id=f"gift_credit_expired:{lot.id}",
        activity_type="gift_credit_expired",
        activity_label="Gift Credits Expired",
    )


def _sweep_user_lots(repo: SecurityRepository, user: Any, now: int) -> int:
    """Expire the spendable remainder of any past-expiry lot for ``user`` (which
    must already be locked FOR UPDATE). Idempotent — zeroes ``remaining_minor`` —
    and never touches the reserved portion of a lot (that resolves when its job
    settles). Returns the total minor expired."""
    expired_total = 0
    for lot in repo.list_expired_lots_for_update(user.uid, now):
        amount = int(lot.remaining_minor)
        if amount <= 0:
            continue
        lot.remaining_minor = 0
        lot.expired_at = now
        user.credits_minor -= amount
        expired_total += amount
        repo.add_ledger_entry(
            uid=user.uid,
            delta_minor=-amount,
            reason="gift_credit_expired",
            actor_uid=None,
            metadata_json=_gift_expired_metadata(lot, amount),
            code_hash=lot.code_hash,
            created_at=now,
        )
    if expired_total > 0:
        user.updated_at = now
        user.last_seen_at = now
    return expired_total


def _credit_lot(
    repo: SecurityRepository,
    user: Any,
    amount_minor: int,
    now: int,
    *,
    source: str,
    expires_at: int | None,
    code_hash: str | None = None,
) -> Any:
    """Add ``amount_minor`` to ``user`` as a new lot and bump the cached balance."""
    lot = repo.create_credit_lot(
        uid=user.uid,
        source=source,
        amount_minor=amount_minor,
        granted_at=now,
        expires_at=expires_at,
        code_hash=code_hash,
    )
    user.credits_minor += amount_minor
    return lot


def _reserve_across_lots(
    repo: SecurityRepository,
    user: Any,
    amount_minor: int,
    now: int,
    *,
    ref_type: str,
    ref_id: str,
) -> int:
    """Reserve ``amount_minor`` across the user's lots gift-first / soonest-expiry
    first, skipping any gift lot that would expire within the safety window (so a
    long-running job can't be caught mid-flight by expiry). Records a per-lot
    allocation for each lot touched. Raises ``ValueError('INSUFFICIENT_CREDITS')``
    — rolling back the transaction — if eligible credits can't cover the amount.
    Caller is responsible for sweeping expired lots first."""
    if amount_minor <= 0:
        return 0
    safety = int(getattr(settings, "gift_reserve_safety_window_seconds", 300))
    remaining_to_reserve = amount_minor
    plan: list[tuple[Any, int]] = []
    for lot in repo.list_spendable_lots_for_update(user.uid):
        if remaining_to_reserve <= 0:
            break
        if lot.expires_at is not None and int(lot.expires_at) <= now + safety:
            continue
        take = min(int(lot.remaining_minor), remaining_to_reserve)
        if take <= 0:
            continue
        plan.append((lot, take))
        remaining_to_reserve -= take
    if remaining_to_reserve > 0:
        raise ValueError("INSUFFICIENT_CREDITS")
    for lot, take in plan:
        lot.remaining_minor -= take
        lot.reserved_minor += take
        repo.create_lot_allocation(
            lot_id=lot.id,
            ref_type=ref_type,
            ref_id=ref_id,
            reserved_minor=take,
            created_at=now,
        )
    user.credits_minor -= amount_minor
    user.reserved_credits_minor += amount_minor
    return amount_minor


def _debit_across_lots(
    repo: SecurityRepository,
    user: Any,
    amount_minor: int,
    now: int,
    *,
    floor_at_zero: bool = False,
) -> tuple[int, list[dict[str, Any]]]:
    """Immediately consume ``amount_minor`` from lots gift-first / soonest-expiry
    first. Unlike reserving, this does NOT skip soon-to-expire gifts — an immediate
    consume carries no in-flight risk, so spending the most-perishable credits is
    correct. Returns ``(debited_minor, funding)`` where ``funding`` is
    ``[{"lot_id", "minor"}]`` so the charge can later be refunded to the same lots.
    If funds are short: ``floor_at_zero`` charges only what's available, otherwise
    raises ``ValueError('INSUFFICIENT_CREDITS')``."""
    if amount_minor <= 0:
        return 0, []
    remaining_to_debit = amount_minor
    funding: list[dict[str, Any]] = []
    for lot in repo.list_spendable_lots_for_update(user.uid):
        if remaining_to_debit <= 0:
            break
        take = min(int(lot.remaining_minor), remaining_to_debit)
        if take <= 0:
            continue
        lot.remaining_minor -= take
        funding.append({"lot_id": lot.id, "minor": take})
        remaining_to_debit -= take
    if remaining_to_debit > 0 and not floor_at_zero:
        raise ValueError("INSUFFICIENT_CREDITS")
    debited = amount_minor - remaining_to_debit
    user.credits_minor -= debited
    return debited, funding


def _return_funding_to_lots(
    repo: SecurityRepository,
    user: Any,
    funding: list[dict[str, Any]] | None,
    now: int,
) -> tuple[int, int]:
    """Return previously-debited credits to their originating lots. If a lot has
    since expired, that portion is expired immediately rather than refunded.
    Returns ``(returned_minor, expired_minor)``."""
    returned = 0
    expired = 0
    for item in funding or []:
        minor = int(item.get("minor") or 0)
        if minor <= 0:
            continue
        lot = repo.get_lot_for_update(str(item.get("lot_id")))
        if lot is None:
            # Lot vanished (e.g. user deletion cascade); nothing to return to.
            continue
        if lot.expires_at is not None and int(lot.expires_at) <= now:
            lot.expired_at = now
            expired += minor
            repo.add_ledger_entry(
                uid=user.uid,
                delta_minor=0,
                reason="gift_credit_expired",
                actor_uid=None,
                metadata_json=_gift_expired_metadata(lot, minor),
                code_hash=lot.code_hash,
                created_at=now,
            )
            continue
        lot.remaining_minor += minor
        user.credits_minor += minor
        returned += minor
    return returned, expired


def _settle_generation_allocations(
    repo: SecurityRepository,
    user: Any,
    job: Any,
    actual_minor: int,
    now: int,
) -> dict[str, int]:
    """Settle a generation job's per-lot reservations.

    Consumes ``actual_minor`` from the reservations soonest-expiry first (so the
    most-perishable credits are the ones actually spent), returns the unused
    remainder to the originating lots (or expires it if a lot's window has closed),
    and charges any overage beyond the reservation gift-first, floored at zero.
    Returns ``{consumed, refunded, expired, overage, total_reserved}`` in minor."""
    allocations = repo.list_allocations_for_update("generation", job.id)
    lots_by_id: dict[str, Any] = {}
    for alloc in allocations:
        lot = repo.get_lot_for_update(alloc.lot_id)
        if lot is not None:
            lots_by_id[alloc.lot_id] = lot

    def _alloc_key(alloc: Any) -> tuple[int, int, int, str]:
        lot = lots_by_id.get(alloc.lot_id)
        exp = int(lot.expires_at) if (lot is not None and lot.expires_at is not None) else None
        return (
            0 if exp is not None else 1,
            exp if exp is not None else 0,
            int(lot.granted_at) if lot is not None else 0,
            alloc.id,
        )

    ordered = sorted(allocations, key=_alloc_key)
    total_reserved = sum(int(a.reserved_minor) for a in allocations)
    remaining_to_consume = min(max(int(actual_minor), 0), total_reserved)

    consumed = 0
    refunded = 0
    expired = 0
    for alloc in ordered:
        lot = lots_by_id.get(alloc.lot_id)
        held = int(alloc.reserved_minor)
        if held <= 0:
            continue
        take = min(held, remaining_to_consume)
        if take > 0:
            if lot is not None:
                lot.reserved_minor -= take
            user.reserved_credits_minor -= take
            consumed += take
            remaining_to_consume -= take
        leftover = held - take
        if leftover > 0:
            if lot is not None:
                lot.reserved_minor -= leftover
            user.reserved_credits_minor -= leftover
            if lot is not None and lot.expires_at is not None and int(lot.expires_at) <= now:
                lot.expired_at = now
                expired += leftover
                repo.add_ledger_entry(
                    uid=user.uid,
                    delta_minor=0,
                    reason="gift_credit_expired",
                    actor_uid=None,
                    metadata_json=_gift_expired_metadata(lot, leftover),
                    code_hash=lot.code_hash,
                    created_at=now,
                )
            elif lot is not None:
                lot.remaining_minor += leftover
                user.credits_minor += leftover
                refunded += leftover
            else:
                user.credits_minor += leftover
                refunded += leftover
        alloc.reserved_minor = 0

    repo.delete_lot_allocations("generation", job.id)

    overage = 0
    if int(actual_minor) > total_reserved:
        overage, _funding = _debit_across_lots(
            repo, user, int(actual_minor) - total_reserved, now, floor_at_zero=True
        )

    return {
        "consumed": consumed,
        "refunded": refunded,
        "expired": expired,
        "overage": overage,
        "total_reserved": total_reserved,
    }


def _with_activity_metadata(
    metadata: dict[str, Any] | None,
    *,
    activity_id: str,
    activity_type: str,
    activity_label: str,
) -> dict[str, Any]:
    payload = dict(metadata or {})
    payload.setdefault("activity_id", activity_id)
    payload.setdefault("activity_type", activity_type)
    payload.setdefault("activity_label", activity_label)
    return payload


def _analyze_activity_metadata(analyze_session_id: str, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    return _with_activity_metadata(
        {
            **(extra or {}),
            "analyze_session_id": analyze_session_id,
        },
        activity_id=f"smart_generation:{analyze_session_id}",
        activity_type="smart_generation",
        activity_label="Smart Content Creation",
    )


def _generation_activity_metadata(
    generation_job_id: str,
    requested_outputs: list[str] | None = None,
    request_payload: dict[str, Any] | None = None,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    user_preferences = (request_payload or {}).get("user_preferences")
    analyze_session_id = ""
    if isinstance(user_preferences, dict):
        analyze_session_id = str(user_preferences.get("analyze_session_id") or "").strip()

    outputs = list(requested_outputs or [])
    if "image" in outputs and "caption" in outputs:
        label = "Generation"
    elif "image" in outputs:
        label = "Image Generation"
    elif "caption" in outputs:
        label = "Caption Generation"
    else:
        label = "Generation"

    activity_id = f"generation_job:{generation_job_id}"
    activity_type = "generation"
    if analyze_session_id:
        activity_id = f"smart_generation:{analyze_session_id}"
        activity_type = "smart_generation"
        label = "Smart Content Creation"

    return _with_activity_metadata(
        {
            **(extra or {}),
            "generation_job_id": generation_job_id,
            "requested_outputs": outputs,
            **({"analyze_session_id": analyze_session_id} if analyze_session_id else {}),
        },
        activity_id=activity_id,
        activity_type=activity_type,
        activity_label=label,
    )


def _normalize_profile_username(value: str) -> str:
    normalized = PROFILE_USERNAME_ALLOWED_RE.sub("", str(value or "").strip().lower())
    return normalized[:PROFILE_USERNAME_MAX_LENGTH]


def _normalize_profile_bio(value: str) -> str:
    return str(value or "").strip()[:PROFILE_BIO_MAX_LENGTH]


def _profile_change_bucket_key(uid: str, now: int) -> tuple[str, int]:
    dt = datetime.fromtimestamp(now, tz=timezone.utc)
    year = dt.year
    month = dt.month
    if month == 12:
        next_month = datetime(year + 1, 1, 1, tzinfo=timezone.utc)
    else:
        next_month = datetime(year, month + 1, 1, tzinfo=timezone.utc)
    return f"profile_update:{uid}:{year:04d}{month:02d}", int(next_month.timestamp())


def _profile_save_attempt_bucket_key(uid: str, now: int) -> tuple[str, int]:
    dt = datetime.fromtimestamp(now, tz=timezone.utc)
    next_day = datetime(dt.year, dt.month, dt.day, tzinfo=timezone.utc) + timedelta(days=1)
    return f"profile_update_attempt:{uid}:{dt.year:04d}{dt.month:02d}{dt.day:02d}", int(next_day.timestamp())


def _record_profile_save_attempt(uid: str, now: int) -> None:
    daily_key, daily_reset_at = _profile_save_attempt_bucket_key(uid, now)
    with session_scope() as session:
        repo = SecurityRepository(session)
        daily_bucket = repo.get_rate_limit_bucket_for_update(daily_key)
        if daily_bucket is None or int(daily_bucket.reset_at) <= now:
            repo.upsert_rate_limit_bucket(daily_key, 1, daily_reset_at)
            return
        if int(daily_bucket.count) >= PROFILE_SAVE_ATTEMPT_LIMIT_PER_DAY:
            raise ValueError("PROFILE_DAILY_UPDATE_LIMIT")
        daily_bucket.count += 1
        daily_bucket.updated_at = now
        session.flush()


def _profile_change_status_from_bucket(bucket: Any, now: int, reset_at: int) -> dict[str, Any]:
    if bucket is None or int(bucket.reset_at) <= now:
        used = 0
    else:
        used = max(0, int(bucket.count))
        reset_at = int(bucket.reset_at)
    return {
        "profileChangesRemaining": max(0, PROFILE_CHANGE_LIMIT_PER_MONTH - used),
        "profileChangesResetAt": reset_at,
    }


def _user_dict_from_model(user: Any) -> dict[str, Any]:
    return {
        "uid": user.uid,
        "email": user.email,
        "displayName": user.display_name,
        "username": user.username or "",
        "bio": user.bio or "",
        "emailGeneralNewsEnabled": bool(user.email_general_news_enabled),
        "emailPlatformUpdatesEnabled": bool(user.email_platform_updates_enabled),
        "credits": _minor_to_credits(int(user.credits_minor)),
        "reservedCredits": _minor_to_credits(int(user.reserved_credits_minor)),
        "totalCredits": _minor_to_credits(int(user.credits_minor + user.reserved_credits_minor)),
        "createdAt": user.created_at,
        "updatedAt": user.updated_at,
        "lastSeenAt": user.last_seen_at,
        "isSuspended": bool(user.is_suspended),
        "suspensionReason": user.suspension_reason or "",
        "isDeactivated": bool(user.is_deactivated),
        "deactivatedAt": user.deactivated_at,
        "deactivationReason": user.deactivation_reason or "",
    }


def _dashboard_news_dict_from_model(item: Any) -> dict[str, Any]:
    return {
        "id": item.id,
        "badge": item.badge,
        "when": item.when_label,
        "title": item.title,
        "titleFr": getattr(item, "title_fr", "") or "",
        "titleAr": getattr(item, "title_ar", "") or "",
        "description": item.description,
        "descriptionFr": getattr(item, "description_fr", "") or "",
        "descriptionAr": getattr(item, "description_ar", "") or "",
        "linkLabel": item.link_label,
        "linkLabelFr": getattr(item, "link_label_fr", "") or "",
        "linkLabelAr": getattr(item, "link_label_ar", "") or "",
        "linkHref": item.link_href,
        "tone": item.tone,
        "sortOrder": int(item.sort_order),
        "isActive": bool(item.is_active),
        "createdAt": item.created_at,
        "updatedAt": item.updated_at,
    }


def _credit_code_dict_from_model(code: Any) -> dict[str, Any]:
    now = int(time.time())
    if not bool(code.is_active):
        status = "inactive"
    elif code.expires_at is not None and int(code.expires_at) <= now:
        status = "expired"
    elif int(code.claimed_count) >= int(code.max_claims):
        status = "exhausted"
    else:
        status = "active"
    return {
        "code": code.code_hash,
        "codePreview": code.code_preview,
        "credits": _minor_to_credits(int(code.credits_minor)),
        "maxClaims": int(code.max_claims),
        "claimedCount": int(code.claimed_count),
        "createdAt": code.created_at,
        "createdBy": code.created_by,
        "batchId": code.batch_id,
        "batchTitle": code.batch_title,
        "isActive": bool(code.is_active),
        "expiresAt": code.expires_at,
        "validitySeconds": getattr(code, "validity_seconds", None),
        "status": status,
    }


def _history_dict_from_model(entry: Any) -> dict[str, Any]:
    return {
        "id": entry.id,
        "imageUrl": entry.image_url,
        "caption": entry.caption,
        "prompt": entry.prompt,
        "model": entry.model,
        "createdAt": int(entry.created_at),
    }


def _chat_conversation_dict_from_model(entry: Any) -> dict[str, Any]:
    return {
        "id": entry.id,
        "uid": entry.uid,
        "model": entry.model,
        "title": entry.title or "New Chat",
        "system": list(entry.system_json or []),
        "createdAt": int(entry.created_at),
        "updatedAt": int(entry.updated_at),
        "lastMessageAt": int(entry.last_message_at) if entry.last_message_at is not None else None,
        "promptTokensTotal": int(entry.prompt_tokens_total or 0),
        "completionTokensTotal": int(entry.completion_tokens_total or 0),
        "totalTokens": int(entry.prompt_tokens_total or 0) + int(entry.completion_tokens_total or 0),
        "totalCostCredits": _minor_to_credits(int(entry.total_cost_minor or 0)),
        "totalCostRawCredits": round(int(getattr(entry, "total_cost_micro", 0) or 0) / CHAT_COST_SCALE, 6),
    }


def _credit_ledger_dict_from_model(entry: Any) -> dict[str, Any]:
    return {
        "id": entry.id,
        "uid": entry.uid,
        "deltaMinor": int(entry.delta_minor or 0),
        "reason": entry.reason,
        "actorUid": entry.actor_uid,
        "metadata": dict(entry.metadata_json or {}),
        "codeHash": entry.code_hash,
        "analyzeSessionId": entry.analyze_session_id,
        "createdAt": int(entry.created_at or 0),
    }


def _credit_activity_from_ledger_entry(entry: dict[str, Any]) -> dict[str, Any]:
    metadata = entry.get("metadata") if isinstance(entry.get("metadata"), dict) else {}
    reason = str(entry.get("reason") or "").strip().lower()

    activity_id = str(metadata.get("activity_id") or "").strip()
    activity_type = str(metadata.get("activity_type") or "").strip()
    activity_label = str(metadata.get("activity_label") or "").strip()

    if not activity_id:
        generation_job_id = str(metadata.get("generation_job_id") or "").strip()
        analyze_session_id = str(metadata.get("analyze_session_id") or entry.get("analyzeSessionId") or "").strip()
        conversation_id = str(metadata.get("conversation_id") or "").strip()

        if generation_job_id:
            activity_id = f"generation_job:{generation_job_id}"
            activity_type = activity_type or "generation"
            requested_outputs = metadata.get("requested_outputs")
            if isinstance(requested_outputs, list):
                if "image" in requested_outputs and "caption" in requested_outputs:
                    activity_label = activity_label or "Generation"
                elif "image" in requested_outputs:
                    activity_label = activity_label or "Image Generation"
                elif "caption" in requested_outputs:
                    activity_label = activity_label or "Caption Generation"
            activity_label = activity_label or "Generation"
        elif analyze_session_id:
            activity_id = f"smart_generation:{analyze_session_id}"
            activity_type = activity_type or "smart_generation"
            activity_label = activity_label or "Smart Content Creation"
        elif conversation_id:
            activity_id = f"conversation:{conversation_id}"
            activity_type = activity_type or "chat"
            prompt_preview = str(metadata.get("prompt_preview") or "").strip()
            activity_label = activity_label or (f'Chat: "{prompt_preview[:80]}"' if prompt_preview else "Plain Chat")
        else:
            activity_id = f"ledger:{entry.get('id')}"

    if not activity_type:
        activity_type = reason or "credit"

    if not activity_label:
        if reason == "credit_code_redeem":
            activity_label = "Credit Redeem"
        elif reason == "manual_adjustment":
            activity_label = "Manual Adjustment"
        else:
            activity_label = (reason or "Credit Activity").replace("_", " ").title()

    return {
        "id": activity_id,
        "createdAt": int(entry.get("createdAt") or 0),
        "activityType": activity_type,
        "activity": activity_label,
        "status": "COMPLETED",
        "deltaMinor": int(entry.get("deltaMinor") or 0),
        "conversationId": str(metadata.get("conversation_id") or "").strip() or None,
        "entryCount": 1,
    }


def _chat_message_dict_from_model(entry: Any) -> dict[str, Any]:
    return {
        "id": entry.id,
        "conversationId": entry.conversation_id,
        "uid": entry.uid,
        "role": entry.role,
        "parts": list(entry.parts_json or []),
        "createdAt": int(entry.created_at),
    }


def _generation_job_dict_from_model(job: Any) -> dict[str, Any]:
    return {
        "id": job.id,
        "uid": job.uid,
        "status": job.status,
        "prompt": job.prompt,
        "requestedOutputs": list(job.requested_outputs_json or []),
        "reservedCost": _minor_to_credits(int(job.reserved_minor)),
        "capturedCost": _minor_to_credits(int(job.captured_minor)),
        "refundedCost": _minor_to_credits(int(job.refunded_minor)),
        "failureReason": job.failure_reason,
        "createdAt": job.created_at,
        "updatedAt": job.updated_at,
        "completedAt": job.completed_at,
    }


def _admin_audit_log_dict_from_model(entry: Any) -> dict[str, Any]:
    return {
        "id": entry.id,
        "adminUid": entry.admin_uid,
        "adminEmail": entry.admin_email,
        "action": entry.action,
        "targetType": entry.target_type,
        "targetId": entry.target_id,
        "reason": entry.reason,
        "metadata": dict(entry.metadata_json or {}),
        "createdAt": entry.created_at,
    }


def _handle_failed_redeem_attempt(
    repo: SecurityRepository,
    uid: str,
    now: int,
    base_message: str,
) -> dict[str, Any]:
    user = repo.get_user_for_update(uid)
    if user is None:
        user = repo.ensure_user(uid, "", "")

    short_window_attempts = _increment_bucket(
        repo,
        _redeem_failed_window_key(uid),
        now=now,
        window_seconds=settings.redeem_failed_attempt_window_seconds,
    )
    consecutive_attempts = _increment_bucket(
        repo,
        _redeem_consecutive_failures_key(uid),
        now=now,
        window_seconds=settings.redeem_consecutive_window_seconds,
    )

    if consecutive_attempts >= settings.redeem_consecutive_admin_threshold:
        user.is_suspended = True
        user.suspension_reason = (
            "Automatic suspension due to 20 consecutive failed credit code redemption attempts within 24 hours. "
            "Admin review is required to restore access."
        )
        user.updated_at = now
        user.last_seen_at = now
        repo.add_admin_audit_log(
            admin_uid=None,
            admin_email=AUTO_SUSPEND_AUDIT_EMAIL,
            action="user_auto_suspend",
            target_type="user",
            target_id=uid,
            reason=user.suspension_reason,
            metadata_json={
                "uid": uid,
                "category": "credit_code_abuse",
                "suspension_type": "admin_review",
                "consecutive_failed_redeems": consecutive_attempts,
                "window_seconds": settings.redeem_consecutive_window_seconds,
            },
            created_at=now,
        )
        return {
            "success": False,
            "message": (
                f"{base_message} Your account has been suspended pending admin review due to repeated failed credit code attempts. "
                "Please contact support and review the usage policy."
            ),
        }

    if consecutive_attempts >= settings.redeem_consecutive_suspend_threshold:
        until = now + settings.redeem_temp_suspension_seconds
        repo.upsert_rate_limit_bucket(_redeem_temp_suspension_key(uid), 1, until)
        repo.add_admin_audit_log(
            admin_uid=None,
            admin_email=AUTO_SUSPEND_AUDIT_EMAIL,
            action="user_auto_suspend",
            target_type="user",
            target_id=uid,
            reason="Automatic suspension for 1 hour due to 10 consecutive failed credit code redemption attempts.",
            metadata_json={
                "uid": uid,
                "category": "credit_code_abuse",
                "suspension_type": "temporary",
                "suspension_seconds": settings.redeem_temp_suspension_seconds,
                "consecutive_failed_redeems": consecutive_attempts,
                "window_seconds": settings.redeem_consecutive_window_seconds,
            },
            created_at=now,
        )
        return {
            "success": False,
            "message": (
                f"{base_message} Your account has been suspended for 1 hour due to repeated failed credit code attempts. "
                "Please review the usage policy."
            ),
        }

    if short_window_attempts >= settings.redeem_failed_attempt_limit:
        until = now + settings.redeem_failed_cooldown_seconds
        repo.upsert_rate_limit_bucket(_redeem_cooldown_key(uid), short_window_attempts, until)
        return {
            "success": False,
            "message": (
                f"{base_message} This account reached {settings.redeem_failed_attempt_limit} failed credit code attempts in "
                f"{_minutes_label(settings.redeem_failed_attempt_window_seconds)}. Please wait about "
                f"{_minutes_label(settings.redeem_failed_cooldown_seconds)} before trying again and review the usage policy."
            ),
        }

    return {"success": False, "message": base_message}


def _redeem_failed_window_key(uid: str) -> str:
    return f"redeem_failed_window:{uid}"


def _redeem_cooldown_key(uid: str) -> str:
    return f"redeem_cooldown:{uid}"


def _redeem_consecutive_failures_key(uid: str) -> str:
    return f"redeem_consecutive_failures:{uid}"


def _redeem_temp_suspension_key(uid: str) -> str:
    return f"redeem_temp_suspension:{uid}"


def _temporary_redeem_ban_reason(stage: int) -> str:
    return "Account suspended for 1 hour due to repeated failed credit code redemption attempts."


def _increment_bucket(repo: SecurityRepository, key: str, *, now: int, window_seconds: int) -> int:
    bucket = repo.get_rate_limit_bucket_for_update(key)
    if bucket is None or int(bucket.reset_at) <= now:
        repo.upsert_rate_limit_bucket(key, 1, now + window_seconds)
        return 1

    bucket.count += 1
    bucket.updated_at = now
    repo.session.flush()
    return int(bucket.count)


def _minutes_label(window_seconds: int) -> str:
    minutes = max(1, round(window_seconds / 60))
    if minutes == 1:
        return "1 minute"
    return f"{minutes} minutes"


def reserve_generation_credits(
    uid: str,
    prompt: str,
    requested_outputs: list[str],
    request_payload: dict[str, Any],
    estimated_cost: float,
) -> dict[str, Any]:
    reserved_minor = _credits_to_minor(estimated_cost)
    now = int(time.time())

    with session_scope() as session:
        repo = SecurityRepository(session)
        user = repo.get_user_for_update(uid)
        if user is None:
            user = repo.ensure_user(uid, "", "")
        _sweep_user_lots(repo, user, now)

        if reserved_minor < 0:
            raise ValueError("Estimated cost must be non-negative")
        _enforce_usage_cap(repo, user, projected_charge_minor=reserved_minor, now=now)
        if user.credits_minor < reserved_minor:
            raise ValueError("INSUFFICIENT_CREDITS")

        job = repo.create_generation_job(
            uid=uid,
            prompt=prompt,
            requested_outputs=requested_outputs,
            request_payload=request_payload,
            reserved_minor=reserved_minor,
            status="processing",
        )

        # Reserve gift-first / soonest-expiry first, skipping gifts that would
        # expire mid-generation. Raises INSUFFICIENT_CREDITS (rolling back this
        # transaction, incl. the job row above) if eligible credits fall short.
        _reserve_across_lots(repo, user, reserved_minor, now, ref_type="generation", ref_id=job.id)
        user.updated_at = now
        user.last_seen_at = now

        repo.add_ledger_entry(
            uid=uid,
            delta_minor=-reserved_minor,
            reason="generation_reserve",
            actor_uid=uid,
            metadata_json=_generation_activity_metadata(job.id, requested_outputs, request_payload),
            created_at=now,
        )
        session.flush()
        return {
            "job": _generation_job_dict_from_model(job),
            "balance": _user_dict_from_model(user),
        }


def mark_generation_job_awaiting_review(job_id: str) -> dict[str, Any]:
    with session_scope() as session:
        repo = SecurityRepository(session)
        job = repo.get_generation_job_for_update(job_id)
        if job is None:
            raise ValueError("JOB_NOT_FOUND")
        repo.update_generation_job(job, status="awaiting_review")
        return _generation_job_dict_from_model(job)


def capture_generation_credits(job_id: str, actual_cost: float) -> dict[str, Any]:
    now = int(time.time())
    actual_minor = _credits_to_minor(actual_cost)
    with session_scope() as session:
        repo = SecurityRepository(session)
        job = repo.get_generation_job_for_update(job_id)
        if job is None:
            raise ValueError("JOB_NOT_FOUND")

        user = repo.get_user_for_update(job.uid)
        if user is None:
            raise ValueError("USER_NOT_FOUND")

        if job.status == "completed":
            return {
                "job": _generation_job_dict_from_model(job),
                "balance": _user_dict_from_model(user),
            }
        if job.status in {"failed", "cancelled"}:
            raise ValueError("JOB_NOT_CAPTURABLE")
        if user.reserved_credits_minor < job.reserved_minor:
            raise ValueError("RESERVED_BALANCE_MISMATCH")

        # Settle the per-lot reservations: consume `actual_minor` soonest-expiry
        # first, return the unused remainder to its originating lots (expiring any
        # whose window closed), and charge any overage gift-first, floored at zero.
        settlement = _settle_generation_allocations(repo, user, job, actual_minor, now)
        refund_minor = settlement["refunded"]
        overage_minor = settlement["overage"]
        if refund_minor > 0:
            repo.add_ledger_entry(
                uid=user.uid,
                delta_minor=refund_minor,
                reason="generation_refund",
                actor_uid=user.uid,
                metadata_json=_generation_activity_metadata(
                    job.id,
                    list(job.requested_outputs_json or []),
                    dict(job.request_payload_json or {}),
                    {"refunded_minor": refund_minor},
                ),
                created_at=now,
            )
        if overage_minor > 0:
            repo.add_ledger_entry(
                uid=user.uid,
                delta_minor=-overage_minor,
                reason="generation_overage_charge",
                actor_uid=user.uid,
                metadata_json=_generation_activity_metadata(
                    job.id,
                    list(job.requested_outputs_json or []),
                    dict(job.request_payload_json or {}),
                    {"overage_minor": overage_minor},
                ),
                created_at=now,
            )

        user.updated_at = now
        user.last_seen_at = now

        repo.add_ledger_entry(
            uid=user.uid,
            delta_minor=0,
            reason="generation_capture",
            actor_uid=user.uid,
            metadata_json=_generation_activity_metadata(
                job.id,
                list(job.requested_outputs_json or []),
                dict(job.request_payload_json or {}),
                {"captured_minor": actual_minor},
            ),
            created_at=now,
        )
        repo.add_admin_audit_log(
            admin_uid=None,
            admin_email=SYSTEM_AUDIT_EMAIL,
            action="generation_charge",
            target_type="user",
            target_id=user.uid,
            reason=f"Generation charged {_minor_to_credits(actual_minor):.2f} credits.",
            metadata_json={
                "uid": user.uid,
                "generation_job_id": job.id,
                "charged_credits": _minor_to_credits(actual_minor),
                "remaining_balance": _minor_to_credits(user.credits_minor),
                "requested_outputs": list(job.requested_outputs_json or []),
                "job_status": "completed",
            },
            created_at=now,
        )
        repo.update_generation_job(
            job,
            status="completed",
            captured_minor=actual_minor,
            refunded_minor=refund_minor,
            completed_at=now,
        )
        session.flush()
        return {
            "job": _generation_job_dict_from_model(job),
            "balance": _user_dict_from_model(user),
        }


def release_generation_credits(job_id: str, failure_reason: str | None = None, cancelled: bool = False) -> dict[str, Any]:
    now = int(time.time())
    with session_scope() as session:
        repo = SecurityRepository(session)
        job = repo.get_generation_job_for_update(job_id)
        if job is None:
            raise ValueError("JOB_NOT_FOUND")

        user = repo.get_user_for_update(job.uid)
        if user is None:
            raise ValueError("USER_NOT_FOUND")

        if job.status in {"failed", "cancelled"}:
            return {
                "job": _generation_job_dict_from_model(job),
                "balance": _user_dict_from_model(user),
            }
        if job.status == "completed":
            raise ValueError("JOB_ALREADY_COMPLETED")
        if user.reserved_credits_minor < job.reserved_minor:
            raise ValueError("RESERVED_BALANCE_MISMATCH")

        # Nothing consumed (actual = 0): the full reservation returns to its
        # originating lots, preserving each lot's expiry.
        settlement = _settle_generation_allocations(repo, user, job, 0, now)
        released_minor = settlement["refunded"]
        user.updated_at = now
        user.last_seen_at = now

        repo.add_ledger_entry(
            uid=user.uid,
            delta_minor=released_minor,
            reason="generation_release",
            actor_uid=user.uid,
            metadata_json=_generation_activity_metadata(
                job.id,
                list(job.requested_outputs_json or []),
                dict(job.request_payload_json or {}),
                {
                    "failure_reason": failure_reason,
                    "released_minor": released_minor,
                    "expired_minor": settlement["expired"],
                },
            ),
            created_at=now,
        )
        repo.add_admin_audit_log(
            admin_uid=None,
            admin_email=SYSTEM_AUDIT_EMAIL,
            action="generation_delivery_failed",
            target_type="user",
            target_id=user.uid,
            reason=(
                f"Generation delivery failed and {_minor_to_credits(released_minor):.2f} credits were refunded."
            ),
            metadata_json={
                "uid": user.uid,
                "generation_job_id": job.id,
                "mode": (job.request_payload_json or {}).get("mode"),
                "requested_outputs": list(job.requested_outputs_json or []),
                "failure_reason": failure_reason,
                "refunded_credits": _minor_to_credits(released_minor),
                "job_status": "cancelled" if cancelled else "failed",
            },
            created_at=now,
        )
        repo.update_generation_job(
            job,
            status="cancelled" if cancelled else "failed",
            refunded_minor=released_minor,
            failure_reason=failure_reason,
            completed_at=now,
        )
        session.flush()
        return {
            "job": _generation_job_dict_from_model(job),
            "balance": _user_dict_from_model(user),
        }
