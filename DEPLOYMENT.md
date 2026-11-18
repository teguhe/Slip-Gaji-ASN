# Panduan Operasional Server & Deployment Produksi (DEPLOYMENT.md)
## Aplikasi Cetak Slip Gaji ASN Pemerintah Daerah

Dokumen ini memuat prosedur standar deployment, konfigurasi reverse proxy Nginx/Nginx Proxy Manager, Cloudflare Tunnel, pengamanan TLS/SSL, dan otomatisasi backup basis data untuk lingkungan server Linux produksi (Ubuntu 22.04 / 24.04 LTS atau Debian 12).

---

## 1. Arsitektur Sistem Produksi

```
[ Klien / Peramban Web Bendahara OPD ]
               │
               ▼ HTTPS (Port 443)
┌─────────────────────────────────────────────────────────┐
│     Reverse Proxy & Edge Ingress (Nginx / Cloudflare)    │
│  - Terminasi TLS/SSL (Let's Encrypt / Cloudflare Edge)  │
│  - client_max_body_size 20M                             │
│  - Security Headers (HSTS, CSP, X-Frame-Options)        │
└──────────────────────────┬──────────────────────────────┘
                           │ HTTP (Port 8000)
┌──────────────────────────▼──────────────────────────────┐
│                    Docker Host                          │
│                                                         │
│  ┌────────────────────────┐  ┌───────────────────────┐  │
│  │ slip_gaji_api (FastAPI)│  │ slip_gaji_postgres    │  │
│  │ Python 3.11 + Uvicorn  ├──┤ PostgreSQL 15 Alpine  │  │
│  │ Port internal: 8000    │  │ Port internal: 5432   │  │
│  └────────────────────────┘  └───────────┬───────────┘  │
│                                          │              │
│                              Volume: pgdata             │
│                              Backups: ./backups/        │
└─────────────────────────────────────────────────────────┘
```

---

## 2. Prasyarat Lingkungan Server
* **Sistem Operasi:** Ubuntu 22.04 LTS / 24.04 LTS Server atau Debian 12 x86_64 / ARM64.
* **Spesifikasi Minimal:** 2 vCPU, 2 GB RAM, 20 GB SSD.
* **Perangkat Lunak:**
  - Docker Engine $\ge 24.0$ & Docker Compose v2 (`docker compose`).
  - Git, Curl, Gzip, Tar.
  - Port terbuka di firewall: `80/tcp` (HTTP) dan `443/tcp` (HTTPS). Port `5432` dan `8000` **tidak boleh** dibuka ke publik.

Instalasi Docker resmi (Ubuntu/Debian):
```bash
sudo apt-get update && sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch="$(dpkg --print-architecture)" signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  "$(. /etc/os-release && echo "$VERSION_CODENAME")" stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update && sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker $USER
```

---

## 3. Langkah Kloning & Penyiapan Lingkungan

1. **Kloning Repositori:**
   ```bash
   cd /opt
   sudo git clone https://github.com/teguh/slip-gaji-asn.git slip-gaji
   sudo chown -R $USER:$USER /opt/slip-gaji
   cd /opt/slip-gaji
   ```

2. **Konfigurasi Environment Variables (`.env`):**
   Salin template `.env.example`:
   ```bash
   cp .env.example .env
   chmod 600 .env
   ```
   Edit nilai `.env` menggunakan teks editor:
   ```env
   # Koneksi Basis Data
   POSTGRES_DB=slip_gaji_db
   POSTGRES_USER=postgres
   POSTGRES_PASSWORD=GantiDenganPasswordKuatDanAcak2026!
   DATABASE_URL=postgresql://postgres:GantiDenganPasswordKuatDanAcak2026!@db:5432/slip_gaji_db

   # Keamanan & Hak Akses
   SUPER_ADMIN_EMAIL=teguhe@gmail.com
   INTERNAL_API_KEY=KunciApiInternalRahasiaAcakPanjangMinimal32Karakter

   # Firebase Auth Service Account (JSON Kredensial)
   FIREBASE_ADMIN_CREDENTIALS=/app/firebase_creds.json

   # Batasan Upload
   MAX_UPLOAD_MB=20
   MAX_IMPORT_ROWS=50000
   ```

