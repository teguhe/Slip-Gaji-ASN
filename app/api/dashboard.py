"""Endpoint ringkasan dashboard bendahara."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import AuthContext, get_auth_context
from app.db import get_db
from app.models import PayrollMonthly, PayrollPotonganItem
from app.schemas import (
    DashboardEmployee,
    DashboardSummaryResponse,
    DashboardTotals,
)
from app.services.simgaji_import import normalize_opd_name

router = APIRouter(prefix="/api/v1/dashboard", tags=["Dashboard"])

ZERO = Decimal("0.00")


@router.get(
    "/summary",
    response_model=DashboardSummaryResponse,
    summary="Ringkasan payroll OPD per periode",
)
def get_dashboard_summary(
    period: str = Query(
        ...,
        pattern=r"^\d{4}-\d{2}$",
        description="Format YYYY-MM, contoh: 2026-10",
    ),
    opd: str | None = Query(
        None,
        max_length=255,
        description="Khusus super admin / service token; bendahara selalu memakai OPD akun.",
    ),
    db: Session = Depends(get_db),
    auth_ctx: AuthContext = Depends(get_auth_context),
) -> DashboardSummaryResponse:
    try:
        year, month = (int(part) for part in period.split("-"))
        start_period = date(year, month, 1)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Periode tidak valid. Gunakan format YYYY-MM.",
        ) from exc

    if month == 12:
        end_period = date(year + 1, 1, 1)
    else:
        end_period = date(year, month + 1, 1)

    filter_opd: str | None = opd.strip() if opd and opd.strip() else None

    if auth_ctx.kind == "user":
        user = auth_ctx.user
        if user is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Profil pengguna tidak tersedia.",
            )
        if user.role != "super_admin":
            if not user.opd_name:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Profil OPD akun Anda belum diatur.",
                )
            if filter_opd and normalize_opd_name(filter_opd) != normalize_opd_name(
                user.opd_name
            ):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Anda tidak berhak melihat data OPD lain.",
                )
            filter_opd = user.opd_name

    statement = select(PayrollMonthly).where(
        PayrollMonthly.tglgaji >= start_period,
        PayrollMonthly.tglgaji < end_period,
    )
    if filter_opd:
        statement = statement.where(
            func.lower(func.trim(PayrollMonthly.nmskpd))
            == filter_opd.strip().lower()
        )
    statement = statement.order_by(PayrollMonthly.nama)
    payroll_rows = db.scalars(statement).all()

    internal_by_nip: dict[str, Decimal] = {}
    if payroll_rows:
        item_rows = db.execute(
            select(
                PayrollPotonganItem.nip,
                func.coalesce(func.sum(PayrollPotonganItem.nominal), 0),
            )
            .where(
                PayrollPotonganItem.period >= start_period,
                PayrollPotonganItem.period < end_period,
            )
            .group_by(PayrollPotonganItem.nip)
        ).all()
        internal_by_nip = {
            nip: Decimal(str(total or 0)) for nip, total in item_rows
        }

    employees: list[DashboardEmployee] = []
    total_kotor = ZERO
    total_potongan_simgaji = ZERO
    total_potongan_internal = ZERO
    total_potongan = ZERO
    total_thp = ZERO

    for payroll in payroll_rows:
        kotor = payroll.kotor or ZERO
        potongan_simgaji = payroll.potongan or ZERO
        potongan_internal = internal_by_nip.get(payroll.nip, ZERO)
        total = potongan_simgaji + potongan_internal
        thp = kotor - total

        employees.append(
            DashboardEmployee(
                nip=payroll.nip,
                nama=payroll.nama,
                kdpangkat=payroll.kdpangkat,
                norek=payroll.norek,
                opd=payroll.nmskpd.strip(),
                penghasilan_kotor=kotor,
                potongan_simgaji=potongan_simgaji,
                potongan_internal=potongan_internal,
                total_potongan=total,
                take_home_pay=thp,
            )
        )

        total_kotor += kotor
        total_potongan_simgaji += potongan_simgaji
        total_potongan_internal += potongan_internal
        total_potongan += total
        total_thp += thp

    return DashboardSummaryResponse(
        period=period,
        opd=filter_opd or "Semua OPD",
        employees=employees,
        totals=DashboardTotals(
            pegawai=len(employees),
            penghasilan_kotor=total_kotor,
            potongan_simgaji=total_potongan_simgaji,
            potongan_internal=total_potongan_internal,
            total_potongan=total_potongan,
            take_home_pay=total_thp,
        ),
    )
