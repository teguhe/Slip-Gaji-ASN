"""Endpoint pos potongan, pinjaman berjangka, dan import potongan manual."""

from __future__ import annotations

import io
import math
import re
from datetime import date
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from typing import Any
import uuid

import numpy as np
import pandas as pd
from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    UploadFile,
    status,
)
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import UserProfile, get_current_user
from app.config import get_settings
from app.constants import MAX_ABS_MONEY
from app.db import get_db
from app.models import (
    AuditLog,
    PayrollMonthly,
    PayrollPotonganItem,
    PotonganBerjangka,
    RefOpd,
    RefPosPotongan,
)
from app.schemas import (
    BerjangkaCreate,
    BerjangkaResponse,
    GenerateBerjangkaRequest,
    GenerateBerjangkaResponse,
    ManualPotonganImportResponse,
    PosBulananDetailItem,
    PosBulananDetailResponse,
    PosBulananRekapItem,
    PosPotonganCreate,
    PosPotonganResponse,
    PosPotonganUpdate,
    PotonganItemCreate,
    PotonganItemDeleteResponse,
    PotonganItemResponse,
    RekapBulananResponse,
)
from app.services.audit import extract_client_ip
from app.services.berjangka import (
    calculate_end_period,
    generate_for_period,
    loan_progress,
    quantize_money,
)
from app.services.periods import (
    PeriodError,
    add_months,
    parse_period,
    period_str,
)

router = APIRouter(prefix="/api/v1/potongan", tags=["Potongan"])

CENT = Decimal("0.01")
MAX_MONEY = Decimal(MAX_ABS_MONEY)
MAX_POTONGAN_ROWS = 5000
MAX_ERRORS = 50

NIP_PATTERN = re.compile(r"^\d{8,30}$")


# ---------------------------------------------------------------------------
# Helper umum
# ---------------------------------------------------------------------------

def _client_ip(request: Request) -> str | None:
    return extract_client_ip(request)


def _resolve_opd(
    db: Session,
    user: UserProfile,
    opd_id: int | None = None,
) -> RefOpd:
    if user.role != "super_admin":
        if user.opd_id is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Profil OPD akun Anda belum diatur.",
            )
        if opd_id is not None and opd_id != user.opd_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Anda tidak berhak mengakses OPD lain.",
            )
        target = user.opd_id
    else:
        target = opd_id if opd_id is not None else user.opd_id
        if target is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Super admin wajib menentukan opd_id.",
            )

    opd = db.get(RefOpd, target)
    if opd is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="OPD tidak ditemukan.",
        )
    return opd


def _opd_clause(opd: RefOpd):
    return func.lower(func.trim(PayrollMonthly.nmskpd)) == opd.nmskpd.strip().lower()


def _pos_or_404(db: Session, pos_id: int, opd: RefOpd) -> RefPosPotongan:
    pos = db.get(RefPosPotongan, pos_id)
    if pos is None or pos.opd_id != opd.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Pos potongan tidak ditemukan pada OPD Anda.",
        )
    return pos


def _clean_nip(value: Any) -> str:
    text = str(value or "").strip()
    if text.endswith(".0"):
        text = text[:-2]
    text = text.replace(" ", "")
    if not NIP_PATTERN.fullmatch(text):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="NIP harus berupa 8-30 digit angka.",
        )
    return text


def _validate_period(value: str, field_name: str = "period") -> date:
    try:
        return parse_period(value)
    except PeriodError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"{field_name} tidak valid: {exc}",
        ) from exc


def _payroll_for_nip(db: Session, nip: str, opd: RefOpd) -> PayrollMonthly | None:
    return db.scalar(
        select(PayrollMonthly)
        .where(PayrollMonthly.nip == nip, _opd_clause(opd))
        .order_by(PayrollMonthly.tglgaji.desc())
        .limit(1)
    )


def _audit(
    db: Session,
    user: UserProfile,
    *,
    action: str,
    table_name: str,
    record_id: str | None,
    details: dict[str, Any],
    request: Request,
) -> None:
    db.add(
        AuditLog(
            user_email=user.email,
            action=action,
            table_name=table_name,
            record_id=record_id,
            details=details,
            ip_address=(_client_ip(request) or "")[:50] or None,
        )
    )


