"""Endpoint payroll: import SIMGAJI, slip individual, dan rekap OPD."""

from __future__ import annotations

import logging
from decimal import Decimal
from pathlib import Path as FilePath

from fastapi import APIRouter, Depends, File, HTTPException, Path, Query, Request, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import AuthContext, UserProfile, get_auth_context, get_current_user
from app.config import get_settings
from app.constants import DEDUCTION_COLUMNS, INCOME_COLUMNS
from app.db import get_db
from app.models import (
    PayrollMonthly,
    PayrollPotonganItem,
    PotonganBerjangka,
    RefPosPotongan,
)
from app.schemas import (
    DashboardEmployee,
    DashboardSummaryResponse,
    DashboardTotals,
    ImportExcelResponse,
    PotonganDetail,
    SlipGajiResponse,
)
from app.services.audit import write_audit
from app.services.payroll_summary import load_payroll_summary
from app.services.periods import PeriodError, add_months, parse_period, period_str
from app.services.simgaji_import import SimgajiImportError, import_simgaji_excel
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

    ip_address = request.client.host if request.client else None

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
    ip_address = request.client.host if request.client else None

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
    ip_address = request.client.host if request.client else None

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

    penghasilan_kotor = payroll.kotor or ZERO
    potongan_simgaji = payroll.potongan or ZERO
    potongan_internal = sum((detail.nominal for detail in rincian), ZERO)
    total_potongan = potongan_simgaji + potongan_internal

    response = SlipGajiResponse(
        nip=payroll.nip,
        nama=payroll.nama,
        opd=payroll.nmskpd.strip(),
        periode=period_str(start_period),
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
