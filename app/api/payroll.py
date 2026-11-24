"""Endpoint payroll: import SIMGAJI, slip individual, dan rekap OPD."""

from __future__ import annotations

import logging
import uuid
from decimal import Decimal
from pathlib import Path as FilePath
from typing import Any

import pandas as pd
from fastapi import APIRouter, Depends, File, HTTPException, Path, Query, Request, UploadFile, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import AuthContext, UserProfile, get_auth_context, get_current_user
from app.config import get_settings
from app.constants import DEDUCTION_COLUMNS, INCOME_COLUMNS, format_kdpangkat
from app.db import get_db
from app.models import (
    PayrollMonthly,
    PayrollPenyesuaian,
    PayrollPotonganItem,
    PotonganBerjangka,
    RefOpd,
    RefPosPotongan,
)
from app.schemas import (
    DashboardEmployee,
    DashboardPeriodRecap,
    DashboardSummaryResponse,
    DashboardTotals,
    ImportExcelResponse,
    InspectExcelResponse,
    MasterGajiPayrollRow,
    MasterGajiStatsResponse,
    PenyesuaianGajiCreate,
    PenyesuaianGajiItem,
    PotonganDetail,
    SlipGajiResponse,
)
from app.services.audit import extract_client_ip, write_audit
from app.services.payroll_summary import (
    format_period_label,
    load_payroll_period_recap,
    load_payroll_summary,
)
from app.services.periods import PeriodError, add_months, parse_period, period_str
from app.services.simgaji_import import (
    SimgajiImportError,
    _parse_date,
    _read_dataframe,
    import_simgaji_excel,
    normalize_opd_name,
)
from app.services.tenancy import assert_opd_access, resolve_opd_filter

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/payroll", tags=["Payroll"])

ZERO = Decimal("0.00")


@router.post(
    "/import-excel",
    response_model=ImportExcelResponse,
    status_code=status.HTTP_200_OK,
    summary="Import file SIMGAJI PNS (.xls/.xlsx)",
    responses={
        400: {"description": "File/kolom/baris tidak valid"},
        403: {"description": "OPD file tidak cocok dengan profil pengguna"},
        413: {"description": "Ukuran file atau jumlah baris melebihi batas"},
        415: {"description": "Format file bukan .xls/.xlsx"},
    },
)
def import_excel(
    request: Request,
    file: UploadFile = File(..., description="File Excel SIMGAJI PNS (.xls/.xlsx)"),
    db: Session = Depends(get_db),
    current_user: UserProfile = Depends(get_current_user),
) -> ImportExcelResponse:
    """Import 43 kolom SIMGAJI + nmskpd, lalu upsert berdasarkan (nip, tglgaji)."""

    raw_name = (file.filename or "").replace("\\", "/")
    filename = FilePath(raw_name).name
    suffix = FilePath(filename).suffix.lower()
    if suffix not in {".xls", ".xlsx"}:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Format file harus .xls atau .xlsx.",
        )

    settings = get_settings()
    try:
        content = file.file.read(settings.max_upload_bytes + 1)
    except OSError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File upload tidak dapat dibaca.",
        ) from exc

    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File upload kosong.",
        )
    if len(content) > settings.max_upload_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=(
                f"Ukuran file melebihi batas {settings.max_upload_bytes // (1024 * 1024)} MB."
            ),
        )

    ip_address = extract_client_ip(request)

    try:
        result = import_simgaji_excel(
            content=content,
            filename=filename,
            user=current_user,
            db=db,
            ip_address=ip_address,
        )
    except SimgajiImportError as exc:
        raise HTTPException(
            status_code=exc.http_status,
            detail={"message": exc.message, "errors": exc.errors},
        ) from exc
    except Exception as exc:
        logger.exception("Import SIMGAJI gagal untuk user %s", current_user.email)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Terjadi kesalahan internal saat memproses import.",
        ) from exc

    return ImportExcelResponse(**result)


