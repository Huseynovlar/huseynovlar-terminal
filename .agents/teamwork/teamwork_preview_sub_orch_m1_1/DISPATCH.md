# Dispatch — Milestone 1 (`M1`) Sub-Orchestrator

- **Sender / Parent Conversation ID**: `b5546ea1526f70a42ec92262cd4e980a`
- **Timestamp**: `2026-11-24T21:01:39Z`
- **Assigned State Folder**: `/home/antigravity/.agents/teamwork/teamwork_preview_sub_orch_m1_1`
- **Primary Repository**: `/home/antigravity/Huseynovlar/huseynovlar-terminal`
- **Secondary Repository**: `/home/antigravity/Huseynovlar/server_telegram_bot`

## Exclusive Write Ownership (STRICT)
- `/home/antigravity/Huseynovlar/server_telegram_bot/**`
- `/home/antigravity/Huseynovlar/huseynovlar-terminal/deploy/**`
- `/home/antigravity/Huseynovlar/huseynovlar-terminal/config/**`
- `/home/antigravity/Huseynovlar/huseynovlar-terminal/mql5/**`
- `/home/antigravity/Huseynovlar/huseynovlar-terminal/backend/Dockerfile`
- `/home/antigravity/Huseynovlar/huseynovlar-terminal/.env.example`
- `/home/antigravity/Huseynovlar/huseynovlar-terminal/.github/workflows/**`

*(NEVER write outside these paths, NEVER run `git commit` or `git push`.)*

## Deliverables Summary
1. **`server_telegram_bot` Webhook Fix & Deploy Parity**:
   - Add `"/internal/webhooks/trading"` to `DEFAULT_AUTH_SKIP_PATHS` in `app/common/web.py`.
   - Add thorough automated unit/integration tests in `server_telegram_bot/tests/` testing `POST /internal/webhooks/trading` through the full middleware stack (valid secret -> `200`, wrong/missing secret -> `401/403`, payload formatting).
   - Update `server_telegram_bot/deploy/docker-compose.yml` / `scripts/server/deploy.sh` / `.github/workflows/deploy-production.yml` safely if needed so `TRADING_WEBHOOK_SECRET` is passed cleanly, and ensure `ruff check .`, `ruff format --check .`, and `pytest -q -W error::ResourceWarning` pass 100%.
2. **`huseynovlar-terminal` Docker, Deploy, Backup & `/etc` Host Script**:
   - `backend/Dockerfile`: `ENV CONFIG_DIR=/app/config`.
   - `deploy/docker-compose.yml` (100% deploy-safe via `docker compose config --quiet` without pre-created external networks or `/etc` files): `backend` on `panel_egress` + `dns: [1.1.1.1, 9.9.9.9]`, `CONFIG_DIR: /app/config`, `INTEGRATIONS_ENV_FILE: /etc/huseynovlar-terminal/integrations.env`, Gemini & Alerts Bot env vars, `--forwarded-allow-ips=*` on `uvicorn`, `ingest.terminal.local` alias on `exness_mt5_ingest`; `worker` `CONFIG_DIR` & `INTEGRATIONS_ENV_FILE`; `docker-proxy` `CONTAINERS: 1`, `POST: 1`, `INFO: 1`, `NETWORKS: 1`.
   - `deploy/scripts/setup-vps-integrations.sh`: idempotent root setup script (`/etc/huseynovlar-terminal/integrations.env` `chmod 640`, sync `TRADING_WEBHOOK_SECRET` with `/opt/huseynovlar-bot/.env`, `docker-compose.override.yml` mounting `/etc/huseynovlar-terminal:/etc/huseynovlar-terminal:ro` & bridging `huseynovlar_webhooks`, connecting `mt5-xau` & `mt5-ustec` to `exness_mt5_ingest`, `ALLOWED_MT5_CONTAINERS=mt5-xau,mt5-ustec`, daily DB backup timer).
   - `deploy/scripts/backup-db.sh`: PostgreSQL `pg_dump` backup script with rotation into `/var/backups/huseynovlar-terminal`.
   - `.env.example` & `.github/workflows/ci.yml` + `deploy-production.yml`: remove `telegram_bot_token`/`telegram_chat_id`, document `/etc/huseynovlar-terminal/integrations.env` + `http://ingest.terminal.local:8000`, add `../worker` to `ruff check`.
3. **Configuration Catalogs (`config/*.yaml`)**:
   - Audit & enrich `config/news_sources.yaml` (12+ institutional RSS feeds + `economic_calendar` ForexFactory JSON & fallback macro RSS), `config/treemap.yaml` (`sp500_top` [40+ major S&P 500 across all 11 GICS sectors], `nasdaq100`, `global_leaders`, `gold_commodities`, `crypto_majors`, `forex_majors`), `config/assets.default.yaml` (`XAUUSD` incl. `XAUUSDc`/`XAUUSDm`, `USTEC` incl. `USTECc`/`USTECm`, `SP500`, `EURUSD`, `BTCUSD`, `USOIL`), `config/alerts.default.yaml`, and new `config/providers.yaml`.
4. **MQL5 Dual-EA Bridge (`mql5/ExnessPanelBridge.mq5` & `mql5/ExnessPanelHook.mqh`)**:
   - Default `ApiBaseUrl` -> `http://ingest.terminal.local:8000/api/v1/ingest`.
   - Unmistakable RU+EN `4014` (`ERR_FUNCTION_NOT_ALLOWED`) guidance naming exact base origin (`http://ingest.terminal.local:8000` or `https://terminal.huseynovlar.org`).
   - Lock-safe `FILE_SHARE_READ | FILE_SHARE_WRITE` reading & truncation of `ep_ipc\events_<login>.jsonl` + automatic sibling-chart EA discovery (`ChartFirst`/`ChartNext`, `CHART_EXPERT_NAME`, `ChartSymbol`, `ChartPeriod`, `OBJ_LABEL` scraping for `STATE:`, `Trend:`, `Risk:`, etc.) -> `robot_states` in `POST /snapshot`.
