"""Add user deactivation fields."""

from alembic import op
import sqlalchemy as sa

revision = "20260429_000015"
down_revision = "20260429_000014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("is_deactivated", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "users",
        sa.Column("deactivated_at", sa.BigInteger(), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column("deactivation_reason", sa.Text(), nullable=True),
    )
    op.alter_column("users", "is_deactivated", server_default=None)


def downgrade() -> None:
    op.drop_column("users", "deactivation_reason")
    op.drop_column("users", "deactivated_at")
    op.drop_column("users", "is_deactivated")
