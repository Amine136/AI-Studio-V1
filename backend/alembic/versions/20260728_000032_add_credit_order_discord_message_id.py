"""Add credit_orders.discord_message_id (repaint the Discord card on resolve).

Nullable with no backfill: orders placed before the Discord integration were
never announced, so there is no card to point at. A null here means "not on
Discord", which is also the normal state whenever the bot is unconfigured or a
post failed — the integration is fail-open.
"""

from alembic import op
import sqlalchemy as sa

revision = "20260728_000032"
down_revision = "20260727_000031"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("credit_orders", sa.Column("discord_message_id", sa.String(length=32), nullable=True))


def downgrade() -> None:
    op.drop_column("credit_orders", "discord_message_id")
