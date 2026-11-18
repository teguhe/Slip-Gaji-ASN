"""Pengujian parser nominal, NIP, dan tanggal."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from app.services.simgaji_import import (
    _parse_date,
    _parse_money,
    _parse_money_text,
    _parse_nip,
)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("1.234.567,89", Decimal("1234567.89")),
        ("1,234,567.89", Decimal("1234567.89")),
        ("Rp 1.200.000", Decimal("1200000")),
        ("Rp. 6.365.272,37", Decimal("6365272.37")),
        ("6365272,37", Decimal("6365272.37")),
        ("1.234", Decimal("1234")),
        ("12.50", Decimal("12.5")),
        ("0.500", Decimal("0.5")),
        ("(1.200.000)", Decimal("-1200000")),
        ("-1.200.000", Decimal("-1200000")),
        ("1.200.000,-", Decimal("1200000")),
        ("", Decimal("0")),
        ("-", Decimal("0")),
    ],
)
def test_parse_money_text(raw: str, expected: Decimal) -> None:
    assert _parse_money_text(raw) == expected


def test_parse_money_from_excel_float_is_quantized() -> None:
    errors: list[dict] = []
    assert _parse_money(0.1 + 0.2, column="gapok", row=2, errors=errors) == Decimal("0.30")
    assert errors == []


def test_parse_money_rejects_invalid_value() -> None:
    errors: list[dict] = []
    assert _parse_money("bukan angka", column="gapok", row=7, errors=errors) is None
    assert errors and errors[0]["column"] == "gapok" and errors[0]["row"] == 7


def test_parse_money_rejects_over_numeric_15_2_limit() -> None:
    errors: list[dict] = []
    assert _parse_money("99999999999999", column="kotor", row=2, errors=errors) is None
    assert errors and "NUMERIC" in errors[0]["message"]


def test_parse_nip_handles_excel_float_and_text() -> None:
    errors: list[dict] = []
    assert _parse_nip(196812211991011001.0, row=2, errors=errors) == "196812211991011008"
    assert errors == []

    errors = []
    assert _parse_nip("'196812211991011001", row=3, errors=errors) == "196812211991011001"
    assert errors == []

    errors = []
    assert _parse_nip("ABC123", row=4, errors=errors) is None
    assert errors


def test_parse_date_accepts_date_timestamp_and_indonesian_string() -> None:
    errors: list[dict] = []
    assert _parse_date(date(2026, 10, 1), row=2, errors=errors) == date(2026, 10, 1)
    assert _parse_date("01/10/2026", row=3, errors=errors) == date(2026, 10, 1)
    assert _parse_date("20261001", row=4, errors=errors) == date(2026, 10, 1)
    assert errors == []


def test_parse_date_rejects_invalid_string() -> None:
    errors: list[dict] = []
    assert _parse_date("31/02/2026", row=2, errors=errors) is None
    assert errors
