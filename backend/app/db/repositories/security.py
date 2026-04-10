from __future__ import annotations

import hashlib
import time
import uuid
from typing import Any

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.db.models import AdminAuditLog, AnalyzeSession, CreditCode, CreditCodeClaim, CreditLedgerEntry, GenerationJob, HistoryEntry, RateLimitBucket, User


class SecurityRepository:
    def __init__(self, session: Session):
        self.session = session

    def ensure_user(self, uid: str, email: str, display_name: str) -> User:
        now = int(time.time())
        user = self.session.get(User, uid)
        if user is None:
            user = User(
                uid=uid,
                email=email,
                display_name=display_name,
                credits_minor=0,
                reserved_credits_minor=0,
                created_at=now,
                updated_at=now,
                last_seen_at=now,
            )
            self.session.add(user)
        else:
            user.email = email
            user.display_name = display_name
            user.updated_at = now
            user.last_seen_at = now
        self.session.flush()
        return user

    def get_user(self, uid: str) -> User | None:
        return self.session.get(User, uid)

    def get_user_for_update(self, uid: str) -> User | None:
        return self.session.execute(
            select(User).where(User.uid == uid).with_for_update()
        ).scalar_one_or_none()

    def list_users(self) -> list[User]:
        return list(
            self.session.execute(
                select(User).order_by(User.last_seen_at.desc())
            ).scalars()
        )

    def create_credit_code(self, code_hash: str, code_preview: str, credits_minor: int, max_claims: int, created_by: str | None) -> CreditCode:
        code = CreditCode(
            code_hash=code_hash,
            code_preview=code_preview,
            credits_minor=credits_minor,
            max_claims=max_claims,
            claimed_count=0,
            created_at=int(time.time()),
            created_by=created_by,
            batch_id=None,
            batch_title=None,
            is_active=True,
        )
        self.session.add(code)
        self.session.flush()
        return code

    def create_credit_code_with_batch(
        self,
        code_hash: str,
        code_preview: str,
        credits_minor: int,
        max_claims: int,
        created_by: str | None,
        *,
        batch_id: str | None,
        batch_title: str | None,
    ) -> CreditCode:
        code = CreditCode(
            code_hash=code_hash,
            code_preview=code_preview,
            credits_minor=credits_minor,
            max_claims=max_claims,
            claimed_count=0,
            created_at=int(time.time()),
            created_by=created_by,
            batch_id=batch_id,
            batch_title=batch_title,
            is_active=True,
        )
        self.session.add(code)
        self.session.flush()
        return code

    def list_credit_codes(self) -> list[CreditCode]:
        return list(
            self.session.execute(
                select(CreditCode).order_by(CreditCode.created_at.desc())
            ).scalars()
        )

    def summarize_gift_codes_by_status(self, now: int) -> list[dict[str, Any]]:
        status_expr = case(
            (CreditCode.is_active.is_(False), "inactive"),
            ((CreditCode.expires_at.is_not(None)) & (CreditCode.expires_at <= now), "expired"),
            (CreditCode.claimed_count >= CreditCode.max_claims, "exhausted"),
            else_="active",
        )
        rows = self.session.execute(
            select(
                status_expr.label("status"),
                func.count(CreditCode.code_hash).label("code_count"),
                func.coalesce(func.sum(CreditCode.credits_minor), 0).label("total_credits_minor"),
                func.coalesce(func.avg(CreditCode.credits_minor), 0).label("average_credits_minor"),
            )
            .where(CreditCode.batch_id.is_(None))
            .group_by(status_expr)
        )
        return [
            {
                "status": row.status,
                "code_count": int(row.code_count or 0),
                "total_credits_minor": int(row.total_credits_minor or 0),
                "average_credits_minor": float(row.average_credits_minor or 0),
            }
            for row in rows
        ]

    def get_credit_code(self, code_hash: str) -> CreditCode | None:
        return self.session.get(CreditCode, code_hash)

    def get_credit_code_for_update(self, code_hash: str) -> CreditCode | None:
        return self.session.execute(
            select(CreditCode).where(CreditCode.code_hash == code_hash).with_for_update()
        ).scalar_one_or_none()

    def list_credit_codes_by_batch_for_update(self, batch_id: str) -> list[CreditCode]:
        return list(
            self.session.execute(
                select(CreditCode)
                .where(CreditCode.batch_id == batch_id)
                .order_by(CreditCode.created_at.desc())
                .with_for_update()
            ).scalars()
        )

    def get_credit_claim(self, code_hash: str, uid: str) -> CreditCodeClaim | None:
        return self.session.execute(
            select(CreditCodeClaim).where(
                CreditCodeClaim.code_hash == code_hash,
                CreditCodeClaim.uid == uid,
            )
        ).scalar_one_or_none()

    def add_credit_claim(self, code_hash: str, uid: str, claimed_at: int | None = None) -> CreditCodeClaim:
        claim = CreditCodeClaim(
            code_hash=code_hash,
            uid=uid,
            claimed_at=claimed_at or int(time.time()),
        )
        self.session.add(claim)
        self.session.flush()
        return claim

    def add_ledger_entry(
        self,
        uid: str,
        delta_minor: int,
        reason: str,
        actor_uid: str | None = None,
        metadata_json: dict[str, Any] | None = None,
        code_hash: str | None = None,
        analyze_session_id: str | None = None,
        entry_id: str | None = None,
        created_at: int | None = None,
    ) -> CreditLedgerEntry:
        entry = CreditLedgerEntry(
            id=entry_id or str(uuid.uuid4()),
            uid=uid,
            delta_minor=delta_minor,
            reason=reason,
            actor_uid=actor_uid,
            metadata_json=metadata_json or {},
            code_hash=code_hash,
            analyze_session_id=analyze_session_id,
            created_at=created_at or int(time.time()),
        )
        self.session.add(entry)
        self.session.flush()
        return entry

    def create_analyze_session(self, uid: str, fee_minor: int, prompt: str) -> AnalyzeSession:
        now = int(time.time())
        analyze_session = AnalyzeSession(
            id=str(uuid.uuid4()),
            uid=uid,
            fee_minor=fee_minor,
            status="pending",
            prompt=prompt,
            created_at=now,
            resolved_at=None,
        )
        self.session.add(analyze_session)
        self.session.flush()
        return analyze_session

    def get_analyze_session_for_update(self, session_id: str) -> AnalyzeSession | None:
        return self.session.execute(
            select(AnalyzeSession).where(AnalyzeSession.id == session_id).with_for_update()
        ).scalar_one_or_none()

    def add_history_entry(self, uid: str, image_url: str | None, caption: str | None, prompt: str, model: str) -> HistoryEntry:
        entry = HistoryEntry(
            id=str(uuid.uuid4()),
            uid=uid,
            image_url=image_url,
            caption=caption,
            prompt=prompt,
            model=model,
            created_at=int(time.time()),
        )
        self.session.add(entry)
        self.session.flush()
        return entry

    def get_history(self, uid: str, max_items: int) -> list[HistoryEntry]:
        return list(
            self.session.execute(
                select(HistoryEntry)
                .where(HistoryEntry.uid == uid)
                .order_by(HistoryEntry.created_at.desc())
                .limit(max_items)
            ).scalars()
        )

    def create_generation_job(
        self,
        uid: str,
        prompt: str,
        requested_outputs: list[str],
        request_payload: dict[str, Any],
        reserved_minor: int = 0,
        status: str = "pending",
    ) -> GenerationJob:
        now = int(time.time())
        job = GenerationJob(
            id=str(uuid.uuid4()),
            uid=uid,
            status=status,
            prompt=prompt,
            requested_outputs_json=requested_outputs,
            request_payload_json=request_payload,
            reserved_minor=reserved_minor,
            captured_minor=0,
            refunded_minor=0,
            created_at=now,
            updated_at=now,
            completed_at=None,
        )
        self.session.add(job)
        self.session.flush()
        return job

    def get_generation_job(self, job_id: str) -> GenerationJob | None:
        return self.session.get(GenerationJob, job_id)

    def list_generation_jobs(self, status: str | None = None, limit: int = 100) -> list[GenerationJob]:
        stmt = select(GenerationJob)
        if status:
            stmt = stmt.where(GenerationJob.status == status)
        stmt = stmt.order_by(GenerationJob.created_at.desc()).limit(limit)
        return list(self.session.execute(stmt).scalars())

    def get_generation_job_for_update(self, job_id: str) -> GenerationJob | None:
        return self.session.execute(
            select(GenerationJob).where(GenerationJob.id == job_id).with_for_update()
        ).scalar_one_or_none()

    def update_generation_job(
        self,
        job: GenerationJob,
        *,
        status: str,
        reserved_minor: int | None = None,
        captured_minor: int | None = None,
        refunded_minor: int | None = None,
        failure_reason: str | None = None,
        completed_at: int | None = None,
    ) -> GenerationJob:
        job.status = status
        if reserved_minor is not None:
            job.reserved_minor = reserved_minor
        if captured_minor is not None:
            job.captured_minor = captured_minor
        if refunded_minor is not None:
            job.refunded_minor = refunded_minor
        job.failure_reason = failure_reason
        job.updated_at = int(time.time())
        job.completed_at = completed_at
        self.session.flush()
        return job

    def get_rate_limit_bucket_for_update(self, key: str) -> RateLimitBucket | None:
        key_hash = hashlib.sha256(key.encode("utf-8")).hexdigest()
        return self.session.execute(
            select(RateLimitBucket).where(RateLimitBucket.key_hash == key_hash).with_for_update()
        ).scalar_one_or_none()

    def get_rate_limit_bucket(self, key: str) -> RateLimitBucket | None:
        key_hash = hashlib.sha256(key.encode("utf-8")).hexdigest()
        return self.session.get(RateLimitBucket, key_hash)

    def upsert_rate_limit_bucket(self, key: str, count: int, reset_at: int) -> RateLimitBucket:
        now = int(time.time())
        key_hash = hashlib.sha256(key.encode("utf-8")).hexdigest()
        stmt = pg_insert(RateLimitBucket).values(
            key_hash=key_hash,
            key_plaintext=key,
            count=count,
            reset_at=reset_at,
            updated_at=now,
        )
        stmt = stmt.on_conflict_do_update(
            index_elements=[RateLimitBucket.key_hash],
            set_={
                "key_plaintext": key,
                "count": count,
                "reset_at": reset_at,
                "updated_at": now,
            },
        )
        self.session.execute(stmt)
        self.session.flush()
        return self.session.get(RateLimitBucket, key_hash)

    def delete_rate_limit_bucket(self, key: str) -> None:
        bucket = self.get_rate_limit_bucket(key)
        if bucket is not None:
            self.session.delete(bucket)
            self.session.flush()

    def add_admin_audit_log(
        self,
        *,
        admin_uid: str | None,
        admin_email: str,
        action: str,
        target_type: str,
        target_id: str,
        reason: str,
        metadata_json: dict[str, Any] | None = None,
        created_at: int | None = None,
    ) -> AdminAuditLog:
        entry = AdminAuditLog(
            id=str(uuid.uuid4()),
            admin_uid=admin_uid,
            admin_email=admin_email,
            action=action,
            target_type=target_type,
            target_id=target_id,
            reason=reason,
            metadata_json=metadata_json or {},
            created_at=created_at or int(time.time()),
        )
        self.session.add(entry)
        self.session.flush()
        return entry

    def list_admin_audit_logs(
        self,
        limit: int = 50,
        *,
        admin_uid: str | None = None,
        action: str | None = None,
        target_type: str | None = None,
        target_id: str | None = None,
    ) -> list[AdminAuditLog]:
        stmt = select(AdminAuditLog)
        if admin_uid:
            stmt = stmt.where(AdminAuditLog.admin_uid == admin_uid)
        if action:
            stmt = stmt.where(AdminAuditLog.action == action)
        if target_type:
            stmt = stmt.where(AdminAuditLog.target_type == target_type)
        if target_id:
            stmt = stmt.where(AdminAuditLog.target_id == target_id)
        stmt = stmt.order_by(AdminAuditLog.created_at.desc()).limit(limit)
        return list(self.session.execute(stmt).scalars())