def _pos_response(pos: RefPosPotongan, opd: RefOpd) -> PosPotonganResponse:
    return PosPotonganResponse(
        id=pos.id,
        opd_id=pos.opd_id,
        opd_nama=opd.nmskpd.strip(),
        nama_pos=pos.nama_pos,
        kategori=pos.kategori,
        is_active=bool(pos.is_active),
        created_at=pos.created_at,
    )


def _loan_response(
    loan: PotonganBerjangka,
    *,
    nama: str | None,
    pos: RefPosPotongan | None,
    opd: RefOpd,
    period: date,
) -> BerjangkaResponse:
    progress = loan_progress(
        loan.start_period,
        loan.end_period,
        loan.tenor_bulan,
        period,
    )
    return BerjangkaResponse(
        id=str(loan.id),
        nip=loan.nip,
        nama=nama or "—",
        pos_id=loan.pos_id,
        pos_nama=pos.nama_pos if pos else "—",
        opd_nama=opd.nmskpd.strip(),
        nominal_per_bulan=loan.nominal_per_bulan,
        start_period=period_str(loan.start_period),
        end_period=period_str(loan.end_period),
        tenor_bulan=loan.tenor_bulan,
        cicilan_ke=progress["cicilan_ke"],
        sisa_bulan=progress["sisa_bulan"],
        status=progress["status"],
        keterangan=loan.keterangan,
        created_by=loan.created_by,
        created_at=loan.created_at,
    )


def _money_from_cell(
    value: Any,
    *,
    row: int,
    errors: list[dict[str, Any]],
) -> Decimal | None:
    if pd.isna(value):
        errors.append(
            {"row": row, "column": "nominal", "message": "Nominal wajib diisi."}
        )
        return None
    if isinstance(value, bool):
        errors.append(
            {"row": row, "column": "nominal", "message": "Nominal tidak valid."}
        )
        return None

    try:
        if isinstance(value, Decimal):
            amount = value
        elif isinstance(value, (int, np.integer)):
            amount = Decimal(int(value))
        elif isinstance(value, (float, np.floating)):
            number = float(value)
            if not math.isfinite(number):
                raise ValueError
            amount = Decimal(str(number))
        else:
            text = str(value).strip()
            if not text:
                raise ValueError
            text = re.sub(r"(?i)^rp\.?\s*", "", text)
            text = text.replace("\xa0", "").replace(" ", "")
            if "." in text and "," in text:
                if text.rfind(",") > text.rfind("."):
                    text = text.replace(".", "").replace(",", ".")
                else:
                    text = text.replace(",", "")
            elif "," in text:
                text = text.replace(",", ".") if text.count(",") == 1 else text.replace(",", "")
            elif "." in text:
                if text.count(".") > 1:
                    text = text.replace(".", "")
                else:
                    left, right = text.split(".")
                    if len(right) == 3 and left and left != "0":
                        text = left + right
            amount = Decimal(text)

        amount = amount.quantize(CENT, rounding=ROUND_HALF_UP)
        if amount <= 0:
            raise ValueError
        if abs(amount) > MAX_MONEY:
            raise ValueError
        return amount
    except (ValueError, InvalidOperation, ArithmeticError):
        errors.append(
            {
                "row": row,
                "column": "nominal",
                "message": f"Nominal tidak valid: {value!r}.",
            }
        )
        return None


def _nip_from_cell(
    value: Any,
    *,
    row: int,
    errors: list[dict[str, Any]],
) -> str | None:
    if pd.isna(value):
        errors.append({"row": row, "column": "nip", "message": "NIP wajib diisi."})
        return None
    try:
        if isinstance(value, (int, np.integer)):
            text = str(int(value))
        elif isinstance(value, (float, np.floating)):
            number = float(value)
            if not math.isfinite(number) or not number.is_integer():
                raise ValueError
            text = str(int(number))
        else:
            text = str(value).strip().lstrip("'").replace(" ", "")
            if text.endswith(".0"):
                text = text[:-2]
        if not NIP_PATTERN.fullmatch(text):
            raise ValueError
        return text
    except (ValueError, TypeError):
        errors.append(
            {
                "row": row,
                "column": "nip",
                "message": "NIP harus berupa 8-30 digit angka.",
            }
        )
        return None


# ---------------------------------------------------------------------------
# CRUD pos potongan
# ---------------------------------------------------------------------------