3. **Penyiapan Kredensial Firebase:**
   Unduh service account key dari Google Cloud Console / Firebase Console $\rightarrow$ Project Settings $\rightarrow$ Service Accounts $\rightarrow$ Generate New Private Key.
   Simpan berkas tersebut di path server:
   ```bash
   cp /path/to/downloaded-service-account.json /opt/slip-gaji/firebase_creds.json
   chmod 600 /opt/slip-gaji/firebase_creds.json
   ```

4. **Jalankan Kontainer Aplikasi:**
   ```bash
   docker compose up -d --build
   ```
   Verifikasi status kontainer:
   ```bash
   docker compose ps
   curl -I http://127.0.0.1:8000/health
   ```
   Respons yang diharapkan: `{"status":"ok","database":"ok"}`.

---

## 4. Konfigurasi Reverse Proxy Nginx & TLS/SSL

### A. Konfigurasi Standar Nginx (Host Standalone)
Buat berkas konfigurasi Nginx di `/etc/nginx/sites-available/slip-gaji.conf`:

```nginx
# HTTP - Redirect seluruh trafik ke HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name slipgaji.pemda.go.id;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

# HTTPS
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name slipgaji.pemda.go.id;

    # Sertifikat SSL (Let's Encrypt Certbot)
    ssl_certificate /etc/letsencrypt/live/slipgaji.pemda.go.id/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/slipgaji.pemda.go.id/privkey.pem;

    # Parameter Keamanan TLS
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;
    ssl_ciphers 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384';
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;
    ssl_session_tickets off;

    # Header Keamanan Produksi
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # Batas Ukuran Upload Excel (SIMGAJI)
    client_max_body_size 20M;
    client_body_buffer_size 128k;

    # Proxy ke FastAPI Backend
    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;

        # WebSocket / Keep-Alive headers
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Forwarding Headers Standar
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Port $server_port;

        # Timeouts untuk pemrosesan file Excel besar
        proxy_connect_timeout 60s;
        proxy_send_timeout 120s;
        proxy_read_timeout 120s;
    }

    # Static Caching untuk berkas aset frontend web
    location ~* \.(css|js|png|jpg|jpeg|svg|ico|woff|woff2)$ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        expires 7d;
        add_header Cache-Control "public, no-transform";
    }
}
```

Aktifkan konfigurasi dan terbitkan sertifikat Let's Encrypt:
```bash
sudo ln -s /etc/nginx/sites-available/slip-gaji.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# Terbitkan SSL Certbot otomatis
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d slipgaji.pemda.go.id --non-interactive --agree-tos -m admin@pemda.go.id
```

---

### B. Konfigurasi Nginx Proxy Manager (NPM GUI)
Jika Anda menggunakan Nginx Proxy Manager:
1. Buka dashboard NPM $\rightarrow$ **Proxy Hosts** $\rightarrow$ **Add Proxy Host**.
2. **Tab Details:**
   - Domain Names: `slipgaji.pemda.go.id`
   - Scheme: `http`
   - Forward Hostname / IP: IP internal server atau nama kontainer Docker (misal `172.17.0.1` atau `slip_gaji_api`).
   - Forward Port: `8000`
   - Centang: *Cache Assets*, *Block Common Exploits*, *Websockets Support*.
3. **Tab Custom Locations / Advanced:**
   Tambahkan baris berikut pada field Custom Nginx Configuration:
   ```nginx
   client_max_body_size 20M;
   proxy_read_timeout 120s;
   proxy_send_timeout 120s;
   ```
4. **Tab SSL:**
   - SSL Certificate: *Request a new SSL Certificate with Let's Encrypt*.
   - Centang: *Force SSL*, *HTTP/2 Support*, *HSTS Enabled*.
5. Klik **Save**.

---

## 5. Deployment Homelab Tanpa IP Publik Statis (Cloudflare Tunnel)

