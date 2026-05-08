"""Add precise raw cost accumulation for chat conversations."""

from alembic import op
import sqlalchemy as sa

revision = "20260508_000020"
down_revision = "20260430_000019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "chat_conversations",
        sa.Column("total_cost_micro", sa.BigInteger(), nullable=False, server_default="0"),
    )
    op.create_check_constraint(
        "ck_chat_conversations_total_cost_micro_nonnegative",
        "chat_conversations",
        "total_cost_micro >= 0",
    )
    op.execute("UPDATE chat_conversations SET total_cost_micro = total_cost_minor * 10000")
    op.alter_column("chat_conversations", "total_cost_micro", server_default=None)


def downgrade() -> None:
    op.drop_constraint("ck_chat_conversations_total_cost_micro_nonnegative", "chat_conversations", type_="check")
    op.drop_column("chat_conversations", "total_cost_micro")
