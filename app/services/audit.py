"""Helper audit log terpusat."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from sqlalchemy.orm import Session

from app.models import AuditLog

if TYPE_CHECKING:
    from fastapi import Request


def extract_client_ip(request: Request | None) -> str | None:
    """Mengekstrak IP address perangkat client secara akurat.
    Mendukung header reverse proxy (X-Forwarded-For, X-Real-IP, CF-Connecting-IP)
    serta koneksi socket langsung."""
    if not request:
        return None

    # 1. Header X-Forwarded-For (standar reverse proxy / load balancer / docker proxy)
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        parts = [p.strip() for p in forwarded.split(",") if p.strip()]
        if parts:
            return parts[0][:50]

    # 2. Header X-Real-IP (Nginx / Apache)
    real_ip = request.headers.get("x-real-ip")
    if real_ip and real_ip.strip():
        return real_ip.strip()[:50]

    # 3. Header CF-Connecting-IP (Cloudflare)
    cf_ip = request.headers.get("cf-connecting-ip")
    if cf_ip and cf_ip.strip():
        return cf_ip.strip()[:50]

    # 4. Fallback ke direct socket connection IP
    if request.client and request.client.host:
        return request.client.host[:50]

    return None


def write_audit(
    db: Session,
    *,
    actor_email: str,
    action: str,
    table_name: str | None = None,
    record_id: str | None = None,
    details: dict[str, Any] | None = None,
    ip_address: str | None = None,
    request: Request | None = None,
    commit: bool = True,
) -> AuditLog:
    resolved_ip = ip_address or extract_client_ip(request)
    log = AuditLog(
        user_email=actor_email[:255],
        action=action[:100],
        table_name=table_name[:100] if table_name else None,
        record_id=str(record_id)[:100] if record_id is not None else None,
        details=details,
        ip_address=(resolved_ip or "")[:50] or None,
    )
    db.add(log)
    if commit:
        db.commit()
    return log
