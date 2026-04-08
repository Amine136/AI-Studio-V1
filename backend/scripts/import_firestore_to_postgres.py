from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from google.cloud import firestore
from google.oauth2 import service_account
from sqlalchemy import delete, func, select

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.config import settings
from app.db.models import AnalyzeSession, CreditCode, CreditCodeClaim, CreditLedgerEntry, HistoryEntry, User
from app.db.session import session_scope

CREDIT_SCALE = 100

META_COLLECTION = "_meta"
USERS_COLLECTION = "users"
CREDIT_CODES_COLLECTION = "credit_codes"
ANALYZE_SESSIONS_COLLECTION = "analyze_sessions"

USER_LEDGER_SUBCOLLECTION = "ledger"
USER_HISTORY_SUBCOLLECTION = "history"
CODE_CLAIMS_SUBCOLLECTION = "claims"


@dataclass
class ImportStats:
    users: int = 0
    credit_codes: int = 0
    claims: int = 0
    ledger: int = 0
    history: int = 0
    sessions: int = 0
    skipped_claims: int = 0
    skipped_ledger: int = 0
    skipped_history: int = 0
    anomalies: list[str] = field(default_factory=list)


def _firestore() -> firestore.Client:
    kwargs: dict[str, Any] = {
        "project": settings.firestore_project_id,
        "database": settings.firestore_database,
    }
    if settings.firebase_credentials_path:
        credentials = service_account.Credentials.from_service_account_file(
            settings.firebase_credentials_path
        )
        kwargs["credentials"] = credentials
    return firestore.Client(**kwargs)


def _credits_to_minor(value: Any) -> int:
    return int(round(float(value) * CREDIT_SCALE))


def _metadata_to_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return {"raw": value}
        return parsed if isinstance(parsed, dict) else {"value": parsed}
    if value is None:
        return {}
    return {"value": value}


def _int_or_none(value: Any) -> int | None:
    if value is None:
        return None
    return int(value)


def _load_firestore_snapshot(db: firestore.Client) -> dict[str, Any]:
    users: list[dict[str, Any]] = []
    credit_codes: list[dict[str, Any]] = []
    sessions: list[dict[str, Any]] = []
    claims: list[dict[str, Any]] = []
    ledger_entries: list[dict[str, Any]] = []
    history_entries: list[dict[str, Any]] = []

    for doc in db.collection(USERS_COLLECTION).stream():
        row = doc.to_dict() or {}
        row["uid"] = row.get("uid") or doc.id
        users.append(row)

        for ledger_doc in doc.reference.collection(USER_LEDGER_SUBCOLLECTION).stream():
            ledger_row = ledger_doc.to_dict() or {}
            ledger_row["id"] = str(ledger_row.get("id") or ledger_doc.id)
            ledger_row["uid"] = ledger_row.get("uid") or row["uid"]
            ledger_entries.append(ledger_row)

        for history_doc in doc.reference.collection(USER_HISTORY_SUBCOLLECTION).stream():
            history_row = history_doc.to_dict() or {}
            history_row["id"] = str(history_row.get("id") or history_doc.id)
            history_row["uid"] = history_row.get("uid") or row["uid"]
            history_entries.append(history_row)

    for doc in db.collection(CREDIT_CODES_COLLECTION).stream():
        row = doc.to_dict() or {}
        row["code_hash"] = row.get("code_hash") or doc.id
        credit_codes.append(row)

        for claim_doc in doc.reference.collection(CODE_CLAIMS_SUBCOLLECTION).stream():
            claim_row = claim_doc.to_dict() or {}
            claim_row["code_hash"] = claim_row.get("code_hash") or row["code_hash"]
            claim_row["uid"] = claim_row.get("uid") or claim_doc.id
            claims.append(claim_row)

    for doc in db.collection(ANALYZE_SESSIONS_COLLECTION).stream():
        row = doc.to_dict() or {}
        row["id"] = row.get("id") or doc.id
        sessions.append(row)

    return {
        "users": users,
        "credit_codes": credit_codes,
        "claims": claims,
        "ledger": ledger_entries,
        "history": history_entries,
        "sessions": sessions,
    }


def _clear_target_tables() -> None:
    with session_scope() as session:
        session.execute(delete(HistoryEntry))
        session.execute(delete(CreditLedgerEntry))
        session.execute(delete(CreditCodeClaim))
        session.execute(delete(AnalyzeSession))
        session.execute(delete(CreditCode))
        session.execute(delete(User))


