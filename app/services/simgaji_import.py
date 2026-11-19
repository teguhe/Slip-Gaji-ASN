"""Parser dan import engine file Excel SIMGAJI PNS.

Alur:
1. Baca file .xls/.xlsx.
2. Validasi header 43 kolom wajib + ``nmskpd``.
3. Validasi OPD file terhadap profil OPD pengguna login.
4. Parse setiap baris dengan ``Decimal`` (tanpa float untuk nominal).
5. Upsert atomik ke ``payroll_monthly`` berdasarkan ``(nip, tglgaji)``.
6. Catat audit log.
"""

from __future__ import annotations

import io
import logging
import math
import re
import uuid
from collections.abc import Iterator, Sequence
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session
from sqlalchemy.sql import literal_column

from app.auth import UserProfile
from app.config import get_settings
from app.constants import (
    MAX_ABS_MONEY,
    MONEY_COLUMNS,
    PAYROLL_UPSERT_COLUMNS,
    REQUIRED_COLUMNS,
)
from app.models import AuditLog, PayrollMonthly, RefOpd
from app.services.audit import write_audit
from app.services.berjangka import generate_for_periods

logger = logging.getLogger(__name__)

ZERO = Decimal("0.00")
CENT = Decimal("0.01")
MAX_MONEY = Decimal(MAX_ABS_MONEY)
MAX_ERRORS = 100
MAX_WARNINGS = 20
CHUNK_SIZE = 500


class SimgajiImportError(Exception):
    """Kesalahan import yang aman ditampilkan ke klien."""

    http_status = 400

    def __init__(self, message: str, errors: Sequence[dict[str, Any]] | None = None):
        super().__init__(message)
        self.message = message
        self.errors = list(errors or [])


class SimgajiPermissionError(SimgajiImportError):
    http_status = 403


class SimgajiLimitError(SimgajiImportError):
    http_status = 413


def _error(row: int, column: str | None, message: str) -> dict[str, Any]:
    return {"row": int(row), "column": column, "message": message}


def _normalize_header(value: Any) -> str:
    return str(value).replace("\ufeff", "").strip().lower()


def normalize_opd_name(value: Any) -> str:
    """Normalisasi nama OPD: case-insensitive, trim, dan rapikan whitespace."""

    return " ".join(str(value).replace("\xa0", " ").split()).casefold()


def _stringify(value: Any) -> str:
    if isinstance(value, (float, np.floating)):
        number = float(value)
        if math.isfinite(number) and number.is_integer():
            return str(int(number))
    return str(value).replace("\xa0", " ").strip()


def _chunks(items: Sequence[dict[str, Any]], size: int) -> Iterator[list[dict[str, Any]]]:
    for start in range(0, len(items), size):
        yield list(items[start : start + size])


def _read_dataframe(content: bytes, filename: str) -> pd.DataFrame:
    suffix = Path(filename).suffix.lower()
    if suffix not in {".xls", ".xlsx"}:
        raise SimgajiImportError("Format file harus .xls atau .xlsx.")

    engine = "xlrd" if suffix == ".xls" else "openpyxl"
    try:
        df = pd.read_excel(io.BytesIO(content), sheet_name=0, dtype=object, engine=engine)
    except Exception as exc:
        logger.info("Gagal membaca Excel %s: %s", filename, exc)
        raise SimgajiImportError(
            "File Excel tidak dapat dibaca. Pastikan file tidak rusak dan tidak "
            "diproteksi password."
        ) from exc

    if df is None or df.shape[1] == 0:
        raise SimgajiImportError("File Excel tidak memiliki kolom data.")

    normalized_columns = [_normalize_header(column) for column in df.columns]
    duplicates = sorted(
        {name for name in normalized_columns if normalized_columns.count(name) > 1}
    )
    if duplicates:
        raise SimgajiImportError(
            "Header Excel duplikat: " + ", ".join(duplicates)
        )

    df.columns = normalized_columns

    # Kolom kosong/tanpa nama diabaikan; kolom wajib tetap divalidasi.
    kept_columns = [
        column
        for column in df.columns
        if column and not column.startswith("unnamed:")
    ]
    df = df.loc[:, kept_columns].copy()

    missing = [column for column in REQUIRED_COLUMNS if column not in df.columns]
    if missing:
        raise SimgajiImportError(
            "Kolom wajib tidak ditemukan di Excel: " + ", ".join(missing)
        )

    # Simpan nomor baris Excel asli (header = baris 1) untuk pesan error.
    df.insert(0, "__row__", df.index + 2)
    data_columns = [column for column in df.columns if column != "__row__"]
    df = df.dropna(how="all", subset=data_columns).reset_index(drop=True)

    if df.empty:
        raise SimgajiImportError("File Excel tidak memiliki baris data.")

    max_rows = get_settings().max_import_rows
    if len(df) > max_rows:
        raise SimgajiLimitError(
            f"File berisi {len(df):,} baris, melebihi batas {max_rows:,} baris per import."
        )

    return df