@router.post(
    "/inspect-excel",
    response_model=InspectExcelResponse,
    status_code=status.HTTP_200_OK,
    summary="Inspeksi file Excel SIMGAJI sebelum import (baca kolom pertama tglgaji & nmskpd)",
    responses={
        400: {"description": "File tidak dapat dibaca atau kosong"},
        415: {"description": "Format file bukan .xls/.xlsx"},
        422: {"description": "Format tanggal atau kolom tidak valid"},
    },
)
def inspect_excel(
    file: UploadFile = File(..., description="File Excel SIMGAJI PNS (.xls/.xlsx)"),
    current_user: UserProfile = Depends(get_current_user),
) -> InspectExcelResponse:
    """Membaca file Excel secara aman, mendeteksi kolom pertama (tglgaji),
    mengekstrak data periode dan nmskpd untuk validasi awal sebelum diimport."""
    raw_name = (file.filename or "").replace("\\", "/")
    filename = FilePath(raw_name).name
    suffix = FilePath(filename).suffix.lower()
    if suffix not in {".xls", ".xlsx"}:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Format file harus .xls atau .xlsx.",
        )

    settings = get_settings()
    try:
        content = file.file.read(settings.max_upload_bytes + 1)
    except OSError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File upload tidak dapat dibaca.",
        ) from exc

    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File upload kosong.",
        )
    if len(content) > settings.max_upload_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Ukuran file melebihi batas {settings.max_upload_bytes // (1024 * 1024)} MB.",
        )

    try:
        df = _read_dataframe(content, filename)
    except SimgajiImportError as exc:
        raise HTTPException(
            status_code=exc.http_status,
            detail={"message": exc.message, "errors": exc.errors},
        ) from exc

    data_columns = [col for col in df.columns if col != "__row__"]
    first_col = data_columns[0] if data_columns else "tglgaji"

    parsed_date = None
    row_errors: list[dict[str, Any]] = []
    for _, row in df.iterrows():
        val = row.get("tglgaji")
        if val is not None and not pd.isna(val):
            parsed_date = _parse_date(val, int(row.get("__row__", 2)), row_errors)
            if parsed_date:
                break

    if not parsed_date:
        err_msg = row_errors[0]["message"] if row_errors else "Tidak ditemukan tanggal gaji yang valid pada kolom 'tglgaji'."
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Gagal mengekstrak data periode dari kolom 'tglgaji': {err_msg}",
        )

    period_str_val = f"{parsed_date.year:04d}-{parsed_date.month:02d}"
    period_label_val = format_period_label(period_str_val)

    opd_vals = [
        str(v).strip() for v in df["nmskpd"].dropna().unique() if str(v).strip()
    ]
    file_opd = opd_vals[0] if opd_vals else "—"

    is_match = True
    warning = None
    if current_user.role != "super_admin":
        if not current_user.opd_name:
            is_match = False
            warning = "Profil OPD akun login Anda belum diatur oleh Super Admin."
        else:
            user_opd_norm = normalize_opd_name(current_user.opd_name)
            file_opd_norm = normalize_opd_name(file_opd)
            is_match = (user_opd_norm == file_opd_norm)
            if not is_match:
                warning = f"OPD file ({file_opd}) tidak cocok dengan OPD akun Anda ({current_user.opd_name})."

    return InspectExcelResponse(
        status="success",
        filename=filename,
        first_column=first_col,
        period=period_str_val,
        period_label=period_label_val,
        opd=file_opd,
        total_rows=len(df),
        is_opd_match=is_match,
        user_opd=current_user.opd_name,
        warning=warning,
    )


@router.get(
    "/periods",
    response_model=DashboardPeriodRecap,
    summary="Daftar periode gaji yang tersedia untuk OPD dan rekapitulasi rentang waktu",
)
def get_available_periods(
    opd: str | None = Query(None, max_length=255),
    db: Session = Depends(get_db),
    current_user: UserProfile = Depends(get_current_user),
) -> DashboardPeriodRecap:
    filter_opd = resolve_opd_filter(current_user, opd)
    recap = load_payroll_period_recap(db, filter_opd)
    return DashboardPeriodRecap(**recap)


