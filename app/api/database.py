"""Endpoint Manajemen Database: Backup, Restore, dan Pembersihan Data (Super Admin only)."""

from __future__ import annotations

import io
import json
import logging
import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile, status
from sqlalchemy import func, select, text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Session

from app.auth import UserProfile, get_current_user
from app.config import get_settings
from app.db import get_db
from app.models import (
    AppUser,
    AuditLog,
    PayrollMonthly,
    PayrollPenyesuaian,
    PayrollPotonganItem,
    PotonganBerjangka,
    RefOpd,
    RefPosPotongan,
)
from app.schemas import (
    DatabaseDeletePeriodRequest,
    DatabaseStatsResponse,
    DatabaseWipeRequest,
)
from app.services.audit import extract_client_ip, write_audit
from app.services.periods import add_months, parse_period

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/database", tags=["Database Management"])


def _assert_super_admin(user: UserProfile) -> None:
    if user.role != "super_admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Akses ditolak: Operasi ini hanya untuk Super Admin.",
        )


def _serialize_val(val: Any) -> Any:
    if isinstance(val, (datetime, date)):
        return val.isoformat()
    if isinstance(val, Decimal):
        return str(val)
    if isinstance(val, uuid.UUID):
        return str(val)
    return val


def _dump_table(db: Session, model: Any) -> list[dict[str, Any]]:
    rows = db.scalars(select(model)).all()
    result = []
    cols = model.__table__.columns
    for r in rows:
        row_dict = {}
        for c in cols:
            val = getattr(r, c.name)
            row_dict[c.name] = _serialize_val(val)
        result.append(row_dict)
    return result


def _deserialize_row(model: Any, data: dict[str, Any]) -> Any:
    cols = model.__table__.columns
    kwargs = {}
    for c in cols:
        if c.name in data:
            val = data[c.name]
            if val is not None:
                type_name = str(c.type).upper()
                if "TIMESTAMP" in type_name or "DATETIME" in type_name:
                    if isinstance(val, str):
                        try:
                            val = datetime.fromisoformat(val)
                        except ValueError:
                            pass
                elif "DATE" in type_name:
                    if isinstance(val, str):
                        try:
                            val = date.fromisoformat(val)
                        except ValueError:
                            pass
                elif "NUMERIC" in type_name or "DECIMAL" in type_name:
                    if isinstance(val, (str, int, float)):
                        val = Decimal(str(val))
                elif isinstance(c.type, PG_UUID) or "UUID" in type_name:
                    if isinstance(val, str):
                        val = uuid.UUID(val)
            kwargs[c.name] = val
    return model(**kwargs)


@router.get("/stats", response_model=DatabaseStatsResponse, summary="Statistik Jumlah Baris Database")
def get_database_stats(
    db: Session = Depends(get_db),
    current_user: UserProfile = Depends(get_current_user),
) -> DatabaseStatsResponse:
    _assert_super_admin(current_user)

    counts = {
        "ref_opd": db.scalar(select(func.count(RefOpd.id))) or 0,
        "app_users": db.scalar(select(func.count(AppUser.id))) or 0,
        "payroll_monthly": db.scalar(select(func.count(PayrollMonthly.id))) or 0,
        "ref_pos_potongan": db.scalar(select(func.count(RefPosPotongan.id))) or 0,
        "potongan_berjangka": db.scalar(select(func.count(PotonganBerjangka.id))) or 0,
        "payroll_potongan_item": db.scalar(select(func.count(PayrollPotonganItem.id))) or 0,
        "payroll_penyesuaian": db.scalar(select(func.count(PayrollPenyesuaian.id))) or 0,
        "audit_logs": db.scalar(select(func.count(AuditLog.id))) or 0,
    }
    total = sum(counts.values())
    return DatabaseStatsResponse(
        ref_opd=counts["ref_opd"],
        app_users=counts["app_users"],
        payroll_monthly=counts["payroll_monthly"],
        ref_pos_potongan=counts["ref_pos_potongan"],
        potongan_berjangka=counts["potongan_berjangka"],
        payroll_potongan_item=counts["payroll_potongan_item"],
        payroll_penyesuaian=counts["payroll_penyesuaian"],
        audit_logs=counts["audit_logs"],
        total_records=total,
    )


