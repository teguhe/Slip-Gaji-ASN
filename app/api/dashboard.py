"""Endpoint ringkasan dashboard bendahara."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.auth import AuthContext, get_auth_context
from app.db import get_db
from app.schemas import (
    DashboardEmployee,
    DashboardSummaryResponse,
    DashboardTotals,
)
from app.services.audit import write_audit
from app.services.payroll_summary import load_payroll_summary
from app.services.periods import PeriodError, add_months, parse_period, period_str
from app.services.tenancy import resolve_opd_filter

router = APIRouter(prefix="/api/v1/dashboard", tags=["Dashboard"])


@router.get(
    "/summary",
    response_model=DashboardSummaryResponse,
    summary="Ringkasan payroll OPD per periode",
)
def get_dashboard_summary(
    request: Request,
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
        start_period = parse_period(period)
    except PeriodError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Periode tidak valid: {exc}",
        ) from exc

    end_period = add_months(start_period, 1)
    user = auth_ctx.user if auth_ctx.kind == "user" else None

    try:
        filter_opd = resolve_opd_filter(user, opd)
    except HTTPException as exc:
        write_audit(
            db,
            actor_email=auth_ctx.actor_email,
            action="READ_DASHBOARD_DENIED",
            table_name="payroll_monthly",
            details={
                "period": period,
                "requested_opd": opd,
                "auth_method": auth_ctx.auth_method,
                "reason": "tenant_guard",
            },
            ip_address=request.client.host if request.client else None,
        )
        raise exc

    employee_rows, total_rows = load_payroll_summary(
        db,
        start_period,
        end_period,
        filter_opd,
    )
    response = DashboardSummaryResponse(
        period=period_str(start_period),
        opd=filter_opd or "Semua OPD",
        employees=[DashboardEmployee(**row) for row in employee_rows],
        totals=DashboardTotals(**total_rows),
    )

    write_audit(
        db,
        actor_email=auth_ctx.actor_email,
        action="READ_DASHBOARD_SUMMARY",
        table_name="payroll_monthly",
        details={
            "period": response.period,
            "opd": response.opd,
            "count": len(employee_rows),
            "auth_method": auth_ctx.auth_method,
        },
        ip_address=request.client.host if request.client else None,
    )
    return response