@router.get(
    "/opd/summary",
    response_model=DashboardSummaryResponse,
    summary="Rekap payroll seluruh ASN OPD per periode",
)
def get_opd_payroll_summary(
    request: Request,
    period: str = Query(
        ...,
        pattern=r"^\d{4}-\d{2}$",
        description="Format YYYY-MM, contoh: 2026-10",
    ),
    opd: str | None = Query(
        None,
        max_length=255,
        description="Khusus super admin / service token; bendahara selalu memakai OPD akun.",
    ),
    db: Session = Depends(get_db),
    auth_ctx: AuthContext = Depends(get_auth_context),
) -> DashboardSummaryResponse:
    try:
        start_period = parse_period(period)
    except PeriodError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Periode tidak valid: {exc}",
        ) from exc

    user = auth_ctx.user if auth_ctx.kind == "user" else None
    ip_address = extract_client_ip(request)

    try:
        filter_opd = resolve_opd_filter(user, opd)
    except HTTPException as exc:
        write_audit(
            db,
            actor_email=auth_ctx.actor_email,
            action="READ_PAYROLL_OPD_SUMMARY_DENIED",
            table_name="payroll_monthly",
            details={
                "period": period,
                "requested_opd": opd,
                "auth_method": auth_ctx.auth_method,
                "reason": "tenant_guard",
            },
            ip_address=ip_address,
        )
        raise exc

    employee_rows, total_rows = load_payroll_summary(
        db,
        start_period,
        add_months(start_period, 1),
        filter_opd,
    )
    response = DashboardSummaryResponse(
        period=period_str(start_period),
        opd=filter_opd or "Semua OPD",
        employees=[DashboardEmployee(**row) for row in employee_rows],
        totals=DashboardTotals(**total_rows),
    )

    write_audit(
        db,
        actor_email=auth_ctx.actor_email,
        action="READ_PAYROLL_OPD_SUMMARY",
        table_name="payroll_monthly",
        details={
            "period": response.period,
            "opd": response.opd,
            "count": len(employee_rows),
            "auth_method": auth_ctx.auth_method,
        },
        ip_address=ip_address,
    )
    return response


@router.get(
    "/stats",
    response_model=MasterGajiStatsResponse,
    summary="Statistik komprehensif data gaji per periode",
)
def get_payroll_stats(
    request: Request,
    period: str = Query(
        ...,
        pattern=r"^\d{4}-\d{2}$",
        description="Format YYYY-MM, contoh: 2026-10",
    ),
    opd: str | None = Query(None, max_length=255),
    db: Session = Depends(get_db),
    auth_ctx: AuthContext = Depends(get_auth_context),
) -> MasterGajiStatsResponse:
    try:
        start_period = parse_period(period)
    except PeriodError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Periode tidak valid: {exc}",
        ) from exc

    end_period = add_months(start_period, 1)
    user = auth_ctx.user if auth_ctx.kind == "user" else None
    filter_opd = resolve_opd_filter(user, opd)

    stmt = select(PayrollMonthly).where(
        PayrollMonthly.tglgaji >= start_period,
        PayrollMonthly.tglgaji < end_period,
    )
    if filter_opd:
        stmt = stmt.where(
            func.lower(func.trim(PayrollMonthly.nmskpd)) == filter_opd.strip().lower()
        )
    payroll_rows = db.scalars(stmt).all()

    total_pegawai = len(payroll_rows)
    total_gapok = ZERO
    total_kotor = ZERO
    total_potongan_simgaji = ZERO

    breakdown_tunjangan: dict[str, Decimal] = {col: ZERO for col in INCOME_COLUMNS}
    breakdown_potongan_resmi: dict[str, Decimal] = {col: ZERO for col in DEDUCTION_COLUMNS}

    for row in payroll_rows:
        total_gapok += row.gapok or ZERO
        total_kotor += row.kotor or ZERO
        total_potongan_simgaji += row.potongan or ZERO
        for col in INCOME_COLUMNS:
            breakdown_tunjangan[col] += getattr(row, col) or ZERO
        for col in DEDUCTION_COLUMNS:
            breakdown_potongan_resmi[col] += getattr(row, col) or ZERO

    total_tunjangan = total_kotor - total_gapok

    # Potongan internal
    total_potongan_internal = ZERO
    if payroll_rows:
        nips = [r.nip for r in payroll_rows]
        pot_stmt = select(func.coalesce(func.sum(PayrollPotonganItem.nominal), 0)).where(
            PayrollPotonganItem.period >= start_period,
            PayrollPotonganItem.period < end_period,
            PayrollPotonganItem.nip.in_(nips),
        )
        total_potongan_internal = Decimal(str(db.scalar(pot_stmt) or 0))

    # Penyesuaian gaji
    peny_stmt = select(func.coalesce(func.sum(PayrollPenyesuaian.nominal), 0)).where(
        PayrollPenyesuaian.period >= start_period,
        PayrollPenyesuaian.period < end_period,
    )
    if user and user.role != "super_admin" and user.opd_id:
        peny_stmt = peny_stmt.where(PayrollPenyesuaian.opd_id == user.opd_id)
    elif filter_opd:
        opd_obj = db.scalar(
            select(RefOpd).where(func.lower(func.trim(RefOpd.nmskpd)) == filter_opd.strip().lower())
        )
        if opd_obj:
            peny_stmt = peny_stmt.where(PayrollPenyesuaian.opd_id == opd_obj.id)

    total_penyesuaian = Decimal(str(db.scalar(peny_stmt) or 0))
    total_thp = total_kotor - total_potongan_simgaji - total_potongan_internal - total_penyesuaian

    return MasterGajiStatsResponse(
        period=period_str(start_period),
        opd=filter_opd or "Semua OPD",
        total_pegawai=total_pegawai,
        total_gapok=total_gapok,
        total_tunjangan=total_tunjangan,
        total_kotor=total_kotor,
        total_potongan_simgaji=total_potongan_simgaji,
        total_potongan_internal=total_potongan_internal,
        total_penyesuaian=total_penyesuaian,
        total_thp=total_thp,
        breakdown_tunjangan=breakdown_tunjangan,
        breakdown_potongan_resmi=breakdown_potongan_resmi,
    )