def _import_users(session_data: dict[str, Any], stats: ImportStats) -> set[str]:
    user_ids: set[str] = set()
    with session_scope() as session:
        for row in session_data["users"]:
            uid = str(row["uid"])
            user = User(
                uid=uid,
                email=str(row.get("email") or ""),
                display_name=str(row.get("display_name") or ""),
                credits_minor=int(row.get("credits_minor", _credits_to_minor(row.get("credits", 0)))),
                reserved_credits_minor=0,
                created_at=int(row.get("created_at") or 0),
                updated_at=int(row.get("updated_at") or row.get("created_at") or 0),
                last_seen_at=int(row.get("last_seen_at") or row.get("updated_at") or row.get("created_at") or 0),
                is_suspended=bool(row.get("is_suspended") or row.get("isSuspended") or row.get("suspended")),
                suspension_reason=row.get("suspension_reason") or row.get("suspensionReason"),
            )
            session.merge(user)
            user_ids.add(uid)
            stats.users += 1
    return user_ids


def _import_credit_codes(session_data: dict[str, Any], user_ids: set[str], stats: ImportStats) -> set[str]:
    code_hashes: set[str] = set()
    with session_scope() as session:
        for row in session_data["credit_codes"]:
            code_hash = str(row["code_hash"])
            created_by = row.get("created_by")
            if created_by and str(created_by) not in user_ids:
                stats.anomalies.append(f"credit_code:{code_hash}: missing created_by user {created_by}, imported as null")
                created_by = None

            credit_code = CreditCode(
                code_hash=code_hash,
                code_preview=str(row.get("code_preview") or ""),
                credits_minor=int(row.get("credits_minor", _credits_to_minor(row.get("credits", 0)))),
                max_claims=int(row.get("max_claims") or 0),
                claimed_count=int(row.get("claimed_count") or 0),
                created_at=int(row.get("created_at") or 0),
                created_by=str(created_by) if created_by else None,
                is_active=bool(row.get("is_active", True)),
                expires_at=_int_or_none(row.get("expires_at")),
            )
            session.merge(credit_code)
            code_hashes.add(code_hash)
            stats.credit_codes += 1
    return code_hashes


def _import_sessions(session_data: dict[str, Any], user_ids: set[str], stats: ImportStats) -> set[str]:
    session_ids: set[str] = set()
    with session_scope() as session:
        for row in session_data["sessions"]:
            uid = str(row.get("uid") or "")
            if uid not in user_ids:
                stats.anomalies.append(f"analyze_session:{row.get('id')}: missing user {uid}, skipped")
                continue
            analyze_session = AnalyzeSession(
                id=str(row["id"]),
                uid=uid,
                fee_minor=int(row.get("fee_minor", _credits_to_minor(row.get("fee", 0)))),
                status=str(row.get("status") or "pending"),
                prompt=str(row.get("prompt") or ""),
                created_at=int(row.get("created_at") or 0),
                resolved_at=_int_or_none(row.get("resolved_at")),
            )
            session.merge(analyze_session)
            session_ids.add(analyze_session.id)
            stats.sessions += 1
    return session_ids


def _import_claims(session_data: dict[str, Any], user_ids: set[str], code_hashes: set[str], stats: ImportStats) -> None:
    with session_scope() as session:
        for row in session_data["claims"]:
            uid = str(row.get("uid") or "")
            code_hash = str(row.get("code_hash") or "")
            if uid not in user_ids or code_hash not in code_hashes:
                stats.skipped_claims += 1
                stats.anomalies.append(f"claim:{code_hash}:{uid}: missing user or code, skipped")
                continue
            existing = session.execute(
                select(CreditCodeClaim).where(
                    CreditCodeClaim.code_hash == code_hash,
                    CreditCodeClaim.uid == uid,
                )
            ).scalar_one_or_none()
            if existing is None:
                claim = CreditCodeClaim(
                    code_hash=code_hash,
                    uid=uid,
                    claimed_at=int(row.get("claimed_at") or 0),
                )
                session.add(claim)
            else:
                existing.claimed_at = int(row.get("claimed_at") or existing.claimed_at or 0)
            stats.claims += 1


