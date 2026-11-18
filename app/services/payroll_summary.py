"""Agregasi payroll bulanan per OPD untuk dashboard dan endpoint batch."""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import PayrollMonthly, PayrollPotonganItem

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
                "kdpangkat": payroll.kdpangkat,
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
