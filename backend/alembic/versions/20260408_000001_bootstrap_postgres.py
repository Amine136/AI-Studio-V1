"""Bootstrap PostgreSQL migration infrastructure."""

from alembic import op

revision = "20260408_000001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Intentionally empty. This establishes Alembic history before domain tables land.
    pass


def downgrade() -> None:
    pass
