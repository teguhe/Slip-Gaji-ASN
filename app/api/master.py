"""Endpoint Master Data: Master OPD dan Master Pengguna (Super Admin only)."""

from __future__ import annotations

import io
import logging
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

import pandas as pd
from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import UserProfile, get_current_user
from app.config import get_settings
from app.db import get_db
from app.models import AppUser, PayrollMonthly, RefOpd, RefPosPotongan
from app.schemas import (
    MasterOpdCreate,
    MasterOpdImportResponse,
    MasterOpdItem,
    MasterOpdPrintLogRequest,
    MasterOpdUpdate,
    MasterUserCreate,
    MasterUserItem,
    MasterUserPrintLogRequest,
    MasterUserUpdate,
)
from app.services.audit import extract_client_ip, write_audit

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/master", tags=["Master Data"])


def _assert_super_admin(user: UserProfile) -> None:
    if user.role != "super_admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Hanya Super Admin yang diizinkan mengakses modul Master Data.",
        )


# ===========================================================================
# MASTER OPD
# ===========================================================================

@router.get("/opd", response_model=list[MasterOpdItem], summary="Daftar Master OPD")
def list_master_opd(
    db: Session = Depends(get_db),
    current_user: UserProfile = Depends(get_current_user),
) -> list[MasterOpdItem]:
    _assert_super_admin(current_user)
    opds = db.scalars(
        select(RefOpd).order_by(func.lower(func.trim(RefOpd.nmskpd)))
    ).all()
    result: list[MasterOpdItem] = []
    for opd in opds:
        user_count = db.scalar(
            select(func.count(AppUser.id)).where(AppUser.opd_id == opd.id)
        ) or 0
        payroll_count = db.scalar(
            select(func.count(PayrollMonthly.id)).where(
                func.lower(func.trim(PayrollMonthly.nmskpd))
                == func.lower(func.trim(opd.nmskpd))
            )
        ) or 0
        result.append(
            MasterOpdItem(
                id=opd.id,
                nmskpd=opd.nmskpd,
                created_at=opd.created_at,
                user_count=user_count,
                payroll_count=payroll_count,
            )
        )
    return result


@router.post(
    "/opd",
    response_model=MasterOpdItem,
    status_code=status.HTTP_201_CREATED,
    summary="Tambah Master OPD Baru",
)
def create_master_opd(
    payload: MasterOpdCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserProfile = Depends(get_current_user),
) -> MasterOpdItem:
    _assert_super_admin(current_user)
    name = " ".join(payload.nmskpd.replace("\xa0", " ").split())
    norm = name.casefold()

    existing = [
        opd
        for opd in db.scalars(select(RefOpd)).all()
        if " ".join(opd.nmskpd.replace("\xa0", " ").split()).casefold() == norm
    ]
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"OPD '{existing[0].nmskpd}' sudah terdaftar.",
        )

    new_opd = RefOpd(nmskpd=name)
    db.add(new_opd)
    db.flush()

    write_audit(
        db,
        actor_email=current_user.email,
        action="CREATE_MASTER_OPD",
        table_name="ref_opd",
        record_id=str(new_opd.id),
        details={"nmskpd": new_opd.nmskpd},
        ip_address=extract_client_ip(request),
    )
    db.commit()
    db.refresh(new_opd)

    return MasterOpdItem(
        id=new_opd.id,
        nmskpd=new_opd.nmskpd,
        created_at=new_opd.created_at,
        user_count=0,
        payroll_count=0,
    )


