"""Add user preference columns: preferred_language + preferences_prompted_at.

`preferred_language` (en/fr/ar, NULL = never chose) lets server-side email sends
localize later; email fallback is "en". `preferences_prompted_at` records when the
one-time first-run preferences card was answered (Save or Skip): NULL means the
card has never been shown, so it appears exactly once. Existing rows are backfilled
to the migration time so ONLY brand-new accounts see the card.
"""

from alembic import op
import sqlalchemy as sa

revision = "20260720_000029"
down_revision = "20260719_000028"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("preferred_language", sa.String(length=2), nullable=True))
    op.add_column("users", sa.Column("preferences_prompted_at", sa.BigInteger(), nullable=True))
    # Backfill: mark every existing account as already-prompted, so the first-run
    # card only ever appears for accounts created after this migration.
    op.execute(
        "UPDATE users SET preferences_prompted_at = EXTRACT(EPOCH FROM now())::bigint "
        "WHERE preferences_prompted_at IS NULL"
    )


def downgrade() -> None:
    op.drop_column("users", "preferences_prompted_at")
    op.drop_column("users", "preferred_language")
