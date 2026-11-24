"""Endpoint profil, onboarding OPD, dan pergantian OPD aktif."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import UserProfile, get_current_user
from app.db import get_db
from app.models import AppUser, RefOpd
from app.schemas import (
    AuthMeResponse,
    CreateOpdRequest,
    OpdOptionResponse,
    SetOpdRequest,
    SettingsResponse,
    UpdateSettingsRequest,
)
from app.services.audit import extract_client_ip, write_audit

router = APIRouter(prefix="/api/v1/auth", tags=["Auth"])


def _me_response(profile: UserProfile, *, auth_method: str = "firebase") -> AuthMeResponse:
    return AuthMeResponse(
        email=profile.email,
        display_name=profile.display_name,
        role=profile.role,
        is_super_admin=profile.role == "super_admin",
        opd_id=profile.opd_id,
        opd_name=profile.opd_name,
        needs_opd=(profile.role != "super_admin") and not (profile.opd_id and profile.opd_name),
        auth_method=auth_method,
        jabatan=profile.jabatan or "Bendahara Pengeluaran",
        nama_bendahara=profile.nama_bendahara,
        nip_bendahara=profile.nip_bendahara,
        photo_url=profile.photo_url,
    )


def _load_app_user(db: Session, email: str) -> AppUser:
    user = db.scalar(
        select(AppUser)
        .where(func.lower(func.trim(AppUser.email)) == email.strip().lower())
        .order_by(AppUser.created_at)
        .limit(1)
    )
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Profil pengguna tidak ditemukan.",
        )
    return user


@router.get("/me", response_model=AuthMeResponse)
def get_me(
    db: Session = Depends(get_db),
    current_user: UserProfile = Depends(get_current_user),
) -> AuthMeResponse:
    user = db.scalar(
        select(AppUser)
        .where(func.lower(func.trim(AppUser.email)) == current_user.email.strip().lower())
        .order_by(AppUser.created_at)
        .limit(1)
    )
    if user:
        return AuthMeResponse(
            email=current_user.email,
            display_name=user.display_name or current_user.display_name,
            role=current_user.role,
            is_super_admin=current_user.role == "super_admin",
            opd_id=current_user.opd_id,
            opd_name=current_user.opd_name,
            needs_opd=(current_user.role != "super_admin") and not (current_user.opd_id and current_user.opd_name),
            auth_method="firebase",
            jabatan=user.jabatan or "Bendahara Pengeluaran",
            nama_bendahara=user.nama_bendahara,
            nip_bendahara=user.nip_bendahara,
            photo_url=current_user.photo_url,
        )
    return _me_response(current_user)


@router.get("/settings", response_model=SettingsResponse)
def get_user_settings(
    db: Session = Depends(get_db),
    current_user: UserProfile = Depends(get_current_user),
) -> SettingsResponse:
    user = _load_app_user(db, current_user.email)
    return SettingsResponse(
        jabatan=user.jabatan or "Bendahara Pengeluaran",
        nama_bendahara=user.nama_bendahara or user.display_name,
        nip_bendahara=user.nip_bendahara,
    )


@router.put("/settings", response_model=SettingsResponse)
def update_user_settings(
    payload: UpdateSettingsRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserProfile = Depends(get_current_user),
) -> SettingsResponse:
    user = _load_app_user(db, current_user.email)
    user.jabatan = (payload.jabatan or "Bendahara Pengeluaran").strip() or "Bendahara Pengeluaran"
    user.nama_bendahara = payload.nama_bendahara.strip() if payload.nama_bendahara and payload.nama_bendahara.strip() else None
    user.nip_bendahara = payload.nip_bendahara.strip() if payload.nip_bendahara and payload.nip_bendahara.strip() else None
    db.flush()
    write_audit(
        db,
        actor_email=current_user.email,
        action="UPDATE_SETTINGS",
        table_name="app_users",
        record_id=str(user.id),
        details={
            "jabatan": user.jabatan,
            "nama_bendahara": user.nama_bendahara,
            "nip_bendahara": user.nip_bendahara,
        },
        ip_address=extract_client_ip(request),
    )
    db.commit()
    return SettingsResponse(
        jabatan=user.jabatan,
        nama_bendahara=user.nama_bendahara,
        nip_bendahara=user.nip_bendahara,
    )


@router.get("/opd-options", response_model=list[OpdOptionResponse])
def list_opd_options(
    db: Session = Depends(get_db),
    current_user: UserProfile = Depends(get_current_user),
) -> list[OpdOptionResponse]:
    rows = db.scalars(select(RefOpd).order_by(RefOpd.nmskpd)).all()
    return [OpdOptionResponse(id=opd.id, nmskpd=opd.nmskpd) for opd in rows]


@router.post("/opd", response_model=OpdOptionResponse, status_code=status.HTTP_201_CREATED)
def create_opd(
    payload: CreateOpdRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserProfile = Depends(get_current_user),
) -> OpdOptionResponse:
    """Daftarkan OPD baru (hanya Super Admin)."""

    if current_user.role != "super_admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Hanya Super Admin yang diizinkan mendaftarkan OPD baru.",
        )
    name = payload.nmskpd.strip()
    norm = " ".join(name.replace("\xa0", " ").split()).casefold()
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
        action="CREATE_OPD",
        table_name="ref_opd",
        record_id=str(new_opd.id),
        details={"nmskpd": new_opd.nmskpd},
        ip_address=extract_client_ip(request),
    )
    db.commit()
    db.refresh(new_opd)
    return OpdOptionResponse(id=new_opd.id, nmskpd=new_opd.nmskpd)


@router.patch("/me/opd", response_model=AuthMeResponse)
def set_my_opd(
    payload: SetOpdRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserProfile = Depends(get_current_user),
) -> AuthMeResponse:
    """Tetapkan OPD pertama untuk bendahara, atau ganti OPD aktif super admin."""

    app_user = _load_app_user(db, current_user.email)
    target_opd = db.get(RefOpd, payload.opd_id)
    if target_opd is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="OPD tidak ditemukan.",
        )

    current_opd = db.get(RefOpd, app_user.opd_id) if app_user.opd_id else None

    if current_user.role != "super_admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Penetapan OPD hanya dapat dilakukan oleh Super Admin "
                "melalui menu Master Pengguna. Silakan hubungi Super Admin."
            ),
        )

    changed = app_user.opd_id != target_opd.id
    if changed:
        app_user.opd_id = target_opd.id
        write_audit(
            db,
            actor_email=current_user.email,
            action=(
                "CHANGE_ACTIVE_OPD"
                if current_user.role == "super_admin"
                else "SET_USER_OPD"
            ),
            table_name="app_users",
            record_id=str(app_user.id),
            details={
                "opd_id": target_opd.id,
                "nmskpd": target_opd.nmskpd,
                "previous_opd_id": current_opd.id if current_opd else None,
                "role": current_user.role,
            },
            ip_address=extract_client_ip(request),
        )
        db.refresh(app_user)

    updated = UserProfile(
        email=app_user.email,
        role=current_user.role,
        opd_id=app_user.opd_id,
        opd_name=target_opd.nmskpd,
        display_name=app_user.display_name or current_user.display_name,
    )
    return _me_response(updated)
