"""Pengujian Phase 3: pos potongan, tenor berjangka, dan import manual."""

from __future__ import annotations

from datetime import date
from decimal import Decimal
import uuid

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.auth import get_current_user
from app.models import (
    AuditLog,
    PayrollPotonganItem,
    PotonganBerjangka,
    RefPosPotongan,
)
from app.services.simgaji_import import import_simgaji_excel
from tests.conftest import OTHER_OPD_NAME, SECOND_NIP
from tests.helpers import make_excel, make_potongan_excel, make_row

NIP = "196812211991011001"
EXCEL_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _import_payroll(db_session, profile, *, period: date = date(2026, 10, 1), nip: str = NIP):
    return import_simgaji_excel(
        content=make_excel([make_row(tglgaji=period, nip=nip)]),
        filename="simgaji.xlsx",
        user=profile,
        db=db_session,
    )


def _pos(client: TestClient, nama: str, kategori: str = "bulanan") -> dict:
    response = client.post(
        "/api/v1/potongan/pos",
        json={"nama_pos": nama, "kategori": kategori},
    )
    assert response.status_code == 201, response.text
    return response.json()


def _loan(
    client: TestClient,
    *,
    nip: str,
    pos_id: int,
    nominal: str = "1200000.00",
    start_period: str = "2026-10",
    tenor: int = 36,
) -> dict:
    response = client.post(
        "/api/v1/potongan/berjangka",
        json={
            "nip": nip,
            "pos_id": pos_id,
            "nominal_per_bulan": nominal,
            "start_period": start_period,
            "tenor_bulan": tenor,
            "keterangan": "Pinjaman modal",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_pos_crud_and_audit(api_app, db_session, seeded, bendahara_profile):
    api_app.dependency_overrides[get_current_user] = lambda: bendahara_profile

    with TestClient(api_app) as client:
        pos = _pos(client, "Iuran KORPRI")
        assert pos["opd_id"] == seeded.opd_id
        assert pos["opd_nama"] == seeded.opd_name
        assert pos["kategori"] == "bulanan"
        assert pos["is_active"] is True

        # Duplikat case-insensitive + spasi harus ditolak.
        duplicate = client.post(
            "/api/v1/potongan/pos",
            json={"nama_pos": "  iuran korpri  ", "kategori": "bulanan"},
        )
        assert duplicate.status_code == 409

        listed = client.get("/api/v1/potongan/pos")
        assert listed.status_code == 200
        assert len(listed.json()) == 1

        updated = client.patch(
            f"/api/v1/potongan/pos/{pos['id']}",
            json={"nama_pos": "Iuran KORPRI Baru", "is_active": False},
        )
        assert updated.status_code == 200
        assert updated.json()["nama_pos"] == "Iuran KORPRI Baru"
        assert updated.json()["is_active"] is False

    audit_actions = set(
        db_session.scalars(
            select(AuditLog.action).where(
                AuditLog.action.in_(
                    [
                        "CREATE_POS_POTONGAN",
                        "UPDATE_POS_POTONGAN",
                    ]
                )
            )
        ).all()
    )
    assert "CREATE_POS_POTONGAN" in audit_actions
    assert "UPDATE_POS_POTONGAN" in audit_actions


def test_pos_isolation_between_opd(api_app, db_session, seeded, bendahara_profile):
    other_pos = RefPosPotongan(
        opd_id=seeded.other_opd_id,
        nama_pos="Pos OPD Lain",
        kategori="bulanan",
        is_active=True,
    )
    db_session.add(other_pos)
    db_session.commit()

    api_app.dependency_overrides[get_current_user] = lambda: bendahara_profile
    with TestClient(api_app) as client:
        listed = client.get("/api/v1/potongan/pos")
        assert listed.status_code == 200
        assert listed.json() == []

        forbidden = client.patch(
            f"/api/v1/potongan/pos/{other_pos.id}",
            json={"nama_pos": "Hack"},
        )
        assert forbidden.status_code == 404


def test_berjangka_end_period_and_generator(
    api_app,
    db_session,
    seeded,
    bendahara_profile,
):
    _import_payroll(db_session, bendahara_profile, period=date(2026, 10, 1))
    api_app.dependency_overrides[get_current_user] = lambda: bendahara_profile

    with TestClient(api_app) as client:
        pos = _pos(client, "Pinjaman Bank Jateng", "berjangka")
        loan = _loan(
            client,
            nip=NIP,
            pos_id=pos["id"],
            nominal="1200000.00",
            start_period="2026-10",
            tenor=36,
        )
        assert loan["start_period"] == "2026-10"
        assert loan["end_period"] == "2029-09"
        assert loan["tenor_bulan"] == 36
        assert loan["cicilan_ke"] == 1
        assert loan["sisa_bulan"] == 35

        audit = db_session.scalar(
            select(AuditLog).where(
                AuditLog.action == "CREATE_POTONGAN_BERJANGKA",
                AuditLog.record_id == loan["id"],
            )
        )
        assert audit is not None
        assert audit.details["end_period"] == "2029-09"

        # Belum ada realisasi sebelum periode diproses.
        assert (
            db_session.scalar(
                select(func.count()).select_from(PayrollPotonganItem)
            )
            == 0
        )

        generated = client.post(
            "/api/v1/potongan/berjangka/generate",
            json={"period": "2026-10"},
        )
        assert generated.status_code == 200, generated.text
        assert generated.json()["generated"] == 1

        item = db_session.scalar(select(PayrollPotonganItem))
        assert item is not None
        assert item.berjangka_id is not None
        assert item.cicilan_ke == 1
        assert item.nominal == Decimal("1200000.00")
        assert item.payroll_id is not None

        again = client.post(
            "/api/v1/potongan/berjangka/generate",
            json={"period": "2026-10"},
        )
        assert again.status_code == 200
        assert again.json()["generated"] == 0
        assert again.json()["skipped"] == 1
        assert (
            db_session.scalar(
                select(func.count()).select_from(PayrollPotonganItem)
            )
            == 1
        )

        # Import periode berikutnya otomatis merealisasikan cicilan ke-2.
        _import_payroll(db_session, bendahara_profile, period=date(2026, 11, 1))
        november_item = db_session.scalar(
            select(PayrollPotonganItem).where(
                PayrollPotonganItem.period == date(2026, 11, 1)
            )
        )
        assert november_item is not None
        assert november_item.cicilan_ke == 2
        assert november_item.nominal == Decimal("1200000.00")

        listed = client.get(
            "/api/v1/potongan/berjangka",
            params={"period": "2026-10"},
        )
        assert listed.status_code == 200
        assert listed.json()[0]["cicilan_ke"] == 1


def test_berjangka_36_months_ends_december_2029(
    api_app,
    db_session,
    seeded,
    bendahara_profile,
):
    _import_payroll(db_session, bendahara_profile, period=date(2026, 10, 1))
    api_app.dependency_overrides[get_current_user] = lambda: bendahara_profile

    with TestClient(api_app) as client:
        pos = _pos(client, "Koperasi Berjangka", "berjangka")
        loan = _loan(
            client,
            nip=NIP,
            pos_id=pos["id"],
            nominal="500000.00",
            start_period="2027-01",
            tenor=36,
        )
    assert loan["end_period"] == "2029-12"
    assert loan["sisa_bulan"] == 35


def test_berjangka_rejects_wrong_owner_or_category(
    api_app,
    db_session,
    seeded,
    bendahara_profile,
):
    _import_payroll(db_session, bendahara_profile, period=date(2026, 10, 1))
    other_pos = RefPosPotongan(
        opd_id=seeded.other_opd_id,
        nama_pos="Bank OPD Lain",
        kategori="berjangka",
        is_active=True,
    )
    monthly_pos = RefPosPotongan(
        opd_id=seeded.opd_id,
        nama_pos="Pos Bulanan",
        kategori="bulanan",
        is_active=True,
    )
    other_berjangka_pos = RefPosPotongan(
        opd_id=seeded.opd_id,
        nama_pos="Pinjaman Lain",
        kategori="berjangka",
        is_active=True,
    )
    db_session.add_all([other_pos, monthly_pos, other_berjangka_pos])
    db_session.commit()

    api_app.dependency_overrides[get_current_user] = lambda: bendahara_profile
    with TestClient(api_app) as client:
        foreign = client.post(
            "/api/v1/potongan/berjangka",
            json={
                "nip": NIP,
                "pos_id": other_pos.id,
                "nominal_per_bulan": "100000.00",
                "start_period": "2026-10",
                "tenor_bulan": 12,
            },
        )
        assert foreign.status_code == 404

        wrong_category = client.post(
            "/api/v1/potongan/berjangka",
            json={
                "nip": NIP,
                "pos_id": monthly_pos.id,
                "nominal_per_bulan": "100000.00",
                "start_period": "2026-10",
                "tenor_bulan": 12,
            },
        )
        assert wrong_category.status_code == 422

        unknown_nip = client.post(
            "/api/v1/potongan/berjangka",
            json={
                "nip": SECOND_NIP,
                "pos_id": other_berjangka_pos.id,
                "nominal_per_bulan": "100000.00",
                "start_period": "2026-10",
                "tenor_bulan": 12,
            },
        )
        assert unknown_nip.status_code == 404


def test_manual_potongan_import_upsert(
    api_app,
    db_session,
    seeded,
    bendahara_profile,
):
    _import_payroll(db_session, bendahara_profile, period=date(2026, 10, 1))
    api_app.dependency_overrides[get_current_user] = lambda: bendahara_profile

    with TestClient(api_app) as client:
        pos = _pos(client, "Infaq / Zakat", "bulanan")
        content = make_potongan_excel([{"nip": NIP, "nominal": "75.000"}])

        first = client.post(
            "/api/v1/potongan/import-excel",
            files={"file": ("potongan-okt.xlsx", content, EXCEL_MIME)},
            data={"pos_id": str(pos["id"]), "period": "2026-10"},
        )
        assert first.status_code == 200, first.text
        assert first.json()["inserted"] == 1
        assert first.json()["updated"] == 0

        item = db_session.scalar(
            select(PayrollPotonganItem).where(
                PayrollPotonganItem.nip == NIP,
                PayrollPotonganItem.period == date(2026, 10, 1),
                PayrollPotonganItem.pos_id == pos["id"],
            )
        )
        assert item is not None
        assert item.nominal == Decimal("75000.00")
        assert item.berjangka_id is None
        assert item.cicilan_ke is None
        assert item.payroll_id is not None

        second_content = make_potongan_excel([{"nip": NIP, "nominal": "80000.00"}])
        second = client.post(
            "/api/v1/potongan/import-excel",
            files={"file": ("potongan-okt.xlsx", second_content, EXCEL_MIME)},
            data={"pos_id": str(pos["id"]), "period": "2026-10"},
        )
        assert second.status_code == 200, second.text
        assert second.json()["inserted"] == 0
        assert second.json()["updated"] == 1
        assert (
            db_session.scalar(
                select(func.count())
                .select_from(PayrollPotonganItem)
                .where(
                    PayrollPotonganItem.pos_id == pos["id"],
                    PayrollPotonganItem.berjangka_id.is_(None),
                )
            )
            == 1
        )

        # NIP OPD lain tidak boleh masuk ke import OPD ini.
        bad_content = make_potongan_excel(
            [{"nip": SECOND_NIP, "nominal": "10000.00"}]
        )
        rejected = client.post(
            "/api/v1/potongan/import-excel",
            files={"file": ("potongan-okt.xlsx", bad_content, EXCEL_MIME)},
            data={"pos_id": str(pos["id"]), "period": "2026-10"},
        )
        assert rejected.status_code == 400
        assert "tidak termasuk" in rejected.json()["detail"]["message"].lower()

    audits = db_session.scalars(
        select(AuditLog)
        .where(AuditLog.action == "IMPORT_POTONGAN_MANUAL")
        .order_by(AuditLog.id)
    ).all()
    assert audits
    assert any(audit.details.get("inserted") == 1 for audit in audits)
    assert any(audit.details.get("updated") == 1 for audit in audits)


def test_berjangka_list_filters_by_opd(
    api_app,
    db_session,
    seeded,
    bendahara_profile,
    super_admin_profile,
):
    _import_payroll(db_session, bendahara_profile, period=date(2026, 10, 1))

    # Payroll + pinjaman milik OPD lain tidak boleh muncul pada list OPD BKN.
    import_simgaji_excel(
        content=make_excel(
            [make_row(nmskpd=OTHER_OPD_NAME, nip=SECOND_NIP)]
        ),
        filename="simgaji-opd-lain.xlsx",
        user=super_admin_profile,
        db=db_session,
    )
    other_pos = RefPosPotongan(
        opd_id=seeded.other_opd_id,
        nama_pos="Pinjaman OPD Lain",
        kategori="berjangka",
        is_active=True,
    )
    db_session.add(other_pos)
    db_session.flush()
    db_session.add(
        PotonganBerjangka(
            nip=SECOND_NIP,
            pos_id=other_pos.id,
            nominal_per_bulan=Decimal("100000.00"),
            start_period=date(2026, 10, 1),
            tenor_bulan=12,
            end_period=date(2027, 9, 1),
            created_by="other@example.com",
        )
    )
    db_session.commit()

    api_app.dependency_overrides[get_current_user] = lambda: bendahara_profile
    with TestClient(api_app) as client:
        response = client.get("/api/v1/potongan/berjangka")
        assert response.status_code == 200
        assert response.json() == []


def test_potongan_item_crud_and_isolation(
    api_app,
    db_session,
    seeded,
    bendahara_profile,
    super_admin_profile,
):
    _import_payroll(db_session, bendahara_profile, period=date(2026, 10, 1))

    pos = RefPosPotongan(
        opd_id=seeded.opd_id,
        nama_pos="Iuran Koperasi Bulanan",
        kategori="bulanan",
        is_active=True,
    )
    db_session.add(pos)
    db_session.commit()

    api_app.dependency_overrides[get_current_user] = lambda: bendahara_profile
    with TestClient(api_app) as client:
        # 1. Create item
        res = client.post(
            "/api/v1/potongan/item",
            json={
                "nip": NIP,
                "pos_id": pos.id,
                "period": "2026-10",
                "nominal": 75000.0,
            },
        )
        assert res.status_code == 200, res.text
        data = res.json()
        assert data["nip"] == NIP
        assert data["pos_nama"] == "Iuran Koperasi Bulanan"
        assert Decimal(str(data["nominal"])) == Decimal("75000")
        item_id = data["id"]

        # 2. Update item via POST
        res_update = client.post(
            "/api/v1/potongan/item",
            json={
                "nip": NIP,
                "pos_id": pos.id,
                "period": "2026-10",
                "nominal": 85000.0,
            },
        )
        assert res_update.status_code == 200
        assert Decimal(str(res_update.json()["nominal"])) == Decimal("85000")
        assert res_update.json()["id"] == item_id

        # 2b. Update item via PATCH
        res_patch = client.patch(
            f"/api/v1/potongan/item/{item_id}",
            json={
                "nominal": "95000.00",
            },
        )
        assert res_patch.status_code == 200, res_patch.text
        assert Decimal(str(res_patch.json()["nominal"])) == Decimal("95000.00")
        assert res_patch.json()["id"] == item_id

        # 3. Delete item
        res_del = client.delete(f"/api/v1/potongan/item/{item_id}")
        assert res_del.status_code == 200
        assert res_del.json()["status"] == "success"

        # 4. Verifikasi di DB sudah terhapus
        item_db = db_session.get(PayrollPotonganItem, uuid.UUID(item_id))
        assert item_db is None

    # Verifikasi audit log tercatat
    audits = db_session.scalars(
        select(AuditLog)
        .where(AuditLog.action.in_(["CREATE_POTONGAN_MANUAL_ITEM", "UPDATE_POTONGAN_MANUAL_ITEM", "DELETE_POTONGAN_MANUAL_ITEM"]))
        .order_by(AuditLog.id)
    ).all()
    assert len(audits) == 4


def test_rekap_potongan_bulanan_endpoint(
    api_app,
    db_session,
    seeded,
    bendahara_profile,
):
    _import_payroll(db_session, bendahara_profile, period=date(2026, 10, 1))
    api_app.dependency_overrides[get_current_user] = lambda: bendahara_profile

    with TestClient(api_app) as client:
        # Buat 2 pos bulanan
        pos1 = _pos(client, "Iuran KORPRI Rekap", "bulanan")
        pos2 = _pos(client, "Zakat Rekap", "bulanan")

        # Import item ke pos1
        excel1 = make_potongan_excel([{"nip": NIP, "nominal": "50000"}])
        res1 = client.post(
            "/api/v1/potongan/import-excel",
            files={"file": ("korpri.xlsx", excel1, EXCEL_MIME)},
            data={"pos_id": str(pos1["id"]), "period": "2026-10"},
        )
        assert res1.status_code == 200

        # Ambil rekap bulanan
        rekap_res = client.get("/api/v1/potongan/rekap-bulanan?period=2026-10")
        assert rekap_res.status_code == 200, rekap_res.text
        data = rekap_res.json()
        assert data["period"] == "2026-10"
        assert data["opd_nama"] == seeded.opd_name
        assert data["total_pegawai"] >= 1
        assert Decimal(str(data["total_nominal"])) >= Decimal("50000.00")

        # Cek detail pos1
        detail_res = client.get(f"/api/v1/potongan/rekap-bulanan/{pos1['id']}?period=2026-10")
        assert detail_res.status_code == 200, detail_res.text
        detail = detail_res.json()
        assert detail["pos_id"] == pos1["id"]
        assert detail["nama_pos"] == "Iuran KORPRI Rekap"
        assert detail["total_pegawai"] == 1
        assert Decimal(str(detail["total_nominal"])) == Decimal("50000.00")
        assert len(detail["items"]) == 1
        assert detail["items"][0]["nip"] == NIP


def test_rekap_potongan_berjangka_endpoint(
    api_app,
    db_session,
    seeded,
    bendahara_profile,
):
    _import_payroll(db_session, bendahara_profile, period=date(2026, 10, 1))
    api_app.dependency_overrides[get_current_user] = lambda: bendahara_profile

    with TestClient(api_app) as client:
        # Buat pos berjangka
        pos_loan = _pos(client, "Koperasi Dimas Rekap", "berjangka")

        # Daftarkan pinjaman berjangka untuk NIP pada pos_loan
        loan_payload = {
            "nip": NIP,
            "pos_id": pos_loan["id"],
            "nominal_per_bulan": "250000.00",
            "start_period": "2026-08",
            "tenor_bulan": 12,
            "keterangan": "Pinjaman koperasi",
        }
        res_loan = client.post("/api/v1/potongan/berjangka", json=loan_payload)
        assert res_loan.status_code == 201, res_loan.text

        # Ambil rekap berjangka periode 2026-10
        rekap_res = client.get("/api/v1/potongan/rekap-berjangka?period=2026-10")
        assert rekap_res.status_code == 200, rekap_res.text
        data = rekap_res.json()
        assert data["period"] == "2026-10"
        assert data["opd_nama"] == seeded.opd_name
        assert data["total_pegawai"] >= 1
        assert data["total_pinjaman"] >= 1
        assert Decimal(str(data["total_nominal"])) >= Decimal("250000.00")

        # Cek detail pos_loan
        detail_res = client.get(f"/api/v1/potongan/rekap-berjangka/{pos_loan['id']}?period=2026-10")
        assert detail_res.status_code == 200, detail_res.text
        detail = detail_res.json()
        assert detail["pos_id"] == pos_loan["id"]
        assert detail["nama_pos"] == "Koperasi Dimas Rekap"
        assert detail["total_pegawai"] == 1
        assert detail["total_pinjaman"] == 1
        assert Decimal(str(detail["total_nominal"])) == Decimal("250000.00")
        assert len(detail["items"]) == 1
        assert detail["items"][0]["nip"] == NIP
        assert detail["items"][0]["cicilan_ke"] == 3
        assert "Cicilan 3 dari 12" in detail["items"][0]["progres_label"]


def test_pinjaman_berjangka_tenor_validation(api_app, db_session, seeded, bendahara_profile):
    _import_payroll(db_session, bendahara_profile, period=date(2026, 10, 1))
    api_app.dependency_overrides[get_current_user] = lambda: bendahara_profile

    with TestClient(api_app) as client:
        pos = _pos(client, "Kredit Rumah Bank Jateng", "berjangka")

        # Tenor 240 (20 tahun) valid
        res_240 = client.post(
            "/api/v1/potongan/berjangka",
            json={
                "nip": NIP,
                "pos_id": pos["id"],
                "nominal_per_bulan": "2500000.00",
                "start_period": "2026-10",
                "tenor_bulan": 240,
                "keterangan": "Kredit 240 bulan",
            },
        )
        assert res_240.status_code == 201, res_240.text
        data_240 = res_240.json()
        assert data_240["tenor_bulan"] == 240

        # Tenor > 240 invalid (422)
        res_241 = client.post(
            "/api/v1/potongan/berjangka",
            json={
                "nip": NIP,
                "pos_id": pos["id"],
                "nominal_per_bulan": "2500000.00",
                "start_period": "2026-10",
                "tenor_bulan": 241,
                "keterangan": "Kredit 241 bulan",
            },
        )
        assert res_241.status_code == 422

        # Tenor < 1 invalid (422)
        res_0 = client.post(
            "/api/v1/potongan/berjangka",
            json={
                "nip": NIP,
                "pos_id": pos["id"],
                "nominal_per_bulan": "2500000.00",
                "start_period": "2026-10",
                "tenor_bulan": 0,
                "keterangan": "Kredit 0 bulan",
            },
        )
        assert res_0.status_code == 422




