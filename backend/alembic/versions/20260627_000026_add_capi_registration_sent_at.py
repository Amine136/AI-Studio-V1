"""Add users.capi_registration_sent_at (one-shot server-side CompleteRegistration claim)."""

from alembic import op
import sqlalchemy as sa

revision = "20260627_000026"
down_revision = "20260616_000024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("capi_registration_sent_at", sa.BigInteger(), nullable=True))
    # Backfill existing users as "already sent" so CAPI never fires retroactively
    # for accounts created before this column existed. Only users created AFTER
    # this migration start NULL and thus fire exactly once on first auth.
    op.execute("UPDATE users SET capi_registration_sent_at = created_at WHERE capi_registration_sent_at IS NULL")


def downgrade() -> None:
    op.drop_column("users", "capi_registration_sent_at")
