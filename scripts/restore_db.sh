#!/usr/bin/env bash
# ==============================================================================
# restore_db.sh - Skrip Pemulihan Basis Data PostgreSQL Slip Gaji
# ==============================================================================
# Penggunaan:
#   ./scripts/restore_db.sh [PATH_FILE_BACKUP] [-y|--yes]
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

BACKUP_DIR="${BACKUP_DIR:-${PROJECT_ROOT}/backups}"
DB_NAME="${POSTGRES_DB:-slip_gaji_db}"
DB_USER="${POSTGRES_USER:-postgres}"
DB_HOST="${POSTGRES_HOST:-localhost}"
DB_PORT="${POSTGRES_PORT:-5432}"
CONTAINER_NAME="${DOCKER_DB_CONTAINER:-slip_gaji_postgres}"
AUTO_YES="${RESTORE_FORCE:-0}"

# Parsing argumen
BACKUP_FILE=""
for arg in "$@"; do
    case "$arg" in
        -y|--yes)
            AUTO_YES=1
            ;;
        -h|--help)
            echo "Penggunaan: $0 [PATH_FILE_BACKUP] [-y|--yes]"
            exit 0
            ;;
        *)
            if [ -z "${BACKUP_FILE}" ]; then
                BACKUP_FILE="$arg"
            fi
            ;;
    esac
done

# Validasi input argumen
if [ -z "${BACKUP_FILE}" ]; then
    echo "[INFO] Mencari file cadangan terbaru di ${BACKUP_DIR}..."
    BACKUP_FILE=$(find "${BACKUP_DIR}" -name "backup_slip_gaji_*.sql.gz" -type f | sort -r | head -n 1 || true)
    if [ -z "${BACKUP_FILE}" ]; then
        echo "[ERROR] Tidak ada file backup ditemukan di ${BACKUP_DIR}." >&2
        exit 1
    fi
    echo "[INFO] Menggunakan file backup: ${BACKUP_FILE}"
else
    if [ ! -f "${BACKUP_FILE}" ]; then
        echo "[ERROR] File tidak ditemukan: ${BACKUP_FILE}" >&2
        exit 1
    fi
fi

# Konfirmasi keamanan
echo "=============================================================================="
echo "PERINGATAN: Operasi ini akan menimpa/memulihkan basis data '${DB_NAME}'"
echo "dari berkas: ${BACKUP_FILE}."
echo "Proses ini TIDAK DAPAT DIBATALKAN."
echo "=============================================================================="

if [ "${AUTO_YES}" != "1" ]; then
    read -p "Apakah Anda yakin untuk melanjutkan? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "[INFO] Operasi dibatalkan oleh pengguna."
        exit 0
    fi
else
    echo "[INFO] Flag konfirmasi otomatis (-y/--yes) aktif, melanjutkan pemulihan..."
fi

echo "[INFO] Memulai pemulihan basis data..."

# Eksekusi restore
if [ -f "/.dockerenv" ] || [ "${RUNNING_IN_DOCKER:-0}" = "1" ]; then
    echo "[INFO] Menjalankan restore langsung di lingkungan internal..."
    PGPASSWORD="${POSTGRES_PASSWORD:-postgres_password}" zcat "${BACKUP_FILE}" | \
        psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}"
elif command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -Eq "^${CONTAINER_NAME}\$"; then
    echo "[INFO] Mengunggah dan melakukan restore via kontainer Docker '${CONTAINER_NAME}'..."
    zcat "${BACKUP_FILE}" | docker exec -i "${CONTAINER_NAME}" psql -U "${DB_USER}" -d "${DB_NAME}"
else
    echo "[INFO] Menggunakan psql lokal ke ${DB_HOST}:${DB_PORT}..."
    PGPASSWORD="${POSTGRES_PASSWORD:-postgres_password}" zcat "${BACKUP_FILE}" | \
        psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}"
fi

echo "[SUKSES] [$(date +"%Y-%m-%d %H:%M:%S")] Basis data '${DB_NAME}' berhasil dipulihkan."
exit 0
