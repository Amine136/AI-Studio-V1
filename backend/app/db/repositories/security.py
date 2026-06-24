from __future__ import annotations

import hashlib
import re
import time
import uuid
from typing import Any

from sqlalchemy import case, delete, func, select
from sqlalchemy.orm import Session
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.db.models import AdminAccount, AdminAuditLog, AdminSession, AnalyzeSession, ChatConversation, ChatMessage, CreditCode, CreditCodeClaim, CreditLedgerEntry, CreditLot, CreditLotAllocation, DashboardNewsItem, DeactivatedEmail, GenerationJob, HistoryEntry, ModerationRejection, RateLimitBucket, User, UserFile

USERNAME_ALLOWED_RE = re.compile(r"[^a-z0-9._-]+")


def _default_username(email: str, display_name: str, uid: str) -> str:
    seed = (email.split("@", 1)[0] if "@" in email else display_name or uid).strip().lower()
    normalized = USERNAME_ALLOWED_RE.sub("", seed)
    return normalized[:15] or "vibecraft"


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

    def touch_admin_session(
        self,
        entry: AdminSession,
        *,
        refreshed_at: int | None = None,
        expires_at: int | None = None,
    ) -> AdminSession:
        now = refreshed_at or int(time.time())
        entry.updated_at = now
        if expires_at is not None:
            entry.expires_at = expires_at
        self.session.flush()
        return entry

    def list_dashboard_news_items(self, *, active_only: bool = False) -> list[DashboardNewsItem]:
        stmt = select(DashboardNewsItem)
        if active_only:
            stmt = stmt.where(DashboardNewsItem.is_active.is_(True))
        stmt = stmt.order_by(DashboardNewsItem.sort_order.asc(), DashboardNewsItem.updated_at.desc(), DashboardNewsItem.created_at.desc())
        return list(self.session.execute(stmt).scalars())

    def get_dashboard_news_item(self, item_id: str) -> DashboardNewsItem | None:
        return self.session.get(DashboardNewsItem, item_id)

    def get_dashboard_news_item_for_update(self, item_id: str) -> DashboardNewsItem | None:
        return self.session.execute(
            select(DashboardNewsItem).where(DashboardNewsItem.id == item_id).with_for_update()
        ).scalar_one_or_none()

    def create_dashboard_news_item(
        self,
        *,
        badge: str,
        when_label: str,
        title: str,
        title_fr: str,
        title_ar: str,
        description: str,
        description_fr: str,
        description_ar: str,
        link_label: str,
        link_label_fr: str,
        link_label_ar: str,
        link_href: str,
        tone: str,
        sort_order: int,
        is_active: bool,
    ) -> DashboardNewsItem:
        now = int(time.time())
        item = DashboardNewsItem(
            id=str(uuid.uuid4()),
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
            created_at=now,
            updated_at=now,
        )
        self.session.add(item)
        self.session.flush()
        return item

    def update_dashboard_news_item(
        self,
        item: DashboardNewsItem,
        *,
        badge: str,
        when_label: str,
        title: str,
        title_fr: str,
        title_ar: str,
        description: str,
        description_fr: str,
        description_ar: str,
        link_label: str,
        link_label_fr: str,
        link_label_ar: str,
        link_href: str,
        tone: str,
        sort_order: int,
        is_active: bool,
    ) -> DashboardNewsItem:
        item.badge = badge
        item.when_label = when_label
        item.title = title
        item.title_fr = title_fr
        item.title_ar = title_ar
        item.description = description
        item.description_fr = description_fr
        item.description_ar = description_ar
        item.link_label = link_label
        item.link_label_fr = link_label_fr
        item.link_label_ar = link_label_ar
        item.link_href = link_href
        item.tone = tone
        item.sort_order = sort_order
        item.is_active = is_active
        item.updated_at = int(time.time())
        self.session.flush()
        return item

    def delete_dashboard_news_item(self, item: DashboardNewsItem) -> None:
        self.session.delete(item)
        self.session.flush()

    def _username_taken(self, username: str, *, exclude_uid: str | None = None) -> bool:
        stmt = select(User.uid).where(User.username == username)
        if exclude_uid is not None:
            stmt = stmt.where(User.uid != exclude_uid)
        return self.session.execute(stmt).first() is not None

    def _unique_username(self, base: str, *, exclude_uid: str | None = None) -> str:
        """Derive a username that does not collide with an existing one.

        The base (email local-part) is not unique across accounts, so on a
        collision we append a short random suffix until we find a free handle
        (username column is capped at 15 chars).
        """
        candidate = (base or "vibecraft")[:15] or "vibecraft"
        if not self._username_taken(candidate, exclude_uid=exclude_uid):
            return candidate
        root = (base or "user")[:10] or "user"
        for _ in range(25):
            candidate = (root + uuid.uuid4().hex[:4])[:15]
            if not self._username_taken(candidate, exclude_uid=exclude_uid):
                return candidate
        return ("u" + uuid.uuid4().hex)[:15]

    def ensure_user(self, uid: str, email: str, display_name: str) -> User:
        now = int(time.time())
        user = self.session.get(User, uid)
        was_created = user is None
        if user is None:
            user = User(
                uid=uid,
                email=email,
                display_name=display_name,
                username=self._unique_username(_default_username(email, display_name, uid)),
                bio="",
                credits_minor=0,
                reserved_credits_minor=0,
                created_at=now,
                updated_at=now,
                last_seen_at=now,
            )
            self.session.add(user)
        else:
            user.email = email
            # Only sync display_name from the auth provider when it carries a
            # real name. Email-link sign-in has no name claim (display_name falls
            # back to the email/uid), so overwriting here would wipe a name the
            # user set during onboarding on every subsequent login.
            if display_name and display_name != email and display_name != uid:
                user.display_name = display_name
            if not str(user.username or "").strip():
                user.username = self._unique_username(
                    _default_username(email, display_name, uid), exclude_uid=uid
                )
            user.updated_at = now
            user.last_seen_at = now
        self.session.flush()
        # Transient (non-persisted) marker so callers can fire a one-time
        # server-side CompleteRegistration only for genuinely new users.
        user._is_newly_created = was_created
        return user

    def update_user_profile(self, user: User, *, username: str, bio: str, updated_at: int) -> User:
        user.username = username
        user.bio = bio
        user.updated_at = updated_at
        user.last_seen_at = updated_at
        self.session.flush()
        return user

    def complete_profile(self, user: User, *, display_name: str, username: str, updated_at: int) -> User:
        user.display_name = display_name
        user.username = username
        user.updated_at = updated_at
        user.last_seen_at = updated_at
        self.session.flush()
        return user

    def update_user_notification_preferences(
        self,
        user: User,
        *,
        email_general_news_enabled: bool,
        email_platform_updates_enabled: bool,
        updated_at: int,
    ) -> User:
        user.email_general_news_enabled = bool(email_general_news_enabled)
        user.email_platform_updates_enabled = bool(email_platform_updates_enabled)
        user.updated_at = updated_at
        user.last_seen_at = updated_at
        self.session.flush()
        return user

    def deactivate_user(self, user: User, *, reason: str, updated_at: int) -> User:
        user.is_deactivated = True
        user.deactivated_at = updated_at
        user.deactivation_reason = reason
        user.is_suspended = True
        user.suspension_reason = reason
        user.updated_at = updated_at
        user.last_seen_at = updated_at
        self.session.flush()
        return user

    def get_deactivated_email(self, email: str) -> DeactivatedEmail | None:
        normalized = email.strip().lower()
        if not normalized:
            return None
        return self.session.get(DeactivatedEmail, normalized)

    def upsert_deactivated_email(
        self,
        *,
        email: str,
        original_uid: str | None,
        deactivated_at: int,
        reason: str | None,
    ) -> DeactivatedEmail:
        normalized = email.strip().lower()
        entry = DeactivatedEmail(
            email=normalized,
            original_uid=original_uid.strip() if original_uid else None,
            deactivated_at=deactivated_at,
            reason=reason.strip() if reason else None,
        )
        stmt = pg_insert(DeactivatedEmail).values(
            email=entry.email,
            original_uid=entry.original_uid,
            deactivated_at=entry.deactivated_at,
            reason=entry.reason,
        )
        stmt = stmt.on_conflict_do_update(
            index_elements=[DeactivatedEmail.email],
            set_={
                "original_uid": entry.original_uid,
                "deactivated_at": entry.deactivated_at,
                "reason": entry.reason,
            },
        )
        self.session.execute(stmt)
        self.session.flush()
        return self.session.get(DeactivatedEmail, normalized)

    def get_user(self, uid: str) -> User | None:
        return self.session.get(User, uid)

    def get_user_by_username(self, username: str) -> User | None:
        normalized = str(username or "").strip().lower()
        if not normalized:
            return None
        return self.session.execute(
            select(User).where(User.username == normalized)
        ).scalar_one_or_none()

    def get_user_for_update(self, uid: str) -> User | None:
        return self.session.execute(
            select(User).where(User.uid == uid).with_for_update()
        ).scalar_one_or_none()

    def add_moderation_rejection(
        self,
        *,
        uid: str,
        model: str | None,
        code: str | None,
        created_at: int,
        rejection_id: str | None = None,
    ) -> ModerationRejection:
        entry = ModerationRejection(
            id=rejection_id or str(uuid.uuid4()),
            uid=uid,
            model=(model or "")[:255],
            code=(code or "")[:64],
            created_at=created_at,
        )
        self.session.add(entry)
        self.session.flush()
        return entry

    def count_moderation_rejections_since(self, uid: str, since_ts: int) -> int:
        return int(
            self.session.execute(
                select(func.count())
                .select_from(ModerationRejection)
                .where(
                    ModerationRejection.uid == uid,
                    ModerationRejection.created_at >= since_ts,
                )
            ).scalar_one()
            or 0
        )

    def create_user_file(
        self,
        *,
        owner_uid: str,
        storage_path: str,
        kind: str,
        mime_type: str,
        file_id: str | None = None,
        created_at: int | None = None,
    ) -> UserFile:
        entry = UserFile(
            id=file_id or str(uuid.uuid4()),
            owner_uid=owner_uid,
            storage_path=storage_path,
            kind=kind,
            mime_type=mime_type,
            created_at=created_at or int(time.time()),
        )
        self.session.add(entry)
        self.session.flush()
        return entry

    def get_user_file(self, file_id: str) -> UserFile | None:
        return self.session.get(UserFile, file_id)

    def get_user_file_for_owner(self, file_id: str, owner_uid: str) -> UserFile | None:
        return self.session.execute(
            select(UserFile).where(
                UserFile.id == file_id,
                UserFile.owner_uid == owner_uid,
            )
        ).scalar_one_or_none()

    def list_user_files_before(self, *, kind: str, created_before: int) -> list[UserFile]:
        return list(
            self.session.execute(
                select(UserFile).where(
                    UserFile.kind == kind,
                    UserFile.created_at < created_before,
                )
            ).scalars()
        )

    def delete_user_file(self, entry: UserFile) -> None:
        self.session.delete(entry)
        self.session.flush()

    def list_users(self) -> list[User]:
        return list(
            self.session.execute(
                select(User).order_by(User.last_seen_at.desc())
            ).scalars()
        )

    def create_credit_code(
        self,
        code_hash: str,
        code_preview: str,
        credits_minor: int,
        max_claims: int,
        created_by: str | None,
        *,
        validity_seconds: int | None = None,
    ) -> CreditCode:
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
            validity_seconds=validity_seconds,
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
        validity_seconds: int | None = None,
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
            validity_seconds=validity_seconds,
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

    # ------------------------------------------------------------------ #
    # Credit lots (expiry-aware balance parcels)
    # ------------------------------------------------------------------ #
    @staticmethod
    def _lot_spend_order():
        # Gift/expiring lots first (soonest expiry first), then non-expiring
        # lots; deterministic tie-break keeps splits reproducible.
        return (
            case((CreditLot.expires_at.is_(None), 1), else_=0),
            CreditLot.expires_at.asc(),
            CreditLot.granted_at.asc(),
            CreditLot.id.asc(),
        )

    def create_credit_lot(
        self,
        *,
        uid: str,
        source: str,
        amount_minor: int,
        granted_at: int,
        expires_at: int | None,
        code_hash: str | None = None,
        reserved_minor: int = 0,
    ) -> CreditLot:
        now = int(time.time())
        lot = CreditLot(
            id=str(uuid.uuid4()),
            uid=uid,
            source=source,
            original_minor=amount_minor + reserved_minor,
            remaining_minor=amount_minor,
            reserved_minor=reserved_minor,
            granted_at=granted_at,
            expires_at=expires_at,
            expired_at=None,
            code_hash=code_hash,
            created_at=now,
        )
        self.session.add(lot)
        self.session.flush()
        return lot

    def list_spendable_lots(self, uid: str) -> list[CreditLot]:
        return list(
            self.session.execute(
                select(CreditLot)
                .where(CreditLot.uid == uid, CreditLot.remaining_minor > 0)
                .order_by(*self._lot_spend_order())
            ).scalars()
        )

    def list_spendable_lots_for_update(self, uid: str) -> list[CreditLot]:
        return list(
            self.session.execute(
                select(CreditLot)
                .where(CreditLot.uid == uid, CreditLot.remaining_minor > 0)
                .order_by(*self._lot_spend_order())
                .with_for_update()
            ).scalars()
        )

    def has_due_expiry(self, uid: str, now: int) -> bool:
        """Cheap, read-only, index-backed check: does this user have any expired
        lot that still holds spendable credits? Lets read paths avoid taking a
        FOR UPDATE lock / writing on every call when there is nothing to expire."""
        return self.session.execute(
            select(CreditLot.id)
            .where(
                CreditLot.uid == uid,
                CreditLot.expires_at.is_not(None),
                CreditLot.expires_at <= now,
                CreditLot.remaining_minor > 0,
            )
            .limit(1)
        ).first() is not None

    def list_expired_lots_for_update(self, uid: str, now: int) -> list[CreditLot]:
        return list(
            self.session.execute(
                select(CreditLot)
                .where(
                    CreditLot.uid == uid,
                    CreditLot.expires_at.is_not(None),
                    CreditLot.expires_at <= now,
                    CreditLot.remaining_minor > 0,
                )
                .order_by(CreditLot.expires_at.asc(), CreditLot.id.asc())
                .with_for_update()
            ).scalars()
        )

    def get_lot_for_update(self, lot_id: str) -> CreditLot | None:
        return self.session.execute(
            select(CreditLot).where(CreditLot.id == lot_id).with_for_update()
        ).scalar_one_or_none()

    def list_uids_with_expired_lots(self, now: int, *, limit: int = 1000) -> list[str]:
        return list(
            self.session.execute(
                select(CreditLot.uid)
                .where(
                    CreditLot.expires_at.is_not(None),
                    CreditLot.expires_at <= now,
                    CreditLot.remaining_minor > 0,
                )
                .group_by(CreditLot.uid)
                .limit(limit)
            ).scalars()
        )

    def create_lot_allocation(
        self,
        *,
        lot_id: str,
        ref_type: str,
        ref_id: str,
        reserved_minor: int,
        created_at: int,
    ) -> CreditLotAllocation:
        allocation = CreditLotAllocation(
            id=str(uuid.uuid4()),
            lot_id=lot_id,
            ref_type=ref_type,
            ref_id=ref_id,
            reserved_minor=reserved_minor,
            created_at=created_at,
        )
        self.session.add(allocation)
        self.session.flush()
        return allocation

    def list_allocations_for_update(self, ref_type: str, ref_id: str) -> list[CreditLotAllocation]:
        return list(
            self.session.execute(
                select(CreditLotAllocation)
                .where(
                    CreditLotAllocation.ref_type == ref_type,
                    CreditLotAllocation.ref_id == ref_id,
                )
                .with_for_update()
            ).scalars()
        )

    def delete_lot_allocations(self, ref_type: str, ref_id: str) -> int:
        result = self.session.execute(
            delete(CreditLotAllocation).where(
                CreditLotAllocation.ref_type == ref_type,
                CreditLotAllocation.ref_id == ref_id,
            )
        )
        self.session.flush()
        return int(result.rowcount or 0)

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

    def list_credit_ledger_entries(self, uid: str, max_items: int = 20) -> list[CreditLedgerEntry]:
        bounded_limit = max(1, min(int(max_items), 100))
        return list(
            self.session.execute(
                select(CreditLedgerEntry)
                .where(CreditLedgerEntry.uid == uid)
                .order_by(CreditLedgerEntry.created_at.desc(), CreditLedgerEntry.id.desc())
                .limit(bounded_limit)
            ).scalars()
        )

    def get_ledger_entry_by_analyze_session(self, session_id: str, reason: str) -> CreditLedgerEntry | None:
        return self.session.execute(
            select(CreditLedgerEntry)
            .where(
                CreditLedgerEntry.analyze_session_id == session_id,
                CreditLedgerEntry.reason == reason,
            )
            .order_by(CreditLedgerEntry.created_at.asc(), CreditLedgerEntry.id.asc())
            .limit(1)
        ).scalar_one_or_none()

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

    def count_history(self, uid: str) -> int:
        return int(
            self.session.execute(
                select(func.count())
                .select_from(HistoryEntry)
                .where(HistoryEntry.uid == uid)
            ).scalar_one()
        )

    def delete_history_entries_by_image_urls(self, uid: str, image_urls: set[str]) -> int:
        normalized_urls = {url.strip() for url in image_urls if url and url.strip()}
        if not normalized_urls:
            return 0
        result = self.session.execute(
            delete(HistoryEntry).where(
                HistoryEntry.uid == uid,
                HistoryEntry.image_url.in_(normalized_urls),
            )
        )
        self.session.flush()
        return int(result.rowcount or 0)

    def create_chat_conversation(self, uid: str, model: str, system_parts: list[dict[str, Any]], title: str = "New Chat") -> ChatConversation:
        now = int(time.time())
        entry = ChatConversation(
            id=str(uuid.uuid4()),
            uid=uid,
            model=model,
            title=title,
            system_json=system_parts,
            created_at=now,
            updated_at=now,
            last_message_at=None,
            prompt_tokens_total=0,
            completion_tokens_total=0,
            total_cost_micro=0,
            total_cost_minor=0,
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
        title: str | None = None,
        prompt_tokens_delta: int = 0,
        completion_tokens_delta: int = 0,
        total_cost_micro_delta: int = 0,
        total_cost_minor: int | None = None,
    ) -> ChatConversation:
        now = touched_at or int(time.time())
        if title is not None:
            conversation.title = title
        conversation.updated_at = now
        conversation.last_message_at = now
        conversation.prompt_tokens_total = max(int(conversation.prompt_tokens_total or 0) + int(prompt_tokens_delta or 0), 0)
        conversation.completion_tokens_total = max(int(conversation.completion_tokens_total or 0) + int(completion_tokens_delta or 0), 0)
        conversation.total_cost_micro = max(int(conversation.total_cost_micro or 0) + int(total_cost_micro_delta or 0), 0)
        if total_cost_minor is not None:
            conversation.total_cost_minor = max(int(total_cost_minor), 0)
        self.session.flush()
        return conversation

    def update_chat_conversation_title(self, conversation: ChatConversation, title: str) -> ChatConversation:
        conversation.title = title
        conversation.updated_at = int(time.time())
        self.session.flush()
        return conversation

    def delete_chat_conversation(self, conversation: ChatConversation) -> None:
        self.session.delete(conversation)
        self.session.flush()

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
                .order_by(
                    ChatMessage.created_at.asc(),
                    case((ChatMessage.role == "user", 0), else_=1).asc(),
                    ChatMessage.id.asc(),
                )
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
