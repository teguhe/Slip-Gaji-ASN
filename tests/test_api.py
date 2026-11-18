"""Pengujian endpoint HTTP import Excel dan pembacaan slip."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.auth import AuthContext, get_auth_context, get_current_user
from app.models import (
    AuditLog,
    PayrollMonthly,
    PayrollPotonganItem,
    PotonganBerjangka,
    RefPosPotongan,
)
from app.services.simgaji_import import import_simgaji_excel
from tests.conftest import OTHER_OPD_NAME, SECOND_NIP
from tests.helpers import make_excel, make_row

NIP = "196812211991011001"
EXCEL_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _post(api_app, content: bytes, filename: str = "simgaji.xlsx", headers=None):
    with TestClient(api_app) as client:
        return client.post(
            "/api/v1/payroll/import-excel",
            files={"file": (filename, content, EXCEL_MIME)},
            headers=headers or {},
        )


def test_endpoint_import_success(api_app, db_session, seeded, bendahara_profile):
    api_app.dependency_overrides[get_current_user] = lambda: bendahara_profile

    response = _post(api_app, make_excel([make_row()]))

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "success"
    assert body["opd"] == seeded.opd_name
    assert body["inserted"] == 1
    assert body["updated"] == 0
    assert body["periods"] == ["2026-10"]
    assert body["imported_by"] == seeded.user_email

    assert db_session.scalar(select(func.count()).select_from(PayrollMonthly)) == 1


def test_endpoint_rejects_opd_mismatch(api_app, db_session, seeded, bendahara_profile):
    api_app.dependency_overrides[get_current_user] = lambda: bendahara_profile

    response = _post(api_app, make_excel([make_row(nmskpd=OTHER_OPD_NAME)]))

    assert response.status_code == 403
    detail = response.json()["detail"]
    assert "tidak cocok" in detail["message"].lower()
    assert db_session.scalar(select(func.count()).select_from(PayrollMonthly)) == 0


def test_endpoint_rejects_missing_column(api_app, bendahara_profile):
    api_app.dependency_overrides[get_current_user] = lambda: bendahara_profile

    response = _post(
        api_app,
        make_excel([make_row()], drop_columns=("kotor",)),
    )

    assert response.status_code == 400
    body = response.json()["detail"]
    assert "kotor" in body["message"]
    assert body["errors"] == []


def test_endpoint_rejects_wrong_extension(api_app, bendahara_profile):
    api_app.dependency_overrides[get_current_user] = lambda: bendahara_profile

    response = _post(api_app, make_excel([make_row()]), filename="simgaji.csv")

    assert response.status_code == 415


def test_endpoint_rejects_empty_file(api_app, bendahara_profile):
    api_app.dependency_overrides[get_current_user] = lambda: bendahara_profile

    response = _post(api_app, b"")

    assert response.status_code == 400


def test_endpoint_rejects_service_token(api_app):
    # Service token boleh untuk integrasi GET, tetapi bukan untuk import dashboard.
    response = _post(
        api_app,
        make_excel([make_row()]),
        headers={"Authorization": "Bearer test-internal-key"},
    )

    assert response.status_code == 403


def test_endpoint_requires_authentication(api_app):
    response = _post(api_app, make_excel([make_row()]))
    assert response.status_code == 401


def _seed_potongan(db_session, seeded) -> PayrollMonthly:
    payroll = db_session.scalar(select(PayrollMonthly))
    assert payroll is not None

    pos_bulanan = RefPosPotongan(
        opd_id=seeded.opd_id,
        nama_pos="Iuran KORPRI",
        kategori="bulanan",
        is_active=True,
    )
    pos_berjangka = RefPosPotongan(
        opd_id=seeded.opd_id,
        nama_pos="Pinjaman Bank Jateng",
        kategori="berjangka",
        is_active=True,
    )
    db_session.add_all([pos_bulanan, pos_berjangka])
    db_session.flush()

    berjangka = PotonganBerjangka(
        nip=payroll.nip,
        pos_id=pos_berjangka.id,
        nominal_per_bulan=Decimal("1200000.00"),
        start_period=date(2025, 9, 1),
        tenor_bulan=36,
        end_period=date(2028, 8, 1),
        keterangan="Pinjaman modal",
        created_by=seeded.user_email,
    )
    db_session.add(berjangka)
    db_session.flush()

    db_session.add_all(
        [
            PayrollPotonganItem(
                payroll_id=payroll.id,
                nip=payroll.nip,
                period=date(2026, 10, 1),
                pos_id=pos_bulanan.id,
                nominal=Decimal("20000.00"),
                created_by=seeded.user_email,
            ),
            PayrollPotonganItem(
                payroll_id=payroll.id,
                nip=payroll.nip,
                period=date(2026, 10, 1),
                pos_id=pos_berjangka.id,
                berjangka_id=berjangka.id,
                cicilan_ke=14,
                nominal=Decimal("1200000.00"),
                created_by=seeded.user_email,
            ),
        ]
    )
    db_session.commit()
    return payroll


def test_get_payroll_calculates_thp_and_cicilan(
    api_app, db_session, seeded, bendahara_profile
):
    import_simgaji_excel(
        content=make_excel([make_row()]),
        filename="simgaji.xlsx",
        user=bendahara_profile,
        db=db_session,
    )
    _seed_potongan(db_session, seeded)

    api_app.dependency_overrides[get_auth_context] = lambda: AuthContext(
        kind="user", user=bendahara_profile
    )

    with TestClient(api_app) as client:
        response = client.get(
            f"/api/v1/payroll/{NIP}", params={"period": "2026-10"}
        )

    assert response.status_code == 200, response.text
    body = response.json()
    assert Decimal(body["penghasilan_kotor"]) == Decimal("6365272.92")
    assert Decimal(body["potongan_simgaji"]) == Decimal("812472.37")
    assert Decimal(body["potongan_internal"]) == Decimal("1220000.00")
    assert Decimal(body["total_potongan"]) == Decimal("2032472.37")
    assert Decimal(body["take_home_pay"]) == Decimal("4332800.55")
    assert Decimal(body["rincian_penghasilan"]["gapok"]) == Decimal("5235000.55")
    assert Decimal(body["rincian_penghasilan"]["tjistri"]) == Decimal("523500.00")
    assert Decimal(body["rincian_potongan_simgaji"]["iwp_beban_pegawai"]) == Decimal("58632.37")
    assert Decimal(body["rincian_potongan_simgaji"]["iwp_taspen"]) == Decimal("469056.00")

    rincian = {item["pos_nama"]: item for item in body["rincian_potongan_internal"]}
    assert rincian["Pinjaman Bank Jateng"]["cicilan_info"] == "Cicilan 14 dari 36"
    assert rincian["Pinjaman Bank Jateng"]["keterangan"] == "Pinjaman modal"


def test_get_payroll_hides_other_opd(
    api_app, db_session, seeded, bendahara_profile, super_admin_profile
):
    import_simgaji_excel(
        content=make_excel([make_row(nmskpd=OTHER_OPD_NAME, nip=SECOND_NIP)]),
        filename="simgaji.xlsx",
        user=super_admin_profile,
        db=db_session,
    )

    api_app.dependency_overrides[get_auth_context] = lambda: AuthContext(
        kind="user", user=bendahara_profile
    )

    with TestClient(api_app) as client:
        response = client.get(
            f"/api/v1/payroll/{SECOND_NIP}", params={"period": "2026-10"}
        )
    assert response.status_code == 403
    assert "tidak berhak" in response.json()["detail"].lower()

    audit = db_session.scalar(
        select(AuditLog).where(
            AuditLog.action == "READ_PAYROLL_DENIED",
            AuditLog.record_id != None,  # noqa: E711
        )
    )
    assert audit is not None


def test_get_payroll_super_admin_can_read_other_opd(
    api_app, db_session, seeded, super_admin_profile
):
    import_simgaji_excel(
        content=make_excel([make_row(nmskpd=OTHER_OPD_NAME, nip=SECOND_NIP)]),
        filename="simgaji.xlsx",
        user=super_admin_profile,
        db=db_session,
    )

    api_app.dependency_overrides[get_auth_context] = lambda: AuthContext(
        kind="user", user=super_admin_profile
    )

    with TestClient(api_app) as client:
        response = client.get(
            f"/api/v1/payroll/{SECOND_NIP}", params={"period": "2026-10"}
        )

    assert response.status_code == 200, response.text
    assert response.json()["opd"] == OTHER_OPD_NAME


def test_get_payroll_rejects_invalid_period(api_app, bendahara_profile):
    api_app.dependency_overrides[get_auth_context] = lambda: AuthContext(
        kind="user", user=bendahara_profile
    )
    with TestClient(api_app) as client:
        response = client.get(
            f"/api/v1/payroll/{NIP}", params={"period": "2026-13"}
        )
    assert response.status_code == 422


def test_dashboard_summary_isolates_opd(
    api_app,
    db_session,
    seeded,
    bendahara_profile,
    super_admin_profile,
):
    import_simgaji_excel(
        content=make_excel([make_row()]),
        filename="simgaji.xlsx",
        user=bendahara_profile,
        db=db_session,
    )
    _seed_potongan(db_session, seeded)
    import_simgaji_excel(
        content=make_excel([make_row(nmskpd=OTHER_OPD_NAME, nip=SECOND_NIP)]),
        filename="simgaji-lain.xlsx",
        user=super_admin_profile,
        db=db_session,
    )

    api_app.dependency_overrides[get_auth_context] = lambda: AuthContext(
        kind="user", user=bendahara_profile
    )
    with TestClient(api_app) as client:
        response = client.get(
            "/api/v1/dashboard/summary", params={"period": "2026-10"}
        )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["opd"] == seeded.opd_name
    assert body["totals"]["pegawai"] == 1
    assert len(body["employees"]) == 1
    assert body["employees"][0]["nip"] == NIP
    assert Decimal(body["totals"]["penghasilan_kotor"]) == Decimal("6365272.92")
    assert Decimal(body["totals"]["potongan_internal"]) == Decimal("1220000.00")
    assert Decimal(body["totals"]["take_home_pay"]) == Decimal("4332800.55")

    # Super admin tanpa filter OPD melihat seluruh OPD.
    api_app.dependency_overrides[get_auth_context] = lambda: AuthContext(
        kind="user", user=super_admin_profile
    )
    with TestClient(api_app) as client:
        all_response = client.get(
            "/api/v1/dashboard/summary", params={"period": "2026-10"}
        )
    assert all_response.status_code == 200
    assert all_response.json()["opd"] == "Semua OPD"
    assert all_response.json()["totals"]["pegawai"] == 2


def test_opd_summary_batch_isolated_and_audited(
    api_app,
    db_session,
    seeded,
    bendahara_profile,
    super_admin_profile,
):
    import_simgaji_excel(
        content=make_excel([make_row()]),
        filename="simgaji.xlsx",
        user=bendahara_profile,
        db=db_session,
    )
    import_simgaji_excel(
        content=make_excel([make_row(nmskpd=OTHER_OPD_NAME, nip=SECOND_NIP)]),
        filename="simgaji-lain.xlsx",
        user=super_admin_profile,
        db=db_session,
    )

    api_app.dependency_overrides[get_auth_context] = lambda: AuthContext(
        kind="user", user=bendahara_profile
    )
    with TestClient(api_app) as client:
        response = client.get(
            "/api/v1/payroll/opd/summary",
            params={"period": "2026-10"},
        )
        forbidden = client.get(
            "/api/v1/payroll/opd/summary",
            params={"period": "2026-10", "opd": OTHER_OPD_NAME},
        )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["opd"] == seeded.opd_name
    assert body["totals"]["pegawai"] == 1
    assert len(body["employees"]) == 1
    assert body["employees"][0]["nip"] == NIP
    assert forbidden.status_code == 403

    audit = db_session.scalar(
        select(AuditLog).where(
            AuditLog.action == "READ_PAYROLL_OPD_SUMMARY",
            AuditLog.user_email == seeded.user_email,
        )
    )
    assert audit is not None
    assert audit.details["count"] == 1


def test_external_api_key_header_and_audit(
    api_app,
    db_session,
    seeded,
    bendahara_profile,
):
    import_simgaji_excel(
        content=make_excel([make_row()]),
        filename="simgaji.xlsx",
        user=bendahara_profile,
        db=db_session,
    )

    with TestClient(api_app) as client:
        response = client.get(
            f"/api/v1/payroll/{NIP}",
            params={"period": "2026-10"},
            headers={"X-API-Key": "test-internal-key"},
        )
        invalid = client.get(
            f"/api/v1/payroll/{NIP}",
            params={"period": "2026-10"},
            headers={"X-API-Key": "wrong-key"},
        )

    assert response.status_code == 200, response.text
    assert response.json()["nip"] == NIP
    assert invalid.status_code == 401

    audit = db_session.scalar(
        select(AuditLog).where(
            AuditLog.action == "READ_PAYROLL",
            AuditLog.user_email == "system:api-key",
        )
    )
    assert audit is not None
    assert audit.details["auth_method"] == "api_key"


def test_ui_root_and_static_assets_are_served(api_app):
    with TestClient(api_app) as client:
        root = client.get("/")
        css = client.get("/static/css/aero.css")
        js = client.get("/static/js/app.js")

    assert root.status_code == 200
    assert "SIMGAJI ASN" in root.text
    assert "aero.css" in root.text
    assert css.status_code == 200
    assert js.status_code == 200

