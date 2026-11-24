"""Agregasi payroll bulanan per OPD untuk dashboard dan endpoint batch."""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.constants import format_kdpangkat
from app.models import PayrollMonthly, PayrollPotonganItem
from app.services.periods import period_str

ZERO = Decimal("0.00")


def load_payroll_summary(
    db: Session,
    start_period: date,
    end_period: date,
    opd_name: str | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    statement = select(PayrollMonthly).where(
        PayrollMonthly.tglgaji >= start_period,
        PayrollMonthly.tglgaji < end_period,
    )
    if opd_name:
        statement = statement.where(
            func.lower(func.trim(PayrollMonthly.nmskpd)) == opd_name.strip().lower()
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

    employees: list[dict[str, Any]] = []
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
            {
                "nip": payroll.nip,
                "nama": payroll.nama,
                "kdpangkat": format_kdpangkat(payroll.kdpangkat),
                "norek": payroll.norek,
                "opd": payroll.nmskpd.strip(),
                "penghasilan_kotor": kotor,
                "potongan_simgaji": potongan_simgaji,
                "potongan_internal": potongan_internal,
                "total_potongan": total,
                "take_home_pay": thp,
            }
        )

        total_kotor += kotor
        total_potongan_simgaji += potongan_simgaji
        total_potongan_internal += potongan_internal
        total_potongan += total
        total_thp += thp

    totals = {
        "pegawai": len(employees),
        "penghasilan_kotor": total_kotor,
        "potongan_simgaji": total_potongan_simgaji,
        "potongan_internal": total_potongan_internal,
        "total_potongan": total_potongan,
        "take_home_pay": total_thp,
    }
    return employees, totals


MONTH_NAMES = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember",
]


def format_period_label(period_str_val: str) -> str:
    parts = str(period_str_val or "").split("-")
    if len(parts) == 2:
        if parts[1] == "13":
            return f"Gaji 13 {parts[0]}"
        if parts[1] == "14":
            return f"Gaji THR {parts[0]}"
        try:
            m_idx = int(parts[1]) - 1
            if 0 <= m_idx < 12:
                return f"{MONTH_NAMES[m_idx]} {parts[0]}"
        except ValueError:
            pass
    return str(period_str_val or "")


def load_payroll_period_recap(
    db: Session,
    opd_name: str | None = None,
) -> dict[str, Any]:
    """Mengembalikan rekapitulasi ketersediaan data penggajian bulanan per OPD:
    - total_months: berapa bulan data tersedia
    - oldest_period: periode paling lama (YYYY-MM)
    - oldest_period_label: label periode paling lama (mis. Januari 2024)
    - newest_period: periode paling baru (YYYY-MM)
    - newest_period_label: label periode paling baru (mis. Oktober 2026)
    - available_periods: daftar seluruh periode unik yang ada (sorted ASC)
    """
    statement = select(PayrollMonthly.tglgaji)
    if opd_name:
        statement = statement.where(
            func.lower(func.trim(PayrollMonthly.nmskpd)) == opd_name.strip().lower()
        )
    statement = statement.distinct()
    dates = db.scalars(statement).all()

    if not dates:
        return {
            "total_months": 0,
            "oldest_period": None,
            "oldest_period_label": None,
            "newest_period": None,
            "newest_period_label": None,
            "available_periods": [],
        }

    period_set = {period_str(d) for d in dates if d}
    sorted_periods = sorted(period_set)
    if not sorted_periods:
        return {
            "total_months": 0,
            "oldest_period": None,
            "oldest_period_label": None,
            "newest_period": None,
            "newest_period_label": None,
            "available_periods": [],
        }

    oldest = sorted_periods[0]
    newest = sorted_periods[-1]

    return {
        "total_months": len(sorted_periods),
        "oldest_period": oldest,
        "oldest_period_label": format_period_label(oldest),
        "newest_period": newest,
        "newest_period_label": format_period_label(newest),
        "available_periods": sorted_periods,
    }
