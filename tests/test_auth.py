"""Pengujian aturan Super Admin Lock."""

from __future__ import annotations

from sqlalchemy import select

from app.auth import _resolve_user
from app.models import AppUser


def test_teguhe_email_always_resolved_as_super_admin(db_session):
    profile = _resolve_user(db_session, "TEGUHE@gmail.com", "Teguh")

    assert profile.role == "super_admin"
    assert profile.email == "teguhe@gmail.com"

    user = db_session.scalar(
        select(AppUser).where(AppUser.email == "teguhe@gmail.com")
    )
    assert user is not None
    assert user.role == "super_admin"

    # Role yang salah di database harus dipaksa kembali menjadi super_admin.
    user.role = "bendahara_opd"
    db_session.commit()

    profile = _resolve_user(db_session, "teguhe@gmail.com", None)
    assert profile.role == "super_admin"

    db_session.refresh(user)
    assert user.role == "super_admin"


def test_unknown_regular_user_is_rejected(db_session):
    import pytest
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as exc_info:
        _resolve_user(db_session, "unknown@example.com", None)

    assert exc_info.value.status_code == 403