@router.get(
    "/monthly-list",
    response_model=list[MasterGajiPayrollRow],
    summary="Daftar gaji bulanan hasil import Excel dengan rincian potongan & penyesuaian",
)
def get_payroll_monthly_list(
    request: Request,
    period: str = Query(..., pattern=r"^\d{4}-\d{2}$"),
    opd: str | None = Query(None, max_length=255),
    db: Session = Depends(get_db),
    auth_ctx: AuthContext = Depends(get_auth_context),
) -> list[MasterGajiPayrollRow]:
    try:
        start_period = parse_period(period)
    except PeriodError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Periode tidak valid: {exc}",
        ) from exc

    end_period = add_months(start_period, 1)
    user = auth_ctx.user if auth_ctx.kind == "user" else None
    filter_opd = resolve_opd_filter(user, opd)

    stmt = select(PayrollMonthly).where(
        PayrollMonthly.tglgaji >= start_period,
        PayrollMonthly.tglgaji < end_period,
    )
    if filter_opd:
        stmt = stmt.where(
            func.lower(func.trim(PayrollMonthly.nmskpd)) == filter_opd.strip().lower()
        )
    stmt = stmt.order_by(PayrollMonthly.nama)
    payroll_rows = db.scalars(stmt).all()

    if not payroll_rows:
        return []

    nips = [r.nip for r in payroll_rows]

    # Map potongan internal per NIP
    pot_rows = db.execute(
        select(
            PayrollPotonganItem.nip,
            func.coalesce(func.sum(PayrollPotonganItem.nominal), 0),
        )
        .where(
            PayrollPotonganItem.period >= start_period,
            PayrollPotonganItem.period < end_period,
            PayrollPotonganItem.nip.in_(nips),
        )
        .group_by(PayrollPotonganItem.nip)
    ).all()
    pot_map = {nip: Decimal(str(tot or 0)) for nip, tot in pot_rows}

    # Map penyesuaian per NIP
    peny_rows = db.execute(
        select(
            PayrollPenyesuaian.nip,
            func.coalesce(func.sum(PayrollPenyesuaian.nominal), 0),
        )
        .where(
            PayrollPenyesuaian.period >= start_period,
            PayrollPenyesuaian.period < end_period,
            PayrollPenyesuaian.nip.in_(nips),
        )
        .group_by(PayrollPenyesuaian.nip)
    ).all()
    peny_map = {nip: Decimal(str(tot or 0)) for nip, tot in peny_rows}

    result = []
    for row in payroll_rows:
        kotor = row.kotor or ZERO
        gapok = row.gapok or ZERO
        pot_simgaji = row.potongan or ZERO
        pot_internal = pot_map.get(row.nip, ZERO)
        penyesuaian = peny_map.get(row.nip, ZERO)
        thp = kotor - pot_simgaji - pot_internal - penyesuaian
        total_tunjangan = kotor - gapok

        result.append(
            MasterGajiPayrollRow(
                id=str(row.id),
                nip=row.nip,
                nama=row.nama,
                kdpangkat=format_kdpangkat(row.kdpangkat),
                norek=row.norek,
                nmskpd=row.nmskpd.strip(),
                gapok=gapok,
                total_tunjangan=total_tunjangan,
                kotor=kotor,
                potongan_simgaji=pot_simgaji,
                potongan_internal=pot_internal,
                penyesuaian=penyesuaian,
                take_home_pay=thp,
            )
        )
    return result


