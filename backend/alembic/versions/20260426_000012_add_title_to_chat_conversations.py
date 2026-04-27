"""Add title to chat conversations."""

from alembic import op
import sqlalchemy as sa

revision = "20260426_000012"
down_revision = "20260425_000011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "chat_conversations",
        sa.Column("title", sa.String(length=120), nullable=False, server_default="New Chat"),
    )
    op.alter_column("chat_conversations", "title", server_default=None)


def downgrade() -> None:
    op.drop_column("chat_conversations", "title")
