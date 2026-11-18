# PRD: Aplikasi Cetak Slip Pembayaran Gaji ASN

## 1. Project Overview & Objectives
Aplikasi Cetak Slip Pembayaran Gaji ASN dirancang untuk mempermudah Bendahara Organisasi Perangkat Daerah (OPD) dalam memproses file payroll SIMGAJI PNS bulanan, mengelola pos potongan fleksibel (iuran rutin, zakat, infaq, koperasi, serta pinjaman bank berjangka), mencetak slip gaji kompak berformat kertas F4 (4–5 slip per lembar), dan menyediakan API terautentikasi untuk integrasi data gaji per NIP.

---

## 2. Tech Stack & Environment
- **Backend / API Framework:** Python (FastAPI)
- **Database:** PostgreSQL 15+
- **Authentication:** Firebase Authentication (Google Sign-In) untuk dashboard web + Internal Secret Token / HMAC untuk integrasi API
- **Deployment:** Docker & Docker Compose
- **Document Output:** HTML/CSS cetak format kertas F4 (Folio 215mm x 330mm)

---

## 3. User Roles & Business Rules
1. **Super Admin (`teguhe@gmail.com`):**
   - Otomatis memiliki akses penuh ke seluruh data OPD, manajemen user, dan log sistem.
2. **Bendahara OPD:**
   - Melakukan registrasi awal dan login dengan akun Google.
   - Wajib memilih/mengatur nama OPD (`ref_opd.nmskpd`) yang persis sama dengan header kolom `nmskpd` di file Excel SIMGAJI.
   - Hanya memiliki otorisasi melihat, mengimpor, menginput potongan, dan mencetak slip bagi pegawai di OPD-nya.
3. **Validasi Impor File SIMGAJI:**
   - Sistem mencocokkan string `nmskpd` pada baris data Excel dengan OPD milik Bendahara. Jika tidak cocok, impor ditolak.
   - Mengimpor 43 kolom wajib:
     `tglgaji, nip, nama, norek, kdpangkat, gapok, tjistri, tjanak, tjtpp, tjeselon, tjfungsi, tjstruk, tjguru, tjlangka, tjtkd, tjterpencil, tjkhusus, tjberas, tjpajak, tjaskes, tjumum, tjkk, tjkm, ttaperap, tbulat, kotor, iwp_beban_pegawai, iwp_beban_pembkerja, iwp_taspen, ppajak, pbulog, ptaperum, psewa, phutang, pkorpri, pirdhata, pkoperasi, pjkk, pjkm, ptaperap, ptaperai, potongan, bersih`.
4. **Logika Pemotongan:**
   - **Potongan Bulanan:** Diinput manual atau diimpor via Excel (NIP & nominal). Contoh: Iuran Korpri, Dharma Wanita, Infaq, Zakat, Koperasi Dimas (Simpawan wajib, tabungan, pralenan, angsuran, THR, bingkisan lebaran).
   - **Potongan Berjangka (Tenor):** Diinput sekali dengan menentukan bulan mulai dan durasi tenor (misal: 36 bulan dari Jan 2027 s.d. Des 2029). Sistem menginjeksi otomatis potongan pada periode yang aktif dengan info progres cicilan (misal: "Cicilan 14 dari 36").
5. **Rumus Perhitungan:**
   $$	ext{Total Potongan} = 	ext{potongan SIMGAJI} + \sum(	ext{potongan internal bulanan}) + \sum(	ext{potongan berjangka})$$
   $$	ext{Take Home Pay (Bersih Akhir)} = 	ext{kotor} - 	ext{Total Potongan}$$

---

## 4. Cetak Slip Gaji (Ukuran F4)
- **Ukuran Kertas:** Folio / F4 ($215\,	ext{mm} 	imes 330\,	ext{mm}$).
- **Kapasitas:** 4 hingga 5 slip per halaman (maksimal tinggi slip $60\,	ext{mm}$).
- **Struktur Slip:**
  - Header: Nama OPD & Periode Penggajian.
  - Biodata: NIP, Nama, Pangkat/Golongan, Nomor Rekening.
  - Komparasi 3 Kolom: Penghasilan Kotor, Rincian Potongan SIMGAJI, Rincian Potongan Tambahan/Internal.
  - Footer: Total Akumulasi Potongan & Gaji Bersih Diterima (*Take Home Pay*).
