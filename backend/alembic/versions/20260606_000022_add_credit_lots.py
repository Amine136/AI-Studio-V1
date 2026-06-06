"""Add credit lots, lot allocations, and gift-code validity window.

Introduces expiry-aware credit accounting:
  * credit_codes.validity_seconds  -- redeemed-credit validity window (NULL = never)
  * credit_lots                    -- discrete parcels of credits with optional expiry
  * credit_lot_allocations         -- per-lot reservations held by in-flight jobs

Backfills every existing user's spendable + reserved balance into a single
non-expiring `legacy` lot, and recreates allocations for in-flight generation
jobs so capture/release keep working seamlessly after deploy. Existing balances
(and already-redeemed gifts) therefore NEVER expire -- only newly created codes
that carry a validity window will produce expiring gift lots.
"""

from alembic import op
import sqlalchemy as sa


revision = "20260606_000022"
down_revision = "20260519_000021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "credit_codes",
        sa.Column("validity_seconds", sa.Integer(), nullable=True),
    )

    op.create_table(
        "credit_lots",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("uid", sa.String(length=128), nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("original_minor", sa.Integer(), nullable=False),
        sa.Column("remaining_minor", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("reserved_minor", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("granted_at", sa.BigInteger(), nullable=False),
        sa.Column("expires_at", sa.BigInteger(), nullable=True),
        sa.Column("expired_at", sa.BigInteger(), nullable=True),
        sa.Column("code_hash", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(["uid"], ["users.uid"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["code_hash"], ["credit_codes.code_hash"], ondelete="SET NULL"),
        sa.CheckConstraint("original_minor >= 0", name="ck_credit_lots_original_nonnegative"),
        sa.CheckConstraint("remaining_minor >= 0", name="ck_credit_lots_remaining_nonnegative"),
        sa.CheckConstraint("reserved_minor >= 0", name="ck_credit_lots_reserved_nonnegative"),
        sa.CheckConstraint(
            "source IN ('gift', 'legacy', 'admin_grant', 'purchase', 'refund')",
            name="ck_credit_lots_source_valid",
        ),
    )
    op.create_index("ix_credit_lots_uid_expires_at", "credit_lots", ["uid", "expires_at"])
    op.create_index("ix_credit_lots_uid_source", "credit_lots", ["uid", "source"])
    op.create_index(
        "ix_credit_lots_expires_remaining", "credit_lots", ["expires_at", "remaining_minor"]
    )

    op.create_table(
        "credit_lot_allocations",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("lot_id", sa.String(length=36), nullable=False),
        sa.Column("ref_type", sa.String(length=16), nullable=False),
        sa.Column("ref_id", sa.String(length=36), nullable=False),
        sa.Column("reserved_minor", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(["lot_id"], ["credit_lots.id"], ondelete="CASCADE"),
        sa.CheckConstraint(
            "reserved_minor >= 0", name="ck_credit_lot_allocations_reserved_nonnegative"
        ),
        sa.CheckConstraint(
            "ref_type IN ('generation', 'analyze')",
            name="ck_credit_lot_allocations_ref_type_valid",
        ),
    )
    op.create_index(
        "ix_credit_lot_allocations_ref", "credit_lot_allocations", ["ref_type", "ref_id"]
    )
    op.create_index(
        "ix_credit_lot_allocations_lot_id", "credit_lot_allocations", ["lot_id"]
    )

    # --- Backfill: one non-expiring legacy lot per user holding their current
    # spendable + reserved balance. original = remaining + reserved (consumed = 0).
    op.execute(
        """
        INSERT INTO credit_lots
            (id, uid, source, original_minor, remaining_minor, reserved_minor,
             granted_at, expires_at, expired_at, code_hash, created_at)
        SELECT
            gen_random_uuid()::text,
            u.uid,
            'legacy',
            u.credits_minor + u.reserved_credits_minor,
            u.credits_minor,
            u.reserved_credits_minor,
            u.created_at,
            NULL,
            NULL,
            NULL,
            EXTRACT(EPOCH FROM now())::bigint
        FROM users u
        WHERE u.credits_minor > 0 OR u.reserved_credits_minor > 0
        """
    )

    # --- Backfill allocations for in-flight generation jobs against the user's
    # legacy lot, so capture/release can settle them per-lot post-deploy.
    op.execute(
        """
        INSERT INTO credit_lot_allocations
            (id, lot_id, ref_type, ref_id, reserved_minor, created_at)
        SELECT
            gen_random_uuid()::text,
            l.id,
            'generation',
            j.id,
            j.reserved_minor,
            EXTRACT(EPOCH FROM now())::bigint
        FROM generation_jobs j
        JOIN credit_lots l
          ON l.uid = j.uid AND l.source = 'legacy'
        WHERE j.status IN ('pending', 'processing', 'awaiting_review')
          AND j.reserved_minor > 0
        """
    )


def downgrade() -> None:
    op.drop_index("ix_credit_lot_allocations_lot_id", table_name="credit_lot_allocations")
    op.drop_index("ix_credit_lot_allocations_ref", table_name="credit_lot_allocations")
    op.drop_table("credit_lot_allocations")
    op.drop_index("ix_credit_lots_expires_remaining", table_name="credit_lots")
    op.drop_index("ix_credit_lots_uid_source", table_name="credit_lots")
    op.drop_index("ix_credit_lots_uid_expires_at", table_name="credit_lots")
    op.drop_table("credit_lots")
    op.drop_column("credit_codes", "validity_seconds")