@router.get("/backup", summary="Unduh File Backup Database (JSON)")
def backup_database(
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserProfile = Depends(get_current_user),
) -> Response:
    _assert_super_admin(current_user)

    tables_data = {
        "ref_opd": _dump_table(db, RefOpd),
        "app_users": _dump_table(db, AppUser),
        "ref_pos_potongan": _dump_table(db, RefPosPotongan),
        "potongan_berjangka": _dump_table(db, PotonganBerjangka),
        "payroll_monthly": _dump_table(db, PayrollMonthly),
        "payroll_potongan_item": _dump_table(db, PayrollPotonganItem),
        "payroll_penyesuaian": _dump_table(db, PayrollPenyesuaian),
        "audit_logs": _dump_table(db, AuditLog),
    }

    counts = {k: len(v) for k, v in tables_data.items()}
    total_records = sum(counts.values())
    timestamp_str = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"backup_slipgaji_{timestamp_str}.json"

    backup_payload = {
        "app": "Aplikasi Penggajian dan Cetak Slip Gaji ASN",
        "version": "1.0.0",
        "backup_date": datetime.now().isoformat(),
        "created_by": current_user.email,
        "counts": counts,
        "total_records": total_records,
        "tables": tables_data,
    }

    json_bytes = json.dumps(backup_payload, ensure_ascii=False, indent=2).encode("utf-8")

    write_audit(
        db,
        actor_email=current_user.email,
        action="DATABASE_BACKUP",
        table_name="database",
        record_id=None,
        details={
            "filename": filename,
            "counts": counts,
            "total_records": sum(counts.values()),
        },
        ip_address=extract_client_ip(request),
    )
    db.commit()

    return Response(
        content=json_bytes,
        media_type="application/json",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Backup-Filename": filename,
        },
    )


