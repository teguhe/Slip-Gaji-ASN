"""Pengujian Super Admin Lock dan provisioning login pertama."""

from __future__ import annotations

from sqlalchemy import select

from app.auth import _resolve_user
from app.models import AppUser, AuditLog


def test_teguhe_email_always_resolved_as_super_admin(db_session):
    profile = _resolve_user(db_session, "TEGUHE@gmail.com", "Teguh")

    assert profile.role == "super_admin"
    assert profile.email == "teguhe@gmail.com"
    assert profile.display_name == "Teguh"

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

    audit = db_session.scalar(
        select(AuditLog).where(AuditLog.action == "SUPER_ADMIN_ROLE_LOCKED")
    )
    assert audit is not None


def test_first_login_regular_user_is_provisioned_without_opd(db_session):
    profile = _resolve_user(db_session, "New.User@example.com", "New User")

    assert profile.email == "new.user@example.com"
    assert profile.role == "bendahara_opd"
    assert profile.opd_id is None
    assert profile.opd_name is None
    assert profile.display_name == "New User"

    user = db_session.scalar(
        select(AppUser).where(AppUser.email == "new.user@example.com")
    )
    assert user is not None
    assert user.role == "bendahara_opd"
    assert user.opd_id is None

    audit = db_session.scalar(
        select(AuditLog).where(
            AuditLog.action == "USER_REGISTERED",
            AuditLog.user_email == "new.user@example.com",
        )
    )
    assert audit is not None
