import hashlib
import json
import secrets
import sqlite3
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from google.cloud import firestore
from google.oauth2 import service_account

from app.config import settings

CREDIT_SCALE = 100
CODE_PREFIX = "VC-"
CODE_BODY_LENGTH = 30

META_COLLECTION = "_meta"
META_DOCUMENT = "security_store"
USERS_COLLECTION = "users"
CREDIT_CODES_COLLECTION = "credit_codes"
RATE_LIMITS_COLLECTION = "rate_limits"
ANALYZE_SESSIONS_COLLECTION = "analyze_sessions"

USER_LEDGER_SUBCOLLECTION = "ledger"
USER_HISTORY_SUBCOLLECTION = "history"
CODE_CLAIMS_SUBCOLLECTION = "claims"

_db: firestore.Client | None = None


def _firestore() -> firestore.Client:
    global _db
    if _db is None:
        kwargs: Dict[str, Any] = {
            "project": settings.firestore_project_id,
            "database": settings.firestore_database,
        }
        if settings.firebase_credentials_path:
            credentials = service_account.Credentials.from_service_account_file(
                settings.firebase_credentials_path
            )
            kwargs["credentials"] = credentials
        _db = firestore.Client(**kwargs)
    return _db


def init_db() -> None:
    db = _firestore()
    meta_ref = db.collection(META_COLLECTION).document(META_DOCUMENT)
    meta = meta_ref.get()
    if meta.exists and meta.to_dict().get("migration_version") == 1:
        return

    has_existing_docs = next(db.collection(USERS_COLLECTION).limit(1).stream(), None) is not None
    if has_existing_docs:
        meta_ref.set(
            {
                "migration_version": 1,
                "migrated_at": int(time.time()),
                "source": "firestore_existing",
            },
            merge=True,
        )
        return

    migrated_counts = _migrate_sqlite_to_firestore(db)
    meta_ref.set(
        {
            "migration_version": 1,
            "migrated_at": int(time.time()),
            "source": "sqlite",
            "counts": migrated_counts,
        },
        merge=True,
    )


def preload_firestore() -> None:
    """Eagerly initialize the Firestore client and run migration/bootstrap checks."""
    init_db()


def ensure_user(uid: str, email: str, display_name: str) -> Dict[str, Any]:
    now = int(time.time())
    ref = _firestore().collection(USERS_COLLECTION).document(uid)
    snapshot = ref.get()
    existing = snapshot.to_dict() if snapshot.exists else {}
    credits_minor = int(existing.get("credits_minor", 0))
    ref.set(
        {
            "uid": uid,
            "email": email,
            "display_name": display_name,
            "credits_minor": credits_minor,
            "credits": _minor_to_credits(credits_minor),
            "created_at": int(existing.get("created_at", now)),
            "updated_at": now,
            "last_seen_at": now,
        },
        merge=True,
    )
    return get_user(uid)


def get_user(uid: str) -> Dict[str, Any]:
    snapshot = _firestore().collection(USERS_COLLECTION).document(uid).get()
    if not snapshot.exists:
        return {"uid": uid, "email": "", "displayName": "", "credits": 0.0}
    row = snapshot.to_dict() or {}
    return _user_dict_from_doc(row)


def list_users() -> List[Dict[str, Any]]:
    rows = (
        _firestore()
        .collection(USERS_COLLECTION)
        .order_by("last_seen_at", direction=firestore.Query.DESCENDING)
        .stream()
    )
    return [_user_dict_from_doc(row.to_dict() or {}) for row in rows]


