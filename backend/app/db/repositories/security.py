from __future__ import annotations

import hashlib
import time
import uuid
from typing import Any

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.db.models import AdminAccount, AdminAuditLog, AdminSession, AnalyzeSession, ChatConversation, ChatMessage, CreditCode, CreditCodeClaim, CreditLedgerEntry, GenerationJob, HistoryEntry, RateLimitBucket, User


class SecurityRepository:
    def __init__(self, session: Session):
        self.session = session

    def get_admin_account_by_username(self, username: str) -> AdminAccount | None:
        normalized = username.strip().lower()
        if not normalized:
            return None
        return self.session.execute(
            select(AdminAccount).where(AdminAccount.username == normalized)
        ).scalar_one_or_none()

    def get_admin_account_by_username_for_update(self, username: str) -> AdminAccount | None:
        normalized = username.strip().lower()
        if not normalized:
            return None
        return self.session.execute(
            select(AdminAccount).where(AdminAccount.username == normalized).with_for_update()
        ).scalar_one_or_none()

    def list_admin_accounts(self) -> list[AdminAccount]:
        return list(
            self.session.execute(
                select(AdminAccount).order_by(AdminAccount.username.asc())
            ).scalars()
        )

    def create_admin_account(self, username: str, password_hash: str, *, account_id: str | None = None) -> AdminAccount:
        now = int(time.time())
        account = AdminAccount(
            id=account_id or str(uuid.uuid4()),
            username=username.strip().lower(),
            password_hash=password_hash,
            is_active=True,
            created_at=now,
            updated_at=now,
            last_login_at=None,
        )
        self.session.add(account)
        self.session.flush()
        return account

    def update_admin_account_password(self, account: AdminAccount, password_hash: str) -> AdminAccount:
        now = int(time.time())
        account.password_hash = password_hash
        account.updated_at = now
        self.session.flush()
        return account

    def set_admin_account_active(self, account: AdminAccount, is_active: bool) -> AdminAccount:
        now = int(time.time())
        account.is_active = is_active
        account.updated_at = now
        self.session.flush()
        return account

    def create_admin_session(self, admin_id: str, token_hash: str, expires_at: int) -> AdminSession:
        now = int(time.time())
        entry = AdminSession(
            id=str(uuid.uuid4()),
            admin_id=admin_id,
            token_hash=token_hash,
            created_at=now,
            updated_at=now,
            expires_at=expires_at,
            revoked_at=None,
        )
        self.session.add(entry)
        self.session.flush()
        return entry

    def get_admin_session(self, token_hash: str) -> AdminSession | None:
        return self.session.execute(
            select(AdminSession).where(AdminSession.token_hash == token_hash)
        ).scalar_one_or_none()

    def get_admin_session_for_update(self, token_hash: str) -> AdminSession | None:
        return self.session.execute(
            select(AdminSession).where(AdminSession.token_hash == token_hash).with_for_update()
        ).scalar_one_or_none()

    def revoke_admin_session(self, entry: AdminSession, revoked_at: int | None = None) -> AdminSession:
        now = revoked_at or int(time.time())
        entry.revoked_at = now
        entry.updated_at = now
        self.session.flush()
        return entry

    def revoke_admin_sessions_for_admin(self, admin_id: str, *, revoked_at: int | None = None) -> int:
        now = revoked_at or int(time.time())
        entries = list(
            self.session.execute(
                select(AdminSession)
                .where(
                    AdminSession.admin_id == admin_id,
                    AdminSession.revoked_at.is_(None),
                )
                .with_for_update()
            ).scalars()
        )
        for entry in entries:
            entry.revoked_at = now
            entry.updated_at = now
        self.session.flush()
        return len(entries)

    def touch_admin_session(self, entry: AdminSession, *, refreshed_at: int | None = None) -> AdminSession:
        now = refreshed_at or int(time.time())
        entry.updated_at = now
        self.session.flush()
        return entry

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

    def count_credit_claims_since(self, uid: str, *, since_ts: int) -> int:
        value = self.session.execute(
            select(func.count(CreditCodeClaim.code_hash))
            .where(
                CreditCodeClaim.uid == uid,
                CreditCodeClaim.claimed_at >= since_ts,
            )
        ).scalar_one()
        return int(value or 0)

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

    def sum_user_usage_minor(self, uid: str, *, since_ts: int, reasons: list[str]) -> int:
        if not reasons:
            return 0
        value = self.session.execute(
            select(func.coalesce(func.sum(-CreditLedgerEntry.delta_minor), 0))
            .where(
                CreditLedgerEntry.uid == uid,
                CreditLedgerEntry.created_at >= since_ts,
                CreditLedgerEntry.reason.in_(reasons),
                CreditLedgerEntry.delta_minor < 0,
            )
        ).scalar_one()
        return int(value or 0)

    def sum_user_captured_generation_minor(self, uid: str, *, since_ts: int) -> int:
        value = self.session.execute(
            select(func.coalesce(func.sum(GenerationJob.captured_minor), 0))
            .where(
                GenerationJob.uid == uid,
                GenerationJob.completed_at.is_not(None),
                GenerationJob.completed_at >= since_ts,
                GenerationJob.status == "completed",
            )
        ).scalar_one()
        return int(value or 0)

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

    def list_pending_analyze_sessions_for_update(self, uid: str) -> list[AnalyzeSession]:
        return list(
            self.session.execute(
                select(AnalyzeSession)
                .where(
                    AnalyzeSession.uid == uid,
                    AnalyzeSession.status == "pending",
                )
                .order_by(AnalyzeSession.created_at.asc())
                .with_for_update()
            ).scalars()
        )

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

    def create_chat_conversation(self, uid: str, model: str, system_parts: list[dict[str, Any]]) -> ChatConversation:
        now = int(time.time())
        entry = ChatConversation(
            id=str(uuid.uuid4()),
            uid=uid,
            model=model,
            system_json=system_parts,
            created_at=now,
            updated_at=now,
            last_message_at=None,
            prompt_tokens_total=0,
            completion_tokens_total=0,
        )
        self.session.add(entry)
        self.session.flush()
        return entry

    def list_chat_conversations(self, uid: str, limit: int) -> list[ChatConversation]:
        return list(
            self.session.execute(
                select(ChatConversation)
                .where(ChatConversation.uid == uid)
                .order_by(ChatConversation.updated_at.desc(), ChatConversation.created_at.desc())
                .limit(limit)
            ).scalars()
        )

    def get_chat_conversation(self, uid: str, conversation_id: str) -> ChatConversation | None:
        return self.session.execute(
            select(ChatConversation).where(
                ChatConversation.id == conversation_id,
                ChatConversation.uid == uid,
            )
        ).scalar_one_or_none()

    def get_chat_conversation_for_update(self, uid: str, conversation_id: str) -> ChatConversation | None:
        return self.session.execute(
            select(ChatConversation)
            .where(
                ChatConversation.id == conversation_id,
                ChatConversation.uid == uid,
            )
            .with_for_update()
        ).scalar_one_or_none()

    def touch_chat_conversation(
        self,
        conversation: ChatConversation,
        *,
        touched_at: int | None = None,
        prompt_tokens_delta: int = 0,
        completion_tokens_delta: int = 0,
    ) -> ChatConversation:
        now = touched_at or int(time.time())
        conversation.updated_at = now
        conversation.last_message_at = now
        conversation.prompt_tokens_total = max(int(conversation.prompt_tokens_total or 0) + int(prompt_tokens_delta or 0), 0)
        conversation.completion_tokens_total = max(int(conversation.completion_tokens_total or 0) + int(completion_tokens_delta or 0), 0)
        self.session.flush()
        return conversation

    def add_chat_message(
        self,
        uid: str,
        conversation_id: str,
        role: str,
        parts: list[dict[str, Any]],
        *,
        created_at: int | None = None,
    ) -> ChatMessage:
        now = created_at or int(time.time())
        entry = ChatMessage(
            id=str(uuid.uuid4()),
            conversation_id=conversation_id,
            uid=uid,
            role=role,
            parts_json=parts,
            created_at=now,
        )
        self.session.add(entry)
        self.session.flush()
        return entry

    def get_chat_messages(self, uid: str, conversation_id: str, max_items: int) -> list[ChatMessage]:
        return list(
            self.session.execute(
                select(ChatMessage)
                .where(
                    ChatMessage.uid == uid,
                    ChatMessage.conversation_id == conversation_id,
                )
                .order_by(ChatMessage.created_at.asc(), ChatMessage.id.asc())
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

    def delete_rate_limit_buckets_by_prefix(self, prefix: str) -> int:
        buckets = list(
            self.session.execute(
                select(RateLimitBucket).where(RateLimitBucket.key_plaintext.like(f"{prefix}%"))
            ).scalars()
        )
        for bucket in buckets:
            self.session.delete(bucket)
        self.session.flush()
        return len(buckets)

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
        exclude_admin_email: str | None = None,
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
        if exclude_admin_email:
            stmt = stmt.where(AdminAuditLog.admin_email != exclude_admin_email)
        stmt = stmt.order_by(AdminAuditLog.created_at.desc()).limit(limit)
        return list(self.session.execute(stmt).scalars())
