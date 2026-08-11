"""Add credit_orders.fb_pixel_fbp / fb_pixel_fbc (Meta Purchase attribution).

The Tunisian rail is confirmed by an admin hours or days after the buyer paid, so
the server-side Purchase event is built with no browser in the request. These hold
the buyer's Meta Pixel cookies as captured when they placed the order, which is
what lets Meta tie the sale back to the ad click that caused it.

Nullable with no backfill, and null stays a normal state afterwards: a buyer who
arrived without an ad click, or with the Pixel blocked, simply has none. Orders
placed before this migration keep sending an unattributed Purchase rather than
none at all.
"""

from alembic import op
import sqlalchemy as sa

revision = "20260731_000036"
down_revision = "20260730_000035"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("credit_orders", sa.Column("fb_pixel_fbp", sa.String(length=128), nullable=True))
    op.add_column("credit_orders", sa.Column("fb_pixel_fbc", sa.String(length=255), nullable=True))


def downgrade() -> None:
    op.drop_column("credit_orders", "fb_pixel_fbc")
    op.drop_column("credit_orders", "fb_pixel_fbp")
