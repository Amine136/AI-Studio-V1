"""create dashboard news

Revision ID: 20260429_000017
Revises: 20260429_000016
Create Date: 2026-04-29 23:30:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "20260429_000017"
down_revision = "20260429_000016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "dashboard_news",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("badge", sa.String(length=80), nullable=False),
        sa.Column("when_label", sa.String(length=80), nullable=False),
        sa.Column("title", sa.String(length=160), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("link_label", sa.String(length=80), nullable=False),
        sa.Column("link_href", sa.String(length=255), nullable=False),
        sa.Column("tone", sa.String(length=24), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
        sa.Column("updated_at", sa.BigInteger(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_dashboard_news_active_sort_order", "dashboard_news", ["is_active", "sort_order"], unique=False)
    op.create_index("ix_dashboard_news_updated_at", "dashboard_news", ["updated_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_dashboard_news_updated_at", table_name="dashboard_news")
    op.drop_index("ix_dashboard_news_active_sort_order", table_name="dashboard_news")
    op.drop_table("dashboard_news")
