from __future__ import annotations

from typing import Any

from sqlalchemy import BigInteger, Boolean, CheckConstraint, ForeignKey, Index, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class User(Base):
    __tablename__ = "users"

    uid: Mapped[str] = mapped_column(String(128), primary_key=True)
    email: Mapped[str] = mapped_column(String(320), default="", nullable=False)
    display_name: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    credits_minor: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    reserved_credits_minor: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[int] = mapped_column(BigInteger, nullable=False)
    updated_at: Mapped[int] = mapped_column(BigInteger, nullable=False)
    last_seen_at: Mapped[int] = mapped_column(BigInteger, nullable=False)
    is_suspended: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    suspension_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_codes: Mapped[list["CreditCode"]] = relationship(
        back_populates="created_by_user",
        foreign_keys="CreditCode.created_by",
    )
    credit_claims: Mapped[list["CreditCodeClaim"]] = relationship(back_populates="user")
    ledger_entries: Mapped[list["CreditLedgerEntry"]] = relationship(
        back_populates="user",
        foreign_keys="CreditLedgerEntry.uid",
    )
    acted_ledger_entries: Mapped[list["CreditLedgerEntry"]] = relationship(
        foreign_keys="CreditLedgerEntry.actor_uid",
    )
    analyze_sessions: Mapped[list["AnalyzeSession"]] = relationship(back_populates="user")
    history_entries: Mapped[list["HistoryEntry"]] = relationship(back_populates="user")
    generation_jobs: Mapped[list["GenerationJob"]] = relationship(back_populates="user")
    admin_audit_logs: Mapped[list["AdminAuditLog"]] = relationship(back_populates="admin_user")

    __table_args__ = (
        CheckConstraint("credits_minor >= 0", name="ck_users_credits_minor_nonnegative"),
        CheckConstraint("reserved_credits_minor >= 0", name="ck_users_reserved_credits_minor_nonnegative"),
        Index("ix_users_email", "email"),
        Index("ix_users_last_seen_at", "last_seen_at"),
    )


class AdminAccount(Base):
    __tablename__ = "admin_accounts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    username: Mapped[str] = mapped_column(String(64), nullable=False)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[int] = mapped_column(BigInteger, nullable=False)
    updated_at: Mapped[int] = mapped_column(BigInteger, nullable=False)
    last_login_at: Mapped[int | None] = mapped_column(BigInteger, nullable=True)

    sessions: Mapped[list["AdminSession"]] = relationship(back_populates="admin_account")

    __table_args__ = (
        Index("ix_admin_accounts_username", "username", unique=True),
    )


class AdminSession(Base):
    __tablename__ = "admin_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    admin_id: Mapped[str] = mapped_column(ForeignKey("admin_accounts.id", ondelete="CASCADE"), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    created_at: Mapped[int] = mapped_column(BigInteger, nullable=False)
    updated_at: Mapped[int] = mapped_column(BigInteger, nullable=False)
    expires_at: Mapped[int] = mapped_column(BigInteger, nullable=False)
    revoked_at: Mapped[int | None] = mapped_column(BigInteger, nullable=True)

    admin_account: Mapped[AdminAccount] = relationship(back_populates="sessions")

    __table_args__ = (
        Index("ix_admin_sessions_admin_id_created_at", "admin_id", "created_at"),
        Index("ix_admin_sessions_expires_at", "expires_at"),
    )