def _import_ledger(session_data: dict[str, Any], user_ids: set[str], code_hashes: set[str], analyze_session_ids: set[str], stats: ImportStats) -> None:
    with session_scope() as session:
        for row in session_data["ledger"]:
            uid = str(row.get("uid") or "")
            if uid not in user_ids:
                stats.skipped_ledger += 1
                stats.anomalies.append(f"ledger:{row.get('id')}: missing user {uid}, skipped")
                continue

            actor_uid = row.get("actor_uid")
            if actor_uid and str(actor_uid) not in user_ids:
                stats.anomalies.append(f"ledger:{row.get('id')}: missing actor user {actor_uid}, imported as null")
                actor_uid = None

            metadata = _metadata_to_dict(row.get("metadata"))
            code_hash = row.get("code_hash")
            if not code_hash:
                candidate = metadata.get("code_hash")
                code_hash = str(candidate) if candidate else None
            if code_hash and str(code_hash) not in code_hashes:
                stats.anomalies.append(f"ledger:{row.get('id')}: missing code {code_hash}, imported as null")
                code_hash = None

            analyze_session_id = row.get("analyze_session_id") or metadata.get("analyze_session_id")
            if analyze_session_id and str(analyze_session_id) not in analyze_session_ids:
                stats.anomalies.append(
                    f"ledger:{row.get('id')}: missing analyze session {analyze_session_id}, imported as null"
                )
                analyze_session_id = None

            entry = CreditLedgerEntry(
                id=str(row.get("id")),
                uid=uid,
                delta_minor=int(row.get("delta_minor", _credits_to_minor(row.get("delta", 0)))),
                reason=str(row.get("reason") or ""),
                actor_uid=str(actor_uid) if actor_uid else None,
                metadata_json=metadata,
                code_hash=str(code_hash) if code_hash else None,
                analyze_session_id=str(analyze_session_id) if analyze_session_id else None,
                created_at=int(row.get("created_at") or 0),
            )
            session.merge(entry)
            stats.ledger += 1


def _import_history(session_data: dict[str, Any], user_ids: set[str], stats: ImportStats) -> None:
    with session_scope() as session:
        for row in session_data["history"]:
            uid = str(row.get("uid") or "")
            if uid not in user_ids:
                stats.skipped_history += 1
                stats.anomalies.append(f"history:{row.get('id')}: missing user {uid}, skipped")
                continue
            entry = HistoryEntry(
                id=str(row.get("id")),
                uid=uid,
                image_url=row.get("image_url"),
                caption=row.get("caption"),
                prompt=str(row.get("prompt") or ""),
                model=str(row.get("model") or ""),
                created_at=int(row.get("created_at") or 0),
            )
            session.merge(entry)
            stats.history += 1


def _validate_import(source_data: dict[str, Any]) -> dict[str, Any]:
    source_user_balances = {str(row["uid"]): int(row.get("credits_minor", _credits_to_minor(row.get("credits", 0)))) for row in source_data["users"]}
    source_claim_counts = defaultdict(int)
    for row in source_data["claims"]:
        source_claim_counts[str(row["code_hash"])] += 1

    validation: dict[str, Any] = {}
    with session_scope() as session:
        validation["target_counts"] = {
            "users": session.scalar(select(func.count()).select_from(User)) or 0,
            "credit_codes": session.scalar(select(func.count()).select_from(CreditCode)) or 0,
            "claims": session.scalar(select(func.count()).select_from(CreditCodeClaim)) or 0,
            "ledger": session.scalar(select(func.count()).select_from(CreditLedgerEntry)) or 0,
            "history": session.scalar(select(func.count()).select_from(HistoryEntry)) or 0,
            "sessions": session.scalar(select(func.count()).select_from(AnalyzeSession)) or 0,
        }

        balance_mismatches: list[dict[str, Any]] = []
        for uid, credits_minor in session.execute(select(User.uid, User.credits_minor)).all():
            source_minor = source_user_balances.get(uid)
            if source_minor is None:
                balance_mismatches.append({"uid": uid, "source": None, "target": credits_minor})
            elif int(source_minor) != int(credits_minor):
                balance_mismatches.append({"uid": uid, "source": int(source_minor), "target": int(credits_minor)})
        validation["balance_mismatches"] = balance_mismatches

        ledger_mismatches: list[dict[str, Any]] = []
        ledger_rows = session.execute(
            select(CreditLedgerEntry.uid, func.coalesce(func.sum(CreditLedgerEntry.delta_minor), 0)).group_by(CreditLedgerEntry.uid)
        ).all()
        ledger_balance_by_user = {uid: int(total) for uid, total in ledger_rows}
        for uid, target_credits in session.execute(select(User.uid, User.credits_minor)).all():
            ledger_total = ledger_balance_by_user.get(uid, 0)
            if ledger_total != int(target_credits):
                ledger_mismatches.append({"uid": uid, "ledger": ledger_total, "user_credits": int(target_credits)})
        validation["ledger_balance_mismatches"] = ledger_mismatches

        claim_mismatches: list[dict[str, Any]] = []
        code_rows = session.execute(
            select(CreditCode.code_hash, CreditCode.claimed_count)
        ).all()
        for code_hash, claimed_count in code_rows:
            source_count = source_claim_counts.get(code_hash, 0)
            db_claim_count = session.scalar(
                select(func.count()).select_from(CreditCodeClaim).where(CreditCodeClaim.code_hash == code_hash)
            ) or 0
            if int(claimed_count) != int(db_claim_count) or int(source_count) != int(db_claim_count):
                claim_mismatches.append(
                    {
                        "code_hash": code_hash,
                        "source_claims": int(source_count),
                        "code_claimed_count": int(claimed_count),
                        "db_claim_rows": int(db_claim_count),
                    }
                )
        validation["claim_mismatches"] = claim_mismatches

    return validation