@router.get("/pos", response_model=list[PosPotonganResponse])
def list_pos(
    opd_id: int | None = Query(None, description="Khusus super admin"),
    db: Session = Depends(get_db),
    current_user: UserProfile = Depends(get_current_user),
) -> list[PosPotonganResponse]:
    opd = _resolve_opd(db, current_user, opd_id)
    rows = db.scalars(
        select(RefPosPotongan)
        .where(RefPosPotongan.opd_id == opd.id)
        .order_by(RefPosPotongan.kategori, RefPosPotongan.nama_pos)
    ).all()
    return [_pos_response(pos, opd) for pos in rows]


@router.post(
    "/pos",
    response_model=PosPotonganResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_pos(
    payload: PosPotonganCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserProfile = Depends(get_current_user),
) -> PosPotonganResponse:
    opd = _resolve_opd(db, current_user, payload.opd_id)
    nama = payload.nama_pos.strip()
    if not nama:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Nama pos potongan wajib diisi.",
        )

    duplicate = db.scalar(
        select(RefPosPotongan.id).where(
            RefPosPotongan.opd_id == opd.id,
            func.lower(func.trim(RefPosPotongan.nama_pos)) == nama.lower(),
        )
    )
    if duplicate is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Nama pos potongan sudah ada pada OPD ini.",
        )

    pos = RefPosPotongan(
        opd_id=opd.id,
        nama_pos=nama,
        kategori=payload.kategori,
        is_active=payload.is_active,
    )
    db.add(pos)
    db.flush()
    _audit(
        db,
        current_user,
        action="CREATE_POS_POTONGAN",
        table_name="ref_pos_potongan",
        record_id=str(pos.id),
        details={
            "pos_id": pos.id,
            "nama_pos": pos.nama_pos,
            "kategori": pos.kategori,
            "opd": opd.nmskpd.strip(),
        },
        request=request,
    )
    db.commit()
    db.refresh(pos)
    return _pos_response(pos, opd)


@router.patch("/pos/{pos_id}", response_model=PosPotonganResponse)
def update_pos(
    pos_id: int,
    payload: PosPotonganUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserProfile = Depends(get_current_user),
) -> PosPotonganResponse:
    opd = _resolve_opd(db, current_user, payload.opd_id)
    pos = _pos_or_404(db, pos_id, opd)

    changes: dict[str, Any] = {}
    if payload.nama_pos is not None:
        nama = payload.nama_pos.strip()
        if not nama:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Nama pos potongan wajib diisi.",
            )
        duplicate = db.scalar(
            select(RefPosPotongan.id).where(
                RefPosPotongan.opd_id == opd.id,
                RefPosPotongan.id != pos.id,
                func.lower(func.trim(RefPosPotongan.nama_pos)) == nama.lower(),
            )
        )
        if duplicate is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Nama pos potongan sudah ada pada OPD ini.",
            )
        if pos.nama_pos != nama:
            changes["nama_pos"] = [pos.nama_pos, nama]
            pos.nama_pos = nama
    if payload.kategori is not None and pos.kategori != payload.kategori:
        changes["kategori"] = [pos.kategori, payload.kategori]
        pos.kategori = payload.kategori
    if payload.is_active is not None and bool(pos.is_active) != payload.is_active:
        changes["is_active"] = [bool(pos.is_active), payload.is_active]
        pos.is_active = payload.is_active

    if changes:
        _audit(
            db,
            current_user,
            action="UPDATE_POS_POTONGAN",
            table_name="ref_pos_potongan",
            record_id=str(pos.id),
            details={"pos_id": pos.id, "changes": changes, "opd": opd.nmskpd.strip()},
            request=request,
        )
        db.commit()
        db.refresh(pos)

    return _pos_response(pos, opd)


@router.delete("/pos/{pos_id}", response_model=PosPotonganResponse)
def deactivate_pos(
    pos_id: int,
    request: Request,
    opd_id: int | None = Query(None, description="Khusus super admin"),
    db: Session = Depends(get_db),
    current_user: UserProfile = Depends(get_current_user),
) -> PosPotonganResponse:
    opd = _resolve_opd(db, current_user, opd_id)
    pos = _pos_or_404(db, pos_id, opd)
    if pos.is_active:
        pos.is_active = False
        _audit(
            db,
            current_user,
            action="DEACTIVATE_POS_POTONGAN",
            table_name="ref_pos_potongan",
            record_id=str(pos.id),
            details={"pos_id": pos.id, "nama_pos": pos.nama_pos, "opd": opd.nmskpd.strip()},
            request=request,
        )
        db.commit()
        db.refresh(pos)
    return _pos_response(pos, opd)


