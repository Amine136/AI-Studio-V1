"""Add dodo_card_payments (international card checkout via Dodo Payments).

Unlike credit_orders (the manual Tunisian flow), this table has no admin-review
columns — it exists purely so the webhook that credits the ledger can dedupe
Dodo's retried deliveries by dodo_payment_id.
"""

from alembic import op
import sqlalchemy as sa

revision = "20260729_000034"
down_revision = "20260728_000033"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "dodo_card_payments",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("uid", sa.String(length=128), sa.ForeignKey("users.uid", ondelete="CASCADE"), nullable=False),
        sa.Column("plan_id", sa.String(length=32), nullable=False),
        sa.Column("credits_minor", sa.Integer(), nullable=False),
        sa.Column("price_minor", sa.Integer(), nullable=False),
        sa.Column("currency", sa.String(length=8), nullable=False, server_default="USD"),
        sa.Column("dodo_payment_id", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
    )
    op.create_index(
        "ux_dodo_card_payments_payment_id",
        "dodo_card_payments",
        ["dodo_payment_id"],
        unique=True,
    )
    op.create_index("ix_dodo_card_payments_uid", "dodo_card_payments", ["uid"])


def downgrade() -> None:
    op.drop_index("ix_dodo_card_payments_uid", table_name="dodo_card_payments")
    op.drop_index("ux_dodo_card_payments_payment_id", table_name="dodo_card_payments")
    op.drop_table("dodo_card_payments")
