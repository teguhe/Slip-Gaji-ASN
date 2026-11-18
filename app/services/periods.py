"""Utilitas periode penggajian bulanan."""

from __future__ import annotations

import re
from datetime import date

PERIOD_PATTERN = re.compile(r"^(\d{4})-(\d{2})$")


class PeriodError(ValueError):
    """Periode tidak valid."""


def parse_period(value: str) -> date:
    """Ubah ``YYYY-MM`` menjadi tanggal hari pertama bulan tersebut."""

    match = PERIOD_PATTERN.fullmatch(str(value or "").strip())
    if not match:
        raise PeriodError("Format periode harus YYYY-MM.")
    year, month = int(match.group(1)), int(match.group(2))
    if not 1900 <= year <= 2100:
        raise PeriodError("Tahun periode di luar rentang yang didukung.")
    if not 1 <= month <= 12:
        raise PeriodError("Bulan periode harus antara 01 dan 12.")
    return date(year, month, 1)


def period_str(value: date) -> str:
    return f"{value.year:04d}-{value.month:02d}"


def add_months(value: date, months: int) -> date:
    """Tambah sejumlah bulan, selalu mengembalikan hari pertama bulan."""

    total = (value.year * 12 + (value.month - 1)) + int(months)
    year, month_index = divmod(total, 12)
    return date(year, month_index + 1, 1)


def month_difference(start: date, end: date) -> int:
    """Selisih bulan kalender dari ``start`` ke ``end``."""

    return (end.year - start.year) * 12 + (end.month - start.month)


def next_month(value: date) -> date:
    return add_months(value, 1)
