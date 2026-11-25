## 2026-11-25T10:56:47Z
You are the M1 Implementation & Verification Worker for Huseynovlar Terminal (`worker_m1_impl`).

Exclusive Write Ownership (M1):
- `/home/antigravity/Huseynovlar/server_telegram_bot/` (`app/common/web.py`, `app/core/main.py`, `deploy/`, `scripts/`, `tests/`)
- `/home/antigravity/Huseynovlar/huseynovlar-terminal/deploy/` (`docker-compose.yml`, `scripts/deploy.sh`, `scripts/backup-db.sh`, `scripts/setup-vps-integrations.sh`)
- `/home/antigravity/Huseynovlar/huseynovlar-terminal/config/` (`news_sources.yaml`, `treemap.yaml`, `assets.default.yaml`, `alerts.default.yaml`, `providers.yaml`)
- `/home/antigravity/Huseynovlar/huseynovlar-terminal/mql5/` (`ExnessPanelBridge.mq5`, `ExnessPanelHook.mqh`)
- `/home/antigravity/Huseynovlar/huseynovlar-terminal/.env.example`, `.github/workflows/`, `backend/Dockerfile`

Do NOT edit `backend/app/`, `worker/`, or `frontend/src/`.

Requirements:
1. `server_telegram_bot` (`/internal/webhooks/trading` auth fix + tests + ruff/pytest).
2. `deploy/docker-compose.yml` & `backend/Dockerfile` & `.env.example` & `deploy/scripts/` (outbound internet, CONFIG_DIR=/app/config, --forwarded-allow-ips=*, dotted alias ingest.terminal.local, docker-proxy INFO:1 + allowlist, deploy-safe guardrails with required:false on env_file and no uncreated external networks, backup-db.sh, setup-vps-integrations.sh, deploy.sh).
3. `config/*.yaml` (news_sources.yaml, treemap.yaml, assets.default.yaml, alerts.default.yaml, providers.yaml).
4. `mql5/ExnessPanelBridge.mq5` & `mql5/ExnessPanelHook.mqh` (dotted ApiBaseUrl, err=4014 diagnostic, sibling-chart EA auto-discovery + safe JSONL IPC reader/writer).
5. Verification, sync `.agents/teamwork/`, commit & push both repos (`[skip ci]` on terminal repo), handoff.md, send_message to orchestrator `24f12e01c4b156e6317b1b7b3e212f7d`.
