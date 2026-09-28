"""Unit tests — cycle-close detection logic (ADR-006), no DB."""
from datetime import date

from app.modules.webhooks.service import new_cycle_dates


class TestNewCycleDates:
    def test_no_cycles_yet(self):
        # start_date is June 1st, "today" is June 10 — no cycle date has passed
        assert new_cycle_dates(date(2026, 6, 1), set(), date(2026, 6, 10)) == []

    def test_first_cycle_detected(self):
        assert new_cycle_dates(date(2026, 6, 1), set(), date(2026, 6, 15)) == [
            date(2026, 6, 15)
        ]

    def test_already_notified_cycle_is_excluded(self):
        already = {date(2026, 6, 15)}
        assert new_cycle_dates(date(2026, 6, 1), already, date(2026, 6, 15)) == []

    def test_dormant_account_returns_full_backlog_in_order(self):
        """An account not scanned for months should return every missed
        cycle date, oldest first — not just the most recent one."""
        result = new_cycle_dates(date(2026, 1, 1), set(), date(2026, 3, 31))
        assert result == [
            date(2026, 1, 15), date(2026, 1, 30),
            date(2026, 2, 15), date(2026, 2, 28),
            date(2026, 3, 15), date(2026, 3, 30),
        ]

    def test_partial_backlog_excludes_already_notified(self):
        already = {date(2026, 1, 15), date(2026, 1, 30)}
        result = new_cycle_dates(date(2026, 1, 1), already, date(2026, 2, 28))
        assert result == [date(2026, 2, 15), date(2026, 2, 28)]

    def test_idempotent_rerun_returns_nothing_new(self):
        """Simulates running scan() twice in a row: the second call's
        'already_notified' set includes everything the first call found."""
        first = new_cycle_dates(date(2026, 6, 1), set(), date(2026, 6, 30))
        second = new_cycle_dates(date(2026, 6, 1), set(first), date(2026, 6, 30))
        assert second == []
