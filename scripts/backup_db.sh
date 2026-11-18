#!/usr/bin/env bash
# ==============================================================================
# backup_db.sh - Skrip Otomatisasi Pencadangan Basis Data PostgreSQL Slip Gaji
# ==============================================================================
# Penggunaan:
#   ./scripts/backup_db.sh
# Dapat dijalankan di host (otomatis mendeteksi kontainer Docker) atau di dalam kontainer.
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Konfigurasi Default (Dapat ditimpa via environment variables)
DB_NAME="${POSTGRES_DB:-slip_gaji_db}"
DB_USER="${POSTGRES_USER:-postgres}"
DB_HOST="${POSTGRES_HOST:-localhost}"
DB_PORT="${POSTGRES_PORT:-5432}"
CONTAINER_NAME="${DOCKER_DB_CONTAINER:-slip_gaji_postgres}"
BACKUP_DIR="${BACKUP_DIR:-${PROJECT_ROOT}/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"

TIMESTAMP="$(date +"%Y%m%d_%H%M%S")"
BACKUP_FILENAME="backup_slip_gaji_${TIMESTAMP}.sql.gz"
BACKUP_FILEPATH="${BACKUP_DIR}/${BACKUP_FILENAME}"

mkdir -p "${BACKUP_DIR}"

echo "[INFO] [$(date +"%Y-%m-%d %H:%M:%S")] Memulai pencadangan database '${DB_NAME}'..."

# Cek apakah dijalankan di dalam kontainer Docker atau di host
if [ -f "/.dockerenv" ] || [ "${RUNNING_IN_DOCKER:-0}" = "1" ]; then
    echo "[INFO] Terdeteksi lingkungan internal kontainer/host langsung."
    if ! command -v pg_dump >/dev/null 2>&1; then
        echo "[ERROR] 'pg_dump' tidak ditemukan dalam lingkungan saat ini." >&2
        exit 1
    fi
    PGPASSWORD="${POSTGRES_PASSWORD:-postgres_password}" pg_dump \
        -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" \
        --clean --if-exists --no-owner --no-privileges | gzip -9 > "${BACKUP_FILEPATH}"
else
    # Cek apakah kontainer docker database sedang berjalan
    if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -Eq "^${CONTAINER_NAME}\$"; then
        echo "[INFO] Menjalankan pg_dump via kontainer Docker: '${CONTAINER_NAME}'..."
        docker exec -i "${CONTAINER_NAME}" pg_dump \
            -U "${DB_USER}" -d "${DB_NAME}" \
            --clean --if-exists --no-owner --no-privileges | gzip -9 > "${BACKUP_FILEPATH}"
    elif command -v pg_dump >/dev/null 2>&1; then
        echo "[INFO] Kontainer Docker tidak terdeteksi, mencoba koneksi pg_dump lokal ke ${DB_HOST}:${DB_PORT}..."
        PGPASSWORD="${POSTGRES_PASSWORD:-postgres_password}" pg_dump \
            -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" \
            --clean --if-exists --no-owner --no-privileges | gzip -9 > "${BACKUP_FILEPATH}"
    else
        echo "[ERROR] Tidak dapat menemukan kontainer Docker '${CONTAINER_NAME}' maupun binary 'pg_dump' di host." >&2
        exit 1
    fi
fi

# Validasi berkas hasil backup
if [ ! -s "${BACKUP_FILEPATH}" ]; then
    echo "[ERROR] File cadangan kosong atau gagal dibuat: ${BACKUP_FILEPATH}" >&2
    rm -f "${BACKUP_FILEPATH}"
    exit 1
fi

if ! gzip -t "${BACKUP_FILEPATH}" 2>/dev/null; then
    echo "[ERROR] Integritas gzip berkas cadangan rusak: ${BACKUP_FILEPATH}" >&2
    rm -f "${BACKUP_FILEPATH}"
    exit 1
fi

FILE_SIZE="$(du -h "${BACKUP_FILEPATH}" | cut -f1)"
echo "[SUKSES] [$(date +"%Y-%m-%d %H:%M:%S")] Pencadangan selesai: ${BACKUP_FILEPATH} (${FILE_SIZE})"

# Rotasi pembersihan berkas backup lama (> RETENTION_DAYS hari)
echo "[INFO] Memeriksa pembersihan cadangan lebih dari ${RETENTION_DAYS} hari di ${BACKUP_DIR}..."
DELETED_COUNT=0
while IFS= read -r -d '' old_file; do
    echo "[INFO] Menghapus backup usang: $(basename "${old_file}")"
    rm -f "${old_file}"
    DELETED_COUNT=$((DELETED_COUNT + 1))
done < <(find "${BACKUP_DIR}" -type f -name "backup_slip_gaji_*.sql.gz" -mtime "+${RETENTION_DAYS}" -print0)

echo "[INFO] Pembersihan selesai. ${DELETED_COUNT} file lama dihapus."
exit 0
