from __future__ import annotations

import hashlib
import secrets
import time
import uuid
from typing import Any

from app.config import settings
from app.db.repositories import SecurityRepository
from app.db.session import session_scope

CREDIT_SCALE = 100
CODE_PREFIX = "VC-"
CODE_BODY_LENGTH = 30
INVALID_REDEEM_ATTEMPTS_RESET_AT = 4_102_444_800  # 2100-01-01 UTC
INVALID_REDEEM_ATTEMPTS_PER_STAGE = 10
REDEEM_BAN_STAGE_ONE_SECONDS = 60 * 60
REDEEM_BAN_STAGE_TWO_SECONDS = 24 * 60 * 60


def preload_postgres() -> None:
    # Opening and closing a session eagerly verifies that DATABASE_URL is usable.
    with session_scope():
        return


def ensure_user(uid: str, email: str, display_name: str) -> dict[str, Any]:
    with session_scope() as session:
        repo = SecurityRepository(session)
        user = repo.ensure_user(uid, email, display_name)
        return _user_dict_from_model(user)


def get_user(uid: str) -> dict[str, Any]:
    with session_scope() as session:
        repo = SecurityRepository(session)
        user = repo.get_user(uid)
        if user is None:
            return {"uid": uid, "email": "", "displayName": "", "credits": 0.0}
        return _user_dict_from_model(user)


def list_users() -> list[dict[str, Any]]:
    with session_scope() as session:
        repo = SecurityRepository(session)
        return [_user_dict_from_model(user) for user in repo.list_users()]


def search_users(query: str = "", limit: int = 100) -> list[dict[str, Any]]:
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
    return users[:bounded_limit]


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
        repo.delete_rate_limit_bucket(_invalid_redeem_attempts_key(uid))

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
            )
        ]


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

        next_minor = user.credits_minor + delta_minor
        if not allow_negative and next_minor < 0:
            raise ValueError("INSUFFICIENT_CREDITS")

        user.credits_minor = next_minor
        user.updated_at = now
        user.last_seen_at = now

        repo.add_ledger_entry(
            uid=uid,
            delta_minor=delta_minor,
            reason=reason,
            actor_uid=actor_uid,
            metadata_json=metadata or {},
            created_at=now,
        )
        session.flush()
        return _user_dict_from_model(user)


def create_credit_code(credits: float, max_claims: int, created_by: str) -> dict[str, Any]:
    credits_minor = _credits_to_minor(credits)
    if credits_minor <= 0:
        raise ValueError("Credits must be positive")
    if max_claims <= 0:
        raise ValueError("Max claims must be positive")

    raw_code = _generate_code()
    code_hash = hash_credit_code(raw_code)
    code_preview = _preview_code(raw_code)

    with session_scope() as session:
        repo = SecurityRepository(session)
        code = repo.create_credit_code(code_hash, code_preview, credits_minor, max_claims, created_by)
        return {
            "code": raw_code,
            "codePreview": code.code_preview,
            "credits": _minor_to_credits(code.credits_minor),
            "maxClaims": code.max_claims,
            "claimedCount": code.claimed_count,
            "createdAt": code.created_at,
            "createdBy": code.created_by,
        }


def create_credit_code_batch(quantity: int, credits: float, created_by: str) -> list[dict[str, Any]]:
    return create_credit_code_batch_with_title(quantity, credits, created_by, "")


