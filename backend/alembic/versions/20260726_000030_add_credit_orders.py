"""Add credit_orders + credit_order_proofs (manual Tunisian credit purchase flow).

Also widens user_files.kind to allow 'payment_proof'. That kind matters: the
30-day upload reaper in main.py sweeps by kind='uploaded_input', and a payment
receipt is a financial record that must not be deleted out from under an order.
"""

from alembic import op
import sqlalchemy as sa

revision = "20260726_000030"
down_revision = "20260720_000029"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "credit_orders",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("uid", sa.String(length=128), sa.ForeignKey("users.uid", ondelete="CASCADE"), nullable=False),
        sa.Column("plan_id", sa.String(length=32), nullable=False),
        sa.Column("plan_name", sa.String(length=64), nullable=False),
        sa.Column("credits_minor", sa.Integer(), nullable=False),
        sa.Column("price_minor", sa.Integer(), nullable=False),
        sa.Column("currency", sa.String(length=8), nullable=False, server_default="TND"),
        sa.Column("payment_method", sa.String(length=32), nullable=False),
        sa.Column("note", sa.String(length=400), nullable=False, server_default=""),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="pending"),
        sa.Column("code_plain", sa.String(length=64), nullable=True),
        sa.Column("admin_message", sa.String(length=400), nullable=False, server_default=""),
        sa.Column("resolved_by_email", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("resolved_at", sa.BigInteger(), nullable=True),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
        sa.Column("updated_at", sa.BigInteger(), nullable=False),
        sa.CheckConstraint("credits_minor > 0", name="ck_credit_orders_credits_positive"),
        sa.CheckConstraint("price_minor >= 0", name="ck_credit_orders_price_non_negative"),
        sa.CheckConstraint(
            "status IN ('pending', 'accepted', 'refused')",
            name="ck_credit_orders_status_valid",
        ),
    )
    op.create_index("ix_credit_orders_uid_created_at", "credit_orders", ["uid", "created_at"])
    op.create_index("ix_credit_orders_status_created_at", "credit_orders", ["status", "created_at"])

    op.create_table(
        "credit_order_proofs",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "order_id",
            sa.String(length=36),
            sa.ForeignKey("credit_orders.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "file_id",
            sa.String(length=36),
            sa.ForeignKey("user_files.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
    )
    op.create_index("ix_credit_order_proofs_order_id", "credit_order_proofs", ["order_id"])

    op.execute("ALTER TABLE user_files DROP CONSTRAINT ck_user_files_kind_valid")
    op.execute(
        "ALTER TABLE user_files ADD CONSTRAINT ck_user_files_kind_valid "
        "CHECK (kind IN ('uploaded_input', 'generated_output', 'payment_proof'))"
    )


def downgrade() -> None:
    # Proof rows must go before the CHECK narrows again, or the constraint would be
    # added against rows it rejects.
    op.execute("DELETE FROM user_files WHERE kind = 'payment_proof'")
    op.execute("ALTER TABLE user_files DROP CONSTRAINT ck_user_files_kind_valid")
    op.execute(
        "ALTER TABLE user_files ADD CONSTRAINT ck_user_files_kind_valid "
        "CHECK (kind IN ('uploaded_input', 'generated_output'))"
    )

    op.drop_index("ix_credit_order_proofs_order_id", table_name="credit_order_proofs")
    op.drop_table("credit_order_proofs")
    op.drop_index("ix_credit_orders_status_created_at", table_name="credit_orders")
    op.drop_index("ix_credit_orders_uid_created_at", table_name="credit_orders")
    op.drop_table("credit_orders")