@router.patch(
    "/opd/{opd_id}",
    response_model=MasterOpdItem,
    summary="Ubah Nama Master OPD",
)
def update_master_opd(
    opd_id: int,
    payload: MasterOpdUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserProfile = Depends(get_current_user),
) -> MasterOpdItem:
    _assert_super_admin(current_user)
    opd = db.get(RefOpd, opd_id)
    if not opd:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="OPD tidak ditemukan.",
        )

    old_name = opd.nmskpd
    new_name = " ".join(payload.nmskpd.replace("\xa0", " ").split())
    norm_new = new_name.casefold()

    existing = [
        o
        for o in db.scalars(select(RefOpd)).all()
        if o.id != opd_id
        and " ".join(o.nmskpd.replace("\xa0", " ").split()).casefold() == norm_new
    ]
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"OPD lain dengan nama '{existing[0].nmskpd}' sudah ada.",
        )

    opd.nmskpd = new_name

    # Sinkronkan nmskpd pada baris payroll_monthly agar data histori tetap konsisten
    db.query(PayrollMonthly).filter(
        func.lower(func.trim(PayrollMonthly.nmskpd))
        == func.lower(func.trim(old_name))
    ).update({"nmskpd": new_name}, synchronize_session=False)

    write_audit(
        db,
        actor_email=current_user.email,
        action="UPDATE_MASTER_OPD",
        table_name="ref_opd",
        record_id=str(opd.id),
        details={"old_name": old_name, "new_name": new_name},
        ip_address=extract_client_ip(request),
    )
    db.commit()
    db.refresh(opd)

    user_count = db.scalar(
        select(func.count(AppUser.id)).where(AppUser.opd_id == opd.id)
    ) or 0
    payroll_count = db.scalar(
        select(func.count(PayrollMonthly.id)).where(
            func.lower(func.trim(PayrollMonthly.nmskpd))
            == func.lower(func.trim(opd.nmskpd))
        )
    ) or 0

    return MasterOpdItem(
        id=opd.id,
        nmskpd=opd.nmskpd,
        created_at=opd.created_at,
        user_count=user_count,
        payroll_count=payroll_count,
    )


@router.delete(
    "/opd/{opd_id}",
    status_code=status.HTTP_200_OK,
    summary="Hapus Master OPD",
)
def delete_master_opd(
    opd_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserProfile = Depends(get_current_user),
) -> dict[str, Any]:
    _assert_super_admin(current_user)
    opd = db.get(RefOpd, opd_id)
    if not opd:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="OPD tidak ditemukan.",
        )

    payroll_count = db.scalar(
        select(func.count(PayrollMonthly.id)).where(
            func.lower(func.trim(PayrollMonthly.nmskpd))
            == func.lower(func.trim(opd.nmskpd))
        )
    ) or 0
    if payroll_count > 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Tidak dapat menghapus OPD '{opd.nmskpd}' karena masih terdapat "
                f"{payroll_count} baris data gaji/payroll terkait."
            ),
        )

    user_count = db.scalar(
        select(func.count(AppUser.id)).where(AppUser.opd_id == opd.id)
    ) or 0
    if user_count > 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Tidak dapat menghapus OPD '{opd.nmskpd}' karena masih ada "
                f"{user_count} pengguna yang ditugaskan ke OPD ini."
            ),
        )

    pos_count = db.scalar(
        select(func.count(RefPosPotongan.id)).where(RefPosPotongan.opd_id == opd.id)
    ) or 0
    if pos_count > 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Tidak dapat menghapus OPD '{opd.nmskpd}' karena masih ada "
                f"{pos_count} pos potongan terdaftar."
            ),
        )

    deleted_name = opd.nmskpd
    db.delete(opd)
    write_audit(
        db,
        actor_email=current_user.email,
        action="DELETE_MASTER_OPD",
        table_name="ref_opd",
        record_id=str(opd_id),
        details={"nmskpd": deleted_name},
        ip_address=extract_client_ip(request),
    )
    db.commit()
    return {"status": "success", "message": f"OPD '{deleted_name}' berhasil dihapus."}


