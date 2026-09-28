"""
Parser for the external ledger CSV format the business already has, e.g.:

    Referencia,Fecha,Descripcion,Debito,Credito
    2,14/05/2024,"Prestamo de $560 otorgado",560,
    2,31/05/2024,"Intereses acomulados en la cuenta",28,
    2,31/05/2024,"pago por $108 realizado",,108

Verified against a real 448-row sample (see docs/requirements/001-...):
- Each `Referencia` has exactly one disbursement row ("... otorgado").
- Every interest row ("Intereses ac[o|u]mulados...") shares its
  (Referencia, Fecha) with a payment row ("pago por $X realizado") —
  interest never appears alone. A payment *can* appear alone (off-cycle
  payment, no interest that day) — 14 of 241 groups in the sample do this.

Amounts in the interest rows are taken as historical fact, never
recalculated through `project_ledger` (ADR-004) — the account's *current*
rate may not be the rate that applied historically.

This parser cannot recover a loan's interest rate, the borrower's name, or
which LoanTrack user owns it — none of that is in the source file. Those
are left for the admin to fill in during the mapping step (`ParsedAccount`
comes back with `rate=None`); see `imports/service.py`.
"""

import csv
import io
import re
from collections import defaultdict
from datetime import datetime
from decimal import Decimal, InvalidOperation

from app.modules.imports.parsers.base import (
    ImportParser,
    ParseError,
    ParsedAccount,
    ParsedLedger,
    ParsedPayment,
)

EXPECTED_HEADER = ["referencia", "fecha", "descripcion", "debito", "credito"]

_DISBURSEMENT_RE = re.compile(r"prestamo.*otorgad", re.IGNORECASE)
_INTEREST_RE = re.compile(r"interes.*ac[oó]?u?mulad", re.IGNORECASE)
_PAYMENT_RE = re.compile(r"pago.*realizad", re.IGNORECASE)


def _strip_accents(s: str) -> str:
    return (
        s.lower()
        .replace("ó", "o").replace("í", "i").replace("á", "a")
        .replace("é", "e").replace("ú", "u")
    )


def _parse_date(raw: str) -> "datetime.date | None":
    for fmt in ("%d/%m/%Y", "%d-%m-%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(raw.strip(), fmt).date()
        except ValueError:
            continue
    return None


def _parse_amount(raw: str) -> Decimal | None:
    raw = (raw or "").strip().replace("$", "").replace(",", "")
    if not raw:
        return None
    try:
        return Decimal(raw)
    except InvalidOperation:
        return None


class LegacyLedgerCsvParser(ImportParser):
    format_name = "legacy_ledger_csv"

    @staticmethod
    def sniff(raw: bytes) -> bool:
        try:
            text = raw.decode("utf-8-sig")
        except UnicodeDecodeError:
            return False
        reader = csv.reader(io.StringIO(text))
        try:
            header = next(reader)
        except StopIteration:
            return False
        normalized = [_strip_accents(h.strip()) for h in header]
        return normalized == EXPECTED_HEADER

    @staticmethod
    def parse(raw: bytes) -> ParsedLedger:
        text = raw.decode("utf-8-sig")
        reader = csv.DictReader(io.StringIO(text))

        errors: list[ParseError] = []
        # (referencia, fecha) -> accumulated row info
        groups: dict[tuple[str, str], dict] = defaultdict(
            lambda: {"disbursement": None, "interest": None, "payment": None, "rows": []}
        )
        disbursements: dict[str, ParsedAccount] = {}

        for row_number, row in enumerate(reader, start=2):  # header is row 1
            ref = (row.get("Referencia") or "").strip()
            fecha_raw = (row.get("Fecha") or "").strip()
            desc = (row.get("Descripcion") or "").strip()
            debito = _parse_amount(row.get("Debito"))
            credito = _parse_amount(row.get("Credito"))

            if not ref:
                errors.append(ParseError(row_number, "Fila sin Referencia", dict(row)))
                continue
            fecha = _parse_date(fecha_raw)
            if fecha is None:
                errors.append(
                    ParseError(row_number, f"Fecha inválida: '{fecha_raw}'", dict(row))
                )
                continue

            key = (ref, fecha.isoformat())
            groups[key]["rows"].append(row_number)

            if _DISBURSEMENT_RE.search(desc):
                if debito is None:
                    errors.append(
                        ParseError(row_number, "Desembolso sin monto en Debito", dict(row))
                    )
                    continue
                if ref in disbursements:
                    errors.append(
                        ParseError(
                            row_number,
                            f"Referencia {ref} ya tiene un desembolso "
                            f"(fila {disbursements[ref].row_number}); se ignora este duplicado",
                            dict(row),
                        )
                    )
                    continue
                disbursements[ref] = ParsedAccount(
                    source_ref=ref,
                    suggested_account_name=f"Cuenta importada (ref. {ref})",
                    borrow_amount=debito,
                    start_date=fecha,
                    rate=None,
                    row_number=row_number,
                )
                groups[key]["disbursement"] = debito

            elif _INTEREST_RE.search(desc):
                if debito is None:
                    errors.append(
                        ParseError(row_number, "Interés sin monto en Debito", dict(row))
                    )
                    continue
                groups[key]["interest"] = debito

            elif _PAYMENT_RE.search(desc):
                if credito is None:
                    errors.append(
                        ParseError(row_number, "Pago sin monto en Credito", dict(row))
                    )
                    continue
                groups[key]["payment"] = credito

            else:
                errors.append(
                    ParseError(row_number, f"Descripción no reconocida: '{desc}'", dict(row))
                )

        payments: list[ParsedPayment] = []
        for (ref, fecha_iso), info in groups.items():
            if info["disbursement"] is not None:
                continue  # disbursement rows become the account, not a payment
            if info["payment"] is None:
                if info["interest"] is not None:
                    errors.append(
                        ParseError(
                            info["rows"][0] if info["rows"] else None,
                            f"Referencia {ref}, fecha {fecha_iso}: interés acumulado sin "
                            "pago asociado — caso no soportado, requiere revisión manual",
                            {"referencia": ref, "fecha": fecha_iso},
                        )
                    )
                continue
            payments.append(
                ParsedPayment(
                    source_ref=ref,
                    payment_date=datetime.strptime(fecha_iso, "%Y-%m-%d").date(),
                    amount=info["payment"],
                    interests_accrued=info["interest"] or Decimal("0"),
                    row_numbers=info["rows"],
                )
            )

        # Payments referencing a Referencia with no disbursement row are still
        # returned — the mapping step (service.py) lets the admin map them to
        # an *existing* account instead of "create new".
        payments.sort(key=lambda p: (p.source_ref, p.payment_date))

        return ParsedLedger(
            format_name=LegacyLedgerCsvParser.format_name,
            accounts=list(disbursements.values()),
            payments=payments,
            errors=errors,
        )