def adjust_credits(
    uid: str,
    delta: float,
    reason: str,
    actor_uid: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
    allow_negative: bool = False,
) -> Dict[str, Any]:
    db = _firestore()
    user_ref = db.collection(USERS_COLLECTION).document(uid)
    ledger_ref = user_ref.collection(USER_LEDGER_SUBCOLLECTION).document(str(uuid.uuid4()))
    delta_minor = _credits_to_minor(delta)
    now = int(time.time())
    metadata_json = metadata or {}

    transaction = db.transaction()

    @firestore.transactional
    def apply_change(txn: firestore.Transaction) -> Dict[str, Any]:
        snapshot = user_ref.get(transaction=txn)
        if snapshot.exists:
            row = snapshot.to_dict() or {}
            current_minor = int(row.get("credits_minor", 0))
            created_at = int(row.get("created_at", now))
        else:
            row = {}
            current_minor = 0
            created_at = now

        next_minor = current_minor + delta_minor
        if not allow_negative and next_minor < 0:
            raise ValueError("INSUFFICIENT_CREDITS")

        txn.set(
            user_ref,
            {
                "uid": uid,
                "email": row.get("email", ""),
                "display_name": row.get("display_name", ""),
                "credits_minor": next_minor,
                "credits": _minor_to_credits(next_minor),
                "created_at": created_at,
                "updated_at": now,
                "last_seen_at": now,
            },
            merge=True,
        )
        txn.set(
            ledger_ref,
            {
                "id": ledger_ref.id,
                "uid": uid,
                "delta_minor": delta_minor,
                "delta": _minor_to_credits(delta_minor),
                "reason": reason,
                "actor_uid": actor_uid,
                "metadata": metadata_json,
                "created_at": now,
            },
        )

        return {
            "uid": uid,
            "email": row.get("email", ""),
            "displayName": row.get("display_name", ""),
            "credits": _minor_to_credits(next_minor),
            "createdAt": created_at,
            "updatedAt": now,
            "lastSeenAt": now,
        }

    return apply_change(transaction)


def create_credit_code(credits: float, max_claims: int, created_by: str) -> Dict[str, Any]:
    credits_minor = _credits_to_minor(credits)
    if credits_minor <= 0:
        raise ValueError("Credits must be positive")
    if max_claims <= 0:
        raise ValueError("Max claims must be positive")

    now = int(time.time())
    raw_code = _generate_code()
    code_hash = hash_credit_code(raw_code)
    code_preview = _preview_code(raw_code)
    _firestore().collection(CREDIT_CODES_COLLECTION).document(code_hash).set(
        {
            "code_hash": code_hash,
            "code_preview": code_preview,
            "credits_minor": credits_minor,
            "credits": _minor_to_credits(credits_minor),
            "max_claims": int(max_claims),
            "claimed_count": 0,
            "created_at": now,
            "created_by": created_by,
        }
    )
    return {
        "code": raw_code,
        "codePreview": code_preview,
        "credits": _minor_to_credits(credits_minor),
        "maxClaims": int(max_claims),
        "claimedCount": 0,
        "createdAt": now,
        "createdBy": created_by,
    }


def list_credit_codes() -> List[Dict[str, Any]]:
    rows = (
        _firestore()
        .collection(CREDIT_CODES_COLLECTION)
        .order_by("created_at", direction=firestore.Query.DESCENDING)
        .stream()
    )
    return [_credit_code_row_to_dict(row.to_dict() or {}) for row in rows]


def get_credit_code(code: str) -> Optional[Dict[str, Any]]:
    code_hash = hash_credit_code(code)
    snapshot = _firestore().collection(CREDIT_CODES_COLLECTION).document(code_hash).get()
    return _credit_code_row_to_dict(snapshot.to_dict() or {}) if snapshot.exists else None


