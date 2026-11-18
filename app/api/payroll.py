"""Endpoint payroll: import SIMGAJI dan pembacaan slip per NIP."""

from __future__ import annotations

import logging
from datetime import date
from decimal import Decimal
from pathlib import Path as FilePath

from fastapi import APIRouter, Depends, File, HTTPException, Path, Query, Request, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import AuthContext, UserProfile, get_auth_context, get_current_user
from app.config import get_settings
from app.db import get_db
from app.models import (
    PayrollMonthly,
    PayrollPotonganItem,
    PotonganBerjangka,
    RefPosPotongan,
)
from app.schemas import ImportExcelResponse, PotonganDetail, SlipGajiResponse
from app.services.simgaji_import import (
    SimgajiImportError,
    import_simgaji_excel,
    normalize_opd_name,
)

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
    "/{nip}",
    response_model=SlipGajiResponse,
    summary="Ambil data gaji & potongan ASN per periode",
)
def get_asn_payroll_by_period(
    nip: str = Path(..., pattern=r"^\d{1,30}$", description="NIP ASN"),
    period: str = Query(
        ...,
        pattern=r"^\d{4}-\d{2}$",
        description="Format YYYY-MM, contoh: 2026-10",
    ),
    db: Session = Depends(get_db),
    auth_ctx: AuthContext = Depends(get_auth_context),
) -> SlipGajiResponse:
    """Gabungkan payroll SIMGAJI dengan potongan internal bulanan/berjangka.

    Bendahara OPD hanya dapat membaca NIP milik OPD-nya. Untuk mencegah
    enumerasi data lintas OPD, NIP di luar OPD dikembalikan sebagai 404.
    """

    try:
        year, month = (int(part) for part in period.split("-"))
        start_period = date(year, month, 1)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Periode tidak valid. Gunakan format YYYY-MM.",
        ) from exc

    if month == 12:
        end_period = date(year + 1, 1, 1)
    else:
        end_period = date(year, month + 1, 1)

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

    not_found = HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Data gaji tidak ditemukan untuk NIP dan periode tersebut.",
    )
    if payroll is None:
        raise not_found

    if auth_ctx.kind == "user":
        user = auth_ctx.user
        if user is None:
            raise not_found
        if user.role != "super_admin":
            if (
                not user.opd_name
                or normalize_opd_name(user.opd_name)
                != normalize_opd_name(payroll.nmskpd)
            ):
                # 404 (bukan 403) agar keberadaan NIP lintas OPD tidak bocor.
                raise not_found

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
                pos_nama=pos.nama_pos,
                nominal=item.nominal or ZERO,
                keterangan=keterangan,
                cicilan_info=cicilan_info,
            )
        )

    penghasilan_kotor = payroll.kotor or ZERO
    potongan_simgaji = payroll.potongan or ZERO
    potongan_internal = sum((detail.nominal for detail in rincian), ZERO)
    total_potongan = potongan_simgaji + potongan_internal

    return SlipGajiResponse(
        nip=payroll.nip,
        nama=payroll.nama,
        opd=payroll.nmskpd.strip(),
        periode=period,
        penghasilan_kotor=penghasilan_kotor,
        potongan_simgaji=potongan_simgaji,
        potongan_internal=potongan_internal,
        total_potongan=total_potongan,
        take_home_pay=penghasilan_kotor - total_potongan,
        rincian_potongan_internal=rincian,
    )