# ---------------------------------------------------------------------------
# Pinjaman berjangka
# ---------------------------------------------------------------------------

@router.get("/berjangka", response_model=list[BerjangkaResponse])
def list_berjangka(
    period: str | None = Query(
        None,
        pattern=r"^\d{4}-\d{2}$",
        description="Progress dihitung untuk periode ini; default bulan berjalan",
    ),
    nip: str | None = Query(None, min_length=1, max_length=30),
    active_only: bool = Query(True),
    opd_id: int | None = Query(None, description="Khusus super admin"),
    db: Session = Depends(get_db),
    current_user: UserProfile = Depends(get_current_user),
) -> list[BerjangkaResponse]:
    opd = _resolve_opd(db, current_user, opd_id)
    period_date = _validate_period(
        period or f"{date.today().year:04d}-{date.today().month:02d}"
    )

    nip_rows = db.scalars(
        select(PayrollMonthly.nip)
        .where(_opd_clause(opd))
        .distinct()
    ).all()
    opd_nips = {row for row in nip_rows if row}
    if not opd_nips:
        return []

    if nip is not None:
        nip = _clean_nip(nip)
        if nip not in opd_nips:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="NIP tidak terdaftar pada OPD Anda.",
            )

    statement = select(PotonganBerjangka).where(PotonganBerjangka.nip.in_(opd_nips))
    if nip is not None:
        statement = statement.where(PotonganBerjangka.nip == nip)
    if active_only:
        statement = statement.where(PotonganBerjangka.end_period >= period_date)
    statement = statement.order_by(
        PotonganBerjangka.start_period.desc(),
        PotonganBerjangka.created_at.desc(),
    )
    loans = db.scalars(statement).all()
    if not loans:
        return []

    name_rows = db.execute(
        select(PayrollMonthly.nip, PayrollMonthly.nama)
        .where(PayrollMonthly.nip.in_(opd_nips))
        .order_by(PayrollMonthly.tglgaji.desc())
    ).all()
    name_by_nip: dict[str, str] = {}
    for employee_nip, employee_name in name_rows:
        name_by_nip.setdefault(employee_nip, employee_name)

    pos_ids = {loan.pos_id for loan in loans}
    pos_by_id = {
        pos.id: pos
        for pos in db.scalars(select(RefPosPotongan).where(RefPosPotongan.id.in_(pos_ids))).all()
    }

    return [
        _loan_response(
            loan,
            nama=name_by_nip.get(loan.nip),
            pos=pos_by_id.get(loan.pos_id),
            opd=opd,
            period=period_date,
        )
        for loan in loans
    ]


@router.post(
    "/berjangka",
    response_model=BerjangkaResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_berjangka(
    payload: BerjangkaCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserProfile = Depends(get_current_user),
) -> BerjangkaResponse:
    opd = _resolve_opd(db, current_user, payload.opd_id)
    pos = _pos_or_404(db, payload.pos_id, opd)
    if not pos.is_active:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Pos potongan tidak aktif.",
        )
    if pos.kategori != "berjangka":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Pos potongan harus berkategori berjangka.",
        )

    nip = _clean_nip(payload.nip)
    payroll = _payroll_for_nip(db, nip, opd)
    if payroll is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="NIP belum terdaftar pada data payroll OPD ini.",
        )

    start_period = _validate_period(payload.start_period, "start_period")
    try:
        nominal = quantize_money(payload.nominal_per_bulan)
        end_period = calculate_end_period(start_period, payload.tenor_bulan)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc

    loan = PotonganBerjangka(
        nip=nip,
        pos_id=pos.id,
        nominal_per_bulan=nominal,
        start_period=start_period,
        tenor_bulan=payload.tenor_bulan,
        end_period=end_period,
        keterangan=payload.keterangan,
        created_by=current_user.email,
    )
    db.add(loan)
    db.flush()
    _audit(
        db,
        current_user,
        action="CREATE_POTONGAN_BERJANGKA",
        table_name="potongan_berjangka",
        record_id=str(loan.id),
        details={
            "nip": nip,
            "pos_id": pos.id,
            "pos_nama": pos.nama_pos,
            "nominal_per_bulan": str(nominal),
            "start_period": period_str(start_period),
            "end_period": period_str(end_period),
            "tenor_bulan": payload.tenor_bulan,
            "opd": opd.nmskpd.strip(),
        },
        request=request,
    )
    db.commit()
    db.refresh(loan)
    return _loan_response(
        loan,
        nama=payroll.nama,
        pos=pos,
        opd=opd,
        period=start_period,
    )


