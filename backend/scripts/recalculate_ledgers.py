"""
Re-derive the stored ledger snapshot of existing payments.

A payment's balance_before / interests_accrued / balance_after / next_due_date are written once,
when the payment is created (ADR-003), so a fix to the ledger rules never reaches rows written
before it. This replays each account's history with PaymentService.recalculate_ledger, the same
routine a payment deletion already runs, and reports what changed.

    python -m scripts.recalculate_ledgers                    # DRY RUN: show what would change
    python -m scripts.recalculate_ledgers --apply            # write the changes
    python -m scripts.recalculate_ledgers --account <uuid>   # one account (add --apply to write)

Under docker compose:
    docker compose exec backend python -m scripts.recalculate_ledgers

Review the dry run first: every account with payments is replayed, and the report lists every
value that differs from what is stored.
"""

import argparse
import asyncio
from uuid import UUID

from sqlalchemy import exists, select
from sqlalchemy.ext.asyncio import AsyncSession

_PAYMENT_FIELDS = ("balance_before", "interests_accrued", "balance_after", "next_due_date")


async def recalculate_accounts(
    db: AsyncSession, account_ids: list[UUID] | None = None
) -> list[str]:
    """Recalculate accounts that have payments; return one line per value that changed.

    Leaves the transaction to the caller, so the same call serves a dry run (roll back) and a
    real one (commit).
    """
    # Registers every ORM model so cross-module relationships resolve.
    import app.core.models_registry  # noqa: F401
    from app.modules.accounts.models import LoanAccount
    from app.modules.payments.models import Payment
    from app.modules.payments.service import PaymentService

    query = select(LoanAccount).where(exists().where(Payment.account_id == LoanAccount.id))
    if account_ids:
        query = query.where(LoanAccount.id.in_(account_ids))
    accounts = (await db.execute(query.order_by(LoanAccount.account_name))).scalars().all()

    lines: list[str] = []
    for account in accounts:
        payments = (
            (
                await db.execute(
                    select(Payment)
                    .where(Payment.account_id == account.id)
                    .order_by(Payment.payment_date)
                )
            )
            .scalars()
            .all()
        )
        before_status = account.status
        before = {p.id: {f: getattr(p, f) for f in _PAYMENT_FIELDS} for p in payments}

        await PaymentService(db).recalculate_ledger(account.id)

        for p in payments:
            for field in _PAYMENT_FIELDS:
                old, new = before[p.id][field], getattr(p, field)
                if old != new:
                    lines.append(
                        f"{account.account_name} [{account.id}] {p.payment_date} "
                        f"({p.method}) {field}: {old} -> {new}"
                    )
        if account.status != before_status:
            lines.append(
                f"{account.account_name} [{account.id}] status: {before_status} -> {account.status}"
            )
    return lines


async def main(apply: bool, account: UUID | None) -> None:
    from app.core.database import AsyncSessionLocal

    async with AsyncSessionLocal() as db:
        lines = await recalculate_accounts(db, [account] if account else None)
        for line in lines:
            print(line)
        if not lines:
            print("Nothing to change: every stored snapshot already matches the ledger rules.")
        elif apply:
            await db.commit()
            print(f"\nApplied {len(lines)} change(s).")
        else:
            await db.rollback()
            print(f"\nDRY RUN: {len(lines)} change(s) would be made. Re-run with --apply to write.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--apply", action="store_true", help="write the changes (default: dry run)")
    parser.add_argument("--account", type=UUID, help="only this account id")
    args = parser.parse_args()
    asyncio.run(main(args.apply, args.account))
