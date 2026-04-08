"""Create history and generation job tables."""

from alembic import op
import sqlalchemy as sa

revision = "20260408_000003"
down_revision = "20260408_000002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "history_entries",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("uid", sa.String(length=128), nullable=False),
        sa.Column("image_url", sa.Text(), nullable=True),
        sa.Column("caption", sa.Text(), nullable=True),
        sa.Column("prompt", sa.Text(), nullable=False),
        sa.Column("model", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(["uid"], ["users.uid"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_history_entries_uid_created_at", "history_entries", ["uid", "created_at"], unique=False)

    op.create_table(
        "generation_jobs",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("uid", sa.String(length=128), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("prompt", sa.Text(), nullable=False),
        sa.Column("requested_outputs", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("request_payload", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("reserved_minor", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("captured_minor", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("refunded_minor", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("failure_reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
        sa.Column("updated_at", sa.BigInteger(), nullable=False),
        sa.Column("completed_at", sa.BigInteger(), nullable=True),
        sa.CheckConstraint("reserved_minor >= 0", name="ck_generation_jobs_reserved_minor_nonnegative"),
        sa.CheckConstraint("captured_minor >= 0", name="ck_generation_jobs_captured_minor_nonnegative"),
        sa.CheckConstraint("refunded_minor >= 0", name="ck_generation_jobs_refunded_minor_nonnegative"),
        sa.CheckConstraint(
            "status IN ('pending', 'processing', 'awaiting_review', 'completed', 'failed', 'cancelled')",
            name="ck_generation_jobs_status_valid",
        ),
        sa.ForeignKeyConstraint(["uid"], ["users.uid"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_generation_jobs_status_created_at", "generation_jobs", ["status", "created_at"], unique=False)
    op.create_index("ix_generation_jobs_uid_created_at", "generation_jobs", ["uid", "created_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_generation_jobs_uid_created_at", table_name="generation_jobs")
    op.drop_index("ix_generation_jobs_status_created_at", table_name="generation_jobs")
    op.drop_table("generation_jobs")

    op.drop_index("ix_history_entries_uid_created_at", table_name="history_entries")
    op.drop_table("history_entries")
