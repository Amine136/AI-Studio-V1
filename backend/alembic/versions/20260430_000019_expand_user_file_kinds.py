"""Allow generated output files in user file metadata."""

from alembic import op

revision = "20260430_000019"
down_revision = "20260430_000018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE user_files DROP CONSTRAINT ck_user_files_kind_valid")
    op.execute(
        "ALTER TABLE user_files ADD CONSTRAINT ck_user_files_kind_valid "
        "CHECK (kind IN ('uploaded_input', 'generated_output'))"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE user_files DROP CONSTRAINT ck_user_files_kind_valid")
    op.execute(
        "ALTER TABLE user_files ADD CONSTRAINT ck_user_files_kind_valid "
        "CHECK (kind IN ('uploaded_input'))"
    )
