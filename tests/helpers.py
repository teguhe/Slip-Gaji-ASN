"""Helper pembuat file Excel SIMGAJI untuk pengujian."""

from __future__ import annotations

import io
from datetime import date
from typing import Any, Iterable

import pandas as pd

from app.constants import MONEY_COLUMNS, TARGET_COLUMNS

from tests.conftest import OPD_NAME


def make_row(**overrides: Any) -> dict[str, Any]:
    row: dict[str, Any] = {column: 0 for column in MONEY_COLUMNS}
    row.update(
        {
            "tglgaji": date(2026, 10, 1),
            "nip": "196812211991011001",
            "nama": "CELSO EDGAR NASCIMENTO",
            "norek": "3033034147",
            "kdpangkat": "4A",
            "nmskpd": OPD_NAME,
            "gapok": "5.235.000,55",
            "tjistri": "523.500,00",
            "tjanak": "104.700,00",
            "tjberas": "217.260,00",
            "tjaskes": "284.812,37",
            "kotor": "6.365.272,92",
            "potongan": "812.472,37",
            "bersih": "5.552.800,55",
        }
    )
    row.update(overrides)
    return row


def make_excel(
    rows: Iterable[dict[str, Any]],
    *,
    drop_columns: Iterable[str] = (),
) -> bytes:
    dataframe = pd.DataFrame(list(rows))
    columns = [
        column
        for column in ("nmskpd", *TARGET_COLUMNS)
        if column not in set(drop_columns)
    ]
    dataframe = dataframe[columns]

    buffer = io.BytesIO()
    dataframe.to_excel(buffer, index=False, engine="openpyxl")
    return buffer.getvalue()


def make_potongan_excel(rows: Iterable[dict[str, Any]]) -> bytes:
    dataframe = pd.DataFrame(list(rows), columns=["nip", "nominal"])
    buffer = io.BytesIO()
    dataframe.to_excel(buffer, index=False, engine="openpyxl")
    return buffer.getvalue()
