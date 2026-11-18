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
