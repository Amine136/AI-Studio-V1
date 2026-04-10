"""Add credit code batch grouping fields."""

from alembic import op
import sqlalchemy as sa

revision = "20260409_000007"
down_revision = "20260409_000006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("credit_codes", sa.Column("batch_id", sa.String(length=36), nullable=True))
    op.add_column("credit_codes", sa.Column("batch_title", sa.String(length=255), nullable=True))
    op.create_index("ix_credit_codes_batch_id_created_at", "credit_codes", ["batch_id", "created_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_credit_codes_batch_id_created_at", table_name="credit_codes")
    op.drop_column("credit_codes", "batch_title")
    op.drop_column("credit_codes", "batch_id")
