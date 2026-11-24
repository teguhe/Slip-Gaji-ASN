"""Skema Pydantic untuk request/response API."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field


class PotonganDetail(BaseModel):
    id: str | None = None
    pos_nama: str
    nominal: Decimal
    keterangan: str | None = None
    cicilan_info: str | None = None
    kategori: str | None = None


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
    rincian_penghasilan: dict[str, Decimal] = Field(default_factory=dict)
    rincian_potongan_simgaji: dict[str, Decimal] = Field(default_factory=dict)
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


class DashboardPeriodRecap(BaseModel):
    total_months: int = 0
    oldest_period: str | None = None
    oldest_period_label: str | None = None
    newest_period: str | None = None
    newest_period_label: str | None = None
    available_periods: list[str] = Field(default_factory=list)


class InspectExcelResponse(BaseModel):
    status: Literal["success"] = "success"
    filename: str
    first_column: str
    period: str
    period_label: str
    opd: str
    total_rows: int
    is_opd_match: bool
    user_opd: str | None = None
    warning: str | None = None


class DashboardSummaryResponse(BaseModel):
    period: str
    opd: str
    employees: list[DashboardEmployee]
    totals: DashboardTotals
    period_recap: DashboardPeriodRecap | None = None



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


class PotonganItemCreate(BaseModel):
    nip: str = Field(..., pattern=r"^\d{8,30}$")
    pos_id: int
    period: str = Field(..., pattern=r"^\d{4}-\d{2}$")
    nominal: Decimal = Field(..., gt=0, le=Decimal("9999999999999.99"))
    opd_id: int | None = None


class PotonganItemResponse(BaseModel):
    id: str
    nip: str
    period: str
    pos_id: int
    pos_nama: str
    nominal: Decimal
    created_by: str


class PotonganItemDeleteResponse(BaseModel):
    status: Literal["success"] = "success"
    message: str
    deleted_id: str


class PosBulananRekapItem(BaseModel):
    pos_id: int
    nama_pos: str
    kategori: str
    is_active: bool
    jumlah_pegawai: int
    total_nominal: Decimal


class RekapBulananResponse(BaseModel):
    period: str
    opd_id: int
    opd_nama: str
    total_pos: int
    total_pegawai: int
    total_nominal: Decimal
    items: list[PosBulananRekapItem]


class PosBulananDetailItem(BaseModel):
    id: str
    nip: str
    nama: str
    nominal: Decimal
    created_at: datetime | None = None


class PosBulananDetailResponse(BaseModel):
    pos_id: int
    nama_pos: str
    period: str
    opd_nama: str
    total_pegawai: int
    total_nominal: Decimal
    items: list[PosBulananDetailItem]


class PosBerjangkaRekapItem(BaseModel):
    pos_id: int
    nama_pos: str
    kategori: str
    is_active: bool
    jumlah_pegawai: int
    total_pinjaman: int
    total_nominal: Decimal


class RekapBerjangkaResponse(BaseModel):
    period: str
    opd_id: int
    opd_nama: str
    total_pos: int
    total_pegawai: int
    total_pinjaman: int
    total_nominal: Decimal
    items: list[PosBerjangkaRekapItem]


class PosBerjangkaDetailItem(BaseModel):
    id: str
    nip: str
    nama: str
    nominal_per_bulan: Decimal
    start_period: str
    end_period: str
    tenor_bulan: int
    cicilan_ke: int | None = None
    sisa_bulan: int = 0
    status: str = "aktif"
    progres_label: str = "—"
    keterangan: str | None = None
    created_at: datetime | None = None


class PosBerjangkaDetailResponse(BaseModel):
    pos_id: int
    nama_pos: str
    period: str
    opd_nama: str
    total_pegawai: int
    total_pinjaman: int
    total_nominal: Decimal
    items: list[PosBerjangkaDetailItem]


class AuthMeResponse(BaseModel):
    email: str
    display_name: str | None = None
    role: str
    is_super_admin: bool = False
    opd_id: int | None = None
    opd_name: str | None = None
    needs_opd: bool = False
    auth_method: str = "firebase"
    jabatan: str | None = "Bendahara Pengeluaran"
    nama_bendahara: str | None = None
    nip_bendahara: str | None = None


class UpdateSettingsRequest(BaseModel):
    jabatan: str | None = Field(default="Bendahara Pengeluaran", max_length=100)
    nama_bendahara: str | None = Field(default=None, max_length=255)
    nip_bendahara: str | None = Field(default=None, max_length=50)


class SettingsResponse(BaseModel):
    status: Literal["success"] = "success"
    jabatan: str | None = "Bendahara Pengeluaran"
    nama_bendahara: str | None = None
    nip_bendahara: str | None = None


class CreateOpdRequest(BaseModel):
    nmskpd: str = Field(..., min_length=3, max_length=255)


class OpdOptionResponse(BaseModel):
    id: int
    nmskpd: str


class SetOpdRequest(BaseModel):
    opd_id: int


# ---------------------------------------------------------------------------
# Master Data OPD & User (Super Admin only)
# ---------------------------------------------------------------------------

class MasterOpdItem(BaseModel):
    id: int
    nmskpd: str
    created_at: datetime | None = None
    user_count: int = 0
    payroll_count: int = 0


class MasterOpdCreate(BaseModel):
    nmskpd: str = Field(..., min_length=3, max_length=255)


class MasterOpdUpdate(BaseModel):
    nmskpd: str = Field(..., min_length=3, max_length=255)


class MasterUserItem(BaseModel):
    id: str
    email: str
    display_name: str | None = None
    role: str
    opd_id: int | None = None
    opd_name: str | None = None
    is_active: bool = True
    is_default_super_admin: bool = False
    created_at: datetime | None = None
    updated_at: datetime | None = None


class MasterUserCreate(BaseModel):
    email: str = Field(..., min_length=5, max_length=255)
    opd_id: int
    display_name: str | None = None


class MasterUserUpdate(BaseModel):
    role: Literal["super_admin", "bendahara_opd"] | None = None
    opd_id: int | None = None
    clear_opd: bool = False
    is_active: bool | None = None


# --- PENYESUAIAN GAJI & MONITORING SCHEMAS ---

class PenyesuaianGajiCreate(BaseModel):
    nip: str = Field(..., min_length=1, max_length=30)
    nama: str | None = Field(None, max_length=255)
    period: str = Field(..., pattern=r"^\d{4}-\d{2}$", description="Format YYYY-MM")
    jenis_penyesuaian: str = Field("Tunda Bayar", max_length=100)
    nominal: Decimal = Field(..., gt=Decimal("0.00"))
    keterangan: str | None = None
    status: str = Field("ditunda", max_length=50)


class PenyesuaianGajiItem(BaseModel):
    id: str
    nip: str
    nama: str | None = None
    period: str
    opd_id: int | None = None
    jenis_penyesuaian: str
    nominal: Decimal
    keterangan: str | None = None
    status: str
    created_by: str
    created_at: datetime


class AuditLogItem(BaseModel):
    id: int
    user_email: str
    action: str
    table_name: str | None = None
    record_id: str | None = None
    details: dict[str, Any] | None = None
    ip_address: str | None = None
    created_at: datetime


class MasterGajiPayrollRow(BaseModel):
    id: str
    nip: str
    nama: str
    kdpangkat: str | None = None
    norek: str | None = None
    nmskpd: str
    gapok: Decimal
    total_tunjangan: Decimal
    kotor: Decimal
    potongan_simgaji: Decimal
    potongan_internal: Decimal
    penyesuaian: Decimal
    take_home_pay: Decimal


class MasterGajiStatsResponse(BaseModel):
    period: str
    opd: str
    total_pegawai: int
    total_gapok: Decimal
    total_tunjangan: Decimal
    total_kotor: Decimal
    total_potongan_simgaji: Decimal
    total_potongan_internal: Decimal
    total_penyesuaian: Decimal
    total_thp: Decimal
    breakdown_tunjangan: dict[str, Decimal]
    breakdown_potongan_resmi: dict[str, Decimal]

