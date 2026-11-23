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


def test_bendahara_cannot_self_assign_opd(api_app, db_session, seeded):
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
        res = client.patch(
            "/api/v1/auth/me/opd",
            json={"opd_id": seeded.opd_id},
        )
        assert res.status_code == 403
        assert "Super Admin" in res.json()["detail"]

    db_session.refresh(user)
    assert user.opd_id is None


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


def test_get_and_update_settings(api_app, db_session, seeded):
    user = _new_user(
        db_session,
        "bendahara_setting@example.com",
        role="bendahara_opd",
        opd_id=seeded.opd_id,
    )
    profile = UserProfile(
        email=user.email,
        role="bendahara_opd",
        opd_id=seeded.opd_id,
        opd_name=seeded.opd_name,
        display_name=user.display_name,
    )
    api_app.dependency_overrides[get_current_user] = lambda: profile

    with TestClient(api_app) as client:
        # 1. GET settings default
        res = client.get("/api/v1/auth/settings")
        assert res.status_code == 200
        assert res.json()["jabatan"] == "Bendahara Pengeluaran"

        # 2. PUT settings
        payload = {
            "jabatan": "Plt. Bendahara Pengeluaran",
            "nama_bendahara": "Siti Nurhaliza, S.E.",
            "nip_bendahara": "19850515 201001 2 005",
        }
        update_res = client.put("/api/v1/auth/settings", json=payload)
        assert update_res.status_code == 200
        data = update_res.json()
        assert data["jabatan"] == "Plt. Bendahara Pengeluaran"
        assert data["nama_bendahara"] == "Siti Nurhaliza, S.E."
        assert data["nip_bendahara"] == "19850515 201001 2 005"

        # 3. GET /me juga mencakup field pengaturan yang tersimpan
        me_res = client.get("/api/v1/auth/me")
        assert me_res.status_code == 200
        me_data = me_res.json()
        assert me_data["jabatan"] == "Plt. Bendahara Pengeluaran"
        assert me_data["nama_bendahara"] == "Siti Nurhaliza, S.E."
        assert me_data["nip_bendahara"] == "19850515 201001 2 005"

        # 4. PUT settings dengan nilai kosong akan mereset nama/nip ke None dan jabatan ke default
        reset_res = client.put(
            "/api/v1/auth/settings",
            json={"jabatan": "   ", "nama_bendahara": "   ", "nip_bendahara": ""},
        )
        assert reset_res.status_code == 200
        reset_data = reset_res.json()
        assert reset_data["jabatan"] == "Bendahara Pengeluaran"
        assert reset_data["nama_bendahara"] is None
        assert reset_data["nip_bendahara"] is None

    db_session.refresh(user)
    assert user.jabatan == "Bendahara Pengeluaran"
    assert user.nama_bendahara is None
    assert user.nip_bendahara is None
