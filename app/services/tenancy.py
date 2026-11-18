"""Guard isolasi data multi-tenant berdasarkan OPD."""

from __future__ import annotations

from fastapi import HTTPException, status

from app.auth import UserProfile

OPD_FORBIDDEN = "Anda tidak berhak mengakses data OPD lain."


def normalize_opd_name(value: str | None) -> str:
    return " ".join(str(value or "").replace("\xa0", " ").split()).casefold()


def resolve_opd_filter(user: UserProfile | None, requested_opd: str | None = None) -> str | None:
    """Tentukan filter OPD untuk query rekap.

    - service/API key: ikuti filter eksplisit; tanpa filter berarti semua OPD.
    - bendahara: wajib punya OPD dan tidak boleh meminta OPD lain.
    - super admin: filter eksplisit, atau OPD aktif, atau semua OPD.
    """

    requested = requested_opd.strip() if requested_opd and requested_opd.strip() else None

    if user is None:
        return requested

    if user.role == "super_admin":
        active = user.opd_name.strip() if user.opd_name else None
        return requested or active

    if not user.opd_id or not user.opd_name:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Profil OPD akun Anda belum diatur.",
        )

    if requested and normalize_opd_name(requested) != normalize_opd_name(user.opd_name):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=OPD_FORBIDDEN,
        )

    return user.opd_name


def assert_opd_access(user: UserProfile | None, opd_name: str) -> None:
    """Pastikan user boleh membaca satu baris data OPD tertentu."""

    if user is None or user.role == "super_admin":
        return

    if not user.opd_name:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Profil OPD akun Anda belum diatur.",
        )

    if normalize_opd_name(user.opd_name) != normalize_opd_name(opd_name):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=OPD_FORBIDDEN,
        )
