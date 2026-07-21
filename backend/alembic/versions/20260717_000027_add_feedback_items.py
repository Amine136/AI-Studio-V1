"""Add feedback_items (in-app platform feedback: sidebar/settings modal -> admin inbox)."""

from alembic import op
import sqlalchemy as sa

revision = "20260717_000027"
down_revision = "20260627_000026"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "feedback_items",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("uid", sa.String(length=128), sa.ForeignKey("users.uid", ondelete="SET NULL"), nullable=True),
        sa.Column("email", sa.String(length=320), nullable=False, server_default=""),
        sa.Column("category", sa.String(length=24), nullable=False, server_default="other"),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("route", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("language", sa.String(length=8), nullable=False, server_default=""),
        sa.Column("user_agent", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="new"),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
        sa.Column("updated_at", sa.BigInteger(), nullable=False),
    )
    op.create_index("ix_feedback_items_status_created_at", "feedback_items", ["status", "created_at"])
    op.create_index("ix_feedback_items_uid_created_at", "feedback_items", ["uid", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_feedback_items_uid_created_at", table_name="feedback_items")
    op.drop_index("ix_feedback_items_status_created_at", table_name="feedback_items")
    op.drop_table("feedback_items")