def _print_summary(stats: ImportStats, validation: dict[str, Any], source_data: dict[str, Any]) -> None:
    print("Import summary")
    print(f"  source users: {len(source_data['users'])} -> imported {stats.users}")
    print(f"  source credit_codes: {len(source_data['credit_codes'])} -> imported {stats.credit_codes}")
    print(f"  source claims: {len(source_data['claims'])} -> imported {stats.claims} (skipped {stats.skipped_claims})")
    print(f"  source ledger: {len(source_data['ledger'])} -> imported {stats.ledger} (skipped {stats.skipped_ledger})")
    print(f"  source history: {len(source_data['history'])} -> imported {stats.history} (skipped {stats.skipped_history})")
    print(f"  source sessions: {len(source_data['sessions'])} -> imported {stats.sessions}")
    print("")
    print("Target counts")
    for key, value in validation["target_counts"].items():
        print(f"  {key}: {value}")
    print("")
    print(f"Balance mismatches: {len(validation['balance_mismatches'])}")
    print(f"Ledger balance mismatches: {len(validation['ledger_balance_mismatches'])}")
    print(f"Claim mismatches: {len(validation['claim_mismatches'])}")
    print(f"Anomalies: {len(stats.anomalies)}")

    if stats.anomalies:
        print("")
        print("Sample anomalies")
        for item in stats.anomalies[:20]:
            print(f"  - {item}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Import Firestore security data into PostgreSQL.")
    parser.add_argument(
        "--clear-target",
        action="store_true",
        help="Delete existing PostgreSQL rows in imported tables before loading Firestore data.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Read Firestore and print source counts without writing to PostgreSQL.",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Exit with status 1 if any validation mismatches or anomalies are found.",
    )
    args = parser.parse_args()

    db = _firestore()
    source_data = _load_firestore_snapshot(db)

    if args.dry_run:
        print("Dry run source counts")
        for key in ("users", "credit_codes", "claims", "ledger", "history", "sessions"):
            print(f"  {key}: {len(source_data[key])}")
        return

    if args.clear_target:
        _clear_target_tables()

    stats = ImportStats()
    user_ids = _import_users(source_data, stats)
    code_hashes = _import_credit_codes(source_data, user_ids, stats)
    analyze_session_ids = _import_sessions(source_data, user_ids, stats)
    _import_claims(source_data, user_ids, code_hashes, stats)
    _import_ledger(source_data, user_ids, code_hashes, analyze_session_ids, stats)
    _import_history(source_data, user_ids, stats)

    validation = _validate_import(source_data)
    _print_summary(stats, validation, source_data)

    has_issues = any(
        (
            stats.anomalies,
            validation["balance_mismatches"],
            validation["ledger_balance_mismatches"],
            validation["claim_mismatches"],
        )
    )
    if args.strict and has_issues:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
