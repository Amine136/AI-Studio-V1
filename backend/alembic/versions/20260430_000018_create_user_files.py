"""Create user file metadata table."""

from alembic import op
import sqlalchemy as sa

revision = "20260430_000018"
down_revision = "20260429_000017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_files",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("owner_uid", sa.String(length=128), nullable=False),
        sa.Column("storage_path", sa.Text(), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("mime_type", sa.String(length=128), nullable=False),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
        sa.CheckConstraint("kind IN ('uploaded_input')", name="ck_user_files_kind_valid"),
        sa.ForeignKeyConstraint(["owner_uid"], ["users.uid"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_user_files_owner_uid_created_at", "user_files", ["owner_uid", "created_at"], unique=False)
    op.create_index("ix_user_files_storage_path", "user_files", ["storage_path"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_user_files_storage_path", table_name="user_files")
    op.drop_index("ix_user_files_owner_uid_created_at", table_name="user_files")
    op.drop_table("user_files")
