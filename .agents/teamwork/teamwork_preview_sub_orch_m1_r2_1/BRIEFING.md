# Briefing — Milestone 1 (`M1`): Infra, Docker/Deploy, Configs, MQL5 Bridge & `server_telegram_bot`

- **Milestone**: `M1` (`teamwork_preview_sub_orch_m1_r2_1`)
- **Current Phase**: Step `2B.a` — Fast Targeted Exploration
- **Primary Repo**: `/home/antigravity/Huseynovlar/huseynovlar-terminal`
- **Secondary Repo**: `/home/antigravity/Huseynovlar/server_telegram_bot`

## Mission Context
Milestone 1 lays the production infrastructure, deployment safety, configuration catalogs, MQL5 dual-EA telemetry bridge, and Telegram alerts webhook foundation required by `ORIGINAL_REQUEST.md` and `PROJECT.md`:
1. Unblock `POST /internal/webhooks/trading` in `server_telegram_bot` (`DEFAULT_AUTH_SKIP_PATHS`) with full test coverage and deploy parity.
2. Fix `huseynovlar-terminal` Docker networking (`panel_egress` + DNS `[1.1.1.1, 9.9.9.9]` on `backend`, dotted alias `ingest.terminal.local` on `exness_mt5_ingest`, `--forwarded-allow-ips=*`, `CONFIG_DIR=/app/config`, `/app/mql5` in `backend/Dockerfile`, `docker-proxy` `INFO: 1`), create idempotent `setup-vps-integrations.sh` and `backup-db.sh`, clean `.env.example`, `.gitignore`, and CI workflows.
3. Enrich `config/news_sources.yaml`, `config/treemap.yaml`, `config/assets.default.yaml`, `config/alerts.default.yaml`, and add `config/providers.yaml` with 100% real symbols and institutional RSS/calendar feeds.
4. Upgrade `mql5/ExnessPanelBridge.mq5` and `mql5/ExnessPanelHook.mqh` for dotted URL `http://ingest.terminal.local:8000/api/v1/ingest`, actionable RU+EN `err=4014` diagnostics, lock-safe `ep_ipc` JSONL IPC, and zero-config sibling-chart EA auto-discovery (`NasdaqPulse v3.01` telemetry scraping).
