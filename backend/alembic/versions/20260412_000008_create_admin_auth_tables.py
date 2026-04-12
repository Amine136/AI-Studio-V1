"""Create admin account and session tables."""

from alembic import op
import sqlalchemy as sa

revision = "20260412_000008"
down_revision = "20260409_000007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "admin_accounts",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("username", sa.String(length=64), nullable=False),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
        sa.Column("updated_at", sa.BigInteger(), nullable=False),
        sa.Column("last_login_at", sa.BigInteger(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_admin_accounts_username", "admin_accounts", ["username"], unique=True)

    op.create_table(
        "admin_sessions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("admin_id", sa.String(length=36), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
        sa.Column("updated_at", sa.BigInteger(), nullable=False),
        sa.Column("expires_at", sa.BigInteger(), nullable=False),
        sa.Column("revoked_at", sa.BigInteger(), nullable=True),
        sa.ForeignKeyConstraint(["admin_id"], ["admin_accounts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index("ix_admin_sessions_admin_id_created_at", "admin_sessions", ["admin_id", "created_at"], unique=False)
    op.create_index("ix_admin_sessions_expires_at", "admin_sessions", ["expires_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_admin_sessions_expires_at", table_name="admin_sessions")
    op.drop_index("ix_admin_sessions_admin_id_created_at", table_name="admin_sessions")
    op.drop_table("admin_sessions")

    op.drop_index("ix_admin_accounts_username", table_name="admin_accounts")
    op.drop_table("admin_accounts")
