# AGENTS.md - Development & AI Agent Operational Guidelines

## 1. Domain Context & Objective
Aplikasi Penggajian dan Cetak Slip Gaji ASN untuk Bendahara OPD di lingkungan Pemerintah Daerah. Backend berbasis FastAPI + PostgreSQL, dengan integrasi Firebase Auth dan cetak F4.

## 2. Hard Security & Data Constraints
1. **Super Admin Lock:** Email `teguhe@gmail.com` harus selalu dievaluasi sebagai `super_admin`.
2. **OPD Data Isolation:** Bendahara hanya boleh mengakses, mengimpor, dan mengedit data yang sesuai dengan `ref_opd.nmskpd`. Dilarang menampilkan data lintas OPD.
3. **Precision Rule:** Dilarang menggunakan tipe `float` untuk kolom nominal uang. Gunakan selalu `Decimal` (Python) atau `NUMERIC(15,2)` (SQL).
4. **Excel Header Safety:** Kolom `nmskpd` di Excel wajib dibandingkan secara ketat (case-insensitive & whitespace trimmed) dengan profil OPD bendahara sebelum data diparsing.

## 3. Formatting & Print Rules
- Format kertas slip cetak wajib mengikuti spesifikasi F4 ($215\,\text{mm} \times 330\,\text{mm}$).
- 1 lembar F4 memuat 4 hingga 5 slip (tinggi komponen dibatasi $\le 60\,\text{mm}$).

## 4. Git & Workflow Rules
- Setiap perubahan/tugas yang telah selesai diuji wajib langsung di-commit dan di-push ke remote GitHub branch `dev`.
