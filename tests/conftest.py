"""Fixtures pengujian: database test terisolasi dan seed OPD/user."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

if TYPE_CHECKING:
    from app.auth import UserProfile

DEFAULT_TEST_DATABASE_URL = (
    "postgresql://postgres:postgres_password@localhost:5432/slip_gaji_test"
)
TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL", DEFAULT_TEST_DATABASE_URL)

# Wajib diset sebelum modul aplikasi diimpor (engine dibuat saat import).
os.environ["DATABASE_URL"] = TEST_DATABASE_URL
os.environ["SUPER_ADMIN_EMAIL"] = "teguhe@gmail.com"
os.environ["INTERNAL_API_KEY"] = "test-internal-key"
os.environ["MAX_UPLOAD_MB"] = "20"

OPD_NAME = "BADAN KEPEGAWAIAN DAN PENGEMBANGAN SUMBER DAYA MANUSIA"
OTHER_OPD_NAME = "DINAS PENDIDIKAN"
BENDAHARA_EMAIL = "bendahara@example.com"
SECOND_NIP = "197001011995031002"


def _prepare_database() -> None:
    url = make_url(TEST_DATABASE_URL)
    admin_url = url.set(database="postgres")

    admin_engine = create_engine(admin_url, isolation_level="AUTOCOMMIT")
    try:
        with admin_engine.connect() as connection:
            exists = connection.execute(
                text("SELECT 1 FROM pg_database WHERE datname = :name"),
                {"name": url.database},
            ).scalar()
            if not exists:
                connection.execute(text(f'CREATE DATABASE "{url.database}"'))
    finally:
        admin_engine.dispose()

    schema_path = Path(__file__).resolve().parents[1] / "schema.sql"
    engine = create_engine(TEST_DATABASE_URL)
    try:
        with engine.begin() as connection:
            exists = connection.execute(
                text("SELECT to_regclass('public.payroll_monthly')")
            ).scalar()
            if not exists:
                connection.exec_driver_sql(schema_path.read_text(encoding="utf-8"))
            else:
                penyesuaian_exists = connection.execute(
                    text("SELECT to_regclass('public.payroll_penyesuaian')")
                ).scalar()
                if not penyesuaian_exists:
                    connection.exec_driver_sql("""
                        CREATE TABLE IF NOT EXISTS payroll_penyesuaian (
                            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                            nip VARCHAR(30) NOT NULL,
                            nama VARCHAR(255),
                            period DATE NOT NULL,
                            opd_id INT REFERENCES ref_opd(id) ON DELETE SET NULL,
                            jenis_penyesuaian VARCHAR(100) NOT NULL DEFAULT 'Tunda Bayar',
                            nominal NUMERIC(15, 2) NOT NULL,
                            keterangan TEXT,
                            status VARCHAR(50) NOT NULL DEFAULT 'ditunda',
                            created_by VARCHAR(255) NOT NULL,
                            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                        );
                        CREATE INDEX IF NOT EXISTS idx_penyesuaian_nip_period ON payroll_penyesuaian(nip, period);
                        CREATE INDEX IF NOT EXISTS idx_penyesuaian_opd ON payroll_penyesuaian(opd_id);
                    """)
    finally:
        engine.dispose()


@pytest.fixture(scope="session", autouse=True)
def prepared_database() -> None:
    _prepare_database()
    yield


@dataclass(frozen=True)
class SeedData:
    opd_id: int
    other_opd_id: int
    opd_name: str
    other_opd_name: str
    user_email: str


@pytest.fixture()
def db_session(prepared_database):
    from app.db import SessionLocal

    session = SessionLocal()
    session.execute(
        text(
            "TRUNCATE TABLE audit_logs, payroll_potongan_item, potongan_berjangka, "
            "payroll_penyesuaian, payroll_monthly, app_users, ref_pos_potongan, ref_opd "
            "RESTART IDENTITY CASCADE"
        )
    )
    session.commit()
    try:
        yield session
    finally:
        session.rollback()
        session.close()


@pytest.fixture()
def seeded(db_session) -> SeedData:
    from app.models import AppUser, RefOpd

    opd = RefOpd(nmskpd=OPD_NAME)
    other_opd = RefOpd(nmskpd=OTHER_OPD_NAME)
    db_session.add_all([opd, other_opd])
    db_session.flush()

    db_session.add(
        AppUser(
            email=BENDAHARA_EMAIL,
            display_name="Bendahara OPD",
            role="bendahara_opd",
            opd_id=opd.id,
            is_active=True,
        )
    )
    db_session.commit()

    return SeedData(
        opd_id=opd.id,
        other_opd_id=other_opd.id,
        opd_name=OPD_NAME,
        other_opd_name=OTHER_OPD_NAME,
        user_email=BENDAHARA_EMAIL,
    )


@pytest.fixture()
def bendahara_profile(seeded) -> "UserProfile":
    from app.auth import UserProfile

    return UserProfile(
        email=seeded.user_email,
        role="bendahara_opd",
        opd_id=seeded.opd_id,
        opd_name=seeded.opd_name,
    )


@pytest.fixture()
def super_admin_profile() -> "UserProfile":
    from app.auth import UserProfile

    return UserProfile(
        email="teguhe@gmail.com",
        role="super_admin",
        opd_id=None,
        opd_name=None,
    )


@pytest.fixture()
def api_app(seeded):
    from app.db import SessionLocal, get_db
    from main_api import app

    def override_get_db():
        session = SessionLocal()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = override_get_db
    yield app
    app.dependency_overrides.clear()