Jika server aplikasi ditempatkan di server lokal (Homelab / intranet OPD) tanpa IP publik statis atau berada di balik NAT/CGNAT, gunakan **Cloudflare Tunnel** (`cloudflared`):

1. **Instalasi Cloudflared Daemon:**
   ```bash
   curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
   echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared jammy main' | sudo tee /etc/apt/sources.list.d/cloudflared.list
   sudo apt-get update && sudo apt-get install -y cloudflared
   ```

2. **Autentikasi & Pembuatan Tunnel:**
   ```bash
   cloudflared tunnel login
   cloudflared tunnel create slipgaji-tunnel
   ```
   Perintah di atas menghasilkan ID Tunnel (misal `a1b2c3d4-e5f6-7890-abcd-1234567890ab`) dan berkas credential JSON di `~/.cloudflared/`.

3. **Konfigurasi Berkas `~/.cloudflared/config.yml`:**
   ```yaml
   tunnel: a1b2c3d4-e5f6-7890-abcd-1234567890ab
   credentials-file: /etc/cloudflared/a1b2c3d4-e5f6-7890-abcd-1234567890ab.json

   ingress:
     # Rute aplikasi Slip Gaji ASN
     - hostname: slipgaji.pemda.go.id
       service: http://localhost:8000
       originRequest:
         connectTimeout: 30s
         noTLSVerify: true

     # Catch-all rule (wajib ada di baris akhir)
     - service: http_status:404
   ```

4. **Koneksikan DNS Cloudflare:**
   ```bash
   cloudflared tunnel route dns slipgaji-tunnel slipgaji.pemda.go.id
   ```

5. **Jalankan Cloudflared sebagai Systemd Service:**
   ```bash
   sudo cp ~/.cloudflared/config.yml /etc/cloudflared/
   sudo cp ~/.cloudflared/*.json /etc/cloudflared/
   sudo cloudflared service install
   sudo systemctl enable --now cloudflared
   sudo systemctl status cloudflared
   ```

---

## 6. Otomatisasi Backup Database dengan Cron Job

Sistem menyediakan skrip cadangan otomatis pada `scripts/backup_db.sh` yang melakukan dump basis data terkompresi `.sql.gz` dengan rotasi retensi 30 hari.

1. **Uji Coba Manual Skrip:**
   ```bash
   cd /opt/slip-gaji
   ./scripts/backup_db.sh
   ls -lh /opt/slip-gaji/backups/
   ```

2. **Daftarkan Jadwal Cron Harian (Setiap Pukul 02:00 Pagi):**
   Buka crontab root:
   ```bash
   sudo crontab -e
   ```
   Tambahkan baris berikut di akhir berkas:
   ```cron
   # Backup harian database Slip Gaji ASN pukul 02:00 WIB
   0 2 * * * /opt/slip-gaji/scripts/backup_db.sh >> /var/log/slip_gaji_backup.log 2>&1
   ```

3. **Prosedur Pemulihan Cepat (Disaster Recovery):**
   Jika terjadi kegagalan sistem atau migrasi server:
   ```bash
   cd /opt/slip-gaji
   # Memulihkan dari backup paling mutakhir (interaktif)
   ./scripts/restore_db.sh

   # Atau tentukan berkas backup spesifik secara otomatis:
   ./scripts/restore_db.sh /opt/slip-gaji/backups/backup_slip_gaji_20261118_132932.sql.gz -y
   ```

---

## 7. Pemantauan & Pemeliharaan Berkala

### Memeriksa Log Aplikasi
```bash
# Log Realtime API
docker compose logs -f app

# Log Database PostgreSQL
docker compose logs -f db

# Memeriksa Audit Trail Langsung di DB
docker exec -it slip_gaji_postgres psql -U postgres -d slip_gaji_db -c "
  SELECT created_at, user_email, action, details->>'opd' AS opd 
  FROM audit_logs ORDER BY created_at DESC LIMIT 10;
"
```

### Prosedur Update Versi Aplikasi
```bash
cd /opt/slip-gaji
git pull origin dev
docker compose build app
docker compose up -d
```
