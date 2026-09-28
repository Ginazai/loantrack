"""Unit tests — legacy ledger CSV parser (no DB).

Fixture data mirrors the shape verified against the real 448-row sample
file (see docs/requirements/001-...): one disbursement per Referencia,
interest always paired with a payment on the same date, and payments that
occur with no interest (off-cycle).
"""
from datetime import date
from decimal import Decimal

from app.modules.imports.parsers.legacy_ledger_csv import LegacyLedgerCsvParser

HEADER = "Referencia,Fecha,Descripcion,Debito,Credito\n"


def _csv(*rows: str) -> bytes:
    return (HEADER + "\n".join(rows) + "\n").encode("utf-8")


class TestSniff:
    def test_recognizes_exact_header(self):
        assert LegacyLedgerCsvParser.sniff(_csv())

    def test_recognizes_accented_header(self):
        raw = "Referencia,Fecha,Descripción,Debito,Credito\n".encode("utf-8")
        assert LegacyLedgerCsvParser.sniff(raw)

    def test_rejects_native_header(self):
        raw = b"id,account_name,borrower_name,borrow_amount,rate\n"
        assert not LegacyLedgerCsvParser.sniff(raw)

    def test_rejects_empty_file(self):
        assert not LegacyLedgerCsvParser.sniff(b"")


class TestParseDisbursement:
    def test_single_disbursement_becomes_an_account(self):
        raw = _csv('1,15/05/2024,"Prestamo de $5000 otorgado",5000,')
        parsed = LegacyLedgerCsvParser.parse(raw)
        assert len(parsed.accounts) == 1
        acc = parsed.accounts[0]
        assert acc.source_ref == "1"
        assert acc.borrow_amount == Decimal("5000")
        assert acc.start_date == date(2024, 5, 15)
        assert acc.rate is None  # not derivable from this format

    def test_duplicate_disbursement_for_same_ref_is_an_error(self):
        raw = _csv(
            '1,15/05/2024,"Prestamo de $5000 otorgado",5000,',
            '1,20/05/2024,"Prestamo de $1000 otorgado",1000,',
        )
        parsed = LegacyLedgerCsvParser.parse(raw)
        assert len(parsed.accounts) == 1  # first one wins
        assert any("ya tiene un desembolso" in e.message for e in parsed.errors)


class TestParseInterestAndPayment:
    def test_interest_and_payment_same_day_becomes_one_payment(self):
        raw = _csv(
            '2,14/05/2024,"Prestamo de $560 otorgado",560,',
            '2,31/05/2024,"Intereses acomulados en la cuenta",28,',
            '2,31/05/2024,"pago por $108 realizado",,108',
        )
        parsed = LegacyLedgerCsvParser.parse(raw)
        assert len(parsed.payments) == 1
        p = parsed.payments[0]
        assert p.source_ref == "2"
        assert p.payment_date == date(2024, 5, 31)
        assert p.amount == Decimal("108")
        assert p.interests_accrued == Decimal("28")
        assert parsed.errors == []

    def test_payment_without_interest_is_off_cycle_not_an_error(self):
        """Verified against the real sample: 14/241 groups are exactly this."""
        raw = _csv(
            '3,01/06/2024,"Prestamo de $200 otorgado",200,',
            '3,10/06/2024,"pago por $50 realizado",,50',
        )
        parsed = LegacyLedgerCsvParser.parse(raw)
        assert len(parsed.payments) == 1
        assert parsed.payments[0].interests_accrued == Decimal("0")
        assert parsed.errors == []

    def test_interest_without_payment_is_flagged_not_silently_dropped(self):
        """Never observed in the real sample, but must not corrupt the
        ledger if it ever occurs — Payment.amount must be > 0."""
        raw = _csv(
            '4,01/06/2024,"Prestamo de $200 otorgado",200,',
            '4,15/06/2024,"Intereses acomulados en la cuenta",10,',
        )
        parsed = LegacyLedgerCsvParser.parse(raw)
        assert parsed.payments == []
        assert any("sin pago asociado" in e.message for e in parsed.errors)

    def test_unrecognized_description_is_an_error_row(self):
        raw = _csv('5,01/06/2024,"Ajuste manual de saldo",15,')
        parsed = LegacyLedgerCsvParser.parse(raw)
        assert any("no reconocida" in e.message for e in parsed.errors)

    def test_invalid_date_is_an_error_row_not_a_crash(self):
        raw = _csv('6,not-a-date,"Prestamo de $100 otorgado",100,')
        parsed = LegacyLedgerCsvParser.parse(raw)
        assert parsed.accounts == []
        assert any("Fecha inválida" in e.message for e in parsed.errors)

    def test_one_bad_row_does_not_block_the_rest_of_the_batch(self):
        """R1.5: a bad row is reported, valid rows still parse."""
        raw = _csv(
            '7,01/06/2024,"Prestamo de $100 otorgado",100,',
            '7,bad-date,"pago por $10 realizado",,10',
            '7,15/06/2024,"Intereses acomulados en la cuenta",5,',
            '7,15/06/2024,"pago por $20 realizado",,20',
        )
        parsed = LegacyLedgerCsvParser.parse(raw)
        assert len(parsed.accounts) == 1
        assert len(parsed.payments) == 1
        assert parsed.payments[0].amount == Decimal("20")
        assert len(parsed.errors) == 1


class TestFullSampleShape:
    def test_realistic_multi_reference_file(self):
        raw = _csv(
            '1,15/05/2024,"Prestamo de $5000 otorgado",5000,',
            '2,14/05/2024,"Prestamo de $560 otorgado",560,',
            '2,31/05/2024,"Intereses acomulados en la cuenta",28,',
            '2,31/05/2024,"pago por $108 realizado",,108',
            '2,15/06/2024,"pago por $50 realizado",,50',  # off-cycle, no interest
        )
        parsed = LegacyLedgerCsvParser.parse(raw)
        assert len(parsed.accounts) == 2
        assert len(parsed.payments) == 2
        assert parsed.errors == []
