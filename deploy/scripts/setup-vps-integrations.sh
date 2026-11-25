#!/usr/bin/env bash
set -euo pipefail

# Idempotent VPS integrations setup for Huseynovlar Terminal & server_telegram_bot.
# - Merges missing integration keys into /opt/huseynovlar-terminal/.env (existing values preserved)
# - Ensures shared internal Docker networks (exness_mt5_ingest, huseynovlar_webhooks)
# - Writes optional docker-compose.override.yml files for cross-stack webhook routing
#
# Environment overrides (useful for dry-run / testing):
#   INTEGRATIONS_FILE=/opt/huseynovlar-terminal/.env
#   TERMINAL_DIR=/opt/huseynovlar-terminal
#   BOT_DIR=/opt/huseynovlar-bot
#   SKIP_DOCKER=0
#   DRY_RUN=0

TERMINAL_DIR="${TERMINAL_DIR:-/opt/huseynovlar-terminal}"
INTEGRATIONS_FILE="${INTEGRATIONS_FILE:-${TERMINAL_DIR}/.env}"
BOT_DIR="${BOT_DIR:-/opt/huseynovlar-bot}"
SKIP_DOCKER="${SKIP_DOCKER:-0}"
DRY_RUN="${DRY_RUN:-0}"

log() { echo "[setup-vps-integrations] $*"; }

run_cmd() {
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "[dry-run] $*"
  else
    "$@"
  fi
}

generate_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    python3 -c 'import secrets; print(secrets.token_hex(32))'
  fi
}

ensure_kv() {
  # ensure_kv KEY VALUE: append KEY=VALUE to the .env only when KEY is not set yet (preserves existing secrets).
  local key="$1" value="$2"
  if grep -qE "^${key}=" "$INTEGRATIONS_FILE" 2>/dev/null; then
    return 0
  fi
  echo "${key}=${value}" >> "$INTEGRATIONS_FILE"
}

log "Ensuring ${INTEGRATIONS_FILE} exists..."
if [[ "$DRY_RUN" == "1" ]]; then
  echo "[dry-run] merge integration keys into ${INTEGRATIONS_FILE}"
else
  install -d -m 755 "$(dirname "$INTEGRATIONS_FILE")"
  touch "$INTEGRATIONS_FILE"
  WEBHOOK_SECRET=""
  if [[ -f "${BOT_DIR}/.env" ]]; then
    WEBHOOK_SECRET="$(grep -E '^TRADING_WEBHOOK_SECRET=' "${BOT_DIR}/.env" | tail -n1 | cut -d'=' -f2- | tr -d '"' | tr -d "'" || true)"
  fi
  [[ -n "$WEBHOOK_SECRET" ]] || WEBHOOK_SECRET="$(generate_secret)"
  ensure_kv GEMINI_API_KEY ""
  ensure_kv GEMINI_DEFAULT_MODEL gemini-3.8-flash
  ensure_kv TELEGRAM_WEBHOOK_URL http://huseynovlar-core:8080/internal/webhooks/trading
  ensure_kv TELEGRAM_WEBHOOK_SECRET "$WEBHOOK_SECRET"
  ensure_kv IP_GEO_API_URL ""
  chmod 640 "$INTEGRATIONS_FILE"
fi

if [[ "$SKIP_DOCKER" != "1" ]] && command -v docker >/dev/null 2>&1; then
  log "Ensuring internal Docker networks exist..."
  if ! docker network inspect exness_mt5_ingest >/dev/null 2>&1; then
    run_cmd docker network create exness_mt5_ingest --internal
  fi
  if ! docker network inspect huseynovlar_webhooks >/dev/null 2>&1; then
    run_cmd docker network create huseynovlar_webhooks --internal
  fi
fi

if [[ -d "$TERMINAL_DIR" ]]; then
  OVERRIDE_TERMINAL="${TERMINAL_DIR}/docker-compose.override.yml"
  if [[ ! -f "$OVERRIDE_TERMINAL" ]]; then
    log "Writing ${OVERRIDE_TERMINAL} to attach backend/worker to huseynovlar_webhooks..."
    if [[ "$DRY_RUN" != "1" ]]; then
      cat > "$OVERRIDE_TERMINAL" <<'EOF'
services:
  backend:
    networks:
      huseynovlar_webhooks: {}
  worker:
    networks:
      huseynovlar_webhooks: {}

networks:
  huseynovlar_webhooks:
    external: true
EOF
      chmod 644 "$OVERRIDE_TERMINAL"
    fi
  fi
fi

if [[ -d "$BOT_DIR" ]]; then
  OVERRIDE_BOT="${BOT_DIR}/docker-compose.override.yml"
  if [[ ! -f "$OVERRIDE_BOT" ]]; then
    log "Writing ${OVERRIDE_BOT} to attach huseynovlar-core to huseynovlar_webhooks..."
    if [[ "$DRY_RUN" != "1" ]]; then
      cat > "$OVERRIDE_BOT" <<'EOF'
services:
  core:
    networks:
      - huseynovlar_webhooks

networks:
  huseynovlar_webhooks:
    external: true
EOF
      chmod 644 "$OVERRIDE_BOT"
    fi
  fi
fi

log "Done. Remember to sync TRADING_WEBHOOK_SECRET in ${BOT_DIR}/.env with TELEGRAM_WEBHOOK_SECRET in ${INTEGRATIONS_FILE}."
