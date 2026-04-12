from __future__ import annotations

import argparse
import getpass
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.services.admin_auth import create_or_update_admin_account


def main() -> None:
    parser = argparse.ArgumentParser(description="Create or update a Vibecraft admin account.")
    parser.add_argument("username", help="Admin username")
    parser.add_argument("--password", help="Admin password. If omitted, you will be prompted securely.")
    args = parser.parse_args()

    password = args.password or getpass.getpass("Admin password: ")
    account = create_or_update_admin_account(args.username, password)
    print(f"Admin account ready: {account['username']}")


if __name__ == "__main__":
    main()
