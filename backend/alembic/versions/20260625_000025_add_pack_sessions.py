"""Add pack_sessions table (saved pack-studio sessions)."""

from alembic import op
import sqlalchemy as sa

revision = "20260625_000025"
down_revision = "20260616_000024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "pack_sessions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("uid", sa.String(length=128), nullable=False),
        sa.Column("pack_id", sa.String(length=80), nullable=False),
        sa.Column("variant_id", sa.String(length=80), nullable=True),
        sa.Column("title", sa.String(length=120), nullable=False, server_default="New session"),
        sa.Column("data", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
        sa.Column("updated_at", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(["uid"], ["users.uid"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_pack_sessions_uid_pack_updated", "pack_sessions", ["uid", "pack_id", "updated_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_pack_sessions_uid_pack_updated", table_name="pack_sessions")
    op.drop_table("pack_sessions")
