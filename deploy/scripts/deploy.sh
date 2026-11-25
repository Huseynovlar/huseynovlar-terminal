#!/usr/bin/env bash
# Installed on VPS as /usr/local/bin/huseynovlar-terminal-deploy and bound to
# deploy-bot SSH key via authorized_keys (matching server_telegram_bot pattern):
#   restrict,command="/usr/local/bin/huseynovlar-terminal-deploy" ssh-ed25519 ...
# GitHub Actions streams release.tgz containing backend.tar + frontend.tar on stdin.
set -euo pipefail

BASE=/opt/huseynovlar-terminal
TAG="${SSH_ORIGINAL_COMMAND:-}"
[[ "$TAG" =~ ^[0-9a-f]{7,40}$ ]] || { echo "invalid release tag" >&2; exit 1; }

exec 9>"$BASE/.deploy.lock"
flock -n 9 || { echo "another deploy is running" >&2; exit 1; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
tar -xzf - -C "$TMP" --no-same-owner --no-same-permissions
[ -f "$TMP/backend.tar" ] && [ -f "$TMP/frontend.tar" ] || { echo "bundle missing image tars" >&2; exit 1; }

# Auto-sync docker-compose.yml and config/ from GitHub Actions release bundle
if [ -f "$TMP/docker-compose.yml" ]; then
  cp "$TMP/docker-compose.yml" "$BASE/docker-compose.yml"
fi
if [ -d "$TMP/config" ]; then
  rm -rf "$BASE/config"
  cp -r "$TMP/config" "$BASE/config"
fi
if [ -d "$TMP/mql5" ]; then
  rm -rf "$BASE/mql5"
  cp -r "$TMP/mql5" "$BASE/mql5"
fi

docker load -i "$TMP/backend.tar"
docker load -i "$TMP/frontend.tar"

docker network inspect exness_mt5_ingest >/dev/null 2>&1 || docker network create exness_mt5_ingest --internal

PREV="$(cat "$BASE/current_tag" 2>/dev/null || true)"
dc() {
  local tag="$1"; shift
  local -a compose_files=(-f "$BASE/docker-compose.yml")
  if [ -f "$BASE/docker-compose.override.yml" ]; then
    compose_files+=(-f "$BASE/docker-compose.override.yml")
  fi
  IMAGE_TAG="$tag" docker compose -p huseynovlar-terminal --env-file "$BASE/.env" \
    "${compose_files[@]}" "$@"
}

if dc "$TAG" up -d --remove-orphans --wait --wait-timeout 150; then
  echo "$PREV" > "$BASE/previous_tag"
  echo "$TAG" > "$BASE/current_tag"
  echo "Deployed huseynovlar-terminal:$TAG"
else
  echo "Deploy of $TAG FAILED" >&2
  dc "$TAG" logs --tail 40 >&2 || true
  if [ -n "$PREV" ]; then
    echo "Rolling back to $PREV" >&2
    dc "$PREV" up -d --remove-orphans --wait --wait-timeout 150 || true
  fi
  exit 1
fi

for repo in huseynovlar-terminal-backend huseynovlar-terminal-frontend; do
  docker images "$repo" --format '{{.Tag}}' | tail -n +6 | while read -r t; do
    docker rmi "$repo:$t" >/dev/null 2>&1 || true
  done
done
