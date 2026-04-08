from __future__ import annotations

import hashlib
import secrets
import time
from typing import Any

from app.db.repositories import SecurityRepository
from app.db.session import session_scope

CREDIT_SCALE = 100
CODE_PREFIX = "VC-"
CODE_BODY_LENGTH = 30


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


def list_credit_codes() -> list[dict[str, Any]]:
    with session_scope() as session:
        repo = SecurityRepository(session)
        return [_credit_code_dict_from_model(code) for code in repo.list_credit_codes()]


def get_credit_code(code: str) -> dict[str, Any] | None:
    with session_scope() as session:
        repo = SecurityRepository(session)
        credit_code = repo.get_credit_code(hash_credit_code(code))
        if credit_code is None:
            return None
        return _credit_code_dict_from_model(credit_code)


def redeem_credit_code(code: str, uid: str) -> dict[str, Any]:
    normalized = code.strip().upper()
    code_hash = hash_credit_code(normalized)
    now = int(time.time())

    with session_scope() as session:
        repo = SecurityRepository(session)
        credit_code = repo.get_credit_code_for_update(code_hash)
        if credit_code is None:
            return {"success": False, "message": "Invalid code. Please check and try again."}
        if not credit_code.is_active:
            return {"success": False, "message": "This code is no longer active."}
        if credit_code.expires_at is not None and int(credit_code.expires_at) <= now:
            return {"success": False, "message": "This code has expired."}
        if repo.get_credit_claim(code_hash, uid) is not None:
            return {"success": False, "message": "You have already used this code."}
        if credit_code.claimed_count >= credit_code.max_claims:
            return {"success": False, "message": "This code has expired (max claims reached)."}

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
    return {
        "code": code.code_preview,
        "codePreview": code.code_preview,
        "credits": _minor_to_credits(int(code.credits_minor)),
        "maxClaims": int(code.max_claims),
        "claimedCount": int(code.claimed_count),
        "createdAt": code.created_at,
        "createdBy": code.created_by,
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
