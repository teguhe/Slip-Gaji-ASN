"""Pengujian endpoint HTTP import Excel dan pembacaan slip."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy import desc, func, select

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
            f"/api/v1/payroll/{NIP}", params={"period": "2026-15"}
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
    assert "SLIP GAJI ASN" in root.text
    assert "aero.css" in root.text
    assert css.status_code == 200
    assert js.status_code == 200


def test_create_penyesuaian_gaji_manual_nama(api_app, db_session, seeded, bendahara_profile):
    api_app.dependency_overrides[get_current_user] = lambda: bendahara_profile
    with TestClient(api_app) as client:
        res = client.post(
            "/api/v1/payroll/penyesuaian",
            json={
                "nip": "198001012005011003",
                "nama": "Ahmad Yani Manual",
                "period": "2026-10",
                "jenis_penyesuaian": "Tunda Bayar",
                "nominal": "1500000.00",
                "status": "ditunda",
                "keterangan": "Rekening retur",
            },
        )
        assert res.status_code == 201, res.text
        data = res.json()
        assert data["nip"] == "198001012005011003"
        assert data["nama"] == "Ahmad Yani Manual"
        assert Decimal(str(data["nominal"])) == Decimal("1500000.00")
        assert data["period"] == "2026-10"


def test_get_payroll_includes_rincian_penyesuaian(
    api_app, db_session, seeded, bendahara_profile
):
    import_simgaji_excel(
        content=make_excel([make_row()]),
        filename="simgaji.xlsx",
        user=bendahara_profile,
        db=db_session,
    )
    api_app.dependency_overrides[get_current_user] = lambda: bendahara_profile
    api_app.dependency_overrides[get_auth_context] = lambda: AuthContext(
        kind="user", user=bendahara_profile
    )
    with TestClient(api_app) as client:
        client.post(
            "/api/v1/payroll/penyesuaian",
            json={
                "nip": NIP,
                "nama": "Ahmad Yani",
                "period": "2026-10",
                "jenis_penyesuaian": "Tunda Bayar",
                "nominal": "500000.00",
                "status": "ditunda",
                "keterangan": "Rekening terblokir",
            },
        )
        res = client.get(f"/api/v1/payroll/{NIP}", params={"period": "2026-10"})
        assert res.status_code == 200, res.text
        data = res.json()
        assert "rincian_penyesuaian" in data
        assert len(data["rincian_penyesuaian"]) == 1
        item = data["rincian_penyesuaian"][0]
        assert item["jenis_penyesuaian"] == "Tunda Bayar"
        assert item["keterangan"] == "Rekening terblokir"
        assert Decimal(str(item["nominal"])) == Decimal("500000.00")


def test_endpoint_inspect_excel(api_app, db_session, seeded, bendahara_profile):
    api_app.dependency_overrides[get_current_user] = lambda: bendahara_profile
    with TestClient(api_app) as client:
        # 1. Single OPD matching
        res = client.post(
            "/api/v1/payroll/inspect-excel",
            files={"file": ("simgaji.xlsx", make_excel([make_row(tglgaji=date(2026, 10, 1))]), EXCEL_MIME)},
        )
        assert res.status_code == 200, res.text
        data = res.json()
        assert data["status"] == "success"
        assert data["period"] == "2026-10"
        assert "Oktober 2026" in data["period_label"]
        assert data["opd"] == seeded.opd_name
        assert data["is_opd_match"] is True

        # 2. Multi-OPD file: contains another OPD first, but also contains user's OPD
        row_other = make_row(tglgaji=date(2026, 10, 1), nmskpd="BADAN KEPEGAWAIAN DAN PENGEMBANGAN SDM", nip="199001012015011001")
        row_user = make_row(tglgaji=date(2026, 10, 1), nmskpd=seeded.opd_name, nip="199001012015011002")
        multi_content = make_excel([row_other, row_user])
        res_multi = client.post(
            "/api/v1/payroll/inspect-excel",
            files={"file": ("multi_opd.xlsx", multi_content, EXCEL_MIME)},
        )
        assert res_multi.status_code == 200, res_multi.text
        data_multi = res_multi.json()
        assert data_multi["status"] == "success"
        assert data_multi["is_opd_match"] is True
        assert data_multi["opd"] == seeded.opd_name
        assert "baris data OPD lain akan dilewati" in (data_multi["warning"] or "")

        # 3. File with completely different OPD
        diff_content = make_excel([row_other])
        res_diff = client.post(
            "/api/v1/payroll/inspect-excel",
            files={"file": ("diff_opd.xlsx", diff_content, EXCEL_MIME)},
        )
        assert res_diff.status_code == 200, res_diff.text
        data_diff = res_diff.json()
        assert data_diff["status"] == "success"
        assert data_diff["is_opd_match"] is False
        assert "Tidak ditemukan data ASN untuk OPD akun Anda" in (data_diff["warning"] or "")


def test_endpoint_available_periods_and_dashboard_recap(api_app, db_session, seeded, bendahara_profile):
    api_app.dependency_overrides[get_current_user] = lambda: bendahara_profile
    api_app.dependency_overrides[get_auth_context] = lambda: AuthContext(
        kind="user",
        user=bendahara_profile,
    )
    # Import 2 periods
    import_simgaji_excel(
        content=make_excel([make_row(tglgaji=date(2025, 1, 1), nip="196812211991011001")]),
        filename="simgaji1.xlsx",
        user=bendahara_profile,
        db=db_session,
    )
    import_simgaji_excel(
        content=make_excel([make_row(tglgaji=date(2026, 10, 1), nip="196812211991011001")]),
        filename="simgaji2.xlsx",
        user=bendahara_profile,
        db=db_session,
    )

    with TestClient(api_app) as client:
        # Test /api/v1/payroll/periods
        res = client.get("/api/v1/payroll/periods")
        assert res.status_code == 200, res.text
        periods_data = res.json()
        assert periods_data["total_months"] == 2
        assert periods_data["oldest_period"] == "2025-01"
        assert periods_data["newest_period"] == "2026-10"
        assert periods_data["available_periods"] == ["2025-01", "2026-10"]

        # Test /api/v1/dashboard/summary
        dash_res = client.get("/api/v1/dashboard/summary?period=2026-10")
        assert dash_res.status_code == 200, dash_res.text
        dash_data = dash_res.json()
        assert "period_recap" in dash_data
        recap = dash_data["period_recap"]
        assert recap["total_months"] == 2
        assert recap["oldest_period"] == "2025-01"
        assert recap["newest_period"] == "2026-10"

        # Verify trend
        assert "trend" in dash_data
        assert len(dash_data["trend"]) == 2
        assert dash_data["trend"][0]["period"] == "2025-01"
        assert dash_data["trend"][1]["period"] == "2026-10"
        assert Decimal(str(dash_data["trend"][1]["value"])) > Decimal("0")


def test_audit_log_captures_client_ip_from_headers(api_app, db_session, seeded, bendahara_profile):
    api_app.dependency_overrides[get_current_user] = lambda: bendahara_profile
    api_app.dependency_overrides[get_auth_context] = lambda: AuthContext(
        kind="user",
        user=bendahara_profile,
    )

    with TestClient(api_app) as client:
        res = client.get(
            "/api/v1/dashboard/summary?period=2026-10",
            headers={"X-Forwarded-For": "192.168.1.100, 10.0.0.1"},
        )
        assert res.status_code == 200

        log = db_session.scalar(
            select(AuditLog)
            .where(AuditLog.action == "READ_DASHBOARD_SUMMARY")
            .order_by(desc(AuditLog.id))
        )
        assert log is not None
        assert log.ip_address == "192.168.1.100"


def test_special_periods_gaji_13_and_thr():
    from app.services.periods import parse_period, period_str, add_months
    from app.services.payroll_summary import format_period_label
    import datetime

    # Gaji 13
    d13 = parse_period("2026-13")
    assert d13 == datetime.date(2026, 12, 13)
    assert period_str(d13) == "2026-13"
    assert format_period_label("2026-13") == "Gaji 13 2026"
    assert add_months(d13, 1) == datetime.date(2026, 12, 14)

    # Gaji THR
    d14 = parse_period("2026-14")
    assert d14 == datetime.date(2026, 12, 14)
    assert period_str(d14) == "2026-14"
    assert format_period_label("2026-14") == "Gaji THR 2026"
    assert add_months(d14, 1) == datetime.date(2026, 12, 15)

    # Regular December does not collide
    d12 = parse_period("2026-12")
    assert d12 == datetime.date(2026, 12, 1)
    assert add_months(d12, 1) == datetime.date(2026, 12, 13)


def test_print_master_users_logs_audit_action_super_admin(
    api_app, db_session, seeded, super_admin_profile
):
    api_app.dependency_overrides[get_current_user] = lambda: super_admin_profile
    api_app.dependency_overrides[get_auth_context] = lambda: AuthContext(
        kind="user",
        user=super_admin_profile,
    )

    with TestClient(api_app) as client:
        res = client.post(
            "/api/v1/master/users/print-log",
            json={
                "total_users": 5,
                "filter_role": "bendahara_opd",
                "filter_status": "active",
                "print_date": "2026-11-24 10:30:00",
                "title": "DAFTAR BENDAHARA OPD",
            },
            headers={"X-Forwarded-For": "192.168.1.55"},
        )
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "success"

        log = db_session.scalar(
            select(AuditLog)
            .where(AuditLog.action == "PRINT_USERS_REPORT")
            .order_by(desc(AuditLog.id))
        )
        assert log is not None
        assert log.user_email == super_admin_profile.email
        assert log.details["total_users"] == 5
        assert log.details["filter_role"] == "bendahara_opd"
        assert log.details["filter_status"] == "active"
        assert log.details["print_date"] == "2026-11-24 10:30:00"
        assert log.ip_address == "192.168.1.55"


def test_print_master_users_forbidden_for_bendahara(
    api_app, db_session, seeded, bendahara_profile
):
    api_app.dependency_overrides[get_current_user] = lambda: bendahara_profile
    api_app.dependency_overrides[get_auth_context] = lambda: AuthContext(
        kind="user",
        user=bendahara_profile,
    )

    with TestClient(api_app) as client:
        res = client.post(
            "/api/v1/master/users/print-log",
            json={"total_users": 10},
        )
        assert res.status_code == 403


def test_import_master_opd_excel_super_admin(
    api_app, db_session, seeded, super_admin_profile
):
    import io
    import pandas as pd
    from app.models import RefOpd

    api_app.dependency_overrides[get_current_user] = lambda: super_admin_profile
    api_app.dependency_overrides[get_auth_context] = lambda: AuthContext(
        kind="user",
        user=super_admin_profile,
    )

    # Buat Excel di memori: 1 nama OPD yang sudah ada (seeded.opd_name), 2 nama OPD baru
    df = pd.DataFrame({
        "Nama OPD": [
            seeded.opd_name,  # sudah ada -> harus di-skip
            "DINAS KESEHATAN KOTA",  # baru -> di-import
            "DINAS PERHUBUNGAN KOTA",  # baru -> di-import
            "DINAS KESEHATAN KOTA",  # duplikat dalam batch -> harus di-skip
        ]
    })
    buffer = io.BytesIO()
    df.to_excel(buffer, index=False)
    buffer.seek(0)

    with TestClient(api_app) as client:
        res = client.post(
            "/api/v1/master/opd/import",
            files={"file": ("daftar_opd.xlsx", buffer, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
            headers={"X-Forwarded-For": "192.168.1.88"},
        )
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "success"
        assert data["total_rows"] == 4
        assert data["imported"] == 2
        assert data["skipped"] == 2

        # Verifikasi data tersimpan di DB
        dinkes = db_session.scalar(select(RefOpd).where(RefOpd.nmskpd == "DINAS KESEHATAN KOTA"))
        assert dinkes is not None

        # Verifikasi masuk audit log
        log = db_session.scalar(
            select(AuditLog)
            .where(AuditLog.action == "IMPORT_MASTER_OPD")
            .order_by(desc(AuditLog.id))
        )
        assert log is not None
        assert log.details["imported"] == 2
        assert log.details["skipped"] == 2
        assert log.ip_address == "192.168.1.88"


def test_import_master_opd_forbidden_for_bendahara(
    api_app, db_session, seeded, bendahara_profile
):
    api_app.dependency_overrides[get_current_user] = lambda: bendahara_profile
    api_app.dependency_overrides[get_auth_context] = lambda: AuthContext(
        kind="user",
        user=bendahara_profile,
    )

    with TestClient(api_app) as client:
        res = client.post(
            "/api/v1/master/opd/import",
            files={"file": ("opd.xlsx", b"dummy", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        )
        assert res.status_code == 403


def test_print_master_opd_logs_audit_action_super_admin(
    api_app, db_session, seeded, super_admin_profile
):
    api_app.dependency_overrides[get_current_user] = lambda: super_admin_profile
    api_app.dependency_overrides[get_auth_context] = lambda: AuthContext(
        kind="user",
        user=super_admin_profile,
    )

    with TestClient(api_app) as client:
        res = client.post(
            "/api/v1/master/opd/print-log",
            json={
                "total_opd": 35,
                "print_date": "2026-11-24 10:35:00",
                "title": "DAFTAR OPD PEMKOT",
            },
            headers={"X-Forwarded-For": "192.168.1.99"},
        )
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "success"

        log = db_session.scalar(
            select(AuditLog)
            .where(AuditLog.action == "PRINT_OPD_REPORT")
            .order_by(desc(AuditLog.id))
        )
        assert log is not None
        assert log.user_email == super_admin_profile.email
        assert log.details["total_opd"] == 35
        assert log.ip_address == "192.168.1.99"


def test_print_master_opd_forbidden_for_bendahara(
    api_app, db_session, seeded, bendahara_profile
):
    api_app.dependency_overrides[get_current_user] = lambda: bendahara_profile
    api_app.dependency_overrides[get_auth_context] = lambda: AuthContext(
        kind="user",
        user=bendahara_profile,
    )

    with TestClient(api_app) as client:
        res = client.post(
            "/api/v1/master/opd/print-log",
            json={"total_opd": 35},
        )
        assert res.status_code == 403


def test_database_stats_and_backup_super_admin(
    api_app, db_session, seeded, super_admin_profile
):
    import datetime
    from app.models import PayrollMonthly

    # Seed data payroll dummy
    pm = PayrollMonthly(
        tglgaji=datetime.date(2026, 10, 1),
        nip="198001012005011001",
        nama="Pegawai Test",
        nmskpd=seeded.opd_name,
        gapok=Decimal("4000000.00"),
        kotor=Decimal("5000000.00"),
        bersih=Decimal("4500000.00"),
        imported_by="test@example.com",
    )
    db_session.add(pm)
    db_session.commit()

    api_app.dependency_overrides[get_current_user] = lambda: super_admin_profile
    api_app.dependency_overrides[get_auth_context] = lambda: AuthContext(
        kind="user",
        user=super_admin_profile,
    )

    with TestClient(api_app) as client:
        # 1. Stats
        res_stats = client.get("/api/v1/database/stats")
        assert res_stats.status_code == 200
        stats = res_stats.json()
        assert stats["ref_opd"] >= 1
        assert stats["payroll_monthly"] >= 1

        # 2. Backup
        res_backup = client.get("/api/v1/database/backup", headers={"X-Forwarded-For": "10.0.0.12"})
        assert res_backup.status_code == 200
        backup_data = res_backup.json()
        assert "tables" in backup_data
        assert "counts" in backup_data
        assert len(backup_data["tables"]["ref_opd"]) >= 1

        # Verifikasi audit log backup
        log = db_session.scalar(
            select(AuditLog)
            .where(AuditLog.action == "DATABASE_BACKUP")
            .order_by(desc(AuditLog.id))
        )
        assert log is not None
        assert log.user_email == super_admin_profile.email
        assert log.ip_address == "10.0.0.12"


def test_database_restore_super_admin(
    api_app, db_session, seeded, super_admin_profile
):
    import io
    import json

    api_app.dependency_overrides[get_current_user] = lambda: super_admin_profile
    api_app.dependency_overrides[get_auth_context] = lambda: AuthContext(
        kind="user",
        user=super_admin_profile,
    )

    with TestClient(api_app) as client:
        res_backup = client.get("/api/v1/database/backup")
        backup_data = res_backup.json()

        buffer = io.BytesIO(json.dumps(backup_data).encode("utf-8"))
        res_restore = client.post(
            "/api/v1/database/restore",
            files={"file": ("backup.json", buffer, "application/json")},
            headers={"X-Forwarded-For": "10.0.0.15"},
        )
        assert res_restore.status_code == 200
        data = res_restore.json()
        assert data["status"] == "success"

        # Verifikasi audit log restore
        log = db_session.scalar(
            select(AuditLog)
            .where(AuditLog.action == "DATABASE_RESTORE")
            .order_by(desc(AuditLog.id))
        )
        assert log is not None
        assert log.user_email == super_admin_profile.email
        assert log.ip_address == "10.0.0.15"

        # Restore selektif (hanya payroll & penyesuaian)
        buffer_selective = io.BytesIO(json.dumps(backup_data).encode("utf-8"))
        res_selective = client.post(
            "/api/v1/database/restore",
            files={"file": ("backup.json", buffer_selective, "application/json")},
            data={"tables": json.dumps(["payroll", "penyesuaian"])},
            headers={"X-Forwarded-For": "10.0.0.16"},
        )
        assert res_selective.status_code == 200
        data_sel = res_selective.json()
        assert data_sel["status"] == "success"
        assert "payroll_monthly" in data_sel["restored_counts"]
        assert "ref_opd" not in data_sel["restored_counts"]


def test_database_delete_per_opd_period_super_admin(
    api_app, db_session, seeded, super_admin_profile
):
    import datetime
    from app.models import PayrollMonthly

    pm = PayrollMonthly(
        tglgaji=datetime.date(2026, 10, 1),
        nip="198001012005011002",
        nama="Pegawai Delete Test",
        nmskpd=seeded.opd_name,
        gapok=Decimal("4000000.00"),
        kotor=Decimal("5000000.00"),
        bersih=Decimal("4500000.00"),
        imported_by="test@example.com",
    )
    db_session.add(pm)
    db_session.commit()

    api_app.dependency_overrides[get_current_user] = lambda: super_admin_profile
    api_app.dependency_overrides[get_auth_context] = lambda: AuthContext(
        kind="user",
        user=super_admin_profile,
    )

    with TestClient(api_app) as client:
        res = client.post(
            "/api/v1/database/delete-period",
            json={
                "opd_name": seeded.opd_name,
                "period": "2026-10",
                "delete_payroll": True,
                "delete_potongan": True,
                "delete_penyesuaian": True,
            },
            headers={"X-Forwarded-For": "10.0.0.20"},
        )
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "success"

        # Verifikasi audit log
        log = db_session.scalar(
            select(AuditLog)
            .where(AuditLog.action == "DATABASE_DELETE_PER_OPD_PERIOD")
            .order_by(desc(AuditLog.id))
        )
        assert log is not None
        assert log.details["opd_name"] == seeded.opd_name
        assert log.details["period"] == "2026-10"


def test_database_wipe_checklist_super_admin(
    api_app, db_session, seeded, super_admin_profile
):
    api_app.dependency_overrides[get_current_user] = lambda: super_admin_profile
    api_app.dependency_overrides[get_auth_context] = lambda: AuthContext(
        kind="user",
        user=super_admin_profile,
    )

    with TestClient(api_app) as client:
        res = client.post(
            "/api/v1/database/wipe",
            json={
                "tables": ["payroll", "penyesuaian"],
                "confirmation": True,
            },
            headers={"X-Forwarded-For": "10.0.0.25"},
        )
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "success"

        # Verifikasi audit log
        log = db_session.scalar(
            select(AuditLog)
            .where(AuditLog.action == "DATABASE_WIPE_SELECTED")
            .order_by(desc(AuditLog.id))
        )
        assert log is not None
        assert "payroll" in log.details["selected_categories"]


def test_database_endpoints_forbidden_for_bendahara(
    api_app, db_session, seeded, bendahara_profile
):
    api_app.dependency_overrides[get_current_user] = lambda: bendahara_profile
    api_app.dependency_overrides[get_auth_context] = lambda: AuthContext(
        kind="user",
        user=bendahara_profile,
    )

    with TestClient(api_app) as client:
        assert client.get("/api/v1/database/stats").status_code == 403
        assert client.get("/api/v1/database/backup").status_code == 403
        assert client.post("/api/v1/database/restore", files={"file": ("b.json", b"{}", "application/json")}).status_code == 403
        assert client.post("/api/v1/database/wipe", json={"tables": ["payroll"], "confirmation": True}).status_code == 403
        assert client.post("/api/v1/database/delete-period", json={"opd_name": "Dinkes", "period": "2026-10"}).status_code == 403





