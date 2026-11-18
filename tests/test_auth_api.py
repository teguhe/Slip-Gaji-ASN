"""Pengujian endpoint profil, onboarding OPD, dan pergantian OPD."""

from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.auth import UserProfile, get_current_user
from app.models import AppUser, AuditLog
from tests.conftest import OTHER_OPD_NAME


def _new_user(db_session, email: str, *, role: str = "bendahara_opd", opd_id=None):
    user = AppUser(
        email=email,
        display_name="Pengguna Baru",
        role=role,
        opd_id=opd_id,
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def test_me_requires_opd_for_first_login(api_app, seeded):
    profile = UserProfile(
        email="new@example.com",
        role="bendahara_opd",
        opd_id=None,
        opd_name=None,
        display_name="Pengguna Baru",
    )
    api_app.dependency_overrides[get_current_user] = lambda: profile

    with TestClient(api_app) as client:
        response = client.get("/api/v1/auth/me")
        options = client.get("/api/v1/auth/opd-options")

    assert response.status_code == 200
    body = response.json()
    assert body["email"] == "new@example.com"
    assert body["role"] == "bendahara_opd"
    assert body["needs_opd"] is True
    assert body["opd_id"] is None

    assert options.status_code == 200
    assert {item["nmskpd"] for item in options.json()} == {
        seeded.opd_name,
        OTHER_OPD_NAME,
    }


def test_bendahara_can_set_opd_once(api_app, db_session, seeded):
    user = _new_user(db_session, "new@example.com")
    profile = UserProfile(
        email=user.email,
        role="bendahara_opd",
        opd_id=None,
        opd_name=None,
        display_name=user.display_name,
    )
    api_app.dependency_overrides[get_current_user] = lambda: profile

    with TestClient(api_app) as client:
        first = client.patch(
            "/api/v1/auth/me/opd",
            json={"opd_id": seeded.opd_id},
        )
        assert first.status_code == 200, first.text
        assert first.json()["opd_name"] == seeded.opd_name
        assert first.json()["needs_opd"] is False

        second = client.patch(
            "/api/v1/auth/me/opd",
            json={"opd_id": seeded.other_opd_id},
        )
        assert second.status_code == 403

    db_session.refresh(user)
    assert user.opd_id == seeded.opd_id

    audit = db_session.scalar(
        select(AuditLog).where(
            AuditLog.action == "SET_USER_OPD",
            AuditLog.user_email == "new@example.com",
        )
    )
    assert audit is not None
    assert audit.details["nmskpd"] == seeded.opd_name


def test_super_admin_can_change_active_opd(api_app, db_session, seeded):
    user = _new_user(
        db_session,
        "teguhe@gmail.com",
        role="super_admin",
        opd_id=seeded.opd_id,
    )
    profile = UserProfile(
        email=user.email,
        role="super_admin",
        opd_id=seeded.opd_id,
        opd_name=seeded.opd_name,
        display_name=user.display_name,
    )
    api_app.dependency_overrides[get_current_user] = lambda: profile

    with TestClient(api_app) as client:
        response = client.patch(
            "/api/v1/auth/me/opd",
            json={"opd_id": seeded.other_opd_id},
        )

    assert response.status_code == 200
    assert response.json()["opd_name"] == OTHER_OPD_NAME
    assert response.json()["is_super_admin"] is True

    db_session.refresh(user)
    assert user.opd_id == seeded.other_opd_id

    audit = db_session.scalar(
        select(AuditLog).where(
            AuditLog.action == "CHANGE_ACTIVE_OPD",
            AuditLog.user_email == "teguhe@gmail.com",
        )
    )
    assert audit is not None
