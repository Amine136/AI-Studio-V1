"""Add users.credit_debt_minor — the balance owed after a reversal.

Before this, a refund or chargeback that could not be fully clawed back (because
the credits had already been spent) recorded the shortfall as
`dodo_card_reversals.written_off_minor` and stopped there: a pure loss. Nothing
carried it forward, so buy -> consume -> refund could be repeated indefinitely,
each cycle costing the platform the consumed portion.

The shortfall now becomes a debt the account carries. It never blocks spending
of credits the user legitimately still holds; it is settled off the top of the
next purchase or redeemed code, so a repeat of the cycle is no longer free.

Deliberately a separate counter rather than allowing `users.credits_minor` to go
negative: every spend, reserve and sweep path assumes a non-negative balance,
and `ck_users_credits_minor_nonnegative` stays exactly as it was.
"""

from alembic import op
import sqlalchemy as sa

revision = "20260803_000037"
down_revision = "20260731_000036"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("credit_debt_minor", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_check_constraint(
        "ck_users_credit_debt_minor_nonnegative",
        "users",
        "credit_debt_minor >= 0",
    )
    # Backfill from reversals already recorded: those write-offs are exactly the
    # debt this column exists to carry, and leaving them at zero would grandfather
    # in every account that has already been through the loop.
    op.execute(
        """
        UPDATE users AS u
        SET credit_debt_minor = COALESCE(r.total, 0)
        FROM (
            SELECT uid, SUM(written_off_minor) AS total
            FROM dodo_card_reversals
            GROUP BY uid
        ) AS r
        WHERE r.uid = u.uid
          AND r.total > 0
        """
    )


def downgrade() -> None:
    op.drop_constraint("ck_users_credit_debt_minor_nonnegative", "users", type_="check")
    op.drop_column("users", "credit_debt_minor")