class CreditCode(Base):
    __tablename__ = "credit_codes"

    code_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    code_preview: Mapped[str] = mapped_column(String(32), nullable=False)
    credits_minor: Mapped[int] = mapped_column(Integer, nullable=False)
    max_claims: Mapped[int] = mapped_column(Integer, nullable=False)
    claimed_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[int] = mapped_column(BigInteger, nullable=False)
    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.uid", ondelete="SET NULL"), nullable=True)
    batch_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    batch_title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    expires_at: Mapped[int | None] = mapped_column(BigInteger, nullable=True)

    created_by_user: Mapped[User | None] = relationship(
        back_populates="created_codes",
        foreign_keys=[created_by],
    )
    claims: Mapped[list["CreditCodeClaim"]] = relationship(back_populates="credit_code")

    __table_args__ = (
        CheckConstraint("credits_minor > 0", name="ck_credit_codes_credits_minor_positive"),
        CheckConstraint("max_claims > 0", name="ck_credit_codes_max_claims_positive"),
        CheckConstraint("claimed_count >= 0", name="ck_credit_codes_claimed_count_nonnegative"),
        CheckConstraint("claimed_count <= max_claims", name="ck_credit_codes_claimed_count_within_limit"),
        Index("ix_credit_codes_created_at", "created_at"),
        Index("ix_credit_codes_batch_id_created_at", "batch_id", "created_at"),
    )


class CreditCodeClaim(Base):
    __tablename__ = "credit_code_claims"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code_hash: Mapped[str] = mapped_column(ForeignKey("credit_codes.code_hash", ondelete="CASCADE"), nullable=False)
    uid: Mapped[str] = mapped_column(ForeignKey("users.uid", ondelete="CASCADE"), nullable=False)
    claimed_at: Mapped[int] = mapped_column(BigInteger, nullable=False)

    credit_code: Mapped[CreditCode] = relationship(back_populates="claims")
    user: Mapped[User] = relationship(back_populates="credit_claims")

    __table_args__ = (
        Index("ux_credit_code_claims_code_hash_uid", "code_hash", "uid", unique=True),
        Index("ix_credit_code_claims_uid_claimed_at", "uid", "claimed_at"),
    )


class AnalyzeSession(Base):
    __tablename__ = "analyze_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    uid: Mapped[str] = mapped_column(ForeignKey("users.uid", ondelete="CASCADE"), nullable=False)
    fee_minor: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[int] = mapped_column(BigInteger, nullable=False)
    resolved_at: Mapped[int | None] = mapped_column(BigInteger, nullable=True)

    user: Mapped[User] = relationship(back_populates="analyze_sessions")
    ledger_entries: Mapped[list["CreditLedgerEntry"]] = relationship(back_populates="analyze_session")

    __table_args__ = (
        CheckConstraint("fee_minor >= 0", name="ck_analyze_sessions_fee_minor_nonnegative"),
        CheckConstraint(
            "status IN ('pending', 'completed', 'abandoned', 'failed')",
            name="ck_analyze_sessions_status_valid",
        ),
        Index("ix_analyze_sessions_uid_created_at", "uid", "created_at"),
        Index("ix_analyze_sessions_status_created_at", "status", "created_at"),
    )