def _clean_nmskpd(df: pd.DataFrame) -> None:
    """Bersihkan nilai nmskpd dan isi merged cell secara konsisten."""

    def _clean_cell(v: Any) -> str | None:
        if pd.isna(v):
            return None
        text = _stringify(v)
        return text if text else None

    cleaned = df["nmskpd"].map(_clean_cell)
    df["nmskpd"] = cleaned.ffill().bfill()
    if df["nmskpd"].isna().all():
        raise SimgajiImportError(
            "Kolom 'nmskpd' kosong. Nama OPD wajib diisi untuk verifikasi akses."
        )


def _extract_excel_opd(df: pd.DataFrame) -> tuple[str, str]:
    _clean_nmskpd(df)
    values = [str(v).strip() for v in df["nmskpd"].dropna().unique() if str(v).strip()]
    if not values:
        raise SimgajiImportError(
            "Kolom 'nmskpd' kosong. Nama OPD wajib diisi untuk verifikasi akses."
        )

    normalized_to_raw: dict[str, str] = {}
    for value in values:
        normalized_to_raw.setdefault(normalize_opd_name(value), value)

    normalized, raw = next(iter(normalized_to_raw.items()))
    return normalized, raw


def _check_opd_permission(user: UserProfile, excel_opd_norm: str, excel_opd_raw: str) -> None:
    if user.role == "super_admin":
        return

    if user.role != "bendahara_opd":
        raise SimgajiPermissionError(
            "Role akun tidak diizinkan melakukan import data payroll."
        )

    if not user.opd_name:
        raise SimgajiPermissionError(
            "Profil OPD akun Anda belum diatur. Hubungi Super Admin sebelum import."
        )

    if normalize_opd_name(user.opd_name) != excel_opd_norm:
        raise SimgajiPermissionError(
            f"OPD pada file ({excel_opd_raw}) tidak cocok dengan OPD akun Anda "
            f"({user.opd_name}). Import dibatalkan."
        )


def _resolve_ref_opd(
    db: Session,
    excel_opd_norm: str,
    excel_opd_raw: str,
    user: UserProfile | None = None,
) -> RefOpd:
    matches = [
        opd
        for opd in db.scalars(select(RefOpd)).all()
        if normalize_opd_name(opd.nmskpd) == excel_opd_norm
    ]
    if not matches:
        if user and user.role == "super_admin":
            new_opd = RefOpd(nmskpd=excel_opd_raw.strip())
            db.add(new_opd)
            db.flush()
            write_audit(
                db,
                actor_email=user.email,
                action="AUTO_CREATE_OPD_ON_IMPORT",
                table_name="ref_opd",
                record_id=str(new_opd.id),
                details={"nmskpd": new_opd.nmskpd, "source": "simgaji_excel"},
            )
            return new_opd
        raise SimgajiImportError(
            f"OPD '{excel_opd_raw}' belum terdaftar pada ref_opd. "
            "Daftarkan OPD terlebih dahulu sebelum import."
        )
    if len(matches) > 1:
        raise SimgajiImportError(
            f"Terdapat lebih dari satu OPD dengan nama setara '{excel_opd_raw}'. "
            "Rapikan data ref_opd terlebih dahulu."
        )
    return matches[0]


