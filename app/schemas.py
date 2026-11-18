"""Skema Pydantic untuk request/response API."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field


class PotonganDetail(BaseModel):
    pos_nama: str
    nominal: Decimal
    keterangan: str | None = None
    cicilan_info: str | None = None


class SlipGajiResponse(BaseModel):
    nip: str
    nama: str
    opd: str
    periode: str  # Format: "YYYY-MM"
    penghasilan_kotor: Decimal
    potongan_simgaji: Decimal
    potongan_internal: Decimal
    total_potongan: Decimal
    take_home_pay: Decimal
    rincian_potongan_internal: list[PotonganDetail]


class ImportExcelResponse(BaseModel):
    status: Literal["success"] = "success"
    import_id: str
    filename: str
    opd: str
    total_rows: int
    inserted: int
    updated: int
    periods: list[str]
    imported_by: str
    warnings: list[str] = Field(default_factory=list)


class HealthResponse(BaseModel):
    status: str
    database: str


class DashboardEmployee(BaseModel):
    nip: str
    nama: str
    kdpangkat: str | None = None
    norek: str | None = None
    opd: str
    penghasilan_kotor: Decimal
    potongan_simgaji: Decimal
    potongan_internal: Decimal
    total_potongan: Decimal
    take_home_pay: Decimal


class DashboardTotals(BaseModel):
    pegawai: int
    penghasilan_kotor: Decimal
    potongan_simgaji: Decimal
    potongan_internal: Decimal
    total_potongan: Decimal
    take_home_pay: Decimal


class DashboardSummaryResponse(BaseModel):
    period: str
    opd: str
    employees: list[DashboardEmployee]
    totals: DashboardTotals



class PosPotonganCreate(BaseModel):
    nama_pos: str = Field(min_length=1, max_length=150)
    kategori: Literal["bulanan", "berjangka"] = "bulanan"
    is_active: bool = True
    opd_id: int | None = None


class PosPotonganUpdate(BaseModel):
    nama_pos: str | None = Field(default=None, min_length=1, max_length=150)
    kategori: Literal["bulanan", "berjangka"] | None = None
    is_active: bool | None = None
    opd_id: int | None = None


class PosPotonganResponse(BaseModel):
    id: int
    opd_id: int | None = None
    opd_nama: str
    nama_pos: str
    kategori: str
    is_active: bool
    created_at: datetime | None = None


class BerjangkaCreate(BaseModel):
    nip: str = Field(min_length=1, max_length=30)
    pos_id: int
    nominal_per_bulan: Decimal = Field(gt=0, max_digits=15, decimal_places=2)
    start_period: str = Field(pattern=r"^\d{4}-\d{2}$")
    tenor_bulan: int = Field(ge=1, le=120)
    keterangan: str | None = Field(default=None, max_length=1000)
    opd_id: int | None = None


class BerjangkaResponse(BaseModel):
    id: str
    nip: str
    nama: str
    pos_id: int
    pos_nama: str
    opd_nama: str
    nominal_per_bulan: Decimal
    start_period: str
    end_period: str
    tenor_bulan: int
    cicilan_ke: int | None = None
    sisa_bulan: int | None = None
    status: Literal["belum_mulai", "aktif", "selesai"]
    keterangan: str | None = None
    created_by: str
    created_at: datetime | None = None


class GenerateBerjangkaRequest(BaseModel):
    period: str = Field(pattern=r"^\d{4}-\d{2}$")
    opd_id: int | None = None


class GenerateBerjangkaResponse(BaseModel):
    status: Literal["success"] = "success"
    period: str
    opd: str
    generated: int
    updated: int
    skipped: int


class ManualPotonganImportResponse(BaseModel):
    status: Literal["success"] = "success"
    filename: str
    pos: str
    period: str
    opd: str
    total_rows: int
    inserted: int
    updated: int
    warnings: list[str] = Field(default_factory=list)
