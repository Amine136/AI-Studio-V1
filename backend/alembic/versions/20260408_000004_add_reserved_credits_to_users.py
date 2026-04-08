"""Add reserved credits to users for generation reservations."""

from alembic import op
import sqlalchemy as sa

revision = "20260408_000004"
down_revision = "20260408_000003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("reserved_credits_minor", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_check_constraint(
        "ck_users_reserved_credits_minor_nonnegative",
        "users",
        "reserved_credits_minor >= 0",
    )


def downgrade() -> None:
    op.drop_constraint("ck_users_reserved_credits_minor_nonnegative", "users", type_="check")
    op.drop_column("users", "reserved_credits_minor")