def _parse_date(value: Any, row: int, errors: list[dict[str, Any]]) -> date | None:
    if pd.isna(value):
        errors.append(_error(row, "tglgaji", "Tanggal gaji wajib diisi."))
        return None

    if isinstance(value, pd.Timestamp):
        return value.date()
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value

    if isinstance(value, (int, np.integer)) and not isinstance(value, bool):
        integer_value = int(value)
        # Format YYYYMMDD (mis. 20261001) lebih aman dideteksi lebih dulu.
        if len(str(integer_value)) == 8:
            try:
                return datetime.strptime(str(integer_value), "%Y%m%d").date()
            except ValueError:
                pass
        try:
            parsed = (datetime(1899, 12, 30) + timedelta(days=integer_value)).date()
        except (OverflowError, ValueError):
            errors.append(_error(row, "tglgaji", "Tanggal gaji tidak valid."))
            return None
        if not 1900 <= parsed.year <= 2100:
            errors.append(_error(row, "tglgaji", "Tanggal gaji di luar rentang wajar."))
            return None
        return parsed

    if isinstance(value, (float, np.floating)):
        number = float(value)
        if not math.isfinite(number):
            errors.append(_error(row, "tglgaji", "Tanggal gaji tidak valid."))
            return None
        try:
            parsed = (datetime(1899, 12, 30) + timedelta(days=number)).date()
        except (OverflowError, ValueError):
            errors.append(_error(row, "tglgaji", "Tanggal gaji tidak valid."))
            return None
        if not 1900 <= parsed.year <= 2100:
            errors.append(_error(row, "tglgaji", "Tanggal gaji di luar rentang wajar."))
            return None
        return parsed

    text = _stringify(value)
    if not text:
        errors.append(_error(row, "tglgaji", "Tanggal gaji wajib diisi."))
        return None

    for pattern in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%Y/%m/%d", "%d.%m.%Y"):
        try:
            return datetime.strptime(text, pattern).date()
        except ValueError:
            continue

    parsed = pd.to_datetime(text, dayfirst=True, errors="coerce")
    if pd.isna(parsed):
        errors.append(_error(row, "tglgaji", f"Format tanggal tidak dikenali: {text!r}."))
        return None
    result = parsed.date()
    if not 1900 <= result.year <= 2100:
        errors.append(_error(row, "tglgaji", "Tanggal gaji di luar rentang wajar."))
        return None
    return result


def _parse_nip(value: Any, row: int, errors: list[dict[str, Any]]) -> str | None:
    if pd.isna(value):
        errors.append(_error(row, "nip", "NIP wajib diisi."))
        return None

    if isinstance(value, bool):
        errors.append(_error(row, "nip", "NIP tidak valid."))
        return None

    if isinstance(value, (int, np.integer)):
        text = str(int(value))
    elif isinstance(value, (float, np.floating)):
        number = float(value)
        if not math.isfinite(number) or not number.is_integer():
            errors.append(_error(row, "nip", "NIP harus berupa angka bulat."))
            return None
        text = str(int(number))
    else:
        text = _stringify(value).lstrip("'").replace(" ", "")
        if text.endswith(".0"):
            text = text[:-2]

    if not re.fullmatch(r"\d{8,30}", text):
        errors.append(
            _error(row, "nip", "NIP harus berupa 8-30 digit angka tanpa karakter lain.")
        )
        return None
    return text


