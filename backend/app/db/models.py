from __future__ import annotations

from typing import Any

from sqlalchemy import BigInteger, Boolean, CheckConstraint, ForeignKey, Index, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        Index("ux_users_username", "username", unique=True),
    )

    uid: Mapped[str] = mapped_column(String(128), primary_key=True)
    email: Mapped[str] = mapped_column(String(320), default="", nullable=False)
    display_name: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    username: Mapped[str] = mapped_column(String(15), default="", nullable=False)
    bio: Mapped[str] = mapped_column(Text, default="", nullable=False)
    email_general_news_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    email_platform_updates_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # Consent for lifecycle/marketing mail (onboarding drip + win-back). Separate
    # from platform_updates so product news and lifecycle nudges opt out independently.
    # The email unsubscribe link flips this flag.
    email_lifecycle_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    credits_minor: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    reserved_credits_minor: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[int] = mapped_column(BigInteger, nullable=False)
    updated_at: Mapped[int] = mapped_column(BigInteger, nullable=False)
    last_seen_at: Mapped[int] = mapped_column(BigInteger, nullable=False)
    is_suspended: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    suspension_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_deactivated: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    deactivated_at: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    deactivation_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    suspended_until: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    moderation_ban_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_moderation_ban_at: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    # One-shot stamp for the server-side Meta CompleteRegistration (CAPI). NULL =
    # not yet sent; set exactly once via an atomic claim (see claim_capi_registration).
    capi_registration_sent_at: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    # UI language the user picked (en/fr/ar). NULL = never chose; server-side
    # email sends fall back to "en". Set by the first-run preferences card / Settings.
    preferred_language: Mapped[str | None] = mapped_column(String(2), nullable=True)
    # When the one-time first-run preferences card was answered (Save or Skip).
    # NULL = never prompted -> the card shows exactly once. Backfilled to the
    # migration time for pre-existing users so only new accounts see it.
    preferences_prompted_at: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    # Set while a card payment of theirs is disputed. Blocks SPENDING only — the
    # account still signs in and browses, deliberately unlike is_suspended, which
    # blocks at auth and is too blunt for someone who may yet win their dispute.
    # NULL = no hold.
    payment_hold_at: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    payment_hold_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

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
    chat_conversations: Mapped[list["ChatConversation"]] = relationship(back_populates="user")
    chat_messages: Mapped[list["ChatMessage"]] = relationship(back_populates="user")
    files: Mapped[list["UserFile"]] = relationship(back_populates="user")
    admin_audit_logs: Mapped[list["AdminAuditLog"]] = relationship(back_populates="admin_user")
    moderation_rejections: Mapped[list["ModerationRejection"]] = relationship(back_populates="user")

    __table_args__ = (
        CheckConstraint("credits_minor >= 0", name="ck_users_credits_minor_nonnegative"),
        CheckConstraint("reserved_credits_minor >= 0", name="ck_users_reserved_credits_minor_nonnegative"),
        Index("ix_users_email", "email"),
        Index("ix_users_last_seen_at", "last_seen_at"),
    )


class ModerationRejection(Base):
    __tablename__ = "moderation_rejections"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    uid: Mapped[str] = mapped_column(String(128), ForeignKey("users.uid", ondelete="CASCADE"), nullable=False)
    model: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    code: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[int] = mapped_column(BigInteger, nullable=False)

    user: Mapped["User"] = relationship(back_populates="moderation_rejections")

    __table_args__ = (
        Index("ix_moderation_rejections_uid_created_at", "uid", "created_at"),
    )


class DeactivatedEmail(Base):
    __tablename__ = "deactivated_emails"

    email: Mapped[str] = mapped_column(String(320), primary_key=True)
    original_uid: Mapped[str | None] = mapped_column(String(128), nullable=True)
    deactivated_at: Mapped[int] = mapped_column(BigInteger, nullable=False)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        Index("ix_deactivated_emails_deactivated_at", "deactivated_at"),
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


