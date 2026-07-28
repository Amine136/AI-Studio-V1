"""Add credit_orders.seen_at (resolved orders leave the "Your orders" card once seen).

Backfilled to NULL, so any order already resolved before this migration still
gets its one showing rather than being silently skipped.
"""

from alembic import op
import sqlalchemy as sa

revision = "20260727_000031"
down_revision = "20260726_000030"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("credit_orders", sa.Column("seen_at", sa.BigInteger(), nullable=True))


def downgrade() -> None:
    op.drop_column("credit_orders", "seen_at")