def _parse_text(
    value: Any,
    *,
    column: str,
    max_length: int,
    required: bool,
    row: int,
    errors: list[dict[str, Any]],
) -> str | None:
    text = "" if pd.isna(value) else _stringify(value)
    if required and not text:
        errors.append(_error(row, column, f"Kolom {column} wajib diisi."))
        return None
    if len(text) > max_length:
        errors.append(
            _error(
                row,
                column,
                f"Nilai {column} melebihi {max_length} karakter.",
            )
        )
        return None
    return text


def _parse_money_text(text: str) -> Decimal:
    value = text.strip()
    negative = False

    if value.startswith("(") and value.endswith(")"):
        negative = True
        value = value[1:-1]

    value = re.sub(r"(?i)^rp\.?\s*", "", value)
    value = value.replace("\xa0", "").replace(" ", "")
    value = re.sub(r"(?i)^idr\.?\s*", "", value)

    if value.startswith("-"):
        negative = not negative
        value = value[1:]
    elif value.startswith("+"):
        value = value[1:]

    if value.endswith(",-"):
        value = value[:-2]

    if value in {"", "-", "—", "–"}:
        return ZERO

    if "." in value and "," in value:
        if value.rfind(",") > value.rfind("."):
            value = value.replace(".", "").replace(",", ".")
        else:
            value = value.replace(",", "")
    elif "," in value:
        if value.count(",") == 1:
            value = value.replace(",", ".")
        else:
            value = value.replace(",", "")
    elif "." in value:
        if value.count(".") > 1:
            value = value.replace(".", "")
        else:
            left, right = value.split(".")
            # "1.234" / "12.345" pada format Indonesia = ribuan.
            if (
                len(right) == 3
                and left
                and left != "0"
                and not left.startswith("0")
                and len(left) <= 3
            ):
                value = left + right

    if not re.fullmatch(r"\d+(?:\.\d+)?", value):
        raise ValueError(f"Nominal tidak valid: {text!r}")

    amount = Decimal(value)
    return -amount if negative else amount


def _parse_money(
    value: Any,
    *,
    column: str,
    row: int,
    errors: list[dict[str, Any]],
) -> Decimal | None:
    if pd.isna(value):
        return ZERO

    if isinstance(value, bool):
        errors.append(_error(row, column, "Nominal tidak valid (boolean)."))
        return None

    try:
        if isinstance(value, Decimal):
            amount = value
        elif isinstance(value, (int, np.integer)):
            amount = Decimal(int(value))
        elif isinstance(value, (float, np.floating)):
            number = float(value)
            if not math.isfinite(number):
                raise ValueError("nominal bukan angka finite")
            amount = Decimal(str(number))
        else:
            amount = _parse_money_text(_stringify(value))
    except (ValueError, InvalidOperation):
        errors.append(
            _error(row, column, f"Nominal tidak valid: {_stringify(value)!r}.")
        )
        return None

    try:
        amount = amount.quantize(CENT, rounding=ROUND_HALF_UP)
    except InvalidOperation:
        errors.append(_error(row, column, "Nominal di luar presisi yang didukung."))
        return None

    if abs(amount) > MAX_MONEY:
        errors.append(
            _error(row, column, f"Nominal melebihi batas NUMERIC(15,2): {MAX_MONEY}.")
        )
        return None

    return amount