@router.post("/restore", summary="Pulihkan (Restore) Database dari File Backup")
def restore_database(
    request: Request,
    file: UploadFile = File(..., description="File backup database JSON"),
    tables: str | None = Form(None, description="JSON string list kategori tabel yang ingin dipulihkan"),
    db: Session = Depends(get_db),
    current_user: UserProfile = Depends(get_current_user),
) -> dict[str, Any]:
    _assert_super_admin(current_user)
    settings = get_settings()

    filename = file.filename or "backup.json"
    content = file.file.read(settings.max_upload_bytes * 2)
    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Berkas backup kosong.",
        )

    try:
        data = json.loads(content.decode("utf-8"))
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Format berkas tidak valid atau bukan berkas JSON backup.",
        ) from exc

    if not isinstance(data, dict) or "tables" not in data:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Struktur berkas backup tidak sesuai spesifikasi.",
        )

    backup_tables = data["tables"]
    restored_counts: dict[str, int] = {}

    selected_categories: set[str] | None = None
    if tables:
        try:
            parsed = json.loads(tables)
            if isinstance(parsed, list) and parsed:
                selected_categories = set(parsed)
        except Exception:
            selected_categories = None

    try:
        # Bersihkan data lama dengan urutan aman relasi foreign key
        if selected_categories is None:
            db.query(PayrollPotonganItem).delete(synchronize_session=False)
            db.query(PayrollPenyesuaian).delete(synchronize_session=False)
            db.query(PotonganBerjangka).delete(synchronize_session=False)
            db.query(PayrollMonthly).delete(synchronize_session=False)
            db.query(RefPosPotongan).delete(synchronize_session=False)
            db.query(AppUser).delete(synchronize_session=False)
            db.query(RefOpd).delete(synchronize_session=False)
            db.query(AuditLog).delete(synchronize_session=False)
            db.flush()
        else:
            if "payroll" in selected_categories or "payroll_monthly" in selected_categories:
                db.query(PayrollPotonganItem).filter(PayrollPotonganItem.payroll_id.is_not(None)).delete(synchronize_session=False)
                db.query(PayrollMonthly).delete(synchronize_session=False)
            if "potongan" in selected_categories or "potongan_berjangka" in selected_categories:
                db.query(PayrollPotonganItem).filter(PayrollPotonganItem.berjangka_id.is_not(None)).delete(synchronize_session=False)
                db.query(PotonganBerjangka).delete(synchronize_session=False)
            if "penyesuaian" in selected_categories or "payroll_penyesuaian" in selected_categories:
                db.query(PayrollPenyesuaian).delete(synchronize_session=False)
            if "pos" in selected_categories or "ref_pos_potongan" in selected_categories:
                db.query(PayrollPotonganItem).delete(synchronize_session=False)
                db.query(PotonganBerjangka).delete(synchronize_session=False)
                db.query(RefPosPotongan).delete(synchronize_session=False)
            if "users" in selected_categories or "app_users" in selected_categories:
                sa_email = settings.super_admin_email
                db.query(AppUser).filter(func.lower(func.trim(AppUser.email)) != sa_email).delete(synchronize_session=False)
            if "opd" in selected_categories or "ref_opd" in selected_categories:
                db.query(AppUser).update({"opd_id": None}, synchronize_session=False)
                db.query(RefPosPotongan).delete(synchronize_session=False)
                db.query(PayrollPenyesuaian).delete(synchronize_session=False)
                db.query(RefOpd).delete(synchronize_session=False)
            if "audit" in selected_categories or "audit_logs" in selected_categories:
                db.query(AuditLog).delete(synchronize_session=False)
            db.flush()

        # Pulihkan data sesuai urutan relasi
        table_order = [
            ("ref_opd", RefOpd, lambda: selected_categories is None or "opd" in selected_categories or "ref_opd" in selected_categories),
            ("app_users", AppUser, lambda: selected_categories is None or "users" in selected_categories or "app_users" in selected_categories),
            ("ref_pos_potongan", RefPosPotongan, lambda: selected_categories is None or "pos" in selected_categories or "ref_pos_potongan" in selected_categories),
            ("potongan_berjangka", PotonganBerjangka, lambda: selected_categories is None or "potongan" in selected_categories or "potongan_berjangka" in selected_categories),
            ("payroll_monthly", PayrollMonthly, lambda: selected_categories is None or "payroll" in selected_categories or "payroll_monthly" in selected_categories),
            ("payroll_potongan_item", PayrollPotonganItem, lambda: selected_categories is None or "payroll" in selected_categories or "potongan" in selected_categories or "payroll_potongan_item" in selected_categories),
            ("payroll_penyesuaian", PayrollPenyesuaian, lambda: selected_categories is None or "penyesuaian" in selected_categories or "payroll_penyesuaian" in selected_categories),
            ("audit_logs", AuditLog, lambda: selected_categories is None or "audit" in selected_categories or "audit_logs" in selected_categories),
        ]

        for tbl_name, model_cls, should_restore in table_order:
            if not should_restore():
                continue
            tbl_rows = backup_tables.get(tbl_name, [])
            count = 0
            for row in tbl_rows:
                # Jika me-restore users secara parsial, hindari insert duplikat super admin bawaan yang sudah ada
                if tbl_name == "app_users" and selected_categories is not None:
                    email_val = (row.get("email") or "").strip().lower()
                    if email_val == settings.super_admin_email:
                        continue
                obj = _deserialize_row(model_cls, row)
                db.add(obj)
                count += 1
            db.flush()
            restored_counts[tbl_name] = count

        # Selalu pastikan Super Admin bawaan ada dan berstatus super_admin
        sa_email = settings.super_admin_email
        existing_sa = db.scalar(
            select(AppUser).where(func.lower(func.trim(AppUser.email)) == sa_email)
        )
        if not existing_sa:
            db.add(
                AppUser(
                    email=sa_email,
                    display_name="Super Admin Bawaan",
                    role="super_admin",
                    is_active=True,
                )
            )
        else:
            existing_sa.role = "super_admin"
            existing_sa.is_active = True

        # Sesuaikan kembali sequence PostgreSQL untuk ID serial jika ada
        try:
            db.execute(text("SELECT setval(pg_get_serial_sequence('ref_opd', 'id'), coalesce(max(id), 1)) FROM ref_opd;"))
            db.execute(text("SELECT setval(pg_get_serial_sequence('ref_pos_potongan', 'id'), coalesce(max(id), 1)) FROM ref_pos_potongan;"))
            db.execute(text("SELECT setval(pg_get_serial_sequence('audit_logs', 'id'), coalesce(max(id), 1)) FROM audit_logs;"))
        except Exception as seq_err:
            logger.warning("Gagal memperbarui sequence ID database: %s", seq_err)

        db.commit()
    except Exception as exc:
        db.rollback()
        logger.exception("Gagal memulihkan database: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Terjadi kesalahan saat memulihkan database: {exc}",
        ) from exc

    # Catat audit log setelah restore sukses
    write_audit(
        db,
        actor_email=current_user.email,
        action="DATABASE_RESTORE",
        table_name="database",
        record_id=None,
        details={
            "filename": filename,
            "selected_categories": list(selected_categories) if selected_categories else "all",
            "restored_counts": restored_counts,
            "total_restored": sum(restored_counts.values()),
        },
        ip_address=extract_client_ip(request),
    )
    db.commit()

    return {
        "status": "success",
        "message": f"Database berhasil dipulihkan dari '{filename}'. Total {sum(restored_counts.values())} data dipulihkan.",
        "restored_counts": restored_counts,
    }