@router.get(
    "/penyesuaian",
    response_model=list[PenyesuaianGajiItem],
    summary="Daftar penyesuaian gaji OPD per periode",
)
def get_penyesuaian_list(
    request: Request,
    period: str = Query(..., pattern=r"^\d{4}-\d{2}$"),
    db: Session = Depends(get_db),
    current_user: UserProfile = Depends(get_current_user),
) -> list[PenyesuaianGajiItem]:
    try:
        start_period = parse_period(period)
    except PeriodError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Periode tidak valid: {exc}",
        ) from exc

    end_period = add_months(start_period, 1)

    stmt = select(PayrollPenyesuaian).where(
        PayrollPenyesuaian.period >= start_period,
        PayrollPenyesuaian.period < end_period,
    )
    if current_user.role != "super_admin":
        if not current_user.opd_id:
            return []
        stmt = stmt.where(PayrollPenyesuaian.opd_id == current_user.opd_id)

    stmt = stmt.order_by(PayrollPenyesuaian.created_at.desc())
    items = db.scalars(stmt).all()
    return [
        PenyesuaianGajiItem(
            id=str(item.id),
            nip=item.nip,
            nama=item.nama,
            period=period_str(item.period),
            opd_id=item.opd_id,
            jenis_penyesuaian=item.jenis_penyesuaian,
            nominal=item.nominal,
            keterangan=item.keterangan,
            status=item.status,
            created_by=item.created_by,
            created_at=item.created_at,
        )
        for item in items
    ]


@router.post(
    "/penyesuaian",
    response_model=PenyesuaianGajiItem,
    status_code=status.HTTP_201_CREATED,
    summary="Input penyesuaian gaji (tunda bayar / retur rekening)",
)
def create_penyesuaian(
    request: Request,
    payload: PenyesuaianGajiCreate,
    db: Session = Depends(get_db),
    current_user: UserProfile = Depends(get_current_user),
) -> PenyesuaianGajiItem:
    if current_user.role != "super_admin" and not current_user.opd_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Profil OPD akun Anda belum diatur.",
        )

    try:
        start_period = parse_period(payload.period)
    except PeriodError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Periode tidak valid: {exc}",
        ) from exc

    end_period = add_months(start_period, 1)

    # Lookup nama pegawai dari payroll jika ada
    payroll_rec = db.scalar(
        select(PayrollMonthly).where(
            PayrollMonthly.nip == payload.nip.strip(),
            PayrollMonthly.tglgaji >= start_period,
            PayrollMonthly.tglgaji < end_period,
        ).limit(1)
    )

    nama_pegawai = payload.nama.strip() if payload.nama and payload.nama.strip() else None
    if payroll_rec:
        assert_opd_access(current_user, payroll_rec.nmskpd)
        if not nama_pegawai:
            nama_pegawai = payroll_rec.nama

    # Resolve target OPD ID
    target_opd_id = current_user.opd_id
    if current_user.role == "super_admin" and not target_opd_id and payroll_rec:
        opd_obj = db.scalar(
            select(RefOpd).where(
                func.lower(func.trim(RefOpd.nmskpd)) == payroll_rec.nmskpd.strip().lower()
            )
        )
        if opd_obj:
            target_opd_id = opd_obj.id

    penyesuaian = PayrollPenyesuaian(
        nip=payload.nip.strip(),
        nama=nama_pegawai,
        period=start_period,
        opd_id=target_opd_id,
        jenis_penyesuaian=payload.jenis_penyesuaian.strip(),
        nominal=payload.nominal,
        keterangan=payload.keterangan.strip() if payload.keterangan else None,
        status=payload.status.strip(),
        created_by=current_user.email,
    )
    db.add(penyesuaian)
    db.commit()
    db.refresh(penyesuaian)

    ip_address = extract_client_ip(request)
    write_audit(
        db,
        actor_email=current_user.email,
        action="CREATE_PENYESUAIAN_GAJI",
        table_name="payroll_penyesuaian",
        record_id=str(penyesuaian.id),
        details={
            "nip": penyesuaian.nip,
            "nama": penyesuaian.nama,
            "period": payload.period,
            "nominal": str(penyesuaian.nominal),
            "jenis": penyesuaian.jenis_penyesuaian,
        },
        ip_address=ip_address,
    )

    return PenyesuaianGajiItem(
        id=str(penyesuaian.id),
        nip=penyesuaian.nip,
        nama=penyesuaian.nama,
        period=period_str(penyesuaian.period),
        opd_id=penyesuaian.opd_id,
        jenis_penyesuaian=penyesuaian.jenis_penyesuaian,
        nominal=penyesuaian.nominal,
        keterangan=penyesuaian.keterangan,
        status=penyesuaian.status,
        created_by=penyesuaian.created_by,
        created_at=penyesuaian.created_at,
    )