def redeem_credit_code(code: str, uid: str) -> Dict[str, Any]:
    normalized = code.strip().upper()
    code_hash = hash_credit_code(normalized)
    now = int(time.time())

    db = _firestore()
    code_ref = db.collection(CREDIT_CODES_COLLECTION).document(code_hash)
    claim_ref = code_ref.collection(CODE_CLAIMS_SUBCOLLECTION).document(uid)
    user_ref = db.collection(USERS_COLLECTION).document(uid)
    ledger_ref = user_ref.collection(USER_LEDGER_SUBCOLLECTION).document(str(uuid.uuid4()))
    transaction = db.transaction()

    @firestore.transactional
    def redeem(txn: firestore.Transaction) -> Dict[str, Any]:
        code_snap = code_ref.get(transaction=txn)
        if not code_snap.exists:
            return {"success": False, "message": "Invalid code. Please check and try again."}

        code_row = code_snap.to_dict() or {}
        claim_snap = claim_ref.get(transaction=txn)
        if claim_snap.exists:
            return {"success": False, "message": "You have already used this code."}

        claimed_count = int(code_row.get("claimed_count", 0))
        max_claims = int(code_row.get("max_claims", 0))
        if claimed_count >= max_claims:
            return {"success": False, "message": "This code has expired (max claims reached)."}

        user_snap = user_ref.get(transaction=txn)
        if user_snap.exists:
            user_row = user_snap.to_dict() or {}
            current_minor = int(user_row.get("credits_minor", 0))
            created_at = int(user_row.get("created_at", now))
        else:
            user_row = {}
            current_minor = 0
            created_at = now

        credits_minor = int(code_row.get("credits_minor", 0))
        next_minor = current_minor + credits_minor

        txn.set(
            claim_ref,
            {
                "code_hash": code_hash,
                "uid": uid,
                "claimed_at": now,
            },
        )
        txn.update(code_ref, {"claimed_count": claimed_count + 1})
        txn.set(
            user_ref,
            {
                "uid": uid,
                "email": user_row.get("email", ""),
                "display_name": user_row.get("display_name", ""),
                "credits_minor": next_minor,
                "credits": _minor_to_credits(next_minor),
                "created_at": created_at,
                "updated_at": now,
                "last_seen_at": now,
            },
            merge=True,
        )
        txn.set(
            ledger_ref,
            {
                "id": ledger_ref.id,
                "uid": uid,
                "delta_minor": credits_minor,
                "delta": _minor_to_credits(credits_minor),
                "reason": "credit_code_redeem",
                "actor_uid": uid,
                "metadata": {"code_preview": code_row.get("code_preview", "")},
                "created_at": now,
            },
        )

        credits = _minor_to_credits(credits_minor)
        return {
            "success": True,
            "message": f"+{credits:g} credit{'s' if credits != 1 else ''} added to your account!",
            "credits": credits,
            "balance": _minor_to_credits(next_minor),
        }

    return redeem(transaction)


def add_history_entry(uid: str, image_url: Optional[str], caption: Optional[str], prompt: str, model: str) -> Dict[str, Any]:
    entry_id = str(uuid.uuid4())
    created_at = int(time.time())
    _firestore().collection(USERS_COLLECTION).document(uid).collection(USER_HISTORY_SUBCOLLECTION).document(entry_id).set(
        {
            "id": entry_id,
            "uid": uid,
            "image_url": image_url,
            "caption": caption,
            "prompt": prompt,
            "model": model,
            "created_at": created_at,
        }
    )
    return {
        "id": entry_id,
        "imageUrl": image_url,
        "caption": caption,
        "prompt": prompt,
        "model": model,
        "createdAt": created_at,
    }


def get_history(uid: str, max_items: int = 20) -> List[Dict[str, Any]]:
    rows = (
        _firestore()
        .collection(USERS_COLLECTION)
        .document(uid)
        .collection(USER_HISTORY_SUBCOLLECTION)
        .order_by("created_at", direction=firestore.Query.DESCENDING)
        .limit(max_items)
        .stream()
    )
    entries: List[Dict[str, Any]] = []
    for row in rows:
        data = row.to_dict() or {}
        entries.append(
            {
                "id": row.id,
                "imageUrl": data.get("image_url"),
                "caption": data.get("caption"),
                "prompt": data.get("prompt", ""),
                "model": data.get("model", ""),
                "createdAt": int(data.get("created_at", 0)),
            }
        )
    return entries