@router.post("/wipe", summary="Hapus Data Keseluruhan Berdasarkan Checklist")
def wipe_database_tables(
    payload: DatabaseWipeRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserProfile = Depends(get_current_user),
) -> dict[str, Any]:
    _assert_super_admin(current_user)
    settings = get_settings()

    if not payload.confirmation:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Konfirmasi persetujuan penghapusan data diperlukan.",
        )

    if not payload.tables:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Pilih minimal 1 jenis data yang ingin dihapus.",
        )

    selected = set(payload.tables)
    deleted_counts: dict[str, int] = {}

    try:
        # 1. Payroll Potongan Items & Monthly
        if "payroll" in selected:
            c_items = db.query(PayrollPotonganItem).filter(PayrollPotonganItem.payroll_id.is_not(None)).delete(synchronize_session=False)
            c_payroll = db.query(PayrollMonthly).delete(synchronize_session=False)
            deleted_counts["payroll_monthly"] = c_payroll
            deleted_counts["payroll_potongan_item"] = c_items

        # 2. Potongan Berjangka
        if "potongan" in selected:
            # Delete child items first if not already deleted
            db.query(PayrollPotonganItem).filter(PayrollPotonganItem.berjangka_id.is_not(None)).delete(synchronize_session=False)
            c_berjangka = db.query(PotonganBerjangka).delete(synchronize_session=False)
            deleted_counts["potongan_berjangka"] = c_berjangka

        # 3. Penyesuaian Gaji
        if "penyesuaian" in selected:
            c_peny = db.query(PayrollPenyesuaian).delete(synchronize_session=False)
            deleted_counts["payroll_penyesuaian"] = c_peny

        # 4. Master Pos Potongan
        if "pos" in selected:
            # Pastikan item terkait sudah dihapus agar tidak terhalang RESTRICT
            db.query(PayrollPotonganItem).delete(synchronize_session=False)
            db.query(PotonganBerjangka).delete(synchronize_session=False)
            c_pos = db.query(RefPosPotongan).delete(synchronize_session=False)
            deleted_counts["ref_pos_potongan"] = c_pos

        # 5. Master Pengguna (Kecuali Super Admin bawaan)
        if "users" in selected:
            sa_email = settings.super_admin_email
            c_users = db.query(AppUser).filter(
                func.lower(func.trim(AppUser.email)) != sa_email
            ).delete(synchronize_session=False)
            deleted_counts["app_users"] = c_users

        # 6. Master OPD
        if "opd" in selected:
            # Putus hubungan opd_id di app_users
            db.query(AppUser).update({"opd_id": None}, synchronize_session=False)
            # Hapus pos dan penyesuaian jika masih ada
            db.query(RefPosPotongan).delete(synchronize_session=False)
            db.query(PayrollPenyesuaian).delete(synchronize_session=False)
            c_opd = db.query(RefOpd).delete(synchronize_session=False)
            deleted_counts["ref_opd"] = c_opd

        # 7. Audit Logs
        if "audit" in selected:
            c_audit = db.query(AuditLog).delete(synchronize_session=False)
            deleted_counts["audit_logs"] = c_audit

        db.commit()
    except Exception as exc:
        db.rollback()
        logger.exception("Gagal menghapus data: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Terjadi kesalahan saat menghapus data: {exc}",
        ) from exc

    # Catat audit log untuk aksi wipe data
    write_audit(
        db,
        actor_email=current_user.email,
        action="DATABASE_WIPE_SELECTED",
        table_name="database",
        record_id=None,
        details={
            "selected_categories": list(selected),
            "deleted_counts": deleted_counts,
            "total_deleted": sum(deleted_counts.values()),
        },
        ip_address=extract_client_ip(request),
    )
    db.commit()

    return {
        "status": "success",
        "message": f"Pembersihan data berhasil. Total {sum(deleted_counts.values())} baris data dihapus.",
        "deleted_counts": deleted_counts,
    }


