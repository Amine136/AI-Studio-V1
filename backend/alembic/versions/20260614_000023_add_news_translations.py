"""Add optional FR/AR translation columns to dashboard_news."""

from alembic import op
import sqlalchemy as sa

revision = "20260614_000023"
down_revision = "20260606_000022"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("dashboard_news", sa.Column("title_fr", sa.String(length=160), nullable=False, server_default=""))
    op.add_column("dashboard_news", sa.Column("title_ar", sa.String(length=160), nullable=False, server_default=""))
    op.add_column("dashboard_news", sa.Column("description_fr", sa.Text(), nullable=False, server_default=""))
    op.add_column("dashboard_news", sa.Column("description_ar", sa.Text(), nullable=False, server_default=""))
    op.add_column("dashboard_news", sa.Column("link_label_fr", sa.String(length=80), nullable=False, server_default=""))
    op.add_column("dashboard_news", sa.Column("link_label_ar", sa.String(length=80), nullable=False, server_default=""))


def downgrade() -> None:
    op.drop_column("dashboard_news", "link_label_ar")
    op.drop_column("dashboard_news", "link_label_fr")
    op.drop_column("dashboard_news", "description_ar")
    op.drop_column("dashboard_news", "description_fr")
    op.drop_column("dashboard_news", "title_ar")
    op.drop_column("dashboard_news", "title_fr")