def create_analyze_session(uid: str, prompt: str, fee: float) -> Dict[str, Any]:
    session_id = str(uuid.uuid4())
    now = int(time.time())
    fee_minor = _credits_to_minor(fee)
    _firestore().collection(ANALYZE_SESSIONS_COLLECTION).document(session_id).set(
        {
            "id": session_id,
            "uid": uid,
            "fee_minor": fee_minor,
            "fee": _minor_to_credits(fee_minor),
            "status": "pending",
            "prompt": prompt,
            "created_at": now,
            "resolved_at": None,
        }
    )
    return {"id": session_id, "fee": _minor_to_credits(fee_minor), "status": "pending", "createdAt": now}


def complete_analyze_session(session_id: str, uid: str) -> Dict[str, Any]:
    db = _firestore()
    session_ref = db.collection(ANALYZE_SESSIONS_COLLECTION).document(session_id)
    transaction = db.transaction()

    @firestore.transactional
    def complete(txn: firestore.Transaction) -> Dict[str, Any]:
        snap = session_ref.get(transaction=txn)
        if not snap.exists:
            raise ValueError("SESSION_NOT_FOUND")
        row = snap.to_dict() or {}
        if row.get("uid") != uid:
            raise ValueError("SESSION_NOT_FOUND")
        fee = _minor_to_credits(int(row.get("fee_minor", 0)))
        status = row.get("status")
        if status in {"completed", "abandoned"}:
            return {"id": session_id, "status": status, "fee": fee}
        txn.update(session_ref, {"status": "completed", "resolved_at": int(time.time())})
        return {"id": session_id, "status": "completed", "fee": fee}

    return complete(transaction)


def abandon_analyze_session(session_id: str, uid: str) -> Dict[str, Any]:
    db = _firestore()
    session_ref = db.collection(ANALYZE_SESSIONS_COLLECTION).document(session_id)
    user_ref = db.collection(USERS_COLLECTION).document(uid)
    ledger_ref = user_ref.collection(USER_LEDGER_SUBCOLLECTION).document(str(uuid.uuid4()))
    transaction = db.transaction()
    now = int(time.time())

    @firestore.transactional
    def abandon(txn: firestore.Transaction) -> Dict[str, Any]:
        session_snap = session_ref.get(transaction=txn)
        if not session_snap.exists:
            raise ValueError("SESSION_NOT_FOUND")

        row = session_snap.to_dict() or {}
        if row.get("uid") != uid:
            raise ValueError("SESSION_NOT_FOUND")

        fee_minor = int(row.get("fee_minor", 0))
        fee = _minor_to_credits(fee_minor)
        status = row.get("status")

        user_snap = user_ref.get(transaction=txn)
        user_row = user_snap.to_dict() or {}
        current_minor = int(user_row.get("credits_minor", 0))
        created_at = int(user_row.get("created_at", now)) if user_snap.exists else now

        if status == "abandoned":
            return {"id": session_id, "status": "abandoned", "fee": fee, "balance": _minor_to_credits(current_minor)}
        if status == "completed":
            return {"id": session_id, "status": "completed", "fee": fee, "balance": _minor_to_credits(current_minor)}

        next_minor = current_minor - fee_minor
        if next_minor < 0:
            raise ValueError("INSUFFICIENT_CREDITS")

        txn.update(session_ref, {"status": "abandoned", "resolved_at": now})
        txn.set(
            user_ref,
            {
                "uid": uid,
                "email": user_row.get("email", ""),
                "display_name": user_row.get("display_name", ""),
                "credits_minor": next_minor,
                "credits": _minor_to_credits(next_minor),
                "created_at": created_at,
                "updated_at": now,
                "last_seen_at": now,
            },
            merge=True,
        )
        txn.set(
            ledger_ref,
            {
                "id": ledger_ref.id,
                "uid": uid,
                "delta_minor": -fee_minor,
                "delta": -fee,
                "reason": "analyze_abandon_charge",
                "actor_uid": uid,
                "metadata": {"analyze_session_id": session_id},
                "created_at": now,
            },
        )
        return {"id": session_id, "status": "abandoned", "fee": fee, "balance": _minor_to_credits(next_minor)}

    return abandon(transaction)