@router.post(
    "/opd/import",
    response_model=MasterOpdImportResponse,
    summary="Import Daftar Master OPD dari File Excel (1 Kolom)",
)
def import_master_opd(
    request: Request,
    file: UploadFile = File(..., description="File Excel berisi daftar nama OPD (.xlsx/.xls)"),
    db: Session = Depends(get_db),
    current_user: UserProfile = Depends(get_current_user),
) -> MasterOpdImportResponse:
    _assert_super_admin(current_user)

    filename = Path((file.filename or "opd.xlsx").replace("\\", "/")).name
    suffix = Path(filename).suffix.lower()
    if suffix not in {".xls", ".xlsx"}:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Format file harus berkas Excel (.xls atau .xlsx).",
        )

    settings = get_settings()
    content = file.file.read(settings.max_upload_bytes + 1)
    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Berkas upload kosong.",
        )
    if len(content) > settings.max_upload_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Ukuran berkas melebihi batas upload.",
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
            detail="Berkas Excel tidak dapat dibaca. Pastikan format berkas valid.",
        ) from exc

    if frame.empty and len(frame.columns) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Berkas Excel tidak memuat data.",
        )

    header_blacklist = {
        "nmskpd",
        "nama opd",
        "nama_opd",
        "opd",
        "skpd",
        "nama skpd",
        "nama_skpd",
        "nama",
        "organisasi perangkat daerah",
    }

    candidates: list[str] = []
    # Periksa apakah header kolom pertama adalah nama OPD atau nama kolom generik
    first_col_raw = str(frame.columns[0]).replace("\ufeff", "").strip()
    if first_col_raw.casefold() not in header_blacklist and len(first_col_raw) >= 3:
        candidates.append(first_col_raw)

    # Ambil baris pada kolom pertama
    for val in frame.iloc[:, 0].dropna():
        s = str(val).replace("\ufeff", "").strip()
        if s and s.casefold() not in header_blacklist and len(s) >= 3:
            candidates.append(s)

    if not candidates:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Tidak ditemukan data nama OPD yang valid di dalam berkas Excel.",
        )

    all_existing_opds = db.scalars(select(RefOpd)).all()
    existing_norms = {
        " ".join(opd.nmskpd.replace("\xa0", " ").split()).casefold()
        for opd in all_existing_opds
    }

    imported_count = 0
    skipped_count = 0
    seen_in_batch: set[str] = set()

    for raw in candidates:
        clean_name = " ".join(raw.replace("\xa0", " ").split())
        if len(clean_name) < 3:
            continue
        norm = clean_name.casefold()
        if norm in existing_norms or norm in seen_in_batch:
            skipped_count += 1
        else:
            db.add(RefOpd(nmskpd=clean_name))
            existing_norms.add(norm)
            seen_in_batch.add(norm)
            imported_count += 1

    if imported_count > 0:
        db.commit()

    write_audit(
        db,
        actor_email=current_user.email,
        action="IMPORT_MASTER_OPD",
        table_name="ref_opd",
        record_id=None,
        details={
            "filename": filename,
            "total_rows": len(candidates),
            "imported": imported_count,
            "skipped": skipped_count,
        },
        ip_address=extract_client_ip(request),
    )
    db.commit()

    return MasterOpdImportResponse(
        status="success",
        message=f"Import OPD selesai: {imported_count} OPD baru ditambahkan, {skipped_count} OPD dilewati (sudah ada).",
        total_rows=len(candidates),
        imported=imported_count,
        skipped=skipped_count,
    )


@router.post(
    "/opd/print-log",
    summary="Catat log pencetakan daftar OPD",
)
def log_print_master_opd(
    payload: MasterOpdPrintLogRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserProfile = Depends(get_current_user),
) -> dict[str, Any]:
    _assert_super_admin(current_user)
    admin_name = current_user.display_name or current_user.nama_bendahara or current_user.email
    print_time_str = payload.print_date or datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    details: dict[str, Any] = {
        "printed_by": admin_name,
        "admin_email": current_user.email,
        "total_opd": payload.total_opd,
        "print_date": print_time_str,
        "title": payload.title or "Daftar OPD Pemerintah Daerah",
    }
    write_audit(
        db,
        actor_email=current_user.email,
        action="PRINT_OPD_REPORT",
        table_name="ref_opd",
        record_id=None,
        details=details,
        ip_address=extract_client_ip(request),
    )
    db.commit()
    return {
        "status": "success",
        "message": "Log pencetakan master OPD berhasil dicatat.",
    }



