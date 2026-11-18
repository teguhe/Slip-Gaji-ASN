"""Endpoint monitoring aktivitas dan audit trail."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.auth import UserProfile, get_current_user
from app.db import get_db
from app.models import AuditLog
from app.schemas import AuditLogItem

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/monitoring", tags=["Monitoring"])


@router.get(
    "/audit",
    response_model=list[AuditLogItem],
    summary="Daftar log aktivitas dan audit trail",
)
def get_audit_logs(
    request: Request,
    limit: int = Query(50, ge=1, le=200, description="Maksimum log yang diambil"),
    offset: int = Query(0, ge=0, description="Offset data"),
    action: str | None = Query(None, description="Filter jenis aksi"),
    db: Session = Depends(get_db),
    current_user: UserProfile = Depends(get_current_user),
) -> list[AuditLogItem]:
    """Mengambil log aktivitas.

    Super Admin dapat melihat semua aktivitas.
    Bendahara OPD melihat log aktivitas terkait OPD atau akun miliknya.
    """
    stmt = select(AuditLog)

    if current_user.role != "super_admin":
        stmt = stmt.where(AuditLog.user_email == current_user.email)

    if action:
        stmt = stmt.where(AuditLog.action == action.strip())

    stmt = stmt.order_by(desc(AuditLog.created_at)).offset(offset).limit(limit)
    rows = db.scalars(stmt).all()

    return [
        AuditLogItem(
            id=row.id,
            user_email=row.user_email,
            action=row.action,
            table_name=row.table_name,
            record_id=row.record_id,
            details=row.details,
            ip_address=row.ip_address,
            created_at=row.created_at,
        )
        for row in rows
    ]
