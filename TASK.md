# TASK.md - Development Roadmap & Task Checklist

## Phase 1: Database Setup & Infrastructure
- [x] Siapkan skema database PostgreSQL (`schema.sql`) dengan tabel `ref_opd`, `app_users`, `payroll_monthly`, `ref_pos_potongan`, `potongan_berjangka`, `payroll_potongan_item`, dan `audit_logs`.
- [x] Siapkan `Dockerfile` dan `docker-compose.yml`.

## Phase 2: Parser & Data Import Engine
- [x] Buat parser file SIMGAJI PNS (`simgaji_parser.py`) dengan validasi kolom `nmskpd` dan ekstraksi 43 kolom wajib.
- [x] Integrasikan parser ke endpoint `POST /api/v1/payroll/import-excel` dengan validasi OPD pengguna login, isolasi OPD, dan audit log.
- [x] Implementasikan parser Excel untuk import potongan manual bulanan (kolom NIP & nominal) via `POST /api/v1/potongan/import-excel`.
- [x] Buat handler upsert agar import ulang pada bulan yang sama tidak menimbulkan duplikasi (constraint `uq_payroll_nip_period` pada `(nip, tglgaji)`).

## Phase 3: Potongan & Logika Cicilan Berjangka
- [x] Buat endpoint CRUD pos potongan fleksibel per OPD (`GET/POST/PATCH/DELETE /api/v1/potongan/pos`).
- [x] Buat perhitungan tenor otomatis (`end_period = start_period + tenor - 1`) dan generator realisasi cicilan untuk periode payroll.
- [x] Implementasikan endpoint pinjaman berjangka (`POST/GET /api/v1/potongan/berjangka`) dan realisasi manual (`POST /api/v1/potongan/berjangka/generate`).
- [x] Implementasikan import potongan manual Excel `nip` + `nominal` (`POST /api/v1/potongan/import-excel`).
- [x] Catat audit log untuk pembuatan pos, pinjaman, realisasi cicilan, dan import potongan.
- [x] Implementasikan agregasi pemotongan bulanan untuk menghitung *Take Home Pay* (endpoint payroll & ringkasan dashboard).

## Phase 4: API & Security Integration
- [x] Autentikasi Firebase ID Token & API Key (`app/auth.py` + middleware).
- [x] Multi-tenancy OPD: isolasi query & akses data (`app/services/tenancy.py`).
- [x] API Payroll: `GET /api/v1/payroll/{nip}`, `GET /api/v1/payroll/opd/summary` (batch), audit logs (`app/api/payroll.py`).
- [x] Auth API: `/api/v1/auth/me` (profil), `/api/v1/auth/opd-options`, `/api/v1/auth/me/opd` (onboarding).
- [x] UI Aero: Dialog profil, aksi logout/ganti OPD di status bar, UI onboarding OPD (7.css).

## Phase 5: Cetak Slip Gaji (F4)
- [x] Desain template cetak HTML/CSS berukuran kertas F4 ($215\,\text{mm} \times 330\,\text{mm}$) dengan kapasitas 4-5 slip per lembar (`template_slip_f4.html`).
- [x] Hubungkan template dengan rendering engine (vanilla JS + print CSS) untuk mencetak data dinamis ASN, 5 slip per halaman F4.

## Phase 6: Antarmuka Web Aero Glass
- [x] Dashboard bendahara dengan window frame Aero Glass, titlebar, taskbar, metrik, tabel pegawai, dan aktivitas.
- [x] Modul import Excel SIMGAJI (drag & drop, progress bar, validasi OPD, hasil inserted/updated, riwayat).
- [x] Form potongan bulanan dan berjangka (tenor, periode akhir, progres cicilan) dengan tampilan 7.css.
- [x] Pratinjau cetak F4 interaktif + pemilihan pegawai + output print 5 slip/lembar.
- [x] Dialog pendaftaran pinjaman 7.css, rekap listview berjangka, dan badge progres tenor (mis. 14 / 36 bulan).
- [x] Dialog kelola pos potongan dan import potongan manual bulanan.
- [x] Otentikasi terintegrasi Google Sign-In (Firebase Auth) dengan endpoint ringkasan dashboard FastAPI + PostgreSQL.
- [x] Endpoint edit/hapus item potongan internal per item (`POST/DELETE /api/v1/potongan/item`) dan integrasi interaktif form bulanan.

## Phase 7: Production Deployment Readiness, Database Backup Automation, & User Handover Documentation
- [x] Susun Panduan Pengguna komprehensif (`USER_GUIDE.md`) untuk Bendahara OPD dan Super Admin (`teguhe@gmail.com`).
- [x] Buat skrip otomatisasi pencadangan database PostgreSQL dengan rotasi retensi 30 hari (`scripts/backup_db.sh`).
- [x] Buat skrip pemulihan database dengan proteksi konfirmasi interaktif dan flag non-interaktif `-y` (`scripts/restore_db.sh`).
- [x] Susun panduan deployment server Linux, reverse proxy Nginx/NPM, Cloudflare Tunnel, dan jadwal Cron Job (`DEPLOYMENT.md`).
- [x] Perbarui template konfigurasi environment variables (`.env.example`).
- [x] Lakukan pembersihan workspace, sanitasi cache Python, dan verifikasi struktur berkas akhir.

