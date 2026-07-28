"""Add user_files.content_sha256 (spot a receipt that was already submitted).

Nullable with no backfill. The hash is only written for payment proofs, and only
from this migration forward: the bytes of older files are still on disk, but
hashing them here would mean opening the filesystem from a migration, and a NULL
reads correctly as "unknown" rather than as a false duplicate. Duplicate
detection deliberately ignores NULLs, so pre-existing proofs simply never flag.

The index is (kind, content_sha256) rather than the hash alone, and
`find_duplicate_proof_orders` constrains kind on BOTH sides of its self-join so
the leading column is usable — an index on (kind, ...) cannot serve a lookup that
only knows the hash.
"""

from alembic import op
import sqlalchemy as sa

revision = "20260728_000033"
down_revision = "20260728_000032"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("user_files", sa.Column("content_sha256", sa.String(length=64), nullable=True))
    op.create_index("ix_user_files_kind_content_sha256", "user_files", ["kind", "content_sha256"])


def downgrade() -> None:
    op.drop_index("ix_user_files_kind_content_sha256", table_name="user_files")
    op.drop_column("user_files", "content_sha256")
