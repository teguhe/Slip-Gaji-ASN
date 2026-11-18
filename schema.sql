-- Skema Database Cetak Slip Gaji ASN (PostgreSQL)

-- 1. ENUM & EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TYPE user_role AS ENUM ('super_admin', 'bendahara_opd');
CREATE TYPE potongan_type AS ENUM ('bulanan', 'berjangka');

-- 2. TABEL PENGGUNA & OPD
CREATE TABLE ref_opd (
    id SERIAL PRIMARY KEY,
    nmskpd VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE app_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    display_name VARCHAR(255),
    role user_role NOT NULL DEFAULT 'bendahara_opd',
    opd_id INT REFERENCES ref_opd(id) ON DELETE SET NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index user email & opd
CREATE INDEX idx_users_email ON app_users(email);
CREATE INDEX idx_users_opd ON app_users(opd_id);

-- 3. TABEL GAJI UTAMA (SIMGAJI)
CREATE TABLE payroll_monthly (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tglgaji DATE NOT NULL,
    nip VARCHAR(30) NOT NULL,
    nama VARCHAR(255) NOT NULL,
    norek VARCHAR(50),
    kdpangkat VARCHAR(10),
    nmskpd VARCHAR(255) NOT NULL,
    gapok NUMERIC(15, 2) DEFAULT 0,
    tjistri NUMERIC(15, 2) DEFAULT 0,
    tjanak NUMERIC(15, 2) DEFAULT 0,
    tjtpp NUMERIC(15, 2) DEFAULT 0,
    tjeselon NUMERIC(15, 2) DEFAULT 0,
    tjfungsi NUMERIC(15, 2) DEFAULT 0,
    tjstruk NUMERIC(15, 2) DEFAULT 0,
    tjguru NUMERIC(15, 2) DEFAULT 0,
    tjlangka NUMERIC(15, 2) DEFAULT 0,
    tjtkd NUMERIC(15, 2) DEFAULT 0,
    tjterpencil NUMERIC(15, 2) DEFAULT 0,
    tjkhusus NUMERIC(15, 2) DEFAULT 0,
    tjberas NUMERIC(15, 2) DEFAULT 0,
    tjpajak NUMERIC(15, 2) DEFAULT 0,
    tjaskes NUMERIC(15, 2) DEFAULT 0,
    tjumum NUMERIC(15, 2) DEFAULT 0,
    tjkk NUMERIC(15, 2) DEFAULT 0,
    tjkm NUMERIC(15, 2) DEFAULT 0,
    ttaperap NUMERIC(15, 2) DEFAULT 0,
    tbulat NUMERIC(15, 2) DEFAULT 0,
    kotor NUMERIC(15, 2) DEFAULT 0,
    iwp_beban_pegawai NUMERIC(15, 2) DEFAULT 0,
    iwp_beban_pembkerja NUMERIC(15, 2) DEFAULT 0,
    iwp_taspen NUMERIC(15, 2) DEFAULT 0,
    ppajak NUMERIC(15, 2) DEFAULT 0,
    pbulog NUMERIC(15, 2) DEFAULT 0,
    ptaperum NUMERIC(15, 2) DEFAULT 0,
    psewa NUMERIC(15, 2) DEFAULT 0,
    phutang NUMERIC(15, 2) DEFAULT 0,
    pkorpri NUMERIC(15, 2) DEFAULT 0,
    pirdhata NUMERIC(15, 2) DEFAULT 0,
    pkoperasi NUMERIC(15, 2) DEFAULT 0,
    pjkk NUMERIC(15, 2) DEFAULT 0,
    pjkm NUMERIC(15, 2) DEFAULT 0,
    ptaperap NUMERIC(15, 2) DEFAULT 0,
    ptaperai NUMERIC(15, 2) DEFAULT 0,
    potongan NUMERIC(15, 2) DEFAULT 0,
    bersih NUMERIC(15, 2) DEFAULT 0,
    imported_by VARCHAR(255) NOT NULL,
    imported_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_payroll_nip_period UNIQUE (nip, tglgaji)
);

CREATE INDEX idx_payroll_nip_period ON payroll_monthly(nip, tglgaji);
CREATE INDEX idx_payroll_opd_period ON payroll_monthly(nmskpd, tglgaji);

-- 4. TABEL POS POTONGAN TAMBAHAN (FLEKSIBEL)
CREATE TABLE ref_pos_potongan (
    id SERIAL PRIMARY KEY,
    opd_id INT REFERENCES ref_opd(id) ON DELETE CASCADE,
    nama_pos VARCHAR(150) NOT NULL,
    kategori potongan_type NOT NULL, -- 'bulanan' atau 'berjangka'
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Master Potongan Berjangka (Contoh: Pinjaman Bank, Angsuran Koperasi)
CREATE TABLE potongan_berjangka (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nip VARCHAR(30) NOT NULL,
    pos_id INT REFERENCES ref_pos_potongan(id) ON DELETE RESTRICT,
    nominal_per_bulan NUMERIC(15, 2) NOT NULL,
    start_period DATE NOT NULL, -- Misal 2027-01-01
    tenor_bulan INT NOT NULL,   -- Misal 36
    end_period DATE NOT NULL,   -- Misal 2029-12-01
    keterangan TEXT,
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_berjangka_nip ON potongan_berjangka(nip);

-- Log Realisasi Potongan per Bulan (Hasil Input Manual Bulanan & Eksekusi Berjangka)
CREATE TABLE payroll_potongan_item (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    payroll_id UUID REFERENCES payroll_monthly(id) ON DELETE CASCADE,
    nip VARCHAR(30) NOT NULL,
    period DATE NOT NULL,
    pos_id INT REFERENCES ref_pos_potongan(id) ON DELETE RESTRICT,
    berjangka_id UUID REFERENCES potongan_berjangka(id) ON DELETE SET NULL,
    cicilan_ke INT DEFAULT NULL, -- Urutan cicilan ke-X dari Y tenor
    nominal NUMERIC(15, 2) NOT NULL,
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_potongan_item_nip_period ON payroll_potongan_item(nip, period);

-- 5. AUDIT LOG & AKTIVITAS
CREATE TABLE audit_logs (
    id BIGSERIAL PRIMARY KEY,
    user_email VARCHAR(255) NOT NULL,
    action VARCHAR(100) NOT NULL,
    table_name VARCHAR(100),
    record_id VARCHAR(100),
    details JSONB,
    ip_address VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_audit_user_action ON audit_logs(user_email, action);

-- 6. INDEX UNIK UNTUK POTONGAN FLEKSIBEL
-- Nama pos tidak boleh duplikat dalam satu OPD (case-insensitive).
CREATE UNIQUE INDEX IF NOT EXISTS uq_ref_pos_opd_nama
    ON ref_pos_potongan (opd_id, lower(nama_pos));

-- Satu realisasi cicilan berjangka per pinjaman per periode.
CREATE UNIQUE INDEX IF NOT EXISTS uq_potongan_berjangka_period
    ON payroll_potongan_item (berjangka_id, period)
    WHERE berjangka_id IS NOT NULL;

-- Satu potongan manual per NIP + pos + periode (realisasi berjangka terpisah).
CREATE UNIQUE INDEX IF NOT EXISTS uq_potongan_manual_period
    ON payroll_potongan_item (nip, period, pos_id)
    WHERE berjangka_id IS NULL;
