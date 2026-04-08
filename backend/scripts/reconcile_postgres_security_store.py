from __future__ import annotations

import argparse
import sys
from collections import defaultdict
from pathlib import Path

from sqlalchemy import func, select

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.db.models import CreditCode, CreditCodeClaim, CreditLedgerEntry, GenerationJob, RateLimitBucket, User
from app.db.session import session_scope


def build_report() -> dict[str, object]:
    report: dict[str, object] = {}
    with session_scope() as session:
        counts = {
            "users": session.scalar(select(func.count()).select_from(User)) or 0,
            "credit_codes": session.scalar(select(func.count()).select_from(CreditCode)) or 0,
            "claims": session.scalar(select(func.count()).select_from(CreditCodeClaim)) or 0,
            "ledger": session.scalar(select(func.count()).select_from(CreditLedgerEntry)) or 0,
            "generation_jobs": session.scalar(select(func.count()).select_from(GenerationJob)) or 0,
            "rate_limit_buckets": session.scalar(select(func.count()).select_from(RateLimitBucket)) or 0,
        }
        report["counts"] = counts

        ledger_sums = {
            uid: int(total or 0)
            for uid, total in session.execute(
                select(CreditLedgerEntry.uid, func.coalesce(func.sum(CreditLedgerEntry.delta_minor), 0)).group_by(CreditLedgerEntry.uid)
            ).all()
        }
        user_credit_rows = session.execute(
            select(User.uid, User.credits_minor, User.reserved_credits_minor)
        ).all()

        balance_mismatches: list[dict[str, int | str]] = []
        reserved_negative: list[dict[str, int | str]] = []
        for uid, credits_minor, reserved_minor in user_credit_rows:
            ledger_total = ledger_sums.get(uid, 0)
            if ledger_total != int(credits_minor):
                balance_mismatches.append(
                    {
                        "uid": uid,
                        "ledger_total": ledger_total,
                        "credits_minor": int(credits_minor),
                    }
                )
            if int(reserved_minor) < 0:
                reserved_negative.append({"uid": uid, "reserved_credits_minor": int(reserved_minor)})

        claim_rows = session.execute(
            select(CreditCodeClaim.code_hash, func.count()).group_by(CreditCodeClaim.code_hash)
        ).all()
        actual_claim_counts = defaultdict(int, {code_hash: int(count) for code_hash, count in claim_rows})
        claim_mismatches: list[dict[str, int | str]] = []
        for code_hash, claimed_count in session.execute(select(CreditCode.code_hash, CreditCode.claimed_count)).all():
            actual = actual_claim_counts.get(code_hash, 0)
            if actual != int(claimed_count):
                claim_mismatches.append(
                    {
                        "code_hash": code_hash,
                        "claimed_count": int(claimed_count),
                        "actual_claim_rows": actual,
                    }
                )

        reserved_job_mismatches: list[dict[str, int | str]] = []
        for uid, reserved_minor in session.execute(select(User.uid, User.reserved_credits_minor)).all():
            open_reserved = session.scalar(
                select(func.coalesce(func.sum(GenerationJob.reserved_minor), 0)).where(
                    GenerationJob.uid == uid,
                    GenerationJob.status.in_(("processing", "awaiting_review")),
                )
            ) or 0
            if int(open_reserved) != int(reserved_minor):
                reserved_job_mismatches.append(
                    {
                        "uid": uid,
                        "reserved_credits_minor": int(reserved_minor),
                        "open_job_reserved_minor": int(open_reserved),
                    }
                )

        report["balance_mismatches"] = balance_mismatches
        report["reserved_negative"] = reserved_negative
        report["claim_mismatches"] = claim_mismatches
        report["reserved_job_mismatches"] = reserved_job_mismatches
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description="Reconcile PostgreSQL-backed security store integrity.")
    parser.add_argument("--strict", action="store_true", help="Exit with status 1 if any mismatch is found.")
    args = parser.parse_args()

    report = build_report()
    counts = report["counts"]
    print("Counts")
    for key, value in counts.items():
        print(f"  {key}: {value}")

    for section in ("balance_mismatches", "reserved_negative", "claim_mismatches", "reserved_job_mismatches"):
        rows = report[section]
        print(f"{section}: {len(rows)}")
        for item in rows[:20]:
            print(f"  - {item}")

    has_issues = any(bool(report[section]) for section in ("balance_mismatches", "reserved_negative", "claim_mismatches", "reserved_job_mismatches"))
    if args.strict and has_issues:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
