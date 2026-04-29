"""Create deactivated emails registry."""

from alembic import op
import sqlalchemy as sa

revision = "20260429_000016"
down_revision = "20260429_000015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "deactivated_emails",
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("original_uid", sa.String(length=128), nullable=True),
        sa.Column("deactivated_at", sa.BigInteger(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("email"),
    )
    op.create_index(
        "ix_deactivated_emails_deactivated_at",
        "deactivated_emails",
        ["deactivated_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_deactivated_emails_deactivated_at", table_name="deactivated_emails")
    op.drop_table("deactivated_emails")
