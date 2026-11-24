"""Pengujian import engine SIMGAJI (insert, upsert, isolasi OPD, validasi)."""

from __future__ import annotations

from decimal import Decimal

import pytest
from sqlalchemy import func, select

from app.models import AuditLog, PayrollMonthly
from app.services.simgaji_import import (
    SimgajiImportError,
    SimgajiPermissionError,
    import_simgaji_excel,
)
from tests.conftest import OTHER_OPD_NAME, SECOND_NIP
from tests.helpers import make_excel, make_row

NIP = "196812211991011001"


def _import(db, profile, rows, **kwargs):
    return import_simgaji_excel(
        content=make_excel(rows, **kwargs),
        filename="simgaji.xlsx",
        user=profile,
        db=db,
    )


def test_import_inserts_payroll_with_exact_decimal(db_session, seeded, bendahara_profile):
    result = _import(db_session, bendahara_profile, [make_row()])

    assert result["status"] == "success"
    assert result["opd"] == seeded.opd_name
    assert result["total_rows"] == 1
    assert result["inserted"] == 1
    assert result["updated"] == 0
    assert result["periods"] == ["2026-10"]
    assert result["warnings"] == []

    payroll = db_session.scalar(select(PayrollMonthly))
    assert payroll is not None
    assert payroll.nip == NIP
    assert payroll.nama == "CELSO EDGAR NASCIMENTO"
    assert payroll.nmskpd == seeded.opd_name
    assert payroll.gapok == Decimal("5235000.55")
    assert payroll.tjistri == Decimal("523500.00")
    assert payroll.kotor == Decimal("6365272.92")
    assert payroll.potongan == Decimal("812472.37")
    assert payroll.bersih == Decimal("5552800.55")
    assert payroll.imported_by == seeded.user_email
    assert payroll.imported_at is not None

    audit = db_session.scalar(select(AuditLog))
    assert audit is not None
    assert audit.user_email == seeded.user_email
    assert audit.action == "IMPORT_SIMGAJI_EXCEL"
    assert audit.details["inserted"] == 1
    assert audit.details["opd"] == seeded.opd_name


def test_reimport_upserts_without_duplicates(db_session, seeded, bendahara_profile):
    _import(db_session, bendahara_profile, [make_row()])
    result = _import(
        db_session,
        bendahara_profile,
        [
            make_row(
                gapok="6.000.000,00",
                kotor="7.130.272,92",
                bersih="6.317.800,55",
            )
        ],
    )

    assert result["inserted"] == 0
    assert result["updated"] == 1
    assert (
        db_session.scalar(select(func.count()).select_from(PayrollMonthly)) == 1
    )

    payroll = db_session.scalar(select(PayrollMonthly))
    assert payroll is not None
    assert payroll.gapok == Decimal("6000000.00")
    assert payroll.kotor == Decimal("7130272.92")
    assert payroll.bersih == Decimal("6317800.55")
    assert db_session.scalar(select(func.count()).select_from(AuditLog)) == 2


def test_import_rejects_opd_mismatch_and_writes_nothing(
    db_session, seeded, bendahara_profile
):
    with pytest.raises(SimgajiPermissionError) as exc_info:
        _import(
            db_session,
            bendahara_profile,
            [make_row(nmskpd=OTHER_OPD_NAME)],
        )

    assert "tidak cocok" in str(exc_info.value).lower()
    db_session.rollback()
    assert db_session.scalar(select(func.count()).select_from(PayrollMonthly)) == 0


def test_import_accepts_opd_case_and_whitespace_variations(
    db_session, seeded, bendahara_profile
):
    result = _import(
        db_session,
        bendahara_profile,
        [make_row(nmskpd="  badan kepegawaian dan pengembangan sumber daya manusia  ")],
    )
    assert result["opd"] == seeded.opd_name


def test_import_rejects_missing_required_column(db_session, bendahara_profile):
    with pytest.raises(SimgajiImportError) as exc_info:
        _import(
            db_session,
            bendahara_profile,
            [make_row()],
            drop_columns=("kotor",),
        )
    assert "kotor" in str(exc_info.value)
    db_session.rollback()
    assert db_session.scalar(select(func.count()).select_from(PayrollMonthly)) == 0


def test_import_rejects_duplicate_nip_period(db_session, bendahara_profile):
    with pytest.raises(SimgajiImportError) as exc_info:
        _import(
            db_session,
            bendahara_profile,
            [make_row(), make_row(nama="DUPLIKAT")],
        )
    assert any("Duplikat" in error["message"] for error in exc_info.value.errors)
    db_session.rollback()
    assert db_session.scalar(select(func.count()).select_from(PayrollMonthly)) == 0


def test_import_rejects_invalid_nip(db_session, bendahara_profile):
    with pytest.raises(SimgajiImportError) as exc_info:
        _import(db_session, bendahara_profile, [make_row(nip="ABC123")])
    assert any(error["column"] == "nip" for error in exc_info.value.errors)
    db_session.rollback()


