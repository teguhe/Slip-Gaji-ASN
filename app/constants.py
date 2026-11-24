"""Konstanta domain SIMGAJI dan nama kolom database.

43 kolom wajib mengikuti PRD. Kolom ``nmskpd`` ditambahkan sebagai kolom
kontrol untuk verifikasi OPD sebelum data diimpor.
"""

from __future__ import annotations

TARGET_COLUMNS: tuple[str, ...] = (
    "tglgaji",
    "nip",
    "nama",
    "norek",
    "kdpangkat",
    "gapok",
    "tjistri",
    "tjanak",
    "tjtpp",
    "tjeselon",
    "tjfungsi",
    "tjstruk",
    "tjguru",
    "tjlangka",
    "tjtkd",
    "tjterpencil",
    "tjkhusus",
    "tjberas",
    "tjpajak",
    "tjaskes",
    "tjumum",
    "tjkk",
    "tjkm",
    "ttaperap",
    "tbulat",
    "kotor",
    "iwp_beban_pegawai",
    "iwp_beban_pembkerja",
    "iwp_taspen",
    "ppajak",
    "pbulog",
    "ptaperum",
    "psewa",
    "phutang",
    "pkorpri",
    "pirdhata",
    "pkoperasi",
    "pjkk",
    "pjkm",
    "ptaperap",
    "ptaperai",
    "potongan",
    "bersih",
)

# Kolom non-nominal / non-tanggal.
TEXT_COLUMNS: tuple[str, ...] = ("nip", "nama", "norek", "kdpangkat")

# 38 kolom nominal (NUMERIC(15,2)); tidak boleh diproses sebagai float.
MONEY_COLUMNS: tuple[str, ...] = tuple(
    column for column in TARGET_COLUMNS if column not in {"tglgaji", *TEXT_COLUMNS}
)

# Kolom yang wajib ada di file Excel: 43 kolom PRD + nmskpd.
REQUIRED_COLUMNS: tuple[str, ...] = (*TARGET_COLUMNS, "nmskpd")

# Kolom yang ditulis ke payroll_monthly (di luar id).
PAYROLL_INSERT_COLUMNS: tuple[str, ...] = (
    *TARGET_COLUMNS,
    "nmskpd",
    "imported_by",
    "imported_at",
)

# Semua kolom diperbarui saat konflik (nip, tglgaji); key tidak diubah.
PAYROLL_UPSERT_COLUMNS: tuple[str, ...] = tuple(
    column
    for column in PAYROLL_INSERT_COLUMNS
    if column not in {"nip", "tglgaji"}
)

# Batas NUMERIC(15,2): 13 digit di depan koma, 2 digit di belakang.
MAX_ABS_MONEY = "9999999999999.99"


# Komponen rincian gaji untuk response API (di luar agregat kotor/potongan/bersih).
INCOME_COLUMNS: tuple[str, ...] = (
    "gapok",
    "tjistri",
    "tjanak",
    "tjtpp",
    "tjeselon",
    "tjfungsi",
    "tjstruk",
    "tjguru",
    "tjlangka",
    "tjtkd",
    "tjterpencil",
    "tjkhusus",
    "tjberas",
    "tjpajak",
    "tjaskes",
    "tjumum",
    "tjkk",
    "tjkm",
    "ttaperap",
    "tbulat",
)

DEDUCTION_COLUMNS: tuple[str, ...] = (
    "iwp_beban_pegawai",
    "iwp_beban_pembkerja",
    "iwp_taspen",
    "ppajak",
    "pbulog",
    "ptaperum",
    "psewa",
    "phutang",
    "pkorpri",
    "pirdhata",
    "pkoperasi",
    "pjkk",
    "pjkm",
    "ptaperap",
    "ptaperai",
)

# Pemetaan resmi kode pangkat SIMGAJI ke format golongan ASN Romawi
KDPANGKAT_MAP: dict[str, str] = {
    "1A": "I/a",
    "1B": "I/b",
    "1C": "I/c",
    "1D": "I/d",
    "2A": "II/a",
    "2B": "II/b",
    "2C": "II/c",
    "2D": "II/d",
    "3A": "III/a",
    "3B": "III/b",
    "3C": "III/c",
    "3D": "III/d",
    "4A": "IV/a",
    "4B": "IV/b",
    "4C": "IV/c",
    "4D": "IV/d",
    "4E": "IV/e",
}


def format_kdpangkat(val: str | None) -> str | None:
    """Format kode pangkat SIMGAJI (misal '4A', '1A') menjadi golongan romawi ('IV/a', 'I/a')."""
    if val is None:
        return None
    cleaned = str(val).strip()
    if not cleaned or cleaned in {"-", "—"}:
        return None
    upper = cleaned.upper()
    if upper in KDPANGKAT_MAP:
        return KDPANGKAT_MAP[upper]

    import re

    dash_match = re.match(r"^(\d[A-E])\s*[-/]\s*([IV]+)/([A-E])$", upper)
    if dash_match:
        return f"{dash_match.group(2).upper()}/{dash_match.group(3).lower()}"

    roman_match = re.match(r"^([IV]+)/([A-E])$", upper)
    if roman_match:
        return f"{roman_match.group(1).upper()}/{roman_match.group(2).lower()}"

    return cleaned

