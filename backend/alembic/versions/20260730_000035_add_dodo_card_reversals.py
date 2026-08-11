"""Add dodo_card_reversals, dodo_card_payments.lot_id, and the payment hold.

Everything the card rail needs to REVERSE a payment. Until now only
`payment.succeeded` touched the ledger and nothing debited it, so a refund or a
chargeback left the credits in place with no record that the money had gone
back.

Three parts:
- `dodo_card_reversals` — one row per reversal EVENT, keyed unique on the
  refund/dispute id. Not a `reversed_at` column on `dodo_card_payments`: Dodo
  refunds can be partial and repeated, so one payment may be reversed several
  times and a single column could only ever describe the first.
- `dodo_card_payments.lot_id` — which credit lot the payment created, so a
  clawback can debit that exact lot instead of the ordinary gift-first spend
  order. Backfilled from the ledger for rows written before this migration.
- `users.payment_hold_at` / `payment_hold_reason` — the spending freeze applied
  while a dispute is open.
"""

from alembic import op
import sqlalchemy as sa

revision = "20260730_000035"
down_revision = "20260729_000034"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "dodo_card_reversals",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("uid", sa.String(length=128), sa.ForeignKey("users.uid", ondelete="CASCADE"), nullable=False),
        sa.Column("dodo_payment_id", sa.String(length=64), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("event_ref_id", sa.String(length=64), nullable=False),
        sa.Column("amount_minor", sa.Integer(), nullable=False),
        sa.Column("credits_clawed_minor", sa.Integer(), nullable=False),
        sa.Column("written_off_minor", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
    )
    # The idempotency guarantee: Dodo retries a delivery up to 8 times and a
    # clawback must not run twice for the same refund or dispute.
    op.create_index(
        "ux_dodo_card_reversals_event_ref",
        "dodo_card_reversals",
        ["event_ref_id"],
        unique=True,
    )
    op.create_index("ix_dodo_card_reversals_payment_id", "dodo_card_reversals", ["dodo_payment_id"])
    op.create_index("ix_dodo_card_reversals_uid", "dodo_card_reversals", ["uid"])

    op.add_column("dodo_card_payments", sa.Column("lot_id", sa.String(length=36), nullable=True))
    # Backfill from the ledger: credit_dodo_card_payment has always written the
    # lot id into the card_purchase entry's metadata, so existing payments can be
    # linked to their lot without guessing. Rows with no matching ledger entry
    # keep a NULL lot_id and simply cannot be auto-reversed.
    op.execute(
        """
        UPDATE dodo_card_payments AS p
        SET lot_id = l.metadata ->> 'lot_id'
        FROM credit_ledger AS l
        WHERE l.reason = 'card_purchase'
          AND l.metadata ->> 'dodo_payment_id' = p.dodo_payment_id
          AND l.metadata ->> 'lot_id' IS NOT NULL
          AND p.lot_id IS NULL
        """
    )

    op.add_column("users", sa.Column("payment_hold_at", sa.BigInteger(), nullable=True))
    op.add_column("users", sa.Column("payment_hold_reason", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "payment_hold_reason")
    op.drop_column("users", "payment_hold_at")
    op.drop_column("dodo_card_payments", "lot_id")
    op.drop_index("ix_dodo_card_reversals_uid", table_name="dodo_card_reversals")
    op.drop_index("ix_dodo_card_reversals_payment_id", table_name="dodo_card_reversals")
    op.drop_index("ux_dodo_card_reversals_event_ref", table_name="dodo_card_reversals")
    op.drop_table("dodo_card_reversals")
