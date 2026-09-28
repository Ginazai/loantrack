"""
Import orchestration (ADR-004): preview() parses and stores nothing but the
raw upload + row-level errors; commit() re-parses from that stored raw
upload (never trusting client-echoed parse results) and applies the
admin-confirmed mapping.

Deliberately excluded from this flow (see docs/requirements/001-...,
section 6): imported payments never fire `payment.added` or any other
webhook, and there is no "undo import" — a bad commit is fixed the same
way any other bad `LoanAccount`/`Payment` would be (edit/delete via the
normal endpoints), with `ImportRow`/`AuditLog` as the trail of what
actually happened.
"""

from collections import defaultdict
from datetime import datetime, timezone
from decimal import ROUND_HALF_UP, Decimal
from uuid import UUID

from fastapi import HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.repository import BaseRepository
from app.modules.accounts.interest_engine import get_next_due_date
from app.modules.accounts.models import LoanAccount
from app.modules.audit.service import AuditService
from app.modules.imports.models import ImportBatch, ImportRow
from app.modules.imports.parsers.base import ImportParser
from app.modules.imports.parsers.legacy_ledger_csv import LegacyLedgerCsvParser
from app.modules.imports.parsers.native_csv import NativeCsvParser
from app.modules.imports.schemas import (
    AccountMappingIn,
    ImportBatchOut,
    ImportCommitOut,
    ImportPreviewOut,
    ImportRowOut,
    ParseErrorOut,
    ParsedAccountOut,
)
from app.modules.payments.models import Payment
from app.modules.users.models import User

# Registry of known formats. Add a new format by adding a parser class here
# — nothing else in this file (or the router) needs to change.
PARSERS: list[type[ImportParser]] = [LegacyLedgerCsvParser, NativeCsvParser]


def _round2(v: Decimal) -> Decimal:
    return v.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


