"""Endpoint manajemen API Key untuk integrasi aplikasi eksternal (khusus super_admin)."""

from __future__ import annotations

import hashlib
import secrets
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import UserProfile, get_current_user
from app.db import get_db
from app.models import ApiKey

router = APIRouter(prefix="/api/v1/api-keys", tags=["api-keys"])


def require_super_admin(current_user: UserProfile = Depends(get_current_user)) -> UserProfile:
    if current_user.role != "super_admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Hanya super_admin yang dapat mengelola API Key.",
        )
    return current_user


class ApiKeyCreateRequest(BaseModel):
    app_name: str = Field(..., min_length=2, max_length=150)
    expires_at: datetime | None = None


class ApiKeyUpdateRequest(BaseModel):
    app_name: str | None = Field(None, min_length=2, max_length=150)
    is_active: bool | None = None
    expires_at: datetime | None = None
    clear_expiration: bool = False


def _serialize_key(row: ApiKey) -> dict[str, Any]:
    return {
        "id": row.id,
        "app_name": row.app_name,
        "key_prefix": row.key_prefix,
        "is_active": bool(row.is_active),
        "expires_at": row.expires_at.isoformat() if row.expires_at else None,
        "last_used_at": row.last_used_at.isoformat() if row.last_used_at else None,
        "created_by": row.created_by,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


@router.get("")
def list_api_keys(
    db: Session = Depends(get_db),
    _: UserProfile = Depends(require_super_admin),
) -> list[dict[str, Any]]:
    rows = db.scalars(select(ApiKey).order_by(ApiKey.created_at.desc())).all()
    return [_serialize_key(r) for r in rows]


@router.post("", status_code=status.HTTP_201_CREATED)
def create_api_key(
    payload: ApiKeyCreateRequest,
    db: Session = Depends(get_db),
    current_user: UserProfile = Depends(require_super_admin),
) -> dict[str, Any]:
    raw_key = f"sg_live_{secrets.token_hex(24)}"
    key_hash = hashlib.sha256(raw_key.encode("utf-8")).hexdigest()
    key_prefix = raw_key[:16] + "..."

    row = ApiKey(
        app_name=payload.app_name.strip(),
        key_hash=key_hash,
        key_prefix=key_prefix,
        is_active=True,
        expires_at=payload.expires_at,
        created_by=current_user.email,
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    result = _serialize_key(row)
    result["api_key"] = raw_key
    return result


@router.patch("/{key_id}")
def update_api_key(
    key_id: int,
    payload: ApiKeyUpdateRequest,
    db: Session = Depends(get_db),
    _: UserProfile = Depends(require_super_admin),
) -> dict[str, Any]:
    row = db.get(ApiKey, key_id)
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="API Key tidak ditemukan.")
    if payload.app_name is not None:
        row.app_name = payload.app_name.strip()
    if payload.is_active is not None:
        row.is_active = payload.is_active
    if payload.clear_expiration:
        row.expires_at = None
    elif payload.expires_at is not None:
        row.expires_at = payload.expires_at

    db.commit()
    db.refresh(row)
    return _serialize_key(row)


@router.delete("/{key_id}")
def delete_api_key(
    key_id: int,
    db: Session = Depends(get_db),
    _: UserProfile = Depends(require_super_admin),
) -> dict[str, str]:
    row = db.get(ApiKey, key_id)
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="API Key tidak ditemukan.")
    db.delete(row)
    db.commit()
    return {"status": "deleted"}