# ===========================================================================
# MASTER PENGGUNA (USERS)
# ===========================================================================

@router.get("/users", response_model=list[MasterUserItem], summary="Daftar Master Pengguna")
def list_master_users(
    db: Session = Depends(get_db),
    current_user: UserProfile = Depends(get_current_user),
) -> list[MasterUserItem]:
    _assert_super_admin(current_user)
    settings = get_settings()
    users = db.scalars(select(AppUser).order_by(AppUser.created_at)).all()
    result: list[MasterUserItem] = []
    for u in users:
        opd = db.get(RefOpd, u.opd_id) if u.opd_id else None
        is_default = (u.email.strip().lower() == settings.super_admin_email)
        result.append(
            MasterUserItem(
                id=str(u.id),
                email=u.email,
                display_name=u.display_name,
                role=u.role,
                opd_id=u.opd_id,
                opd_name=opd.nmskpd if opd else None,
                is_active=u.is_active,
                is_default_super_admin=is_default,
                created_at=u.created_at,
                updated_at=u.updated_at,
            )
        )
    return result


@router.post(
    "/users",
    response_model=MasterUserItem,
    status_code=status.HTTP_201_CREATED,
    summary="Tambah Pengguna Baru (Bendahara OPD)",
)
def create_master_user(
    payload: MasterUserCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserProfile = Depends(get_current_user),
) -> MasterUserItem:
    _assert_super_admin(current_user)
    email_norm = payload.email.strip().lower()
    if not email_norm or "@" not in email_norm or "." not in email_norm:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Format alamat email tidak valid.",
        )

    existing = db.scalar(
        select(AppUser).where(func.lower(func.trim(AppUser.email)) == email_norm)
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Pengguna dengan email '{email_norm}' sudah terdaftar.",
        )

    opd = db.get(RefOpd, payload.opd_id)
    if not opd:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="OPD yang dipilih tidak ditemukan.",
        )

    display_name = payload.display_name.strip() if payload.display_name else None
    new_user = AppUser(
        email=email_norm,
        display_name=display_name,
        role="bendahara_opd",
        opd_id=opd.id,
        is_active=True,
    )
    db.add(new_user)
    db.flush()

    write_audit(
        db,
        actor_email=current_user.email,
        action="CREATE_USER_MANAGEMENT",
        table_name="app_users",
        record_id=str(new_user.id),
        details={
            "email": new_user.email,
            "role": new_user.role,
            "opd_id": opd.id,
            "nmskpd": opd.nmskpd,
        },
        ip_address=extract_client_ip(request),
    )
    db.commit()
    db.refresh(new_user)

    settings = get_settings()
    is_default = (new_user.email.strip().lower() == settings.super_admin_email)

    return MasterUserItem(
        id=str(new_user.id),
        email=new_user.email,
        display_name=new_user.display_name,
        role=new_user.role,
        opd_id=new_user.opd_id,
        opd_name=opd.nmskpd,
        is_active=new_user.is_active,
        is_default_super_admin=is_default,
        created_at=new_user.created_at,
        updated_at=new_user.updated_at,
    )


