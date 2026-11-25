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

## Endpoint API

Seluruh endpoint berada di bawah prefix `/api/v1` (kecuali `/health`). Dokumentasi interaktif lengkap dapat diakses melalui `/docs`.

### 1. Autentikasi & Pengaturan
| Method | Endpoint | Keterangan |
|---|---|---|
| `GET` | `/api/v1/auth/me` | Profil pengguna aktif, peran (`super_admin` / `bendahara_opd`), dan OPD |
| `GET` | `/api/v1/auth/opd-options` | Daftar pilihan OPD yang tersedia |
| `POST` | `/api/v1/auth/opd` | Tambah OPD baru secara cepat (Super Admin) |
| `PATCH` | `/api/v1/auth/me/opd` | Ganti OPD aktif untuk sesi pengguna |
| `GET` / `PUT` | `/api/v1/settings` | Baca dan perbarui pengaturan penandatangan slip gaji per OPD |

### 2. Dashboard
| Method | Endpoint | Keterangan |
|---|---|---|
| `GET` | `/api/v1/dashboard/summary` | Ringkasan metrik penggajian, tren THP, komposisi potongan, dan daftar pegawai per periode |

### 3. Payroll & Master Gaji ASN
| Method | Endpoint | Keterangan |
|---|---|---|
| `POST` | `/api/v1/payroll/preview-excel` | Pratinjau isi file Excel SIMGAJI sebelum disimpan |
| `POST` | `/api/v1/payroll/import-excel` | Import Excel SIMGAJI PNS (validasi `nmskpd` OPD & 43 kolom wajib) |
| `GET` | `/api/v1/payroll/list` | Daftar data gaji bulanan ASN per periode/OPD |
| `GET` | `/api/v1/payroll/stats` | Statistik gaji ASN (breakdown tunjangan, potongan resmi/internal, penyesuaian) |
| `GET` | `/api/v1/payroll/periods` | Daftar periode penggajian yang tersedia |
| `GET` | `/api/v1/payroll/{nip}` | Rincian slip gaji dan potongan per NIP dan periode |
| `GET` / `POST` | `/api/v1/payroll/penyesuaian` | Daftar dan tambah penyesuaian/koreksi nominal gaji ASN |
| `DELETE` | `/api/v1/payroll/penyesuaian/{id}` | Hapus data penyesuaian gaji |
| `POST` | `/api/v1/payroll/log-print` | Catat aktivitas pencetakan slip gaji F4 ke audit log |

### 4. Potongan Internal & Pinjaman Berjangka
| Method | Endpoint | Keterangan |
|---|---|---|
| `GET` / `POST` | `/api/v1/potongan/pos` | Daftar dan tambah pos potongan per OPD |
| `PATCH` / `DELETE` | `/api/v1/potongan/pos/{pos_id}` | Ubah atau nonaktifkan pos potongan |
| `GET` / `POST` | `/api/v1/potongan/berjangka` | Daftar dan daftarkan pinjaman/potongan berjangka ASN |
| `POST` | `/api/v1/potongan/berjangka/generate` | Realisasi otomatis cicilan pinjaman berjangka untuk periode tertentu |
| `POST` | `/api/v1/potongan/import-excel` | Import potongan bulanan manual dari Excel (`nip`, `nominal`) |
| `POST` | `/api/v1/potongan/manual` | Tambah item potongan manual per ASN |
| `PATCH` / `DELETE` | `/api/v1/potongan/item/{item_id}` | Ubah atau hapus item potongan per ASN |
| `GET` | `/api/v1/potongan/rekap-bulanan` | Rekapitulasi potongan bulanan per pos |
| `GET` | `/api/v1/potongan/rekap-bulanan/{pos_id}` | Detail potongan bulanan untuk satu pos tertentu |
| `GET` | `/api/v1/potongan/rekap-berjangka` | Rekapitulasi cicilan berjangka per pos |
| `GET` | `/api/v1/potongan/rekap-berjangka/{pos_id}` | Detail cicilan berjangka untuk satu pos tertentu |

### 5. Monitoring Aktivitas
| Method | Endpoint | Keterangan |
|---|---|---|
| `GET` | `/api/v1/monitoring/logs` | Riwayat aktivitas (audit trail) dengan dukungan filter dan pencarian |

### 6. Master Data (Khusus Super Admin)
| Method | Endpoint | Keterangan |
|---|---|---|
| `GET` / `POST` | `/api/v1/master/opd` | Daftar dan tambah Master OPD |
| `PATCH` / `DELETE` | `/api/v1/master/opd/{id}` | Ubah atau hapus Master OPD |
| `POST` | `/api/v1/master/opd/import-excel` | Import daftar Master OPD dari Excel |
| `POST` | `/api/v1/master/opd/log-print` | Catat pencetakan daftar Master OPD |
| `GET` / `POST` | `/api/v1/master/users` | Daftar dan tambah Master Pengguna |
| `PATCH` / `DELETE` | `/api/v1/master/users/{id}` | Ubah penugasan OPD, aktivasi, promosi/demosi role, atau hapus pengguna |
| `POST` | `/api/v1/master/users/log-print` | Catat pencetakan daftar Master Pengguna |

### 7. Manajemen Basis Data (Khusus Super Admin)
| Method | Endpoint | Keterangan |
|---|---|---|
| `GET` | `/api/v1/database/stats` | Statistik jumlah baris aktif per tabel di PostgreSQL |
| `GET` | `/api/v1/database/backup` | Unduh seluruh isi database dalam format JSON |
| `POST` | `/api/v1/database/restore` | Pulihkan database dari file backup JSON (penuh atau selektif per kategori) |
| `POST` | `/api/v1/database/delete-period` | Hapus data penggajian spesifik per OPD dan periode |
| `POST` | `/api/v1/database/wipe` | Pembersihan data (*wipe/reset*) secara selektif berdasarkan kategori tabel |

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
