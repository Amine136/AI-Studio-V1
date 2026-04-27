"""Add persisted total cost to chat conversations."""

from alembic import op
import sqlalchemy as sa

revision = "20260425_000011"
down_revision = "20260419_000010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "chat_conversations",
        sa.Column("total_cost_minor", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_check_constraint(
        "ck_chat_conversations_total_cost_minor_nonnegative",
        "chat_conversations",
        "total_cost_minor >= 0",
    )
    op.alter_column("chat_conversations", "total_cost_minor", server_default=None)


def downgrade() -> None:
    op.drop_constraint("ck_chat_conversations_total_cost_minor_nonnegative", "chat_conversations", type_="check")
    op.drop_column("chat_conversations", "total_cost_minor")