@router.post(
    "/berjangka/generate",
    response_model=GenerateBerjangkaResponse,
)
def generate_berjangka(
    payload: GenerateBerjangkaRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserProfile = Depends(get_current_user),
) -> GenerateBerjangkaResponse:
    opd = _resolve_opd(db, current_user, payload.opd_id)
    period = _validate_period(payload.period)

    counts = generate_for_period(db, period, current_user.email, opd.nmskpd.strip())
    _audit(
        db,
        current_user,
        action="GENERATE_POTONGAN_BERJANGKA",
        table_name="payroll_potongan_item",
        record_id=None,
        details={
            "period": period_str(period),
            "opd": opd.nmskpd.strip(),
            **counts,
        },
        request=request,
    )
    db.commit()
    return GenerateBerjangkaResponse(
        period=period_str(period),
        opd=opd.nmskpd.strip(),
        generated=counts["generated"],
        updated=counts["updated"],
        skipped=counts["skipped"],
    )


# ---------------------------------------------------------------------------
# Import potongan manual bulanan
# ---------------------------------------------------------------------------

@router.post(
    "/import-excel",
    response_model=ManualPotonganImportResponse,
)
def import_potongan_excel(
    request: Request,
    file: UploadFile = File(..., description="File Excel berisi kolom nip dan nominal"),
    pos_id: int = Form(...),
    period: str = Form(..., description="Periode YYYY-MM"),
    opd_id: int | None = Form(None, description="Khusus super admin"),
    db: Session = Depends(get_db),
    current_user: UserProfile = Depends(get_current_user),
) -> ManualPotonganImportResponse:
    opd = _resolve_opd(db, current_user, opd_id)
    period_date = _validate_period(period)
    pos = _pos_or_404(db, pos_id, opd)
    if not pos.is_active:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Pos potongan tidak aktif.",
        )
    if pos.kategori != "bulanan":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Import manual hanya untuk pos potongan bulanan.",
        )

    filename = Path((file.filename or "potongan.xlsx").replace("\\", "/")).name
    suffix = Path(filename).suffix.lower()
    if suffix not in {".xls", ".xlsx"}:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Format file harus .xls atau .xlsx.",
        )

    settings = get_settings()
    content = file.file.read(settings.max_upload_bytes + 1)
    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File upload kosong.",
        )
    if len(content) > settings.max_upload_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Ukuran file melebihi batas upload.",
        )

    try:
        frame = pd.read_excel(
            io.BytesIO(content),
            sheet_name=0,
            dtype=object,
            engine="xlrd" if suffix == ".xls" else "openpyxl",
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File Excel tidak dapat dibaca. Pastikan file tidak rusak.",
        ) from exc

    frame.columns = [
        str(column).replace("\ufeff", "").strip().lower()
        for column in frame.columns
    ]
    missing = [column for column in ("nip", "nominal") if column not in frame.columns]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "message": "Kolom wajib tidak ditemukan: " + ", ".join(missing),
                "errors": [],
            },
        )

    frame.insert(0, "__row__", frame.index + 2)
    frame = frame.dropna(how="all", subset=["nip", "nominal"]).reset_index(drop=True)
    if frame.empty:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File Excel tidak memiliki baris data.",
        )
    if len(frame) > MAX_POTONGAN_ROWS:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Jumlah baris melebihi batas {MAX_POTONGAN_ROWS}.",
        )

    rows: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    seen: dict[str, int] = {}

    for _, source in frame.iterrows():
        row_number = int(source["__row__"])
        row_errors: list[dict[str, Any]] = []
        nip = _nip_from_cell(source["nip"], row=row_number, errors=row_errors)
        nominal = _money_from_cell(source["nominal"], row=row_number, errors=row_errors)
        if row_errors:
            errors.extend(row_errors)
            if len(errors) >= MAX_ERRORS:
                break
            continue
        if nip is None or nominal is None:
            continue
        if nip in seen:
            errors.append(
                {
                    "row": row_number,
                    "column": "nip",
                    "message": f"NIP duplikat dengan baris {seen[nip]}.",
                }
            )
            if len(errors) >= MAX_ERRORS:
                break
            continue
        seen[nip] = row_number
        rows.append({"nip": nip, "nominal": nominal, "row": row_number})

    if errors:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "message": f"File ditolak: {len(errors)} kesalahan validasi.",
                "errors": errors[:MAX_ERRORS],
            },
        )

    payroll_rows = db.scalars(
        select(PayrollMonthly).where(
            PayrollMonthly.tglgaji >= period_date,
            PayrollMonthly.tglgaji < add_months(period_date, 1),
            _opd_clause(opd),
        )
    ).all()
    payroll_by_nip = {payroll.nip: payroll for payroll in payroll_rows}

    missing_nips = [row for row in rows if row["nip"] not in payroll_by_nip]
    if missing_nips:
        errors = [
            {
                "row": row["row"],
                "column": "nip",
                "message": (
                    f"NIP {row['nip']} tidak terdaftar pada payroll OPD "
                    f"periode {period_str(period_date)}."
                ),
            }
            for row in missing_nips[:MAX_ERRORS]
        ]
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "message": "Terdapat NIP yang tidak termasuk OPD/periode ini.",
                "errors": errors,
            },
        )

    inserted = 0
    updated = 0
    for row in rows:
        payroll = payroll_by_nip[row["nip"]]
        existing = db.scalar(
            select(PayrollPotonganItem).where(
                PayrollPotonganItem.nip == row["nip"],
                PayrollPotonganItem.period == period_date,
                PayrollPotonganItem.pos_id == pos.id,
                PayrollPotonganItem.berjangka_id.is_(None),
            )
        )
        if existing is not None:
            existing.payroll_id = payroll.id
            existing.nominal = row["nominal"]
            existing.created_by = current_user.email
            updated += 1
        else:
            db.add(
                PayrollPotonganItem(
                    payroll_id=payroll.id,
                    nip=row["nip"],
                    period=period_date,
                    pos_id=pos.id,
                    berjangka_id=None,
                    cicilan_ke=None,
                    nominal=row["nominal"],
                    created_by=current_user.email,
                )
            )
            inserted += 1

    _audit(
        db,
        current_user,
        action="IMPORT_POTONGAN_MANUAL",
        table_name="payroll_potongan_item",
        record_id=None,
        details={
            "filename": filename,
            "pos_id": pos.id,
            "pos_nama": pos.nama_pos,
            "period": period_str(period_date),
            "opd": opd.nmskpd.strip(),
            "total_rows": len(rows),
            "inserted": inserted,
            "updated": updated,
        },
        request=request,
    )
    db.commit()

    return ManualPotonganImportResponse(
        filename=filename,
        pos=pos.nama_pos,
        period=period_str(period_date),
        opd=opd.nmskpd.strip(),
        total_rows=len(rows),
        inserted=inserted,
        updated=updated,
        warnings=[],
    )


