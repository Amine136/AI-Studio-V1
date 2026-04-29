"""Add user notification preference fields."""

from alembic import op
import sqlalchemy as sa

revision = "20260429_000014"
down_revision = "20260429_000013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("email_general_news_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.add_column(
        "users",
        sa.Column("email_platform_updates_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.alter_column("users", "email_general_news_enabled", server_default=None)
    op.alter_column("users", "email_platform_updates_enabled", server_default=None)


def downgrade() -> None:
    op.drop_column("users", "email_platform_updates_enabled")
    op.drop_column("users", "email_general_news_enabled")