@router.delete(
    "/penyesuaian/{penyesuaian_id}",
    summary="Hapus data penyesuaian gaji",
)
def delete_penyesuaian(
    request: Request,
    penyesuaian_id: str,
    db: Session = Depends(get_db),
    current_user: UserProfile = Depends(get_current_user),
) -> dict[str, str]:
    try:
        peny_uuid = uuid.UUID(penyesuaian_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ID penyesuaian tidak valid.",
        )

    penyesuaian = db.get(PayrollPenyesuaian, peny_uuid)
    if not penyesuaian:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Data penyesuaian tidak ditemukan.",
        )

    if current_user.role != "super_admin" and penyesuaian.opd_id != current_user.opd_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Anda tidak berhak menghapus penyesuaian OPD lain.",
        )

    db.delete(penyesuaian)
    db.commit()

    ip_address = extract_client_ip(request)
    write_audit(
        db,
        actor_email=current_user.email,
        action="DELETE_PENYESUAIAN_GAJI",
        table_name="payroll_penyesuaian",
        record_id=str(peny_uuid),
        details={"nip": penyesuaian.nip, "nominal": str(penyesuaian.nominal)},
        ip_address=ip_address,
    )

    return {"status": "success", "message": "Penyesuaian gaji berhasil dihapus."}


