import json
import os
import secrets
import sqlite3
import time
import uuid
from contextlib import contextmanager
from typing import Any, Dict, List, Optional

from app.config import settings


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(settings.security_db_path)
    conn.row_factory = sqlite3.Row
    return conn


@contextmanager
def _tx():
    conn = _connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    with _connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                uid TEXT PRIMARY KEY,
                email TEXT NOT NULL DEFAULT '',
                display_name TEXT NOT NULL DEFAULT '',
                credits REAL NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                last_seen_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS credit_codes (
                code TEXT PRIMARY KEY,
                credits REAL NOT NULL,
                max_claims INTEGER NOT NULL,
                claimed_count INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                created_by TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS credit_code_claims (
                code TEXT NOT NULL,
                uid TEXT NOT NULL,
                claimed_at INTEGER NOT NULL,
                PRIMARY KEY (code, uid)
            );

            CREATE TABLE IF NOT EXISTS history (
                id TEXT PRIMARY KEY,
                uid TEXT NOT NULL,
                image_url TEXT,
                caption TEXT,
                prompt TEXT NOT NULL,
                model TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS credit_ledger (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                uid TEXT NOT NULL,
                delta REAL NOT NULL,
                reason TEXT NOT NULL,
                actor_uid TEXT,
                metadata TEXT NOT NULL DEFAULT '{}',
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS rate_limits (
                key TEXT PRIMARY KEY,
                count INTEGER NOT NULL,
                reset_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS analyze_sessions (
                id TEXT PRIMARY KEY,
                uid TEXT NOT NULL,
                fee REAL NOT NULL,
                status TEXT NOT NULL,
                prompt TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                resolved_at INTEGER
            );

            CREATE INDEX IF NOT EXISTS idx_history_uid_created_at
                ON history(uid, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_ledger_uid_created_at
                ON credit_ledger(uid, created_at DESC);
            """
        )
    os.chmod(settings.security_db_path, 0o600)


def ensure_user(uid: str, email: str, display_name: str) -> Dict[str, Any]:
    now = int(time.time())
    with _tx() as conn:
        row = conn.execute("SELECT uid FROM users WHERE uid = ?", (uid,)).fetchone()
        if row:
            conn.execute(
                """
                UPDATE users
                SET email = ?, display_name = ?, updated_at = ?, last_seen_at = ?
                WHERE uid = ?
                """,
                (email, display_name, now, now, uid),
            )
        else:
            conn.execute(
                """
                INSERT INTO users (uid, email, display_name, credits, created_at, updated_at, last_seen_at)
                VALUES (?, ?, ?, 0, ?, ?, ?)
                """,
                (uid, email, display_name, now, now, now),
            )
    return get_user(uid)


def get_user(uid: str) -> Dict[str, Any]:
    with _connect() as conn:
        row = conn.execute(
            "SELECT uid, email, display_name, credits, created_at, updated_at, last_seen_at FROM users WHERE uid = ?",
            (uid,),
        ).fetchone()
    if not row:
        return {
            "uid": uid,
            "email": "",
            "displayName": "",
            "credits": 0.0,
        }
    return {
        "uid": row["uid"],
        "email": row["email"],
        "displayName": row["display_name"],
        "credits": float(row["credits"]),
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "lastSeenAt": row["last_seen_at"],
    }


def list_users() -> List[Dict[str, Any]]:
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT uid, email, display_name, credits, last_seen_at
            FROM users
            ORDER BY last_seen_at DESC, created_at DESC
            """
        ).fetchall()
    return [
        {
            "uid": row["uid"],
            "email": row["email"],
            "displayName": row["display_name"],
            "credits": float(row["credits"]),
            "lastSeenAt": row["last_seen_at"],
        }
        for row in rows
    ]


def adjust_credits(
    uid: str,
    delta: float,
    reason: str,
    actor_uid: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
    allow_negative: bool = False,
) -> Dict[str, Any]:
    now = int(time.time())
    metadata_json = json.dumps(metadata or {}, ensure_ascii=True)

    with _tx() as conn:
        row = conn.execute(
            "SELECT uid, email, display_name, credits FROM users WHERE uid = ?",
            (uid,),
        ).fetchone()
        if not row:
            conn.execute(
                """
                INSERT INTO users (uid, email, display_name, credits, created_at, updated_at, last_seen_at)
                VALUES (?, '', '', 0, ?, ?, ?)
                """,
                (uid, now, now, now),
            )
            current_credits = 0.0
        else:
            current_credits = float(row["credits"])

        next_credits = round(current_credits + float(delta), 2)
        if not allow_negative and next_credits < 0:
            raise ValueError("INSUFFICIENT_CREDITS")

        conn.execute(
            "UPDATE users SET credits = ?, updated_at = ?, last_seen_at = ? WHERE uid = ?",
            (next_credits, now, now, uid),
        )
        conn.execute(
            """
            INSERT INTO credit_ledger (uid, delta, reason, actor_uid, metadata, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (uid, float(delta), reason, actor_uid, metadata_json, now),
        )

    return get_user(uid)


def create_credit_code(credits: float, max_claims: int, created_by: str) -> Dict[str, Any]:
    if credits <= 0:
        raise ValueError("Credits must be positive")
    if max_claims <= 0:
        raise ValueError("Max claims must be positive")

    now = int(time.time())
    code = _generate_code()
    with _tx() as conn:
        conn.execute(
            """
            INSERT INTO credit_codes (code, credits, max_claims, claimed_count, created_at, created_by)
            VALUES (?, ?, ?, 0, ?, ?)
            """,
            (code, float(credits), int(max_claims), now, created_by),
        )
    return get_credit_code(code)


def list_credit_codes() -> List[Dict[str, Any]]:
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT code, credits, max_claims, claimed_count, created_at, created_by
            FROM credit_codes
            ORDER BY created_at DESC
            """
        ).fetchall()
    return [_credit_code_row_to_dict(row) for row in rows]


def get_credit_code(code: str) -> Optional[Dict[str, Any]]:
    with _connect() as conn:
        row = conn.execute(
            """
            SELECT code, credits, max_claims, claimed_count, created_at, created_by
            FROM credit_codes
            WHERE code = ?
            """,
            (code,),
        ).fetchone()
    return _credit_code_row_to_dict(row) if row else None


def redeem_credit_code(code: str, uid: str) -> Dict[str, Any]:
    normalized = code.strip().upper()
    now = int(time.time())

    with _tx() as conn:
        code_row = conn.execute(
            """
            SELECT code, credits, max_claims, claimed_count, created_at, created_by
            FROM credit_codes
            WHERE code = ?
            """,
            (normalized,),
        ).fetchone()
        if not code_row:
            return {"success": False, "message": "Invalid code. Please check and try again."}

        already_claimed = conn.execute(
            "SELECT 1 FROM credit_code_claims WHERE code = ? AND uid = ?",
            (normalized, uid),
        ).fetchone()
        if already_claimed:
            return {"success": False, "message": "You have already used this code."}

        if int(code_row["claimed_count"]) >= int(code_row["max_claims"]):
            return {"success": False, "message": "This code has expired (max claims reached)."}

        conn.execute(
            "INSERT INTO credit_code_claims (code, uid, claimed_at) VALUES (?, ?, ?)",
            (normalized, uid, now),
        )
        conn.execute(
            "UPDATE credit_codes SET claimed_count = claimed_count + 1 WHERE code = ?",
            (normalized,),
        )

    user = adjust_credits(
        uid,
        float(code_row["credits"]),
        "credit_code_redeem",
        actor_uid=uid,
        metadata={"code": normalized},
    )
    credits = float(code_row["credits"])
    return {
        "success": True,
        "message": f"+{credits:g} credit{'s' if credits != 1 else ''} added to your account!",
        "credits": credits,
        "balance": user["credits"],
    }


def add_history_entry(uid: str, image_url: Optional[str], caption: Optional[str], prompt: str, model: str) -> Dict[str, Any]:
    entry_id = str(uuid.uuid4())
    created_at = int(time.time())
    with _tx() as conn:
        conn.execute(
            """
            INSERT INTO history (id, uid, image_url, caption, prompt, model, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (entry_id, uid, image_url, caption, prompt, model, created_at),
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
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT id, image_url, caption, prompt, model, created_at
            FROM history
            WHERE uid = ?
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (uid, max_items),
        ).fetchall()
    return [
        {
            "id": row["id"],
            "imageUrl": row["image_url"],
            "caption": row["caption"],
            "prompt": row["prompt"],
            "model": row["model"],
            "createdAt": row["created_at"],
        }
        for row in rows
    ]


def create_analyze_session(uid: str, prompt: str, fee: float) -> Dict[str, Any]:
    session_id = str(uuid.uuid4())
    now = int(time.time())
    with _tx() as conn:
        conn.execute(
            """
            INSERT INTO analyze_sessions (id, uid, fee, status, prompt, created_at, resolved_at)
            VALUES (?, ?, ?, 'pending', ?, ?, NULL)
            """,
            (session_id, uid, float(fee), prompt, now),
        )
    return {
        "id": session_id,
        "fee": float(fee),
        "status": "pending",
        "createdAt": now,
    }


def complete_analyze_session(session_id: str, uid: str) -> Dict[str, Any]:
    now = int(time.time())
    with _tx() as conn:
        row = conn.execute(
            "SELECT id, uid, fee, status FROM analyze_sessions WHERE id = ?",
            (session_id,),
        ).fetchone()
        if not row or row["uid"] != uid:
            raise ValueError("SESSION_NOT_FOUND")
        if row["status"] == "completed":
            return {"id": session_id, "status": "completed", "fee": float(row["fee"])}
        if row["status"] == "abandoned":
            return {"id": session_id, "status": "abandoned", "fee": float(row["fee"])}
        conn.execute(
            "UPDATE analyze_sessions SET status = 'completed', resolved_at = ? WHERE id = ?",
            (now, session_id),
        )
    return {"id": session_id, "status": "completed", "fee": float(row["fee"])}


def abandon_analyze_session(session_id: str, uid: str) -> Dict[str, Any]:
    now = int(time.time())
    with _tx() as conn:
        row = conn.execute(
            "SELECT id, uid, fee, status FROM analyze_sessions WHERE id = ?",
            (session_id,),
        ).fetchone()
        if not row or row["uid"] != uid:
            raise ValueError("SESSION_NOT_FOUND")
        if row["status"] == "abandoned":
            user = get_user(uid)
            return {"id": session_id, "status": "abandoned", "fee": float(row["fee"]), "balance": user["credits"]}
        if row["status"] == "completed":
            user = get_user(uid)
            return {"id": session_id, "status": "completed", "fee": float(row["fee"]), "balance": user["credits"]}
        conn.execute(
            "UPDATE analyze_sessions SET status = 'abandoned', resolved_at = ? WHERE id = ?",
            (now, session_id),
        )

    user = adjust_credits(
        uid,
        -float(row["fee"]),
        "analyze_abandon_charge",
        actor_uid=uid,
        metadata={"analyze_session_id": session_id},
    )
    return {"id": session_id, "status": "abandoned", "fee": float(row["fee"]), "balance": user["credits"]}


def consume_rate_limit(key: str, max_count: int, window_seconds: int) -> bool:
    now = int(time.time())
    reset_at = now + window_seconds

    with _tx() as conn:
        row = conn.execute(
            "SELECT count, reset_at FROM rate_limits WHERE key = ?",
            (key,),
        ).fetchone()

        if not row or int(row["reset_at"]) <= now:
            conn.execute(
                """
                INSERT INTO rate_limits (key, count, reset_at)
                VALUES (?, 1, ?)
                ON CONFLICT(key) DO UPDATE SET count = 1, reset_at = excluded.reset_at
                """,
                (key, reset_at),
            )
            return True

        if int(row["count"]) >= max_count:
            return False

        conn.execute(
            "UPDATE rate_limits SET count = count + 1 WHERE key = ?",
            (key,),
        )
        return True


def _generate_code() -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "NV-" + "".join(secrets.choice(alphabet) for _ in range(10))


def _credit_code_row_to_dict(row: sqlite3.Row) -> Dict[str, Any]:
    return {
        "code": row["code"],
        "credits": float(row["credits"]),
        "maxClaims": int(row["max_claims"]),
        "claimedCount": int(row["claimed_count"]),
        "createdAt": row["created_at"],
        "createdBy": row["created_by"],
    }


init_db()
