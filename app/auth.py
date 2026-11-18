"""Autentikasi Firebase ID Token dan otorisasi profil OPD.

Aturan:
- ``teguhe@gmail.com`` selalu dievaluasi sebagai ``super_admin``.
- Bendahara OPD hanya boleh bertindak atas OPD yang terhubung ke akunnya.
- Internal API key hanya untuk integrasi service-to-service, bukan dashboard.
"""

from __future__ import annotations

import hmac
import logging
import os
import threading
from dataclasses import dataclass
from typing import Optional

import firebase_admin
from fastapi import Depends, HTTPException, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from firebase_admin import auth as firebase_auth
from firebase_admin import credentials
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.db import get_db
from app.models import AppUser, RefOpd

logger = logging.getLogger(__name__)

_bearer_scheme = HTTPBearer(auto_error=False, scheme_name="Bearer")
_firebase_lock = threading.Lock()


@dataclass(frozen=True)
class UserProfile:
    email: str
    role: str
    opd_id: Optional[int] = None
    opd_name: Optional[str] = None


@dataclass(frozen=True)
class AuthContext:
    kind: str  # "user" | "service"
    user: Optional[UserProfile] = None


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def _ensure_firebase_app(settings: Settings) -> None:
    """Inisialisasi Firebase Admin secara lazy dan thread-safe."""

    try:
        firebase_admin.get_app()
        return
    except ValueError:
        pass

    with _firebase_lock:
        try:
            firebase_admin.get_app()
            return
        except ValueError:
            pass

        if settings.firebase_credentials:
            if not os.path.isfile(settings.firebase_credentials):
                logger.error(
                    "File kredensial Firebase tidak ditemukan: %s",
                    settings.firebase_credentials,
                )
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Kredensial Firebase Admin belum tersedia di server.",
                )
            try:
                firebase_admin.initialize_app(
                    credentials.Certificate(settings.firebase_credentials)
                )
            except Exception as exc:  # pragma: no cover - konfigurasi eksternal
                logger.exception("Gagal menginisialisasi Firebase Admin")
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Firebase Admin gagal diinisialisasi.",
                ) from exc
            return

        # Fallback ke Application Default Credentials (GOOGLE_APPLICATION_CREDENTIALS).
        try:
            firebase_admin.initialize_app()
        except Exception as exc:
            logger.error("Firebase Admin belum dikonfigurasi: %s", exc)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=(
                    "Firebase Auth belum dikonfigurasi. Set FIREBASE_ADMIN_CREDENTIALS "
                    "atau GOOGLE_APPLICATION_CREDENTIALS."
                ),
            ) from exc


def _verify_firebase_token(token: str, settings: Settings) -> tuple[str, str | None]:
    _ensure_firebase_app(settings)
    try:
        decoded = firebase_auth.verify_id_token(token)
    except Exception as exc:
        logger.warning("Verifikasi Firebase ID Token gagal: %s", exc)
        raise _unauthorized("Token autentikasi tidak valid atau sudah kedaluwarsa.") from exc

    email = str(decoded.get("email") or "").strip().lower()
    if not email:
        raise _unauthorized("Token autentikasi tidak memuat alamat email.")
    if decoded.get("email_verified") is False:
        raise _unauthorized("Alamat email akun belum diverifikasi.")

    display_name = decoded.get("name")
    return email, str(display_name)[:255] if display_name else None


def _resolve_user(db: Session, email: str, display_name: str | None) -> UserProfile:
    settings = get_settings()
    email_norm = email.strip().lower()

    user = db.scalar(
        select(AppUser)
        .where(func.lower(func.trim(AppUser.email)) == email_norm)
        .order_by(AppUser.created_at)
        .limit(1)
    )

    is_super_admin = email_norm == settings.super_admin_email
    if is_super_admin:
        if user is None:
            user = AppUser(
                email=email_norm,
                display_name=display_name,
                role="super_admin",
                is_active=True,
            )
            db.add(user)
            db.commit()
            db.refresh(user)
        else:
            if not user.is_active:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Akun Anda dinonaktifkan.",
                )
            # Super Admin Lock: role selalu dipaksa super_admin.
            if user.role != "super_admin":
                user.role = "super_admin"
                db.commit()

        opd = db.get(RefOpd, user.opd_id) if user.opd_id else None
        return UserProfile(
            email=email_norm,
            role="super_admin",
            opd_id=user.opd_id,
            opd_name=opd.nmskpd if opd else None,
        )

    if user is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Akun belum terdaftar pada aplikasi. Hubungi Super Admin untuk "
                "pendaftaran dan penetapan OPD."
            ),
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Akun Anda dinonaktifkan.",
        )

    opd = db.get(RefOpd, user.opd_id) if user.opd_id else None
    return UserProfile(
        email=email_norm,
        role=user.role or "bendahara_opd",
        opd_id=user.opd_id,
        opd_name=opd.nmskpd if opd else None,
    )


def get_auth_context(
    credentials_: HTTPAuthorizationCredentials | None = Security(_bearer_scheme),
    db: Session = Depends(get_db),
) -> AuthContext:
    """Validasi Bearer token: internal API key atau Firebase ID Token."""

    if credentials_ is None or not credentials_.credentials:
        raise _unauthorized("Header Authorization Bearer wajib disertakan.")

    token = credentials_.credentials.strip()
    settings = get_settings()

    if settings.internal_api_key and hmac.compare_digest(
        token.encode("utf-8"), settings.internal_api_key.encode("utf-8")
    ):
        return AuthContext(kind="service")

    email, display_name = _verify_firebase_token(token, settings)
    user = _resolve_user(db, email, display_name)
    return AuthContext(kind="user", user=user)


def get_current_user(
    context: AuthContext = Depends(get_auth_context),
) -> UserProfile:
    """Dependency untuk endpoint dashboard; menolak service token."""

    if context.kind != "user" or context.user is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Endpoint ini hanya dapat diakses oleh pengguna dashboard.",
        )
    return context.user