class CreditLedgerEntry(Base):
    __tablename__ = "credit_ledger"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    uid: Mapped[str] = mapped_column(ForeignKey("users.uid", ondelete="CASCADE"), nullable=False)
    delta_minor: Mapped[int] = mapped_column(Integer, nullable=False)
    reason: Mapped[str] = mapped_column(String(64), nullable=False)
    actor_uid: Mapped[str | None] = mapped_column(ForeignKey("users.uid", ondelete="SET NULL"), nullable=True)
    metadata_json: Mapped[dict[str, Any]] = mapped_column("metadata", JSON, default=dict, nullable=False)
    code_hash: Mapped[str | None] = mapped_column(ForeignKey("credit_codes.code_hash", ondelete="SET NULL"), nullable=True)
    analyze_session_id: Mapped[str | None] = mapped_column(
        ForeignKey("analyze_sessions.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[int] = mapped_column(BigInteger, nullable=False)

    user: Mapped[User] = relationship(
        back_populates="ledger_entries",
        foreign_keys=[uid],
    )
    credit_code: Mapped[CreditCode | None] = relationship()
    analyze_session: Mapped[AnalyzeSession | None] = relationship(back_populates="ledger_entries")

    __table_args__ = (
        Index("ix_credit_ledger_uid_created_at", "uid", "created_at"),
        Index("ix_credit_ledger_reason_created_at", "reason", "created_at"),
        Index("ix_credit_ledger_actor_uid_created_at", "actor_uid", "created_at"),
    )


class HistoryEntry(Base):
    __tablename__ = "history_entries"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    uid: Mapped[str] = mapped_column(ForeignKey("users.uid", ondelete="CASCADE"), nullable=False)
    image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    caption: Mapped[str | None] = mapped_column(Text, nullable=True)
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    model: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    created_at: Mapped[int] = mapped_column(BigInteger, nullable=False)

    user: Mapped[User] = relationship(back_populates="history_entries")

    __table_args__ = (
        Index("ix_history_entries_uid_created_at", "uid", "created_at"),
    )


class GenerationJob(Base):
    __tablename__ = "generation_jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    uid: Mapped[str] = mapped_column(ForeignKey("users.uid", ondelete="CASCADE"), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    requested_outputs_json: Mapped[list[str]] = mapped_column("requested_outputs", JSON, default=list, nullable=False)
    request_payload_json: Mapped[dict[str, Any]] = mapped_column("request_payload", JSON, default=dict, nullable=False)
    reserved_minor: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    captured_minor: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    refunded_minor: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    failure_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[int] = mapped_column(BigInteger, nullable=False)
    updated_at: Mapped[int] = mapped_column(BigInteger, nullable=False)
    completed_at: Mapped[int | None] = mapped_column(BigInteger, nullable=True)

    user: Mapped[User] = relationship(back_populates="generation_jobs")

    __table_args__ = (
        CheckConstraint("reserved_minor >= 0", name="ck_generation_jobs_reserved_minor_nonnegative"),
        CheckConstraint("captured_minor >= 0", name="ck_generation_jobs_captured_minor_nonnegative"),
        CheckConstraint("refunded_minor >= 0", name="ck_generation_jobs_refunded_minor_nonnegative"),
        CheckConstraint(
            "status IN ('pending', 'processing', 'awaiting_review', 'completed', 'failed', 'cancelled')",
            name="ck_generation_jobs_status_valid",
        ),
        Index("ix_generation_jobs_uid_created_at", "uid", "created_at"),
        Index("ix_generation_jobs_status_created_at", "status", "created_at"),
    )


class RateLimitBucket(Base):
    __tablename__ = "rate_limit_buckets"

    key_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    key_plaintext: Mapped[str] = mapped_column(Text, nullable=False)
    count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    reset_at: Mapped[int] = mapped_column(BigInteger, nullable=False)
    updated_at: Mapped[int] = mapped_column(BigInteger, nullable=False)

    __table_args__ = (
        CheckConstraint("count >= 0", name="ck_rate_limit_buckets_count_nonnegative"),
        Index("ix_rate_limit_buckets_reset_at", "reset_at"),
    )


class AdminAuditLog(Base):
    __tablename__ = "admin_audit_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    admin_uid: Mapped[str | None] = mapped_column(ForeignKey("users.uid", ondelete="SET NULL"), nullable=True)
    admin_email: Mapped[str] = mapped_column(String(320), default="", nullable=False)
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    target_type: Mapped[str] = mapped_column(String(64), nullable=False)
    target_id: Mapped[str] = mapped_column(String(128), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    metadata_json: Mapped[dict[str, Any]] = mapped_column("metadata", JSON, default=dict, nullable=False)
    created_at: Mapped[int] = mapped_column(BigInteger, nullable=False)

    admin_user: Mapped[User | None] = relationship(back_populates="admin_audit_logs")

    __table_args__ = (
        Index("ix_admin_audit_logs_created_at", "created_at"),
        Index("ix_admin_audit_logs_admin_uid_created_at", "admin_uid", "created_at"),
        Index("ix_admin_audit_logs_target_created_at", "target_type", "target_id", "created_at"),
        Index("ix_admin_audit_logs_action_created_at", "action", "created_at"),
    )