# ---------------------------------------------------------------------------
# Item potongan manual perorangan (CRUD item)
# ---------------------------------------------------------------------------

@router.post(
    "/item",
    response_model=PotonganItemResponse,
    status_code=status.HTTP_200_OK,
    summary="Tambah atau perbarui potongan bulanan manual perorangan",
)
def create_or_update_potongan_item(
    request: Request,
    payload: PotonganItemCreate,
    db: Session = Depends(get_db),
    current_user: UserProfile = Depends(get_current_user),
) -> PotonganItemResponse:
    opd = _resolve_opd(db, current_user, payload.opd_id)
    period_date = _validate_period(payload.period)
    pos = _pos_or_404(db, payload.pos_id, opd)
    if not pos.is_active:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Pos potongan tidak aktif.",
        )
    if pos.kategori != "bulanan":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Input potongan perorangan langsung hanya untuk pos kategori bulanan.",
        )

    next_month = add_months(period_date, 1)
    payroll = db.scalar(
        select(PayrollMonthly).where(
            PayrollMonthly.nip == payload.nip,
            PayrollMonthly.tglgaji >= period_date,
            PayrollMonthly.tglgaji < next_month,
            _opd_clause(opd),
        ).limit(1)
    )
    if payroll is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Pegawai dengan NIP {payload.nip} tidak ditemukan pada payroll OPD {opd.nmskpd} periode {payload.period}.",
        )

    existing = db.scalar(
        select(PayrollPotonganItem).where(
            PayrollPotonganItem.nip == payload.nip,
            PayrollPotonganItem.period == period_date,
            PayrollPotonganItem.pos_id == pos.id,
            PayrollPotonganItem.berjangka_id.is_(None),
        )
    )

    action = "UPDATE_POTONGAN_MANUAL_ITEM" if existing else "CREATE_POTONGAN_MANUAL_ITEM"
    if existing:
        existing.payroll_id = payroll.id
        existing.nominal = payload.nominal
        existing.created_by = current_user.email
        item = existing
    else:
        item = PayrollPotonganItem(
            payroll_id=payroll.id,
            nip=payload.nip,
            period=period_date,
            pos_id=pos.id,
            berjangka_id=None,
            cicilan_ke=None,
            nominal=payload.nominal,
            created_by=current_user.email,
        )
        db.add(item)
    db.flush()

    _audit(
        db,
        current_user,
        action=action,
        table_name="payroll_potongan_item",
        record_id=str(item.id),
        details={
            "item_id": str(item.id),
            "nip": payload.nip,
            "period": payload.period,
            "pos_id": pos.id,
            "pos_nama": pos.nama_pos,
            "nominal": str(payload.nominal),
            "opd": opd.nmskpd.strip(),
        },
        request=request,
    )
    db.commit()

    return PotonganItemResponse(
        id=str(item.id),
        nip=item.nip,
        period=period_str(item.period),
        pos_id=pos.id,
        pos_nama=pos.nama_pos,
        nominal=item.nominal,
        created_by=item.created_by,
    )


