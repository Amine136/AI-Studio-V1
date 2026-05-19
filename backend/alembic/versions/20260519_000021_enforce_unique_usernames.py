"""Enforce unique profile usernames."""

from alembic import op

revision = "20260519_000021"
down_revision = "20260508_000020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Normalize any legacy values before adding the unique index. Duplicate or
    # empty usernames receive a stable uid-derived suffix so the migration can
    # run safely on existing production data.
    op.execute(
        """
        UPDATE users
        SET username = LEFT(
            REGEXP_REPLACE(LOWER(TRIM(COALESCE(username, ''))), '[^a-z0-9._-]+', '', 'g'),
            15
        )
        """
    )
    op.execute(
        """
        UPDATE users
        SET username = 'vibecraft-' || SUBSTRING(MD5(uid) FROM 1 FOR 5)
        WHERE COALESCE(username, '') = ''
        """
    )
    op.execute(
        """
        WITH ranked AS (
            SELECT
                uid,
                username,
                ROW_NUMBER() OVER (PARTITION BY username ORDER BY created_at ASC, uid ASC) AS rn
            FROM users
        )
        UPDATE users AS u
        SET username = LEFT(r.username, 6) || '-' || SUBSTRING(MD5(u.uid) FROM 1 FOR 8)
        FROM ranked AS r
        WHERE u.uid = r.uid
          AND r.rn > 1
        """
    )
    op.create_index("ux_users_username", "users", ["username"], unique=True)


def downgrade() -> None:
    op.drop_index("ux_users_username", table_name="users")
