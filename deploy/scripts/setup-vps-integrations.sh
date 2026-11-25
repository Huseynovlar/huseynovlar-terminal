#!/usr/bin/env bash
set -euo pipefail

# Idempotent VPS integrations setup for Huseynovlar Terminal & server_telegram_bot.
# - Creates /etc/huseynovlar-terminal/integrations.env (0640) if missing
# - Ensures shared internal Docker networks (exness_mt5_ingest, huseynovlar_webhooks)
# - Writes optional docker-compose.override.yml files for cross-stack webhook routing
#
# Environment overrides (useful for dry-run / testing):
#   ETC_DIR=/etc/huseynovlar-terminal
#   TERMINAL_DIR=/opt/huseynovlar-terminal
#   BOT_DIR=/opt/huseynovlar-bot
#   SKIP_DOCKER=0
#   DRY_RUN=0

ETC_DIR="${ETC_DIR:-/etc/huseynovlar-terminal}"
INTEGRATIONS_FILE="${ETC_DIR}/integrations.env"
TERMINAL_DIR="${TERMINAL_DIR:-/opt/huseynovlar-terminal}"
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

log "Ensuring ${ETC_DIR} exists..."
run_cmd install -d -m 750 "$ETC_DIR"

if [[ ! -f "$INTEGRATIONS_FILE" ]]; then
  WEBHOOK_SECRET="$(generate_secret)"
  log "Creating ${INTEGRATIONS_FILE} with generated TELEGRAM_WEBHOOK_SECRET..."
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "[dry-run] write ${INTEGRATIONS_FILE}"
  else
    cat > "$INTEGRATIONS_FILE" <<EOF
# Huseynovlar Terminal — Host-level Integrations Secrets
# Loaded automatically by terminal-backend & terminal-worker via compose env_file.
# Permissions: 0640 (do NOT commit to git)

# Google AI Studio (Gemini) — https://aistudio.google.com/apikey
GEMINI_API_KEY=
GOOGLE_AI_API_KEY=
GEMINI_DEFAULT_MODEL=gemini-2.5-flash
GOOGLE_AI_DEFAULT_MODEL=gemini-2.5-flash

# server_telegram_bot internal trading alerts webhook
TELEGRAM_WEBHOOK_URL=http://huseynovlar-core:8080/internal/webhooks/trading
ALERTS_BOT_WEBHOOK_URL=http://huseynovlar-core:8080/internal/webhooks/trading
TELEGRAM_WEBHOOK_SECRET=${WEBHOOK_SECRET}
ALERTS_BOT_WEBHOOK_SECRET=${WEBHOOK_SECRET}

# Optional IP Geolocation endpoint (default: http://ip-api.com/json/{ip})
IP_GEO_API_URL=
EOF
    chmod 640 "$INTEGRATIONS_FILE"
  fi
else
  log "${INTEGRATIONS_FILE} already exists — preserving existing secrets."
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
