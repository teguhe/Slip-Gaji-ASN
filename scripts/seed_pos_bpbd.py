"""Seed pos potongan untuk OPD BADAN PENANGGULANGAN BENCANA DAERAH.

Daftar pos potongan:
- Bulanan:
  1. Iuran KORPRI
  2. Darma Wanita
  3. Simp wajib Koperasi Dimas
  4. Tabungan Koperasi Dimas
  5. Pralenan Kop Dimas
  6. Tabungan hari raya Kop Dimas
  7. Simpanan Bingkisan Lebaran Kop Dimas
  8. Infaq
  9. Zakat
  10. PMI
- Berjangka:
  11. Angsuran Kop Dimas
  12. BPD 1
  13. BPD 2
  14. Bank Salatiga
"""

from __future__ import annotations

from app.db import SessionLocal
from app.models import AuditLog, RefOpd, RefPosPotongan

OPD_NAME = "BADAN PENANGGULANGAN BENCANA DAERAH"

POS_ITEMS: list[tuple[str, str]] = [
    # (nama_pos, kategori)
    ("Iuran KORPRI", "bulanan"),
    ("Darma Wanita", "bulanan"),
    ("Simp wajib Koperasi Dimas", "bulanan"),
    ("Tabungan Koperasi Dimas", "bulanan"),
    ("Pralenan Kop Dimas", "bulanan"),
    ("Tabungan hari raya Kop Dimas", "bulanan"),
    ("Simpanan Bingkisan Lebaran Kop Dimas", "bulanan"),
    ("Infaq", "bulanan"),
    ("Zakat", "bulanan"),
    ("PMI", "bulanan"),
    ("Angsuran Kop Dimas", "berjangka"),
    ("BPD 1", "berjangka"),
    ("BPD 2", "berjangka"),
    ("Bank Salatiga", "berjangka"),
]


def seed_pos() -> None:
    with SessionLocal() as db:
        opd = db.query(RefOpd).filter(RefOpd.nmskpd == OPD_NAME).first()
        if not opd:
            print(f"[ERROR] OPD '{OPD_NAME}' tidak ditemukan dalam database!")
            return

        print(f"[INFO] OPD ditemukan: {opd.nmskpd} (ID: {opd.id})")
        inserted = 0
        skipped = 0

        for nama_pos, kategori in POS_ITEMS:
            existing = (
                db.query(RefPosPotongan)
                .filter(
                    RefPosPotongan.opd_id == opd.id,
                    RefPosPotongan.nama_pos == nama_pos,
                )
                .first()
            )
            if existing:
                print(
                    f"  - Pos '{nama_pos}' sudah ada (ID: {existing.id}, kategori: {existing.kategori}, aktif: {existing.is_active})"
                )
                skipped += 1
                continue

            pos = RefPosPotongan(
                opd_id=opd.id,
                nama_pos=nama_pos,
                kategori=kategori,
                is_active=True,
            )
            db.add(pos)
            db.flush()

            audit = AuditLog(
                user_email="teguhe.documents@gmail.com",
                action="CREATE_POS_POTONGAN",
                table_name="ref_pos_potongan",
                record_id=str(pos.id),
                details={
                    "pos_id": pos.id,
                    "nama_pos": pos.nama_pos,
                    "kategori": pos.kategori,
                    "opd": opd.nmskpd.strip(),
                },
                ip_address="127.0.0.1",
            )
            db.add(audit)
            inserted += 1
            print(f"  + Berhasil ditambahkan: {nama_pos} [{kategori}] (ID: {pos.id})")

        db.commit()
        print(f"[SELESAI] {inserted} pos baru ditambahkan, {skipped} pos dilewati.")


if __name__ == "__main__":
    seed_pos()