def _parse_rows(
    df: pd.DataFrame,
    *,
    canonical_opd: str | dict[str, str],
    user_email: str,
    imported_at: datetime,
) -> tuple[list[dict[str, Any]], list[str]]:
    records: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    warnings: list[str] = []
    consistency_mismatches = 0

    for _, source_row in df.iterrows():
        row = int(source_row["__row__"])
        row_errors: list[dict[str, Any]] = []

        tglgaji = _parse_date(source_row["tglgaji"], row, row_errors)
        nip = _parse_nip(source_row["nip"], row, row_errors)
        nama = _parse_text(
            source_row["nama"],
            column="nama",
            max_length=255,
            required=True,
            row=row,
            errors=row_errors,
        )
        norek = _parse_text(
            source_row["norek"],
            column="norek",
            max_length=50,
            required=False,
            row=row,
            errors=row_errors,
        )
        kdpangkat = _parse_text(
            source_row["kdpangkat"],
            column="kdpangkat",
            max_length=10,
            required=False,
            row=row,
            errors=row_errors,
        )

        numeric_values: dict[str, Decimal] = {}
        for column in MONEY_COLUMNS:
            amount = _parse_money(
                source_row[column], column=column, row=row, errors=row_errors
            )
            if amount is not None:
                numeric_values[column] = amount

        if row_errors:
            errors.extend(row_errors)
            if len(errors) >= MAX_ERRORS:
                errors.append(
                    _error(row, None, "Terlalu banyak baris tidak valid; proses dihentikan.")
                )
                break
            continue

        if tglgaji is None or nip is None or nama is None:
            # Pengaman tambahan; seharusnya sudah tertangkap row_errors.
            errors.append(_error(row, None, "Data baris tidak lengkap."))
            continue

        raw_nip = source_row["nip"]
        if isinstance(raw_nip, (float, np.floating)) and abs(float(raw_nip)) >= 2**53:
            if len(warnings) < MAX_WARNINGS:
                warnings.append(
                    f"Baris {row}: NIP dibaca sebagai angka dan berpotensi kehilangan "
                    "presisi. Ekspor ulang dengan format kolom NIP sebagai teks."
                )

        if isinstance(canonical_opd, dict):
            row_opd_norm = normalize_opd_name(source_row["nmskpd"])
            row_canonical_opd = canonical_opd.get(row_opd_norm, _stringify(source_row["nmskpd"]))
        else:
            row_canonical_opd = canonical_opd

        record: dict[str, Any] = {
            "tglgaji": tglgaji,
            "nip": nip,
            "nama": nama.strip(),
            "norek": (norek or "").strip() or None,
            "kdpangkat": (kdpangkat or "").strip() or None,
            "nmskpd": row_canonical_opd,
            **numeric_values,
            "imported_by": user_email,
            "imported_at": imported_at,
            "_row": row,
        }

        expected_bersih = record["kotor"] - record["potongan"]
        if record["bersih"] != expected_bersih:
            consistency_mismatches += 1
            if len(warnings) < MAX_WARNINGS:
                warnings.append(
                    f"Baris {row} (NIP {nip}): bersih {record['bersih']} tidak sama "
                    f"dengan kotor - potongan ({expected_bersih})."
                )

        records.append(record)

    if errors:
        raise SimgajiImportError(
            f"File Excel ditolak: {len(errors)} kesalahan validasi ditemukan.",
            errors=errors[: MAX_ERRORS + 1],
        )

    if consistency_mismatches > MAX_WARNINGS:
        warnings.append(
            f"... dan {consistency_mismatches - MAX_WARNINGS} baris lain dengan "
            "selisih bersih vs kotor - potongan."
        )

    # Deteksi duplikat (nip, tglgaji) sebelum upsert. PostgreSQL menolak
    # satu statement ON CONFLICT yang menyentuh baris yang sama dua kali.
    seen: dict[tuple[str, date], int] = {}
    duplicate_errors: list[dict[str, Any]] = []
    for record in records:
        key = (record["nip"], record["tglgaji"])
        if key in seen:
            duplicate_errors.append(
                _error(
                    record["_row"],
                    "nip",
                    f"Duplikat NIP {record['nip']} untuk tanggal {record['tglgaji']} "
                    f"dengan baris {seen[key]}.",
                )
            )
        else:
            seen[key] = record["_row"]

    if duplicate_errors:
        raise SimgajiImportError(
            "File Excel memuat NIP dan tanggal gaji yang duplikat.",
            errors=duplicate_errors[:MAX_ERRORS],
        )

    return records, warnings


