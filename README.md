# Slip Gaji ASN

Aplikasi penggajian dan cetak slip gaji ASN untuk Bendahara OPD, dibangun dengan FastAPI, PostgreSQL, Firebase Auth, dan antarmuka Windows 7 Aero Glass (7.css).

## Fitur

- Dashboard bendahara: metrik gaji, tren THP, komposisi potongan, tabel pegawai, dan aktivitas.
- Import SIMGAJI PNS (.xls/.xlsx) dengan validasi OPD, 43 kolom wajib, upsert `(nip, tglgaji)`, dan audit log.
- Pos potongan fleksibel per OPD (bulanan/berjangka).
- Pinjaman berjangka: perhitungan `end_period`, progres cicilan, dan generator realisasi bulanan otomatis saat payroll diproses.
- Import potongan manual bulanan (`nip`, `nominal`) dengan mode upsert.
- Cetak slip F4 215 × 330 mm, 5 slip per halaman, pratinjau interaktif.
- Otentikasi aman terintegrasi dengan Firebase Auth (Google Sign-In / Gmail) dan REST API FastAPI + PostgreSQL.

## Stack

- Python 3.11, FastAPI, SQLAlchemy, pandas/openpyxl
- PostgreSQL 15
- Firebase Authentication
- 7.css (CDN dengan fallback lokal) + Aero Glass CSS
- Docker Compose

## Menjalankan

```bash
docker compose up -d --build
```

- Aplikasi: <http://localhost:8000>
- Dokumentasi API: <http://localhost:8000/docs>
- Health check: <http://localhost:8000/health>

Untuk mode API, letakkan service account Firebase di `firebase_creds.json` atau set `GOOGLE_APPLICATION_CREDENTIALS`, lalu isi token melalui dialog **Sumber Data** di UI.

## Endpoint utama

| Method | Endpoint | Keterangan |
|---|---|---|
| POST | `/api/v1/payroll/import-excel` | Import SIMGAJI PNS + validasi OPD |
| GET | `/api/v1/payroll/{nip}` | Slip gaji + potongan per NIP/periode |
| GET | `/api/v1/dashboard/summary` | Ringkasan dashboard per periode |
| GET/POST | `/api/v1/potongan/pos` | Daftar/tambah pos potongan OPD |
| PATCH/DELETE | `/api/v1/potongan/pos/{id}` | Ubah/nonaktifkan pos |
| GET/POST | `/api/v1/potongan/berjangka` | Daftar/daftarkan pinjaman berjangka |
| POST | `/api/v1/potongan/berjangka/generate` | Realisasi cicilan untuk periode |
| POST | `/api/v1/potongan/import-excel` | Import potongan manual bulanan |

Semua endpoint potongan memakai isolasi OPD; Super Admin memakai `opd_id` eksplisit.

## Struktur

- `app/` — konfigurasi, model, auth, API, service parser/tenor.
- `web/` — UI Aero Glass, CSS, JavaScript, dan 7.css vendored.
- `tests/` — pengujian backend, parser, tenor, auth, dan endpoint.
- `schema.sql` — DDL PostgreSQL.
- `TASK.md` — checklist roadmap.
- `AGENTS.md` / `prd_cetak_slip_gaji_asn.md` — aturan dan spesifikasi produk.

## Catatan

- Nominal uang selalu memakai `Decimal` di Python dan `NUMERIC(15,2)` di PostgreSQL.
- Form potongan bulanan cepat di UI bersifat pratinjau; penyimpanan massal menggunakan import Excel.
