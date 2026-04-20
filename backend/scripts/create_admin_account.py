from __future__ import annotations

import argparse
import getpass
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.services.admin_auth import create_admin_account, deactivate_admin_account, reset_admin_password


def main() -> None:
    parser = argparse.ArgumentParser(description="Manage Vibecraft admin accounts.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    create_parser = subparsers.add_parser("create", help="Create a new admin account")
    create_parser.add_argument("username", help="Admin username")
    create_parser.add_argument("--password", help="Admin password. If omitted, you will be prompted securely.")

    reset_parser = subparsers.add_parser("reset-password", help="Rotate the password for an existing admin account")
    reset_parser.add_argument("username", help="Admin username")
    reset_parser.add_argument("--password", help="New admin password. If omitted, you will be prompted securely.")

    deactivate_parser = subparsers.add_parser("deactivate", help="Deactivate an admin account and revoke its sessions")
    deactivate_parser.add_argument("username", help="Admin username")
    deactivate_parser.add_argument(
        "--reason",
        default="Admin account deactivated via the admin CLI.",
        help="Audit-log reason for the deactivation.",
    )

    args = parser.parse_args()

    if args.command == "create":
        password = args.password or getpass.getpass("Admin password: ")
        account = create_admin_account(args.username, password)
        print(f"Admin account created: {account['username']}")
        return

    if args.command == "reset-password":
        password = args.password or getpass.getpass("New admin password: ")
        account = reset_admin_password(args.username, password)
        print(f"Admin password rotated: {account['username']}")
        return

    if args.command == "deactivate":
        account = deactivate_admin_account(args.username, reason=args.reason)
        print(f"Admin account deactivated: {account['username']}")
        return

    raise SystemExit("Unknown command")


if __name__ == "__main__":
    main()