---

## Ringkasan Struktur Folder Proyek

```text
Slip Gaji/
├── app/
│   ├── api/
│   │   ├── auth.py              # Endpoint autentikasi, profil & onboarding OPD
│   │   ├── dashboard.py         # Endpoint ringkasan metrik dashboard
│   │   ├── payroll.py           # Endpoint import SIMGAJI, detail slip gaji NIP & summary batch
│   │   └── potongan.py          # Endpoint pos potongan, pinjaman berjangka, import & item manual
│   ├── auth.py                  # Verifikasi Firebase Auth ID Token, API Key & Super Admin Lock
│   ├── config.py                # Konfigurasi aplikasi berbasis environment variables
│   ├── constants.py             # 43 kolom wajib SIMGAJI, kolom nominal & konstanta numerik
│   ├── db.py                    # Koneksi engine & session SQLAlchemy 2.x
│   ├── models.py                # Model data ORM PostgreSQL (app_users, payroll, pos, audit, dll)
│   ├── schemas.py               # Skema validasi request/response Pydantic v2
│   └── services/
│       ├── audit.py             # Service pencatatan log audit sistem
│       ├── berjangka.py         # Logika tenor, perhitungan cicilan & generator otomatis
│       ├── payroll_summary.py   # Agregasi data gaji, potongan & Take Home Pay
│       ├── periods.py           # Utilitas manipulasi & validasi periode tanggal YYYY-MM
│       ├── simgaji_import.py    # Engine parser Excel SIMGAJI, isolasi OPD & upsert atomik
│       └── tenancy.py           # Multi-tenancy OPD & pengamanan isolasi data
├── backups/                     # Direktori penyimpanan arsip cadangan basis data (.sql.gz)
├── docs/
│   └── screenshots/             # Tangkapan layar antarmuka Aero Glass & hasil pengujian
├── scripts/
│   ├── backup_db.sh             # Skrip otomatisasi pencadangan basis data PostgreSQL (retensi 30 hari)
│   └── restore_db.sh            # Skrip pemulihan basis data dari arsip cadangan (opsi -y)
├── tests/                       # Automated unit & integration tests (60 passed)
│   ├── conftest.py              # Fixtures database uji coba & mock auth context
│   ├── helpers.py               # Generator data Excel pengujian
│   ├── test_api.py              # Pengujian endpoint payroll & pembacaan slip gaji
│   ├── test_auth.py             # Pengujian Super Admin Lock (teguhe@gmail.com)
│   ├── test_auth_api.py         # Pengujian endpoint auth /me dan onboarding OPD
│   ├── test_import_service.py   # Pengujian parser SIMGAJI, validasi OPD & upsert
│   ├── test_money.py            # Pengujian presisi Decimal/NUMERIC dan parsing rupiah
│   └── test_potongan.py         # Pengujian pos potongan, tenor 36 bulan & CRUD item potongan
├── web/                         # Antarmuka Web Klasik Windows 7 Aero Glass
│   ├── css/
│   │   └── aero.css             # Desain styling Aero Glass (titlebar, glass effects, taskbar)
│   ├── js/
│   │   └── app.js               # Logic dashboard, interaksi dialog, print engine & API sync
│   ├── vendor/                  # Komponen 7.css (controls Windows 7)
│   └── index.html               # Halaman utama aplikasi Aero Glass
├── .dockerignore                # Daftar pengecualian build Docker
├── .env.example                 # Template environment variables siap pakai
├── .gitignore                   # Daftar pengecualian git
├── AGENTS.md                    # Aturan mutlak pengembangan (Super Admin Lock, presisi Decimal, F4)
├── DEPLOYMENT.md                # Panduan operasional server produksi, Nginx, SSL & Cloudflare Tunnel
├── Dockerfile                   # Spesifikasi kontainer aplikasi Python 3.11-slim
├── docker-compose.yml           # Konfigurasi stack kontainer (FastAPI + PostgreSQL 15 Alpine)
├── main_api.py                  # Entry point FastAPI, mounting router & health check
├── prd_cetak_slip_gaji_asn.md   # Product Requirement Document (PRD) referensi spesifikasi
├── README.md                    # Dokumentasi umum proyek
├── requirements.txt             # Dependensi Python produksi
├── requirements-dev.txt         # Dependensi Python pengujian (pytest, httpx)
├── schema.sql                   # Skema DDL PostgreSQL (sumber kebenaran database)
├── simgaji_parser.py            # Fasad kompatibilitas parser SIMGAJI
├── TASK.md                      # Roadmap & checklist pengerjaan fase proyek
├── template_slip_f4.html        # Template cetak slip gaji format F4 (5 slip per lembar)
└── USER_GUIDE.md                # Panduan pengguna operasional Bendahara & Super Admin
```