def _assert_no_cross_opd_conflict(
    db: Session,
    records: Sequence[dict[str, Any]],
    canonical_opd: str,
) -> None:
    """Cegah bendahara menimpa baris payroll milik OPD lain.

    Validasi ``nmskpd`` hanya membuktikan file mengklaim OPD pengguna. Pemeriksaan
    ini memastikan NIP+tanggal yang sudah ada tidak berpindah OPD secara diam-diam.
    """

    canonical_norm = normalize_opd_name(canonical_opd)
    dates = sorted({record["tglgaji"] for record in records})
    existing_rows = db.execute(
        select(PayrollMonthly.nip, PayrollMonthly.tglgaji, PayrollMonthly.nmskpd).where(
            PayrollMonthly.tglgaji.in_(dates)
        )
    ).all()
    existing_opd_by_key = {
        (row.nip, row.tglgaji): row.nmskpd for row in existing_rows
    }

    conflicts: list[tuple[dict[str, Any], str]] = []
    for record in records:
        existing_opd = existing_opd_by_key.get((record["nip"], record["tglgaji"]))
        if (
            existing_opd is not None
            and normalize_opd_name(existing_opd) != canonical_norm
        ):
            conflicts.append((record, existing_opd))

    if conflicts:
        errors = [
            _error(
                record["_row"],
                "nip",
                f"NIP {record['nip']} tanggal {record['tglgaji']} sudah terdaftar "
                f"pada OPD {existing_opd}.",
            )
            for record, existing_opd in conflicts[:MAX_ERRORS]
        ]
        raise SimgajiPermissionError(
            "Import dibatalkan: data dengan (nip, tglgaji) yang sama sudah ada dan "
            "milik OPD lain.",
            errors=errors,
        )


def _upsert_payroll(
    db: Session, records: Sequence[dict[str, Any]]
) -> tuple[int, int]:
    clean_records = [
        {key: value for key, value in record.items() if key != "_row"}
        for record in records
    ]

    inserted = 0
    updated = 0
    for chunk in _chunks(clean_records, CHUNK_SIZE):
        statement = pg_insert(PayrollMonthly).values(chunk)
        update_values = {
            column: getattr(statement.excluded, column)
            for column in PAYROLL_UPSERT_COLUMNS
        }
        statement = statement.on_conflict_do_update(
            constraint="uq_payroll_nip_period",
            set_=update_values,
        ).returning(literal_column("xmax = 0").label("was_inserted"))

        result = db.execute(statement).all()
        chunk_inserted = sum(1 for row in result if bool(row.was_inserted))
        inserted += chunk_inserted
        updated += len(result) - chunk_inserted

    return inserted, updated