@router.get(
    "/{nip}",
    response_model=SlipGajiResponse,
    summary="Ambil data gaji & potongan ASN per periode",
)
def get_asn_payroll_by_period(
    request: Request,
    nip: str = Path(..., pattern=r"^\d{1,30}$", description="NIP ASN"),
    period: str = Query(
        ...,
        pattern=r"^\d{4}-\d{2}$",
        description="Format YYYY-MM, contoh: 2026-10",
    ),
    db: Session = Depends(get_db),
    auth_ctx: AuthContext = Depends(get_auth_context),
) -> SlipGajiResponse:
    """Gabungkan payroll SIMGAJI dengan seluruh potongan internal periode.

    Bendahara OPD hanya boleh membaca NIP OPD-nya sendiri. Pelanggaran
    lintas OPD mengembalikan HTTP 403 dan dicatat ke audit log.
    """

    try:
        start_period = parse_period(period)
    except PeriodError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Periode tidak valid: {exc}",
        ) from exc

    end_period = add_months(start_period, 1)
    ip_address = extract_client_ip(request)

    payroll = db.scalar(
        select(PayrollMonthly)
        .where(
            PayrollMonthly.nip == nip,
            PayrollMonthly.tglgaji >= start_period,
            PayrollMonthly.tglgaji < end_period,
        )
        .order_by(PayrollMonthly.tglgaji.desc())
        .limit(1)
    )
    if payroll is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Data gaji tidak ditemukan untuk NIP dan periode tersebut.",
        )

    user = auth_ctx.user if auth_ctx.kind == "user" else None
    try:
        assert_opd_access(user, payroll.nmskpd)
    except HTTPException as exc:
        write_audit(
            db,
            actor_email=auth_ctx.actor_email,
            action="READ_PAYROLL_DENIED",
            table_name="payroll_monthly",
            record_id=str(payroll.id),
            details={
                "nip": nip,
                "period": period,
                "opd": payroll.nmskpd.strip(),
                "auth_method": auth_ctx.auth_method,
                "reason": "cross_tenant",
            },
            ip_address=ip_address,
        )
        raise exc

    item_rows = db.execute(
        select(PayrollPotonganItem, RefPosPotongan)
        .join(RefPosPotongan, PayrollPotonganItem.pos_id == RefPosPotongan.id)
        .where(
            PayrollPotonganItem.nip == nip,
            PayrollPotonganItem.period >= start_period,
            PayrollPotonganItem.period < end_period,
        )
        .order_by(RefPosPotongan.nama_pos)
    ).all()

    rincian: list[PotonganDetail] = []
    for item, pos in item_rows:
        keterangan = None
        cicilan_info = None
        if item.berjangka_id:
            berjangka = db.get(PotonganBerjangka, item.berjangka_id)
            if berjangka is not None:
                keterangan = berjangka.keterangan
                if item.cicilan_ke and berjangka.tenor_bulan:
                    cicilan_info = (
                        f"Cicilan {item.cicilan_ke} dari {berjangka.tenor_bulan}"
                    )
        rincian.append(
            PotonganDetail(
                id=str(item.id),
                pos_nama=pos.nama_pos,
                nominal=item.nominal or ZERO,
                keterangan=keterangan,
                cicilan_info=cicilan_info,
                kategori="berjangka" if item.berjangka_id else "bulanan",
            )
        )

    opd = db.scalar(
        select(RefOpd).where(
            func.lower(func.trim(RefOpd.nmskpd)) == payroll.nmskpd.strip().lower()
        )
    )
    if opd:
        all_pos = db.scalars(
            select(RefPosPotongan)
            .where(
                RefPosPotongan.opd_id == opd.id,
                RefPosPotongan.is_active.is_(True),
            )
            .order_by(RefPosPotongan.id)
        ).all()
        present_pos_ids = {pos.id for _, pos in item_rows}
        for pos in all_pos:
            if pos.id not in present_pos_ids:
                rincian.append(
                    PotonganDetail(
                        id=f"pos-{pos.id}",
                        pos_nama=pos.nama_pos,
                        nominal=ZERO,
                        keterangan=None,
                        cicilan_info=None,
                        kategori=pos.kategori,
                    )
                )

    penghasilan_kotor = payroll.kotor or ZERO
    potongan_simgaji = payroll.potongan or ZERO
    potongan_internal = sum((detail.nominal for detail in rincian), ZERO)
    total_potongan = potongan_simgaji + potongan_internal

    peny_items = db.scalars(
        select(PayrollPenyesuaian)
        .where(
            PayrollPenyesuaian.nip == payroll.nip,
            PayrollPenyesuaian.period == start_period,
        )
        .order_by(PayrollPenyesuaian.created_at)
    ).all()
    rincian_penyesuaian = [
        PenyesuaianGajiItem(
            id=str(item.id),
            nip=item.nip,
            nama=item.nama,
            period=period_str(item.period),
            opd_id=item.opd_id,
            jenis_penyesuaian=item.jenis_penyesuaian,
            nominal=item.nominal,
            keterangan=item.keterangan,
            status=item.status,
            created_by=item.created_by,
            created_at=item.created_at,
        )
        for item in peny_items
    ]

    response = SlipGajiResponse(
        nip=payroll.nip,
        nama=payroll.nama,
        opd=payroll.nmskpd.strip(),
        periode=period_str(start_period),
        kdpangkat=format_kdpangkat(payroll.kdpangkat),
        norek=payroll.norek,
        penghasilan_kotor=penghasilan_kotor,
        potongan_simgaji=potongan_simgaji,
        potongan_internal=potongan_internal,
        total_potongan=total_potongan,
        take_home_pay=penghasilan_kotor - total_potongan,
        rincian_penghasilan={
            column: (getattr(payroll, column) or ZERO) for column in INCOME_COLUMNS
        },
        rincian_potongan_simgaji={
            column: (getattr(payroll, column) or ZERO) for column in DEDUCTION_COLUMNS
        },
        rincian_potongan_internal=rincian,
        rincian_penyesuaian=rincian_penyesuaian,
    )

    write_audit(
        db,
        actor_email=auth_ctx.actor_email,
        action="READ_PAYROLL",
        table_name="payroll_monthly",
        record_id=str(payroll.id),
        details={
            "nip": nip,
            "period": response.periode,
            "opd": response.opd,
            "internal_item_count": len(rincian),
            "auth_method": auth_ctx.auth_method,
        },
        ip_address=ip_address,
    )
    return response
