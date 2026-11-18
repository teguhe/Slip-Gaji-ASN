"""Helper audit log terpusat."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.models import AuditLog


def write_audit(
    db: Session,
    *,
    actor_email: str,
    action: str,
    table_name: str | None = None,
    record_id: str | None = None,
    details: dict[str, Any] | None = None,
    ip_address: str | None = None,
    commit: bool = True,
) -> AuditLog:
    log = AuditLog(
        user_email=actor_email[:255],
        action=action[:100],
        table_name=table_name[:100] if table_name else None,
        record_id=str(record_id)[:100] if record_id is not None else None,
        details=details,
        ip_address=(ip_address or "")[:50] or None,
    )
    db.add(log)
    if commit:
        db.commit()
    return log