@router.patch(
    "/users/{user_id}",
    response_model=MasterUserItem,
    summary="Kelola Role, OPD & Status Pengguna",
)
def update_master_user(
    user_id: str,
    payload: MasterUserUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserProfile = Depends(get_current_user),
) -> MasterUserItem:
    _assert_super_admin(current_user)
    settings = get_settings()

    try:
        uid = uuid.UUID(user_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ID Pengguna tidak valid.",
        )

    u = db.get(AppUser, uid)
    if not u:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Pengguna tidak ditemukan.",
        )

    is_default = (u.email.strip().lower() == settings.super_admin_email)

    # Super Admin Lock: Akun super admin bawaan tidak boleh diturunkan atau dinonaktifkan
    if is_default:
        if payload.role and payload.role != "super_admin":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Super User bawaan ({settings.super_admin_email}) tidak dapat diturunkan role-nya.",
            )
        if payload.is_active is False:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Super User bawaan ({settings.super_admin_email}) tidak dapat dinonaktifkan.",
            )

    changes: dict[str, Any] = {}
    if payload.role is not None:
        changes["role_before"] = u.role
        changes["role_after"] = payload.role
        u.role = payload.role

    if payload.clear_opd:
        changes["opd_before"] = u.opd_id
        changes["opd_after"] = None
        u.opd_id = None
    elif payload.opd_id is not None:
        opd = db.get(RefOpd, payload.opd_id)
        if not opd:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="OPD yang dipilih tidak ditemukan.",
            )
        changes["opd_before"] = u.opd_id
        changes["opd_after"] = opd.id
        changes["opd_name"] = opd.nmskpd
        u.opd_id = opd.id

    if payload.is_active is not None and not is_default:
        changes["is_active_before"] = u.is_active
        changes["is_active_after"] = payload.is_active
        u.is_active = payload.is_active

    write_audit(
        db,
        actor_email=current_user.email,
        action="UPDATE_USER_MANAGEMENT",
        table_name="app_users",
        record_id=str(u.id),
        details={"target_email": u.email, "changes": changes},
        ip_address=extract_client_ip(request),
    )
    db.commit()
    db.refresh(u)

    opd = db.get(RefOpd, u.opd_id) if u.opd_id else None
    return MasterUserItem(
        id=str(u.id),
        email=u.email,
        display_name=u.display_name,
        role=u.role,
        opd_id=u.opd_id,
        opd_name=opd.nmskpd if opd else None,
        is_active=u.is_active,
        is_default_super_admin=is_default,
        created_at=u.created_at,
        updated_at=u.updated_at,
    )


@router.delete(
    "/users/{user_id}",
    status_code=status.HTTP_200_OK,
    summary="Hapus Pengguna (Super Admin only)",
)
def delete_master_user(
    user_id: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserProfile = Depends(get_current_user),
) -> dict[str, Any]:
    _assert_super_admin(current_user)
    settings = get_settings()

    try:
        uid = uuid.UUID(user_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ID Pengguna tidak valid.",
        )

    u = db.get(AppUser, uid)
    if not u:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Pengguna tidak ditemukan.",
        )

    # Hard Security Constraint: Super User bawaan tidak boleh dihapus
    if u.email.strip().lower() == settings.super_admin_email:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Super User bawaan ({settings.super_admin_email}) tidak dapat dihapus.",
        )

    deleted_email = u.email
    db.delete(u)
    write_audit(
        db,
        actor_email=current_user.email,
        action="DELETE_USER_MANAGEMENT",
        table_name="app_users",
        record_id=str(uid),
        details={"deleted_email": deleted_email},
        ip_address=extract_client_ip(request),
    )
    db.commit()
    return {
        "status": "success",
        "message": f"Pengguna '{deleted_email}' berhasil dihapus dari sistem.",
    }


@router.post(
    "/users/print-log",
    summary="Catat log pencetakan daftar pengguna",
)
def log_print_master_users(
    payload: MasterUserPrintLogRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserProfile = Depends(get_current_user),
) -> dict[str, Any]:
    _assert_super_admin(current_user)
    admin_name = current_user.display_name or current_user.nama_bendahara or current_user.email
    print_time_str = payload.print_date or datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    details: dict[str, Any] = {
        "printed_by": admin_name,
        "admin_email": current_user.email,
        "total_users": payload.total_users,
        "filter_role": payload.filter_role or "all",
        "filter_status": payload.filter_status or "all",
        "print_date": print_time_str,
        "title": payload.title or "Daftar Pengguna Sistem",
    }
    write_audit(
        db,
        actor_email=current_user.email,
        action="PRINT_USERS_REPORT",
        table_name="app_users",
        record_id=None,
        details=details,
        ip_address=extract_client_ip(request),
    )
    db.commit()
    return {
        "status": "success",
        "message": "Log pencetakan master pengguna berhasil dicatat.",
    }

