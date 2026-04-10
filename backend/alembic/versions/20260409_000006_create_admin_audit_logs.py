"""Create admin audit logs table."""

from alembic import op
import sqlalchemy as sa

revision = "20260409_000006"
down_revision = "20260408_000005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "admin_audit_logs",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("admin_uid", sa.String(length=128), nullable=True),
        sa.Column("admin_email", sa.String(length=320), nullable=False, server_default=""),
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column("target_type", sa.String(length=64), nullable=False),
        sa.Column("target_id", sa.String(length=128), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("metadata", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(["admin_uid"], ["users.uid"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_admin_audit_logs_created_at", "admin_audit_logs", ["created_at"], unique=False)
    op.create_index(
        "ix_admin_audit_logs_admin_uid_created_at",
        "admin_audit_logs",
        ["admin_uid", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_admin_audit_logs_target_created_at",
        "admin_audit_logs",
        ["target_type", "target_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_admin_audit_logs_action_created_at",
        "admin_audit_logs",
        ["action", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_admin_audit_logs_action_created_at", table_name="admin_audit_logs")
    op.drop_index("ix_admin_audit_logs_target_created_at", table_name="admin_audit_logs")
    op.drop_index("ix_admin_audit_logs_admin_uid_created_at", table_name="admin_audit_logs")
    op.drop_index("ix_admin_audit_logs_created_at", table_name="admin_audit_logs")
    op.drop_table("admin_audit_logs")
