"""Parser SIMGAJI PNS — antarmuka kompatibilitas.

Implementasi produksi (baca Excel, validasi 43 kolom + nmskpd, parsing
``Decimal``, isolasi OPD, upsert, dan audit) berada di
``app.services.simgaji_import`` dan digunakan oleh endpoint
``POST /api/v1/payroll/import-excel``.

Fungsi lama ``parse_and_import_simgaji`` tetap disediakan agar pemanggil
sebelumnya tidak rusak, tetapi sekarang mendelegasikan ke engine tersebut.
"""

from __future__ import annotations

from pathlib import Path

from sqlalchemy.orm import Session

from app.auth import UserProfile
from app.constants import TARGET_COLUMNS
from app.services.simgaji_import import (
    SimgajiImportError,
    SimgajiLimitError,
    SimgajiPermissionError,
    import_simgaji_excel,
    normalize_opd_name,
)

__all__ = [
    "TARGET_COLUMNS",
    "SimgajiImportError",
    "SimgajiLimitError",
    "SimgajiPermissionError",
    "normalize_opd_name",
    "parse_and_import_simgaji",
]


def parse_and_import_simgaji(
    file_path: str,
    user_opd_name: str,
    db_session: Session,
    user_email: str,
) -> dict:
    """Kompatibilitas fungsi lama: impor file dari path dan kembalikan ringkasan."""

    path = Path(file_path)
    user = UserProfile(
        email=user_email,
        role="bendahara_opd",
        opd_name=str(user_opd_name or ""),
    )
    result = import_simgaji_excel(
        content=path.read_bytes(),
        filename=path.name,
        user=user,
        db=db_session,
    )
    # Nama field lama dipertahankan untuk pemanggil yang sudah ada.
    result["total_records"] = result["total_rows"]
    return result
