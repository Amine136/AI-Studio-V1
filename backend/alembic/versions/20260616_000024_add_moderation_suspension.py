"""Add moderation suspension fields and moderation_rejections table."""

from alembic import op
import sqlalchemy as sa

revision = "20260616_000024"
down_revision = "20260614_000023"
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.add_column("users", sa.Column("suspended_until", sa.BigInteger(), nullable=True))
    op.add_column("users", sa.Column("moderation_ban_count", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("users", sa.Column("last_moderation_ban_at", sa.BigInteger(), nullable=True))
    
    op.create_table(
        "moderation_rejections",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("uid", sa.String(length=128), nullable=False),
        sa.Column("model", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("code", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(["uid"], ["users.uid"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_moderation_rejections_uid_created_at", "moderation_rejections", ["uid", "created_at"], unique=False)

def downgrade() -> None:
    op.drop_index("ix_moderation_rejections_uid_created_at", table_name="moderation_rejections")
    op.drop_table("moderation_rejections")
    
    op.drop_column("users", "last_moderation_ban_at")
    op.drop_column("users", "moderation_ban_count")
    op.drop_column("users", "suspended_until")
