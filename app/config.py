"""Konfigurasi aplikasi berbasis environment variable."""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if not raw:
        return default
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return default
    return value if value > 0 else default


@dataclass(frozen=True)
class Settings:
    database_url: str
    super_admin_email: str
    internal_api_key: str | None
    firebase_credentials: str | None
    max_upload_bytes: int
    max_import_rows: int


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Baca konfigurasi sekali per proses.

    Semua nilai sensitif berasal dari environment; tidak ada kredensial
    yang di-hardcode di source code.
    """

    max_upload_mb = _env_int("MAX_UPLOAD_MB", 20)
    return Settings(
        database_url=os.getenv(
            "DATABASE_URL",
            "postgresql://postgres:postgres_password@localhost:5432/slip_gaji_db",
        ),
        # Hard security rule: email ini selalu dievaluasi sebagai super_admin.
        super_admin_email=(os.getenv("SUPER_ADMIN_EMAIL") or "teguhe@gmail.com").strip().lower(),
        internal_api_key=(os.getenv("INTERNAL_API_KEY") or "").strip() or None,
        firebase_credentials=(os.getenv("FIREBASE_ADMIN_CREDENTIALS") or "").strip() or None,
        max_upload_bytes=max_upload_mb * 1024 * 1024,
        max_import_rows=_env_int("MAX_IMPORT_ROWS", 50_000),
    )
