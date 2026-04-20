"""Create plain chat conversation and message tables."""

from alembic import op
import sqlalchemy as sa

revision = "20260419_000009"
down_revision = "20260412_000008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "chat_conversations",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("uid", sa.String(length=128), nullable=False),
        sa.Column("model", sa.String(length=255), nullable=False),
        sa.Column("system", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
        sa.Column("updated_at", sa.BigInteger(), nullable=False),
        sa.Column("last_message_at", sa.BigInteger(), nullable=True),
        sa.ForeignKeyConstraint(["uid"], ["users.uid"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_chat_conversations_uid_updated_at",
        "chat_conversations",
        ["uid", "updated_at"],
        unique=False,
    )
    op.create_index(
        "ix_chat_conversations_uid_last_message_at",
        "chat_conversations",
        ["uid", "last_message_at"],
        unique=False,
    )

    op.create_table(
        "chat_messages",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("conversation_id", sa.String(length=36), nullable=False),
        sa.Column("uid", sa.String(length=128), nullable=False),
        sa.Column("role", sa.String(length=32), nullable=False),
        sa.Column("parts", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
        sa.CheckConstraint("role IN ('user', 'assistant')", name="ck_chat_messages_role_valid"),
        sa.ForeignKeyConstraint(["conversation_id"], ["chat_conversations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["uid"], ["users.uid"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_chat_messages_conversation_id_created_at",
        "chat_messages",
        ["conversation_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_chat_messages_uid_created_at",
        "chat_messages",
        ["uid", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_chat_messages_uid_created_at", table_name="chat_messages")
    op.drop_index("ix_chat_messages_conversation_id_created_at", table_name="chat_messages")
    op.drop_table("chat_messages")

    op.drop_index("ix_chat_conversations_uid_last_message_at", table_name="chat_conversations")
    op.drop_index("ix_chat_conversations_uid_updated_at", table_name="chat_conversations")
    op.drop_table("chat_conversations")