@router.delete(
    "/item/{item_id}",
    response_model=PotonganItemDeleteResponse,
    status_code=status.HTTP_200_OK,
    summary="Hapus item potongan bulanan manual",
)
def delete_potongan_item(
    item_id: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserProfile = Depends(get_current_user),
) -> PotonganItemDeleteResponse:
    try:
        uid = uuid.UUID(item_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Format ID potongan tidak valid (harus UUID).",
        )

    item = db.get(PayrollPotonganItem, uid)
    if item is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Item potongan tidak ditemukan.",
        )

    if item.berjangka_id is not None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Potongan cicilan berjangka tidak dapat dihapus per item. Kelola pinjaman melalui menu pinjaman berjangka.",
        )

    pos = db.get(RefPosPotongan, item.pos_id)
    if pos is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Pos potongan tidak ditemukan.",
        )

    if current_user.role != "super_admin":
        if pos.opd_id != current_user.opd_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Anda tidak memiliki hak akses untuk menghapus potongan OPD lain.",
            )

    _audit(
        db,
        current_user,
        action="DELETE_POTONGAN_MANUAL_ITEM",
        table_name="payroll_potongan_item",
        record_id=str(item.id),
        details={
            "item_id": str(item.id),
            "nip": item.nip,
            "period": period_str(item.period),
            "pos_id": pos.id,
            "pos_nama": pos.nama_pos,
            "nominal": str(item.nominal),
        },
        request=request,
    )

    db.delete(item)
    db.commit()

    return PotonganItemDeleteResponse(
        status="success",
        message="Item potongan manual berhasil dihapus.",
        deleted_id=str(uid),
    )


