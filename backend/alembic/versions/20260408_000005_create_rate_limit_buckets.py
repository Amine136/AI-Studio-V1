"""Create PostgreSQL rate limit buckets."""

from alembic import op
import sqlalchemy as sa

revision = "20260408_000005"
down_revision = "20260408_000004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "rate_limit_buckets",
        sa.Column("key_hash", sa.String(length=64), nullable=False),
        sa.Column("key_plaintext", sa.Text(), nullable=False),
        sa.Column("count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("reset_at", sa.BigInteger(), nullable=False),
        sa.Column("updated_at", sa.BigInteger(), nullable=False),
        sa.CheckConstraint("count >= 0", name="ck_rate_limit_buckets_count_nonnegative"),
        sa.PrimaryKeyConstraint("key_hash"),
    )
    op.create_index("ix_rate_limit_buckets_reset_at", "rate_limit_buckets", ["reset_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_rate_limit_buckets_reset_at", table_name="rate_limit_buckets")
    op.drop_table("rate_limit_buckets")
