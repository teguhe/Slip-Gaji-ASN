"""Logika cicilan berjangka dan realisasi potongan bulanan."""

from __future__ import annotations

from datetime import date
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any, Iterable

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.constants import MAX_ABS_MONEY
from app.models import PayrollMonthly, PayrollPotonganItem, PotonganBerjangka
from app.services.periods import add_months, month_difference

CENT = Decimal("0.01")
MAX_MONEY = Decimal(MAX_ABS_MONEY)


def quantize_money(value: Decimal | str | int | float) -> Decimal:
    """Konversi nominal ke Decimal presisi 2 desimal."""

    try:
        amount = value if isinstance(value, Decimal) else Decimal(str(value))
        amount = amount.quantize(CENT, rounding=ROUND_HALF_UP)
    except (InvalidOperation, ValueError, TypeError) as exc:
        raise ValueError("Nominal tidak valid.") from exc
    if amount <= 0:
        raise ValueError("Nominal harus lebih besar dari 0.")
    if abs(amount) > MAX_MONEY:
        raise ValueError("Nominal melebihi batas NUMERIC(15,2).")
    return amount


def calculate_end_period(start_period: date, tenor_bulan: int) -> date:
    if tenor_bulan < 1:
        raise ValueError("Tenor minimal 1 bulan.")
    return add_months(start_period, tenor_bulan - 1)


def calculate_cicilan_ke(
    start_period: date,
    end_period: date,
    period: date,
) -> int | None:
    """Nomor cicilan untuk ``period``; None jika di luar rentang."""

    if period < start_period or period > end_period:
        return None
    return month_difference(start_period, period) + 1


def loan_progress(
    start_period: date,
    end_period: date,
    tenor_bulan: int,
    period: date,
) -> dict[str, Any]:
    """Hitung progres tenor untuk sebuah periode."""

    cicilan = calculate_cicilan_ke(start_period, end_period, period)
    if cicilan is None:
        if period < start_period:
            return {"cicilan_ke": None, "sisa_bulan": tenor_bulan, "status": "belum_mulai"}
        return {"cicilan_ke": tenor_bulan, "sisa_bulan": 0, "status": "selesai"}
    return {
        "cicilan_ke": cicilan,
        "sisa_bulan": max(0, tenor_bulan - cicilan),
        "status": "aktif" if cicilan < tenor_bulan else "aktif",
    }


def _period_payroll_rows(
    db: Session,
    period: date,
    opd_name: str | None,
) -> list[PayrollMonthly]:
    start = period
    end = add_months(period, 1)
    statement = select(PayrollMonthly).where(
        PayrollMonthly.tglgaji >= start,
        PayrollMonthly.tglgaji < end,
    )
    if opd_name:
        statement = statement.where(
            func.lower(func.trim(PayrollMonthly.nmskpd)) == opd_name.strip().lower()
        )
    return list(db.scalars(statement).all())


def generate_for_period(
    db: Session,
    period: date,
    created_by: str,
    opd_name: str | None = None,
) -> dict[str, int]:
    """Realisasikan cicilan berjangka aktif pada periode tertentu.

    Hanya NIP yang memiliki baris payroll pada periode dan OPD tersebut yang
    diproses. Idempotent: realisasi yang sudah ada tidak diduplikasi.
    """

    period = period.replace(day=1)
    payroll_rows = _period_payroll_rows(db, period, opd_name)
    if not payroll_rows:
        return {"generated": 0, "updated": 0, "skipped": 0}

    payroll_by_nip: dict[str, PayrollMonthly] = {}
    for payroll in payroll_rows:
        payroll_by_nip[payroll.nip] = payroll

    loans = db.scalars(
        select(PotonganBerjangka)
        .where(
            PotonganBerjangka.nip.in_(list(payroll_by_nip.keys())),
            PotonganBerjangka.start_period <= period,
            PotonganBerjangka.end_period >= period,
        )
        .order_by(PotonganBerjangka.start_period)
    ).all()

    generated = 0
    updated = 0
    skipped = 0

    for loan in loans:
        payroll = payroll_by_nip.get(loan.nip)
        if payroll is None:
            skipped += 1
            continue

        cicilan = calculate_cicilan_ke(loan.start_period, loan.end_period, period)
        if cicilan is None:
            skipped += 1
            continue

        existing = db.scalar(
            select(PayrollPotonganItem).where(
                PayrollPotonganItem.berjangka_id == loan.id,
                PayrollPotonganItem.period == period,
            )
        )
        if existing is not None:
            if (
                existing.nominal != loan.nominal_per_bulan
                or existing.cicilan_ke != cicilan
                or existing.payroll_id != payroll.id
            ):
                existing.nominal = loan.nominal_per_bulan
                existing.cicilan_ke = cicilan
                existing.payroll_id = payroll.id
                existing.created_by = created_by
                updated += 1
            else:
                skipped += 1
            continue

        db.add(
            PayrollPotonganItem(
                payroll_id=payroll.id,
                nip=loan.nip,
                period=period,
                pos_id=loan.pos_id,
                berjangka_id=loan.id,
                cicilan_ke=cicilan,
                nominal=loan.nominal_per_bulan,
                created_by=created_by,
            )
        )
        generated += 1

    db.flush()
    return {"generated": generated, "updated": updated, "skipped": skipped}


def generate_for_periods(
    db: Session,
    periods: Iterable[date],
    created_by: str,
    opd_name: str | None = None,
) -> dict[str, int]:
    totals = {"generated": 0, "updated": 0, "skipped": 0}
    for period in sorted(set(periods)):
        counts = generate_for_period(db, period, created_by, opd_name)
        for key in totals:
            totals[key] += counts[key]
    return totals

