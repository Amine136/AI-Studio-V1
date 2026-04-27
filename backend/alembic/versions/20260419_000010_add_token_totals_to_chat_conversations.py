"""Add token totals to chat conversations."""

from alembic import op
import sqlalchemy as sa

revision = "20260419_000010"
down_revision = "20260419_000009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "chat_conversations",
        sa.Column("prompt_tokens_total", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "chat_conversations",
        sa.Column("completion_tokens_total", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_check_constraint(
        "ck_chat_conversations_prompt_tokens_total_nonnegative",
        "chat_conversations",
        "prompt_tokens_total >= 0",
    )
    op.create_check_constraint(
        "ck_chat_conversations_completion_tokens_total_nonnegative",
        "chat_conversations",
        "completion_tokens_total >= 0",
    )
    op.alter_column("chat_conversations", "prompt_tokens_total", server_default=None)
    op.alter_column("chat_conversations", "completion_tokens_total", server_default=None)


def downgrade() -> None:
    op.drop_constraint("ck_chat_conversations_completion_tokens_total_nonnegative", "chat_conversations", type_="check")
    op.drop_constraint("ck_chat_conversations_prompt_tokens_total_nonnegative", "chat_conversations", type_="check")
    op.drop_column("chat_conversations", "completion_tokens_total")
    op.drop_column("chat_conversations", "prompt_tokens_total")
