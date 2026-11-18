# TASK.md - Development Roadmap & Task Checklist

## Phase 1: Database Setup & Infrastructure
- [x] Siapkan skema database PostgreSQL (`schema.sql`) dengan tabel `ref_opd`, `app_users`, `payroll_monthly`, `ref_pos_potongan`, `potongan_berjangka`, `payroll_potongan_item`, dan `audit_logs`.
- [x] Siapkan `Dockerfile` dan `docker-compose.yml`.

## Phase 2: Parser & Data Import Engine
- [x] Buat parser file SIMGAJI PNS (`simgaji_parser.py`) dengan validasi kolom `nmskpd` dan ekstraksi 43 kolom wajib.
- [x] Integrasikan parser ke endpoint `POST /api/v1/payroll/import-excel` dengan validasi OPD pengguna login, isolasi OPD, dan audit log.
- [ ] Implementasikan parser Excel untuk import potongan manual bulanan (kolom NIP & nominal).
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
- [x] Mode demo lokal dan mode API (Firebase ID Token) dengan endpoint ringkasan dashboard.
- [ ] Endpoint edit/hapus item potongan internal per item (form bulanan cepat masih bersifat pratinjau).
