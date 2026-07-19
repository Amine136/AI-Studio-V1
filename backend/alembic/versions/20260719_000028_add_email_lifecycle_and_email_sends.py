"""Add email_lifecycle_enabled consent flag + email_sends idempotency/audit table."""

from alembic import op
import sqlalchemy as sa

revision = "20260719_000028"
down_revision = "20260717_000027"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Lifecycle/marketing consent (onboarding drip + win-back), opt-out independent
    # of platform-updates. Default true; the unsubscribe link flips it to false.
    op.add_column(
        "users",
        sa.Column("email_lifecycle_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.alter_column("users", "email_lifecycle_enabled", server_default=None)

    # One row per automatic email attempt. The unique (uid, trigger_type, dedupe_key)
    # is claimed before dispatch so retries/races never double-send.
    op.create_table(
        "email_sends",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("uid", sa.String(length=128), sa.ForeignKey("users.uid", ondelete="CASCADE"), nullable=False),
        sa.Column("trigger_type", sa.String(length=32), nullable=False),
        sa.Column("dedupe_key", sa.String(length=128), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="claimed"),
        sa.Column("provider_message_id", sa.String(length=255), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
        sa.Column("sent_at", sa.BigInteger(), nullable=True),
    )
    op.create_index(
        "ux_email_sends_dedupe", "email_sends", ["uid", "trigger_type", "dedupe_key"], unique=True
    )
    op.create_index("ix_email_sends_created_at", "email_sends", ["created_at"])
    op.create_index("ix_email_sends_trigger_created_at", "email_sends", ["trigger_type", "created_at"])
    op.alter_column("email_sends", "status", server_default=None)


def downgrade() -> None:
    op.drop_index("ix_email_sends_trigger_created_at", table_name="email_sends")
    op.drop_index("ix_email_sends_created_at", table_name="email_sends")
    op.drop_index("ux_email_sends_dedupe", table_name="email_sends")
    op.drop_table("email_sends")
    op.drop_column("users", "email_lifecycle_enabled")