@router.post("/delete-period", summary="Hapus Data Penggajian per OPD per Periode")
def delete_database_per_opd_period(
    payload: DatabaseDeletePeriodRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserProfile = Depends(get_current_user),
) -> dict[str, Any]:
    _assert_super_admin(current_user)

    opd_name = payload.target_opd
    period = payload.period.strip()

    if not opd_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Nama OPD wajib dipilih atau diisi.",
        )
    if not period:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Periode penggajian wajib dipilih.",
        )

    try:
        start_date = parse_period(period)
        end_date = add_months(start_date, 1)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Periode '{period}' tidak valid: {exc}",
        ) from exc

    is_all_opd = opd_name.upper() in ("ALL", "SEMUA", "SEMUA OPD", "*")

    deleted_payroll = 0
    deleted_potongan = 0
    deleted_penyesuaian = 0

    try:
        # 1. Hapus data Payroll SIMGAJI
        if payload.delete_payroll:
            payroll_stmt = select(PayrollMonthly.id).where(
                PayrollMonthly.tglgaji >= start_date,
                PayrollMonthly.tglgaji < end_date,
            )
            if not is_all_opd:
                payroll_stmt = payroll_stmt.where(
                    func.lower(func.trim(PayrollMonthly.nmskpd)) == func.lower(func.trim(opd_name))
                )
            payroll_ids = db.scalars(payroll_stmt).all()

            if payroll_ids:
                # CASCADE menghapus payroll_potongan_item terkait, tapi hapus eksplisit agar aman
                db.query(PayrollPotonganItem).filter(
                    PayrollPotonganItem.payroll_id.in_(payroll_ids)
                ).delete(synchronize_session=False)
                deleted_payroll = db.query(PayrollMonthly).filter(
                    PayrollMonthly.id.in_(payroll_ids)
                ).delete(synchronize_session=False)

        # 2. Hapus data Penyesuaian Gaji
        if payload.delete_penyesuaian:
            peny_query = db.query(PayrollPenyesuaian).filter(
                PayrollPenyesuaian.period == start_date
            )
            if not is_all_opd:
                opd = db.scalar(
                    select(RefOpd).where(
                        func.lower(func.trim(RefOpd.nmskpd)) == func.lower(func.trim(opd_name))
                    )
                )
                if opd:
                    peny_query = peny_query.filter(PayrollPenyesuaian.opd_id == opd.id)
                else:
                    peny_query = None

            if peny_query:
                deleted_penyesuaian = peny_query.delete(synchronize_session=False)

        # 3. Hapus data Potongan Lainnya pada periode ini
        if payload.delete_potongan:
            pot_query = db.query(PayrollPotonganItem).filter(
                PayrollPotonganItem.period == start_date
            )
            # Jika spesifik OPD, filter berdasarkan pos potongan milik OPD tersebut atau NIP payroll
            if not is_all_opd:
                opd = db.scalar(
                    select(RefOpd).where(
                        func.lower(func.trim(RefOpd.nmskpd)) == func.lower(func.trim(opd_name))
                    )
                )
                if opd:
                    pos_ids = db.scalars(
                        select(RefPosPotongan.id).where(RefPosPotongan.opd_id == opd.id)
                    ).all()
                    if pos_ids:
                        pot_query = pot_query.filter(PayrollPotonganItem.pos_id.in_(pos_ids))
                    else:
                        pot_query = None
                else:
                    pot_query = None

            if pot_query:
                deleted_potongan = pot_query.delete(synchronize_session=False)

        db.commit()
    except Exception as exc:
        db.rollback()
        logger.exception("Gagal menghapus data periode: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Terjadi kesalahan saat menghapus data periode: {exc}",
        ) from exc

    total_deleted = deleted_payroll + deleted_potongan + deleted_penyesuaian

    write_audit(
        db,
        actor_email=current_user.email,
        action="DATABASE_DELETE_PER_OPD_PERIOD",
        table_name="payroll_monthly",
        record_id=None,
        details={
            "opd_name": opd_name,
            "period": period,
            "deleted_payroll": deleted_payroll,
            "deleted_potongan": deleted_potongan,
            "deleted_penyesuaian": deleted_penyesuaian,
            "total_deleted": total_deleted,
        },
        ip_address=extract_client_ip(request),
    )
    db.commit()

    return {
        "status": "success",
        "message": (
            f"Penghapusan data periode {period} untuk OPD '{opd_name}' selesai. "
            f"Dihapus: {deleted_payroll} baris gaji, {deleted_potongan} potongan, {deleted_penyesuaian} penyesuaian."
        ),
        "deleted_payroll": deleted_payroll,
        "deleted_potongan": deleted_potongan,
        "deleted_penyesuaian": deleted_penyesuaian,
        "total_deleted": total_deleted,
    }