def consume_rate_limit(key: str, max_count: int, window_seconds: int) -> bool:
    db = _firestore()
    now = int(time.time())
    reset_at = now + window_seconds
    hashed_key = hashlib.sha256(key.encode("utf-8")).hexdigest()
    ref = db.collection(RATE_LIMITS_COLLECTION).document(hashed_key)
    transaction = db.transaction()

    @firestore.transactional
    def consume(txn: firestore.Transaction) -> bool:
        snap = ref.get(transaction=txn)
        if not snap.exists:
            txn.set(ref, {"key": key, "count": 1, "reset_at": reset_at})
            return True

        row = snap.to_dict() or {}
        current_reset_at = int(row.get("reset_at", 0))
        current_count = int(row.get("count", 0))
        if current_reset_at <= now:
            txn.set(ref, {"key": key, "count": 1, "reset_at": reset_at})
            return True
        if current_count >= max_count:
            return False
        txn.update(ref, {"count": current_count + 1})
        return True

    return consume(transaction)


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


def _user_dict_from_doc(row: Dict[str, Any]) -> Dict[str, Any]:
    is_suspended = bool(
        row.get("is_suspended")
        or row.get("isSuspended")
        or row.get("suspended")
    )
    return {
        "uid": row.get("uid", ""),
        "email": row.get("email", ""),
        "displayName": row.get("display_name", ""),
        "credits": _minor_to_credits(int(row.get("credits_minor", 0))),
        "createdAt": row.get("created_at"),
        "updatedAt": row.get("updated_at"),
        "lastSeenAt": row.get("last_seen_at"),
        "isSuspended": is_suspended,
        "suspensionReason": row.get("suspension_reason") or row.get("suspensionReason") or "",
    }


def _credit_code_row_to_dict(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "code": row.get("code_preview", ""),
        "codePreview": row.get("code_preview", ""),
        "credits": _minor_to_credits(int(row.get("credits_minor", 0))),
        "maxClaims": int(row.get("max_claims", 0)),
        "claimedCount": int(row.get("claimed_count", 0)),
        "createdAt": row.get("created_at"),
        "createdBy": row.get("created_by"),
    }


