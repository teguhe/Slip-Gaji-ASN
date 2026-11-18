"""Model SQLAlchemy yang memetakan schema.sql PostgreSQL.

Model ini tidak membuat tabel sendiri di production; ``schema.sql`` tetap
menjadi sumber kebenaran DDL. Tipe nominal selalu ``Numeric(15, 2)``.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ENUM as PGEnum
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

user_role_enum = PGEnum(
    "super_admin",
    "bendahara_opd",
    name="user_role",
    create_type=False,
)
potongan_type_enum = PGEnum(
    "bulanan",
    "berjangka",
    name="potongan_type",
    create_type=False,
)


class RefOpd(Base):
    __tablename__ = "ref_opd"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    nmskpd: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class AppUser(Base):
    __tablename__ = "app_users"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("uuid_generate_v4()")
    )
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(
        user_role_enum, nullable=False, server_default=text("'bendahara_opd'")
    )
    opd_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("ref_opd.id", ondelete="SET NULL")
    )
    is_active: Mapped[bool] = mapped_column(Boolean, server_default=text("TRUE"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class PayrollMonthly(Base):
    __tablename__ = "payroll_monthly"
    __table_args__ = (
        UniqueConstraint("nip", "tglgaji", name="uq_payroll_nip_period"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("uuid_generate_v4()")
    )
    tglgaji: Mapped[date] = mapped_column(Date, nullable=False)
    nip: Mapped[str] = mapped_column(String(30), nullable=False)
    nama: Mapped[str] = mapped_column(String(255), nullable=False)
    norek: Mapped[str | None] = mapped_column(String(50))
    kdpangkat: Mapped[str | None] = mapped_column(String(10))
    nmskpd: Mapped[str] = mapped_column(String(255), nullable=False)

    gapok: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), server_default=text("0"))
    tjistri: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), server_default=text("0"))
    tjanak: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), server_default=text("0"))
    tjtpp: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), server_default=text("0"))
    tjeselon: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), server_default=text("0"))
    tjfungsi: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), server_default=text("0"))
    tjstruk: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), server_default=text("0"))
    tjguru: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), server_default=text("0"))
    tjlangka: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), server_default=text("0"))
    tjtkd: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), server_default=text("0"))
    tjterpencil: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), server_default=text("0"))
    tjkhusus: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), server_default=text("0"))
    tjberas: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), server_default=text("0"))
    tjpajak: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), server_default=text("0"))
    tjaskes: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), server_default=text("0"))
    tjumum: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), server_default=text("0"))
    tjkk: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), server_default=text("0"))
    tjkm: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), server_default=text("0"))
    ttaperap: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), server_default=text("0"))
    tbulat: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), server_default=text("0"))
    kotor: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), server_default=text("0"))
    iwp_beban_pegawai: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), server_default=text("0"))
    iwp_beban_pembkerja: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), server_default=text("0"))
    iwp_taspen: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), server_default=text("0"))
    ppajak: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), server_default=text("0"))
    pbulog: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), server_default=text("0"))
    ptaperum: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), server_default=text("0"))
    psewa: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), server_default=text("0"))
    phutang: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), server_default=text("0"))
    pkorpri: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), server_default=text("0"))
    pirdhata: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), server_default=text("0"))
    pkoperasi: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), server_default=text("0"))
    pjkk: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), server_default=text("0"))
    pjkm: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), server_default=text("0"))
    ptaperap: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), server_default=text("0"))
    ptaperai: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), server_default=text("0"))
    potongan: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), server_default=text("0"))
    bersih: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), server_default=text("0"))

    imported_by: Mapped[str] = mapped_column(String(255), nullable=False)
    imported_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class RefPosPotongan(Base):
    __tablename__ = "ref_pos_potongan"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    opd_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("ref_opd.id", ondelete="CASCADE")
    )
    nama_pos: Mapped[str] = mapped_column(String(150), nullable=False)
    kategori: Mapped[str] = mapped_column(potongan_type_enum, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, server_default=text("TRUE"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class PotonganBerjangka(Base):
    __tablename__ = "potongan_berjangka"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("uuid_generate_v4()")
    )
    nip: Mapped[str] = mapped_column(String(30), nullable=False)
    pos_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("ref_pos_potongan.id", ondelete="RESTRICT"), nullable=False
    )
    nominal_per_bulan: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    start_period: Mapped[date] = mapped_column(Date, nullable=False)
    tenor_bulan: Mapped[int] = mapped_column(Integer, nullable=False)
    end_period: Mapped[date] = mapped_column(Date, nullable=False)
    keterangan: Mapped[str | None] = mapped_column(String)
    created_by: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class PayrollPotonganItem(Base):
    __tablename__ = "payroll_potongan_item"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("uuid_generate_v4()")
    )
    payroll_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("payroll_monthly.id", ondelete="CASCADE")
    )
    nip: Mapped[str] = mapped_column(String(30), nullable=False)
    period: Mapped[date] = mapped_column(Date, nullable=False)
    pos_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("ref_pos_potongan.id", ondelete="RESTRICT"), nullable=False
    )
    berjangka_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("potongan_berjangka.id", ondelete="SET NULL")
    )
    cicilan_ke: Mapped[int | None] = mapped_column(Integer)
    nominal: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    created_by: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_email: Mapped[str] = mapped_column(String(255), nullable=False)
    action: Mapped[str] = mapped_column(String(100), nullable=False)
    table_name: Mapped[str | None] = mapped_column(String(100))
    record_id: Mapped[str | None] = mapped_column(String(100))
    details: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    ip_address: Mapped[str | None] = mapped_column(String(50))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class PayrollPenyesuaian(Base):
    __tablename__ = "payroll_penyesuaian"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("uuid_generate_v4()")
    )
    nip: Mapped[str] = mapped_column(String(30), nullable=False)
    nama: Mapped[str | None] = mapped_column(String(255))
    period: Mapped[date] = mapped_column(Date, nullable=False)
    opd_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("ref_opd.id", ondelete="CASCADE")
    )
    jenis_penyesuaian: Mapped[str] = mapped_column(
        String(100), nullable=False, server_default=text("'Tunda Bayar'")
    )
    nominal: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    keterangan: Mapped[str | None] = mapped_column(String)
    status: Mapped[str] = mapped_column(
        String(50), nullable=False, server_default=text("'ditunda'")
    )
    created_by: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