@router.get("/rekap-bulanan", response_model=RekapBulananResponse)
def get_rekap_bulanan(
    period: str = Query(..., description="Periode YYYY-MM"),
    opd_id: int | None = Query(None, description="Khusus super admin"),
    db: Session = Depends(get_db),
    current_user: UserProfile = Depends(get_current_user),
) -> RekapBulananResponse:
    opd = _resolve_opd(db, current_user, opd_id)
    period_date = _validate_period(period)
    next_month = add_months(period_date, 1)

    pos_list = db.scalars(
        select(RefPosPotongan)
        .where(
            RefPosPotongan.opd_id == opd.id,
            RefPosPotongan.kategori == "bulanan",
        )
        .order_by(RefPosPotongan.nama_pos)
    ).all()

    items: list[PosBulananRekapItem] = []
    grand_total = Decimal("0.00")
    pos_ids = [p.id for p in pos_list]

    if pos_ids:
        agg_stmt = (
            select(
                PayrollPotonganItem.pos_id,
                func.count(func.distinct(PayrollPotonganItem.nip)).label("cnt"),
                func.coalesce(func.sum(PayrollPotonganItem.nominal), 0).label("total"),
            )
            .where(
                PayrollPotonganItem.period >= period_date,
                PayrollPotonganItem.period < next_month,
                PayrollPotonganItem.berjangka_id.is_(None),
                PayrollPotonganItem.pos_id.in_(pos_ids),
            )
            .group_by(PayrollPotonganItem.pos_id)
        )
        agg_map = {row.pos_id: (row.cnt, row.total) for row in db.execute(agg_stmt).all()}

        total_pegawai = (
            db.scalar(
                select(func.count(func.distinct(PayrollPotonganItem.nip))).where(
                    PayrollPotonganItem.period >= period_date,
                    PayrollPotonganItem.period < next_month,
                    PayrollPotonganItem.berjangka_id.is_(None),
                    PayrollPotonganItem.pos_id.in_(pos_ids),
                )
            )
            or 0
        )
    else:
        agg_map = {}
        total_pegawai = 0

    for pos in pos_list:
        cnt, total = agg_map.get(pos.id, (0, Decimal("0.00")))
        total_dec = Decimal(str(total)).quantize(CENT)
        grand_total += total_dec
        items.append(
            PosBulananRekapItem(
                pos_id=pos.id,
                nama_pos=pos.nama_pos,
                kategori=pos.kategori,
                is_active=bool(pos.is_active),
                jumlah_pegawai=cnt,
                total_nominal=total_dec,
            )
        )

    return RekapBulananResponse(
        period=period_str(period_date),
        opd_id=opd.id,
        opd_nama=opd.nmskpd.strip(),
        total_pos=len(items),
        total_pegawai=total_pegawai,
        total_nominal=grand_total.quantize(CENT),
        items=items,
    )


@router.get("/rekap-bulanan/{pos_id}", response_model=PosBulananDetailResponse)
def get_rekap_bulanan_detail(
    pos_id: int,
    period: str = Query(..., description="Periode YYYY-MM"),
    opd_id: int | None = Query(None, description="Khusus super admin"),
    db: Session = Depends(get_db),
    current_user: UserProfile = Depends(get_current_user),
) -> PosBulananDetailResponse:
    opd = _resolve_opd(db, current_user, opd_id)
    period_date = _validate_period(period)
    next_month = add_months(period_date, 1)
    pos = _pos_or_404(db, pos_id, opd)

    stmt = (
        select(
            PayrollPotonganItem.id,
            PayrollPotonganItem.nip,
            func.coalesce(PayrollMonthly.nama, "—").label("nama"),
            PayrollPotonganItem.nominal,
            PayrollPotonganItem.created_at,
        )
        .outerjoin(
            PayrollMonthly,
            (PayrollMonthly.nip == PayrollPotonganItem.nip)
            & (PayrollMonthly.tglgaji >= period_date)
            & (PayrollMonthly.tglgaji < next_month)
            & _opd_clause(opd),
        )
        .where(
            PayrollPotonganItem.pos_id == pos.id,
            PayrollPotonganItem.period >= period_date,
            PayrollPotonganItem.period < next_month,
            PayrollPotonganItem.berjangka_id.is_(None),
        )
        .order_by(PayrollPotonganItem.nominal.desc(), PayrollPotonganItem.nip)
    )
    rows = db.execute(stmt).all()

    total_nominal = sum((Decimal(str(r.nominal)) for r in rows), Decimal("0.00")).quantize(CENT)
    detail_items = [
        PosBulananDetailItem(
            id=str(r.id),
            nip=r.nip,
            nama=r.nama,
            nominal=Decimal(str(r.nominal)).quantize(CENT),
            created_at=r.created_at,
        )
        for r in rows
    ]

    return PosBulananDetailResponse(
        pos_id=pos.id,
        nama_pos=pos.nama_pos,
        period=period_str(period_date),
        opd_nama=opd.nmskpd.strip(),
        total_pegawai=len(detail_items),
        total_nominal=total_nominal,
        items=detail_items,
    )