def create_credit_code_batch_with_title(quantity: int, credits: float, created_by: str, title: str) -> list[dict[str, Any]]:
    bounded_quantity = int(quantity)
    credits_minor = _credits_to_minor(credits)
    normalized_title = title.strip()
    if bounded_quantity <= 0:
        raise ValueError("Quantity must be positive")
    if credits_minor <= 0:
        raise ValueError("Credits must be positive")
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

        user = repo.get_user_for_update(uid)
        if user is None:
            user = repo.ensure_user(uid, "", "")

        credit_code.claimed_count += 1
        user.credits_minor += credit_code.credits_minor
        user.updated_at = now
        user.last_seen_at = now

        repo.add_credit_claim(code_hash, uid, claimed_at=now)
        repo.add_ledger_entry(
            uid=uid,
            delta_minor=credit_code.credits_minor,
            reason="credit_code_redeem",
            actor_uid=uid,
            metadata_json={"code_preview": credit_code.code_preview},
            code_hash=code_hash,
            created_at=now,
        )
        session.flush()

        credits = _minor_to_credits(credit_code.credits_minor)
        return {
            "success": True,
            "message": f"+{credits:g} credit{'s' if credits != 1 else ''} added to your account!",
            "credits": credits,
            "balance": _minor_to_credits(user.credits_minor),
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


def create_analyze_session(uid: str, prompt: str, fee: float) -> dict[str, Any]:
    fee_minor = _credits_to_minor(fee)
    with session_scope() as session:
        repo = SecurityRepository(session)
        analyze_session = repo.create_analyze_session(uid, fee_minor, prompt)
        return {
            "id": analyze_session.id,
            "fee": _minor_to_credits(analyze_session.fee_minor),
            "status": analyze_session.status,
            "createdAt": analyze_session.created_at,
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

        fee = _minor_to_credits(analyze_session.fee_minor)
        if analyze_session.status == "abandoned":
            return {"id": session_id, "status": "abandoned", "fee": fee, "balance": _minor_to_credits(user.credits_minor)}
        if analyze_session.status == "completed":
            return {"id": session_id, "status": "completed", "fee": fee, "balance": _minor_to_credits(user.credits_minor)}

        next_minor = user.credits_minor - analyze_session.fee_minor
        if next_minor < 0:
            raise ValueError("INSUFFICIENT_CREDITS")

        analyze_session.status = "abandoned"
        analyze_session.resolved_at = now
        user.credits_minor = next_minor
        user.updated_at = now
        user.last_seen_at = now
        repo.add_ledger_entry(
            uid=uid,
            delta_minor=-analyze_session.fee_minor,
            reason="analyze_abandon_charge",
            actor_uid=uid,
            metadata_json={"analyze_session_id": session_id},
            analyze_session_id=session_id,
            created_at=now,
        )
        session.flush()
        return {"id": session_id, "status": "abandoned", "fee": fee, "balance": _minor_to_credits(user.credits_minor)}


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


def _user_dict_from_model(user: Any) -> dict[str, Any]:
    return {
        "uid": user.uid,
        "email": user.email,
        "displayName": user.display_name,
        "credits": _minor_to_credits(int(user.credits_minor)),
        "reservedCredits": _minor_to_credits(int(user.reserved_credits_minor)),
        "totalCredits": _minor_to_credits(int(user.credits_minor + user.reserved_credits_minor)),
        "createdAt": user.created_at,
        "updatedAt": user.updated_at,
        "lastSeenAt": user.last_seen_at,
        "isSuspended": bool(user.is_suspended),
        "suspensionReason": user.suspension_reason or "",
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

    count_key = _invalid_redeem_attempts_key(uid)
    attempts_bucket = repo.get_rate_limit_bucket_for_update(count_key)
    attempts = 1 if attempts_bucket is None else int(attempts_bucket.count) + 1
    repo.upsert_rate_limit_bucket(count_key, attempts, INVALID_REDEEM_ATTEMPTS_RESET_AT)

    if attempts >= INVALID_REDEEM_ATTEMPTS_PER_STAGE * 3:
        user.is_suspended = True
        user.suspension_reason = (
            "Permanent suspension due to repeated failed credit code redemption attempts. "
            "Admin action is required to restore access."
        )
        user.updated_at = now
        user.last_seen_at = now
        return {
            "success": False,
            "message": (
                f"{base_message} Your account has been suspended permanently due to repeated failed credit code attempts. "
                "Please contact support."
            ),
        }

    if attempts == INVALID_REDEEM_ATTEMPTS_PER_STAGE * 2:
        until = now + REDEEM_BAN_STAGE_TWO_SECONDS
        repo.upsert_rate_limit_bucket(_redeem_temp_suspension_key(uid), 2, until)
        return {
            "success": False,
            "message": (
                f"{base_message} Your account has been suspended for 24 hours due to repeated failed credit code attempts."
            ),
        }

    if attempts == INVALID_REDEEM_ATTEMPTS_PER_STAGE:
        until = now + REDEEM_BAN_STAGE_ONE_SECONDS
        repo.upsert_rate_limit_bucket(_redeem_temp_suspension_key(uid), 1, until)
        return {
            "success": False,
            "message": (
                f"{base_message} Your account has been suspended for 1 hour due to repeated failed credit code attempts."
            ),
        }

    return {"success": False, "message": base_message}


def _invalid_redeem_attempts_key(uid: str) -> str:
    return f"redeem_invalid_attempts:{uid}"


def _redeem_temp_suspension_key(uid: str) -> str:
    return f"redeem_temp_suspension:{uid}"


def _temporary_redeem_ban_reason(stage: int) -> str:
    if stage >= 2:
        return "Account suspended for 24 hours due to repeated failed credit code redemption attempts."
    return "Account suspended for 1 hour due to repeated failed credit code redemption attempts."


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

        if reserved_minor < 0:
            raise ValueError("Estimated cost must be non-negative")
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

        user.credits_minor -= reserved_minor
        user.reserved_credits_minor += reserved_minor
        user.updated_at = now
        user.last_seen_at = now

        repo.add_ledger_entry(
            uid=uid,
            delta_minor=-reserved_minor,
            reason="generation_reserve",
            actor_uid=uid,
            metadata_json={
                "generation_job_id": job.id,
                "requested_outputs": requested_outputs,
            },
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


def capture_generation_credits(job_id: str) -> dict[str, Any]:
    now = int(time.time())
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

        user.reserved_credits_minor -= job.reserved_minor
        user.updated_at = now
        user.last_seen_at = now

        repo.add_ledger_entry(
            uid=user.uid,
            delta_minor=0,
            reason="generation_capture",
            actor_uid=user.uid,
            metadata_json={
                "generation_job_id": job.id,
                "captured_minor": job.reserved_minor,
            },
            created_at=now,
        )
        repo.update_generation_job(
            job,
            status="completed",
            captured_minor=job.reserved_minor,
            refunded_minor=job.refunded_minor,
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

        if job.status in {"failed", "cancelled"} and job.refunded_minor == job.reserved_minor:
            return {
                "job": _generation_job_dict_from_model(job),
                "balance": _user_dict_from_model(user),
            }
        if job.status == "completed":
            raise ValueError("JOB_ALREADY_COMPLETED")
        if user.reserved_credits_minor < job.reserved_minor:
            raise ValueError("RESERVED_BALANCE_MISMATCH")

        user.reserved_credits_minor -= job.reserved_minor
        user.credits_minor += job.reserved_minor
        user.updated_at = now
        user.last_seen_at = now

        repo.add_ledger_entry(
            uid=user.uid,
            delta_minor=job.reserved_minor,
            reason="generation_release",
            actor_uid=user.uid,
            metadata_json={
                "generation_job_id": job.id,
                "failure_reason": failure_reason,
                "released_minor": job.reserved_minor,
            },
            created_at=now,
        )
        repo.update_generation_job(
            job,
            status="cancelled" if cancelled else "failed",
            refunded_minor=job.reserved_minor,
            failure_reason=failure_reason,
            completed_at=now,
        )
        session.flush()
        return {
            "job": _generation_job_dict_from_model(job),
            "balance": _user_dict_from_model(user),
        }
