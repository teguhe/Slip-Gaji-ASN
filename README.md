# Slip Gaji ASN

Aplikasi penggajian dan cetak slip gaji ASN untuk Bendahara OPD di lingkungan Pemerintah Daerah, dibangun dengan **FastAPI**, **PostgreSQL**, **Firebase Auth**, dan antarmuka **Windows 7 Aero Glass (7.css)**.

## Fitur Utama

- **Dashboard Ringkas:** Metrik gaji (Total Kotor, Potongan, Take Home Pay), tren THP, komposisi potongan, tabel pegawai, dan log aktivitas.
- **Master Gaji ASN:**
  - **Monitoring:** Data import SIMGAJI PNS (`.xls`/`.xlsx`) dengan validasi OPD ketat, 43 kolom wajib, dan *upsert* `(nip, tglgaji)`.
  - **Statistik:** Ringkasan total ASN terdaftar, komposisi potongan, serta rincian tunjangan dan potongan resmi.
  - **Penyesuaian:** Pengelolaan koreksi tambah/kurang nominal gaji per ASN per periode.
- **Potongan Internal & Pinjaman Berjangka:**
  - Pos potongan fleksibel per OPD (bulanan/berjangka).
  - Pinjaman berjangka dengan perhitungan `end_period`, progres cicilan, dan generator realisasi bulanan otomatis.
  - Import potongan manual bulanan (`nip`, `nominal`) dengan mode *upsert*.
- **Cetak Slip Gaji F4:** Format kertas F4 ($215\,\text{mm} \times 330\,\text{mm}$), 2 slip per halaman dilengkapi blok tanda tangan bendahara, dengan pratinjau interaktif.
- **Monitoring Aktivitas:** Pelacakan riwayat aktivitas (login, import, cetak, perubahan data, backup/restore) lengkap dengan filter dan pencarian.
- **Panel Super Admin:**
  - **Master OPD:** Kelola daftar OPD, import daftar OPD dari Excel, dan cetak daftar OPD (Landscape).
  - **Master Pengguna:** Kelola akun pengguna, penugasan OPD, aktivasi akun, promosi/demosi peran Super Admin, dan cetak daftar pengguna (Landscape).
  - **Manajemen Basis Data:** Statistik penyimpanan, Backup & Restore JSON selektif (dilengkapi verifikasi kode pengaman 5 digit acak), Hapus Data per OPD & Periode, serta Pembersihan Data (*Wipe / Reset*) selektif berbasis checkbox.
- **Keamanan & Isolasi Data:**
  - Otentikasi menggunakan Firebase Auth (Google Sign-In / Gmail) dan REST API FastAPI.
  - Isolasi data ketat per OPD untuk Bendahara OPD; Super Admin (`teguhe@gmail.com`) memiliki akses global lintas sistem.

## Tech Stack

- **Backend:** Python 3.11, FastAPI, SQLAlchemy, Pydantic, pandas/openpyxl
- **Database:** PostgreSQL 15
- **Auth:** Firebase Authentication
- **Frontend:** HTML5, Vanilla JS, 7.css (Windows 7 Aero Glass)
- **Container:** Docker & Docker Compose

## Menjalankan Aplikasi

```bash
docker compose up -d --build
```

- **Aplikasi Web:** <http://localhost:8000>
- **Dokumentasi API (Swagger):** <http://localhost:8000/docs>
- **Health Check:** <http://localhost:8000/health>

Letakkan kredensial service account Firebase di `firebase_creds.json` atau atur environment variable `GOOGLE_APPLICATION_CREDENTIALS`.

## Pengujian (Testing)

Menjalankan seluruh suite pengujian backend (`pytest`):

```bash
docker exec -e TEST_DATABASE_URL="postgresql://postgres:postgres_password@db:5432/slip_gaji_test" slip_gaji_api pytest
```

## Struktur Proyek

- `app/` — Konfigurasi, model SQLAlchemy, autentikasi, router API, dan service (parser Excel, tenor, audit).
- `web/` — Antarmuka Aero Glass (`index.html`, `css/aero.css`, `js/app.js`, dan aset 7.css).
- `tests/` — Pengujian unit dan integrasi backend.
- `schema.sql` — Skema DDL PostgreSQL.
- `AGENTS.md` — Pedoman operasional dan batasan keamanan sistem.

## Catatan Teknis

- Seluruh kolom nominal uang menggunakan tipe `Decimal` di Python dan `NUMERIC(15,2)` di PostgreSQL (dilarang menggunakan `float`).
- Kolom `nmskpd` pada file Excel divalidasi secara ketat (*case-insensitive* & *whitespace trimmed*) terhadap OPD milik bendahara sebelum diparsing.