class DashboardNewsItem(Base):
    __tablename__ = "dashboard_news"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    badge: Mapped[str] = mapped_column(String(80), default="", nullable=False)
    when_label: Mapped[str] = mapped_column(String(80), default="", nullable=False)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    title_fr: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    title_ar: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    description_fr: Mapped[str] = mapped_column(Text, default="", nullable=False)
    description_ar: Mapped[str] = mapped_column(Text, default="", nullable=False)
    link_label: Mapped[str] = mapped_column(String(80), default="", nullable=False)
    link_label_fr: Mapped[str] = mapped_column(String(80), default="", nullable=False)
    link_label_ar: Mapped[str] = mapped_column(String(80), default="", nullable=False)
    link_href: Mapped[str] = mapped_column(String(255), default="/studio", nullable=False)
    tone: Mapped[str] = mapped_column(String(24), default="blue", nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[int] = mapped_column(BigInteger, nullable=False)
    updated_at: Mapped[int] = mapped_column(BigInteger, nullable=False)

    __table_args__ = (
        Index("ix_dashboard_news_active_sort_order", "is_active", "sort_order"),
        Index("ix_dashboard_news_updated_at", "updated_at"),
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
    # Validity window (in seconds) granted to the *redeemed credits*, starting at
    # redemption time. NULL/0 = redeemed credits never expire. This is distinct
    # from `expires_at`, which is the deadline to redeem the code itself.
    validity_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)

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


class CreditLot(Base):
    """A discrete parcel of credits with an optional expiry.

    Credits enter the user's balance as lots. Gift lots carry an `expires_at`
    derived from the code's `validity_seconds`; legacy/admin/purchase credits use
    `expires_at = NULL` (never expire). `User.credits_minor` / `reserved_credits_minor`
    are caches equal to SUM(remaining_minor) / SUM(reserved_minor) across a user's lots.

    Bookkeeping per lot:  original_minor = remaining_minor + reserved_minor + consumed.
    `remaining_minor` is spendable now; `reserved_minor` is held by in-flight jobs;
    consumed is implicit (permanently spent). Expiry zeroes `remaining_minor` only.
    """

    __tablename__ = "credit_lots"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    uid: Mapped[str] = mapped_column(ForeignKey("users.uid", ondelete="CASCADE"), nullable=False)
    source: Mapped[str] = mapped_column(String(32), nullable=False)
    original_minor: Mapped[int] = mapped_column(Integer, nullable=False)
    remaining_minor: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    reserved_minor: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    granted_at: Mapped[int] = mapped_column(BigInteger, nullable=False)
    expires_at: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    expired_at: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    code_hash: Mapped[str | None] = mapped_column(
        ForeignKey("credit_codes.code_hash", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[int] = mapped_column(BigInteger, nullable=False)

    __table_args__ = (
        CheckConstraint("original_minor >= 0", name="ck_credit_lots_original_nonnegative"),
        CheckConstraint("remaining_minor >= 0", name="ck_credit_lots_remaining_nonnegative"),
        CheckConstraint("reserved_minor >= 0", name="ck_credit_lots_reserved_nonnegative"),
        CheckConstraint(
            "source IN ('gift', 'legacy', 'admin_grant', 'purchase', 'refund')",
            name="ck_credit_lots_source_valid",
        ),
        Index("ix_credit_lots_uid_expires_at", "uid", "expires_at"),
        Index("ix_credit_lots_uid_source", "uid", "source"),
        # Drives the lazy + nightly expiry sweep: find lots due to expire that
        # still hold spendable credits.
        Index("ix_credit_lots_expires_remaining", "expires_at", "remaining_minor"),
    )


class CreditLotAllocation(Base):
    """Per-lot record of credits reserved by an in-flight job.

    A single reservation can span several lots (gift-first, soonest-expiry first),
    so we remember exactly which lots funded it. On capture/release we settle each
    allocation back against its originating lot, preserving that lot's expiry.
    `reserved_minor` is the amount this allocation still holds (decreases as the
    job captures or releases).
    """

    __tablename__ = "credit_lot_allocations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    lot_id: Mapped[str] = mapped_column(ForeignKey("credit_lots.id", ondelete="CASCADE"), nullable=False)
    ref_type: Mapped[str] = mapped_column(String(16), nullable=False)
    ref_id: Mapped[str] = mapped_column(String(36), nullable=False)
    reserved_minor: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[int] = mapped_column(BigInteger, nullable=False)

    __table_args__ = (
        CheckConstraint("reserved_minor >= 0", name="ck_credit_lot_allocations_reserved_nonnegative"),
        CheckConstraint(
            "ref_type IN ('generation', 'analyze')",
            name="ck_credit_lot_allocations_ref_type_valid",
        ),
        Index("ix_credit_lot_allocations_ref", "ref_type", "ref_id"),
        Index("ix_credit_lot_allocations_lot_id", "lot_id"),
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


class UserFile(Base):
    __tablename__ = "user_files"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_uid: Mapped[str] = mapped_column(ForeignKey("users.uid", ondelete="CASCADE"), nullable=False)
    storage_path: Mapped[str] = mapped_column(Text, nullable=False)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(128), nullable=False)
    # SHA-256 of the stored bytes. Only written for payment proofs, where it
    # answers "have we seen this exact receipt before?" — the same image can
    # otherwise be submitted on order after order with nothing to notice it by.
    # Nullable because files predating the column have no hash and must not be
    # mistaken for duplicates of each other.
    content_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[int] = mapped_column(BigInteger, nullable=False)

    user: Mapped[User] = relationship(back_populates="files")

    __table_args__ = (
        CheckConstraint(
            "kind IN ('uploaded_input', 'generated_output', 'payment_proof')",
            name="ck_user_files_kind_valid",
        ),
        Index("ix_user_files_owner_uid_created_at", "owner_uid", "created_at"),
        Index("ix_user_files_storage_path", "storage_path", unique=True),
        Index("ix_user_files_kind_content_sha256", "kind", "content_sha256"),
    )


class ChatConversation(Base):
    __tablename__ = "chat_conversations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    uid: Mapped[str] = mapped_column(ForeignKey("users.uid", ondelete="CASCADE"), nullable=False)
    model: Mapped[str] = mapped_column(String(255), nullable=False)
    title: Mapped[str] = mapped_column(String(120), default="New Chat", nullable=False)
    system_json: Mapped[list[dict[str, Any]]] = mapped_column("system", JSON, default=list, nullable=False)
    created_at: Mapped[int] = mapped_column(BigInteger, nullable=False)
    updated_at: Mapped[int] = mapped_column(BigInteger, nullable=False)
    last_message_at: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    prompt_tokens_total: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    completion_tokens_total: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_cost_micro: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    total_cost_minor: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    user: Mapped[User] = relationship(back_populates="chat_conversations")
    messages: Mapped[list["ChatMessage"]] = relationship(
        back_populates="conversation",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        CheckConstraint("prompt_tokens_total >= 0", name="ck_chat_conversations_prompt_tokens_total_nonnegative"),
        CheckConstraint("completion_tokens_total >= 0", name="ck_chat_conversations_completion_tokens_total_nonnegative"),
        CheckConstraint("total_cost_micro >= 0", name="ck_chat_conversations_total_cost_micro_nonnegative"),
        CheckConstraint("total_cost_minor >= 0", name="ck_chat_conversations_total_cost_minor_nonnegative"),
        Index("ix_chat_conversations_uid_updated_at", "uid", "updated_at"),
        Index("ix_chat_conversations_uid_last_message_at", "uid", "last_message_at"),
    )


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    conversation_id: Mapped[str] = mapped_column(ForeignKey("chat_conversations.id", ondelete="CASCADE"), nullable=False)
    uid: Mapped[str] = mapped_column(ForeignKey("users.uid", ondelete="CASCADE"), nullable=False)
    role: Mapped[str] = mapped_column(String(32), nullable=False)
    parts_json: Mapped[list[dict[str, Any]]] = mapped_column("parts", JSON, default=list, nullable=False)
    created_at: Mapped[int] = mapped_column(BigInteger, nullable=False)

    conversation: Mapped[ChatConversation] = relationship(back_populates="messages")
    user: Mapped[User] = relationship(back_populates="chat_messages")

    __table_args__ = (
        CheckConstraint("role IN ('user', 'assistant')", name="ck_chat_messages_role_valid"),
        Index("ix_chat_messages_conversation_id_created_at", "conversation_id", "created_at"),
        Index("ix_chat_messages_uid_created_at", "uid", "created_at"),
    )


class PackSession(Base):
    """A saved pack-studio session: a named gallery of generations plus the agent
    memory, so a user can reopen and continue it later. The whole session lives in
    one JSON ``data`` blob (results + history + mockup ref) - no per-image rows."""
    __tablename__ = "pack_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    uid: Mapped[str] = mapped_column(ForeignKey("users.uid", ondelete="CASCADE"), nullable=False)
    pack_id: Mapped[str] = mapped_column(String(80), nullable=False)
    variant_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    title: Mapped[str] = mapped_column(String(120), default="New session", nullable=False)
    data_json: Mapped[dict[str, Any]] = mapped_column("data", JSON, default=dict, nullable=False)
    created_at: Mapped[int] = mapped_column(BigInteger, nullable=False)
    updated_at: Mapped[int] = mapped_column(BigInteger, nullable=False)

    __table_args__ = (
        Index("ix_pack_sessions_uid_pack_updated", "uid", "pack_id", "updated_at"),
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


class FeedbackItem(Base):
    __tablename__ = "feedback_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    uid: Mapped[str | None] = mapped_column(ForeignKey("users.uid", ondelete="SET NULL"), nullable=True)
    email: Mapped[str] = mapped_column(String(320), default="", nullable=False)
    category: Mapped[str] = mapped_column(String(24), default="other", nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    route: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    language: Mapped[str] = mapped_column(String(8), default="", nullable=False)
    user_agent: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="new", nullable=False)
    created_at: Mapped[int] = mapped_column(BigInteger, nullable=False)
    updated_at: Mapped[int] = mapped_column(BigInteger, nullable=False)

    __table_args__ = (
        Index("ix_feedback_items_status_created_at", "status", "created_at"),
        Index("ix_feedback_items_uid_created_at", "uid", "created_at"),
    )


class CreditOrder(Base):
    """One manual credit purchase awaiting (or having received) an admin decision.

    The plan's credits/price are SNAPSHOT here at order time rather than looked up
    later, so repricing a plan never rewrites what a user already agreed to pay.

    `code_plain` deliberately holds the redeem code in the clear — unlike
    `credit_codes`, which stores only a hash. The user has to be able to read and
    copy the code the admin handed over, so there is nothing to compare against.
    It is only ever returned to the order's own owner, and only once accepted.

    Accepting does NOT move credits: the user redeems the code through the normal
    /credits/redeem path, so a purchase reaches the ledger exactly once.
    """

    __tablename__ = "credit_orders"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    uid: Mapped[str] = mapped_column(ForeignKey("users.uid", ondelete="CASCADE"), nullable=False)
    plan_id: Mapped[str] = mapped_column(String(32), nullable=False)
    plan_name: Mapped[str] = mapped_column(String(64), nullable=False)
    credits_minor: Mapped[int] = mapped_column(Integer, nullable=False)
    price_minor: Mapped[int] = mapped_column(Integer, nullable=False)
    currency: Mapped[str] = mapped_column(String(8), default="TND", nullable=False)
    payment_method: Mapped[str] = mapped_column(String(32), nullable=False)
    note: Mapped[str] = mapped_column(String(400), default="", nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="pending", nullable=False)
    code_plain: Mapped[str | None] = mapped_column(String(64), nullable=True)
    admin_message: Mapped[str] = mapped_column(String(400), default="", nullable=False)
    resolved_by_email: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    resolved_at: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    # Set the first time the buyer loads their orders after this one was resolved.
    # The "Your orders" card is a notification, not an archive: once it has been
    # seen it drops out of that card. The row stays in Recent History forever, so
    # the code is never actually lost.
    seen_at: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    # Set when the order was announced in the Discord approval channel, so a
    # decision taken in the web panel can go back and repaint that card. Null
    # whenever Discord is unconfigured or the post failed — the integration is
    # fail-open, so that is a normal state, not an error.
    discord_message_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # The buyer's Meta Pixel cookies, captured when they placed the order. The
    # Purchase event is sent server-side days later, when an admin confirms the
    # payment and the browser that held these is long gone — without them Meta
    # can rarely tie the sale back to the ad click that caused it. Null is
    # normal: no ad click, or the Pixel was blocked.
    fb_pixel_fbp: Mapped[str | None] = mapped_column(String(128), nullable=True)
    fb_pixel_fbc: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[int] = mapped_column(BigInteger, nullable=False)
    updated_at: Mapped[int] = mapped_column(BigInteger, nullable=False)

    proofs: Mapped[list["CreditOrderProof"]] = relationship(
        back_populates="order",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        CheckConstraint("credits_minor > 0", name="ck_credit_orders_credits_positive"),
        CheckConstraint("price_minor >= 0", name="ck_credit_orders_price_non_negative"),
        CheckConstraint(
            "status IN ('pending', 'accepted', 'refused')",
            name="ck_credit_orders_status_valid",
        ),
        Index("ix_credit_orders_uid_created_at", "uid", "created_at"),
        Index("ix_credit_orders_status_created_at", "status", "created_at"),
    )


class CreditOrderProof(Base):
    """A payment receipt attached to an order (image or PDF).

    The bytes live on disk under `payment_proofs/` with a `user_files` row of kind
    'payment_proof' — deliberately NOT 'uploaded_input', which the 30-day upload
    reaper deletes. A financial record has to outlive that sweep.
    """

    __tablename__ = "credit_order_proofs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    order_id: Mapped[str] = mapped_column(ForeignKey("credit_orders.id", ondelete="CASCADE"), nullable=False)
    file_id: Mapped[str] = mapped_column(ForeignKey("user_files.id", ondelete="CASCADE"), nullable=False)
    created_at: Mapped[int] = mapped_column(BigInteger, nullable=False)

    order: Mapped[CreditOrder] = relationship(back_populates="proofs")

    __table_args__ = (
        Index("ix_credit_order_proofs_order_id", "order_id"),
    )


class DodoCardPayment(Base):
    """One credited international-card payment via Dodo Payments.

    Idempotency ledger for the webhook: the unique constraint on
    `dodo_payment_id` is what stops an event retry (Dodo retries up to 8 times)
    from crediting the same payment twice. The row is inserted and the credit
    lot granted in the SAME transaction (see credit_dodo_card_payment), so an
    IntegrityError here means the credits were never granted either — unlike
    `credit_orders`, there is no admin review step; this table exists purely
    for the idempotency guarantee and a paper trail of what was charged.
    """

    __tablename__ = "dodo_card_payments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    uid: Mapped[str] = mapped_column(ForeignKey("users.uid", ondelete="CASCADE"), nullable=False)
    plan_id: Mapped[str] = mapped_column(String(32), nullable=False)
    credits_minor: Mapped[int] = mapped_column(Integer, nullable=False)
    # The amount actually paid, in Dodo's minor unit (USD cents). Not
    # necessarily equal to the plan's current price if pricing changed between
    # checkout creation and payment — this is what was charged, kept as a
    # record, and never re-derived from the plan.
    price_minor: Mapped[int] = mapped_column(Integer, nullable=False)
    currency: Mapped[str] = mapped_column(String(8), default="USD", nullable=False)
    dodo_payment_id: Mapped[str] = mapped_column(String(64), nullable=False)
    # The credit lot this payment created. A reversal debits THIS lot rather than
    # going through the ordinary spend order, which is gift-first and would drain
    # the user's welcome bonus while leaving the refunded purchase untouched.
    # NULL only for rows written before the column existed.
    lot_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[int] = mapped_column(BigInteger, nullable=False)

    __table_args__ = (
        Index("ux_dodo_card_payments_payment_id", "dodo_payment_id", unique=True),
        Index("ix_dodo_card_payments_uid", "uid"),
    )


class DodoCardReversal(Base):
    """One row per reversal EVENT against a card payment — refund or dispute.

    Keyed on the event's own id (`refund_id` / `dispute_id`), not on the payment
    id, because one payment can be reversed more than once: Dodo refunds may be
    partial and repeated. A `reversed_at` column on `dodo_card_payments` would
    only ever describe the first one.

    The unique index on `event_ref_id` is the idempotency guarantee, the same way
    `ux_dodo_card_payments_payment_id` is for crediting — Dodo retries a webhook
    up to 8 times, and a clawback must not run twice.
    """

    __tablename__ = "dodo_card_reversals"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    uid: Mapped[str] = mapped_column(ForeignKey("users.uid", ondelete="CASCADE"), nullable=False)
    dodo_payment_id: Mapped[str] = mapped_column(String(64), nullable=False)
    # "refund" | "dispute"
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    event_ref_id: Mapped[str] = mapped_column(String(64), nullable=False)
    # Money reversed, in the payment's minor unit.
    amount_minor: Mapped[int] = mapped_column(Integer, nullable=False)
    # Credits we actually recovered, and the part we could not because they had
    # already been spent. The balance cannot go negative (see the CHECK on
    # users.credits_minor), so a clawback floors at zero and the remainder is a
    # real loss that is recorded rather than hidden.
    credits_clawed_minor: Mapped[int] = mapped_column(Integer, nullable=False)
    written_off_minor: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[int] = mapped_column(BigInteger, nullable=False)

    __table_args__ = (
        Index("ux_dodo_card_reversals_event_ref", "event_ref_id", unique=True),
        Index("ix_dodo_card_reversals_payment_id", "dodo_payment_id"),
        Index("ix_dodo_card_reversals_uid", "uid"),
    )


class EmailSend(Base):
    """One row per automatic email we attempt to send.

    Idempotency + audit + suppression in one table. A send is claimed by inserting
    a row keyed by (uid, trigger_type, dedupe_key) BEFORE dispatch: the unique
    constraint makes a duplicate claim fail, so retries / races never double-send
    (same pattern as User.capi_registration_sent_at). `status` tracks the outcome
    so a later provider webhook can mark bounces/complaints for suppression.
    """

    __tablename__ = "email_sends"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    uid: Mapped[str] = mapped_column(ForeignKey("users.uid", ondelete="CASCADE"), nullable=False)
    trigger_type: Mapped[str] = mapped_column(String(32), nullable=False)
    dedupe_key: Mapped[str] = mapped_column(String(128), nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="claimed", nullable=False)
    provider_message_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[int] = mapped_column(BigInteger, nullable=False)
    sent_at: Mapped[int | None] = mapped_column(BigInteger, nullable=True)

    __table_args__ = (
        Index("ux_email_sends_dedupe", "uid", "trigger_type", "dedupe_key", unique=True),
        Index("ix_email_sends_created_at", "created_at"),
        Index("ix_email_sends_trigger_created_at", "trigger_type", "created_at"),
    )
