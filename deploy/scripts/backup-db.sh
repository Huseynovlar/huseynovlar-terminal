#!/usr/bin/env bash
set -euo pipefail

# Online PostgreSQL backup for Huseynovlar Terminal
# Writes compressed .sql.gz + .sha256 into BACKUP_HOST_DIR so the host's
# existing encrypted Google Drive (restic) backup picks it up automatically.

ENV_FILE="${ENV_FILE:-/opt/huseynovlar-terminal/.env}"
get_env() {
  local key="$1" default="$2"
  if [[ -f "$ENV_FILE" ]]; then
    local val
    val="$(grep -E "^${key}=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- | tr -d '\r' | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")"
    if [[ -n "$val" ]]; then
      printf '%s' "$val"
      return
    fi
  fi
  printf '%s' "$default"
}

BACKUP_DIR="$(get_env BACKUP_HOST_DIR /var/backups/huseynovlar-terminal)"
RETENTION_DAYS="$(get_env BACKUP_RETENTION_DAYS 14)"
POSTGRES_USER="$(get_env POSTGRES_USER terminal_app)"
POSTGRES_DB="$(get_env POSTGRES_DB huseynovlar_terminal)"
CONTAINER_NAME="${POSTGRES_CONTAINER:-terminal-postgres}"

mkdir -p "$BACKUP_DIR"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_FILE="${BACKUP_DIR}/terminal_${TIMESTAMP}.sql.gz"
TMP_FILE="${OUT_FILE}.tmp"

echo "[backup] Starting pg_dump from ${CONTAINER_NAME} (${POSTGRES_DB})..."
docker exec "$CONTAINER_NAME" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-acl \
  | gzip -9 > "$TMP_FILE"

# Integrity check
gzip -t "$TMP_FILE"
mv "$TMP_FILE" "$OUT_FILE"
sha256sum "$OUT_FILE" > "${OUT_FILE}.sha256"

# Prune old local backups
find "$BACKUP_DIR" -type f \( -name 'terminal_*.sql.gz' -o -name 'terminal_*.sql.gz.sha256' \) \
  -mtime +"$RETENTION_DAYS" -delete

SIZE_HUMAN="$(du -h "$OUT_FILE" | awk '{print $1}')"
echo "[backup] Completed: ${OUT_FILE} (${SIZE_HUMAN})"
