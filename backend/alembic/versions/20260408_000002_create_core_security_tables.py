"""Create core PostgreSQL security and credit tables."""

from alembic import op
import sqlalchemy as sa

revision = "20260408_000002"
down_revision = "20260408_000001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("uid", sa.String(length=128), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False, server_default=""),
        sa.Column("display_name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("credits_minor", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
        sa.Column("updated_at", sa.BigInteger(), nullable=False),
        sa.Column("last_seen_at", sa.BigInteger(), nullable=False),
        sa.Column("is_suspended", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("suspension_reason", sa.Text(), nullable=True),
        sa.CheckConstraint("credits_minor >= 0", name="ck_users_credits_minor_nonnegative"),
        sa.PrimaryKeyConstraint("uid"),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=False)
    op.create_index("ix_users_last_seen_at", "users", ["last_seen_at"], unique=False)

    op.create_table(
        "credit_codes",
        sa.Column("code_hash", sa.String(length=64), nullable=False),
        sa.Column("code_preview", sa.String(length=32), nullable=False),
        sa.Column("credits_minor", sa.Integer(), nullable=False),
        sa.Column("max_claims", sa.Integer(), nullable=False),
        sa.Column("claimed_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
        sa.Column("created_by", sa.String(length=128), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("expires_at", sa.BigInteger(), nullable=True),
        sa.CheckConstraint("claimed_count >= 0", name="ck_credit_codes_claimed_count_nonnegative"),
        sa.CheckConstraint("claimed_count <= max_claims", name="ck_credit_codes_claimed_count_within_limit"),
        sa.CheckConstraint("credits_minor > 0", name="ck_credit_codes_credits_minor_positive"),
        sa.CheckConstraint("max_claims > 0", name="ck_credit_codes_max_claims_positive"),
        sa.ForeignKeyConstraint(["created_by"], ["users.uid"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("code_hash"),
    )
    op.create_index("ix_credit_codes_created_at", "credit_codes", ["created_at"], unique=False)

    op.create_table(
        "analyze_sessions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("uid", sa.String(length=128), nullable=False),
        sa.Column("fee_minor", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("prompt", sa.Text(), nullable=False),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
        sa.Column("resolved_at", sa.BigInteger(), nullable=True),
        sa.CheckConstraint("fee_minor >= 0", name="ck_analyze_sessions_fee_minor_nonnegative"),
        sa.CheckConstraint(
            "status IN ('pending', 'completed', 'abandoned', 'failed')",
            name="ck_analyze_sessions_status_valid",
        ),
        sa.ForeignKeyConstraint(["uid"], ["users.uid"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_analyze_sessions_status_created_at", "analyze_sessions", ["status", "created_at"], unique=False)
    op.create_index("ix_analyze_sessions_uid_created_at", "analyze_sessions", ["uid", "created_at"], unique=False)

    op.create_table(
        "credit_code_claims",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("code_hash", sa.String(length=64), nullable=False),
        sa.Column("uid", sa.String(length=128), nullable=False),
        sa.Column("claimed_at", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(["code_hash"], ["credit_codes.code_hash"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["uid"], ["users.uid"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ux_credit_code_claims_code_hash_uid",
        "credit_code_claims",
        ["code_hash", "uid"],
        unique=True,
    )
    op.create_index("ix_credit_code_claims_uid_claimed_at", "credit_code_claims", ["uid", "claimed_at"], unique=False)

    op.create_table(
        "credit_ledger",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("uid", sa.String(length=128), nullable=False),
        sa.Column("delta_minor", sa.Integer(), nullable=False),
        sa.Column("reason", sa.String(length=64), nullable=False),
        sa.Column("actor_uid", sa.String(length=128), nullable=True),
        sa.Column("metadata", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("code_hash", sa.String(length=64), nullable=True),
        sa.Column("analyze_session_id", sa.String(length=36), nullable=True),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(["actor_uid"], ["users.uid"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["analyze_session_id"], ["analyze_sessions.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["code_hash"], ["credit_codes.code_hash"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["uid"], ["users.uid"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_credit_ledger_actor_uid_created_at", "credit_ledger", ["actor_uid", "created_at"], unique=False)
    op.create_index("ix_credit_ledger_reason_created_at", "credit_ledger", ["reason", "created_at"], unique=False)
    op.create_index("ix_credit_ledger_uid_created_at", "credit_ledger", ["uid", "created_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_credit_ledger_uid_created_at", table_name="credit_ledger")
    op.drop_index("ix_credit_ledger_reason_created_at", table_name="credit_ledger")
    op.drop_index("ix_credit_ledger_actor_uid_created_at", table_name="credit_ledger")
    op.drop_table("credit_ledger")

    op.drop_index("ix_credit_code_claims_uid_claimed_at", table_name="credit_code_claims")
    op.drop_index("ux_credit_code_claims_code_hash_uid", table_name="credit_code_claims")
    op.drop_table("credit_code_claims")

    op.drop_index("ix_analyze_sessions_uid_created_at", table_name="analyze_sessions")
    op.drop_index("ix_analyze_sessions_status_created_at", table_name="analyze_sessions")
    op.drop_table("analyze_sessions")

    op.drop_index("ix_credit_codes_created_at", table_name="credit_codes")
    op.drop_table("credit_codes")

    op.drop_index("ix_users_last_seen_at", table_name="users")
    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")