class ImportService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.audit = AuditService(db)

    def _sniff(self, raw: bytes) -> type[ImportParser]:
        for parser in PARSERS:
            if parser.sniff(raw):
                return parser
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Formato de archivo no reconocido. Formatos soportados: "
            + ", ".join(p.format_name for p in PARSERS),
        )

    def _parser_for_format(self, format_name: str) -> type[ImportParser]:
        for parser in PARSERS:
            if parser.format_name == format_name:
                return parser
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Unknown import format")

    async def preview(self, file: UploadFile, user_id: UUID) -> ImportPreviewOut:
        raw = await file.read()
        if not raw:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Archivo vacío")

        parser = self._sniff(raw)
        parsed = parser.parse(raw)

        batch = ImportBatch(
            source_filename=file.filename or "import.csv",
            format=parsed.format_name,
            raw_content=raw,
            status="previewed",
            created_by=user_id,
            summary={
                "accounts_found": len(parsed.accounts),
                "payments_found": len(parsed.payments),
                "errors_found": len(parsed.errors),
            },
        )
        self.db.add(batch)
        await self.db.flush()
        await self.db.refresh(batch)

        for err in parsed.errors:
            self.db.add(
                ImportRow(
                    batch_id=batch.id,
                    row_number=err.row_number,
                    interpretation="parse_error",
                    result="error",
                    error_message=err.message,
                )
            )
        await self.db.flush()

        payments_by_ref: dict[str, int] = defaultdict(int)
        for p in parsed.payments:
            payments_by_ref[p.source_ref] += 1

        account_refs = {a.source_ref for a in parsed.accounts}
        unmatched = sorted(set(payments_by_ref) - account_refs)

        account_repo = BaseRepository(LoanAccount, self.db)
        accounts_out: list[ParsedAccountOut] = []
        for a in parsed.accounts:
            suggestion = None
            if parsed.format_name == "native_csv":
                # For the native format, source_ref IS the real exported UUID —
                # if it still exists, that's a strong "this is the same account" signal.
                try:
                    existing = await account_repo.get_by_id(UUID(a.source_ref))
                    suggestion = existing.id if existing else None
                except ValueError:
                    suggestion = None
            accounts_out.append(
                ParsedAccountOut(
                    source_ref=a.source_ref,
                    suggested_account_name=a.suggested_account_name,
                    borrow_amount=a.borrow_amount,
                    start_date=a.start_date,
                    rate=a.rate,
                    borrower_name=a.borrower_name,
                    payment_count=payments_by_ref.get(a.source_ref, 0),
                    suggested_existing_account_id=suggestion,
                )
            )

        return ImportPreviewOut(
            batch_id=batch.id,
            format=parsed.format_name,
            accounts=accounts_out,
            unmatched_payment_refs=unmatched,
            total_payments_parsed=len(parsed.payments),
            error_count=len(parsed.errors),
            errors=[
                ParseErrorOut(row_number=e.row_number, message=e.message) for e in parsed.errors
            ],
        )

    async def get_batch(self, batch_id: UUID) -> ImportBatchOut:
        batch = await self.db.get(ImportBatch, batch_id)
        if not batch:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Import batch not found")
        return ImportBatchOut.model_validate(batch)

    async def list_batches(self) -> list[ImportBatchOut]:
        result = await self.db.execute(select(ImportBatch).order_by(ImportBatch.created_at.desc()))
        return [ImportBatchOut.model_validate(b) for b in result.scalars().all()]

    async def commit(
        self, batch_id: UUID, mappings: list[AccountMappingIn], user_id: UUID
    ) -> ImportCommitOut:
        batch = await self.db.get(ImportBatch, batch_id)
        if not batch:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Import batch not found")
        if batch.status == "committed":
            raise HTTPException(status.HTTP_409_CONFLICT, "This batch was already committed")

        # Re-parse from the stored raw upload — never trust client-echoed
        # parse results, only the mapping choices attached to each ref.
        parser = self._parser_for_format(batch.format)
        parsed = parser.parse(batch.raw_content)
        mapping_by_ref = {m.source_ref: m for m in mappings}

        account_repo = BaseRepository(LoanAccount, self.db)
        user_repo = BaseRepository(User, self.db)

        account_by_ref: dict[str, LoanAccount] = {}
        new_rows: list[ImportRow] = []
        accounts_created = accounts_matched = accounts_skipped = 0

        def _row(row_number, interpretation, result, error=None, account_id=None, payment_id=None):
            row = ImportRow(
                batch_id=batch.id,
                row_number=row_number,
                interpretation=interpretation,
                result=result,
                error_message=error,
                created_account_id=account_id,
                created_payment_id=payment_id,
            )
            new_rows.append(row)
            self.db.add(row)
            return row

        for parsed_account in parsed.accounts:
            mapping = mapping_by_ref.get(parsed_account.source_ref)
            if mapping is None:
                _row(parsed_account.row_number, "account", "error",
                     error=f"Referencia {parsed_account.source_ref} sin mapeo")
                continue

            if mapping.action == "skip":
                _row(parsed_account.row_number, "account", "skipped")
                accounts_skipped += 1
                continue

            if mapping.action == "existing":
                if not mapping.existing_account_id:
                    _row(parsed_account.row_number, "account", "error",
                         error="action=existing requiere existing_account_id")
                    continue
                existing = await account_repo.get_by_id(mapping.existing_account_id)
                if not existing:
                    _row(parsed_account.row_number, "account", "error",
                         error=f"Cuenta {mapping.existing_account_id} no encontrada")
                    continue
                account_by_ref[parsed_account.source_ref] = existing
                accounts_matched += 1
                _row(parsed_account.row_number, "account_matched", "ok", account_id=existing.id)
                continue

            # action == "create"
            if not mapping.linked_user_id:
                _row(parsed_account.row_number, "account", "error",
                     error="action=create requiere linked_user_id")
                continue
            owner = await user_repo.get_by_id(mapping.linked_user_id)
            if not owner:
                _row(parsed_account.row_number, "account", "error",
                     error=f"Usuario {mapping.linked_user_id} no encontrado")
                continue

            account = LoanAccount(
                user_id=owner.id,
                account_name=mapping.account_name or parsed_account.suggested_account_name,
                borrower_name=(
                    mapping.borrower_name or parsed_account.borrower_name or owner.full_name
                ),
                borrow_amount=parsed_account.borrow_amount,
                rate=(
                    mapping.rate if mapping.rate is not None
                    else (parsed_account.rate if parsed_account.rate is not None else Decimal("0"))
                ),
                cycle=15,
                status="open",
                start_date=parsed_account.start_date,
            )
            self.db.add(account)
            await self.db.flush()
            account_by_ref[parsed_account.source_ref] = account
            accounts_created += 1
            _row(parsed_account.row_number, "account_created", "ok", account_id=account.id)
            await self.audit.log(
                user_id, "loan_account", str(account.id), "create",
                after={"source": "import", "batch_id": str(batch.id)},
            )

        # ── Payments, grouped and replayed in date order per account ──────────
        payments_by_ref: dict[str, list] = defaultdict(list)
        for p in parsed.payments:
            payments_by_ref[p.source_ref].append(p)

        payments_created = payments_errored = 0
        for ref, plist in payments_by_ref.items():
            account = account_by_ref.get(ref)
            plist.sort(key=lambda p: p.payment_date)
            if account is None:
                for p in plist:
                    _row(p.row_numbers[0] if p.row_numbers else None, "payment", "error",
                         error=f"Referencia {ref} sin cuenta mapeada")
                    payments_errored += 1
                continue

            mapping = mapping_by_ref.get(ref)
            if mapping and mapping.action == "existing":
                existing_payments_result = await self.db.execute(
                    select(Payment).where(Payment.account_id == account.id)
                    .order_by(Payment.payment_date)
                )
                existing_payments = list(existing_payments_result.scalars().all())
                if existing_payments:
                    last_date = existing_payments[-1].payment_date
                    # `balance_after` is the immutable ledger snapshot (ADR-003) —
                    # reuse it directly rather than re-projecting through
                    # `project_ledger`, which defaults `until` to *today* and
                    # would double-count interest for a backfill of past dates.
                    running_balance = existing_payments[-1].balance_after
                else:
                    last_date = account.start_date
                    running_balance = Decimal(str(account.borrow_amount))
            else:
                last_date = account.start_date
                running_balance = Decimal(str(account.borrow_amount))

            for p in plist:
                if p.payment_date < last_date:
                    _row(p.row_numbers[0] if p.row_numbers else None, "payment", "error",
                         error=f"Fecha {p.payment_date} anterior al historial ya registrado "
                               f"({last_date}) — se omite, requiere revisión manual")
                    payments_errored += 1
                    continue
                balance_before = running_balance
                balance_after = _round2(balance_before + p.interests_accrued - p.amount)
                payment = Payment(
                    account_id=account.id,
                    amount=p.amount,
                    balance_before=balance_before,
                    interests_accrued=p.interests_accrued,
                    balance_after=balance_after,
                    payment_date=p.payment_date,
                    next_due_date=get_next_due_date(p.payment_date),
                    method="import",
                )
                self.db.add(payment)
                await self.db.flush()
                running_balance = balance_after
                last_date = p.payment_date
                payments_created += 1
                _row(p.row_numbers[0] if p.row_numbers else None, "payment_created", "ok",
                     account_id=account.id, payment_id=payment.id)

            if running_balance <= Decimal("0.00"):
                account.status = "paid"
            elif account.status == "open":
                account.status = "active"

        batch.status = "committed"
        batch.committed_at = datetime.now(timezone.utc)
        batch.summary = {
            **(batch.summary or {}),
            "accounts_created": accounts_created,
            "accounts_matched": accounts_matched,
            "accounts_skipped": accounts_skipped,
            "payments_created": payments_created,
            "payments_errored": payments_errored,
        }
        await self.db.flush()

        await self.audit.log(
            user_id, "import_batch", str(batch.id), "commit", after=batch.summary,
        )

        return ImportCommitOut(
            batch=ImportBatchOut.model_validate(batch),
            rows=[ImportRowOut.model_validate(r) for r in new_rows],
        )