def test_import_filters_out_non_matching_opd_rows_for_bendahara(
    db_session, seeded, bendahara_profile
):
    result = _import(
        db_session,
        bendahara_profile,
        [make_row(), make_row(nip=SECOND_NIP, nmskpd=OTHER_OPD_NAME)],
    )
    assert result["status"] == "success"
    assert result["total_rows"] == 1
    assert result["inserted"] == 1
    assert any("dilewati" in w.lower() for w in result["warnings"])

    rows = db_session.scalars(select(PayrollMonthly)).all()
    assert len(rows) == 1
    assert rows[0].nip == NIP
    assert rows[0].nmskpd == seeded.opd_name


def test_super_admin_can_import_multiple_opd_values(
    db_session, seeded, super_admin_profile
):
    result = _import(
        db_session,
        super_admin_profile,
        [make_row(), make_row(nip=SECOND_NIP, nmskpd=OTHER_OPD_NAME)],
    )
    assert result["status"] == "success"
    assert result["total_rows"] == 2
    assert result["inserted"] == 2
    rows = db_session.scalars(select(PayrollMonthly)).all()
    assert len(rows) == 2
    nips = {r.nip: r.nmskpd for r in rows}
    assert nips[NIP] == seeded.opd_name
    assert nips[SECOND_NIP] == OTHER_OPD_NAME


def test_super_admin_can_import_other_opd(
    db_session, seeded, super_admin_profile
):
    result = _import(
        db_session,
        super_admin_profile,
        [make_row(nmskpd=OTHER_OPD_NAME)],
    )
    assert result["opd"] == OTHER_OPD_NAME
    payroll = db_session.scalar(select(PayrollMonthly))
    assert payroll is not None
    assert payroll.nmskpd == OTHER_OPD_NAME


def test_super_admin_auto_creates_unregistered_opd(
    db_session, super_admin_profile
):
    result = _import(
        db_session,
        super_admin_profile,
        [make_row(nmskpd="OPD TIDAK ADA")],
    )
    assert result["status"] == "success"
    assert result["opd"] == "OPD TIDAK ADA"
    payroll = db_session.scalar(select(PayrollMonthly))
    assert payroll is not None
    assert payroll.nmskpd == "OPD TIDAK ADA"


def test_import_parses_rupiah_prefixed_string(db_session, bendahara_profile):
    _import(
        db_session,
        bendahara_profile,
        [make_row(gapok="Rp 5.235.000,55")],
    )
    payroll = db_session.scalar(select(PayrollMonthly))
    assert payroll is not None
    assert payroll.gapok == Decimal("5235000.55")


def test_bendahara_cannot_overwrite_other_opd_row(
    db_session, seeded, bendahara_profile, super_admin_profile
):
    # Baris (nip, tglgaji) sudah ada dan sah milik OPD lain.
    _import(
        db_session,
        super_admin_profile,
        [make_row(nmskpd=OTHER_OPD_NAME, nip=NIP)],
    )

    # Bendahara BKN mengirim file yang mengklaim OPD-nya sendiri dengan NIP sama.
    with pytest.raises(SimgajiPermissionError) as exc_info:
        _import(db_session, bendahara_profile, [make_row(nip=NIP)])

    assert "OPD lain" in str(exc_info.value)
    assert any("sudah terdaftar" in error["message"] for error in exc_info.value.errors)

    db_session.rollback()
    payroll = db_session.scalar(
        select(PayrollMonthly).where(PayrollMonthly.nip == NIP)
    )
    assert payroll is not None
    assert payroll.nmskpd == OTHER_OPD_NAME


def test_legacy_parser_facade_delegates_to_import_engine(
    db_session, seeded, bendahara_profile, tmp_path
):
    from simgaji_parser import parse_and_import_simgaji

    path = tmp_path / "simgaji.xlsx"
    path.write_bytes(make_excel([make_row()]))

    result = parse_and_import_simgaji(
        str(path),
        seeded.opd_name,
        db_session,
        seeded.user_email,
    )

    assert result["status"] == "success"
    assert result["total_records"] == 1
    assert result["total_rows"] == 1
    assert result["opd"] == seeded.opd_name


def test_format_kdpangkat_mappings():
    from app.constants import format_kdpangkat

    expected_mappings = {
        "1A": "I/a",
        "1B": "I/b",
        "1C": "I/c",
        "1D": "I/d",
        "2A": "II/a",
        "2B": "II/b",
        "2C": "II/c",
        "2D": "II/d",
        "3A": "III/a",
        "3B": "III/b",
        "3C": "III/c",
        "3D": "III/d",
        "4A": "IV/a",
        "4B": "IV/b",
        "4C": "IV/c",
        "4D": "IV/d",
        "4E": "IV/e",
    }

    for code, expected in expected_mappings.items():
        assert format_kdpangkat(code) == expected
        assert format_kdpangkat(code.lower()) == expected
        assert format_kdpangkat(f" {code} ") == expected
        assert format_kdpangkat(f"{code}-{expected}") == expected

    # Edge cases
    assert format_kdpangkat("IV/a") == "IV/a"
    assert format_kdpangkat("IV/A") == "IV/a"
    assert format_kdpangkat("5") == "5"
    assert format_kdpangkat(None) is None
    assert format_kdpangkat("") is None
    assert format_kdpangkat("-") is None
    assert format_kdpangkat("—") is None



