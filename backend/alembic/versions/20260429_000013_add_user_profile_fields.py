"""Add username and bio to users."""

from alembic import op
import sqlalchemy as sa

revision = "20260429_000013"
down_revision = "20260426_000012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("username", sa.String(length=15), nullable=False, server_default=""),
    )
    op.add_column(
        "users",
        sa.Column("bio", sa.Text(), nullable=False, server_default=""),
    )
    op.alter_column("users", "username", server_default=None)
    op.alter_column("users", "bio", server_default=None)


def downgrade() -> None:
    op.drop_column("users", "bio")
    op.drop_column("users", "username")