def import_simgaji_excel(
    *,
    content: bytes,
    filename: str,
    user: UserProfile,
    db: Session,
    ip_address: str | None = None,
) -> dict[str, Any]:
    """Import file SIMGAJI secara atomik dan kembalikan ringkasan hasil."""

    safe_filename = Path(filename or "upload.xlsx").name
    df = _read_dataframe(content, safe_filename)
    _clean_nmskpd(df)

    warnings: list[str] = []

    # Filter OPD berdasarkan hak akses pengguna:
    # Semua baris yang nmskpd-nya tidak sesuai hak akses tidak perlu diimport.
    if user.role != "super_admin":
        if user.role != "bendahara_opd":
            raise SimgajiPermissionError(
                "Role akun tidak diizinkan melakukan import data payroll."
            )
        if not user.opd_name:
            raise SimgajiPermissionError(
                "Profil OPD akun Anda belum diatur. Hubungi Super Admin sebelum import."
            )

        user_opd_norm = normalize_opd_name(user.opd_name)
        is_matching = df["nmskpd"].map(normalize_opd_name) == user_opd_norm
        skipped_count = int((~is_matching).sum())

        if not is_matching.any():
            distinct_found = sorted(
                {str(v).strip() for v in df["nmskpd"].dropna().unique() if str(v).strip()}
            )
            daftar = "; ".join(distinct_found)[:300]
            raise SimgajiPermissionError(
                f"Tidak ada data dalam file yang sesuai dengan OPD akun Anda ({user.opd_name}). "
                f"OPD pada file ({daftar}) tidak cocok dengan hak akses Anda. Import dibatalkan."
            )

        if skipped_count > 0:
            warnings.append(
                f"{skipped_count} baris data OPD lain dilewati karena tidak sesuai hak akses OPD Anda ({user.opd_name})."
            )

        # Hanya import baris yang cocok dengan hak akses bendahara
        df = df.loc[is_matching].copy()

        ref_opd = _resolve_ref_opd(db, user_opd_norm, user.opd_name, user=user)
        canonical_opd: str | dict[str, str] = ref_opd.nmskpd.strip()
        result_opd_name = ref_opd.nmskpd.strip()
    else:
        # Super admin memiliki hak akses ke semua OPD
        distinct_raw = sorted(
            {str(v).strip() for v in df["nmskpd"].dropna().unique() if str(v).strip()}
        )
        opd_map: dict[str, str] = {}
        for raw_val in distinct_raw:
            norm_val = normalize_opd_name(raw_val)
            if norm_val not in opd_map:
                ref = _resolve_ref_opd(db, norm_val, raw_val, user=user)
                opd_map[norm_val] = ref.nmskpd.strip()

        canonical_opd = opd_map
        result_opd_name = ", ".join(sorted(set(opd_map.values())))

    imported_at = datetime.now(timezone.utc)
    records, row_warnings = _parse_rows(
        df,
        canonical_opd=canonical_opd,
        user_email=user.email,
        imported_at=imported_at,
    )
    warnings.extend(row_warnings)

    if not records:
        raise SimgajiImportError("Tidak ada baris data valid yang dapat diimpor.")

    # Super admin boleh melakukan koreksi lintas OPD; bendahara tidak boleh.
    if user.role != "super_admin":
        _assert_no_cross_opd_conflict(db, records, result_opd_name)

    periods = sorted({f"{record['tglgaji']:%Y-%m}" for record in records})
    import_id = uuid.uuid4()

    try:
        inserted, updated = _upsert_payroll(db, records)

        # Realisasi otomatis cicilan berjangka untuk periode yang baru diproses.
        period_dates = [date.fromisoformat(f"{period}-01") for period in periods]
        berjangka_counts = generate_for_periods(
            db,
            period_dates,
            created_by=user.email,
            opd_name=result_opd_name if user.role != "super_admin" else None,
        )

        db.add(
            AuditLog(
                user_email=user.email,
                action="IMPORT_SIMGAJI_EXCEL",
                table_name="payroll_monthly",
                record_id=str(import_id),
                details={
                    "import_id": str(import_id),
                    "filename": safe_filename,
                    "opd": result_opd_name,
                    "total_rows": len(records),
                    "inserted": inserted,
                    "updated": updated,
                    "periods": periods,
                    "warning_count": len(warnings),
                    "berjangka": berjangka_counts,
                },
                ip_address=(ip_address or "")[:50] or None,
            )
        )
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Import SIMGAJI gagal disimpan untuk %s", user.email)
        raise

    logger.info(
        "Import SIMGAJI sukses: user=%s opd=%s rows=%s inserted=%s updated=%s",
        user.email,
        result_opd_name,
        len(records),
        inserted,
        updated,
    )

    return {
        "status": "success",
        "import_id": str(import_id),
        "filename": safe_filename,
        "opd": result_opd_name,
        "total_rows": len(records),
        "inserted": inserted,
        "updated": updated,
        "periods": periods,
        "imported_by": user.email,
        "warnings": warnings,
    }