def _migrate_sqlite_to_firestore(db: firestore.Client) -> Dict[str, int]:
    path = Path(settings.security_db_path)
    if not path.exists():
        return {"users": 0, "credit_codes": 0, "claims": 0, "ledger": 0, "history": 0, "sessions": 0}

    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    try:
        tables = {row["name"] for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
        counts = {"users": 0, "credit_codes": 0, "claims": 0, "ledger": 0, "history": 0, "sessions": 0}

        def columns(table: str) -> set[str]:
            return {str(row["name"]) for row in conn.execute(f"PRAGMA table_info({table})")}

        if "users" in tables:
            user_cols = columns("users")
            for row in conn.execute("SELECT * FROM users"):
                credits_minor = int(row["credits_minor"]) if "credits_minor" in user_cols else _credits_to_minor(row["credits"])
                db.collection(USERS_COLLECTION).document(row["uid"]).set(
                    {
                        "uid": row["uid"],
                        "email": row["email"],
                        "display_name": row["display_name"],
                        "credits_minor": credits_minor,
                        "credits": _minor_to_credits(credits_minor),
                        "created_at": int(row["created_at"]),
                        "updated_at": int(row["updated_at"]),
                        "last_seen_at": int(row["last_seen_at"]),
                    }
                )
                counts["users"] += 1

        if "credit_codes" in tables:
            code_cols = columns("credit_codes")
            for row in conn.execute("SELECT * FROM credit_codes"):
                code_hash = row["code_hash"] if "code_hash" in code_cols else hash_credit_code(row["code"])
                code_preview = row["code_preview"] if "code_preview" in code_cols else _preview_code(row["code"])
                credits_minor = int(row["credits_minor"]) if "credits_minor" in code_cols else _credits_to_minor(row["credits"])
                db.collection(CREDIT_CODES_COLLECTION).document(code_hash).set(
                    {
                        "code_hash": code_hash,
                        "code_preview": code_preview,
                        "credits_minor": credits_minor,
                        "credits": _minor_to_credits(credits_minor),
                        "max_claims": int(row["max_claims"]),
                        "claimed_count": int(row["claimed_count"]),
                        "created_at": int(row["created_at"]),
                        "created_by": row["created_by"],
                    }
                )
                counts["credit_codes"] += 1

        if "credit_code_claims" in tables:
            claim_cols = columns("credit_code_claims")
            for row in conn.execute("SELECT * FROM credit_code_claims"):
                code_hash = row["code_hash"] if "code_hash" in claim_cols else hash_credit_code(row["code"])
                db.collection(CREDIT_CODES_COLLECTION).document(code_hash).collection(CODE_CLAIMS_SUBCOLLECTION).document(row["uid"]).set(
                    {
                        "code_hash": code_hash,
                        "uid": row["uid"],
                        "claimed_at": int(row["claimed_at"]),
                    }
                )
                counts["claims"] += 1

        if "credit_ledger" in tables:
            ledger_cols = columns("credit_ledger")
            for row in conn.execute("SELECT * FROM credit_ledger"):
                delta_minor = int(row["delta_minor"]) if "delta_minor" in ledger_cols else _credits_to_minor(row["delta"])
                metadata_value = row["metadata"]
                if isinstance(metadata_value, str):
                    try:
                        metadata_value = json.loads(metadata_value)
                    except json.JSONDecodeError:
                        metadata_value = {"raw": metadata_value}
                db.collection(USERS_COLLECTION).document(row["uid"]).collection(USER_LEDGER_SUBCOLLECTION).document(str(row["id"])).set(
                    {
                        "id": str(row["id"]),
                        "uid": row["uid"],
                        "delta_minor": delta_minor,
                        "delta": _minor_to_credits(delta_minor),
                        "reason": row["reason"],
                        "actor_uid": row["actor_uid"],
                        "metadata": metadata_value or {},
                        "created_at": int(row["created_at"]),
                    }
                )
                counts["ledger"] += 1

        if "history" in tables:
            for row in conn.execute("SELECT * FROM history"):
                db.collection(USERS_COLLECTION).document(row["uid"]).collection(USER_HISTORY_SUBCOLLECTION).document(row["id"]).set(
                    {
                        "id": row["id"],
                        "uid": row["uid"],
                        "image_url": row["image_url"],
                        "caption": row["caption"],
                        "prompt": row["prompt"],
                        "model": row["model"],
                        "created_at": int(row["created_at"]),
                    }
                )
                counts["history"] += 1

        if "analyze_sessions" in tables:
            session_cols = columns("analyze_sessions")
            for row in conn.execute("SELECT * FROM analyze_sessions"):
                fee_minor = int(row["fee_minor"]) if "fee_minor" in session_cols else _credits_to_minor(row["fee"])
                db.collection(ANALYZE_SESSIONS_COLLECTION).document(row["id"]).set(
                    {
                        "id": row["id"],
                        "uid": row["uid"],
                        "fee_minor": fee_minor,
                        "fee": _minor_to_credits(fee_minor),
                        "status": row["status"],
                        "prompt": row["prompt"],
                        "created_at": int(row["created_at"]),
                        "resolved_at": row["resolved_at"],
                    }
                )
                counts["sessions"] += 1

        return counts
    finally:
        conn.close()
